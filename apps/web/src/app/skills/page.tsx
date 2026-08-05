import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { userSkills } from "@na/db";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/current-user";
import { formatKstYmd, kstDaysSince } from "@/lib/date";
import { PageHeader } from "@/components/page-header";
import { Card, MonoLabel } from "@/components/card";

// 도메인 표시 순서 · 라벨 (계획서 06장: 스킬 = 무엇을 했는가)
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

  const skills = await db
    .select()
    .from(userSkills)
    .where(eq(userSkills.userId, user.userId));

  const maxPoints = skills.length > 0 ? Math.max(...skills.map((s) => s.points)) : 0;

  const groups = DOMAIN_ORDER.map((domain) => ({
    domain,
    items: skills
      .filter((s) => s.domain === domain)
      .sort((a, b) => b.points - a.points),
  })).filter((g) => g.items.length > 0);

  return (
    <div>
      <PageHeader
        kicker="SKILLS"
        title="스킬"
        desc="무엇을 했는가 — 쓴 만큼 쌓인다."
      />

      {skills.length === 0 ? (
        <p className="font-mono text-[12.5px] text-faint">
          아직 배운 스킬이 없어. 뭔가 해보면 여기 쌓일 거야.
        </p>
      ) : (
        <div className="flex flex-col gap-10">
          {groups.map((group) => (
            <section key={group.domain}>
              <MonoLabel>{DOMAIN_LABEL[group.domain] ?? group.domain}</MonoLabel>
              <div className="mt-3 flex flex-col gap-3">
                {group.items.map((skill, i) => {
                  const isNew = kstDaysSince(skill.firstUsedAt) < NEW_WINDOW_DAYS;
                  const barEndX = maxPoints > 0 ? 1 + (skill.points / maxPoints) * 198 : 1;

                  return (
                    <Card key={skill.skillName} accent={isNew} delay={i * 50}>
                      <div className="flex items-baseline justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span className="text-[15px] font-medium">
                            {skill.skillName}
                          </span>
                          {isNew && (
                            <span className="chip chip-warm px-2 py-0.5 font-mono text-[10px]">
                              NEW
                            </span>
                          )}
                        </div>
                        <span className="font-mono text-[14px] tracking-tight text-ink">
                          {skill.points}
                        </span>
                      </div>

                      {/* 채워진 만큼 빛이 따뜻한 쪽에서 차가운 쪽으로 번진다 */}
                      <svg
                        viewBox="0 0 200 10"
                        preserveAspectRatio="none"
                        className="mt-2.5 h-2 w-full"
                        aria-hidden="true"
                      >
                        <defs>
                          <linearGradient id={`na-bar-${group.domain}`} x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0%" stopColor="var(--color-live)" />
                            <stop offset="100%" stopColor="var(--color-cool)" />
                          </linearGradient>
                        </defs>
                        <line
                          x1="1"
                          y1="5"
                          x2="199"
                          y2="5"
                          stroke="var(--color-rule)"
                          strokeWidth="6"
                          strokeLinecap="round"
                        />
                        <line
                          x1="1"
                          y1="5"
                          x2={barEndX}
                          y2="5"
                          stroke={`url(#na-bar-${group.domain})`}
                          strokeWidth="6"
                          strokeLinecap="round"
                        />
                      </svg>

                      <div className="mt-2 font-mono text-[11px] text-faint">
                        {skill.useCount}회 사용 · 마지막 사용 {formatKstYmd(skill.lastUsedAt)}
                      </div>
                    </Card>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
