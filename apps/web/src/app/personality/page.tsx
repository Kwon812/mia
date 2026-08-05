import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { personalitySnapshots } from "@na/db";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/current-user";
import { formatKstYmd } from "@/lib/date";
import { Head, Shell, Empty } from "@/components/shell";

const PERSONALITY_AXES = [
  { key: "focusScatter", left: "몰입형", right: "산만형" },
  { key: "depthBreadth", left: "집중형", right: "멀티형" },
  { key: "finishExplore", left: "완결형", right: "탐색형" },
  { key: "pioneerMaster", left: "개척형", right: "숙련형" },
  { key: "nightMorning", left: "새벽형", right: "아침형" },
] as const;

type Snapshot = Awaited<ReturnType<typeof loadSnapshots>>[number];

async function loadSnapshots(userId: string) {
  return db
    .select()
    .from(personalitySnapshots)
    .where(eq(personalitySnapshots.userId, userId))
    .orderBy(desc(personalitySnapshots.computedAt))
    .limit(2);
}

/** -100(오른쪽 극) ~ +100(왼쪽 극) → 0~100% */
function axisPct(value: number): number {
  return Math.max(0, Math.min(100, (100 - value) / 2));
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

export default async function PersonalityPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/connect");

  const snapshots = await loadSnapshots(user.userId);
  const latest: Snapshot | undefined = snapshots[0];
  const previous: Snapshot | undefined = snapshots[1];

  return (
    <Shell>
      <Head
        tick="PERSONALITY · 계 전체"
        title="성격"
        note="가장 멀리서 본 모습. 개별 궤도가 아니라 계 전체의 형태다."
      />

      {!latest ? (
        <Empty>아직 계의 형태가 드러나지 않았다.</Empty>
      ) : (
        <>
          <div className="flex flex-col">
            {PERSONALITY_AXES.map((axis, i) => {
              const cur = latest[axis.key];
              const prev = previous?.[axis.key];
              return (
                <div
                  key={axis.key}
                  className="settle field py-6"
                  style={{ "--d": `${i * 45}ms` } as React.CSSProperties}
                >
                  <div className="mb-3 flex items-baseline justify-between">
                    <span className="readout text-[11.5px] text-lum-2">{axis.left}</span>
                    <span className="readout text-[13px] text-lum-0">{signed(cur)}</span>
                    <span className="readout text-[11.5px] text-lum-2">{axis.right}</span>
                  </div>
                  {/* 눈금 위의 지표. 중앙이 0. */}
                  <div className="relative h-5">
                    <div
                      className="absolute top-1/2 h-px w-full"
                      style={{ background: "var(--color-lum-4)" }}
                    />
                    <div
                      className="absolute top-1/2 h-3 w-px -translate-y-1/2"
                      style={{ left: "50%", background: "var(--color-lum-3)" }}
                    />
                    {prev !== undefined && (
                      <div
                        className="absolute top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full"
                        style={{ left: `${axisPct(prev)}%`, background: "var(--color-lum-4)" }}
                      />
                    )}
                    <div
                      className="absolute top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-lum-0"
                      style={{
                        left: `${axisPct(cur)}%`,
                        boxShadow: "0 0 12px 3px rgba(230,240,255,.35)",
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="readout mt-10 flex flex-wrap gap-x-8 gap-y-2 text-[10px] text-lum-3">
            <span>현재 {formatKstYmd(latest.computedAt, ".")}</span>
            {previous && <span>이전 {formatKstYmd(previous.computedAt, ".")}</span>}
            <span>표본 {latest.sampleSize} 세션 · 2주 이동평균</span>
          </div>
        </>
      )}
    </Shell>
  );
}
