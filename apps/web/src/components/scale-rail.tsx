"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// 메뉴가 아니라 축척이다.
//
// 이 사이트의 모든 화면은 같은 것을 다른 배율로 본 것이다 — 지금의 나,
// 남은 것(기억), 하루치 궤적(일기), 계 전체(성격). 그래서 목록으로 나열하지
// 않고 배율 눈금으로 세운다. 눈금이 길수록 넓게 본다.
//
// 화면 왼쪽 가장자리에 붙어 있고 평소엔 눈금만 보인다. 겨누면 이름이 나온다 —
// 계기판에서 라벨은 필요할 때만 있으면 된다.
//
// 갈래(/threads)가 여기 있었다. 천체가 하나로 합쳐지면서 홈이 갈래를 전부
// 그리게 됐고, 그러면 두 화면이 같은 것을 두 번 보여주는 셈이라 뺐다 —
// 축척이 겹치면 눈금이 눈금 노릇을 못 한다.
const SCALES = [
  { href: "/", label: "나", tick: 10 },
  { href: "/memories", label: "기억", tick: 24 },
  { href: "/diary", label: "일기", tick: 28 },
  { href: "/skills", label: "스킬", tick: 31 },
  { href: "/personality", label: "성격", tick: 34 },
] as const;

export function ScaleRail() {
  const pathname = usePathname();

  return (
    <nav className="rail" aria-label="축척">
      {SCALES.map((s) => {
        const here = s.href === "/" ? pathname === "/" : pathname.startsWith(s.href);
        return (
          <Link
            key={s.href}
            href={s.href}
            aria-current={here ? "page" : undefined}
            className={`rail-item ${here ? "rail-item-here" : ""}`}
          >
            <span className="rail-tick" style={{ width: s.tick }} aria-hidden="true" />
            <span className="rail-label">{s.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
