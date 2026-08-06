"use client";

import { useCallback, useEffect, useState } from "react";

import {
  CAT_GROUPS,
  OrbitalMap,
  groupOfCategory,
  type Body,
  type ThreadBody,
} from "@/components/orbital-map";

// 갈래만 있는 계.
//
// 홈에 갈래를 얹어봤더니 한 화면에 기억과 갈래가 섞여 무엇이 무엇인지 읽히지
// 않았다 — 같은 축(반경·방향·색)을 서로 다른 근거로 쓰는 두 종류가 겹치면
// 범례가 세 줄이 되고 그때부터는 아무도 안 읽는다.
//
// 그래서 축척을 하나 더 판다. 이 화면은 "지금 무슨 일들을 붙들고 있나"만
// 답한다. 규칙은 홈과 같은 문법이되 근거만 갈래의 것이다.

export function ThreadStage({
  bodies,
  threads,
  centerLabel,
  activeCount,
}: {
  /** 위성으로 펼쳐질 경험들 */
  bodies: Body[];
  threads: ThreadBody[];
  centerLabel: string;
  activeCount: number;
}) {
  const [reading, setReading] = useState(false);

  // 조준점이 OS 커서를 대신하는 동안에는 화면 전체에서 커서를 감춘다.
  useEffect(() => {
    document.body.dataset.reticle = "on";
    return () => {
      delete document.body.dataset.reticle;
    };
  }, []);

  const handleFocusChange = useCallback((focused: boolean) => setReading(focused), []);

  // 실제로 색으로 쓰인 분야만 범례에 올린다. 갈래는 자기 category 를 쓰므로
  // 기억처럼 근거에서 추론할 필요가 없다.
  const groups = (() => {
    const used = new Set(threads.map((t) => groupOfCategory(t.category).key));
    return CAT_GROUPS.filter((g) => used.has(g.key));
  })();

  const total = threads.reduce((sum, t) => sum + t.experienceCount, 0);

  return (
    <main className="relative h-screen w-full overflow-hidden">
      <div className="absolute inset-0">
        <OrbitalMap
          bodies={bodies}
          memories={[]}
          threads={threads}
          centerLabel={centerLabel}
          onFocusChange={handleFocusChange}
        />
      </div>

      {/* 좌상 — 이 화면이 무엇을 보여주나 */}
      <div className="pointer-events-none absolute left-5 top-8">
        <div className="settle">
          <div className="tick mb-2">THREADS · 이어지는 일</div>
          <div className="readout text-[16px] tracking-[0.06em] text-lum-0">갈래</div>
          <div className="readout mt-1.5 text-[13.5px] text-lum-1">
            진행 중 {activeCount} · 전체 {threads.length}
          </div>
          <div className="mt-3 h-px w-28" style={{ background: "var(--color-lum-4)" }} />
          <div className="readout mt-3 max-w-[24ch] text-[13px] leading-relaxed text-lum-2">
            여러 날에 걸쳐 하나로 이어진 일. 누르면 그 일에 속한 경험이 전부 펼쳐진다.
          </div>
        </div>
      </div>

      {/* 우상 — 규칙 */}
      <div className="pointer-events-none absolute right-8 top-8 text-right">
        <div className="settle" style={{ "--d": "80ms" } as React.CSSProperties}>
          <div className="tick mb-2">궤도상 갈래</div>
          <div className="readout text-[16px] text-lum-0">
            {threads.length}
            <span className="ml-1 text-[13.5px] text-lum-2">/ 경험 {total}</span>
          </div>

          <div className="mt-3 flex flex-col items-end gap-1.5">
            {groups.map(({ key, label, color: col }) => (
              <span key={key} className="flex items-center gap-2">
                <span className="readout text-[13px] uppercase text-lum-1">{label}</span>
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{
                    background: `rgb(${col.join(",")})`,
                    boxShadow: `0 0 8px 2px rgba(${col.join(",")},.55)`,
                  }}
                />
              </span>
            ))}
          </div>

          <div className="mt-3 ml-auto h-px w-28" style={{ background: "var(--color-lum-4)" }} />
          <div className="readout mt-3 text-[13px] leading-relaxed text-lum-2">
            반경 = 시작한 지 · 크기 = 경험 수
            <br />
            방향·이심률 = 상태 · 색 = 분야
            <br />
            누르면 속한 경험이 위성으로 · 방향 = 결과
          </div>
        </div>
      </div>

      {/* 하단 — 펼쳐 읽는 동안에는 물러난다 */}
      <div className="pointer-events-none absolute bottom-10 left-1/2 w-full max-w-xl -translate-x-1/2 px-6 text-center">
        <div
          style={{
            opacity: reading ? 0 : 1,
            translate: reading ? "0 14px" : "0 0",
            transition: "opacity 520ms ease, translate 520ms cubic-bezier(.22,1,.36,1)",
          }}
        >
          <p
            className="readout settle text-[13px] text-lum-3"
            style={{ "--d": "420ms" } as React.CSSProperties}
          >
            {threads.length === 0
              ? "아직 이어지는 일이 없다. 세션이 쌓이면 작업이 갈래로 묶인다."
              : "갈래를 누르면 그 일에 속한 경험이 위성으로 펼쳐진다."}
          </p>
        </div>
      </div>
    </main>
  );
}
