// ============================================================
// 갈래 교정 — 사람이 지도에서 경험을 옮긴다.
//
// 왜 필요한가. 모델은 세션이 올 때마다 "지금까지 본 것"만으로 되돌릴 수 없는
// 배정을 한다. 그래서 초반 오판 하나가 남은 전부를 끌고 간다 — 통제된 시험
// (40세션 × 3회)에서 쌍 F1 54.3%, 정밀도 43% 였고, 가장 큰 갈래는 언제나
// 가장 먼저 만들어진 갈래였다. 프롬프트로 고치려는 시도 여섯 개가 전부 잡음
// 안에서 죽었고, 오라클 시험이 이유를 답했다: 갈래 목록만 올바르면 프롬프트를
// 하나도 안 고쳐도 89.2% 다. 남은 여지가 11% 뿐이라 나머지 30pt 는 사람이
// 목록을 고쳐야 온다. (docs/HANDOFF-attach.md)
//
// ── 옮기기가 만드는 상태와 그 규칙 ──
//
// 경험이 갈래를 **떠나는** 상태는 엔진 경로에 없어서, 이 기능은 한 번
// 만들었다 버려졌었다(20260808000002). 미정의가 다섯 개였기 때문이다.
// 규칙 다섯 개가 아니라 원칙 하나로 답한다:
//
//   ▶ 기억은 근거에 대한 **현재 판정**이다. 옮길 때 양쪽 갈래를 다시 판정한다.
//     근거가 조건을 넘으면 기억, 아니면 그냥 갈래다.
//
//   출발 — 조건을 못 넘게 된 트리거를 뺀다. 배열이 비면 기억을 지운다(강등).
//   도착 — 새로 넘는 트리거가 생기면, 기억이 없으면 만들고 있으면 배열에 더한다.
//          (uq_memories_thread — 갈래당 기억은 하나다)
//
// 대칭이 중요하다. 강등만 있고 승격이 없으면 실수로 옮겼다 되돌려도 기억이
// 안 살아난다.
//
// ── 두 종류의 트리거 ──
//
// deepened 는 **갈래 경험 수**(6건)로 발동하고, 나머지(new_skill·breakthrough·
// revival·comeback)는 **개별 경험의 점수**로 발동한다. 그래서 재판정 방식이
// 다르다 — 앞의 것은 세면 되고, 뒤의 것은 그 경험이 아직 이 갈래에 있는지
// 보면 된다. 점수는 experiences.memory_score 에 저장된 값을 쓴다. 다시 재지
// 않는다 — 그건 발화 시점의 판정이다.
//
// thread_complete 는 사람이 직접 표시한 것이라 옮기기와 무관하다. 건드리지 않는다.
// ============================================================

import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { corrections, experiences, memories, threads } from '@na/db';
import { db } from './db';
import {
  DEEPENED_THREAD_EXPERIENCES,
  MEMORY_SCORE_THRESHOLD,
  memoryImportance,
} from './memory-score';

/** 갈래 경험 수로 발동하는 트리거 — 세어서 판정한다. */
const COUNT_TRIGGERS = new Set(['deepened']);
/** 사람이 직접 붙인 것 — 옮기기가 건드리지 않는다. */
const HUMAN_TRIGGERS = new Set(['thread_complete']);

export type MoveTarget =
  /** 이미 있는 갈래로 */
  | { kind: 'existing'; threadId: string }
  /** 새 갈래를 만들어서 — 제목은 사람이 짓는다 */
  | { kind: 'new'; title: string };

export type MoveResult =
  | {
      ok: true;
      /** 옮겨간 갈래 */
      threadId: string;
      /** 사람이 볼 결과 — 무엇이 달라졌는지 */
      effects: string[];
    }
  | { ok: false; error: string };

/**
 * 경험 하나를 다른 갈래로 옮긴다.
 *
 * 트랜잭션 하나로 끝낸다. 중간에 실패하면 아무것도 안 바뀌어야 한다 —
 * thread_id 만 옮기고 기억 판정이 실패하면 근거 없는 기억이 남는다.
 */
export async function moveExperience(params: {
  userId: string;
  experienceId: string;
  target: MoveTarget;
}): Promise<MoveResult> {
  const { userId, experienceId, target } = params;

  if (target.kind === 'new' && !target.title.trim()) {
    return { ok: false, error: '갈래 이름을 적어줘.' };
  }

  return db.transaction(async (tx) => {
    // 소유권 확인 — experienceId 는 클라이언트가 보내는 값이다.
    const [exp] = await tx
      .select({
        id: experiences.id,
        threadId: experiences.threadId,
        category: experiences.category,
        occurredAt: experiences.occurredAt,
        summary: experiences.summary,
        detail: experiences.detail,
        memoryScore: experiences.memoryScore,
      })
      .from(experiences)
      .where(and(eq(experiences.id, experienceId), eq(experiences.userId, userId)))
      .limit(1);

    if (!exp) return { ok: false as const, error: '그 경험을 찾을 수 없어.' };

    const fromThreadId = exp.threadId;

    // 목적지를 정한다.
    let toThreadId: string;
    let toTitle: string;
    if (target.kind === 'existing') {
      const [dst] = await tx
        .select({ id: threads.id, title: threads.title })
        .from(threads)
        .where(and(eq(threads.id, target.threadId), eq(threads.userId, userId)))
        .limit(1);
      if (!dst) return { ok: false as const, error: '그 갈래를 찾을 수 없어.' };
      toThreadId = dst.id;
      toTitle = dst.title;
    } else {
      const [created] = await tx
        .insert(threads)
        .values({
          userId,
          title: target.title.trim(),
          category: exp.category,
          startedAt: exp.occurredAt,
          lastActivityAt: exp.occurredAt,
          experienceCount: 0, // 아래에서 다시 센다
        })
        .returning({ id: threads.id, title: threads.title });
      toThreadId = created.id;
      toTitle = created.title;
    }

    if (fromThreadId === toThreadId) {
      return { ok: false as const, error: '이미 그 갈래에 있어.' };
    }

    // 옮기기 전 갈래 제목을 박제한다. corrections 의 model_value 는 사본이어야
    // 한다 — 재구축으로 갈래가 다시 깔려도 "모델이 뭐라고 했었는지"가 남아야
    // (모델 출력, 사람 정답) 쌍이 보존된다.
    let fromTitle = '(갈래 없음)';
    if (fromThreadId) {
      const [src] = await tx
        .select({ title: threads.title })
        .from(threads)
        .where(eq(threads.id, fromThreadId))
        .limit(1);
      if (src) fromTitle = src.title;
    }

    // ── 옮긴다 ──
    await tx
      .update(experiences)
      .set({ threadId: toThreadId })
      .where(eq(experiences.id, experienceId));

    // human_value 가 id 가 아니라 **제목**인 이유: 재구축이 threads 를 통째로
    // 다시 만들어 uuid 가 매번 새로 발급된다. 제목으로 두면 재구축 때 그
    // 제목의 갈래를 찾고, 없으면 만들어서 다시 잇는다 — 사람이 "이건 저
    // 갈래다"라고 말한 것은 그 갈래가 있어야 한다는 선언이기도 하다.
    await tx.insert(corrections).values({
      userId,
      experienceId,
      field: 'thread',
      modelValue: fromTitle,
      humanValue: toTitle,
      source: 'map',
    });

    const effects: string[] = [];

    // ── 양쪽 갈래를 다시 센다 ──
    const toCount = await recountThread(tx, toThreadId);
    const fromCount = fromThreadId ? await recountThread(tx, fromThreadId) : 0;

    // ── 출발 갈래의 기억을 다시 판정한다 ──
    if (fromThreadId) {
      const demoted = await reevaluateMemory(tx, {
        userId,
        threadId: fromThreadId,
        threadExperienceCount: fromCount,
        removedExperienceId: experienceId,
      });
      if (demoted) effects.push(`「${fromTitle}」의 기억이 갈래로 돌아갔어`);
      else if (fromCount === 0) effects.push(`「${fromTitle}」이 비었어`);

      // 빈 갈래는 지운다. 기억이 가리키고 있으면 FK 가 막으므로 남는다 —
      // DB 가 이미 "기억의 닻은 지울 수 없다"를 강제한다.
      if (fromCount === 0) {
        await tx
          .delete(threads)
          .where(eq(threads.id, fromThreadId))
          .catch(() => undefined);
      }
    }

    // ── 도착 갈래의 기억을 다시 판정한다 ──
    const promoted = await promoteIfEarned(tx, {
      userId,
      threadId: toThreadId,
      threadExperienceCount: toCount,
      experience: exp,
    });
    if (promoted === 'created') effects.push(`「${toTitle}」이 기억이 됐어`);
    else if (promoted === 'appended') effects.push(`「${toTitle}」의 기억에 근거가 더해졌어`);

    return { ok: true as const, threadId: toThreadId, effects };
  });
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * 갈래의 경험 수와 분야를 다시 센다.
 *
 * experience_count 는 엔진이 붙일 때마다 +1 하는 값이라, 경험이 떠나면
 * 어긋난다. 세는 게 맞다 — 이 값이 곧 deepened 판정이다.
 * 분야도 다시 고른다: 갈래의 category 는 "연 첫 경험의 판정"이 아니라
 * "지금까지 무엇을 한 작업인가"여야 한다(엔진과 같은 규칙).
 */
async function recountThread(tx: Tx, threadId: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(experiences)
    .where(eq(experiences.threadId, threadId));
  const n = row?.n ?? 0;

  await tx
    .update(threads)
    .set({
      experienceCount: n,
      category: sql`coalesce((
        select e.category from ${experiences} e
        where e.thread_id = ${threadId}
        group by e.category
        order by count(*) desc, e.category asc
        limit 1
      ), ${threads.category})`,
      lastActivityAt: sql`coalesce((
        select max(e.occurred_at) from ${experiences} e
        where e.thread_id = ${threadId}
      ), ${threads.lastActivityAt})`,
    })
    .where(eq(threads.id, threadId));

  return n;
}

/**
 * 출발 갈래의 기억을 다시 판정한다. 강등되면 true.
 *
 * 근거가 줄어 조건을 못 넘게 된 트리거를 뺀다. 배열이 비면 기억을 지운다 —
 * 근거 없는 기억은 기억이 아니라 그냥 갈래다.
 */
async function reevaluateMemory(
  tx: Tx,
  args: {
    userId: string;
    threadId: string;
    threadExperienceCount: number;
    removedExperienceId: string;
  },
): Promise<boolean> {
  const [mem] = await tx
    .select({
      id: memories.id,
      experienceIds: memories.experienceIds,
      triggers: memories.triggers,
    })
    .from(memories)
    .where(
      and(
        eq(memories.userId, args.userId),
        eq(memories.threadId, args.threadId),
        isNull(memories.forgottenAt),
      ),
    )
    .limit(1);

  if (!mem) return false;

  const ids = mem.experienceIds.filter((id) => id !== args.removedExperienceId);

  // 트리거마다 아직 성립하는지 본다.
  const kept = mem.triggers.filter((t) => {
    if (HUMAN_TRIGGERS.has(t)) return true; // 사람이 붙인 건 안 건드린다
    if (COUNT_TRIGGERS.has(t)) return args.threadExperienceCount >= DEEPENED_THREAD_EXPERIENCES;
    return ids.length > 0; // 경험에 매인 트리거 — 근거가 남아 있어야 성립
  });

  // 근거가 0건이거나 이유가 하나도 안 남으면 강등이다.
  if (ids.length === 0 || kept.length === 0) {
    await tx.delete(memories).where(eq(memories.id, mem.id));
    return true;
  }

  await tx
    .update(memories)
    .set({
      experienceIds: ids,
      triggers: kept,
      // 근거가 바뀌었으니 제목·본문을 다시 뽑아야 한다. 여기서 LLM 을 부르지
      // 않는다 — 옮기기는 사람이 지도에서 하는 즉각적인 동작이라 기다리게
      // 하면 안 되고, 밤 배치가 이미 이 깃발을 보고 다시 요약한다.
      needsResummary: true,
      importance: await importanceOf(tx, ids, args.threadExperienceCount),
    })
    .where(eq(memories.id, mem.id));

  return false;
}

/**
 * 도착 갈래가 기억 조건을 넘는지 본다.
 *
 * 넘으면 기억을 만들거나(없을 때) 트리거를 더한다(있을 때).
 * 못 넘으면 아무 일도 일어나지 않는다 — 그냥 갈래다.
 */
async function promoteIfEarned(
  tx: Tx,
  args: {
    userId: string;
    threadId: string;
    threadExperienceCount: number;
    experience: {
      id: string;
      occurredAt: Date;
      summary: string;
      detail: string | null;
      memoryScore: number;
    };
  },
): Promise<'created' | 'appended' | null> {
  const earned: string[] = [];

  // 갈래 수로 발동하는 것 — 이 경험이 와서 6건째가 됐다면 deepened 다.
  if (args.threadExperienceCount >= DEEPENED_THREAD_EXPERIENCES) earned.push('deepened');

  // 경험 점수로 발동하는 것 — **저장값**을 쓴다. 다시 재지 않는다.
  // 어느 규칙이었는지(new_skill/breakthrough/…)는 발화 시점의 breakdown 이
  // 있어야 알 수 있는데 그건 저장돼 있지 않다. 그래서 옮기기로 생기는
  // 트리거는 'comeback' 으로 적는다 — "다시 여기로 돌아왔다"가 실제로
  // 일어난 일이기도 하다.
  if (args.experience.memoryScore >= MEMORY_SCORE_THRESHOLD) earned.push('comeback');

  if (earned.length === 0) return null;

  const [existing] = await tx
    .select({
      id: memories.id,
      experienceIds: memories.experienceIds,
      triggers: memories.triggers,
    })
    .from(memories)
    .where(
      and(
        eq(memories.userId, args.userId),
        eq(memories.threadId, args.threadId),
        isNull(memories.forgottenAt),
      ),
    )
    .limit(1);

  if (!existing) {
    const ids = [args.experience.id];
    await tx.insert(memories).values({
      userId: args.userId,
      threadId: args.threadId,
      experienceId: args.experience.id,
      experienceIds: ids,
      occurredAt: args.experience.occurredAt,
      title: args.experience.summary,
      body: args.experience.detail ?? args.experience.summary,
      importance: await importanceOf(tx, ids, args.threadExperienceCount),
      trigger: earned[0],
      triggers: earned,
      // 제목이 옮긴 경험의 요약이라 갈래 전체를 대표하지 못한다. 밤에 다시 뽑는다.
      needsResummary: true,
    });
    return 'created';
  }

  const ids = existing.experienceIds.includes(args.experience.id)
    ? existing.experienceIds
    : [...existing.experienceIds, args.experience.id];
  const trs = [...new Set([...existing.triggers, ...earned])];

  await tx
    .update(memories)
    .set({
      experienceIds: ids,
      triggers: trs,
      needsResummary: true,
      importance: await importanceOf(tx, ids, args.threadExperienceCount),
    })
    .where(eq(memories.id, existing.id));

  return 'appended';
}

/**
 * 중요도를 다시 잰다.
 *
 * 공식을 여기 옮겨 적지 않는다 — memory-score.ts 의 memoryImportance 가
 * 정본이고, 엔진도 밤 재점검도 그걸 쓴다. 베껴 두면 한쪽만 고쳐졌을 때
 * 같은 기억의 중요도가 경로에 따라 달라지는데, 그건 화면에서 별의 크기로
 * 드러나기 전까지 아무도 모른다.
 *
 * 점수는 experiences.memory_score 에 **저장된 값**을 읽는다. 다시 재지
 * 않는다 — 그건 발화 시점의 판정이다.
 */
async function importanceOf(tx: Tx, ids: string[], threadExperienceCount: number): Promise<number> {
  if (ids.length === 0) return 1;
  const rows = await tx
    .select({ s: experiences.memoryScore })
    .from(experiences)
    .where(inArray(experiences.id, ids));
  return memoryImportance({
    evidenceScores: rows.map((r) => r.s),
    threadExperienceCount,
  });
}

/**
 * 갈래 둘을 합친다 — 붙어야 할 것이 갈라져 있을 때.
 *
 * 옮기기만으로는 이걸 못 고친다. 측정에서 재현율이 74% 였다 — 넷 중 하나는
 * 같은 것이 다른 갈래에 흩어져 있다는 뜻이고, 그걸 옮기기로 고치려면 경험을
 * 하나씩 N 번 옮겨야 한다.
 */
export async function mergeThreads(params: {
  userId: string;
  /** 없어질 쪽 */
  fromThreadId: string;
  /** 남을 쪽 */
  intoThreadId: string;
}): Promise<MoveResult> {
  const { userId, fromThreadId, intoThreadId } = params;
  if (fromThreadId === intoThreadId) return { ok: false, error: '같은 갈래야.' };

  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: threads.id, title: threads.title })
      .from(threads)
      .where(and(eq(threads.userId, userId), inArray(threads.id, [fromThreadId, intoThreadId])));
    if (rows.length !== 2) return { ok: false as const, error: '갈래를 찾을 수 없어.' };

    const from = rows.find((r) => r.id === fromThreadId)!;
    const into = rows.find((r) => r.id === intoThreadId)!;

    const moved = await tx
      .select({ id: experiences.id })
      .from(experiences)
      .where(and(eq(experiences.userId, userId), eq(experiences.threadId, fromThreadId)));

    if (moved.length > 0) {
      await tx
        .update(experiences)
        .set({ threadId: intoThreadId })
        .where(eq(experiences.threadId, fromThreadId));

      // 합치기도 교정이다. 경험마다 한 줄씩 남긴다 — 나중에 대조축을 뽑을 때
      // 무엇과 무엇이 같은 것이었는지가 여기서 나온다.
      await tx.insert(corrections).values(
        moved.map((m) => ({
          userId,
          experienceId: m.id,
          field: 'thread' as const,
          modelValue: from.title,
          humanValue: into.title,
          source: 'map' as const,
        })),
      );
    }

    const intoCount = await recountThread(tx, intoThreadId);
    await recountThread(tx, fromThreadId);

    // 없어질 갈래의 기억은 남을 쪽으로 흡수한다. 갈래당 기억은 하나이므로
    // 행을 옮기는 게 아니라 근거와 이유를 합친다.
    const [fromMem] = await tx
      .select({ id: memories.id, experienceIds: memories.experienceIds, triggers: memories.triggers })
      .from(memories)
      .where(and(eq(memories.threadId, fromThreadId), isNull(memories.forgottenAt)))
      .limit(1);

    if (fromMem) {
      const [intoMem] = await tx
        .select({ id: memories.id, experienceIds: memories.experienceIds, triggers: memories.triggers })
        .from(memories)
        .where(and(eq(memories.threadId, intoThreadId), isNull(memories.forgottenAt)))
        .limit(1);

      if (intoMem) {
        const ids = [...new Set([...intoMem.experienceIds, ...fromMem.experienceIds])];
        await tx
          .update(memories)
          .set({
            experienceIds: ids,
            triggers: [...new Set([...intoMem.triggers, ...fromMem.triggers])],
            needsResummary: true,
            importance: await importanceOf(tx, ids, intoCount),
          })
          .where(eq(memories.id, intoMem.id));
        await tx.delete(memories).where(eq(memories.id, fromMem.id));
      } else {
        // 남을 쪽에 기억이 없으면 그대로 옮겨 붙인다.
        await tx
          .update(memories)
          .set({ threadId: intoThreadId, needsResummary: true })
          .where(eq(memories.id, fromMem.id));
      }
    }

    await tx.delete(threads).where(eq(threads.id, fromThreadId));

    return {
      ok: true as const,
      threadId: intoThreadId,
      effects: [`「${from.title}」의 ${moved.length}건을 「${into.title}」로 합쳤어`],
    };
  });
}

/** 갈래 이름만 고친다 — 이름이 활동이지 대상이 아닐 때. */
export async function renameThread(params: {
  userId: string;
  threadId: string;
  title: string;
}): Promise<MoveResult> {
  const title = params.title.trim();
  if (!title) return { ok: false, error: '갈래 이름을 적어줘.' };

  const [row] = await db
    .update(threads)
    .set({ title })
    .where(and(eq(threads.id, params.threadId), eq(threads.userId, params.userId)))
    .returning({ id: threads.id });

  if (!row) return { ok: false, error: '그 갈래를 찾을 수 없어.' };
  return { ok: true, threadId: row.id, effects: [`「${title}」로 바꿨어`] };
}

/** 이 사용자의 갈래 목록 — 옮길 대상을 고르는 화면이 쓴다. */
export async function listThreadsForMove(userId: string, excludeThreadId?: string) {
  return db
    .select({
      id: threads.id,
      title: threads.title,
      category: threads.category,
      experienceCount: threads.experienceCount,
      lastActivityAt: threads.lastActivityAt,
    })
    .from(threads)
    .where(
      excludeThreadId
        ? and(eq(threads.userId, userId), ne(threads.id, excludeThreadId))
        : eq(threads.userId, userId),
    )
    .orderBy(sql`${threads.lastActivityAt} desc`);
}
