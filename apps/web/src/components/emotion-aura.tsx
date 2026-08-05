import type { EmotionLabel } from "@/lib/emotion";

// 감정이 화면의 공기 색을 정한다. 이 사이트에서 색이 움직이는 유일한 곳이고,
// 움직이는 근거는 장식이 아니라 파생 데이터(lib/emotion.ts)다.
//
// 감정은 저장되지 않고 조회 시점에 계산되므로(계획서 06장) 이 색도 시간이
// 지나면 자연히 '평온'으로 가라앉는다 — 48시간 규칙이 그대로 화면에 나타난다.
const AURA: Record<EmotionLabel, string> = {
  흥분: "rgba(203, 120, 42, 0.20)", // 달아오른 따뜻함
  답답: "rgba(96, 112, 140, 0.20)", // 흐린 청회색
  반가움: "rgba(62, 150, 160, 0.20)", // 맑은 청록
  그리움: "rgba(126, 118, 172, 0.17)", // 옅은 보랏빛
  평온: "rgba(150, 165, 190, 0.13)", // 중성
};

export function EmotionAura({ emotion }: { emotion: EmotionLabel }) {
  return (
    <div
      className="na-aura"
      aria-hidden="true"
      style={{ "--na-aura-color": AURA[emotion] } as React.CSSProperties}
    />
  );
}
