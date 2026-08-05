import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { dailyLogs } from "@na/db";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/current-user";
import { Head, Shell, Empty } from "@/components/shell";

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
    <Shell>
      <Head
        tick="DIARY · 하루치 궤적"
        title="일기"
        note="매일 밤 배치가 그날의 경험을 한 문단으로 접는다. 한 층씩 쌓인다."
      />

      {logs.length === 0 ? (
        <Empty>아직 접힌 하루가 없다. 오늘 밤 첫 층이 쌓인다.</Empty>
      ) : (
        <div className="flex flex-col">
          {logs.map((log, i) => (
            <article
              key={log.logDate}
              className="settle field grid grid-cols-[auto_1fr] gap-x-6 py-7"
              style={{ "--d": `${i * 45}ms` } as React.CSSProperties}
            >
              <time className="readout w-24 text-[10.5px] leading-relaxed text-lum-3">
                {formatDotDate(log.logDate)}
                {log.emotion && (
                  <>
                    <br />
                    <span className="text-lum-4">{log.emotion}</span>
                  </>
                )}
              </time>
              <div>
                <p className="utterance text-[15px]">{log.summary}</p>
                {(log.learned?.length ?? 0) > 0 && (
                  <div className="readout mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[10.5px] text-lum-3">
                    {log.learned!.map((item) => (
                      <span key={item}>+ {item}</span>
                    ))}
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </Shell>
  );
}
