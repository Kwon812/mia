import 'server-only';

import { and, desc, eq, inArray } from 'drizzle-orm';
import { corrections, experiences, questions, type CORRECTION_FIELDS } from '@na/db';
import { db } from './db';

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

/** 모델이 낸 값을 문자열로 통일한다. is_first_time 은 boolean 이라 'true'/'false' 로 눕힌다. */
export function modelValueOf(
  row: { outcome: string | null; category: string; isFirstTime: boolean },
  field: CorrectionField,
): string {
  switch (field) {
    case 'outcome':
      return row.outcome ?? '';
    case 'category':
      return row.category;
    case 'is_first_time':
      return String(row.isFirstTime);
  }
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
    })
    .from(experiences)
    .where(and(eq(experiences.id, params.experienceId), eq(experiences.userId, params.userId)))
    .limit(1);

  if (!row) return { ok: false, error: '그 경험을 찾을 수 없어.' };

  const modelValue = modelValueOf(row, params.field);

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
