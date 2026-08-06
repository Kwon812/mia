"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { clampSentence, type ExperienceCategory } from "@na/shared";

import { formatKstYmd } from "@/lib/date";

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
  kind: "memory";
  id: string;
  /** 같은 작업에서 나온 기억끼리 궤도 방향을 공유하기 위한 값 */
  threadId: string | null;
  title: string;
  body: string;
  importance: number;
  trigger: string;
  occurredAt: number;
  ageDays: number;
  /** 남은 이유 전부. 방향·이심률은 위 trigger(가장 센 것)가 정한다. */
  triggers: string[];
  /** 이 기억의 근거가 된 경험들 */
  referencedIds: string[];
  /** 그중 이 기억을 실제로 만든 경험 (memories.experience_id). 나머지는 같은 작업에서 딸려온 것들 */
  /** 테두리를 두를 경험들.
   *  기억이면 그 기억을 만든 근거(experience_ids), 갈래면 그 갈래를 시작한 경험.
   *  위성은 갈래 경험 **전부**를 보여주고, 이 목록만 테두리로 구분한다 —
   *  "이 일에 뭐가 있었나"와 "그중 뭐가 남았나"는 다른 질문이라 한 화면에 둘 다
   *  있어야 한다. */
  sourceIds: string[];
  /** 그 경험에서 쓴 스킬(비중 내림차순). firstTime 이 이 기억을 남긴 근거다 —
   *  trigger=new_skill 만으로는 "무슨 스킬?"에 답할 수 없다. */
  skills: { name: string; firstTime: boolean }[];
};

/**
 * 갈래 — 여러 날에 걸쳐 하나로 이어진 작업(threads).
 *
 * 기억이 "남은 것"이라면 갈래는 "이어지는 것"이다. 그래서 기억과 같은 계에
 * 뜨되 **바깥 궤도**를 돈다 — 기억 여럿을 아우르는 더 큰 구조라는 뜻이고,
 * 기존 기억 배치를 한 칸도 건드리지 않는다는 실리도 있다.
 *
 * 방향은 status 다. trigger·outcome 과 같은 위계 — 값이 고정 개수라 나눠도
 * 뭉개지지 않는다. 지금은 데이터가 어려 전부 active 라 한 방향에 모이지만,
 * completed 가 하나 나오는 순간 방향이 갈리는 것 자체가 정보다.
 * 색은 기억과 달리 자기 category 를 그대로 쓴다(갈래는 분야를 스스로 갖는다).
 */
export type ThreadBody = {
  kind: "thread";
  id: string;
  title: string;
  category: string;
  /** active | completed | abandoned */
  status: string;
  /** 이 갈래에 붙은 경험 수 — 크기가 된다 */
  experienceCount: number;
  /** 시작 시각 (반경의 근거) */
  occurredAt: number;
  /** 완결 시각. active·abandoned 는 null */
  completedAt: number | null;
  ageDays: number;
  /** 이 갈래에 속한 경험들 — 누르면 위성으로 펼쳐진다 */
  referencedIds: string[];
  /** 이 갈래를 시작한 경험. 기억의 sourceIds 와 같은 자리를 쓴다. */
  sourceIds: string[];
};

/** 주 궤도에 오르는 것들. 누르면 referencedIds 가 위성으로 펼쳐진다는 점이 같다. */
export type OrbitBody = MemoryBody | ThreadBody;

const ECC: Record<string, number> = {
  success: 0.06,
  partial: 0.24,
  explore: 0.38,
  stuck: 0.56,
};

// 축과 중심처럼 어느 분야에도 속하지 않는 것들의 색. 근거가 화면 밖
// (경험 220건 상한 바깥)이라 분야를 못 정하는 기억도 여기로 떨어진다.
// etc 묶음과는 값이 달라야 한다 — 같으면 "기타 분야"와 "분야 없음"이 한 색이 된다.
const NEUTRAL: [number, number, number] = [150, 165, 190];

// 기억 궤도의 큰 갈래는 trigger 가 정한다. 다섯 개로 고정된 값이라 360도를
// 나눠도 갈래가 뭉개지지 않는다 — thread 는 계속 늘어나는 값이라 등간격으로
// 나누면 스물만 넘어도 18도씩이 되어 방향이 정보가 못 된다.
// 그래서 굵은 분할은 trigger, 그 안에서의 자리는 thread 가 맡는다.
export const TRIGGER_ORDER = [
  'new_skill',
  'thread_complete',
  'breakthrough',
  'deepened',
  'revival',
  'comeback',
];

// 섹터를 π 로 나눈다(2π 가 아니라). 타원은 180도 돌리면 자기 자신이라
// 그 너머는 같은 방향으로 보인다 — 실제로 쓸 수 있는 각도는 절반뿐이다.
const SECTOR = Math.PI / TRIGGER_ORDER.length;
// 섹터 사이에 빈 각도를 남겨야 다섯 무리가 서로 구분된다.
const SECTOR_FILL = 0.55;

// ── 갈래(thread) ──
// 이심률 — 그 작업이 어떤 상태인지가 궤도의 안정성이 된다.
// 방향은 분야가 가져갔다(THREAD_SECTOR, CAT_GROUPS 아래). status 는 값이 셋인데
// 실제로는 거의 전부 active 라, 방향에 실으면 섹터가 하나로 뭉쳐 아무것도
// 못 읽는다. 개수가 고정이라도 **분포가 쏠린 값**은 방향에 못 쓴다.
const ECC_STATUS: Record<string, number> = {
  completed: 0.05, // 끝냈다. 자리를 잡았다.
  active: 0.22, // 아직 돌고 있다
  // 놓았다. 궤도선을 아예 안 그리고 회전도 멈추므로 이심률은 자리만 흔든다 —
  // 0 으로 둬야 반경이 곧 "시작한 지"가 된다. 0.46 이던 시절에는 궤도 위
  // 어디서 얼어붙었느냐에 따라 같은 나이가 0.54~1.46배로 흩어졌다.
  abandoned: 0,
};
/** 갈래는 기억 바깥을 돈다. 기억 여럿을 아우르는 더 큰 구조라는 뜻이고,
 *  같은 각도에 겹쳐도 반경이 달라 판정(hit)이 섞이지 않는다. */
const THREAD_BAND = 1.34;

// 기억의 이심률 — 그 기억이 어떻게 남았는지가 궤도의 안정성이 된다.
const ECC_TRIGGER: Record<string, number> = {
  thread_complete: 0.05, // 끝냈다. 자리를 잡았다.
  // 오래 붙들고 있는 일. 아직 안 끝났지만 궤도는 잡혔다.
  deepened: 0.12,
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

/** 에폭 ms → KST 날짜. 프로브와 상세가 같은 표기를 쓴다. */
const ymd = (ms: number) => formatKstYmd(new Date(ms), ".");

// 색 묶음. 카테고리는 열셋인데 검은 배경 위 작은 후광으로 구분되는 색은
// 여덟이 한계다 — 열셋을 다 칠하면 서로 겹쳐 보여 색이 정보가 못 된다.
// 그래서 값은 열셋 그대로 두고 화면만 묶는다. 흔한 것에는 제 색을 주고,
// 드물게 나오는 것들을 한 색으로 모은다. 목록이 더 늘어도 묶음에 넣으면
// 색 체계는 안 건드린다.
// 두 가지를 피했다: 상호작용 색(#63E6D2, 청록)과 흰빛.
const CAT_GROUP_DEFS = [
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
  // 채도를 거의 0으로 둔다. 예전에는 [150,165,190] 이라 파란기가 남아 dev
  // 파랑과 헷갈렸고, 게다가 NEUTRAL 과 값이 **바이트까지 같아서** "기타 분야"와
  // "분야를 못 정한 것"이 화면에서 구분되지 않았다. 무채색이면 색상환의 어느
  // 분야와도 안 부딪히고, NEUTRAL 보다 어두워 축·중심과도 갈린다.
  { key: 'etc', label: 'etc', cats: ['search', 'etc'], color: [130, 130, 132] },
] as const satisfies readonly {
  key: string;
  label: string;
  // string[] 이 아니라 enum 으로 좁힌다 — 오타('desing')나 없는 값('design')이
  // 여기서 걸린다. 예전에는 그냥 통과해서 groupOfCategory 가 조용히 etc 로 떨궜다.
  cats: readonly ExperienceCategory[];
  color: readonly [number, number, number];
}[];

/** CAT_GROUPS 가 카테고리 열셋을 **남김없이** 덮는지 컴파일 타임에 확인한다.
 *
 *  안 덮인 값은 런타임에 조용히 etc 로 떨어진다 — 화면상 그 분야 전체가 방향도
 *  색도 '기타'가 되는데 에러는 안 난다. EXPERIENCE_CATEGORIES 에 값을 하나
 *  추가하고 여기 넣는 걸 잊으면 그 사고가 난다. 그래서 빌드가 먼저 깨지게 한다.
 *
 *  빠진 값이 있으면 아래 대입에서 "'빠진 category' 타입에 할당할 수 없다"가 뜨고,
 *  에러 메시지에 빠진 이름이 그대로 찍힌다. */
type UncoveredCategory = Exclude<
  ExperienceCategory,
  (typeof CAT_GROUP_DEFS)[number]['cats'][number]
>;
const _allCategoriesCovered: [UncoveredCategory] extends [never]
  ? true
  : ['CAT_GROUPS 에 빠진 category', UncoveredCategory] = true;
void _allCategoriesCovered;

// 리터럴 배열은 검사용이고, 밖으로는 지금까지와 같은 모양(쓰기 가능한 색 튜플)을
// 내보낸다 — as const 의 readonly 가 캔버스 그리기 쪽까지 번지지 않게 한다.
export const CAT_GROUPS: {
  key: string;
  label: string;
  cats: readonly ExperienceCategory[];
  color: [number, number, number];
}[] = CAT_GROUP_DEFS.map((g) => ({ ...g, color: [...g.color] as [number, number, number] }));

// 키는 일부러 string 이다. DB 의 category 는 열셋 enum 이지만 컬럼 자체는 자유
// 텍스트라, 예전 데이터나 손으로 넣은 값이 들어와도 조회는 되고 etc 로 떨어져야 한다.
const GROUP_BY_CAT = new Map<string, (typeof CAT_GROUPS)[number]>(
  CAT_GROUPS.flatMap((g) => g.cats.map((c) => [c as string, g] as const)),
);

/** 카테고리 → 색 묶음. 목록에 없는 값(예전 데이터, 표기 흔들림)은 기타로 떨어진다. */
export function groupOfCategory(cat: string) {
  return GROUP_BY_CAT.get(cat) ?? CAT_GROUPS[CAT_GROUPS.length - 1];
}

/** 갈래의 궤도면을 가르는 값. 색과 **같은 묶음**을 쓴다.
 *
 *  카테고리 열셋을 그대로 나누면 섹터가 13.8도라 눈으로 못 읽는다(위성이 45도,
 *  기억이 36도다). 그래서 색이 이미 쓰고 있는 여덟 묶음으로 가른다 — 22.5도.
 *
 *  방향과 색이 같은 값을 말하게 되지만 낭비가 아니다. 갈래에는 위성의 outcome
 *  같은 제2의 고정 축이 없고(threads 에 결과 컬럼이 없다), 남은 후보인 status 는
 *  분포가 active 로 쏠려 방향에 실으면 축이 통째로 죽는다. 한 값을 방향과 색
 *  둘로 같이 말하면 어느 쪽으로 세든 해석이 갈리지 않는다. */
const THREAD_SECTOR = Math.PI / CAT_GROUPS.length;

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
/** 기억의 색은 근거의 주된 분야에서 온다. 갈래는 자기 category 가 있어 이 함수를 안 탄다. */
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


/**
 * 판독값을 겨눈 지점 옆에 놓되 **화면 밖으로 나가지 않게** 한다.
 *
 * 예전에는 항상 오른쪽 아래(x+18, y-12)로만 나갔다. 지도 컨테이너가
 * overflow-hidden 이라 오른쪽·아래 가장자리 천체를 겨누면 판독값이 그대로
 * 잘려나갔다 — 제목이 길수록(기억 제목은 100자까지) 더 많이 잘린다.
 *
 * 자리가 없으면 반대쪽으로 뒤집고, 그래도 안 되면 가장자리에 붙인다.
 * 크기를 매번 읽는 이유는 내용에 따라 높이가 달라지기 때문이다(스킬 칩 줄 수).
 */
/** 판독값에 넣는 문장 상한. 저장은 온전히 하고 여기서만 줄인다 —
 *  판독값은 좁은 상자라 긴 요약이 그대로 들어가면 지도를 덮는다.
 *  전문은 눌러 들어간 상세(포커스 패널)와 /memories 에서 읽는다. */
const PROBE_TEXT_LEN = 100;
const PROBE_GAP = 18;
const PROBE_EDGE = 8;
function placeProbe(el: HTMLElement, x: number, y: number): void {
  const parent = el.parentElement;
  if (!parent) return;
  const pw = parent.clientWidth;
  const ph = parent.clientHeight;
  const bw = el.offsetWidth;
  const bh = el.offsetHeight;

  let px = x + PROBE_GAP;
  if (px + bw > pw - PROBE_EDGE) px = x - PROBE_GAP - bw; // 왼쪽으로 뒤집는다
  px = Math.min(Math.max(px, PROBE_EDGE), Math.max(PROBE_EDGE, pw - PROBE_EDGE - bw));

  let py = y - 12;
  py = Math.min(Math.max(py, PROBE_EDGE), Math.max(PROBE_EDGE, ph - PROBE_EDGE - bh));

  el.style.transform = `translate(${px}px, ${py}px)`;
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

// 나이 → 반경. sqrt 다.
//
// 원래 log1p 였다. 확대가 없던 시절엔 오래된 것을 안쪽으로 끌어당겨 다 화면에
// 담아야 했으니 맞는 선택이었는데, 대가가 컸다 — 6개월치로 재보니 최근 30일이
// 반경의 69% 를 가져가고 나머지 150일이 31% 에 몰렸다. 갈래 131개 중 119개가
// 바깥 절반에 겹쳤다.
//
// 확대가 생겼으니 그렇게까지 누를 이유가 없다. 그렇다고 압축을 아예 빼면
// (선형) 지금은 제일 고르지만 오래 쓸수록 반대로 뒤집힌다 — 2년 시점에 첫 달이
// 반경의 4% 로 찌그러진다. 이 지도는 "지금 뭘 붙들고 있나"를 먼저 답해야 하므로
// 최근을 뭉개는 쪽이 더 나쁘다. sqrt 는 같은 시점에 20% 를 지킨다.
const radiusOf = (ageDays: number) => 0.16 + Math.sqrt(ageDays) * 0.12;
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
// ft(진행도)를 실제로 쓰는 값 ez 로 바꾼다.
//
// 나올 때 세제곱이었다. ft 는 프레임마다 정해진 비율로 줄어드는데 세제곱을
// 씌우면 **그 비율이 세 배가 된다** — 0.04 로 낮춰도 ez 는 12%씩 빠졌고,
// 앞쪽이 특히 가팔라서 5프레임(83ms)만에 절반이 지나갔다. 속도를 아무리
// 낮춰도 "뻑" 하고 꺼지던 이유가 숫자가 아니라 이 모양에 있었다.
//
// 제곱으로 낮춘다. 들어갈 때는 그대로 — 고른 곳으로 빨려드는 건 가팔라야 한다.
const easeMorph = (x: number, entering: boolean) =>
  entering ? 1 - Math.pow(1 - x, 3) : x * x;

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
  /** 이 궤도에 올라온 대상. 기억이거나 갈래다. */
  mem: OrbitBody;
};

export function OrbitalMap({
  bodies,
  memories,
  threads,
  centerLabel,
  latestId,
  onComplete,
  onFocusChange,
}: {
  bodies: Body[];
  memories: MemoryBody[];
  /** 갈래 — 기억과 같은 계를 돌되 바깥 궤도에 뜬다. 누르면 종속 경험이 위성으로. */
  threads: ThreadBody[];
  centerLabel: string;
  /** 가장 최근에 들어온 경험이 속한 천체. 계에서 하나, 펼친 뒤 위성에서 하나가
   *  같은 표식으로 뛴다 — "이게 방금 그거다"가 층을 건너 읽힌다. */
  latestId?: string | null;
  /** 갈래를 완결로 표시한다. 갈래 화면에서만 넘어온다 — 메인은 기억을 다루니
   *  이 동작이 없다. 없으면 버튼 자체가 안 뜬다. */
  onComplete?: (threadId: string) => Promise<unknown>;
  /** 기억 하나에 붙었는지. 지도 바깥(계기판)이 읽는 상태에 맞춰 물러나도록. */
  onFocusChange?: (focused: boolean) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [probe, setProbe] = useState<{
    x: number;
    y: number;
    text: string;
    sub: string;
    skills?: { name: string; firstTime: boolean }[];
  } | null>(null);
  const [focus, setFocus] = useState<OrbitBody | null>(null);
  const [picked, setPicked] = useState<Body | null>(null);

  useEffect(() => {
    onFocusChange?.(focus != null);
  }, [focus, onFocusChange]);

  // 판독값 DOM. 렌더 루프와 아래 레이아웃 이펙트가 함께 잡는다.
  const [completing, setCompleting] = useState(false);
  const probeRef = useRef<HTMLDivElement>(null);
  /** 중심 이름표. 질량중심을 따라다녀야 하므로 매 프레임 자리를 직접 옮긴다.
   *  state 로 두면 프레임마다 리렌더가 돌아 계 전체가 느려진다. */
  const centerLabelRef = useRef<HTMLDivElement>(null);

  // 판독값은 내용에 따라 크기가 달라져(스킬 칩 줄 수·제목 길이) 그려본 뒤에야
  // 잘리는지 알 수 있다. 그린 직후 같은 프레임에 다시 놓아 깜빡임이 없다.
  useLayoutEffect(() => {
    if (probe && probeRef.current) placeProbe(probeRef.current, probe.x, probe.y);
  }, [probe]);
  // 렌더 루프가 읽는 최신 선택. 마우스가 떠나도 고른 것은 켜진 채로 남는다.
  const pickedRef = useRef<Body | null>(null);
  pickedRef.current = picked;

  // 렌더 루프가 읽는 최신 포커스. 상태를 클로저에 가두지 않기 위해 ref 로 둔다.
  const focusRef = useRef<OrbitBody | null>(null);
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
    const colorOf = (o: OrbitBody) => {
      // 갈래는 자기 분야를 갖는다. 기억은 근거들의 주된 분야에서 빌려온다.
      if (o.kind === "thread") return colorOfCategory(o.category);
      const dom = dominantCategory(o, byId);
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

    /** 갈래의 궤도면. 섹터는 분야의 색 묶음이 가르고, 그 안의 자리는 카테고리가
     *  잡는다 — 기억을 눌렀을 때 위성이 outcome 으로 갈리고 그 안에서 category 로
     *  흩어지는 것과 똑같은 위계다. 기억의 sectorOf 와는 완전히 별개고,
     *  기억 배치는 한 칸도 건드리지 않는다. */
    function threadSectorOf(t: ThreadBody): number {
      const g = groupOfCategory(t.category);
      // 섹터 안을 묶음에 속한 카테고리 수만큼 슬롯으로 쪼갠다.
      // dev 처럼 카테고리가 하나뿐인 묶음은 슬롯이 곧 섹터라, 그 안을 id 가 다 쓴다.
      // media(entertainment·music)처럼 여럿이면 카테고리가 먼저 자리를 잡고
      // 그 안을 id 가 채운다 — 색이 같아도 방향이 갈린다.
      const slot = (THREAD_SECTOR * SECTOR_FILL) / g.cats.length;
      const base =
        CAT_GROUPS.indexOf(g) * THREAD_SECTOR +
        Math.max(0, g.cats.indexOf(t.category as ExperienceCategory)) * slot;
      // 같은 카테고리끼리는 id 가 슬롯을 채운다. 예전에는 여기에 카테고리를 또
      // 넣었는데, 섹터가 이미 분야로 갈린 뒤라 대부분 상수였다 — dev 갈래 넷이
      // 잔떨림 ±1.6도 안에서 겹쳤다. 없는 정보를 넣느라 있는 자리를 버린 셈이다.
      return base + phaseOf(t.id) * slot;
    }

    const threadEls: Elem[] = threads.map((t) => {
      // 바깥 궤도. 기억 여럿을 아우르는 더 큰 구조라는 뜻이고, 같은 각도에
      // 겹쳐도 반경이 달라 판정(hit)이 섞이지 않는다.
      const a = radiusOf(t.ageDays) * THREAD_BAND;
      const p = phaseOf(t.id);
      return {
        kind: "mem" as const,
        id: t.id,
        a,
        e: ECC_STATUS[t.status] ?? 0.22,
        omega: p * Math.PI * 2,
        plane: threadSectorOf(t),
        theta0: p * Math.PI * 2,
        // 놓은 갈래는 멈춘다. 이 화면은 전부가 천천히 도는 곳이라 하나만 서
        // 있으면 눈이 바로 잡는다 — "30일간 아무도 안 건드린 일"이라는 뜻과
        // 정확히 맞는다. 이심률 하나로는 그 뜻이 화면에서 안 읽혔다(타원이
        // 얼마나 찌그러졌는지는 나란히 놓고 봐야 아는데, 갈래마다 방향도
        // 반경도 달라 비교가 안 된다).
        n: t.status === "abandoned" ? 0 : speedOf(a),
        lum: 1,
        color: colorOf(t),
        // 크기는 붙은 경험 수 — 얼마나 오래 붙들고 있는 일인가.
        // 기억의 importance(1~10)와 자릿수를 맞춰 로그로 누른다.
        size: 4 + Math.log1p(t.experienceCount) * 3.4,
        mem: t,
      };
    });

    // 기억 크기의 기준. 화면에 올라온 것들 중 가장 중요한 것을 최대로 잡는다.
    //
    // 예전에는 importance(1~10)를 그대로 픽셀에 곱했다. 그런데 importance 는
    // memory_score 를 **이론상 최대 200** 으로 나눠 만든 값인데 실제 점수는
    // 110 이 최대라(0·20·90·110 뿐이다) 열 칸이 3~4 두 칸으로 뭉갰다 —
    // 화면에서는 6.4px 과 7.2px, 사실상 같은 크기다.
    //
    // 위성 층은 이미 이 문제를 화면 기준 정규화로 풀어놨다(topScore). 같은
    // 규칙을 여기에도 쓴다. importance 자체는 절대값이라 /memories 목록에서
    // 그대로 쓰이므로 건드리지 않는다 — 고치는 건 화면의 표현뿐이다.
    const topImportance = Math.max(1, ...memories.map((m) => m.importance));

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
        // 중요도가 곧 크기다 — 다만 절대값이 아니라 화면 안에서의 몫이다.
        // 4.8~12px 폭을 실제로 다 쓴다 (코로나는 이 6배까지 퍼진다).
        size: 4 + (m.importance / topImportance) * 8,
        mem: m,
      };
    });

    els.push(...threadEls);

    // 기억이 하나도 없으면 궤도가 없다. 축척이 0 으로 무너지지 않게 바닥값을 둔다.
    const maxA = els.reduce((mx, e) => Math.max(mx, e.a * (1 + e.e)), 0.5);

    /** 궤도면 축의 이름. 그 방향이 무슨 뜻인지를 화면에 적어주는 값이다.
     *
     *  기억은 trigger, 갈래는 색 묶음이다. 예전에는 갈래가 축을 아예 못 갖게
     *  막아놨는데(null), 그때 갈래의 방향이 status 라서 ACTIVE 같은 라벨이
     *  기억의 trigger 축들 사이에 끼면 한 범례에 두 어휘가 섞였기 때문이다.
     *  방향이 분야로 바뀌면서 그 이유가 없어졌다 — 이제 갈래 축의 라벨은
     *  오른쪽 아래 색 범례와 **같은 단어**라 서로를 설명한다.
     *
     *  두 어휘가 실제로 한 화면에 섞이지는 않는다. 메인은 memories 만,
     *  /threads 는 threads 만 받아서(각각 상대를 빈 배열로 넘긴다) 축 목록에
     *  한 종류만 올라온다. */
    const axisKeyOf = (o: OrbitBody) =>
      o.kind === "memory" ? o.trigger : groupOfCategory(o.category).key;
    /** 포커스 원의 크기 근거. 기억은 중요도, 갈래는 붙은 경험 수. */
    const weightOf = (o: OrbitBody) =>
      o.kind === "memory" ? o.importance : Math.log1p(o.experienceCount) * 4.2;

    /** 주 궤도에 올라온 것 전부. 기억과 갈래를 id 로 함께 찾는다. */
    const orbitById = new Map<string, OrbitBody>();
    for (const m of memories) orbitById.set(m.id, m);
    for (const t of threads) orbitById.set(t.id, t);

    let w = 0;
    let h = 0;
    let cx = 0;
    let cy = 0;
    let unit = 1;
    // 확대. 화면 전체가 cx·cy·unit 세 값에서 나오므로(판정 좌표까지 포함),
    // 캔버스 변환을 덧씌우는 대신 그 세 값을 바꾼다 — 그러면 궤도·축·조준
    // 판정이 저절로 같이 움직인다. 변환을 씌웠다면 hit 맵을 역변환해야 했다.
    //
    // 천체 크기는 확대해도 안 커진다. 이 화면의 문제는 "작아서 안 보인다"가
    // 아니라 "겹쳐서 못 고른다"라(갈래 스물여섯이 0.3도 안에 몰린다),
    // 점 사이를 벌리는 게 확대의 목적이다. 점까지 같이 커지면 헛일이 된다.
    let baseUnit = 1;
    let zoom = 1;
    let zoomTarget = 1;
    // 이동. 배율과 **같은 시계로 같이 이징**해야 한다.
    //
    // 처음에는 "커서 밑 지점"을 붙들어 두고 매 프레임 cx·cy 를 역산했는데,
    // 배율이 정확히 1 로 떨어지는 순간 그 지점을 놓으면서 중심이 한 프레임에
    // 튀었다 — 축소해서 원래대로 돌아올 때 화면이 뚝 끊겼다. 배율만 이징하고
    // 이동은 이징하지 않았으니 둘이 어긋난 것이다.
    //
    // 이동을 제 값으로 두고 같이 수렴시키면 그 불연속이 원천적으로 없다.
    // 배율이 1 로 가면 이동 목표도 0 이라 둘이 나란히 가운데로 돌아온다.
    let offX = 0;
    let offY = 0;
    let offXTarget = 0;
    let offYTarget = 0;
    let dpr = 1;
    let raf = 0;
    let mouse: { x: number; y: number } | null = null;
    let hovered: string | null = null;
    // 조준점. 실제 커서는 숨기고 이걸 그린다 — OS 커서를 코드로 옮기는 방법은
    // 없으니, 빨려드는 느낌은 화면에 그리는 수밖에 없다.
    // 그리기용 포커스. focus 가 null 이 돼도 ft 가 0 에 닿을 때까지 남는다 —
    // 안 그러면 나가는 순간 대상이 사라져 되돌아가는 모핑이 안 그려진다.
    let shownFoc: OrbitBody | null = null;
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
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = wrap!.clientWidth;
      h = wrap!.clientHeight;
      canvas!.width = Math.round(w * dpr);
      canvas!.height = Math.round(h * dpr);
      canvas!.style.width = `${w}px`;
      canvas!.style.height = `${h}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      // 궤도면이 제각기 기울어 있으므로 어떤 궤도든 세로로 설 수 있다.
      // FLATTEN 을 믿고 세로 여유를 크게 잡으면 화면 밖으로 나간다.
      baseUnit = (Math.min(w / 2, h / 2) * 0.88) / maxA;
      // 창 크기가 바뀌면 이동량의 근거(그때의 화면 좌표)가 무의미해진다.
      // 가운데로 되돌린다 — 확대 배율은 지킨다.
      offX = offY = offXTarget = offYTarget = 0;
      applyCamera();
    }

    /** 이동량 한계. 바깥 궤도가 화면에서 통째로 사라지지 않는 선까지만 —
     *  그 너머는 아무것도 없는 검은 화면이라 갈 이유가 없다. */
    function offLimit(z: number) {
      const radX = maxA * baseUnit * z;
      return {
        x: Math.max(0, radX + w / 2 - 100),
        y: Math.max(0, radX * FLATTEN + h / 2 - 100),
      };
    }

    /** zoom·off 로부터 cx·cy·unit 을 푼다. 매 프레임 그리기 전에 부른다. */
    function applyCamera() {
      unit = baseUnit * zoom;
      cx = w / 2 + offX;
      cy = h / 2 + offY;
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
      /** 가장 최근 경험. 계 전체에서와 같은 표식이라 층을 건너도 같은 뜻이다. */
      latest = false,
      t = 0,
    ) {
      const breath = reduced || !latest ? 0 : 0.5 + Math.sin(t * 0.9) * 0.5;
      const rad = size * (lit ? 1.6 : 1) * (1 + breath * 0.22) * 4.1;
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
      /** 가장 최근 경험이 여기서 왔는가. 정적인 축은 전부 뜻이 있어서
       *  (반경=나이 · 방향=trigger · 크기=중요도 · 색=분야 · 이심률=상태)
       *  남은 채널이 시간축뿐이다. 숨쉬듯 크게 뛰는 것은 이것 하나다. */
      latest = false,
    ) {
      const [r, g, b] = lit ? [143, 244, 228] : color;
      // 아주 느린 맥동. 살아 있다는 표시 정도로만.
      const pulse = reduced
        ? 1
        : latest
          ? 1 + Math.sin(t * 0.9) * 0.17
          : 1 + Math.sin(t * 0.5 + x * 0.01) * 0.05;
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

      // 숨결에 맞춰 얇은 테두리가 같이 뛴다. 후광만으로는 다른 천체와
      // 겹쳐 있을 때 어느 쪽이 뛰는지 분간이 안 된다.
      if (latest && !reduced) {
        const breath = 0.5 + Math.sin(t * 0.9) * 0.5;
        ctx!.strokeStyle = `rgba(${r},${g},${b},${(0.16 + breath * 0.3) * alpha})`;
        ctx!.lineWidth = 0.9;
        ctx!.beginPath();
        ctx!.arc(x, y, radius * (1.9 + breath * 0.5), 0, Math.PI * 2);
        ctx!.stroke();
      }
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
        // save/restore 사이에서 예외가 나면 변환 스택이 복구되지 않는다. 그대로
        // 두면 다음 프레임이 또 save+translate 를 쌓아 clearRect(0,0,w,h) 가
        // 캔버스를 못 덮고 화면이 번진다. 기본 변환으로 되돌려 놓는다.
        ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx!.globalAlpha = 1;
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

    /** 방향축을 긋고 라벨을 놓는다.
     *
     *  계 전체(분야)와 포커스 안(결과)이 같은 규칙을 쓴다 — 두 곳에 같은 코드가
     *  따로 있었고, 그래서 계 쪽만 고쳤을 때 포커스 안은 그대로 남아 확대하면
     *  선이 같이 커지고 끌면 따라 밀렸다.
     *
     *  축은 계의 일부가 아니라 계기다. "이 방향이 무엇이냐"만 말하고, 방향은
     *  확대·이동에 안 변하는 값이라(각도는 배율과 무관) 뷰포트 한가운데에 그어도
     *  뜻이 정확히 같다. 계를 따라 움직이게 두면 배율을 올렸을 때 축이 화면 밖으로
     *  나가 범례가 통째로 사라진다.
     *
     *  선은 화면 사각형 경계까지, 라벨은 고정 반경 위에. 라벨까지 경계로 밀면
     *  방향마다 거리가 제각각이 되어(가로는 멀고 세로는 가깝다) 눌린 타원 형태가
     *  무너진다 — 여덟 개가 같은 거리에 서야 그 형태가 "계기"라고 말한다. */
    function drawAxes(o: {
      angles: Map<string, { sum: number; n: number }>;
      lit: string | null;
      alpha: number;
      /** 꺼져 있을 때의 선 색. 켜지면 상호작용 청록으로 통일한다. */
      offRgb: string;
      hitPrefix: string;
      hitKind: string;
      canHit: boolean;
    }) {
      const ax0 = w / 2;
      const ay0 = h / 2;
      const AX = Math.min(Math.min(w / 2, h / 2) * 1.5, w / 2 - 130);

      ctx!.font = '11.5px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx!.textBaseline = "middle";

      for (const [key, acc] of o.angles) {
        const ang = acc.sum / acc.n;
        const dx = Math.cos(ang);
        const dy = Math.sin(ang) * FLATTEN;
        const on = o.lit === key;

        // 축은 색을 쓰지 않는다. 색은 분야의 것이라, 축에 색을 주면 한 화면에
        // 서로 다른 두 색 언어가 겹친다.
        ctx!.strokeStyle = on
          ? `rgba(99,230,210,${0.6 * o.alpha})`
          : `rgba(${o.offRgb},${0.22 * o.alpha})`;
        ctx!.lineWidth = on ? 1.2 : 0.8;
        ctx!.setLineDash(on ? [] : [3, 7]);

        // 방향 벡터가 단위길이가 아니라(dy 에 FLATTEN 이 곱해져 있다) 성분별로
        // 가장자리까지의 배율을 구해 작은 쪽을 쓴다.
        const tEdge = Math.min(
          Math.abs(dx) > 1e-6 ? w / 2 / Math.abs(dx) : Infinity,
          Math.abs(dy) > 1e-6 ? h / 2 / Math.abs(dy) : Infinity,
        );

        const label = tag(key);
        const tw = ctx!.measureText(label).width;
        const lxRaw = ax0 + dx * (AX + 16);
        const lyRaw = ay0 + dy * (AX + 16);
        // 글자가 화면을 넘지 않게 가둔다. 정렬이 좌/우로 갈리니 뻗는 쪽만 본다.
        const lx = dx >= 0 ? Math.min(lxRaw, w - 12 - tw) : Math.max(lxRaw, 12 + tw);
        const ly = Math.max(15, Math.min(h - 15, lyRaw));

        // 선이 글자 위를 지나가면 안 읽히므로 그 사각형만 비우고 두 토막으로
        // 긋는다. 라벨은 dx 부호에 따라 정렬이 좌/우로 갈려 기준점 한쪽으로만
        // 뻗으므로, 폭의 절반을 빼는 어림으로는 한쪽이 어긋난다 — 사각형과
        // 직선의 교차를 슬랩으로 그대로 푼다.
        const bx0 = (dx >= 0 ? lx : lx - tw) - 6;
        const bx1 = (dx >= 0 ? lx + tw : lx) + 6;
        const slab = (p: number, d: number, lo: number, hi: number): [number, number] =>
          Math.abs(d) < 1e-6
            ? p >= lo && p <= hi
              ? [-Infinity, Infinity]
              : [Infinity, -Infinity]
            : d > 0
              ? [(lo - p) / d, (hi - p) / d]
              : [(hi - p) / d, (lo - p) / d];
        const [txa, txb] = slab(ax0, dx, bx0, bx1);
        const [tya, tyb] = slab(ay0, dy, ly - 9, ly + 9);
        const tIn = Math.max(txa, tya);
        const tOut = Math.min(txb, tyb);

        ctx!.beginPath();
        if (tIn < tOut) {
          ctx!.moveTo(ax0 - dx * tEdge, ay0 - dy * tEdge);
          ctx!.lineTo(ax0 + dx * Math.max(-tEdge, tIn), ay0 + dy * Math.max(-tEdge, tIn));
          ctx!.moveTo(ax0 + dx * Math.min(tEdge, tOut), ay0 + dy * Math.min(tEdge, tOut));
          ctx!.lineTo(ax0 + dx * tEdge, ay0 + dy * tEdge);
        } else {
          ctx!.moveTo(ax0 - dx * tEdge, ay0 - dy * tEdge);
          ctx!.lineTo(ax0 + dx * tEdge, ay0 + dy * tEdge);
        }
        ctx!.stroke();
        ctx!.setLineDash([]);

        ctx!.textAlign = dx >= 0 ? "left" : "right";
        ctx!.fillStyle = on
          ? `rgba(143,244,228,${o.alpha})`
          : `rgba(158,171,190,${0.9 * o.alpha})`;
        ctx!.fillText(label, lx, ly);

        // 라벨을 겨눌 수 있게 한다 — 방향을 이름으로 짚으면 그 갈래가 켜진다.
        if (o.canHit) {
          const half = tw / 2 + 8;
          hit.set(`${o.hitPrefix}${key}`, {
            x: lx + (dx >= 0 ? half - 8 : -(half - 8)),
            y: ly,
            r: Math.max(16, half),
            kind: o.hitKind,
          });
        }
      }
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
      // 들어갈 때와 나올 때의 속도를 나눈다. 들어가는 건 내가 고른 곳으로
      // 가는 거라 빠른 게 시원한데, 나오는 건 "어디서 나왔는지"를 눈으로
      // 따라가야 해서 같은 속도면 뚝 끊긴다.
      ft += (target - ft) * (focusRef.current ? 0.075 : 0.032);
      if (Math.abs(target - ft) < 0.002) ft = target;

      // 관성. 손을 뗀 속도로 계속 미끄러지다 잦아든다. 감쇠도 프레임 수가
      // 아니라 시간 기준이라 주사율이 달라도 같은 거리를 간다.
      if (!dragging && (flingX !== 0 || flingY !== 0)) {
        const lim = offLimit(zoom);
        const nx = offX + flingX * dt;
        const ny = offY + flingY * dt;
        offX = Math.max(-lim.x, Math.min(lim.x, nx));
        offY = Math.max(-lim.y, Math.min(lim.y, ny));
        // 벽에 닿으면 그 방향 속도를 버린다. 안 그러면 한계에 붙어 계속
        // 밀고 있는 상태가 되어 놓아준 느낌이 안 난다.
        if (offX !== nx) flingX = 0;
        if (offY !== ny) flingY = 0;
        const decay = Math.pow(0.05, dt); // 1초에 5% 남는다
        flingX *= decay;
        flingY *= decay;
        if (Math.hypot(flingX, flingY) < 8) flingX = flingY = 0;
        // 목표를 따라 옮긴다 — 안 그러면 아래 이징이 곧바로 되돌린다.
        offXTarget = offX;
        offYTarget = offY;
      }

      // 확대는 프레임 수가 아니라 시간으로 수렴시킨다. 계수 곱셈(z += (t-z)*k)은
      // 화면 주사율에 따라 속도가 달라져서, 120Hz 에서는 60Hz 의 두 배로 빨라진다.
      // 배율과 이동은 **같은 계수**를 쓴다 — 따로 놀면 확대하는 동안 겨눈 지점이
      // 미끄러지고, 돌아올 때 한쪽이 먼저 도착해 끊겨 보인다.
      const k = 1 - Math.pow(0.0012, dt);
      if (zoom !== zoomTarget || offX !== offXTarget || offY !== offYTarget) {
        zoom += (zoomTarget - zoom) * k;
        offX += (offXTarget - offX) * k;
        offY += (offYTarget - offY) * k;
        if (Math.abs(zoomTarget - zoom) < 0.0015) zoom = zoomTarget;
        if (Math.abs(offXTarget - offX) < 0.3) offX = offXTarget;
        if (Math.abs(offYTarget - offY) < 0.3) offY = offYTarget;
      }
      applyCamera();

      // 이름표를 질량중심에 붙인다. 캔버스가 아니라 DOM 이라 여기서 옮긴다.
      if (centerLabelRef.current) {
        centerLabelRef.current.style.left = `${cx}px`;
        centerLabelRef.current.style.top = `${cy}px`;
      }

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
      const litAxis = hovered?.startsWith("maxis:") ? hovered.slice(6) : null;
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
          const tr = axisKeyOf(el.mem);
          const acc = mAxis.get(tr) ?? { sum: 0, n: 0 };
          acc.sum += el.plane;
          acc.n += 1;
          mAxis.set(tr, acc);
        }
        drawAxes({
          angles: mAxis,
          lit: litAxis,
          alpha: sysAlpha,
          // 축과 중심처럼 어느 분야에도 속하지 않는 것들의 색.
          offRgb: NEUTRAL.join(","),
          hitPrefix: "maxis:",
          hitKind: "maxis",
          // 판정은 변환이 안 걸린 정지 상태에서만 받는다. 카메라가 움직이는
          // 동안 등록하면 보이는 곳과 눌리는 곳이 어긋난다.
          canHit: ez < 0.02,
        });

        for (const el of els) {
          // 놓은 갈래는 궤도선을 안 그린다. 도는 것을 그만뒀으니 그릴 궤도가
          // 없다 — 멈춘 점 하나만 남아 그냥 별처럼 보인다.
          if (el.mem.kind === "thread" && el.mem.status === "abandoned") continue;
          drawOrbit(el, sysAlpha, litAxis != null && litAxis === axisKeyOf(el.mem));
        }
        // 깊이 정렬. 기울여 본 평면이므로 화면 아래쪽(y > cy)이 관찰자에게
        // 가까운 쪽이다. 뒤쪽을 먼저, 중심을, 그다음 앞쪽을 그려야 앞을 지나는
        // 천체가 중심 위로 지나간다 — 안 그러면 전부 중심 뒤로 숨는다.
        const placed = els.map((el) => ({ el, p: orbitPoint(el, t) }));

        for (const { el, p } of placed) {
          if (p.y > cy) continue; // 앞쪽은 나중에
          if (foc && el.id === foc.id) continue; // 모핑 중인 대상은 따로 그린다
          drawMemory(p.x, p.y, el.size, el.color, hovered === el.id || (litAxis != null && litAxis === axisKeyOf(el.mem)), sysAlpha, t, el.id === latestId);
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
          drawMemory(p.x, p.y, el.size, el.color, hovered === el.id || (litAxis != null && litAxis === axisKeyOf(el.mem)), sysAlpha, t, el.id === latestId);
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
        // zoom 을 곱한다. 위성은 unit 이 아니라 제 반경 R 로 놓이는 층이라,
        // 이걸 빼먹으면 계는 확대되는데 경험 궤도만 그대로였다.
        // 원점이 (cx, cy) 라 이동(offX·offY)은 이미 따라온다.
        const R = Math.min(w, h) * 0.3 * (0.78 + 0.22 * ez) * zoom;

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
            // 기억은 그 기억을 만든 근거들, 갈래는 그 갈래를 시작한 경험.
            // 기억은 여럿일 수 있다 — 근거가 쌓이면 테두리도 늘어난다.
            isSource: foc.sourceIds.includes(b.id),
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

        drawAxes({
          angles: angleSum,
          lit: litOutcome,
          alpha: ez,
          offRgb: "150,175,210",
          hitPrefix: "axis:",
          hitKind: "axis",
          canHit: ez > 0.98,
        });

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
          drawPoint(st.x, st.y, st.size, st.lum, on, ez, st.color, st.b.id === latestId, ts);
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
        const toR = 18 + weightOf(foc) * 1.2;
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
          const key = found.slice(6);
          // 축이 무엇을 뜻하는지가 화면마다 다르다 — 메인은 기억의 trigger,
          // /threads 는 갈래의 분야다. 그리기는 axisKeyOf 로 합쳐놨는데 여기만
          // memories.trigger 로 세고 있어서, 갈래 화면에서는 세는 대상도 없고
          // (memories=[]) 키도 안 맞아 늘 0건이었다. 같은 함수로 센다.
          const onAxis = [...memories, ...threads].filter((o) => axisKeyOf(o) === key);
          setProbe({
            x: p.x,
            y: p.y,
            text:
              threads.length > 0
                ? `${tag(key)} 분야의 갈래 ${onAxis.length}건`
                : `${tag(key)} 로 남은 기억 ${onAxis.length}건`,
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
          const m = orbitById.get(found);
          // 데이터가 갱신되며 이 기억이 빠졌을 수 있다(야간 배치의 망각 마킹 등).
          // 단언으로 두면 undefined.title 에서 프레임이 죽고, try/catch 가 삼켜
          // 그 프레임의 조준점까지 통째로 안 그려진다 — 커서가 사라진다.
          if (!m) setProbe(null);
          else setProbe({
            x: p.x,
            y: p.y,
            text: clampSentence(m.title, PROBE_TEXT_LEN),
            sub:
              m.kind === "thread"
                // 언제 시작해서 언제 끝났는지. 반경이 이미 "시작한 지"를
                // 말하지만 그건 상대값이라, 날짜를 못 읽는다.
                ? `갈래 · ${tag(m.status)} · ${tag(m.category)} · 경험 ${m.referencedIds.length}건 · ${ymd(m.occurredAt)} 시작${
                    m.completedAt ? ` → ${ymd(m.completedAt)} 완결` : ""
                  }`
                // '근거'가 아니라 '경험'이다. 근거는 이 기억을 만든 결정적인
                // 경험 하나(sourceId)를 가리키는 말인데, 그건 펼친 화면 안에서
                // 따로 드러난다. 여기 숫자는 같은 갈래에 속한 경험 전부라
                // 근거라고 부르면 "결정적인 경험이 여섯 개"로 읽힌다.
                // '기억'이라고 안 적는다 — 이 화면에 도는 게 기억뿐이라 매 줄에
                // 같은 말이 붙는다. 중요도도 뺀다: 크기가 이미 그 값이다.
                // trigger 는 전부 적는다. 남은 이유가 여럿이면 그게 곧 그 기억의
                // 성격이라, 가장 센 것 하나만 보이면 나머지를 알 길이 없다.
                : `${m.triggers.map(tag).join(' · ')} · 경험 ${m.referencedIds.length}건 · ${ymd(m.occurredAt)}`,
            // 처음 쓴 스킬만. 호버는 훑는 자리라 일곱 개씩 늘어놓으면 아무것도
            // 안 읽힌다. trigger 가 왜 그 값인지에 답하는 것도 신규 쪽이다.
            // (전부는 눌러서 펼친 화면에 있다.)
            skills: m.kind === "memory" ? m.skills.filter((sk) => sk.firstTime) : undefined,
          });
        } else {
          const b = byId.get(found)!;
          setProbe({
            x: p.x,
            y: p.y,
            text: clampSentence(b.summary, PROBE_TEXT_LEN),
            sub: `${tag(b.category)} · ${formatKstYmd(new Date(b.occurredAt), ".")} · ${tag(b.outcome)} · M${b.memoryScore}`,
          });
        }
      } else if (found && probeRef.current) {
        const p = hit.get(found)!;
        placeProbe(probeRef.current, p.x, p.y);
      }

      // 조준점은 마지막에. 무엇보다 위에 있어야 가려지지 않는다.
      drawAim();
    }

    // ── 끌어서 옮기기 ──
    // 확대해 들어가면 보고 싶은 데가 화면 밖에 있을 수 있다. 휠은 커서 쪽으로
    // 파고드는 것뿐이라, 옆으로 훑으려면 끄는 수밖에 없다.
    //
    // 누른 것인지 끈 것인지가 애매하면 안 된다 — 궤도를 훑다가 손을 뗐는데
    // 엉뚱한 천체가 펼쳐지면 지도를 못 믿게 된다. 문턱을 넘는 순간 드래그로
    // 확정하고, 그 뒤에 따라오는 click 은 통째로 죽인다. 문턱 아래로만 움직이면
    // (손떨림) 지금까지처럼 클릭이다.
    const DRAG_SLOP = 5;
    let dragging = false;
    let dragPrev = { x: 0, y: 0 };
    let dragLastT = 0;
    let dragDist = 0;
    let swallowClick = false;
    // 손을 뗀 뒤 미끄러지는 속도(px/초). 계에 질량이 있는 것처럼 굴게 한다 —
    // 뚝 서면 화면이 끌려온 게 아니라 잘려 보인다.
    let flingX = 0;
    let flingY = 0;

    function onDown(e: MouseEvent) {
      if (e.button !== 0) return;
      dragging = true;
      dragDist = 0;
      dragPrev = { x: e.clientX, y: e.clientY };
      dragLastT = performance.now();
      // 미끄러지는 중에 다시 잡으면 그 자리에서 선다.
      flingX = flingY = 0;
    }

    function onUp() {
      if (!dragging) return;
      dragging = false;
      // mouseup 뒤에 click 이 온다. 끌었으면 그걸 삼킨다.
      swallowClick = dragDist > DRAG_SLOP;
      // 문턱 아래로만 움직였으면 클릭이지 던진 게 아니다.
      if (!swallowClick) {
        flingX = flingY = 0;
        return;
      }
      // 속도는 mousemove 에서만 갱신된다. 그래서 확 끌다가 **멈춘 채로**
      // 떼면 이벤트가 안 오는 동안 아까 속도가 그대로 남아 있다가 튀어나간다
      // — 손은 서 있는데 화면만 날아가는 셈이다.
      // 마지막 움직임 이후 흐른 시간만큼 죽인다. 90ms 넘게 멈춰 있었으면
      // 던진 게 아니라 놓은 것이다.
      const idle = performance.now() - dragLastT;
      const keep = Math.max(0, 1 - idle / 90);
      flingX *= keep;
      flingY *= keep;
    }

    function onMove(e: MouseEvent) {
      const rect = canvas!.getBoundingClientRect();
      mouse = { x: e.clientX - rect.left, y: e.clientY - rect.top };

      if (!dragging) return;
      const dx = e.clientX - dragPrev.x;
      const dy = e.clientY - dragPrev.y;
      dragPrev = { x: e.clientX, y: e.clientY };
      dragDist += Math.hypot(dx, dy);
      if (dragDist <= DRAG_SLOP) return; // 아직 클릭일 수도 있다

      // 던진 속도. mousemove 는 프레임에 안 맞춰 오므로 시간으로 나눠 px/초로
      // 재고, 순간값은 튀니까 지수평활한다. 마지막 한 번만 보면 손을 뗄 때
      // 우연히 멈칫한 프레임이 잡혀 안 미끄러진다.
      const nowT = performance.now();
      const dtms = Math.max(1, nowT - dragLastT);
      dragLastT = nowT;
      flingX = flingX * 0.7 + ((dx / dtms) * 1000) * 0.3;
      flingY = flingY * 0.7 + ((dy / dtms) * 1000) * 0.3;

      // 목표까지 같이 옮긴다. 목표를 안 옮기면 손을 떼는 순간 이징이 원래
      // 자리로 되돌려서, 끌고 있는 내내 화면이 손가락을 밀어낸다.
      const lim = offLimit(zoom);
      offX = offXTarget = Math.max(-lim.x, Math.min(lim.x, offX + dx));
      offY = offYTarget = Math.max(-lim.y, Math.min(lim.y, offY + dy));
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
      if (swallowClick) {
        swallowClick = false;
        return;
      }
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
        setFocus(orbitById.get(hovered) ?? null);
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
        // 확대도 같이 푼다. 빠져나오는 키가 하나여야 한다 — 확대해 들어간
        // 상태에서 Escape 를 눌러 포커스만 풀리면 어디로 돌아가야 할지
        // 알려주는 게 화면에 없다.
        zoomTarget = 1;
        offXTarget = 0;
        offYTarget = 0;
        flingX = flingY = 0;
      }
    }

    /** 확대 범위. 아래로는 딱 맞춤(1)까지만 — 그보다 줄이면 화면 가장자리에
     *  빈 검은 띠만 늘어난다.
     *
     *  위로는 32배. 8배로는 부족했다 — 화면 배율이 **가장 바깥 궤도 하나**에
     *  맞춰지는 구조라(unit = 짧은 변 절반의 88% / maxA), 4년 된 갈래가 하나만
     *  있어도 최근 것들이 반경의 2% 안으로 눌린다. 그걸 읽을 만큼 벌리려면
     *  스무 배 넘게 필요하다. */
    const ZOOM_MIN = 1;
    const ZOOM_MAX = 32;

    function onWheel(e: WheelEvent) {
      // 페이지가 같이 스크롤되면 지도 위에서 휠을 굴릴 수가 없다.
      // passive:false 로 걸어야 preventDefault 가 먹는다.
      e.preventDefault();

      const r = canvas!.getBoundingClientRect();
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;

      // 트랙패드 핀치는 ctrlKey 가 붙은 wheel 로 온다. deltaMode 0=픽셀,
      // 1=줄, 2=페이지 — 줄/페이지 단위로 오는 마우스 휠을 픽셀로 환산하지
      // 않으면 한 칸에 화면이 통째로 튄다.
      const unitPx = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1;
      const dy = e.deltaY * unitPx * (e.ctrlKey ? 3 : 1);
      const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoomTarget * Math.exp(-dy * 0.0016)));
      if (next === zoomTarget) return;

      if (next === 1) {
        // 원래 배율로 돌아오면 가운데로도 같이 돌아온다. 둘이 같은 계수로
        // 수렴하므로 도착 시점이 정확히 맞는다.
        offXTarget = 0;
        offYTarget = 0;
      } else if (next < zoomTarget) {
        // 축소는 **화면 한가운데** 기준이다. 커서에 맞춰 줄이면 화면 밖으로
        // 나가려는 방향으로 계가 끌려가서, 물러나는 게 아니라 딴 데로 밀려난다.
        // 들어갈 때는 겨눈 곳이 목적지지만 나올 때는 목적지가 없다 — 지금
        // 보고 있는 화면이 그대로 작아지는 게 맞다.
        //
        // 화면 중심의 세계 좌표를 고정하면 offset 이 배율에 비례해 줄어든다.
        const ratio = next / zoomTarget;
        offXTarget *= ratio;
        offYTarget *= ratio;
      } else {
        // 커서 밑의 지점이 **끝난 뒤에도 그 자리에 있도록** 이동 목표를 푼다.
        // 지금 좌표에서 계산하므로 이징 도중에 또 굴려도 튀지 않는다.
        const wx = (sx - cx) / unit;
        const wy = (sy - cy) / unit;
        const u = baseUnit * next;

        // 가두는 기준은 **계가 화면에 남는가**지 중심이 보이는가가 아니다.
        //
        // 처음에는 질량중심을 화면 안에 붙잡아 뒀는데(가장자리 40px), 세로로는
        // 352px 밖에 안 돼서 배율 4배에 화면 아래를 겨누면 필요한 이동량
        // 1050px 이 거기서 잘렸다 — 어느 순간부터 커서를 안 따라가고 안쪽으로
        // 끌려 들어갔다. 중심은 계의 기준점이긴 해도, 확대해 들어간다는 건
        // 원래 중심을 벗어난다는 뜻이다(이름표는 DOM 이라 제자리에 남는다).
        //
        // 대신 바깥 궤도가 화면에서 완전히 사라지지는 않게 한다(offLimit).
        const lim = offLimit(next);
        offXTarget = Math.max(-lim.x, Math.min(lim.x, sx - wx * u - w / 2));
        offYTarget = Math.max(-lim.y, Math.min(lim.y, sy - wy * u - h / 2));
      }
      zoomTarget = next;
    }

    resize();
    raf = requestAnimationFrame(frame);
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    // 캔버스가 아니라 창 전체에서 마우스를 따라간다. 캔버스에만 걸면 축척
    // 레일 위로 올라가는 순간 mouseleave 가 떠서 조준점이 사라지고 OS 커서가
    // 나타난다 — 커서가 두 번 바뀌는 셈이라 어긋나 보인다.
    // 판정 좌표는 그대로 캔버스 기준이라 계산은 달라지지 않는다.
    window.addEventListener("mousemove", onMove);
    document.addEventListener("mouseleave", onLeave);
    canvas.addEventListener("click", onClick);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("mousedown", onDown);
    // 창 전체에서 뗀다 — 캔버스 밖에서 손을 떼면 mouseup 을 못 받아 계가
    // 커서에 붙어 따라다닌다.
    window.addEventListener("mouseup", onUp);
    window.addEventListener("keydown", onKey);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseleave", onLeave);
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("keydown", onKey);
    };
  }, [bodies, memories, threads]);


  // 지금 펼친 기억의 근거들이 어떤 카테고리인지 — 범례에 쓴다.
  // 캔버스 안의 배분과 같은 함수를 써야 색이 어긋나지 않는다.
  // 중심 기억이 쓰고 있는 색이 어느 분야인지. 범례에서 이것만 테를 두른다 —
  // 중심도 위성과 같은 팔레트를 쓰는데 표시가 없으면 "가운데 저 색은 뭔가"에
  // 답이 없다.
  const focusDominantGroup = focus
    ? (() => {
        // 갈래는 자기 분야를 갖는다. 기억만 근거들에서 빌려온다.
        const dom =
          focus.kind === "thread"
            ? focus.category
            : dominantCategory(focus, new Map(bodies.map((b) => [b.id, b])));
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
      {/* 키보드로도 닿아야 한다. 마우스 없이는 기억을 하나도 고를 수 없었다.
          Tab 으로 지도에 들어오면 Enter/Space 로 가장 밝은 기억부터 펼치고
          Escape 로 나간다 — 캔버스라 스크린리더에는 요약을 대신 읽힌다. */}
      <canvas
        ref={canvasRef}
        className="map-canvas"
        tabIndex={0}
        role="img"
        aria-label={`궤도 지도 — 기억 ${memories.length}개, 경험 ${bodies.length}개. Enter 로 가장 중요한 기억을 펼치고 Escape 로 돌아온다.`}
      />

      {/* 중심 라벨 */}
      <div
        ref={centerLabelRef}
        // left/top 을 px 로 직접 준다. left-1/2 top-1/2 로 두면 뷰포트 한가운데에
        // 못 박혀서, 확대해 들어갔을 때 이름표만 남고 정작 그 별은 딴 데 가 있다.
        // -translate-x-1/2 은 그대로 — 가로 가운데 정렬은 여전히 필요하다.
        style={{ left: 0, top: 0 }}
        className={`pointer-events-none absolute -translate-x-1/2 text-center ${
          focus ? "mt-9" : "mt-6"
        }`}
      >
        <span className="tick">{focus ? (focus.kind === "thread" ? "갈래" : "기억") : centerLabel}</span>
        {/* 궤도가 통째로 비었을 때만. memories 만 보면 갈래 화면(memories=[])
            에서 갈래가 다섯 개 떠 있는데도 "남은 것이 없다"가 뜬다. */}
        {!focus && memories.length === 0 && threads.length === 0 && (
          <div className="tick mt-3 opacity-60">아직 궤도에 남은 것이 없다</div>
        )}
      </div>

      {probe && (
        <div
          ref={probeRef}
          className="probe"
          style={{ transform: `translate(${probe.x + 18}px, ${probe.y - 12}px)` }}
        >
          <div className="readout mb-1.5 text-[11.5px] tracking-[0.16em] text-lum-3">{probe.sub}</div>
          {/* 스킬을 위에, 내용을 아래에 둔다. 그 사이를 헤어라인으로 가른다 —
              trigger 가 왜 그 값인지를 제목보다 먼저 읽어야 한다. */}
          {probe.skills && probe.skills.length > 0 && (
            <>
              <div className="mb-2 flex flex-wrap gap-1">
                {probe.skills.map((sk) => (
                  <span
                    key={sk.name}
                    className={[
                      "readout rounded-sm border px-1.5 py-0.5 text-[11.5px]",
                      sk.firstTime
                        ? "border-[rgba(160,185,220,0.34)] text-lum-0"
                        : "border-[rgba(160,185,220,0.12)] text-lum-3",
                    ].join(" ")}
                  >
                    {sk.name}
                  </span>
                ))}
              </div>
              <div className="mb-2 h-px" style={{ background: "rgba(160,185,220,0.16)" }} />
            </>
          )}
          <div className="font-sans text-[14.5px] leading-snug text-lum-0">{probe.text}</div>
        </div>
      )}

      {/* 붙어 있는 기억 */}
      {focus && (
        <div className="pointer-events-none absolute left-1/2 top-16 w-full max-w-lg -translate-x-1/2 px-6 text-center">
          <div className="settle">
            <div className="tick mb-2">
              {focus.kind === "thread"
                ? `갈래 · ${tag(focus.status)} · 경험 ${focus.referencedIds.length}건 · ${ymd(focus.occurredAt)} 시작${
                    focus.completedAt ? ` → ${ymd(focus.completedAt)} 완결` : ""
                  }`
                : `${tag(focus.trigger)} · 경험 ${focus.referencedIds.length}건 · ${ymd(focus.occurredAt)}`}
            </div>
            <h2 className="text-[18px] font-medium text-lum-0">{focus.title}</h2>

            {/* 완결은 사람만 안다. 브라우징 기록은 "무엇을 했나"를 말하는데
                완결은 "더 할 게 없다"는 판단이라 기록에 흔적이 없다 — 역대 LLM
                호출 75회 중 completed=true 가 한 번도 없었다.
                pointer-events-none 인 부모 안이라 이 버튼만 다시 켠다. */}
            {focus.kind === "thread" && focus.status === "active" && onComplete && (
              <button
                type="button"
                disabled={completing}
                onClick={() => {
                  setCompleting(true);
                  // 끝내고 나면 이 갈래는 진행 중이 아니다. 펼친 화면을 닫아
                  // 목록으로 돌려보낸다 — 남아 있으면 방금 누른 버튼이 사라진
                  // 자리를 보게 된다.
                  onComplete(focus.id).finally(() => {
                    setCompleting(false);
                    setFocus(null);
                  });
                }}
                className="readout pointer-events-auto mt-4 rounded-sm border border-[rgba(99,230,210,0.3)] px-3 py-1.5 text-[12.5px] text-lum-1 transition-colors hover:border-[rgba(99,230,210,0.6)] hover:text-lum-0 disabled:opacity-40"
              >
                {completing ? "기록하는 중…" : "이 일 끝났어"}
              </button>
            )}

            {/* 이 기억을 남긴 근거. 제목 바로 아래에 두고 본문과는 헤어라인으로
                가른다 — 무엇이 처음이었나가 먼저, 무슨 일이 있었나가 그다음이다. */}
            {focus.kind === "memory" && focus.skills.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center justify-center gap-x-2 gap-y-1.5">
                {focus.skills.map((sk) => (
                  <span
                    key={sk.name}
                    className={[
                      "readout rounded-sm border px-1.5 py-0.5 text-[12px]",
                      sk.firstTime
                        ? "border-[rgba(160,185,220,0.34)] text-lum-0"
                        : "border-[rgba(160,185,220,0.12)] text-lum-3",
                    ].join(" ")}
                  >
                    {sk.name}
                  </span>
                ))}
              </div>
            )}



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
                      title={isCenter ? "주된 분야 — 중심이 쓰는 색" : undefined}
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
              경험 · {formatKstYmd(new Date(picked.occurredAt), ".")} ·{" "}
              {tag(picked.outcome)} · M{picked.memoryScore}
            </div>
            <p className="font-sans text-[15px] leading-relaxed text-lum-0">{picked.summary}</p>
          </div>
        </div>
      )}
    </div>
  );
}
