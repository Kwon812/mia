"use client";

import { useCallback, useEffect, useState } from "react";

import { completeThread, moveExperienceToThread } from "@/app/actions";
import {
  CAT_GROUPS,
  OrbitalMap,
  groupOfCategory,
  type Body,
  type OrbitBody,
  type ThreadBody,
} from "@/components/orbital-map";
import { AskCard, type AskQuestion } from "@/components/ask-card";
import { RECENT_LIMIT } from "@/lib/recent";

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

// 목록 줄 수 = 지도에서 잔광을 끄는 수. 근거는 lib/recent.ts 에.
// (넷을 넘으면 아래 통계와 붙어 읽히기 시작한다.)

export function MapStage({
  bodies,
  threads,
  name,
  level,
  daysTogether,
  emotion,
  emotionReason,
  dialogue,
  counts,
  todayMinutes,
  todaySessions,
  latestExperienceIds,
  latestThreadIds,
  question,
}: {
  bodies: Body[];
  /** 계의 천체 전부. 갈래 하나가 별 하나이고, 남은 기억이 그 별의 광도다. */
  threads: ThreadBody[];
  name: string;
  level: number;
  daysTogether: number;
  emotion: string;
  emotionReason: string;
  dialogue: string;
  counts: { experience: number; skill: number; memory: number };
  todayMinutes: number;
  todaySessions: number;
  /** 최근 경험 셋과, 그것들이 속한 갈래들. 둘이 같은 표식을 쓴다 —
   *  계에서는 별이 코로나로, 펼친 뒤에는 그 경험이 잔광으로.
   *  앞에 있을수록 최근이고, 그 순서가 표식의 세기를 정한다.
   *  갈래 쪽 개수는 경험이 어디에 붙었느냐가 정한다 — 하나일 수도 셋일 수도 있다. */
  latestExperienceIds: string[];
  latestThreadIds: string[];
  /** 캐릭터가 오늘 묻는 것 (층 2). 없으면 안 그린다. */
  question: AskQuestion | null;
}) {
  // 지금 보고 있는 것 하나. 눌러서 펼쳤거나 당겨서 그 별의 계 안에 들어와
  // 있으면 그 천체가, 계 전체를 보고 있으면 null 이 온다.
  //
  // 근거를 짚어보는 화면에서는 대사가 물러난다 — 캐릭터가 계속 말을 걸고
  // 있으면 읽을 것이 둘이 되고, 그 대사는 지금 보고 있는 것이 아니라 오늘
  // 전체에 대한 말이라 문맥도 어긋난다. '최근 경험' 목록도 같은 이유로 내린다.
  const [viewing, setViewing] = useState<OrbitBody | null>(null);
  const reading = viewing != null;

  // 범례는 **지금 보고 있는 층의 색**을 적는다.
  //   계 전체 — 별들이 실제로 쓰고 있는 분야
  //   별 하나 — 그 별에 딸린 경험들의 분야
  // 화면에 없는 색을 설명하는 줄은 만들지 않는다. 확대해 한 별에 들어왔는데
  // 범례가 계 전체를 설명하고 있으면, 안 보이는 색 넷을 읽게 된다.
  const usedGroups = (() => {
    const byId = new Map(bodies.map((b) => [b.id, b]));
    const used = viewing
      ? new Set(
          viewing.referencedIds
            .map((id) => byId.get(id)?.category)
            .filter((c): c is string => c != null)
            .map((c) => groupOfCategory(c).key),
        )
      : new Set(threads.map((t) => groupOfCategory(t.category).key));
    return CAT_GROUPS.filter((g) => used.has(g.key));
  })();

  // 기억이 남은 갈래가 몇 개인가. 별의 밝기가 그 값이라 숫자로도 한 번 적는다.
  // "남은 것"이라고 적었었는데, 그게 곧 기억이라 우하단 '기억 5' 와 같은 값을
  // 다른 이름으로 부르고 있었다 — 한 화면에 두 어휘를 두지 않는다.
  const keptCount = threads.filter((t) => t.memory != null).length;

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
  const handleFocusChange = useCallback((o: OrbitBody | null) => setViewing(o), []);

  // 완결은 사람만 안다 — 브라우징 기록에는 "더 할 게 없다"는 판단의 흔적이
  // 없다. 갈래 화면에만 있던 버튼인데, 그 화면을 없애면서 여기로 옮겼다.
  // 이게 없으면 갈래를 끝낼 방법이 사이트 어디에도 남지 않는다.
  //
  // 서버 액션이 revalidatePath 로 이 화면을 다시 그린다. 낙관적 갱신을 하지
  // 않는 이유 — 완결은 기억까지 만드는 일이라, 실패했는데 화면만 바뀌면
  // "끝냈다고 눌렀는데 기억이 없다"가 된다.
  const handleComplete = useCallback((threadId: string) => completeThread(threadId), []);

  // 갈래 교정. 완결과 같은 이유로 낙관적 갱신을 하지 않는다 — 옮기기 하나가
  // 양쪽 갈래의 기억을 다시 판정하므로(강등되거나 새로 생긴다), 실패했는데
  // 화면만 바뀌면 있지도 않은 별을 보게 된다. 서버 액션이 revalidatePath 로
  // 다시 그리고, 무엇이 달라졌는지는 패널이 말로 알린다.
  const handleMove = useCallback(
    (
      experienceId: string,
      target: { kind: "existing"; threadId: string } | { kind: "new"; title: string },
    ) => moveExperienceToThread(experienceId, target),
    [],
  );

  return (
    <main className="relative h-screen w-full overflow-hidden">
      {/* 관측 영역 */}
      <div className="absolute inset-0">
        <OrbitalMap
          bodies={bodies}
          threads={threads}
          centerLabel={name}
          onFocusChange={handleFocusChange}
          onComplete={handleComplete}
          onMove={handleMove}
          // 펼치면 위성 층이라 최근 경험이, 계 화면에서는 그 경험이 속한 갈래가 표식을 켠다.
          latestIds={reading ? latestExperienceIds : latestThreadIds}
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

      {/* 우상 — 계에 무엇이 올라 있나 */}
      <div className="pointer-events-none absolute right-8 top-8 text-right">
        <div className="settle" style={{ "--d": "80ms" } as React.CSSProperties}>
          <div className="tick mb-2">계에 있는 것</div>
          <div className="readout text-[16px] text-lum-0">
            은하 {usedGroups.length}
            <span className="ml-1 text-[13.5px] text-lum-2">
              · 별 {threads.length} · 기억 {keptCount} / 경험 {counts.experience}
            </span>
          </div>

          {/* 색 범례. 축에 이름은 적혀 있지만 그건 "그 방향이 무엇인가"이지
              "이 색이 무엇인가"가 아니다 — 축에서 멀리 떨어진 천체는 색만 남는다.
              실제로 쓰인 분야만 적는다. */}
          <div className="mt-3 flex flex-col items-end gap-1.5">
            {usedGroups.map(({ key, label, color: col }) => (
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
            은하 하나 = 분야 하나 · 별 하나 = 하나의 일
            <br />
            나선팔 = 진행 중 · 안쪽이 최근이다
            <br />
            팔 밖으로 밀려난 것 = 끝냈거나(안쪽) 잊혀진(바깥) 일
            <br />
            밝을수록 많이 남았다 · 크기 = 경험 수
            <br />
            누르면 한 층 안으로 — 우주 → 은하 → 항성계
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
                  {/* 붙었다는 사실만으로는 왜 남았는지가 안 보인다. 그건 지도에서
                      색온도로만 말하던 값이라, 글로도 적어야 둘이 이어진다 —
                      "기억에 붙음"과 그 별의 색이 같은 것을 말하고 있다는 게
                      드러나야 한다. 가장 센 이유 하나는 서버가 골라 보낸다. */}
                  {b.remembered && (
                    <span className="ml-1.5 text-lum-2">
                      기억에 붙음{b.memoryTrigger ? ` · ${b.memoryTrigger.toUpperCase()}` : ""}
                    </span>
                  )}
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
              질문도 함께 물러난다.

              **여기만 포인터를 되살린다.** 이 계층의 판독값은 전부
              pointer-events-none 이다 — 지도가 화면 전체를 덮고 있어서 그러지
              않으면 글자 위에서 드래그가 죽는다. 그런데 그 상속이 질문 버튼까지
              먹어서 눌러도 아무 일이 안 일어났다.
              reading 일 때 다시 none 으로 두는 건 그 순간 이 층이 opacity 0 이라
              **안 보이는 버튼이 지도 클릭을 가로채기** 때문이다. */}
          {question && (
            <div style={{ pointerEvents: reading ? "none" : "auto" }}>
              <AskCard question={question} />
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
