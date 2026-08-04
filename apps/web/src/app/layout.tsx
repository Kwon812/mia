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
      <body className="min-h-full flex flex-col antialiased">
        <SiteNav />
        <main className="mx-auto w-full max-w-3xl flex-1 px-5 pb-24 pt-10 sm:px-6">
          {children}
        </main>
        <footer className="border-t border-rule">
          <div className="mx-auto max-w-3xl px-5 py-6 font-mono text-[11px] tracking-wider text-faint sm:px-6">
            PROJECT NA
          </div>
        </footer>
      </body>
    </html>
  );
}
