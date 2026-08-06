import 'server-only';

import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { experienceSkills, experiences, memories, threads } from '@na/db';
import { db } from './db';
import { effective, loadCorrections } from './corrections';

// ============================================================
// 사람이 판정을 고치면 기억 조건을 다시 본다.
//
// memory_score 는 엔진이 세션을 처리하는 그 순간에 계산해 저장한다. 교정은 그
// 뒤에 들어오고 읽을 때만 겹쳐지므로, 고쳐도 점수는 그대로였다 —
// is_first_time 을 true 로 바꾸면 +40 이라 20점짜리가 60을 넘는데(실데이터에
// 정확히 그런 경험이 3건 있다) 아무 일도 안 일어났다.
//
// completed 와 같은 자리다. 모델이 놓친 것을 사람이 말했으면, 그 말이 엔진과
// **같은 결과**를 내야 한다. 안 그러면 교정은 화면만 바꾸는 라벨이 된다.
//
// ── 왜 전체를 다시 계산하지 않는가 ──
//
// 점수 항목 중 셋은 "그때의 상태"에 달려 있다.
//   hasNewSkill          그 시점의 보유 스킬 목록
//   dormantSkillReturned 그 시점의 마지막 사용 시각
//   longSession          그 시점의 최근 세션 평균
// 오늘 다시 재면 다른 값이 나온다 — 스킬이 그 사이 늘었으니 예전엔 새것이던 게
// 지금은 아니다. 전체 재계산은 과거를 오늘 기준으로 다시 쓰는 일이다.
//
// 그래서 **교정으로 바뀔 수 있는 항목만** 고치기 전/후로 각각 구해 차이만
// 더한다. 그 셋은 전부 불변 데이터(experiences)에서 나오므로 언제 계산해도 같다.
//   is_first_time     ±40  직접 고치는 값
//   brokeThrough      ±35  직전이 stuck 인데 이번이 success
//   repeatingPattern  ∓30  최근 3건과 분야·주요 스킬이 모두 같음
// ============================================================

import { MEMORY_SCORE_THRESHOLD, memoryImportance } from './memory-score';

/** 그 경험의 주된 스킬(비중 최대). 반복 패턴 판정에 쓴다. */
async function primarySkillOf(experienceId: string): Promise<string | null> {
  const [row] = await db
    .select({ name: experienceSkills.skillName })
    .from(experienceSkills)
    .where(eq(experienceSkills.experienceId, experienceId))
    .orderBy(desc(experienceSkills.weight))
    .limit(1);
  return row?.name ?? null;
}

/**
 * 교정 뒤 이 경험이 기억 조건을 넘겼는지 보고, 넘겼으면 만든다.
 *
 * 내리는 방향은 안 본다. is_first_time 을 true → false 로 내려 60 아래가 되는
 * 경우도 있지만 이미 만들어진 기억은 지우지 않는다 — 기억 하나에 근거가 여럿
 * 달리므로 지우면 다른 근거까지 사라지고, "고쳤더니 기억이 없어졌다"는 되돌릴
 * 방법이 없다. 잊는 것은 별도 규칙(forgotten_at)의 일이다.
 */
export async function recheckMemoryAfterCorrection(
  userId: string,
  experienceId: string,
): Promise<{ created: boolean; appended: boolean }> {
  const [exp] = await db
    .select()
    .from(experiences)
    .where(and(eq(experiences.id, experienceId), eq(experiences.userId, userId)));
  if (!exp) return { created: false, appended: false };

  // 직전 경험 — brokeThrough 판정에 필요하다. 교정을 겹친 값으로 본다.
  const [prev] = await db
    .select({ id: experiences.id, outcome: experiences.outcome })
    .from(experiences)
    .where(and(eq(experiences.userId, userId), lt(experiences.occurredAt, exp.occurredAt)))
    .orderBy(desc(experiences.occurredAt))
    .limit(1);

  // 반복 패턴 — 이 경험 **직전** 3건. 정확히 3건일 때만 판정한다(엔진과 같다).
  const recent3 = await db
    .select({ id: experiences.id, category: experiences.category })
    .from(experiences)
    .where(and(eq(experiences.userId, userId), lt(experiences.occurredAt, exp.occurredAt)))
    .orderBy(desc(experiences.occurredAt))
    .limit(3);

  const corrections = await loadCorrections([exp.id, ...(prev ? [prev.id] : []), ...recent3.map((r) => r.id)]);

  const before = {
    isFirstTime: exp.isFirstTime,
    outcome: exp.outcome,
    category: exp.category,
  };
  const after = {
    isFirstTime: effective(corrections, exp.id, 'is_first_time', String(exp.isFirstTime)) === 'true',
    outcome: effective(corrections, exp.id, 'outcome', exp.outcome ?? ''),
    category: effective(corrections, exp.id, 'category', exp.category),
  };

  // 직전 경험의 outcome 도 교정됐을 수 있다. 그것까지 겹쳐야 brokeThrough 가 맞다.
  const prevOutcomeRaw = prev?.outcome ?? null;
  const prevOutcomeEff = prev
    ? effective(corrections, prev.id, 'outcome', prev.outcome ?? '')
    : null;

  const brokeBefore = prevOutcomeRaw === 'stuck' && before.outcome === 'success';
  const brokeAfter = prevOutcomeEff === 'stuck' && after.outcome === 'success';

  let repeatBefore = false;
  let repeatAfter = false;
  if (recent3.length === 3) {
    const mine = await primarySkillOf(exp.id);
    const theirs = await Promise.all(recent3.map((r) => primarySkillOf(r.id)));
    const sameSkill = theirs.every((s) => s === mine);
    repeatBefore = sameSkill && recent3.every((r) => r.category === before.category);
    repeatAfter =
      sameSkill &&
      recent3.every(
        (r) => effective(corrections, r.id, 'category', r.category) === after.category,
      );
  }

  const delta =
    (after.isFirstTime ? 40 : 0) - (before.isFirstTime ? 40 : 0) +
    (brokeAfter ? 35 : 0) - (brokeBefore ? 35 : 0) +
    (repeatAfter ? -30 : 0) - (repeatBefore ? -30 : 0);

  const score = exp.memoryScore + delta;
  if (score < MEMORY_SCORE_THRESHOLD) return { created: false, appended: false };

  // 이미 어느 기억의 근거면 할 일이 없다.
  const [already] = await db
    .select({ id: memories.id })
    .from(memories)
    .where(
      and(
        eq(memories.userId, userId),
        isNull(memories.forgottenAt),
        sql`${exp.id} = any(${memories.experienceIds})`,
      ),
    )
    .limit(1);
  if (already) return { created: false, appended: false };

  // 갈래에 안 붙은 경험은 모을 자리가 없다. 실제로는 모든 경험이 갈래를 갖는다.
  if (!exp.threadId) return { created: false, appended: false };

  const [thread] = await db
    .select({ title: threads.title })
    .from(threads)
    .where(eq(threads.id, exp.threadId));

  // 엔진·completeThread 와 같은 규칙 — 갈래당 기억 하나에 근거를 더한다.
  const [existing] = await db
    .select({
      id: memories.id,
      experienceIds: memories.experienceIds,
      triggers: memories.triggers,
      importance: memories.importance,
    })
    .from(memories)
    .where(
      and(
        eq(memories.userId, userId),
        eq(memories.threadId, exp.threadId),
        isNull(memories.forgottenAt),
      ),
    )
    .limit(1);

  // 교정으로 넘긴 것이므로 이유는 사람이 말한 그 값이다.
  const trigger = after.isFirstTime && !before.isFirstTime ? 'new_skill' : brokeAfter ? 'breakthrough' : 'comeback';

  const [thr] = await db
    .select({ n: threads.experienceCount })
    .from(threads)
    .where(eq(threads.id, exp.threadId));
  const threadExperienceCount = thr?.n ?? 1;

  if (existing) {
    const ids = [...existing.experienceIds, exp.id];
    const rows = await db
      .select({ s: experiences.memoryScore })
      .from(experiences)
      .where(inArray(experiences.id, ids));
    await db
      .update(memories)
      .set({
        experienceIds: ids,
        triggers: existing.triggers.includes(trigger)
          ? existing.triggers
          : [...existing.triggers, trigger],
        // 더하지 않고 다시 잰다. 다만 이 경험의 점수는 저장값(교정 전)이라
        // 교정으로 오른 만큼은 안 잡힌다 — 근거 수와 갈래 깊이는 그대로 반영된다.
        importance: memoryImportance({
          evidenceScores: rows.map((r) => r.s),
          threadExperienceCount,
        }),
        needsResummary: true,
      })
      .where(eq(memories.id, existing.id));
    return { created: false, appended: true };
  }

  await db.insert(memories).values({
    userId,
    threadId: exp.threadId,
    experienceId: exp.id,
    experienceIds: [exp.id],
    occurredAt: exp.occurredAt,
    title: thread?.title ?? exp.summary,
    body: exp.detail ?? exp.summary,
    importance: memoryImportance({ evidenceScores: [score], threadExperienceCount }),
    trigger,
    triggers: [trigger],
    // 새로 만든 것도 밤에 다듬는다 — 제목이 갈래 이름이라 근거와 어긋날 수 있다.
    needsResummary: true,
  });
  return { created: true, appended: false };
}
