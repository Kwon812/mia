"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { characters, questions } from "@na/db";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/current-user";
import { recordCorrection, type CorrectionField } from "@/lib/corrections";
import { FIELD_OPTIONS } from "@/lib/labels";

const MIN_NAME_LENGTH = 1;
const MAX_NAME_LENGTH = 12;

export type SetCharacterNameResult = { error?: string };

// Day 0 온보딩 — 사용자가 하는 유일한 행동인 "이름 짓기".
// characters.name/named_at 을 채우고 홈을 다시 그린다.
export async function setCharacterName(name: string): Promise<SetCharacterNameResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { error: "연결이 끊겼어. 다시 연결해줘." };
  }

  const trimmed = name.trim();
  if (trimmed.length < MIN_NAME_LENGTH || trimmed.length > MAX_NAME_LENGTH) {
    return { error: `이름은 ${MIN_NAME_LENGTH}~${MAX_NAME_LENGTH}자로 지어줘.` };
  }

  await db
    .update(characters)
    .set({ name: trimmed, namedAt: new Date() })
    .where(eq(characters.userId, user.userId));

  revalidatePath("/");
  return {};
}

// ============================================================
// 사람 판단(declared) — 이 시스템에 사람의 판정이 들어오는 유일한 통로
// ============================================================

export type CorrectResult = { error?: string };

/**
 * 층 1 — /diary 에서 경험의 판정 칩을 눌러 고친다.
 *
 * experiences 를 UPDATE 하지 않는다. corrections 에 append 하고, 읽을 때
 * 겹쳐서 유효값을 만든다 (lib/corrections.ts 참고). 그래야 (모델 출력,
 * 사람 정답) 쌍이 남고, 재처리(apply-reprocess)도 깨지지 않는다.
 */
export async function correctExperience(
  experienceId: string,
  field: CorrectionField,
  humanValue: string,
): Promise<CorrectResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "연결이 끊겼어. 다시 연결해줘." };

  // 클라이언트가 보내는 값이라 열거값 화이트리스트로 막는다. DB CHECK 가
  // 최후 방어선이지만, 여기서 걸러야 500 이 아니라 사람이 읽는 메시지가 나간다.
  const allowed = FIELD_OPTIONS[field];
  if (!allowed || !allowed.options.some((o) => o.value === humanValue)) {
    return { error: "고를 수 없는 값이야." };
  }

  const result = await recordCorrection({
    userId: user.userId,
    experienceId,
    field,
    humanValue,
    source: "diary",
  });
  if (!result.ok) return { error: result.error };

  revalidatePath("/diary");
  // 홈도 함께 무효화한다. 감정(emotion.ts 의 stuck 3연속 규칙)과 궤도 지도가
  // 교정된 판정을 읽으므로, 여기서 안 비우면 클라이언트 라우터 캐시가 잠시
  // 옛 값을 보여준다 — "고쳤는데 캐릭터가 그대로네"로 보이는 자리다.
  revalidatePath("/");
  return {};
}

/**
 * 층 2 — 캐릭터가 던진 질문에 답한다.
 *
 * questionId 를 함께 넘겨 questions.answered_at 을 채운다. 이게 없으면
 * "물었는데 답이 없었다"(침묵)와 "안 물었다"가 구분되지 않는다.
 */
export async function answerQuestion(
  questionId: string,
  humanValue: string,
): Promise<CorrectResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "연결이 끊겼어. 다시 연결해줘." };

  const [q] = await db
    .select({ experienceId: questions.experienceId, field: questions.field })
    .from(questions)
    .where(and(eq(questions.id, questionId), eq(questions.userId, user.userId)))
    .limit(1);
  if (!q) return { error: "그 질문을 찾을 수 없어." };

  const allowed = FIELD_OPTIONS[q.field];
  if (!allowed.options.some((o) => o.value === humanValue)) {
    return { error: "고를 수 없는 값이야." };
  }

  const result = await recordCorrection({
    userId: user.userId,
    experienceId: q.experienceId,
    field: q.field,
    humanValue,
    source: "ask",
    questionId,
  });
  if (!result.ok) return { error: result.error };

  revalidatePath("/");
  return {};
}

/**
 * 질문을 넘긴다("모르겠어").
 *
 * 침묵과 **다르게** 기록한다. 침묵은 대개 안 본 것이지만, 넘김은
 * "봤는데 답할 수 없다"는 정보다 — 둘을 같이 세면 무응답률이 왜곡된다.
 */
export async function dismissQuestion(questionId: string): Promise<CorrectResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "연결이 끊겼어. 다시 연결해줘." };

  await db
    .update(questions)
    .set({ dismissedAt: new Date() })
    .where(and(eq(questions.id, questionId), eq(questions.userId, user.userId)));

  revalidatePath("/");
  return {};
}
