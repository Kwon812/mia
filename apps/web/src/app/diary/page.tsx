import { redirect } from "next/navigation";
import { desc, eq, inArray } from "drizzle-orm";
import { dailyLogs, experiences } from "@na/db";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/current-user";
import { Head, Shell, Empty } from "@/components/shell";
import { effective, isCorrected, loadCorrections } from "@/lib/corrections";
import { CorrectionRow } from "./correction-chips";

// log_date 는 문자열 모드 DATE("YYYY-MM-DD") — 접두 10자만 잘라 쓰면
// TZ 변환 없이 서버·클라이언트가 항상 같은 문자열을 그린다.
function formatDotDate(date: string): string {
  const [y, m, d] = date.slice(0, 10).split("-");
  return `${y}.${m}.${d}`;
}

function formatKstTime(at: Date): string {
  return new Date(at.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(11, 16);
}

export default async function DiaryPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/connect");

  const logs = await db
    .select()
    .from(dailyLogs)
    .where(eq(dailyLogs.userId, user.userId))
    .orderBy(desc(dailyLogs.logDate));

  // 일기의 근거가 된 경험들. daily_logs.experience_ids 가 그 날짜의 재생성
  // 근거라, 화면에서 교정할 대상도 정확히 이 집합이다.
  const experienceIds = [...new Set(logs.flatMap((l) => l.experienceIds ?? []))];

  const expRows = experienceIds.length
    ? await db
        .select({
          id: experiences.id,
          occurredAt: experiences.occurredAt,
          summary: experiences.summary,
          category: experiences.category,
          outcome: experiences.outcome,
          isFirstTime: experiences.isFirstTime,
        })
        .from(experiences)
        .where(inArray(experiences.id, experienceIds))
        .orderBy(experiences.occurredAt)
    : [];

  // declared 를 inferred 위에 겹친다. experiences 는 건드리지 않는다 —
  // 유효값은 저장된 값이 아니라 읽을 때 만드는 값이다.
  const corrections = await loadCorrections(experienceIds);
  const byId = new Map(expRows.map((e) => [e.id, e]));

  return (
    <Shell>
      <Head
        tick="DIARY · 하루치 궤적"
        title="일기"
        note="매일 밤 배치가 그날의 경험을 한 문단으로 접는다. 판정이 틀렸으면 칩을 눌러 고쳐줘 — 고친 것만 내가 맞다고 배운다."
      />

      {logs.length === 0 ? (
        <Empty>아직 접힌 하루가 없다. 오늘 밤 첫 층이 쌓인다.</Empty>
      ) : (
        <div className="flex flex-col">
          {logs.map((log, i) => {
            const rows = (log.experienceIds ?? [])
              .map((id) => byId.get(id))
              .filter((e): e is NonNullable<typeof e> => Boolean(e));

            return (
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

                  {rows.length > 0 && (
                    <div className="mt-6 flex flex-col gap-2.5">
                      <div className="tick text-[9.5px] text-lum-4">그날의 판정</div>
                      {rows.map((e) => {
                        const outcome = effective(corrections, e.id, "outcome", e.outcome ?? "explore");
                        const category = effective(corrections, e.id, "category", e.category);
                        const first = effective(
                          corrections,
                          e.id,
                          "is_first_time",
                          String(e.isFirstTime),
                        );

                        return (
                          <CorrectionRow
                            key={e.id}
                            experienceId={e.id}
                            time={formatKstTime(e.occurredAt)}
                            summary={e.summary}
                            values={{ category, outcome, is_first_time: first }}
                            corrected={{
                              category: isCorrected(corrections, e.id, "category"),
                              outcome: isCorrected(corrections, e.id, "outcome"),
                              is_first_time: isCorrected(corrections, e.id, "is_first_time"),
                            }}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </Shell>
  );
}
