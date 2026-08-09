"use server";

import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { characters, experiences, memories, procedures, questions, threads } from "@na/db";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/current-user";
import { recordCorrection, type CorrectionField } from "@/lib/corrections";
import { memoryImportance } from "@/lib/memory-score";
import { recheckMemoryAfterCorrection } from "@/lib/memory-recheck";
import { FIELD_OPTIONS, isChipField } from "@/lib/labels";
import { mergeThreads, moveExperience, renameThread } from "@/lib/thread-correction";

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
  //
  // thread 는 여기로 오지 않는다 — 선택지가 사용자의 갈래 목록이라 고정 표가
  // 없고, 옮기기는 experiences.thread_id 까지 건드려야 해서 경로가 다르다.
  // (갈래 교정은 지도의 전용 액션이 처리한다)
  if (!isChipField(field)) {
    return { error: "이 방식으로는 고칠 수 없는 항목이야." };
  }
  const allowed = FIELD_OPTIONS[field];
  if (!allowed.options.some((o) => o.value === humanValue)) {
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

  // 고친 값으로 기억 조건을 다시 본다. memory_score 는 엔진이 그때 계산해
  // 저장한 값이라, 교정만으로는 안 움직였다 — is_first_time 을 true 로 바꾸면
  // +40 이라 20점짜리가 60을 넘는데 아무 일도 안 일어났다.
  // 실패해도 교정 자체는 남아야 하므로 삼킨다.
  try {
    await recheckMemoryAfterCorrection(user.userId, experienceId);
  } catch (err) {
    console.error("[correctExperience] 기억 재판정 실패", experienceId, err);
  }

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

  // 캐릭터는 갈래를 묻지 않는다 — 선택지가 열일곱 개짜리 갈래 목록이라
  // 물음으로 성립하지 않는다. questions.field 에 thread 가 들어올 일은
  // 없지만, DB CHECK 가 허용하는 값이므로 여기서 좁힌다.
  if (!isChipField(q.field)) {
    return { error: "이 방식으로는 답할 수 없는 질문이야." };
  }
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

  // /diary 교정과 같은 값이 들어온다. 캐릭터가 물어서 답한 것도 declared 이므로
  // 기억 조건을 똑같이 다시 본다 — 여기만 빠뜨리면 "물어봐서 답했는데 아무
  // 일도 안 일어난다"가 된다.
  try {
    await recheckMemoryAfterCorrection(user.userId, q.experienceId);
  } catch (err) {
    console.error("[answerQuestion] 기억 재판정 실패", q.experienceId, err);
  }

  revalidatePath("/");
  revalidatePath("/memories");
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

/**
 * 갈래를 완결로 표시한다 — 사람이 직접.
 *
 * 완결은 모델이 못 맞히는 값이다. 브라우징 기록은 "무엇을 했나"를 말하는데
 * 완결은 "더 할 게 없다"는 판단이라, 안 한 일에 대한 진술이어서 기록에 흔적이
 * 없다. 실제로 역대 LLM 호출 75회 중 completed=true 가 **한 번도** 나온 적이
 * 없고, 프롬프트가 완결 예시로 못 박은 세션("배포가 끝나 동작을 확인했다")을
 * 그대로 재현해 넣어도 false 였다.
 *
 * 그래서 이 값은 inferred 가 아니라 declared 다(lib/assertion.ts 의 위계).
 * 모델은 계속 false 를 뱉게 두고, 사람이 말할 때만 확정한다.
 *
 * 엔진이 completed 를 낼 때와 **같은 일**을 한다 — 상태만 바꾸고 기억을 안
 * 만들면 같은 완결인데 결과가 갈린다.
 */
export async function completeThread(threadId: string): Promise<CorrectResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "연결이 끊겼어. 다시 연결해줘." };

  const [thread] = await db
    .select()
    .from(threads)
    .where(and(eq(threads.id, threadId), eq(threads.userId, user.userId)));
  if (!thread) return { error: "없는 갈래야." };
  // 이미 끝났거나 놓은 것은 건드리지 않는다. 두 번 누르면 기억이 둘 생긴다.
  if (thread.status !== "active") return { error: "이미 진행 중이 아니야." };

  // 완결의 근거가 되는 경험 = 그 갈래의 마지막 경험. 기억의 occurred_at 과
  // 본문이 여기서 나온다 — 엔진도 "이번 세션의 경험"을 같은 자리에 쓴다.
  const [last] = await db
    .select()
    .from(experiences)
    .where(and(eq(experiences.threadId, threadId), eq(experiences.userId, user.userId)))
    .orderBy(desc(experiences.occurredAt))
    .limit(1);
  if (!last) return { error: "이 갈래엔 경험이 없어." };

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(threads)
      .set({ status: "completed", completedAt: now })
      .where(eq(threads.id, threadId));

    // 그 갈래에 기억이 이미 있으면 새로 만들지 않고 근거를 더한다 —
    // 갈래당 기억은 하나다(uq_memories_thread). 엔진과 같은 규칙이라야
    // 사람이 누른 것과 모델이 만든 것이 같은 모양으로 쌓인다.
    const [existing] = await tx
      .select({ id: memories.id, experienceIds: memories.experienceIds, triggers: memories.triggers, importance: memories.importance })
      .from(memories)
      .where(and(eq(memories.userId, user.userId), eq(memories.threadId, threadId), isNull(memories.forgottenAt)))
      .limit(1);

    if (existing) {
      const ids = existing.experienceIds.includes(last.id)
        ? existing.experienceIds
        : [...existing.experienceIds, last.id];
      const scores = await tx
        .select({ s: experiences.memoryScore })
        .from(experiences)
        .where(inArray(experiences.id, ids));
      await tx
        .update(memories)
        .set({
          experienceIds: ids,
          triggers: existing.triggers.includes("thread_complete")
            ? existing.triggers
            : [...existing.triggers, "thread_complete"],
          // 더하지 않고 다시 잰다 — 엔진과 같은 규칙이라야 사람이 누른 것과
          // 모델이 만든 것이 같은 크기로 보인다.
          importance: memoryImportance({
            evidenceScores: scores.map((r) => r.s),
            threadExperienceCount: thread.experienceCount,
          }),
          needsResummary: true,
        })
        .where(eq(memories.id, existing.id));
    } else {
      await tx.insert(memories).values({
        userId: user.userId,
        threadId,
        experienceId: last.id,
        experienceIds: [last.id],
        occurredAt: last.occurredAt,
        // 제목은 갈래 이름만. 엔진의 완결 기억과 같은 규칙이다.
        title: thread.title,
        body: last.detail ?? last.summary,
        importance: memoryImportance({
          evidenceScores: [last.memoryScore],
          threadExperienceCount: thread.experienceCount,
        }),
        trigger: "thread_complete",
        triggers: ["thread_complete"],
      });
    }
  });

  // 기억이 하나 늘었으니 지도를 다시 그려야 한다. 그 별은 이제 밝아진다.
  revalidatePath("/");
  revalidatePath("/memories");
  return {};
}

// ============================================================
// 갈래 교정 — 지도에서 직접 고친다
//
// 왜 지도인가. 갈래는 선택지가 사용자의 갈래 목록이라 일기의 칩으로도,
// 캐릭터의 물음으로도 못 다룬다("갈래가 A 야 B 야 … 열일곱 개 중에?").
// 대상을 눈으로 보고 집는 화면이 필요하고, 그게 지도다.
//
// 왜 필요한가. 통제된 시험(40세션 × 3회)에서 쌍 F1 54.3% 였고, 오라클
// 시험이 이유를 답했다 — 갈래 목록만 올바르면 프롬프트를 안 고쳐도 89.2%다.
// 남은 30pt 는 사람이 고쳐야 온다. (docs/HANDOFF-attach.md)
//
// 실제 판정과 트랜잭션은 lib/thread-correction.ts 가 한다. 여기는 인증과
// 화면 갱신만 맡는다.
// ============================================================

export type ThreadFixResult = { ok: true; effects: string[] } | { ok: false; error: string };

/** 갈래 교정 뒤 다시 그려야 하는 화면들. 지도·기억·일기가 같은 데이터를 본다. */
function revalidateAfterFix(): void {
  revalidatePath("/");
  revalidatePath("/memories");
  revalidatePath("/diary");
}

/** 경험 하나를 다른 갈래로 옮긴다. 대상이 없으면 새로 만든다. */
export async function moveExperienceToThread(
  experienceId: string,
  target: { kind: "existing"; threadId: string } | { kind: "new"; title: string },
): Promise<ThreadFixResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "연결이 끊겼어. 다시 연결해줘." };

  const r = await moveExperience({ userId: user.userId, experienceId, target });
  if (!r.ok) return r;
  revalidateAfterFix();
  return { ok: true, effects: r.effects };
}

/** 갈래 둘을 합친다 — 붙어야 할 것이 갈라져 있을 때. */
export async function mergeThreadInto(
  fromThreadId: string,
  intoThreadId: string,
): Promise<ThreadFixResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "연결이 끊겼어. 다시 연결해줘." };

  const r = await mergeThreads({ userId: user.userId, fromThreadId, intoThreadId });
  if (!r.ok) return r;
  revalidateAfterFix();
  return { ok: true, effects: r.effects };
}

/** 갈래 이름만 고친다 — 이름이 활동이지 대상이 아닐 때. */
export async function renameThreadTitle(
  threadId: string,
  title: string,
): Promise<ThreadFixResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "연결이 끊겼어. 다시 연결해줘." };

  const r = await renameThread({ userId: user.userId, threadId, title });
  if (!r.ok) return r;
  revalidateAfterFix();
  return { ok: true, effects: r.effects };
}

// ============================================================
// 되풀이한 절차 — 사람이 답한다
//
// 코드가 답할 수 없는 질문이 하나 남아서다: **자동화할 값어치가 있나.**
// 반복 횟수도, 단계 수도, 무엇을 바꾸는지도 전부 관측에서 나오지만
// 귀찮음은 관측되지 않는다. 클릭 열두 번짜리인데 재밌어할 수도 있고,
// 세 번짜리인데 하기 싫어 미룰 수도 있다.
//
// 승인은 **단계를 얼린다.** 이후 계산이 그 행을 안 건드린다 — 매번 다시
// 계산하면 승인한 뒤에 그 절차를 조금 다르게 한 번 하는 것만으로 스킬이
// 몰래 바뀐다.
// ============================================================

export type ProcedureResult = { ok: true } | { ok: false; error: string };

async function answerProcedure(
  signature: string,
  status: "approved" | "rejected",
  extra: { name?: string; steps?: unknown; mutates?: boolean },
): Promise<ProcedureResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "연결이 끊겼어. 다시 연결해줘." };
  if (!signature) return { ok: false, error: "어떤 절차인지 모르겠어." };

  await db
    .insert(procedures)
    .values({
      userId: user.userId,
      signature,
      status,
      name: extra.name?.trim() || null,
      steps: extra.steps ?? [],
      mutates: extra.mutates ?? false,
    })
    // 마음이 바뀌면 덮어쓴다. 승인 이력을 남기지 않는 이유 — 교정과 달리
    // 여기서 배울 것이 없다. 절차는 맞거나 아니거나지, 사람이 무엇을 두 번
    // 뒤집었는지가 다음 판정을 바꾸지 않는다.
    .onConflictDoUpdate({
      target: [procedures.userId, procedures.signature],
      set: {
        status,
        name: extra.name?.trim() || null,
        steps: extra.steps ?? [],
        mutates: extra.mutates ?? false,
      },
    });

  revalidatePath("/procedures");
  return { ok: true };
}

/** 절차로 인정한다. 이 시점의 단계가 얼어붙는다. */
export async function approveProcedure(
  signature: string,
  name: string,
  steps: unknown,
  mutates: boolean,
): Promise<ProcedureResult> {
  if (!name.trim()) return { ok: false, error: "이름을 지어줘." };
  return answerProcedure(signature, "approved", { name, steps, mutates });
}

/** 자동화할 값어치가 없다. 다시 안 묻는다. */
export async function rejectProcedure(signature: string): Promise<ProcedureResult> {
  return answerProcedure(signature, "rejected", {});
}

/** 답한 것을 무른다 — 후보 목록에 다시 올라온다. */
export async function forgetProcedureAnswer(signature: string): Promise<ProcedureResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "연결이 끊겼어. 다시 연결해줘." };
  await db
    .delete(procedures)
    .where(and(eq(procedures.userId, user.userId), eq(procedures.signature, signature)));
  revalidatePath("/procedures");
  return { ok: true };
}
