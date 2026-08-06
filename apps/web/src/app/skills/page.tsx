import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { userSkills } from "@na/db";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/current-user";
import { formatKstYmd, kstDaysSince } from "@/lib/date";
import { Head, Shell, Empty } from "@/components/shell";

const DOMAIN_LABEL: Record<string, string> = {
  programming: "프로그래밍",
  life: "생활",
  art: "예술",
};
const DOMAIN_ORDER = ["programming", "life", "art"] as const;

const NEW_WINDOW_DAYS = 7;

export default async function SkillsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/connect");

  const skills = await db.select().from(userSkills).where(eq(userSkills.userId, user.userId));
  const maxPoints = skills.length > 0 ? Math.max(...skills.map((s) => s.points)) : 0;

  const groups = DOMAIN_ORDER.map((domain) => ({
    domain,
    items: skills.filter((s) => s.domain === domain).sort((a, b) => b.points - a.points),
  })).filter((g) => g.items.length > 0);

  return (
    <Shell>
      <Head
        tick="SKILLS · 무리"
        title="스킬"
        note="같은 궤도면을 공유하는 것들. 쓴 만큼 밝아진다."
      />

      {skills.length === 0 ? (
        <Empty>아직 무리를 이룬 것이 없다.</Empty>
      ) : (
        <div className="flex flex-col gap-14">
          {groups.map((group) => (
            <section key={group.domain}>
              <div className="tick mb-5">{DOMAIN_LABEL[group.domain] ?? group.domain}</div>
              <div className="flex flex-col">
                {group.items.map((skill, i) => {
                  const isNew = kstDaysSince(skill.firstUsedAt) < NEW_WINDOW_DAYS;
                  const ratio = maxPoints > 0 ? skill.points / maxPoints : 0;
                  return (
                    <div
                      key={skill.skillName}
                      className="settle field grid grid-cols-[1fr_auto] items-baseline gap-x-6 py-4"
                      style={{ "--d": `${i * 35}ms` } as React.CSSProperties}
                    >
                      <div>
                        <div className="flex items-baseline gap-2.5">
                          <span className="text-[15.5px] text-lum-0">{skill.skillName}</span>
                          {isNew && <span className="tick text-sig">신규</span>}
                        </div>
                        {/* 광도 막대 — 색이 아니라 밝기로 크기를 말한다 */}
                        <div className="mt-2.5 h-px w-full" style={{ background: "var(--color-lum-4)" }}>
                          <div
                            className="h-px"
                            style={{
                              width: `${Math.max(2, ratio * 100)}%`,
                              background: `rgba(244,247,251,${0.25 + ratio * 0.75})`,
                            }}
                          />
                        </div>
                        <div className="readout mt-2 text-[11.5px] text-lum-4">
                          {skill.useCount}회 · 최종 {formatKstYmd(skill.lastUsedAt, ".")}
                        </div>
                      </div>
                      <span className="readout text-[18px] text-lum-0">{skill.points}</span>
                    </div>
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
