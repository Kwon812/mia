// daily-questions: 층 2 — 캐릭터가 사용자에게 하루 한 가지를 묻는다.
//
// 층 1(/diary 판정 칩)이 "훑다가 눈에 띄면 고친다"라면, 이건 **모델이 제일
// 자신 없는 한 건을 골라 먼저 묻는** 경로다. 무작위 라벨보다 정보량이 크다.
//
// LLM 을 쓰지 않는다. 질문 문장은 경험 요약을 끼운 템플릿이고, 후보 선정은
// 규칙 기반이다 — 야간 배치의 LLM 호출은 일기 하나로 유지한다.
//
// 홈 화면(apps/web/src/app/page.tsx)이 이 결과를 읽기만 한다. 질문 생성을
// 페이지 렌더에 두면 서버 컴포넌트가 매 렌더마다 쓰기를 하게 되고, "하루 1건"
// 이라는 예산을 렌더 횟수가 좌우하게 된다.

import { and, desc, eq, gte, isNull } from 'drizzle-orm';
import { corrections, experiences, questions, type Db } from '@na/db';
import { diaryTargetKst } from '../kst';

/** 후보로 볼 기간. 2주 전 판정을 물으면 사용자가 기억을 못 해서
 *  답이 추측이 된다 — 그건 declared 가 아니라 또 다른 inferred 다. */
const CANDIDATE_WINDOW_DAYS = 3;

/** 미답변 질문을 화면에 붙들어 두는 시간. 이 시간이 지나면 침묵으로 확정하고
 *  다음 질문으로 넘어간다 (행은 그대로 남아 무응답 자체가 기록된다). */
const OPEN_QUESTION_TTL_HOURS = 36;

/**
 * 후보 우선순위 — **불확실성의 대리 지표지 confidence 가 아니다.**
 *
 * Haiku 는 logprob 을 주지 않아 진짜 확신도를 못 읽는다. 대신 프롬프트 이력에서
 * 실제로 흔들린 것으로 관측된 자리를 쓴다(experience-engine.ts 의 v3 주석):
 *   1) outcome='explore' — 모델이 판단을 못 할 때 도망가던 값. 실측 6건 중 5건이 여기 쏠렸다
 *   2) is_first_time=true — v2 까지 거의 안 나오다가 v3 에서 완화한 값이라 아직 불안정하다
 *   3) memory_score 높은 것 — 틀렸을 때 손해가 가장 큰 것
 * 나중에 같은 세션을 두 번 돌려 판정이 갈리는지 보는 진짜 신호로 바꿀 수 있다.
 */
function questionFor(row: CandidateRow): { field: 'outcome' | 'is_first_time'; text: string } {
  if (row.outcome === 'explore') {
    return {
      field: 'outcome',
      text: `"${row.summary}" — 이거 결국 어떻게 됐어? 나는 그냥 둘러본 걸로 적어놨는데 맞아?`,
    };
  }
  if (row.isFirstTime) {
    return {
      field: 'is_first_time',
      text: `"${row.summary}" — 이거 처음 해본 거 맞지? 그렇게 적어뒀어.`,
    };
  }
  return {
    field: 'outcome',
    text: `"${row.summary}" — 이건 잘 풀린 걸로 기억하는데, 맞아?`,
  };
}

interface CandidateRow {
  id: string;
  userId: string;
  summary: string;
  category: string;
  outcome: string | null;
  isFirstTime: boolean;
  memoryScore: number;
}

export async function generateDailyQuestions(db: Db): Promise<void> {
  console.log('[daily-questions] start');

  const since = new Date(Date.now() - CANDIDATE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const openCutoff = new Date(Date.now() - OPEN_QUESTION_TTL_HOURS * 60 * 60 * 1000);
  // "하루 1건" 예산의 경계. 일기와 같은 하루(KST 새벽 4시 기준)를 쓴다 —
  // 다른 경계를 쓰면 "오늘 일기"와 "오늘 질문"이 가리키는 날이 어긋난다.
  const { start: dayStart } = diaryTargetKst();

  // 최근 사흘 안에 경험이 있는 유저만 대상. 안 쓰는 사용자에게 질문을 쌓아두면
  // 돌아왔을 때 기억 안 나는 질문 더미가 기다린다.
  const candidates: CandidateRow[] = await db
    .select({
      id: experiences.id,
      userId: experiences.userId,
      summary: experiences.summary,
      category: experiences.category,
      outcome: experiences.outcome,
      isFirstTime: experiences.isFirstTime,
      memoryScore: experiences.memoryScore,
    })
    .from(experiences)
    .where(gte(experiences.occurredAt, since))
    .orderBy(desc(experiences.occurredAt));

  if (candidates.length === 0) {
    console.log('[daily-questions] 후보 경험 없음');
    console.log('[daily-questions] done');
    return;
  }

  const byUser = new Map<string, CandidateRow[]>();
  for (const row of candidates) {
    const list = byUser.get(row.userId) ?? [];
    list.push(row);
    byUser.set(row.userId, list);
  }

  let asked = 0;
  let skipped = 0;

  for (const [userId, rows] of byUser) {
    try {
      // ① 오늘 이미 물었으면 끝. **하루 1건이 예산이다.**
      //
      // 이 가드가 없으면 배치를 다시 돌릴 때마다 그날 질문이 하나씩 늘어난다
      // (실측으로 잡힌 버그다 — 앞선 질문에 답한 상태로 재실행하면 ② 가
      // 통과해버려 같은 날 두 번째 질문이 생겼다). 배치는 실패한 단계만
      // 골라 다시 돌릴 수 있어야 하므로 재실행이 멱등해야 한다.
      const [askedToday] = await db
        .select({ id: questions.id })
        .from(questions)
        .where(and(eq(questions.userId, userId), gte(questions.askedAt, dayStart)))
        .limit(1);

      if (askedToday) {
        skipped += 1;
        continue;
      }

      // ② 아직 열려 있는(답도 넘김도 없는) 질문이 있으면 새로 만들지 않는다.
      // 답을 안 한 질문이 쌓이면 사용자는 전부 무시하게 되고, 그러면
      // 침묵률만 올라간다. TTL 이 지난 것은 침묵으로 확정하고 넘어간다.
      const [open] = await db
        .select({ id: questions.id })
        .from(questions)
        .where(
          and(
            eq(questions.userId, userId),
            isNull(questions.answeredAt),
            isNull(questions.dismissedAt),
            gte(questions.askedAt, openCutoff),
          ),
        )
        .limit(1);

      if (open) {
        skipped += 1;
        continue;
      }

      // 이미 물어본 경험과 이미 사람이 고친 경험은 제외한다. 전자는 중복이고
      // 후자는 답이 이미 나온 것이다 — 둘 다 그날치 질문 예산을 낭비한다.
      const [askedIds, correctedIds] = await Promise.all([
        db.select({ id: questions.experienceId }).from(questions).where(eq(questions.userId, userId)),
        db.selectDistinct({ id: corrections.experienceId }).from(corrections).where(eq(corrections.userId, userId)),
      ]);
      const used = new Set([...askedIds.map((r) => r.id), ...correctedIds.map((r) => r.id)]);

      const fresh = rows.filter((r) => !used.has(r.id));
      if (fresh.length === 0) {
        skipped += 1;
        continue;
      }

      // 우선순위: explore → is_first_time → memory_score
      const rank = (r: CandidateRow) => (r.outcome === 'explore' ? 0 : r.isFirstTime ? 1 : 2);
      fresh.sort((a, b) => rank(a) - rank(b) || b.memoryScore - a.memoryScore);
      const target = fresh[0];

      const q = questionFor(target);
      await db
        .insert(questions)
        .values({
          userId,
          experienceId: target.id,
          field: q.field,
          modelValue: q.field === 'outcome' ? (target.outcome ?? '') : String(target.isFirstTime),
          text: q.text,
        })
        // (experience_id, field) 유니크 — 재실행이 중복을 만들지 않는다.
        .onConflictDoNothing();

      asked += 1;
    } catch (err) {
      console.error(`[daily-questions] user=${userId} 실패`, err);
    }
  }

  console.log(`[daily-questions] ${asked}명에게 질문 생성, ${skipped}명 건너뜀 (대상 ${byUser.size}명)`);
  console.log('[daily-questions] done');
}
