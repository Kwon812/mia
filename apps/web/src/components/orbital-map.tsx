"use client";

import { useEffect, useRef, useState } from "react";

// 궤도 지도 — 이 사이트의 본체.
//
// 규칙 하나: 기억은 크고 밝다. 경험은 작고 흐리다.
// 광도와 크기가 위계를 만들고, 색은 그 기억이 어떤 종류인지만 말한다.
//
// 궤도 요소는 전부 실제 값에서 나온다.
//   반경 a      ← 얼마나 오래됐나 (log). 오래될수록 멀다.
//   이심률 e    ← outcome. stuck 일수록 찌그러진다.
//   광도        ← memory_score.
//   근일점 방향 ← thread. 같은 작업이면 궤도면이 나란하다.
//   공전 속도   ← 케플러 제3법칙(T ∝ a^1.5). 먼 것은 느리다.
//
// 기억을 누르면 그 기억이 중심으로 오고, 그 기억이 참조하는 경험들이 위성으로
// 그 둘레를 돈다. 기억은 경험에서 만들어진 것이므로 그 관계가 곧 궤도가 된다.

export type Body = {
  id: string;
  summary: string;
  occurredAt: number;
  ageDays: number;
  outcome: string | null;
  category: string;
  memoryScore: number;
  threadId: string | null;
  isFirstTime: boolean;
  remembered: boolean;
  forgotten: boolean;
};

export type MemoryBody = {
  id: string;
  /** 같은 작업에서 나온 기억끼리 궤도 방향을 공유하기 위한 값 */
  threadId: string | null;
  title: string;
  body: string;
  importance: number;
  trigger: string;
  occurredAt: number;
  ageDays: number;
  /** 이 기억의 근거가 된 경험들 */
  referencedIds: string[];
  /** 그중 이 기억을 실제로 만든 경험 (memories.experience_id). 나머지는 같은 작업에서 딸려온 것들 */
  sourceId: string | null;
};

const ECC: Record<string, number> = {
  success: 0.06,
  partial: 0.24,
  explore: 0.38,
  stuck: 0.56,
};

// 축과 중심처럼 어느 분야에도 속하지 않는 것들의 색. 근거가 화면 밖
// (경험 220건 상한 바깥)이라 분야를 못 정하는 기억도 여기로 떨어진다.
const NEUTRAL: [number, number, number] = [150, 165, 190];

// 기억 궤도의 큰 갈래는 trigger 가 정한다. 다섯 개로 고정된 값이라 360도를
// 나눠도 갈래가 뭉개지지 않는다 — thread 는 계속 늘어나는 값이라 등간격으로
// 나누면 스물만 넘어도 18도씩이 되어 방향이 정보가 못 된다.
// 그래서 굵은 분할은 trigger, 그 안에서의 자리는 thread 가 맡는다.
export const TRIGGER_ORDER = ['new_skill', 'thread_complete', 'breakthrough', 'revival', 'comeback'];

// 갈래를 π 로 나눈다(2π 가 아니라). 타원은 180도 돌리면 자기 자신이라
// 그 너머는 같은 방향으로 보인다 — 실제로 쓸 수 있는 각도는 절반뿐이다.
const SECTOR = Math.PI / TRIGGER_ORDER.length;
// 갈래 사이에 빈 각도를 남겨야 다섯 무리가 서로 구분된다.
const SECTOR_FILL = 0.55;

// 기억의 이심률 — 그 기억이 어떻게 남았는지가 궤도의 안정성이 된다.
const ECC_TRIGGER: Record<string, number> = {
  thread_complete: 0.05, // 끝냈다. 자리를 잡았다.
  new_skill: 0.16,
  comeback: 0.26,
  breakthrough: 0.34, // 막 뚫고 나와 아직 흔들린다
  revival: 0.4, // 오래 비웠다 돌아왔다
};

// 위성(경험) 궤도면의 갈래는 outcome 이 정한다. 네 개로 고정된 값이라
// 나눠도 뭉개지지 않는다 — category 는 LLM 이 자유 텍스트로 쓰는 값이라
// 이론상 무한하고, 표기가 흔들리면(개발/dev/프로그래밍) 계속 늘어난다.
// 메인에서 trigger(고정)가 갈래를 잡고 thread(무한)가 자리를 잡는 것과 같은 위계다.
const OUTCOME_ORDER = ['success', 'partial', 'stuck', 'explore'];
const SAT_SECTOR = Math.PI / OUTCOME_ORDER.length;
const SAT_FILL = 0.55;

/** 라벨은 enum 값을 그대로 쓴다. 한글 대응표를 두면 화면과 DB·프롬프트가
 *  다른 어휘를 쓰게 되고, 값이 늘 때마다 번역을 빠뜨린다. 이 화면은 계기판이라
 *  등폭 대문자가 오히려 결에 맞는다. */
const tag = (v: string | null | undefined) => (v ?? '—').toUpperCase();

// 색 묶음. 카테고리는 열셋인데 검은 배경 위 작은 후광으로 구분되는 색은
// 여덟이 한계다 — 열셋을 다 칠하면 서로 겹쳐 보여 색이 정보가 못 된다.
// 그래서 값은 열셋 그대로 두고 화면만 묶는다. 흔한 것에는 제 색을 주고,
// 드물게 나오는 것들을 한 색으로 모은다. 목록이 더 늘어도 묶음에 넣으면
// 색 체계는 안 건드린다.
// 두 가지를 피했다: 상호작용 색(#63E6D2, 청록)과 흰빛.
export const CAT_GROUPS: {
  key: string;
  label: string;
  cats: string[];
  color: [number, number, number];
}[] = [
  { key: 'dev', label: 'dev', cats: ['dev'], color: [130, 176, 235] },
  { key: 'docs', label: 'docs', cats: ['docs'], color: [230, 178, 96] },
  { key: 'study', label: 'study', cats: ['study'], color: [225, 130, 150] },
  { key: 'ai', label: 'AI', cats: ['ai'], color: [160, 130, 220] },
  { key: 'community', label: 'community', cats: ['community'], color: [235, 148, 100] },
  { key: 'media', label: 'media', cats: ['entertainment', 'music'], color: [140, 195, 120] },
  {
    key: 'life',
    label: 'life',
    cats: ['news', 'finance', 'shopping', 'productivity'],
    color: [215, 140, 205],
  },
  { key: 'etc', label: 'etc', cats: ['search', 'etc'], color: [150, 165, 190] },
];

const GROUP_BY_CAT = new Map(CAT_GROUPS.flatMap((g) => g.cats.map((c) => [c, g] as const)));

/** 카테고리 → 색 묶음. 목록에 없는 값(예전 데이터, 표기 흔들림)은 기타로 떨어진다. */
export function groupOfCategory(cat: string) {
  return GROUP_BY_CAT.get(cat) ?? CAT_GROUPS[CAT_GROUPS.length - 1];
}

/** 카테고리 → 색. 등장 순서와 무관하게 언제나 같은 색이다 —
 *  예전에는 화면에 있는 값들을 정렬해 순서대로 팔레트를 나눠줬는데,
 *  값이 하나 늘면 그 뒤가 전부 밀려 어제 외운 색이 오늘 다른 뜻이 됐다. */
export function colorOfCategory(cat: string): [number, number, number] {
  return groupOfCategory(cat).color;
}

/** 그 기억을 만든 경험들 중 가장 많은 분야. 기억의 색은 여기서 온다.
 *  trigger 는 이미 방향과 이심률 둘을 쓰고 있어서, 색까지 trigger 로 주면
 *  같은 말을 세 번 하고 채널 하나를 통째로 버리게 된다. 분야를 색에 실으면
 *  기억과 경험이 같은 팔레트를 공유해 — 파란 기억을 누르면 파란 위성이
 *  많다 — 두 화면이 하나의 색 언어로 묶인다.
 *  동률이면 이름 순으로 고정한다. 렌더마다 색이 바뀌면 안 된다. */
export function dominantCategory(m: MemoryBody, byId: Map<string, Body>): string | null {
  const tally = new Map<string, number>();
  for (const id of m.referencedIds) {
    const b = byId.get(id);
    if (!b) continue;
    tally.set(b.category, (tally.get(b.category) ?? 0) + 1);
  }
  if (tally.size === 0) return null;
  return Array.from(tally.entries()).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0][0];
}


/** id → [0,1). 렌더마다 위상이 튀지 않도록 결정적으로 뽑는다. */
function phaseOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

const radiusOf = (ageDays: number) => 0.16 + Math.log1p(ageDays) * 0.3;
/** 케플러 제3법칙. 최근 것이 1분쯤에 한 바퀴, 오래된 것은 훨씬 느리게. */
const speedOf = (a: number) => 0.012 / Math.pow(a, 1.5);

/** 붙잡는 범위. 천체의 판정 반경을 이만큼 넓혀 조준점을 끌어당긴다.
 *  너무 키우면 화면이 온통 자석이 되어 빈 곳을 눌러 빠져나올 수가 없다. */
/** 모핑 배율. 누른 천체로 얼마나 밀고 들어가는가. 너무 크면 나머지 궤도가
 *  한 프레임 만에 화면 밖으로 튀어 "확대"가 아니라 "터짐"이 된다. */
const ZOOM = 2.6;

const CAPTURE = 2.4;

/** 끌림의 세기. 거리비 t(0=중심, 1=경계)를 0~1 로 바꾼다.
 *  지수를 1 보다 크게 잡으면 안쪽에서만 급히 당기고 가장자리에서는 거의
 *  안 움직여, 자석이 아니라 "닿으면 달라붙는 것"이 된다. 1 보다 작게 잡아야
 *  범위 안에 들어서는 순간부터 끌려오고 경계에서 부드럽게 풀린다. */
/** 모핑 이징. 가는 쪽·오는 쪽 모두 "출발이 빠르고 도착에서 잦아든다"여야 한다.
 *
 *  하나의 곡선을 양방향에 쓰면 안 된다. 들어갈 때 맞는 곡선을 되돌아올 때
 *  거꾸로 타면 그대로 뒤집힌 곡선이 되어, 대상이 중심에 붙어 있다가 마지막
 *  몇 프레임에 원위치로 튄다 — 돌아오는 길만 뚝 끊긴다.
 *  그래서 방향을 받아 곡선을 뒤집는다. 경계값(0, 1)에서 두 곡선이 만나므로
 *  전환이 뒤집히는 순간에도 값이 이어진다.
 *
 *  들어갈 때 in-out 을 쓰면 안 된다 — 초반 값이 거의 0 이라(ft 0.15 에서
 *  0.014) 알파는 이미 페이드인 중인데 이동은 시작도 안 해 두 층이 따로 논다. */
const easeMorph = (x: number, entering: boolean) =>
  entering ? 1 - Math.pow(1 - x, 3) : x * x * x;

const pullAt = (t: number) => Math.pow(1 - Math.min(1, Math.max(0, t)), 0.45);

// 궤도면을 위에서 살짝 기울여 본다. 3D 를 쓰지 않고 깊이를 만드는 방법.
const FLATTEN = 0.46;

type Elem = {
  kind: "mem";
  id: string;
  a: number;
  e: number;
  /** 근일점 편각 — 궤도 안에서 어디가 가장 가까운가 */
  omega: number;
  /** 궤도면 기울기(화면 공간). 방향은 이걸로 표현한다 */
  plane: number;
  theta0: number;
  n: number;
  lum: number;
  size: number;
  color: [number, number, number];
  mem: MemoryBody;
};

export function OrbitalMap({
  bodies,
  memories,
  centerLabel,
  onFocusChange,
}: {
  bodies: Body[];
  memories: MemoryBody[];
  centerLabel: string;
  /** 기억 하나에 붙었는지. 지도 바깥(계기판)이 읽는 상태에 맞춰 물러나도록. */
  onFocusChange?: (focused: boolean) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [probe, setProbe] = useState<{ x: number; y: number; text: string; sub: string } | null>(
    null,
  );
  const [focus, setFocus] = useState<MemoryBody | null>(null);
  const [picked, setPicked] = useState<Body | null>(null);

  useEffect(() => {
    onFocusChange?.(focus != null);
  }, [focus, onFocusChange]);
  // 렌더 루프가 읽는 최신 선택. 마우스가 떠나도 고른 것은 켜진 채로 남는다.
  const pickedRef = useRef<Body | null>(null);
  pickedRef.current = picked;

  // 렌더 루프가 읽는 최신 포커스. 상태를 클로저에 가두지 않기 위해 ref 로 둔다.
  const focusRef = useRef<MemoryBody | null>(null);
  focusRef.current = focus;

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const byId = new Map(bodies.map((b) => [b.id, b]));
    // 기억의 색은 근거의 주된 분야에서 온다. 분야→색은 고정 표라 전역이다.
    const colorOf = (m: MemoryBody) => {
      const dom = dominantCategory(m, byId);
      return dom ? colorOfCategory(dom) : NEUTRAL;
    };

    // ── 궤도 요소 ──
    // 주 궤도에 오르는 것은 기억뿐이다. 경험은 기억을 눌렀을 때 그 기억의
    // 위성으로만 나타난다 — 계에 떠 있는 것은 "남은 것"이어야지 "지나간 것"이
    // 전부 떠 있으면 무엇이 남았는지가 안 보인다.
    /** trigger 로 갈래를 잡고, 그 안에서 thread 로 자리를 잡는다.
     *  반환값은 궤도면의 기울기다 — 근일점 편각으로는 방향이 드러나지 않는다.
     *  이심률이 낮으면 궤도가 거의 원이고, 원은 아무리 돌려도 같은 모양이라
     *  화면에서는 눌린 수평 타원 하나로 수렴한다. 평면 자체를 기울여야 갈린다. */
    function sectorOf(m: MemoryBody): number {
      const idx = TRIGGER_ORDER.indexOf(m.trigger);
      const base = (idx < 0 ? TRIGGER_ORDER.length - 1 : idx) * SECTOR;
      // 같은 작업이면 같은 자리 — 완전히 포개지지 않게 기억 id 로 아주 조금만 흩는다
      const within = phaseOf(m.threadId ?? m.id) * SECTOR * SECTOR_FILL;
      return base + within + (phaseOf(m.id) - 0.5) * 0.08;
    }

    const els: Elem[] = memories.map((m) => {
      const a = radiusOf(m.ageDays);
      const p = phaseOf(m.id);
      return {
        kind: "mem" as const,
        id: m.id,
        a,
        // 이심률은 이 기억이 어떻게 남았는지에서 온다. 완결은 자리를 잡았고(원에 가깝다),
        // 뚫고 나온 것과 오래 비웠다 돌아온 것은 아직 궤도가 잡히지 않았다.
        e: ECC_TRIGGER[m.trigger] ?? 0.2,
        // 갈래는 trigger, 갈래 안의 자리는 thread. 같은 작업에서 나온 기억은
        // 같은 갈래 안에서 나란히 놓이고, 다른 종류의 기억은 다른 갈래로 간다.
        omega: p * Math.PI * 2,
        plane: sectorOf(m),
        theta0: p * Math.PI * 2,
        n: speedOf(a),
        lum: 1,
        color: colorOf(m),
        // 중요도가 곧 크기다. 1~10 → 4.8~12px (코로나는 이 6배까지 퍼진다)
        size: 4 + m.importance * 0.8,
        mem: m,
      };
    });

    // 기억이 하나도 없으면 궤도가 없다. 축척이 0 으로 무너지지 않게 바닥값을 둔다.
    const maxA = els.reduce((mx, e) => Math.max(mx, e.a * (1 + e.e)), 0.5);

    let w = 0;
    let h = 0;
    let cx = 0;
    let cy = 0;
    let unit = 1;
    let raf = 0;
    let mouse: { x: number; y: number } | null = null;
    let hovered: string | null = null;
    // 조준점. 실제 커서는 숨기고 이걸 그린다 — OS 커서를 코드로 옮기는 방법은
    // 없으니, 빨려드는 느낌은 화면에 그리는 수밖에 없다.
    // 그리기용 포커스. focus 가 null 이 돼도 ft 가 0 에 닿을 때까지 남는다 —
    // 안 그러면 나가는 순간 대상이 사라져 되돌아가는 모핑이 안 그려진다.
    let shownFoc: MemoryBody | null = null;
    let aim: { x: number; y: number } | null = null;
    let grab = 0; // 0 = 자유, 1 = 붙잡힘. 사이 값이 끌려가는 중이다.
    // 포커스 전환 진행도. 0 = 계 전체, 1 = 기억 하나에 붙음.
    let ft = 0;
    // 시간 배율. 무언가를 겨누고 있으면 계가 멈춘다 —
    // 관측하려면 멈춰야 한다. 실용적으로도 중요하다: 가장 중요한 대상(기억)이
    // 가장 빨리 움직여서 누르기 어려우면 안 된다.
    let simT = 0;
    // 위성(경험)은 시간축이 따로다. 아래 tScale 참고.
    let satT = 0;
    let lastNow = 0;
    let tScale = 1;
    let satScale = 1;
    let crashed = false;
    const hit = new Map<string, { x: number; y: number; r: number; kind: string }>();

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = wrap!.clientWidth;
      h = wrap!.clientHeight;
      canvas!.width = Math.round(w * dpr);
      canvas!.height = Math.round(h * dpr);
      canvas!.style.width = `${w}px`;
      canvas!.style.height = `${h}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx = w / 2;
      cy = h / 2;
      // 궤도면이 제각기 기울어 있으므로 어떤 궤도든 세로로 설 수 있다.
      // FLATTEN 을 믿고 세로 여유를 크게 잡으면 화면 밖으로 나간다.
      unit = (Math.min(w / 2, h / 2) * 0.88) / maxA;
    }

    function orbitPoint(el: Elem, t: number) {
      const theta = el.theta0 + t * el.n;
      const r = ((el.a * (1 - el.e * el.e)) / (1 + el.e * Math.cos(theta - el.omega))) * unit;
      // 궤도면 안의 좌표를 구한 뒤 평면 기울기만큼 화면에서 돌린다.
      const lx = Math.cos(theta) * r;
      const ly = Math.sin(theta) * r * FLATTEN;
      const c = Math.cos(el.plane);
      const sn = Math.sin(el.plane);
      return { x: cx + lx * c - ly * sn, y: cy + lx * sn + ly * c, theta };
    }

    function drawOrbit(el: Elem, alpha: number, group = false) {
      const b = el.a * Math.sqrt(1 - el.e * el.e);
      const c = el.a * el.e;
      ctx!.save();
      ctx!.translate(cx, cy);
      ctx!.rotate(el.plane); // ← 평면 기울기. 이게 방향이다.
      ctx!.scale(1, FLATTEN);
      ctx!.rotate(el.omega);
      ctx!.beginPath();
      ctx!.ellipse(-c * unit, 0, el.a * unit, b * unit, 0, 0, Math.PI * 2);
      ctx!.restore();
      // 궤도선도 그 기억의 색을 쓴다. 중성 청회색이면 천체와 선이 따로 놀아
      // "저 선이 누구 것인가"를 눈으로 못 잇는다 — 열다섯 개가 겹쳐 있으면 특히.
      // 위성 궤도는 이미 제 색을 쓰고 있었으니 이쪽만 어긋나 있었다.
      const lit = hovered === el.id || group;
      ctx!.strokeStyle = lit
        ? `rgba(99,230,210,${0.55 * alpha})`
        : `rgba(${el.color.join(",")},${0.22 * alpha})`;
      ctx!.lineWidth = lit ? 1.4 : 0.9;
      ctx!.stroke();
    }

    // 경험 — 테두리가 있는 원이 아니라 빛 자체다. 단단한 가장자리를 그리지
    // 않고 중심에서 바깥으로 사그라드는 그라디언트만 그린다. 기억은 심이 있는
    // 발광체이고 경험은 그 둘레를 도는 빛 — 이 차이가 둘을 가른다.
    function drawPoint(
      x: number,
      y: number,
      size: number,
      lum: number,
      lit: boolean,
      alpha: number,
      color: [number, number, number] = [228, 238, 250],
    ) {
      const rad = size * (lit ? 1.6 : 1) * 4.1;
      const c = lit ? [143, 244, 228] : color;
      const gc = c.join(",");
      // 하한을 두는 이유: 점수가 0인 경험도 "있다"는 건 보여야 한다.
      // 완전히 사그라들면 근거 6건 중 몇 개가 화면에서 사라진다.
      const peak = (lit ? 1 : 0.62 + lum * 0.38) * alpha;

      // 안쪽을 넓게 밝혀 심이 있는 것처럼 보이게 하되, 바깥은 여전히
      // 경계 없이 사그라든다. 가장자리를 그리지 않으면서 뚜렷해지는 방법이다.
      const g = ctx!.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, `rgba(${gc},${peak})`);
      g.addColorStop(0.17, `rgba(${gc},${peak * 0.86})`);
      g.addColorStop(0.32, `rgba(${gc},${peak * 0.45})`);
      g.addColorStop(0.6, `rgba(${gc},${peak * 0.12})`);
      g.addColorStop(1, `rgba(${gc},0)`);
      ctx!.fillStyle = g;
      ctx!.beginPath();
      ctx!.arc(x, y, rad, 0, Math.PI * 2);
      ctx!.fill();
    }

    // 기억 — 경험과 같은 원리다. 테두리 있는 원을 그리지 않고 중심에서
    // 사그라드는 그라디언트만 그린다. 단단한 원은 "가장자리가 어디까지인가"라는
    // 답할 수 없는 질문을 만든다 — 기억에는 경계가 없다.
    // 경험과 갈리는 건 모양이 아니라 크기와 심의 흰빛, 그리고 맥동이다.
    function drawMemory(
      x: number,
      y: number,
      radius: number,
      color: [number, number, number],
      lit: boolean,
      alpha: number,
      t: number,
    ) {
      const [r, g, b] = lit ? [143, 244, 228] : color;
      // 아주 느린 맥동. 살아 있다는 표시 정도로만.
      const pulse = reduced ? 1 : 1 + Math.sin(t * 0.5 + x * 0.01) * 0.05;
      const rad = radius * pulse * (lit ? 1.45 : 1) * 3.2;

      // 안쪽 10%만 흰빛으로 타들어가고, 거기서부터 색을 거쳐 사그라든다.
      // 정지점을 촘촘히 둬야 경계 없이도 "심이 있다"가 읽힌다.
      const gr = ctx!.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, `rgba(255,255,255,${alpha})`);
      gr.addColorStop(0.09, `rgba(${r},${g},${b},${alpha})`);
      gr.addColorStop(0.2, `rgba(${r},${g},${b},${0.78 * alpha})`);
      gr.addColorStop(0.36, `rgba(${r},${g},${b},${0.34 * alpha})`);
      gr.addColorStop(0.62, `rgba(${r},${g},${b},${0.1 * alpha})`);
      gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx!.fillStyle = gr;
      ctx!.beginPath();
      ctx!.arc(x, y, rad, 0, Math.PI * 2);
      ctx!.fill();
    }

    // 프레임 하나가 던지면 rAF 사슬이 끊기고 루프가 영원히 멈춘다. 그러면
    // 화면은 마지막 프레임인 채로 굳고, hit 맵도 그때 그대로라 클릭이 엉뚱한
    // 대상에 붙는다 — 포커스가 안 풀리고 궤도가 안 도는 것처럼 보인다.
    // 원인은 화면 밖(데이터 한 건이 빠졌다든가)인데 증상은 지도 전체 정지다.
    // 한 프레임을 잃더라도 다음 프레임은 반드시 예약한다.
    function frame(now: number) {
      try {
        step(now);
      } catch (err) {
        if (!crashed) {
          crashed = true;
          console.error("[orbital-map] 프레임 오류", err);
        }
      }
      raf = requestAnimationFrame(frame);
    }

    /** 조준점. 자유로울 때는 작은 십자, 붙잡히면 고리가 조여들며 색이 켜진다.
     *  대상 위에 정확히 겹치므로 고리는 천체보다 조금 크게 남겨 가리지 않는다. */
    function drawAim() {
      if (!aim) return;
      const g = grab;
      ctx!.save();
      ctx!.strokeStyle = `rgba(99,230,210,${0.82 + g * 0.18})`;
      ctx!.lineWidth = 1;

      if (g > 0.02) {
        // 붙잡힘 — 고리. 조여들수록 작아진다.
        const r = 22 - g * 8;
        ctx!.globalAlpha = g;
        ctx!.beginPath();
        ctx!.arc(aim.x, aim.y, r, 0, Math.PI * 2);
        ctx!.stroke();
        // 네 방향 짧은 눈금 — 고리만 있으면 후광과 섞여 안 보인다
        for (let i = 0; i < 4; i++) {
          const a = (i * Math.PI) / 2;
          ctx!.beginPath();
          ctx!.moveTo(aim.x + Math.cos(a) * (r + 3), aim.y + Math.sin(a) * (r + 3));
          ctx!.lineTo(aim.x + Math.cos(a) * (r + 7), aim.y + Math.sin(a) * (r + 7));
          ctx!.stroke();
        }
      }

      // 자유로울 때의 십자. 이게 커서를 대신하므로 "겨우 보이는" 정도여선
      // 안 된다 — 검은 배경에 1px 짜리 4획이면 어디 있는지 놓친다.
      // 팔을 길게 빼고 가운데 점을 둬서 위치가 한눈에 잡히게 한다.
      // 붙잡히면 고리에 자리를 내주고 옅어진다.
      ctx!.globalAlpha = 1 - g * 0.7;
      const IN = 3.5;
      const OUT = 11;
      ctx!.beginPath();
      ctx!.moveTo(aim.x - OUT, aim.y);
      ctx!.lineTo(aim.x - IN, aim.y);
      ctx!.moveTo(aim.x + IN, aim.y);
      ctx!.lineTo(aim.x + OUT, aim.y);
      ctx!.moveTo(aim.x, aim.y - OUT);
      ctx!.lineTo(aim.x, aim.y - IN);
      ctx!.moveTo(aim.x, aim.y + IN);
      ctx!.lineTo(aim.x, aim.y + OUT);
      ctx!.stroke();

      // 가운데 점 — 획만 있으면 정확히 어디를 가리키는지가 빈칸으로 남는다
      ctx!.fillStyle = `rgba(143,244,228,${0.95 * (1 - g * 0.7)})`;
      ctx!.beginPath();
      ctx!.arc(aim.x, aim.y, 1.4, 0, Math.PI * 2);
      ctx!.fill();
      ctx!.restore();
    }

    function step(now: number) {
      const dt = lastNow ? Math.min(0.1, (now - lastNow) / 1000) : 0;
      lastNow = now;
      // 시간축이 둘이다.
      //   simT — 계 전체(기억). 겨누고 있거나 기억 하나에 붙어 있으면 멈춘다.
      //          포커스 중에 뒤에서 계속 돌면 빠져나왔을 때 자리가 달라져 있어
      //          "어디서 들어왔는지"를 잃는다.
      //   satT — 포커스 안의 위성(경험). 겨누고 있을 때만 멈춘다.
      // 예전에는 하나였다. 그래서 포커스에 들어가는 순간 위성까지 같이 얼어
      // 근거가 도는 게 아니라 박혀 있었다 — 멈춰야 하는 건 배경이지 대상이 아니다.
      // 전환 중에는 멈추지 않는다. 초점을 매 프레임 다시 구하므로 착지점이
      // 움직여도 인수인계가 어긋나지 않는다 — 얼려둘 이유가 없다.
      // 빠져나오는 순간부터 계가 다시 돌기 시작하고, 돌아가는 천체는 제자리가
      // 아니라 "지금 있어야 할 자리"로 날아간다. 그게 궤도다.
      const scaleTarget = hovered || focusRef.current ? 0 : 1;
      tScale += (scaleTarget - tScale) * 0.16;
      simT += dt * tScale;
      const satTarget = hovered ? 0 : 1;
      satScale += (satTarget - satScale) * 0.16;
      satT += dt * satScale;
      const t = reduced ? 0 : simT;
      const ts = reduced ? 0 : satT;

      const target = focusRef.current ? 1 : 0;
      ft += (target - ft) * 0.075;
      if (Math.abs(target - ft) < 0.002) ft = target;

      ctx!.clearRect(0, 0, w, h);
      hit.clear();

      // 알파도 이동과 같은 시계를 쓴다. 선형 알파 + 이징 이동이면 화면이
      // 반쯤 지워졌는데 대상은 아직 출발도 안 한 상태가 생긴다.
      const ez = easeMorph(ft, focusRef.current != null);
      const sysAlpha = 1 - ez;
      if (focusRef.current) shownFoc = focusRef.current;
      else if (ft < 0.01) shownFoc = null;
      const foc = shownFoc;

      // 카메라. 누른 천체를 초점으로 계 전체를 확대하면서 그 천체를 화면
      // 중앙으로 데려간다. 크로스페이드만 하면 "다른 화면으로 갈아탔다"가
      // 되는데, 초점을 향해 밀고 들어가면 "그 안으로 들어갔다"가 된다.
      //
      // 초점은 그 천체의 "지금" 궤도 위치다. 클릭 순간의 좌표를 저장해 쓰면
      // 안 된다 — 돌아올 때 계가 다시 돌기 시작하면 실제 궤도 위치는 이미
      // 딴 데 가 있고, 전환이 끝나 시스템 레이어로 넘어가는 순간 그 차이만큼
      // 천체가 뚝 튄다. 매 프레임 다시 구하면 넘겨주는 지점이 정확히 맞는다.
      const focEl = foc ? els.find((e) => e.id === foc.id) : null;
      const fp = focEl ? orbitPoint(focEl, t) : null;
      const fx = fp ? fp.x : cx;
      const fy = fp ? fp.y : cy;
      const camZ = 1 + ez * (ZOOM - 1);
      const camX = fx + (cx - fx) * ez;
      const camY = fy + (cy - fy) * ez;

      // ── 계 전체 ──
      const litTrigger = hovered?.startsWith("maxis:") ? hovered.slice(6) : null;
      if (sysAlpha > 0.01) {
        ctx!.save();
        if (fp && ft > 0.001) {
          ctx!.translate(camX, camY);
          ctx!.scale(camZ, camZ);
          ctx!.translate(-fx, -fy);
        }
        // 갈래 축. 포커스 안의 결과 축과 같은 원리다 — 갈래를 정하는 건
        // trigger 고 thread 는 그 안에서 조금 틀 뿐이니, 축은 종류마다 하나면
        // 된다. 갈래 한가운데라는 임의의 자리가 아니라 그 종류에 속한 기억들이
        // 실제로 쓰는 평면 각도의 평균에 긋는다.
        // 축이 궤도보다 먼저다 — 선은 배경이지 대상이 아니다.
        const mAxis = new Map<string, { sum: number; n: number }>();
        for (const el of els) {
          const acc = mAxis.get(el.mem.trigger) ?? { sum: 0, n: 0 };
          acc.sum += el.plane;
          acc.n += 1;
          mAxis.set(el.mem.trigger, acc);
        }
        const AX = Math.min(w / 2, h / 2) * 1.02;
        ctx!.font = '11.5px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx!.textBaseline = "middle";
        for (const [tr, acc] of mAxis) {
          const ang = acc.sum / acc.n;
          const dx = Math.cos(ang);
          const dy = Math.sin(ang) * FLATTEN;
          const on = litTrigger === tr;
          // 축은 색을 쓰지 않는다. 색은 분야의 것이라, 축에 색을 주면
          // 한 화면에 서로 다른 두 색 언어가 겹친다.
          ctx!.strokeStyle = on
            ? `rgba(99,230,210,${0.6 * sysAlpha})`
            : `rgba(${NEUTRAL.join(",")},${0.22 * sysAlpha})`;
          ctx!.lineWidth = on ? 1.2 : 0.8;
          ctx!.setLineDash(on ? [] : [3, 7]);
          ctx!.beginPath();
          ctx!.moveTo(cx - dx * AX, cy - dy * AX);
          ctx!.lineTo(cx + dx * AX, cy + dy * AX);
          ctx!.stroke();
          ctx!.setLineDash([]);

          const label = tag(tr);
          const lx = cx + dx * (AX + 16);
          const ly = cy + dy * (AX + 16);
          ctx!.textAlign = dx >= 0 ? "left" : "right";
          ctx!.fillStyle = on
            ? `rgba(143,244,228,${sysAlpha})`
            : `rgba(158,171,190,${0.9 * sysAlpha})`;
          ctx!.fillText(label, lx, ly);

          if (ez < 0.02) {
            const half = ctx!.measureText(label).width / 2 + 8;
            hit.set(`maxis:${tr}`, {
              x: lx + (dx >= 0 ? half - 8 : -(half - 8)),
              y: ly,
              r: Math.max(16, half),
              kind: "maxis",
            });
          }
        }

        for (const el of els) drawOrbit(el, sysAlpha, litTrigger === el.mem.trigger);
        // 깊이 정렬. 기울여 본 평면이므로 화면 아래쪽(y > cy)이 관찰자에게
        // 가까운 쪽이다. 뒤쪽을 먼저, 중심을, 그다음 앞쪽을 그려야 앞을 지나는
        // 천체가 중심 위로 지나간다 — 안 그러면 전부 중심 뒤로 숨는다.
        const placed = els.map((el) => ({ el, p: orbitPoint(el, t) }));

        for (const { el, p } of placed) {
          if (p.y > cy) continue; // 앞쪽은 나중에
          if (foc && el.id === foc.id) continue; // 모핑 중인 대상은 따로 그린다
          drawMemory(p.x, p.y, el.size, el.color, hovered === el.id || litTrigger === el.mem.trigger, sysAlpha, t);
        }

        // 질량 중심
        const pulse = reduced ? 1 : 1 + Math.sin(t * 1.1) * 0.06;
        const cg = ctx!.createRadialGradient(cx, cy, 0, cx, cy, 46 * pulse);
        cg.addColorStop(0, `rgba(255,255,255,${0.95 * sysAlpha})`);
        cg.addColorStop(0.16, `rgba(214,236,255,${0.5 * sysAlpha})`);
        cg.addColorStop(1, "rgba(150,200,255,0)");
        ctx!.fillStyle = cg;
        ctx!.beginPath();
        ctx!.arc(cx, cy, 46 * pulse, 0, Math.PI * 2);
        ctx!.fill();
        ctx!.fillStyle = `rgba(255,255,255,${sysAlpha})`;
        ctx!.beginPath();
        ctx!.arc(cx, cy, 3.2, 0, Math.PI * 2);
        ctx!.fill();

        for (const { el, p } of placed) {
          if (p.y <= cy) continue; // 뒤쪽은 이미 그렸다
          if (foc && el.id === foc.id) continue;
          drawMemory(p.x, p.y, el.size, el.color, hovered === el.id || litTrigger === el.mem.trigger, sysAlpha, t);
        }
        ctx!.restore();

        // 판정은 변환이 걸리지 않은 정지 상태에서만 받는다. hit 좌표는 변환
        // 이전 공간이라, 카메라가 움직이는 동안 등록하면 보이는 곳과 눌리는
        // 곳이 어긋난다. 전환 중에는 아무것도 못 누르는 편이 낫다.
        for (const { el, p } of placed) {
          if (ez < 0.02) hit.set(el.id, { x: p.x, y: p.y, r: el.size + 14, kind: "mem" });
        }
      }

      // ── 기억 하나에 붙었을 때 ──
      if (foc && ft > 0.01) {
        const refs = foc.referencedIds.map((id) => byId.get(id)).filter(Boolean) as Body[];
        // 궤도가 안에서 바깥으로 펴지며 나타난다. 다 자란 채로 페이드인하면
        // 대상이 커지는 움직임과 어긋나 두 층이 따로 논다.
        const R = Math.min(w, h) * 0.3 * (0.78 + 0.22 * ez);

        // 점수를 고정값(140)으로 나누면 실제 데이터가 0~70 일 때 표현 범위의
        // 절반만 쓰게 되어 차이가 뭉갠다. 지금 화면에 올라온 것들 중 최댓값을
        // 기준으로 정규화해서 있는 폭을 다 쓴다.
        const topScore = Math.max(1, ...refs.map((b) => b.memoryScore));

        // 위치와 궤도를 먼저 계산해두고, 그린 순서를 깊이에 맞춘다.
        const sats = refs.map((b, i) => {
          // 기억 점수가 곧 그 경험의 광도다. 이 기억을 만든 힘이 셌던 경험이
          // 더 밝게 남는다 — 근거 여섯 개가 똑같은 밝기로 떠 있으면
          // "무엇 때문에 이 기억이 생겼는지"를 화면이 답하지 못한다.
          const ratio = Math.max(0, Math.min(1, b.memoryScore / topScore));
          const lum = 0.26 + ratio * 0.74;
          // 크기 폭을 넓혔다. 후광 세기만으로 구분되면 "밝다"는 인상만 남고
          // 어느 쪽이 더 큰지는 못 읽는다.
          const size = 3.8 + ratio * 6.8;

          // 점수가 높을수록 안쪽에 놓인다. 핵심 근거가 기억에 가깝다.
          const ra = (0.92 - ratio * 0.42 + ((i % 3) - 1) * 0.06) * R;

          // 갈래는 outcome, 갈래 안의 자리는 category.
          // 같은 결과를 낸 경험들이 한 방향에 모이고, 그 안에서 카테고리별로 갈린다.
          const oi = OUTCOME_ORDER.indexOf(b.outcome ?? "");
          const base = (oi < 0 ? OUTCOME_ORDER.length - 1 : oi) * SAT_SECTOR;
          const plane =
            base +
            phaseOf(b.category) * SAT_SECTOR * SAT_FILL +
            (phaseOf(b.id) - 0.5) * 0.06;
          const omega = phaseOf(b.id) * Math.PI * 2;
          // 찌그러짐은 outcome. 막힌 경험일수록 기억과의 거리가 들쭉날쭉하다.
          const ecc = ECC[b.outcome ?? ""] ?? 0.3;

          const speed = 0.16 / Math.pow(ra / R, 1.5);
          const th = phaseOf(b.id) * Math.PI * 2 + ts * speed;
          const rr = (ra * (1 - ecc * ecc)) / (1 + ecc * Math.cos(th - omega));
          const lx = Math.cos(th) * rr;
          const ly = Math.sin(th) * rr * FLATTEN;
          const pc = Math.cos(plane);
          const ps = Math.sin(plane);
          return {
            b,
            lum,
            size,
            ra,
            omega,
            plane,
            ecc,
            color: colorOfCategory(b.category),
            isSource: b.id === foc.sourceId,
            x: cx + lx * pc - ly * ps,
            y: cy + lx * ps + ly * pc,
          };
        });

        // ── 갈래 축 ──
        // 방향을 정하는 건 outcome 이고, category 는 그 갈래 안에서 조금 틀 뿐이다.
        // 그러니 축은 결과마다 하나면 된다 — 다만 갈래 한가운데라는 임의의 자리가
        // 아니라, 그 결과에 속한 위성들이 실제로 쓰는 평면 각도의 평균에 긋는다.
        // (한 갈래의 폭이 25도 남짓이라 감싸돌 일이 없어 산술평균으로 충분하다.)
        // 축은 색을 쓰지 않는다. 여러 카테고리를 아우르는 선이라 색을 주면
        // 그중 하나를 대표하는 것처럼 읽힌다 — 색은 천체에만 둔다.
        // 라벨을 겨누고 있으면 그 결과 갈래 전체가 켜진다.
        const litOutcome = hovered?.startsWith("axis:") ? hovered.slice(5) : null;

        const angleSum = new Map<string, { sum: number; n: number }>();
        for (const b of refs) {
          const oc = b.outcome ?? "explore";
          const oi = OUTCOME_ORDER.indexOf(oc);
          const base = (oi < 0 ? OUTCOME_ORDER.length - 1 : oi) * SAT_SECTOR;
          const ang = base + phaseOf(b.category) * SAT_SECTOR * SAT_FILL;
          const acc = angleSum.get(oc) ?? { sum: 0, n: 0 };
          acc.sum += ang;
          acc.n += 1;
          angleSum.set(oc, acc);
        }

        ctx!.font = '11.5px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx!.textBaseline = "middle";
        for (const [oc, acc] of angleSum) {
          const ang = acc.sum / acc.n;
          const dx = Math.cos(ang);
          const dy = Math.sin(ang) * FLATTEN;
          const len = R * 1.62;
          const on = litOutcome === oc;

          ctx!.strokeStyle = on
            ? `rgba(99,230,210,${0.6 * ez})`
            : `rgba(150,175,210,${0.22 * ez})`;
          ctx!.lineWidth = on ? 1.1 : 0.8;
          ctx!.setLineDash(on ? [] : [3, 6]);
          ctx!.beginPath();
          ctx!.moveTo(cx - dx * len, cy - dy * len);
          ctx!.lineTo(cx + dx * len, cy + dy * len);
          ctx!.stroke();
          ctx!.setLineDash([]);

          const label = tag(oc);
          const lx = cx + dx * (len + 16);
          const ly = cy + dy * (len + 16);
          ctx!.textAlign = dx >= 0 ? "left" : "right";
          ctx!.fillStyle = on
            ? `rgba(143,244,228,${ez})`
            : `rgba(158,171,190,${0.9 * ez})`;
          ctx!.fillText(label, lx, ly);

          // 라벨을 겨눌 수 있게 한다 — 방향을 이름으로 짚으면 그 갈래가 켜진다.
          if (ez > 0.98) {
            const half = ctx!.measureText(label).width / 2 + 8;
            hit.set(`axis:${oc}`, {
              x: lx + (dx >= 0 ? half - 8 : -(half - 8)),
              y: ly,
              r: Math.max(16, half),
              kind: "axis",
            });
          }
        }

        // 궤도선은 전부 먼저. 선은 깊이를 다툴 만큼 두껍지 않다.
        for (const st of sats) {
          const sb = st.ra * Math.sqrt(1 - st.ecc * st.ecc);
          ctx!.save();
          ctx!.translate(cx, cy);
          ctx!.rotate(st.plane); // ← 평면 기울기. 이게 방향이다.
          ctx!.scale(1, FLATTEN);
          ctx!.rotate(st.omega);
          ctx!.beginPath();
          ctx!.ellipse(-st.ra * st.ecc, 0, st.ra, sb, 0, 0, Math.PI * 2);
          ctx!.restore();
          const onAxis = litOutcome === (st.b.outcome ?? "explore");
          ctx!.strokeStyle = onAxis
            ? `rgba(99,230,210,${0.5 * ez})`
            : `rgba(${st.color.join(",")},${(0.11 + st.lum * 0.18) * ez})`;
          ctx!.lineWidth = onAxis ? 1.1 : 0.9;
          ctx!.stroke();
        }

        // 뒤쪽 위성 → 기억 → 앞쪽 위성. 이래야 앞을 지나는 경험이
        // 기억 위로 지나간다(전부 먼저 그리면 늘 기억 뒤로 숨는다).
        // 이 기억을 실제로 만든 경험에는 테를 두른다. 나머지는 같은 작업에서
        // 딸려온 것들이라, 표시가 없으면 "왜 이 기억이 생겼는가"에 답이 안 된다.
        function drawSat(st: (typeof sats)[number]) {
          const on =
            hovered === st.b.id ||
            pickedRef.current?.id === st.b.id ||
            litOutcome === (st.b.outcome ?? "explore");
          drawPoint(st.x, st.y, st.size, st.lum, on, ez, st.color);
          if (!st.isSource) return;
          ctx!.strokeStyle = `rgba(${st.color.join(",")},${0.5 * ez})`;
          ctx!.lineWidth = 0.9;
          ctx!.beginPath();
          ctx!.arc(st.x, st.y, st.size * 1.9, 0, Math.PI * 2);
          ctx!.stroke();
        }

        for (const st of sats) {
          if (st.y > cy) continue;
          drawSat(st);
        }

        // 두 화면을 통틀어 계속 존재하는 유일한 것. 사라졌다 나타나는 게
        // 아니라 자리를 옮기며 자란다 — 이게 모핑이다. 그래서 알파도 1 이다.
        const toR = 18 + foc.importance * 1.2;
        // 출발 크기도 계가 그렸을 크기와 같아야 넘겨주는 지점이 안 튄다.
        const fromR = focEl ? focEl.size : toR;
        drawMemory(
          camX,
          camY,
          fromR + (toR - fromR) * ez,
          colorOf(foc),
          hovered === foc.id,
          1,
          t,
        );

        for (const st of sats) {
          if (st.y <= cy) continue;
          drawSat(st);
        }

        for (const st of sats) {
          if (ez > 0.98) hit.set(st.b.id, { x: st.x, y: st.y, r: 18, kind: "exp" });
        }

        if (ez > 0.98) hit.set(foc.id, { x: cx, y: cy, r: 32, kind: "focus" });
      }

      // ── 판독 대상 ──
      const near = mouse ? nearest(mouse) : null;
      const found: string | null = near?.id ?? null;

      // ── 조준점 ──
      // 붙잡힘의 세기는 거리에 반비례한다. 가장자리에서는 거의 안 끌리고
      // 안으로 들어올수록 급히 빨려든다 — 경계에서 딱 달라붙으면 튀어 보인다.
      if (mouse) {
        const pull = near ? pullAt(near.d / (near.p.r * CAPTURE)) : 0;
        grab += (pull - grab) * (reduced ? 1 : 0.28);
        const tx = near ? mouse.x + (near.p.x - mouse.x) * grab : mouse.x;
        const ty = near ? mouse.y + (near.p.y - mouse.y) * grab : mouse.y;
        aim = aim && !reduced
          ? { x: aim.x + (tx - aim.x) * 0.42, y: aim.y + (ty - aim.y) * 0.42 }
          : { x: tx, y: ty };
      } else {
        aim = null;
        grab = 0;
      }
      if (found !== hovered) {
        hovered = found;
        const p = found ? hit.get(found) : null;
        if (!found || !p) setProbe(null);
        else if (p.kind === "maxis") {
          const tr = found.slice(6);
          const inGroup = memories.filter((m) => m.trigger === tr).length;
          setProbe({
            x: p.x,
            y: p.y,
            text: `${tag(tr)} 로 남은 기억 ${inGroup}건`,
            sub: "이 방향의 궤도들",
          });
        } else if (p.kind === "axis") {
          const oc = found.slice(5);
          const inGroup = (focusRef.current?.referencedIds ?? []).filter(
            (id) => (byId.get(id)?.outcome ?? "explore") === oc,
          ).length;
          setProbe({
            x: p.x,
            y: p.y,
            text: `${tag(oc)} 로 끝난 경험 ${inGroup}건`,
            sub: "이 방향의 궤도들",
          });
        } else if (p.kind === "mem" || p.kind === "focus") {
          const m = memories.find((x) => x.id === found)!;
          setProbe({
            x: p.x,
            y: p.y,
            text: m.title,
            sub: `기억 · ${tag(m.trigger)} · 중요도 ${m.importance} · 근거 ${m.referencedIds.length}건`,
          });
        } else {
          const b = byId.get(found)!;
          setProbe({
            x: p.x,
            y: p.y,
            text: b.summary,
            sub: `${tag(b.category)} · ${new Date(b.occurredAt).toISOString().slice(0, 10).replace(/-/g, ".")} · ${tag(b.outcome)} · M${b.memoryScore}`,
          });
        }
      } else if (found && probeRef.current) {
        const p = hit.get(found)!;
        probeRef.current.style.transform = `translate(${p.x + 18}px, ${p.y - 12}px)`;
      }

      // 조준점은 마지막에. 무엇보다 위에 있어야 가려지지 않는다.
      drawAim();
    }

    function onMove(e: MouseEvent) {
      const rect = canvas!.getBoundingClientRect();
      mouse = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }
    function onLeave() {
      mouse = null;
    }
    // 클릭 시점에 다시 판정한다. hovered 는 rAF 루프가 갱신하는 값이라,
    // 마우스를 옮기자마자 누르면 아직 프레임이 안 돌아 null 인 채로 남는다 —
    // 빠르게 움직여 누르는 사용자에게는 클릭이 통째로 씹힌다.
    function pickAt(pt: { x: number; y: number }): string | null {
      return nearest(pt)?.id ?? null;
    }

    /** 가장 가까운 대상과 그 거리. 판정 반경을 CAPTURE 배로 넓혀 잡는다 —
     *  조준점이 빨려드는 범위와 실제로 눌리는 범위가 다르면, 붙잡힌 것처럼
     *  보이는데 클릭은 빗나가는 최악의 상태가 된다. 하나의 값으로 둘 다 쓴다. */
    function nearest(pt: { x: number; y: number }) {
      let best = Infinity;
      let found: { id: string; p: (typeof hit) extends Map<string, infer V> ? V : never } | null =
        null;
      for (const [id, p] of hit) {
        const d = Math.hypot(p.x - pt.x, p.y - pt.y);
        if (d < p.r * CAPTURE && d < best) {
          best = d;
          found = { id, p };
        }
      }
      return found ? { ...found, d: best } : null;
    }

    // 클릭 좌표는 이벤트에서 직접 읽는다. 마지막으로 기록된 mouse 를 쓰면
    // 마우스를 움직이지 않고 누른 경우(또는 mousemove 가 한 번 빠진 경우)
    // 옛 위치가 그대로 남아, 빈 곳을 눌러도 직전 대상이 잡혀 포커스가 안 풀린다.
    function onClick(e: MouseEvent) {
      const rect = canvas!.getBoundingClientRect();
      const at = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      mouse = at;
      hovered = pickAt(at);
      if (!hovered) {
        // 빈 곳을 누르면 계 전체로 돌아온다
        setFocus(null);
        setPicked(null);
        return;
      }
      const p = hit.get(hovered);
      if (!p) return;
      if (p.kind === "axis" || p.kind === "maxis") return; // 축은 겨누기만 한다
      if (p.kind === "mem") {
        setFocus(memories.find((m) => m.id === hovered) ?? null);
        setPicked(null); // 다른 기억으로 옮겨가면 이전 선택은 의미가 없다
      } else if (p.kind === "focus") {
        setFocus(null);
        setPicked(null);
      } else {
        setPicked(byId.get(hovered) ?? null);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setFocus(null);
        setPicked(null);
      }
    }

    resize();
    raf = requestAnimationFrame(frame);
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseleave", onLeave);
    canvas.addEventListener("click", onClick);
    window.addEventListener("keydown", onKey);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mouseleave", onLeave);
      canvas.removeEventListener("click", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [bodies, memories]);

  const probeRef = useRef<HTMLDivElement>(null);

  // 지금 펼친 기억의 근거들이 어떤 카테고리인지 — 범례에 쓴다.
  // 캔버스 안의 배분과 같은 함수를 써야 색이 어긋나지 않는다.
  // 중심 기억이 쓰고 있는 색이 어느 분야인지. 범례에서 이것만 테를 두른다 —
  // 중심도 위성과 같은 팔레트를 쓰는데 표시가 없으면 "가운데 저 색은 뭔가"에
  // 답이 없다.
  const focusDominantGroup = focus
    ? (() => {
        const dom = dominantCategory(focus, new Map(bodies.map((b) => [b.id, b])));
        return dom ? groupOfCategory(dom).key : null;
      })()
    : null;

  // 이 기억의 근거에 등장하는 색 묶음만. 카테고리 단위로 적으면 같은 색인
  // 항목이 둘 나란히 놓여 "왜 같은 색이 둘이지"가 된다 — 색의 범례이므로
  // 색 단위로 적는다. 정확한 카테고리는 위성을 겨누면 판독값에 나온다.
  const focusGroups = (() => {
    if (!focus) return [] as typeof CAT_GROUPS;
    const known = new Set(focus.referencedIds);
    const keys = new Set(
      bodies.filter((b) => known.has(b.id)).map((b) => groupOfCategory(b.category).key),
    );
    return CAT_GROUPS.filter((g) => keys.has(g.key));
  })();

  return (
    <div ref={wrapRef} className="relative h-full w-full">
      <canvas ref={canvasRef} className="map-canvas" />

      {/* 중심 라벨 */}
      <div
        className={`pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 text-center ${
          focus ? "mt-9" : "mt-6"
        }`}
      >
        <span className="tick">{focus ? "기억" : centerLabel}</span>
        {!focus && memories.length === 0 && (
          <div className="tick mt-3 opacity-60">아직 궤도에 남은 것이 없다</div>
        )}
      </div>

      {probe && (
        <div
          ref={probeRef}
          className="probe"
          style={{ transform: `translate(${probe.x + 18}px, ${probe.y - 12}px)` }}
        >
          <div className="readout mb-1.5 text-[10px] tracking-[0.16em] text-lum-3">{probe.sub}</div>
          <div className="font-sans text-[13px] leading-snug text-lum-0">{probe.text}</div>
        </div>
      )}

      {/* 붙어 있는 기억 */}
      {focus && (
        <div className="pointer-events-none absolute left-1/2 top-16 w-full max-w-lg -translate-x-1/2 px-6 text-center">
          <div className="settle">
            <div className="tick mb-2">
              {tag(focus.trigger)} · 근거 {focus.referencedIds.length}건
            </div>
            <h2 className="text-[17px] font-medium text-lum-0">{focus.title}</h2>
            {/*<p className="utterance mt-3 text-[14px] text-lum-1">{focus.body}</p>*/}

            {/* 색 범례 — 색만 칠하고 무슨 뜻인지 안 적으면 그냥 알록달록한 점이 된다.
                무엇의 범례인지도 적어야 한다. 색점만 늘어놓으면 태그로 읽힌다. */}
            <div className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
              <span className="tick" style={{ color: "var(--color-lum-3)" }}>
                색 = 분야
              </span>
              {focusGroups.map((g) => {
                const col = g.color;
                const isCenter = g.key === focusDominantGroup;
                return (
                  <span key={g.key} className="flex items-center gap-2">
                    <span
                      className="inline-block h-1.5 w-1.5 rounded-full"
                      style={{
                        background: `rgb(${col.join(",")})`,
                        boxShadow: isCenter
                          ? `0 0 0 3px rgba(${col.join(",")},.28), 0 0 10px 2px rgba(${col.join(",")},.6)`
                          : `0 0 8px 1px rgba(${col.join(",")},.5)`,
                      }}
                    />
                    <span
                      className="tick"
                      style={{ color: isCenter ? "var(--color-lum-0)" : "var(--color-lum-2)" }}
                      title={isCenter ? "이 기억의 주된 분야 — 중심이 쓰는 색" : undefined}
                    >
                      {g.label}
                    </span>
                  </span>
                );
              })}
            </div>

          </div>
        </div>
      )}

      {/* 고른 경험 */}
      {picked && (
        <div className="pointer-events-none absolute bottom-44 left-1/2 w-full max-w-lg -translate-x-1/2 px-6 text-center">
          <div className="settle">
            <div className="tick mb-2">
              경험 · {new Date(picked.occurredAt).toISOString().slice(0, 10).replace(/-/g, ".")} ·{" "}
              {tag(picked.outcome)} · M{picked.memoryScore}
            </div>
            <p className="font-sans text-[14px] leading-relaxed text-lum-0">{picked.summary}</p>
          </div>
        </div>
      )}
    </div>
  );
}
