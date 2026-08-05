"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const MENU = [
  { href: "/", label: "홈" },
  { href: "/memories", label: "기억" },
  { href: "/diary", label: "일기" },
  { href: "/skills", label: "스킬" },
  { href: "/personality", label: "성격" },
] as const;

// 화면 위에 떠 있는 유리 알약. 전체 폭 바가 아니라 패널이라서
// 스크롤할 때 내용이 좌우 여백으로 비쳐 지나간다.
export function SiteNav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-20 px-5 pb-2 pt-4 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <div className="glass glass-thin flex items-center justify-between gap-3 px-3 py-2 sm:px-4">
          <Link
            href="/"
            className="shrink-0 pl-1 font-mono text-[12px] font-medium tracking-[0.22em] text-live"
          >
            NA
          </Link>

          <nav className="flex items-center gap-0.5 sm:gap-1">
            {MENU.map((m) => {
              const active =
                m.href === "/" ? pathname === "/" : pathname.startsWith(m.href);
              return (
                <Link
                  key={m.href}
                  href={m.href}
                  aria-current={active ? "page" : undefined}
                  className={
                    active
                      ? "chip chip-warm px-2.5 py-1 text-[13px] font-medium sm:px-3"
                      : "rounded-full px-2.5 py-1 text-[13px] text-sub transition-colors hover:bg-white/55 hover:text-ink sm:px-3"
                  }
                >
                  {m.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
    </header>
  );
}
