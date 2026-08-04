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

export function SiteNav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-10 border-b border-rule bg-paper/90 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-baseline justify-between px-5 py-4 sm:px-6">
        <Link
          href="/"
          className="font-mono text-xs font-medium tracking-[0.18em] text-live"
        >
          NA
        </Link>
        <nav className="flex gap-5 text-[13.5px]">
          {MENU.map((m) => {
            const active =
              m.href === "/" ? pathname === "/" : pathname.startsWith(m.href);
            return (
              <Link
                key={m.href}
                href={m.href}
                className={
                  active
                    ? "font-medium text-ink underline decoration-live decoration-2 underline-offset-8"
                    : "text-sub transition-colors hover:text-ink"
                }
              >
                {m.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
