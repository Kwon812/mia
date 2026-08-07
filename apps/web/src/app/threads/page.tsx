import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { experiences, threads } from "@na/db";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/current-user";
import { DAY_MS } from "@/lib/date";
import { effective, loadCorrections } from "@/lib/corrections";
import { RECENT_LIMIT } from "@/lib/recent";
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
        completedAt: threads.completedAt,
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
   * 갈래의 분야를 **속한 경험들의 최빈 category** 로 다시 만든다.
   *
   * 저장된 threads.category 도 같은 규칙으로 갱신된다 — 엔진이 attach 마다
   * 다시 센다(experience-engine 의 attach UPDATE). 그러니 여기서 또 세는 건
   * 중복처럼 보이지만, 세는 **대상이 다르다.**
   *
   *   DB   : experiences.category — 모델의 판정(inferred)
   *   여기 : bodies[].category    — 그 위에 사람 교정을 겹친 값(declared)
   *
   * 엔진은 corrections 를 보지 않는다(세션 처리 시점에는 교정이 아직 없다).
   * /diary 에서 분야를 고쳤는데 갈래 색이 안 따라오면 "고쳐도 아무것도 안
   * 달라진다"가 되므로, 화면은 교정을 반영한 값으로 다시 센다.
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
    completedAt: t.completedAt?.getTime() ?? null,
    ageDays: Math.max(0, (now - t.startedAt.getTime()) / DAY_MS),
    referencedIds: expIdsByThread.get(t.id) ?? [],
    // 이 갈래를 시작한 경험 = 가장 오래된 것. expRows 가 occurred_at 내림차순
    // 이라 목록의 마지막이 그것이다. 화면에서 테두리로 표시된다.
    //
    // threads.started_at 과 같은 시각이지만 저장하지는 않는다 — 재구축 때마다
    // 어긋날 값이 하나 늘 뿐이고, 이미 있는 목록으로 정확히 계산된다.
    sourceIds: [(expIdsByThread.get(t.id) ?? []).at(-1)].filter((id): id is string => id != null),
    // 이 화면은 기억을 안 읽는다. 그래서 별이 전부 같은 밑광도로 뜬다 —
    // "무엇이 남았나"는 홈이 답하고 여기는 "무슨 일들이 있나"만 답한다.
    memory: null,
  }));

  // 최근 경험 셋과 그것들이 속한 갈래. 펼치면 그 경험들 자체가 잔광을 끈다.
  // 메인(/)과 같은 규칙이고 같은 수를 쓴다 — 화면마다 "최근"의 뜻이 달라지면
  // 두 지도를 오갈 때 같은 표식을 다르게 읽게 된다.
  // 여기서는 기억을 거치지 않고 갈래를 바로 가리키므로, 갈래가 없는 경험만
  // 빠진다(메인은 "기억이 아직 없는 갈래"도 빠져 더 적을 수 있다).
  const latestExps = expRows.slice(0, RECENT_LIMIT);
  const latestThreadIds = [
    ...new Set(latestExps.map((e) => e.threadId).filter((id): id is string => id != null)),
  ];

  return (
    <ThreadStage
      bodies={bodies}
      threads={threadBodies}
      latestExperienceIds={latestExps.map((e) => e.id)}
      latestThreadIds={latestThreadIds}
      centerLabel={user.character.name ?? "—"}
      activeCount={threadRows.filter((t) => t.status === "active").length}
    />
  );
}
