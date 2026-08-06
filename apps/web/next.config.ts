import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 워크스페이스 패키지는 TS 소스 그대로 배포하므로 Next 가 트랜스파일한다
  transpilePackages: ["@na/db", "@na/shared"],

  // 개발 인디케이터가 기본값(bottom-left)이라 홈의 "오늘 세션" 판독값을
  // 정확히 가린다(map-stage 의 좌하단 블록). 끄지는 않는다 — 끄면 컴파일·
  // 런타임 오류 표시까지 같이 사라진다. 우하단으로 옮기면 그쪽 누적 판독값과는
  // 겹치지만 그건 숫자가 커서 일부가 보여도 읽히고, 좌하단은 두 칸뿐이라
  // 하나가 가려지면 그 값이 통째로 안 보인다.
  devIndicators: { position: "bottom-right" },
};

export default nextConfig;
