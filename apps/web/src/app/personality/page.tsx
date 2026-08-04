import { PageHeader } from "@/components/page-header";
import { personalityAxes, personalityHistory } from "@/lib/mock";

// 값(-100~+100) → 다이버징 트랙 x좌표(viewBox 0 0 200 24).
// +100 은 왼쪽 극(x=0), -100 은 오른쪽 극(x=200), 0 은 중앙(x=100).
function axisX(value: number): number {
  return Math.max(0, Math.min(200, 100 - value));
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

export default function PersonalityPage() {
  const latest = personalityHistory[personalityHistory.length - 1];
  const previous = personalityHistory[0];

  return (
    <div>
      <PageHeader
        kicker="PERSONALITY"
        title="성격"
        desc="어떻게 했는가 — 같은 스킬도 접근 방식은 저마다 다르다."
      />

      <div className="flex flex-col">
        {personalityAxes.map((axis) => {
          const cur = latest.values[axis.key];
          const prev = previous.values[axis.key];
          const xCur = axisX(cur);
          const xPrev = axisX(prev);

          return (
            <div
              key={axis.key}
              className="border-b border-rule py-4 last:border-b-0"
            >
              <div className="flex items-center gap-3">
                <span className="w-16 shrink-0 text-right text-[12.5px] text-sub">
                  {axis.left}
                </span>

                <div className="flex-1">
                  <svg
                    viewBox="0 0 200 24"
                    preserveAspectRatio="none"
                    className="h-6 w-full"
                    aria-hidden="true"
                  >
                    {/* 트랙 */}
                    <line
                      x1="0"
                      y1="12"
                      x2="200"
                      y2="12"
                      stroke="var(--color-rule)"
                      strokeWidth="2"
                    />
                    {/* 중앙(0) 눈금 */}
                    <line
                      x1="100"
                      y1="4"
                      x2="100"
                      y2="20"
                      stroke="var(--color-rule-hard)"
                      strokeWidth="2"
                    />
                    {/* 중앙 → 현재값 바 */}
                    <line
                      x1="100"
                      y1="12"
                      x2={xCur}
                      y2="12"
                      stroke="var(--color-live)"
                      strokeWidth="4"
                      strokeLinecap="round"
                    />
                    {/* 이전 스냅샷 고스트 마커 */}
                    <circle
                      cx={xPrev}
                      cy="12"
                      r="3"
                      fill="var(--color-faint)"
                      opacity="0.55"
                    />
                    {/* 현재값 마커 */}
                    <circle cx={xCur} cy="12" r="4.5" fill="var(--color-live)" />
                  </svg>

                  <div className="mt-1 text-center font-mono text-[11px] text-faint">
                    {signed(cur)}
                  </div>
                </div>

                <span className="w-16 shrink-0 text-[12.5px] text-sub">
                  {axis.right}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 flex items-center gap-5 font-mono text-[11px] text-faint">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 bg-live" aria-hidden="true" />
          현재 · {latest.computedAt}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-1.5 w-1.5 bg-faint opacity-55"
            aria-hidden="true"
          />
          이전 · {previous.computedAt}
        </span>
      </div>

      <p className="mt-8 font-mono text-[11px] text-faint">
        세션 {latest.sampleSize}개 기준 · 2주 이동평균
      </p>
    </div>
  );
}
