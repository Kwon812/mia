import type { Metadata } from "next";
import { Gowun_Batang, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { SiteNav } from "@/components/site-nav";

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
      <body className="flex min-h-full flex-col antialiased">
        {/* 고정 광원. 유리 패널이 굴절시킬 대상이라 스크롤과 무관하게 제자리에 있다. */}
        <div className="na-field" aria-hidden="true" />

        <SiteNav />

        <main className="mx-auto w-full max-w-3xl flex-1 px-5 pb-28 pt-8 sm:px-6">
          {children}
        </main>

        <footer className="mx-auto w-full max-w-3xl px-5 pb-8 sm:px-6">
          <div className="flex items-baseline justify-between border-t border-rule pt-5">
            <span className="font-mono text-[11px] tracking-[0.2em] text-faint">
              PROJECT NA
            </span>
            <span className="font-mono text-[11px] text-faint">
              현실의 나를 통해 성장하는 AI
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
