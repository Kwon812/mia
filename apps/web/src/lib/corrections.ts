import 'server-only';

import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { corrections, experiences, memories, questions, threads, type CORRECTION_FIELDS } from '@na/db';
import { db } from './db';
// memory-score 는 순수 계산이라 여기서 불러도 순환이 안 생긴다.
// experience-engine 쪽 upsertThreadMemory 를 쓰면 순환이다 — 그쪽이 이 파일을 쓴다.
import { memoryImportance } from './memory-score';

// ============================================================
// 사람 판단(declared) 읽기·쓰기
//
// 핵심 규칙 하나: **experiences 를 절대 UPDATE 하지 않는다.**
// 그쪽은 불변이 설계 전제고 재처리(apply-reprocess·dry-reprocess)가 그 위에
// 서 있다. 그리고 덮어쓰면 (모델 출력, 사람 정답) 쌍이 사라지는데, 학습에
// 필요한 건 정답이 아니라 그 쌍이다.
//
// 그래서 "현재 값"은 저장된 값이 아니라 **읽을 때 겹쳐서 만드는 값**이다.
//   experiences(inferred)  +  corrections(declared 최신 1건)  =  유효값
//
// ── thread 하나만 예외다 ──
//
// 갈래는 라벨이 아니라 **관계**다. 프롬프트의 갈래 후보 목록도, 각 후보의
// "최근:" 줄도, 경험 개수도 전부 experiences.thread_id 조인에서 나온다.
// 겹쳐 읽기로만 처리하면 그 조인 지점을 하나도 빠짐없이 고쳐야 하고, 하나만
// 놓쳐도 교정이 아무 데도 안 쓰이는 라벨 더미가 된다 — 이 파일이 반복해서
// 경고하는 바로 그 상태다. 그래서 thread_id 는 실제로 옮긴다.
//
// 불변식의 **이유**는 그대로 지켜진다: model_value 에 옮기기 전 갈래 제목을
// 박제하므로 (모델 출력, 사람 정답) 쌍이 남는다. 그리고 재처리가 딛고 선
// 것은 판정 필드(summary·category·outcome…)의 불변성이지 thread_id 가
// 아니다 — 그 컬럼은 스키마 주석부터 "나중에 부착. 유일한 UPDATE 대상"이다.
// ============================================================

export type CorrectionField = (typeof CORRECTION_FIELDS)[number];

/** `${experienceId}:${field}` → 사람이 고른 값 */
export type CorrectionMap = Map<string, string>;

const key = (experienceId: string, field: CorrectionField) => `${experienceId}:${field}`;

/**
 * 경험들의 최신 교정값을 한 번에 읽는다.
 *
 * corrections 는 append-only 라 같은 (experience_id, field) 에 여러 행이 쌓이고
 * 가장 나중 것이 이긴다. DISTINCT ON 대신 **오름차순으로 훑으며 덮어쓴다** —
 * 하루치 경험이 25건, 경험당 교정이 많아야 3건이라 전량을 읽어도 100행 미만이고,
 * 원시 SQL 을 쓰지 않아 스키마 변경에 덜 깨진다.
 */
export async function loadCorrections(experienceIds: readonly string[]): Promise<CorrectionMap> {
  const map: CorrectionMap = new Map();
  if (experienceIds.length === 0) return map;

  const rows = await db
    .select({
      experienceId: corrections.experienceId,
      field: corrections.field,
      humanValue: corrections.humanValue,
    })
    .from(corrections)
    .where(inArray(corrections.experienceId, [...experienceIds]))
    .orderBy(corrections.createdAt); // 오름차순 — 뒤에 오는 행이 앞을 덮는다

  for (const row of rows) {
    map.set(key(row.experienceId, row.field), row.humanValue);
  }
  return map;
}

/** 교정이 있으면 그 값, 없으면 모델 값. declared > inferred 를 여기서 집행한다.
 *
 *  `T extends string | null` 인 이유: experiences.outcome 이 nullable 이고
 *  드리즐이 좁은 유니온('success'|'partial'|...|null)으로 타이핑한다. string 으로
 *  조이면 호출부마다 캐스팅이 생기고, 그러면 좁은 유니온이 넓은 string 으로
 *  풀려 EmotionExperienceInput 같은 소비자에서 타입 안전이 사라진다. */
export function effective<T extends string | null>(
  map: CorrectionMap,
  experienceId: string,
  field: CorrectionField,
  modelValue: T,
): T {
  return (map.get(key(experienceId, field)) as T | undefined) ?? modelValue;
}

/** 이 필드가 사람 손을 탔는가 — 화면에 표시하고, 프롬프트에도 알려준다. */
export function isCorrected(map: CorrectionMap, experienceId: string, field: CorrectionField): boolean {
  return map.has(key(experienceId, field));
}

/** 모델이 낸 값을 문자열로 통일한다. is_first_time 은 boolean 이라 'true'/'false' 로 눕힌다.
 *
 *  thread 는 uuid 가 아니라 **제목**이다. 재구축이 threads 를 통째로 다시 만들어
 *  id 가 매번 새로 발급되므로, id 를 박제하면 다음 재구축에서 아무것도 못 가리킨다. */
export function modelValueOf(
  row: { outcome: string | null; category: string; isFirstTime: boolean; threadTitle?: string | null },
  field: CorrectionField,
): string {
  switch (field) {
    case 'outcome':
      return row.outcome ?? '';
    case 'category':
      return row.category;
    case 'is_first_time':
      return String(row.isFirstTime);
    case 'thread':
      // 갈래가 아직 안 붙은 경험도 있다(엔진이 붙이기 전, 또는 붙이기 실패).
      // 빈 문자열이면 loadCorrectionPatterns 가 `→ KT Cloud` 로 읽어준다.
      return row.threadTitle ?? '';
  }
}

/** 갈래 제목 상한. experience-engine 의 MAX_THREAD_TITLE_LEN 과 같은 값이다 —
 *  거기 것은 모델 출력을 자르는 용도라 export 되어 있지 않다. */
const MAX_THREAD_TITLE_LEN = 100;

/**
 * 경험을 다른 갈래로 옮긴다. **thread 교정의 실제 효과**다.
 *
 * 제목으로 찾고 없으면 만든다. 사람이 "이건 KT Cloud 갈래다"라고 말한 것은
 * 그런 갈래가 있어야 한다는 선언이기도 하다 — 재구축 뒤 그 갈래가 아직 안
 * 만들어진 시점에도 교정이 스스로 복구되려면 만들 수 있어야 한다.
 *
 * 옮긴 뒤 양쪽 갈래를 다시 센다. 개수·분야·기간이 전부 소속 경험에서 나오는
 * 파생값이라, 안 고치면 후보 목록이 "경험 12건"이라 말하면서 실제로는 11건인
 * 갈래를 보여준다 — 모델은 그 숫자를 보고 무게를 잰다.
 */
export async function moveExperienceToThread(params: {
  userId: string;
  experienceId: string;
  /** 옮겨 갈 갈래의 제목. 없으면 만든다. */
  title: string;
}): Promise<RecordResult> {
  const title = params.title.trim();
  if (!title) return { ok: false, error: '갈래 이름이 비어 있어.' };
  if (title.length > MAX_THREAD_TITLE_LEN) return { ok: false, error: '갈래 이름이 너무 길어.' };

  return db.transaction(async (tx) => {
    const [exp] = await tx
      .select({
        id: experiences.id,
        threadId: experiences.threadId,
        category: experiences.category,
        occurredAt: experiences.occurredAt,
      })
      .from(experiences)
      .where(and(eq(experiences.id, params.experienceId), eq(experiences.userId, params.userId)))
      .limit(1);
    if (!exp) return { ok: false, error: '그 경험을 찾을 수 없어.' };

    // 같은 제목이 여럿이면 살아 있는 것, 그중 최근 것을 고른다. 재구축이
    // 제목을 다시 짓다 보면 드물게 겹친다.
    const [found] = await tx
      .select({ id: threads.id, status: threads.status })
      .from(threads)
      .where(and(eq(threads.userId, params.userId), eq(threads.title, title)))
      .orderBy(sql`case when ${threads.status} = 'active' then 0 else 1 end`, desc(threads.lastActivityAt))
      .limit(1);

    let targetId = found?.id ?? null;
    if (!targetId) {
      const [made] = await tx
        .insert(threads)
        .values({
          userId: params.userId,
          title,
          category: exp.category,
          startedAt: exp.occurredAt,
          lastActivityAt: exp.occurredAt,
          experienceCount: 0, // 아래 resync 가 실제 개수로 채운다
        })
        .returning({ id: threads.id });
      targetId = made.id;
    } else if (found.status === 'abandoned') {
      // 잠긴 갈래로 옮기는 것은 그 일을 다시 한다는 뜻이다. completed 는
      // 사람이 선언한 값이라 안 건드린다 — 엔진의 attach 분기와 같은 규칙.
      await tx.update(threads).set({ status: 'active' }).where(eq(threads.id, targetId));
    }

    const from = exp.threadId;
    if (from === targetId) return { ok: true }; // 이미 거기 있다

    await tx.update(experiences).set({ threadId: targetId }).where(eq(experiences.id, exp.id));
    // 기억은 여기서 안 건드린다. 갈래가 **비었을 때만** 따라간다(resyncThread) —
    // 경험 하나가 빠져도 갈래에 다른 경험이 남아 있으면 그 기억은 여전히 그
    // 갈래의 것이고, 근거 목록(experience_ids)은 그대로다.

    await resyncThread(tx, targetId);
    if (from) await resyncThread(tx, from);
    return { ok: true };
  });
}

/** 갈래의 파생값(개수·분야·기간)을 소속 경험에서 다시 만든다.
 *  비고 기억도 없으면 갈래 자체를 지운다 — 경험 0건짜리 갈래가 후보 목록에
 *  남으면 다음 판정을 끌어당기는 유령이 된다. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function resyncThread(tx: Tx, threadId: string): Promise<void> {
  await tx.execute(sql`
    update ${threads} t set
      experience_count = coalesce(s.n, 0),
      category = coalesce(s.cat, t.category),
      started_at = coalesce(s.first_at, t.started_at),
      last_activity_at = coalesce(s.last_at, t.last_activity_at)
    from (
      select count(*)::int as n,
             min(e.occurred_at) as first_at,
             max(e.occurred_at) as last_at,
             -- 분야는 "지금까지 무엇을 한 작업인가"다. 동률이면 이름순(결정적).
             (select e2.category from ${experiences} e2
               where e2.thread_id = ${threadId}
               group by e2.category order by count(*) desc, e2.category asc limit 1) as cat
        from ${experiences} e where e.thread_id = ${threadId}
    ) s
    where t.id = ${threadId}`);

  // ── 비었으면 기억을 옮기고 갈래를 지운다 ──
  //
  // 이 시스템에서 **갈래 없는 기억은 없다.** 기억을 만드는 두 경로가 전부
  // 갈래를 요구한다 — `upsertThreadMemory(threadId: string)` 이고,
  // memory-recheck 는 아예 `if (!exp.threadId) return` 으로 막는다("갈래에
  // 안 붙은 경험은 모을 자리가 없다"). `uq_memories_thread` 도 갈래당 하나다.
  // 경험이 갈래에 모이고, 그 갈래가 기억이 된다.
  //
  // 그런데 갈래 교정이 **경험이 갈래에서 빠지는** 새 상태를 만들었다. 원래
  // 갈래가 비면 그 갈래는 아무것도 안 가리키는 유령인데 후보 목록에는 계속
  // 올라와 다음 판정을 끌어당긴다. 지워야 하지만 기억이 물고 있다.
  //
  // 처음엔 thread_id 를 NULL 로 떼고 지웠는데 그건 위 규칙을 어긴 것이었다.
  // 지도가 갈래 없는 기억을 통째로 버려(thread-memories.ts 의
  // `if (m.threadId == null) continue`) 기억 둘이 화면에서 사라졌다.
  //
  // 옳은 답은 **기억이 근거 경험을 따라가는 것**이다. 경험이 새 갈래로 갔으면
  // 기억도 그 갈래의 것이 된다. 그러면 "갈래 = 기억의 주체"가 유지된다.
  const orphans = await tx
    .select({
      id: memories.id,
      userId: memories.userId,
      experienceIds: memories.experienceIds,
      triggers: memories.triggers,
      trigger: memories.trigger,
    })
    .from(memories)
    .where(eq(memories.threadId, threadId));

  for (const m of orphans) {
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(experiences)
      .where(eq(experiences.threadId, threadId));
    if (n > 0) break; // 아직 안 비었다

    // 갈래 기억은 그 **갈래**에 대한 진술이라 옮길 데가 없다. 갈래를 살려둔다.
    const trs = m.triggers.length > 0 ? m.triggers : [m.trigger];
    if (trs.some((t) => t === 'deepened' || t === 'thread_complete')) continue;

    // 근거가 여러 갈래에 흩어졌으면 가장 많은 쪽. 동률이면 id 순 —
    // 결정적이라야 재구축마다 안 흔들린다.
    //
    // 원시 sql 의 `any(${배열})` 은 못 쓴다. drizzle 이 배열을 파라미터 하나로
    // 묶지 않고 펼쳐 넣어서 `malformed array literal` 이 난다. inArray 를 쓴다.
    if (m.experienceIds.length === 0) continue;
    const [dst] = await tx
      .select({ tid: experiences.threadId })
      .from(experiences)
      .where(and(inArray(experiences.id, m.experienceIds), isNotNull(experiences.threadId)))
      .groupBy(experiences.threadId)
      .orderBy(desc(sql`count(*)`), experiences.threadId)
      .limit(1);
    // 갈 곳이 없다 — 갈래를 살려둔다. 기억을 잃는 것보다 낫다.
    if (!dst?.tid) continue;

    const [host] = await tx
      .select({
        id: memories.id,
        experienceIds: memories.experienceIds,
        triggers: memories.triggers,
        trigger: memories.trigger,
      })
      .from(memories)
      .where(
        and(
          eq(memories.threadId, dst.tid),
          eq(memories.userId, m.userId),
          isNull(memories.forgottenAt),
        ),
      )
      .limit(1);

    if (!host) {
      await tx.update(memories).set({ threadId: dst.tid }).where(eq(memories.id, m.id));
      continue;
    }

    // 목적지에 이미 기억이 있다(uq_memories_thread). NULL 로 떨어뜨리지 않고
    // **합친다** — 같은 갈래에 조건이 또 걸렸을 때 upsertThreadMemory 가 하는
    // 일과 같다. 근거를 더하고, 이유를 합치고, 중요도를 다시 잰다.
    const ids = [...new Set([...host.experienceIds, ...m.experienceIds])];
    const hostTrs = host.triggers.length > 0 ? host.triggers : [host.trigger];
    const merged = [...new Set([...hostTrs, ...trs])];
    const [{ cnt }] = await tx
      .select({ cnt: sql<number>`count(*)::int` })
      .from(experiences)
      .where(eq(experiences.threadId, dst.tid));
    const scores = await tx
      .select({ s: experiences.memoryScore })
      .from(experiences)
      .where(inArray(experiences.id, ids));

    await tx
      .update(memories)
      .set({
        experienceIds: ids,
        triggers: merged,
        importance: memoryImportance({
          evidenceScores: scores.map((r) => r.s),
          threadExperienceCount: cnt,
        }),
        // 근거가 늘었으니 밤 배치가 다시 요약한다. 여기서 LLM 을 부르면
        // 교정 한 번이 모델 호출을 끌고 온다.
        needsResummary: true,
      })
      .where(eq(memories.id, host.id));
    await tx.delete(memories).where(eq(memories.id, m.id));
  }

  await tx.execute(sql`
    delete from ${threads} t
     where t.id = ${threadId}
       and not exists (select 1 from ${experiences} e where e.thread_id = t.id)
       and not exists (select 1 from ${memories} m where m.thread_id = t.id)`);
}

export type RecordResult = { ok: true } | { ok: false; error: string };

/**
 * 교정 1건 기록.
 *
 * model_value 를 여기서 읽어 **박제**한다. corrections 가 experiences 를
 * 참조만 하면, 나중에 재처리로 experiences 값이 바뀌었을 때 "무엇을 고친
 * 것이었는지"가 사라진다. 쌍이 보존되려면 사본이어야 한다.
 *
 * 소유권 확인도 여기서 한다 — experience_id 는 클라이언트가 보내는 값이라,
 * user_id 로 함께 조회해서 남의 경험을 고칠 수 없게 막는다.
 */
export async function recordCorrection(params: {
  userId: string;
  experienceId: string;
  field: CorrectionField;
  humanValue: string;
  source: 'diary' | 'ask';
  questionId?: string;
}): Promise<RecordResult> {
  const [row] = await db
    .select({
      outcome: experiences.outcome,
      category: experiences.category,
      isFirstTime: experiences.isFirstTime,
      // thread 교정의 model_value 는 "옮기기 전에 어느 갈래에 있었나"다.
      threadTitle: threads.title,
    })
    .from(experiences)
    .leftJoin(threads, eq(threads.id, experiences.threadId))
    .where(and(eq(experiences.id, params.experienceId), eq(experiences.userId, params.userId)))
    .limit(1);

  if (!row) return { ok: false, error: '그 경험을 찾을 수 없어.' };

  let modelValue = modelValueOf(row, params.field);

  // ── thread 는 "모델이 낸 값"을 experiences 에서 못 읽는다 ──
  //
  // 나머지 셋은 experiences 가 불변이라 몇 번을 고쳐도 model_value 가 늘
  // 모델의 원래 판정이다. 그래서 A→B 로 고쳤다가 A 로 되돌리면 두 번째 행이
  // model_value === human_value 가 되고, loadCorrectionPatterns 가 그걸
  // "확인이지 교정이 아니다"로 걸러 프롬프트에 안 들어간다.
  //
  // thread 는 thread_id 를 실제로 옮기므로 두 번째 교정 때 B 가 읽힌다.
  // 그대로 두면 `thread: B → A` 라는 **정반대 교훈**이 프롬프트에 남는다 —
  // 되돌린 것뿐인데 모델은 "B 의 일은 A 에 넣으라"로 읽는다.
  //
  // 앞선 교정이 있으면 그 model_value 가 모델의 원래 판정이다. 그걸 물려받아
  // 다른 필드와 같은 성질로 되돌린다. 되돌린 이력 자체는 행으로 남는다 —
  // 마음을 바꾼 횟수는 라벨 신뢰도 신호라 지우지 않는다.
  if (params.field === 'thread') {
    const [first] = await db
      .select({ modelValue: corrections.modelValue })
      .from(corrections)
      .where(
        and(eq(corrections.experienceId, params.experienceId), eq(corrections.field, 'thread')),
      )
      .orderBy(corrections.createdAt)
      .limit(1);
    if (first) modelValue = first.modelValue;
  }

  // thread 는 기록만으로 끝나지 않는다 — 실제로 옮겨야 후보 목록과 "최근:" 줄이
  // 바뀌고, 그래야 다음 세션의 판정이 달라진다. 옮기기가 실패하면 교정 행도
  // 남기지 않는다. 둘이 갈리면 "고쳤다고 나오는데 지도는 그대로"가 된다.
  if (params.field === 'thread') {
    const moved = await moveExperienceToThread({
      userId: params.userId,
      experienceId: params.experienceId,
      title: params.humanValue,
    });
    if (!moved.ok) return moved;

    // ── 제자리로 돌아왔으면 그 경험의 갈래 교정을 통째로 지운다 ──
    //
    // modelValue 는 위에서 **최초** 교정의 값을 물려받았으므로, 여기서 같다는
    // 것은 모델이 놓은 자리로 되돌아왔다는 뜻이다 — 순효과가 0 이다.
    //
    // 되돌림 행만 남기고 앞의 실수 행을 두면 안 된다. 실수 행은
    // model_value ≠ human_value 라 loadCorrectionPatterns 가 못 거르고,
    // 되돌렸는데도 `A → B` 라는 교훈이 계속 프롬프트에 실린다. 재구축도 그
    // 행을 재생해 옮기기를 두 번 헛돈다.
    //
    // 다른 세 필드는 행을 남긴다(마음 바꾼 이력 = 라벨 신뢰도 신호). 갈래만
    // 지우는 것은 값이 열거가 아니라서다 — 제목은 매번 유일해서 `A → B (1회)`
    // 한 줄이 통째로 남고 집계로 묻히지 않는다.
    if (modelValue === params.humanValue) {
      const gone = await db
        .delete(corrections)
        .where(
          and(eq(corrections.experienceId, params.experienceId), eq(corrections.field, 'thread')),
        )
        .returning({ id: corrections.id });
      if (gone.length > 0) {
        if (params.questionId) {
          await db
            .update(questions)
            .set({ answeredAt: new Date() })
            .where(and(eq(questions.id, params.questionId), eq(questions.userId, params.userId)));
        }
        return { ok: true };
      }
    }
  }

  // 직전 교정과 같은 값이면 넣지 않는다.
  //
  // upsert(덮어쓰기)가 아닌 이유: 마음을 바꾼 이력은 남겨야 한다. 한 번에
  // 확정한 교정과 세 번 뒤집은 교정은 라벨 신뢰도가 다른데, 덮어쓰면 그
  // 구분이 사라져 1년 뒤 둘 다 그냥 정답으로 보인다.
  //
  // 그렇다고 무조건 append 하면 같은 값을 두 번 눌렀을 때 아무 정보도 없는
  // 중복 행이 쌓인다. 그건 이력이 아니라 잡음이다. 그래서 **값이 실제로
  // 달라졌을 때만** 새 행을 만든다.
  const [latest] = await db
    .select({ humanValue: corrections.humanValue })
    .from(corrections)
    .where(
      and(
        eq(corrections.experienceId, params.experienceId),
        eq(corrections.field, params.field),
      ),
    )
    .orderBy(desc(corrections.createdAt))
    .limit(1);

  // 값이 실제로 달라졌을 때만 새 행을 만든다.
  //
  // 모델 값과 같은 값을 고른 것은 교정이 아니라 **확인**이고, 그건 기록한다 —
  // "사람이 보고 맞다고 했다"는 positive 라벨이라 침묵과 구분되어야 한다.
  // 다만 확인이 의미를 가지려면 **의도적**이어야 한다. /diary 칩은 지금 값을
  // 다시 눌러도 서버까지 오지 않게 막아두었고(correction-chips.tsx), 확인
  // 라벨은 캐릭터 질문(층 2)에서 나온다 — 물음에 답한 것이라 의도가 분명하다.
  const unchanged = latest?.humanValue === params.humanValue;

  if (!unchanged) {
    await db.insert(corrections).values({
      userId: params.userId,
      experienceId: params.experienceId,
      field: params.field,
      modelValue,
      humanValue: params.humanValue,
      source: params.source,
      questionId: params.questionId ?? null,
    });
  }

  // 중복이라 안 넣었더라도 질문은 닫는다. 안 그러면 사용자가 답했는데도
  // 열린 질문이 남아 배치가 다음 질문을 못 만든다.
  if (params.questionId) {
    await db
      .update(questions)
      .set({ answeredAt: new Date() })
      .where(and(eq(questions.id, params.questionId), eq(questions.userId, params.userId)));
  }

  return { ok: true };
}

/** 집계된 교정 패턴 한 줄. "outcome 을 explore 에서 stuck 으로 3번 고쳤다". */
export interface CorrectionPattern {
  field: CorrectionField;
  from: string;
  to: string;
  count: number;
}

/** 집계에 넣는 최근 교정 개수.
 *
 *  전체 기간을 집계하면 프롬프트 v3 시절 출력에 대한 교정이 v4 판정까지
 *  끌고 온다. corrections 에 prompt_version 을 안 넣어놔서 정확히 가를 수가
 *  없으므로(그건 마이그레이션이 하나 더 붙는다), 최근 것으로 자른다. */
const PATTERN_SAMPLE = 20;

/**
 * 교정 **패턴**을 집계한다 — 개별 경험이 아니라 "무엇을 무엇으로 바꿨나"의 분포.
 *
 * 왜 경험 목록이 아니라 집계인가:
 *   1) 안 늙는다. 최근 경험 3건 창에 교정이 갇히던 문제(고치면 몇 시간 뒤
 *      프롬프트에서 사라짐)를 실제로 푼다. 1년이 지나도 몇 줄이다.
 *   2) 교훈이 직접적이다. 교정의 가치는 "그 경험이 사실 stuck 이었다"가 아니라
 *      "너는 explore 로 도망가는 버릇이 있다"에 있다.
 *   3) 오래된 맥락을 안 끌고 온다. 사흘 전 경험의 요약문을 다시 넣으면 모델이
 *      이번 세션을 그 옛 작업의 연장으로 오인할 수 있다(thread 판정 오염).
 *
 * **확인은 제외한다.** model_value === human_value 인 행은 "맞다"는 긍정 라벨이지
 * 교정이 아니다. 섞으면 `explore → explore (5회)` 같은 무의미한 줄이 생긴다.
 */
export async function loadCorrectionPatterns(userId: string): Promise<CorrectionPattern[]> {
  const rows = await db
    .select({
      field: corrections.field,
      modelValue: corrections.modelValue,
      humanValue: corrections.humanValue,
    })
    .from(corrections)
    .where(eq(corrections.userId, userId))
    .orderBy(desc(corrections.createdAt))
    .limit(PATTERN_SAMPLE);

  const counts = new Map<string, CorrectionPattern>();
  for (const row of rows) {
    if (row.modelValue === row.humanValue) continue; // 확인이지 교정이 아니다
    const k = `${row.field}:${row.modelValue}:${row.humanValue}`;
    const hit = counts.get(k);
    if (hit) hit.count += 1;
    else counts.set(k, { field: row.field, from: row.modelValue, to: row.humanValue, count: 1 });
  }

  // 잦은 것부터. 프롬프트가 잘릴 일은 없지만 읽는 순서가 곧 강조 순서다.
  return [...counts.values()].sort((a, b) => b.count - a.count);
}

/** 최근 교정된 경험 id 들 — 프롬프트 컨텍스트에서 "사람이 고친 것" 표시에 쓴다. */
export async function correctedExperienceIds(
  userId: string,
  experienceIds: readonly string[],
): Promise<Set<string>> {
  if (experienceIds.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ experienceId: corrections.experienceId })
    .from(corrections)
    .where(and(eq(corrections.userId, userId), inArray(corrections.experienceId, [...experienceIds])));
  return new Set(rows.map((r) => r.experienceId));
}
