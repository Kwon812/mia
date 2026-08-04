import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 워크스페이스 패키지는 TS 소스 그대로 배포하므로 Next 가 트랜스파일한다
  transpilePackages: ["@na/db", "@na/shared"],
};

export default nextConfig;
