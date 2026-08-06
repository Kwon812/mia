import { redirect } from "next/navigation";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { experienceSkills, memories, userSkills } from "@na/db";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/current-user";
import { formatKstYmd, formatKstMonthLabel } from "@/lib/date";
import { Head, Shell, Empty } from "@/components/shell";

type Memory = Awaited<ReturnType<typeof loadMemories>>[number];

async function loadMemories(userId: string) {
  return db
    .select()
    .from(memories)
    .where(and(eq(memories.userId, userId), isNull(memories.forgottenAt)))
    .orderBy(desc(memories.occurredAt));
}

/** 그 기억을 만든 경험에서 쓴 스킬 — 비중 순, 그때 처음이었는지 표시. */
type MemorySkill = { name: string; weight: number; firstTime: boolean };

/**
 * 기억마다 스킬 목록을 만든다.
 *
 * "그때 처음이었나"는 다시 계산하지 않는다 — user_skills.first_used_at 이
 * 그 스킬을 처음 쓴 세션의 시작 시각이고, experiences.occurred_at 도 같은
 * 값이다. 둘이 같으면 그 경험에서 처음 쓴 것이다. 과거 경험을 훑을 필요가 없다.
 *
 * 이 정보는 저장하지 않는다. 기억의 trigger 가 new_skill 이라는 사실만 남기고,
 * "무슨 스킬?"은 읽을 때 만든다 — 저장하면 재구축 때마다 어긋날 값이 하나 는다.
 */
async function loadSkillsByMemory(
  userId: string,
  items: Memory[],
): Promise<Map<string, MemorySkill[]>> {
  const expIds = items.map((m) => m.experienceId).filter((id): id is string => id != null);
  if (expIds.length === 0) return new Map();

  const [rows, owned] = await Promise.all([
    db
      .select({
        experienceId: experienceSkills.experienceId,
        name: experienceSkills.skillName,
        weight: experienceSkills.weight,
      })
      .from(experienceSkills)
      .where(inArray(experienceSkills.experienceId, expIds)),
    db
      .select({ name: userSkills.skillName, firstUsedAt: userSkills.firstUsedAt })
      .from(userSkills)
      .where(eq(userSkills.userId, userId)),
  ]);

  const firstUsed = new Map(owned.map((s) => [s.name, s.firstUsedAt.getTime()]));
  const occurredAt = new Map(
    items.filter((m) => m.experienceId).map((m) => [m.experienceId!, m.occurredAt.getTime()]),
  );

  const byExp = new Map<string, MemorySkill[]>();
  for (const r of rows) {
    const list = byExp.get(r.experienceId) ?? [];
    list.push({
      name: r.name,
      weight: r.weight,
      firstTime: firstUsed.get(r.name) === occurredAt.get(r.experienceId),
    });
    byExp.set(r.experienceId, list);
  }
  for (const list of byExp.values()) list.sort((a, b) => b.weight - a.weight);

  const byMemory = new Map<string, MemorySkill[]>();
  for (const m of items) {
    if (m.experienceId) byMemory.set(m.id, byExp.get(m.experienceId) ?? []);
  }
  return byMemory;
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
