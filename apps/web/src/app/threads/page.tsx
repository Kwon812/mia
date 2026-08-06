import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { experiences, threads } from "@na/db";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/current-user";
import { DAY_MS } from "@/lib/date";
import { effective, loadCorrections } from "@/lib/corrections";
import { ThreadStage } from "./thread-stage";
import type { Body, ThreadBody } from "@/components/orbital-map";

// 갈래 — 여러 날에 걸쳐 하나로 이어진 일.
//
// 홈의 지도는 "남은 것"(기억)을 보여준다. 기억은 규칙이 까다로워
// (new_skill·breakthrough 등) 작업마다 생기지 않는다 — 실측으로 갈래 5개 중
// 3개가 기억이 없어 홈에서 통째로 안 보였고, 그 작업들의 경험은 어느 화면에서도
// 펼쳐볼 수 없었다.
//
// 여기는 "이어지는 것"만 본다. 조건 없이 모든 작업이 뜨므로 thread_id 가 붙은
// 경험이면 반드시 어딘가에서 닿는다.

/** 지도에 올리는 경험 수 상한. 위성으로만 쓰이지만, 갈래가 참조하는 경험을
 *  여기서 찾으므로 이 밖의 오래된 경험은 펼쳐지지 않는다(홈과 같은 한계). */
const MAX_BODIES = 400;

export default async function ThreadsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/connect");

  const [expRows, threadRows] = await Promise.all([
    db
      .select({
        id: experiences.id,
        summary: experiences.summary,
        occurredAt: experiences.occurredAt,
        outcome: experiences.outcome,
        category: experiences.category,
        memoryScore: experiences.memoryScore,
        threadId: experiences.threadId,
        isFirstTime: experiences.isFirstTime,
      })
      .from(experiences)
      .where(eq(experiences.userId, user.userId))
      .orderBy(desc(experiences.occurredAt))
      .limit(MAX_BODIES),
    db
      .select({
        id: threads.id,
        title: threads.title,
        category: threads.category,
        status: threads.status,
        experienceCount: threads.experienceCount,
        startedAt: threads.startedAt,
      })
      .from(threads)
      .where(eq(threads.userId, user.userId))
      .orderBy(desc(threads.lastActivityAt)),
  ]);

  // 사람이 고친 판정을 겹친다 — 위성의 방향(결과)과 색(분야)이 /diary 에서
  // 고친 값과 어긋나면 같은 경험이 화면마다 다르게 보인다.
  const corrections = await loadCorrections(expRows.map((e) => e.id));
  const now = Date.now();

  const bodies: Body[] = expRows.map((e) => ({
    id: e.id,
    summary: e.summary,
    occurredAt: e.occurredAt.getTime(),
    ageDays: Math.max(0, (now - e.occurredAt.getTime()) / DAY_MS),
    outcome: effective(corrections, e.id, "outcome", e.outcome),
    category: effective(corrections, e.id, "category", e.category),
    memoryScore: e.memoryScore,
    threadId: e.threadId,
    isFirstTime: effective(corrections, e.id, "is_first_time", String(e.isFirstTime)) === "true",
    // 이 화면은 기억을 다루지 않는다 — 위성의 표시에만 쓰이는 값이라 false 로 둔다.
    remembered: false,
    forgotten: false,
  }));

  const expIdsByThread = new Map<string, string[]>();
  for (const e of expRows) {
    if (!e.threadId) continue;
    const list = expIdsByThread.get(e.threadId) ?? [];
    list.push(e.id);
    expIdsByThread.set(e.threadId, list);
  }

  /**
   * 갈래의 분야는 **속한 경험들의 최빈 category** 로 만든다.
   *
   * threads.category 는 그 갈래를 **연 첫 경험**의 판정으로 고정돼 있고
   * (experience-engine 의 action='new' 시점) 이후 경험이 붙어도 갱신되지 않는다.
   * 그런데 attach 판정 기준은 카테고리가 아니라 **대상**이라(프롬프트: "분야가
   * 같다는 것은 attach 의 근거가 아니다") 한 갈래 안에 여러 분야가 섞이는 게 정상이다.
   *
   *   1일차 문서만 읽음 → docs → 갈래 생성(category=docs)
   *   2·3일차 구현·디버깅 → dev → attach
   *   ⇒ 저장된 값은 docs, 실제 분포는 dev 우세
   *
   * 문서로 시작한 개발 작업이 영원히 docs 색으로 남는다. 그래서 저장된 값을
   * 쓰지 않고 읽을 때 겹쳐서 만든다 — 기억의 dominantCategory 와 같은 규칙이라
   * "색 = 분야"가 화면 전체에서 한 뜻이 되고, /diary 의 교정도 따라온다
   * (bodies 의 category 가 이미 교정을 반영한 값이다).
   *
   * 이미 불러온 expRows 안에서 세므로 추가 쿼리가 없다.
   */
  const bodyById = new Map(bodies.map((b) => [b.id, b]));
  const dominantOf = (threadId: string, fallback: string): string => {
    const tally = new Map<string, number>();
    for (const id of expIdsByThread.get(threadId) ?? []) {
      const c = bodyById.get(id)?.category;
      if (c) tally.set(c, (tally.get(c) ?? 0) + 1);
    }
    if (tally.size === 0) return fallback;
    // 동률이면 이름순 — 렌더마다 색이 바뀌지 않게 결정적으로 고른다.
    return [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  };

  const threadBodies: ThreadBody[] = threadRows.map((t) => ({
    kind: "thread" as const,
    id: t.id,
    title: t.title,
    category: dominantOf(t.id, t.category),
    status: t.status,
    experienceCount: t.experienceCount,
    occurredAt: t.startedAt.getTime(),
    ageDays: Math.max(0, (now - t.startedAt.getTime()) / DAY_MS),
    referencedIds: expIdsByThread.get(t.id) ?? [],
  }));

  return (
    <ThreadStage
      bodies={bodies}
      threads={threadBodies}
      centerLabel={user.character.name ?? "—"}
      activeCount={threadRows.filter((t) => t.status === "active").length}
    />
  );
}
