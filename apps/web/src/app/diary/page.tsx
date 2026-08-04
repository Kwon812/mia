import { PageHeader } from "@/components/page-header";
import { Dialogue } from "@/components/dialogue";
import { dailyLogs } from "@/lib/mock";

// date 는 "YYYY-MM-DD" — 접두 10자만 쓰면 그대로 포맷된다.
function formatDotDate(date: string): string {
  const [y, m, d] = date.slice(0, 10).split("-");
  return `${y}.${m}.${d}`;
}

export default function DiaryPage() {
  const sorted = [...dailyLogs].sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
  );

  return (
    <div>
      <PageHeader
        kicker="DIARY"
        title="일기"
        desc="매일 밤, 하루를 돌아보며 단이가 남긴 짧은 기록."
      />

      <div className="divide-y divide-rule">
        {sorted.map((log) => (
          <article key={log.date} className="py-6 first:pt-0">
            <div className="mb-2.5 flex items-center gap-3">
              <time className="font-mono text-[12px] text-faint">
                {formatDotDate(log.date)}
              </time>
              <span className="bg-live-bg px-2 py-0.5 font-mono text-[11px] text-live">
                {log.emotion}
              </span>
            </div>
            <Dialogue text={log.summary} size="sm" />
            {log.learned.length > 0 && (
              <p className="mt-2.5 font-mono text-[11.5px] text-faint">
                배운 것: {log.learned.join(", ")}
              </p>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
