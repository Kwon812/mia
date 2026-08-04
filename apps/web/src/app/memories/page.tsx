import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/card";
import { Dialogue } from "@/components/dialogue";
import { memories } from "@/lib/mock";

type Memory = (typeof memories)[number];

// occurredAt 은 항상 "YYYY-MM-DD..." 로 시작 — 접두 10자만 잘라 쓴다.
// (TZ 변환 없이 서버·클라이언트가 항상 같은 문자열을 그린다)
function formatDotDate(occurredAt: string): string {
  const [y, m, d] = occurredAt.slice(0, 10).split("-");
  return `${y}.${m}.${d}`;
}

function monthLabel(occurredAt: string): string {
  const [y, m] = occurredAt.slice(0, 10).split("-");
  return `${y}년 ${Number(m)}월`;
}

// 최신 달이 위로 오도록 묶는다 — 몇 년치가 쌓여도 "이번 달"부터 보이는 구조.
function groupByMonth(items: Memory[]): [string, Memory[]][] {
  const sorted = [...items].sort((a, b) =>
    a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0,
  );
  const groups = new Map<string, Memory[]>();
  for (const item of sorted) {
    const key = monthLabel(item.occurredAt);
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }
  return Array.from(groups.entries());
}

export default function MemoriesPage() {
  const grouped = groupByMonth(memories);

  return (
    <div>
      <PageHeader
        kicker="MEMORIES"
        title="기억"
        desc="단이가 스스로 남긴 회고들. 시간이 쌓일수록 두꺼워지는 기록이다."
      />

      <div className="space-y-10 border-l border-rule-hard pl-6">
        {grouped.map(([label, items]) => (
          <section key={label}>
            <h2 className="mb-5 font-mono text-[12px] uppercase tracking-[0.16em] text-sub">
              {label}
            </h2>
            <div className="space-y-6">
              {items.map((m) => (
                <div key={m.id} className="relative">
                  <span className="absolute -left-[29px] top-2 h-2 w-2 rounded-full bg-live" />
                  <Card accent={m.importance >= 8}>
                    <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <span className="font-mono text-[12px] text-faint">
                        {formatDotDate(m.occurredAt)}
                      </span>
                      <span className="border border-rule px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-sub">
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
    </div>
  );
}
