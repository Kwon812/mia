import type { Metadata } from "next";
import { Gowun_Batang, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { ScaleRail } from "@/components/scale-rail";

const gowun = Gowun_Batang({
  variable: "--font-gowun",
  weight: ["400", "700"],
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  weight: ["400", "500"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Project NA",
  description: "현실의 나를 통해 성장하는 AI",
};

// 헤더도 푸터도 없다. 화면 가장자리에 축척 눈금(ScaleRail)만 붙고,
// 나머지는 전부 관측 영역이다.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className={`${gowun.variable} ${plexMono.variable} h-full`}>
      <head>
        {/* Pretendard 는 Google Fonts 에 없어 CDN 사용 */}
        <link
          rel="stylesheet"
          crossOrigin="anonymous"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body className="min-h-full">
        <ScaleRail />
        {children}
      </body>
    </html>
  );
}
