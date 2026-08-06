import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';
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

/** 교정이 있으면 그 값, 없으면 모델 값. declared > inferred 를 여기서 집행한다. */
export function effective<T extends string>(
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
  // 모델 값과 같은 값을 고른 것은 교정이 아니라 **확인**이다. 그래도 기록한다 —
  // "사람이 보고 맞다고 했다"는 positive 라벨이고, 침묵과 구분되어야 한다.
  await db.insert(corrections).values({
    userId: params.userId,
    experienceId: params.experienceId,
    field: params.field,
    modelValue,
    humanValue: params.humanValue,
    source: params.source,
    questionId: params.questionId ?? null,
  });

  if (params.questionId) {
    await db
      .update(questions)
      .set({ answeredAt: new Date() })
      .where(and(eq(questions.id, params.questionId), eq(questions.userId, params.userId)));
  }

  return { ok: true };
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
