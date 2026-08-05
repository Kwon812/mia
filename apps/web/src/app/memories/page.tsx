import { redirect } from "next/navigation";
import { and, desc, eq, isNull } from "drizzle-orm";
import { memories } from "@na/db";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/current-user";
import { formatKstYmd, formatKstMonthLabel } from "@/lib/date";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/card";
import { Dialogue } from "@/components/dialogue";

type Memory = Awaited<ReturnType<typeof loadMemories>>[number];

async function loadMemories(userId: string) {
  return db
    .select()
    .from(memories)
    .where(and(eq(memories.userId, userId), isNull(memories.forgottenAt)))
    .orderBy(desc(memories.occurredAt));
}

// 최신 달이 위로 오도록 묶는다 — 몇 년치가 쌓여도 "이번 달"부터 보이는 구조.
function groupByMonth(items: Memory[]): [string, Memory[]][] {
  const groups = new Map<string, Memory[]>();
  for (const item of items) {
    const key = formatKstMonthLabel(item.occurredAt);
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }
  return Array.from(groups.entries());
}

export default async function MemoriesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/connect");

  const items = await loadMemories(user.userId);
  const grouped = groupByMonth(items);

  return (
    <div>
      <PageHeader
        kicker="MEMORIES"
        title="기억"
        desc={`${user.character.name ?? "캐릭터"}가 스스로 남긴 회고들. 시간이 쌓일수록 두꺼워지는 기록이다.`}
      />

      {items.length === 0 ? (
        <p className="font-mono text-[12.5px] text-faint">
          아직 기억이 없어. 뭔가를 겪으면 여기 쌓일 거야.
        </p>
      ) : (
        <div
          className="space-y-10 pl-7"
          style={{
            // 타임라인 축 — 위(최근)에서 아래(과거)로 빛이 식어 사라진다
            borderLeft: "1px solid transparent",
            borderImage:
              "linear-gradient(180deg, rgba(180,103,31,.5), rgba(16,26,43,.16) 45%, transparent) 1",
          }}
        >
          {grouped.map(([label, group]) => (
            <section key={label}>
              <h2 className="mb-5 font-mono text-[12px] uppercase tracking-[0.18em] text-sub">
                {label}
              </h2>
              <div className="space-y-5">
                {group.map((m, i) => (
                  <div key={m.id} className="relative">
                    <span
                      className="absolute -left-[33px] top-6 h-2.5 w-2.5 rounded-full bg-live"
                      style={{ boxShadow: "0 0 0 4px rgba(180,103,31,.14)" }}
                    />
                    <Card accent={m.importance >= 8} delay={i * 60}>
                      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                        <span className="font-mono text-[12px] text-faint">
                          {formatKstYmd(m.occurredAt, ".")}
                        </span>
                        <span className="chip px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-sub">
                          {m.trigger}
                        </span>
                      </div>
                      <h3 className="mb-2 text-[15.5px] font-semibold text-ink">
                        {m.title}
                      </h3>
                      <Dialogue text={m.body} size="sm" />
                    </Card>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
