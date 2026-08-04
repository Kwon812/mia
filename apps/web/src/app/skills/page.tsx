import { PageHeader } from "@/components/page-header";
import { Card, MonoLabel } from "@/components/card";
import { skills } from "@/lib/mock";

// 도메인 표시 순서 · 라벨 (계획서 06장: 스킬 = 무엇을 했는가)
const DOMAIN_LABEL: Record<string, string> = {
  programming: "프로그래밍",
  life: "생활",
  art: "예술",
};
const DOMAIN_ORDER = ["programming", "life", "art"] as const;

const NEW_WINDOW_DAYS = 7;

// 날짜 문자열(YYYY-MM-DD)은 UTC 자정으로 파싱되므로 기준일도 UTC 자정으로 맞춘다.
function daysSince(dateStr: string, todayUTC: number): number {
  return Math.round((todayUTC - new Date(dateStr).getTime()) / 86_400_000);
}

export default function SkillsPage() {
  const now = new Date();
  const todayUTC = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );

  const maxPoints = Math.max(...skills.map((s) => s.points));

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

      <div className="flex flex-col gap-10">
        {groups.map((group) => (
          <section key={group.domain}>
            <MonoLabel>{DOMAIN_LABEL[group.domain] ?? group.domain}</MonoLabel>
            <div className="mt-3 flex flex-col gap-3">
              {group.items.map((skill) => {
                const isNew =
                  daysSince(skill.firstUsedAt, todayUTC) < NEW_WINDOW_DAYS;
                const barEndX = 1 + (skill.points / maxPoints) * 198;

                return (
                  <Card key={skill.name}>
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="text-[15px] font-medium">
                          {skill.name}
                        </span>
                        {isNew && (
                          <span className="rounded-sm bg-live-bg px-1.5 py-0.5 font-mono text-[10px] text-live">
                            NEW
                          </span>
                        )}
                      </div>
                      <span className="font-mono text-[13.5px] text-ink">
                        {skill.points}
                      </span>
                    </div>

                    <svg
                      viewBox="0 0 200 10"
                      preserveAspectRatio="none"
                      className="mt-2.5 h-2 w-full"
                      aria-hidden="true"
                    >
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
                        stroke="var(--color-live)"
                        strokeWidth="6"
                        strokeLinecap="round"
                      />
                    </svg>

                    <div className="mt-2 font-mono text-[11px] text-faint">
                      {skill.useCount}회 사용 · 마지막 사용 {skill.lastUsedAt}
                    </div>
                  </Card>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
