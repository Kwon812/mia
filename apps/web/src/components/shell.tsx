import type { ReactNode } from "react";

// 서브페이지 공통 껍데기. 패널도 카드도 없다 — 여백과 헤어라인만으로 구획한다.
// 축척 레일이 왼쪽 가장자리를 쓰므로 본문은 그만큼 안쪽에서 시작한다.
export function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen px-16 py-20 sm:px-24 lg:px-32">
      <div className="mx-auto w-full max-w-3xl">{children}</div>
    </main>
  );
}

export function Head({ tick, title, note }: { tick: string; title: string; note?: string }) {
  return (
    <div className="settle mb-14">
      <div className="tick mb-3">{tick}</div>
      <h1 className="text-[25px] font-medium tracking-[-0.02em] text-lum-0">{title}</h1>
      {note && (
        <p className="readout mt-2.5 max-w-[46ch] text-[13px] leading-relaxed text-lum-3">
          {note}
        </p>
      )}
      <div className="hairline mt-7" />
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="readout text-[13px] text-lum-3">{children}</p>;
}
