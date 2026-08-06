// daily-questions: 층 2 — 캐릭터가 사용자에게 하루 두 가지를 묻는다.
//
// 층 1(/diary 판정 칩)이 "훑다가 눈에 띄면 고친다"라면, 이건 **모델이 제일
// 자신 없는 자리를 골라 먼저 묻는** 경로다. 무작위 라벨보다 정보량이 크다.
//
// LLM 을 쓰지 않는다. 질문 문장은 경험 요약을 끼운 템플릿이고, 후보 선정은
// 규칙 기반이다 — 야간 배치의 LLM 호출은 일기 하나로 유지한다.
//
// 홈 화면(apps/web/src/app/page.tsx)이 이 결과를 읽기만 한다. 질문 생성을
// 페이지 렌더에 두면 서버 컴포넌트가 매 렌더마다 쓰기를 하게 되고, "하루 N건"
// 이라는 예산을 렌더 횟수가 좌우하게 된다.

import { and, desc, eq, gte, isNull } from 'drizzle-orm';
import { corrections, experiences, questions, sessions, type Db } from '@na/db';
import { categoryLabel } from '@na/shared';
import { diaryTargetKst, kstDayIndex, DAY_MS } from '../kst';

/** 후보로 볼 기간. 2주 전 판정을 물으면 사용자가 기억을 못 해서
 *  답이 추측이 된다 — 그건 declared 가 아니라 또 다른 inferred 다. */
const CANDIDATE_WINDOW_DAYS = 3;

/** 하루 예산. 둘을 한꺼번에 들이밀지 않는다 — 홈은 열린 질문 중 하나만 보여주고,
 *  답하면 다음 것이 나타난다. 답할수록 대화가 이어지는 리듬이 된다. */
const DAILY_BUDGET = 2;

/** 동시에 열어둘 수 있는 질문 수. 답 안 한 게 쌓이면 사용자는 전부 무시하게 되고,
 *  그러면 침묵률만 올라간다. */
const MAX_OPEN = 2;

/** 미답변 질문을 "열린 것"으로 세는 기간. 지나면 침묵으로 확정하고 다음으로
 *  넘어간다 (행은 그대로 남아 무응답 자체가 기록된다). */
const OPEN_QUESTION_TTL_HOURS = 36;

type Field = 'outcome' | 'category' | 'is_first_time';

/**
 * 필드 로테이션 — **이게 없으면 category 는 영원히 차례가 안 온다.**
 *
 * 실측(12건)에서 outcome='explore' 가 절반이었다. 순위표 하나로 세 필드를
 * 겨루게 하면 explore 대기열이 비지 않아 나머지 필드가 굶는다. 날짜로 짝을
 * 고정해 세 필드가 3일 중 2일씩 돌아가게 한다.
 */
const FIELD_ROTATION: Field[][] = [
  ['outcome', 'category'],
  ['category', 'is_first_time'],
  ['is_first_time', 'outcome'],
];

interface CandidateRow {
  id: string;
  userId: string;
  summary: string;
  category: string;
  outcome: string | null;
  isFirstTime: boolean;
  memoryScore: number;
  /** 세션의 도메인 사전 판정. 모델이 이걸 뒤집었는지 보는 데 쓴다. */
  primaryCategory: string;
}

/**
 * 필드별 후보 순위. 숫자가 작을수록 먼저 묻는다. null 이면 그 필드의 후보가
 * 아니다(예: 이미 사람이 손댈 이유가 없는 값).
 *
 * **모델이 준 확신도가 아니다.** Haiku 는 logprob 을 안 주고, 자기보고
 * confidence 는 보정이 안 돼 오히려 더 나쁘다. 대신 프롬프트가 "판단이 안 설 때
 * 쓰는 값"이라고 직접 규정한 자리와, 실측에서 흔들린 자리를 쓴다.
 */
function rankFor(field: Field, row: CandidateRow): number | null {
  switch (field) {
    case 'outcome':
      // explore 는 프롬프트가 "도망가지 마라"라고 못박은 값이다.
      // 실측 v3 주석: 6건 중 5건이 explore 로 쏠렸다.
      return row.outcome === 'explore' ? 0 : 1;

    case 'is_first_time':
      // v2 까지 거의 안 나오다가 v3 에서 기준을 완화한 값이라 아직 불안정하다.
      // true 쪽이 새로 생긴 판정이라 검증 가치가 크다.
      return row.isFirstTime ? 0 : 1;

    case 'category':
      // 0) 정의상 "모르겠다"인 값. 프롬프트 원문:
      //      etc    — "위 어디에도 안 들어간다. 마지막 수단이다"
      //      search — "무엇을 했는지 말할 수 없을 때만 쓴다"
      if (row.category === 'etc' || row.category === 'search') return 0;
      // 1) 모델이 도메인 사전을 뒤집었다 — 적극적으로 판단한 자리라 틀릴 여지가 크다.
      //    실측 2/12(17%) 로 드물어서 예산을 잡아먹지 않는다.
      if (row.category !== row.primaryCategory) return 1;
      // 2) dev↔study 경계. 실측 10/12 가 dev 라 단독 신호로는 너무 넓지만,
      //    마지막 폴백이라 위 둘이 비었을 때만 걸린다. eval 도 이 경계를
      //    별도 케이스로 둘 만큼 흔들리는 자리다.
      if (row.category === 'dev' || row.category === 'study') return 2;
      return 3;
  }
}

/** 캐릭터가 던지는 문장. 필드마다 어감이 다르다 — 같은 틀이 반복되면
 *  대화가 아니라 폼으로 읽히기 시작한다. */
function questionText(field: Field, row: CandidateRow): string {
  const s = row.summary;
  switch (field) {
    case 'outcome':
      return row.outcome === 'explore'
        ? `"${s}" — 이거 결국 어떻게 됐어? 나는 그냥 둘러본 걸로 적어놨는데 맞아?`
        : `"${s}" — 이건 잘 풀린 걸로 기억하는데, 맞아?`;
    case 'is_first_time':
      return row.isFirstTime
        ? `"${s}" — 이거 처음 해본 거 맞지? 그렇게 적어뒀어.`
        : `"${s}" — 이건 늘 하던 거라고 봤는데, 처음이었어?`;
    case 'category':
      return `"${s}" — 이거 ${categoryLabel(row.category)} 쪽 일로 적어놨어. 맞아?`;
  }
}

function modelValueOf(field: Field, row: CandidateRow): string {
  if (field === 'outcome') return row.outcome ?? '';
  if (field === 'category') return row.category;
  return String(row.isFirstTime);
}

export async function generateDailyQuestions(db: Db): Promise<void> {
  console.log('[daily-questions] start');

  const now = Date.now();
  const since = new Date(now - CANDIDATE_WINDOW_DAYS * DAY_MS);
  const openCutoff = new Date(now - OPEN_QUESTION_TTL_HOURS * 60 * 60 * 1000);
  // "하루 N건" 예산의 경계. 일기와 같은 하루(KST 새벽 4시)를 쓴다 —
  // 다른 경계를 쓰면 "오늘 일기"와 "오늘 질문"이 가리키는 날이 어긋난다.
  const { start: dayStart } = diaryTargetKst();

  // 오늘의 필드 짝. 날짜에서 결정론적으로 나오므로 재실행해도 같은 짝이다.
  // kstDayIndex 는 그 하루의 자정 UTC 밀리초라, DAY_MS 로 나누면 정수 일수다.
  const dayNumber = kstDayIndex(new Date(now)) / DAY_MS;
  const todayFields = FIELD_ROTATION[dayNumber % FIELD_ROTATION.length];

  const candidates: CandidateRow[] = await db
    .select({
      id: experiences.id,
      userId: experiences.userId,
      summary: experiences.summary,
      category: experiences.category,
      outcome: experiences.outcome,
      isFirstTime: experiences.isFirstTime,
      memoryScore: experiences.memoryScore,
      primaryCategory: sessions.primaryCategory,
    })
    .from(experiences)
    .innerJoin(sessions, eq(sessions.id, experiences.sessionId))
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
      // 오늘 이미 쓴 예산과, 지금 열려 있는 질문 수를 함께 본다.
      // 앞의 것이 없으면 배치 재실행이 그날 질문을 늘리고(실측으로 잡힌 버그),
      // 뒤의 것이 없으면 안 답한 질문이 무한정 쌓인다.
      const [todayRows, openRows] = await Promise.all([
        db
          .select({ id: questions.id })
          .from(questions)
          .where(and(eq(questions.userId, userId), gte(questions.askedAt, dayStart))),
        db
          .select({ id: questions.id })
          .from(questions)
          .where(
            and(
              eq(questions.userId, userId),
              isNull(questions.answeredAt),
              isNull(questions.dismissedAt),
              gte(questions.askedAt, openCutoff),
            ),
          ),
      ]);

      const budget = Math.min(DAILY_BUDGET - todayRows.length, MAX_OPEN - openRows.length);
      if (budget <= 0) {
        skipped += 1;
        continue;
      }

      // 이미 물어본 경험과 이미 사람이 고친 경험은 제외한다. 전자는 중복이고
      // 후자는 답이 이미 나온 것이다 — 둘 다 그날치 예산을 낭비한다.
      const [askedIds, correctedIds] = await Promise.all([
        db.select({ id: questions.experienceId }).from(questions).where(eq(questions.userId, userId)),
        db.selectDistinct({ id: corrections.experienceId }).from(corrections).where(eq(corrections.userId, userId)),
      ]);
      const used = new Set([...askedIds.map((r) => r.id), ...correctedIds.map((r) => r.id)]);

      let made = 0;
      for (const field of todayFields) {
        if (made >= budget) break;

        const pool = rows
          .filter((r) => !used.has(r.id))
          .map((r) => ({ row: r, rank: rankFor(field, r) }))
          .filter((x): x is { row: CandidateRow; rank: number } => x.rank !== null)
          .sort((a, b) => a.rank - b.rank || b.row.memoryScore - a.row.memoryScore);

        const target = pool[0]?.row;
        if (!target) continue;

        await db
          .insert(questions)
          .values({
            userId,
            experienceId: target.id,
            field,
            modelValue: modelValueOf(field, target),
            text: questionText(field, target),
          })
          // (experience_id, field) 유니크 — 재실행이 중복을 만들지 않는다.
          .onConflictDoNothing();

        // 같은 경험에 두 질문을 몰지 않는다. 한 경험을 두 번 물으면
        // "얘는 이거밖에 기억 못 하나" 처럼 읽힌다.
        used.add(target.id);
        made += 1;
      }

      if (made === 0) skipped += 1;
      else asked += made;
    } catch (err) {
      console.error(`[daily-questions] user=${userId} 실패`, err);
    }
  }

  console.log(
    `[daily-questions] 필드=${todayFields.join(',')} · 질문 ${asked}건 생성, ${skipped}명 건너뜀 (대상 ${byUser.size}명)`,
  );
  console.log('[daily-questions] done');
}
