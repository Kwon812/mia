import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { dailyLogs } from "@na/db";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/current-user";
import { PageHeader } from "@/components/page-header";
import { Dialogue } from "@/components/dialogue";

// log_date 는 문자열 모드 DATE("YYYY-MM-DD") — 접두 10자만 잘라 쓰면
// TZ 변환 없이 서버·클라이언트가 항상 같은 문자열을 그린다.
function formatDotDate(date: string): string {
  const [y, m, d] = date.slice(0, 10).split("-");
  return `${y}.${m}.${d}`;
}

export default async function DiaryPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/connect");

  const logs = await db
    .select()
    .from(dailyLogs)
    .where(eq(dailyLogs.userId, user.userId))
    .orderBy(desc(dailyLogs.logDate));

  return (
    <div>
      <PageHeader
        kicker="DIARY"
        title="일기"
        desc={`매일 밤, 하루를 돌아보며 ${user.character.name ?? "캐릭터"}가 남긴 짧은 기록.`}
      />

      {logs.length === 0 ? (
        <p className="font-mono text-[12.5px] text-faint">
          아직 일기가 없어. 오늘 밤 첫 장이 쓰일 거야.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {logs.map((log, i) => (
            <article
              key={log.logDate}
              className="glass na-rise p-5"
              style={{ "--na-delay": `${i * 60}ms` } as React.CSSProperties}
            >
              <div className="mb-2.5 flex items-center gap-2.5">
                <time className="font-mono text-[12px] text-faint">
                  {formatDotDate(log.logDate)}
                </time>
                {log.emotion && (
                  <span className="chip chip-warm px-2.5 py-0.5 font-mono text-[11px]">
                    {log.emotion}
                  </span>
                )}
              </div>
              <Dialogue text={log.summary} size="sm" />
              {(log.learned?.length ?? 0) > 0 && (
                <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-faint">
                    배운 것
                  </span>
                  {log.learned!.map((item) => (
                    <span
                      key={item}
                      className="chip chip-cool px-2 py-0.5 font-mono text-[11px]"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
