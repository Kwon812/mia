import { redirect } from "next/navigation";
import { and, desc, eq, isNull } from "drizzle-orm";
import { memories } from "@na/db";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/current-user";
import { formatKstYmd, formatKstMonthLabel } from "@/lib/date";
import { Head, Shell, Empty } from "@/components/shell";
import { loadSkillsByMemory } from "@/lib/memory-skills";

type Memory = Awaited<ReturnType<typeof loadMemories>>[number];

async function loadMemories(userId: string) {
  return db
    .select()
    .from(memories)
    .where(and(eq(memories.userId, userId), isNull(memories.forgottenAt)))
    .orderBy(desc(memories.occurredAt));
}

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
  const skillsByMemory = await loadSkillsByMemory(user.userId, items);
  const grouped = groupByMonth(items);

  return (
    <Shell>
      <Head
        tick="MEMORIES · 개별 천체"
        title="기억"
        note="궤도에서 밝게 남은 것들. 참조되지 않은 채 오래 지나면 흐려진다."
      />

      {items.length === 0 ? (
        <Empty>아직 궤도에 남은 기억이 없다.</Empty>
      ) : (
        <div className="flex flex-col gap-16">
          {grouped.map(([label, group]) => (
            <section key={label}>
              <div className="tick mb-5">{label}</div>
              <div className="flex flex-col">
                {group.map((m, i) => {
                  const skills = skillsByMemory.get(m.id) ?? [];
                  return (
                    <article
                      key={m.id}
                      className="settle field grid grid-cols-[auto_1fr] gap-x-6 py-6"
                      style={{ "--d": `${i * 45}ms` } as React.CSSProperties}
                    >
                      <div className="readout w-24 text-[12px] leading-relaxed text-lum-3">
                        {formatKstYmd(m.occurredAt, ".")}
                        <br />
                        <span className="text-lum-4">중요도 {m.importance}</span>
                        <br />
                        <span className="text-lum-4">{m.trigger}</span>
                      </div>
                      <div>
                        <h2 className="mb-2 text-[16px] font-medium text-lum-0">{m.title}</h2>
                        <p className="utterance text-[15.5px] text-lum-1">{m.body}</p>

                        {/* 스킬 — 제목과 분리한다. 예전에는 "Supabase를 처음 써봤다 ·
                            {요약}" 처럼 제목에 욱여넣어서 두 정보가 한 줄에 뭉쳤다.
                            처음 쓴 것은 밝게 + 표식을 달아 trigger(new_skill)가
                            화면에서 근거를 얻게 한다. */}
                        {skills.length > 0 && (
                          <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1.5">
                            {skills.map((s) => (
                              <span
                                key={s.name}
                                className={[
                                  "readout rounded-sm border px-1.5 py-0.5 text-[12px]",
                                  s.firstTime
                                    ? "border-[rgba(160,185,220,0.34)] text-lum-0"
                                    : "border-[rgba(160,185,220,0.12)] text-lum-3",
                                ].join(" ")}
                                title={s.firstTime ? "이때 처음 썼다" : `비중 ${s.weight}`}
                              >
                                {s.name}
                                {s.firstTime && <span className="ml-1 text-lum-2">처음</span>}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </Shell>
  );
}
