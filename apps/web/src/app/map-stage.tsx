"use client";

import { useCallback, useEffect, useState } from "react";

import {
  CAT_GROUPS,
  OrbitalMap,
  dominantCategory,
  groupOfCategory,
  type Body,
  type MemoryBody,
} from "@/components/orbital-map";
import { AskCard, type AskQuestion } from "@/components/ask-card";

// 계기판. 지도가 화면 전체를 차지하고, 판독값은 네 모서리에 붙는다.
// 카드도 패널도 없다 — 값은 여백 위에 그냥 놓여 있고 헤어라인이 구획한다.

function Readout({
  label,
  value,
  unit,
  className = "",
  delay = 0,
}: {
  label: string;
  value: string | number;
  unit?: string;
  className?: string;
  delay?: number;
}) {
  return (
    <div className={`settle ${className}`} style={{ "--d": `${delay}ms` } as React.CSSProperties}>
      <div className="tick mb-1.5">{label}</div>
      <div className="readout text-[27px] leading-none text-lum-0">
        {value}
        {unit && <span className="ml-1 text-[13.5px] text-lum-2">{unit}</span>}
      </div>
    </div>
  );
}

/** 에폭 ms → KST 'MM.DD HH:MM'. 목록이 좁아서 연도는 뺀다. */
function kstHm(ms: number): string {
  const d = new Date(ms + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCMonth() + 1)}.${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/** 목록에 몇 줄까지. 넷을 넘으면 아래 통계와 붙어 읽히기 시작한다. */
const RECENT_LIMIT = 3;

export function MapStage({
  bodies,
  memories,
  name,
  level,
  daysTogether,
  emotion,
  emotionReason,
  dialogue,
  counts,
  todayMinutes,
  todaySessions,
  question,
}: {
  bodies: Body[];
  memories: MemoryBody[];
  name: string;
  level: number;
  daysTogether: number;
  emotion: string;
  emotionReason: string;
  dialogue: string;
  counts: { experience: number; skill: number; memory: number };
  todayMinutes: number;
  todaySessions: number;
  /** 캐릭터가 오늘 묻는 것 (층 2). 없으면 안 그린다. */
  question: AskQuestion | null;
}) {
  // 기억의 색은 그 기억을 만든 경험들 중 가장 많은 분야에서 온다.
  // 범례에는 실제로 색으로 쓰인 분야만 올린다 — 경험에만 있고 어떤 기억도
  // 대표하지 않는 분야까지 적으면, 화면에 없는 색을 설명하는 줄이 된다.
  const memoryGroups = (() => {
    const byId = new Map(bodies.map((b) => [b.id, b]));
    const used = new Set(
      memories
        .map((m) => dominantCategory(m, byId))
        .filter((c): c is string => c != null)
        .map((c) => groupOfCategory(c).key),
    );
    return CAT_GROUPS.filter((g) => used.has(g.key));
  })();

  // 기억 하나를 펼쳐 읽는 동안에는 대사가 물러난다. 근거를 짚어보는 화면인데
  // 캐릭터가 계속 말을 걸고 있으면 읽을 것이 둘이 된다 — 게다가 그 대사는
  // 지금 보고 있는 기억이 아니라 오늘 전체에 대한 말이라 문맥도 어긋난다.
  const [reading, setReading] = useState(false);

  // bodies 는 occurred_at 내림차순이라(page.tsx 쿼리) 앞에서부터가 최근이다.
  const recent = bodies.slice(0, RECENT_LIMIT);

  // 조준점이 OS 커서를 대신하는 동안에는 화면 전체에서 커서를 감춘다.
  // 이 화면에서만 — 하위 페이지에는 조준점이 없으므로 커서가 있어야 한다.
  useEffect(() => {
    document.body.dataset.reticle = "on";
    return () => {
      delete document.body.dataset.reticle;
    };
  }, []);
  // OrbitalMap 의 effect 의존성에 들어가므로 매 렌더 새로 만들면 안 된다.
  const handleFocusChange = useCallback((focused: boolean) => setReading(focused), []);

  return (
    <main className="relative h-screen w-full overflow-hidden">
      {/* 관측 영역 */}
      <div className="absolute inset-0">
        <OrbitalMap
          bodies={bodies}
          memories={memories}
          threads={[]}
          centerLabel={name}
          onFocusChange={handleFocusChange}
        />
      </div>

      {/* 좌상 — 이 계가 무엇인가 */}
      {/* 축척 레일과 같은 왼쪽 선(레일 padding 14 + 항목 padding 6 = 20px)에서
          시작한다. 예전에는 레일을 피해 오른쪽으로 밀려 있었는데, 그러면 레일이
          한 칸 판독값이 한 칸으로 갈라져 하나의 계기판으로 안 읽힌다.
          레일 항목은 세로 가운데에만 있어 세로로 겹칠 일이 없다. */}
      <div className="pointer-events-none absolute left-5 top-8">
        <div className="settle">
          <div className="tick mb-2">관측 대상</div>
          <div className="readout text-[16px] tracking-[0.06em] text-lum-0">{name}</div>
          <div className="readout mt-1.5 text-[13.5px] text-lum-1">
            LV {String(level).padStart(2, "0")} · {daysTogether}일째 · {emotion}
          </div>
          <div className="mt-3 h-px w-28" style={{ background: "var(--color-lum-4)" }} />
          <div className="readout mt-3 text-[13px] leading-relaxed text-lum-2" title={emotionReason}>
            {emotionReason}
          </div>
        </div>
      </div>

      {/* 우상 — 궤도에 무엇이 올라 있나 */}
      <div className="pointer-events-none absolute right-8 top-8 text-right">
        <div className="settle" style={{ "--d": "80ms" } as React.CSSProperties}>
          <div className="tick mb-2">궤도상 기억</div>
          <div className="readout text-[16px] text-lum-0">
            {memories.length}
            <span className="ml-1 text-[13.5px] text-lum-2">/ 경험 {counts.experience}</span>
          </div>

          {/* 색 범례. 궤도 축에 이름은 적혀 있지만 그건 "그 방향이 무엇인가"이지
              "이 색이 무엇인가"가 아니다 — 축에서 멀리 떨어진 천체는 색만 남는다.
              기억의 색으로 실제로 쓰인 분야만 적는다. */}
          <div className="mt-3 flex flex-col items-end gap-1.5">
            {memoryGroups.map(({ key, label, color: col }) => (
              <span key={key} className="flex items-center gap-2">
                <span className="readout text-[13px] uppercase text-lum-1">{label}</span>
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{
                    background: `rgb(${col.join(",")})`,
                    boxShadow: `0 0 8px 2px rgba(${col.join(",")},.55)`,
                  }}
                />
              </span>
            ))}
          </div>

          <div className="mt-3 ml-auto h-px w-28" style={{ background: "var(--color-lum-4)" }} />
          <div className="readout mt-3 text-[13px] leading-relaxed text-lum-2">
            반경 = 경과일 · 크기 = 중요도
            <br />
            방향·이심률 = 종류 · 색 = 근거의 주된 분야
            <br />
            누르면 경험이 위성으로 · 방향 = 결과, 색 = 분야
            <br />
            갈래의 경험 전부 · 테두리 두른 것이 이 기억을 만든 근거
          </div>
        </div>
      </div>

      {/* 좌하 위 — 최근에 들어온 경험.
          숫자만 있으면 "오늘 세션 5"가 무슨 5인지 알 수 없다. 무엇이 방금
          들어왔는지 한 줄씩 보이면 지도를 안 뒤져도 확인이 된다.
          누르는 대상은 아니다 — 경험은 기억을 펼쳐야 보이는 층이고, 여기서
          바로 열면 그 위계가 무너진다. */}
      {recent.length > 0 && (
        <div
          className="pointer-events-none absolute bottom-28 left-5 max-w-[38ch]"
          style={{
            opacity: reading ? 0 : 1,
            transition: "opacity 420ms ease",
          }}
        >
          <div className="tick mb-2">최근 경험</div>
          <div className="flex flex-col gap-2.5">
            {recent.map((b, i) => (
              <div
                key={b.id}
                className="settle readout grid grid-cols-[auto_1fr] gap-x-2 text-[12.5px] leading-relaxed"
                style={{ "--d": `${340 + i * 60}ms` } as React.CSSProperties}
              >
                <span className="shrink-0 text-lum-4">{kstHm(b.occurredAt)}</span>
                <span className="truncate text-lum-2">{b.summary}</span>
                <span />
                {/* 판정과 점수, 그리고 기억에 닿았는지. 점수는 60 이 문턱이라
                    그 앞뒤가 곧 "이게 남았나"의 근거가 된다 — 숫자만 보고도
                    왜 기억이 안 됐는지 읽힌다. */}
                <span className="truncate text-[11.5px] text-lum-4">
                  {b.category.toUpperCase()} · {(b.outcome ?? "—").toUpperCase()} · M{b.memoryScore}
                  {b.remembered && <span className="ml-1.5 text-lum-2">기억에 붙음</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 좌하 — 오늘 */}
      <div className="pointer-events-none absolute bottom-8 left-5 flex gap-10">
        <Readout label="오늘 세션" value={todaySessions} delay={160} />
        <Readout label="관측 시간" value={todayMinutes} unit="분" delay={200} />
      </div>

      {/* 우하 — 누적 */}
      <div className="pointer-events-none absolute bottom-8 right-8 flex gap-10 text-right">
        <Readout label="경험" value={counts.experience} delay={240} />
        <Readout label="스킬" value={counts.skill} delay={280} />
        <Readout label="기억" value={counts.memory} delay={320} />
      </div>

      {/* 하단 중앙 — 이 계에서 유일하게 기계가 아닌 것 */}
      {/* 사라지는 연출은 바깥 껍데기가 맡는다. .settle 은 animation-fill-mode:both
          라서 끝 키프레임(opacity 1)이 인라인 스타일을 이긴다 — 같은 요소에서
          다투면 페이드가 통째로 무시된다. 층을 나누면 두 값이 곱해진다. */}
      <div className="pointer-events-none absolute bottom-12 left-1/2 w-full max-w-xl -translate-x-1/2 px-6 text-center">
        {/* 연출을 층으로 나눈다.
            바깥 — 자리잡기(-translate-x-1/2). Tailwind v4 는 이걸 transform 이
                   아니라 translate 속성으로 낸다. 여기에 인라인 translate 를
                   얹으면 같은 속성이라 가로 중앙정렬이 통째로 날아간다.
            가운데 — 사라짐. 여기서만 opacity·translate 를 만진다.
            안쪽 — 등장(.settle). animation-fill-mode:both 라 끝 키프레임이
                   인라인 스타일을 이기므로 같은 요소에서 다투면 안 된다. */}
        <div
          style={{
            opacity: reading ? 0 : 1,
            translate: reading ? "0 14px" : "0 0",
            transition: "opacity 520ms ease, translate 520ms cubic-bezier(.22,1,.36,1)",
          }}
        >
          <p
            className="utterance settle text-[18px]"
            style={{ "--d": "420ms" } as React.CSSProperties}
          >
            {dialogue}
          </p>
          {/* 캐릭터의 말 바로 아래에 붙인다 — 이건 폼이 아니라 대화의 연장이다.
              지도를 읽는 중(reading)에는 위 컨테이너가 통째로 사라지므로
              질문도 함께 물러난다. */}
          {question && <AskCard question={question} />}
        </div>
      </div>
    </main>
  );
}
