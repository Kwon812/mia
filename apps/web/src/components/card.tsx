import type { ReactNode } from "react";

// 기본 카드. 배경 카드색 + 왼쪽 액센트 변형.
export function Card({
  children,
  accent = false,
  className = "",
}: {
  children: ReactNode;
  accent?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`bg-card p-5 ${
        accent ? "border-l-[3px] border-live" : "border border-rule"
      } ${className}`}
    >
      {children}
    </div>
  );
}

// 모노 라벨 (카드 안 소제목·메타데이터)
export function MonoLabel({ children }: { children: ReactNode }) {
  return (
    <div className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-faint">
      {children}
    </div>
  );
}
