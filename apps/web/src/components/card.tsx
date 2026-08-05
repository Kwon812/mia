import type { ReactNode } from "react";

// 떠 있는 유리 패널. accent 는 왼쪽 선이 아니라 "따뜻한 쪽으로 기운 유리"다 —
// 이 디자인에서 강조는 테두리가 아니라 빛의 온도로 표현된다.
export function Card({
  children,
  accent = false,
  className = "",
  delay,
}: {
  children: ReactNode;
  accent?: boolean;
  className?: string;
  /** 진입 애니메이션 지연(ms). 목록에서 순서대로 떠오르게 할 때 쓴다. */
  delay?: number;
}) {
  return (
    <div
      className={`glass na-rise p-5 ${accent ? "glass-warm" : ""} ${className}`}
      style={delay ? ({ "--na-delay": `${delay}ms` } as React.CSSProperties) : undefined}
    >
      {children}
    </div>
  );
}

// 모노 라벨 (섹션 소제목·메타데이터)
export function MonoLabel({ children }: { children: ReactNode }) {
  return (
    <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-faint">
      {children}
    </div>
  );
}
