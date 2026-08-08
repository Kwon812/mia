"use client";

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { EXPERIENCE_CATEGORIES, clampSentence, type ExperienceCategory } from "@na/shared";

import { formatKstYmd } from "@/lib/date";

// 궤도 지도 — 이 사이트의 본체.
//
// **천체는 한 종류다: 갈래 하나가 항성계 하나.**
//
// 예전에는 둘이었다 — 기억이 별이고 갈래가 도는 것이었다. 그런데 기억은 갈래당
// 하나라(uq_memories_thread) 같은 것을 둘로 그린 셈이었고, 대가가 컸다:
// 방향 문법이 두 벌이었다(기억은 trigger, 갈래는 분야). 한 계에 어휘가 둘이면
// 축 라벨도 두 벌이고, 그때부터 방향은 아무 뜻도 못 갖는다.
//
// 합치면 기억은 사라지는 게 아니라 **별의 성질**이 된다.
//   자리   ← 분야(방향) × 시작한 지(반경). 한 문법뿐이다.
//   크기   ← 붙은 경험 수. 질량이다.
//   광도   ← 그 갈래에 남은 기억의 중요도. 안 남았으면 어두운 별이다.
//   색     ← 분야. 거기에 trigger 가 색온도로 얹힌다.
//   선     ← 중심과 이어져 있나. 놓은 갈래(abandoned)만 끊긴다.
//
// 별을 당기면 그 안의 경험이 위성으로 돈다. 경험이 그 일을 이루는 것이므로
// 그 관계가 곧 궤도가 된다 — 도는 것은 이제 위성뿐이다.

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

/** 갈래에 남은 기억. 갈래당 하나다(uq_memories_thread) — 그래서 별의 성질로
 *  얹을 수 있다. 없으면 null: 아직 아무것도 안 남긴 일이고, 어두운 별이 된다. */
export type ThreadMemory = {
  id: string;
  title: string;
  body: string;
  /** 1~10. 별의 광도가 된다 */
  importance: number;
  /** 남은 이유 중 가장 센 것. 별의 색온도가 된다 */
  trigger: string;
  /** 남은 이유 전부. 여럿이면 그게 곧 그 기억의 성격이라 판독값에 다 적는다 */
  triggers: string[];
  /** 기억이 선 시각. 자리는 갈래의 started_at 이 정하므로 표시용이다 */
  occurredAt: number;
  /** 이 기억을 만든 경험들(memories.experience_ids). 위성에 테두리로 표시된다 */
  experienceIds: string[];
  /** 그 경험에서 쓴 스킬(비중 내림차순). firstTime 이 이 기억을 남긴 근거다 —
   *  trigger=new_skill 만으로는 "무슨 스킬?"에 답할 수 없다. */
  skills: { name: string; firstTime: boolean }[];
};

/**
 * 갈래 — 여러 날에 걸쳐 하나로 이어진 작업(threads). **이 계의 유일한 천체다.**
 *
 * 항성계 하나로 본다. 별이 그 일 자체이고, 위성이 그 안의 경험이다.
 * 기억은 따로 뜨지 않고 `memory` 로 얹혀 광도와 색온도가 된다 — 갈래당 기억이
 * 하나라 둘로 그리면 같은 것이 화면에 두 번 뜬다.
 */
export type ThreadBody = {
  kind: "thread";
  id: string;
  title: string;
  category: string;
  /** active | completed | abandoned */
  status: string;
  /** 이 갈래에 붙은 경험 수 — 질량이고, 곧 크기다 */
  experienceCount: number;
  /** 시작 시각 (반경의 근거) */
  occurredAt: number;
  /** 완결 시각. active·abandoned 는 null */
  completedAt: number | null;
  ageDays: number;
  /** 이 갈래에 속한 경험들 — 당기면 위성으로 펼쳐진다 */
  referencedIds: string[];
  /** 이 갈래를 시작한 경험(과 기억을 만든 근거들). 위성에 테두리로 표시된다.
   *  위성은 갈래 경험 **전부**를 보여주고 이 목록만 테두리로 구분한다 —
   *  "이 일에 뭐가 있었나"와 "그중 뭐가 남았나"는 다른 질문이라 한 화면에 둘 다
   *  있어야 한다. */
  sourceIds: string[];
  /** 남은 것. 없으면 어두운 별이다. */
  memory: ThreadMemory | null;
};

/** 주 궤도에 오르는 것. 한 종류뿐이지만 이름은 남긴다 — 소비처(map-stage ·
 *  thread-stage)가 "지금 보고 있는 천체"라는 뜻으로 쓰고 있고, 그 뜻은
 *  천체가 하나가 되어도 그대로다. */
export type OrbitBody = ThreadBody;

/** 위성(경험)의 이심률. 결과가 궤도의 안정성이 된다 — stuck 일수록 찌그러진다.
 *  주 천체(별)는 이제 안 돌아서 이심률이 없다. 도는 것은 위성뿐이다. */
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

/**
 * trigger → 색온도. **방향이 아니라 색이다.**
 *
 * 예전에는 이 값이 별의 방향을 갈랐다. 그때는 별(기억)과 도는 것(갈래)이
 * 따로였고 각자 제 방향 문법을 가졌는데, 한 계에 방향 어휘가 둘이면 축 라벨도
 * 두 벌이 되어(NEW_SKILL 옆에 DEV) 방향이 아무 뜻도 못 갖는다.
 * 천체가 하나가 되면서 방향은 분야 하나로 정리됐고, trigger 는 색으로 옮겼다.
 *
 * +1 이 가장 뜨겁고(푸른 별) -1 이 가장 식었다(붉은 별). 실제 별의 색온도와
 * 같은 방향이다 — 막 뚫고 나온 것이 뜨겁고, 오래 식었다 돌아온 것이 붉다.
 * 없는 값은 0(색온도 없음)으로 떨어져 분야 색 그대로 뜬다.
 */
const TRIGGER_TEMP: Record<string, number> = {
  breakthrough: 1, // 막 뚫고 나왔다
  new_skill: 0.6, // 처음 해봤다
  deepened: 0.2, // 오래 붙들고 있다
  thread_complete: -0.2, // 끝냈다. 식어서 자리를 잡았다
  comeback: -0.6, // 비웠다 돌아왔다
  revival: -1, // 오래 식었다 돌아왔다
};

/** 색온도의 양 끝. 푸른 쪽은 흰빛에 가깝고 붉은 쪽은 호박색이다. */
const TEMP_HOT: [number, number, number] = [202, 224, 255];
const TEMP_COOL: [number, number, number] = [255, 186, 132];
/** 색온도가 분야 색을 얼마까지 끌어당기나. **작아야 한다** — 색의 1차 뜻은
 *  분야이고(범례가 그렇게 적혀 있다), 색온도는 그 위의 결이다. 0.34 면
 *  dev 파랑은 뜨거워져도 파랑이고 study 분홍은 식어도 분홍이다. */
const TEMP_MIX = 0.34;

/** 분야 색에 색온도를 얹는다. 기억이 없으면(trigger=null) 분야 색 그대로다 —
 *  아직 아무것도 안 남긴 일에는 색온도랄 게 없다. */
function tempered(
  color: [number, number, number],
  trigger: string | null,
): [number, number, number] {
  if (!trigger) return color;
  const k = TRIGGER_TEMP[trigger] ?? 0;
  if (k === 0) return color;
  const to = k > 0 ? TEMP_HOT : TEMP_COOL;
  const m = Math.abs(k) * TEMP_MIX;
  return [
    Math.round(color[0] + (to[0] - color[0]) * m),
    Math.round(color[1] + (to[1] - color[1]) * m),
    Math.round(color[2] + (to[2] - color[2]) * m),
  ];
}

/**
 * 광도 — 그 갈래에 남은 기억의 중요도.
 *
 * **관측 범위로 정규화한다.** 0 을 기준으로 나누면 안 된다 — 실측 분포가
 * 중요도 1~10 에 퍼져 있어도 `imp/10` 은 0.48~1.0 이라, 부드러운 그라디언트
 * 위에서는 그 차이가 안 읽힌다(실제로 "밝기 차가 안 보인다"가 나왔다).
 * 화면에 있는 것 중 가장 어두운 것을 바닥에, 가장 밝은 것을 천장에 놓고
 * 그 사이를 다 쓴다 — 위성 층이 topScore 로 푸는 것과 같은 규칙이되,
 * **최솟값도 같이 뺀다**는 것이 다르다.
 *
 * 세 층이 확실히 갈려야 한다:
 *   LUM_DARK      아직 아무것도 안 남긴 일
 *   LUM_KEPT_MIN  남긴 것 중 가장 약한 것 — 어두운 별보다 확실히 위
 *   1             가장 중요한 것
 *
 * LUM_DARK 를 0.2 → 0.30 으로 올렸다. 크기까지 바닥이면(SIZE_MIN) 두 채널이
 * 같이 눌려 "안 보이는 별"이 된다 — 아직 안 남긴 일도 **있다는 것은 보여야**
 * 한다. LUM_KEPT_MIN(0.46)과의 간격은 0.16 이라 세 층 구분은 그대로다.
 */
const LUM_DARK = 0.3;
const LUM_KEPT_MIN = 0.46;

// ══════════════════════════════════════════════════════════════
// 층 — 우주 · 은하 · 항성계 · 행성
// ══════════════════════════════════════════════════════════════
//
// 원리 셋(계획서):
//   1. 층마다 **하나의 종류만** 천체다. 위층은 배경, 아래층은 없는 것.
//   2. 자식 계의 반경 ≤ 부모끼리 간격 / LAYER_RATIO (힐 구면).
//      겹침을 사후에 밀지 않고 **배치 규칙으로** 막는다.
//   3. 시간은 로그 나선 r = a·e^(bθ). 각도까지 쓰므로 같은 면적에 훨씬 많이
//      들어가고, 로그라 시간이 쌓여도 안쪽 생김새가 안 변한다.
//
// 원리 2 가 이 파일에서 가장 큰 것을 지웠다: **축척 역산이 통째로 사라졌다.**
// 예전에는 가장 빽빽한 한 쌍을 찾아 그 둘이 안 겹칠 만큼 축척을 키웠는데
// (unitNeed · PACK_MARGIN · PACK_MAX), 그건 겹침을 사후에 미는 일이었다.
// 배치가 애초에 안 겹치면 그 계산은 할 이유가 없다.

/**
 * 층 사이 배율. 자식 계의 반경 = 부모끼리 간격 / 이 값.
 *
 * 이 한 값이 세 가지를 동시에 정한다:
 *   - 은하 반경 = 은하끼리 간격 / R
 *   - 항성계 반경 = 은하 안 별끼리 간격 / R
 *   - 한 층 내려가는 데 필요한 확대 배율 = R
 * 그래서 문턱을 손으로 맞출 일이 없다(4단계).
 *
 * 실제 우주는 훨씬 크다 — 은하 안의 별은 1:3천만이다. 그래서 별밭이 비어
 * 보인다. 30 은 그 성질(위층에서 아래층은 점)을 지키면서 화면에서 오갈 수
 * 있는 선으로 잡은 값이다. 휑하면 이 숫자 하나만 낮추면 전부 따라온다.
 */
const LAYER_RATIO = 30;

/**
 * 은하 자리 — **코스믹 웹**(5단계).
 *
 * 손으로 놓은 표다. 두 필라멘트가 권도형 곁을 스쳐 지나가며 교차하고,
 * 몇은 그 바깥에 떨어져 있다. 균등한 원 배치를 안 쓴 이유는 그게 실제
 * 우주에서 가장 안 나오는 모양이기 때문이다 — 물질은 실과 마디로 뭉친다.
 *
 * **표여야 한다.** 데이터에서 계산하면 갈래가 하나 늘 때마다 은하가 통째로
 * 움직이고, 그러면 "어제 저기 있던 게 오늘 여기"가 된다. 색(colorOfCategory)
 * 을 등장 순서와 무관하게 고정한 것과 같은 이유다.
 *
 * ── 왜 색 묶음이 아니라 카테고리인가 ──
 *
 * 처음엔 색 묶음(여덟)을 그대로 은하로 썼다. 그런데 묶은 이유는 **순전히
 * 색**이었다 — "검은 배경 위 작은 후광으로 구분되는 색은 여덟이 한계다"
 * (CAT_GROUP_DEFS 주석). 자리는 그 한계를 안 받는다. 우주에 점 열넷을 놓는
 * 건 아무 문제가 없다.
 *
 * 그대로 뒀더니 `search` 갈래가 `ETC` 은하에 들어가 있었다 — 왜 거기 있는지
 * 화면 어디에도 답이 없었다. `life` 는 넷(news·finance·shopping·productivity)이
 * 한 덩어리라 더 심했다.
 *
 * 나누면 두 채널이 서로 다른 것을 말한다:
 *   색       그 결이 무엇인가 (여덟) — 같은 색이면 비슷한 종류
 *   자리·이름 무슨 일인가 (열넷)   — 같은 색이어도 다른 자리, 다른 이름
 * 같은 자홍색 넷이 흩어져 떠 있어도 헷갈리지 않는다. 오히려 "이것들이 한
 * 결이구나"가 색으로 읽히고, 각각이 무엇인지는 이름이 말한다.
 *
 * 순서는 EXPERIENCE_CATEGORIES 그대로. 단위는 궤도 단위다.
 */
const GALAXY_SITES = [
  // 필라멘트 A — 왼쪽 아래에서 오른쪽 위로 가로지른다
  [0.68, 0.42],   // dev
  [1.86, 1.06],   // study
  [2.94, 1.72],   // docs
  [-0.62, -0.26], // ai
  [-1.78, -0.88], // search
  [-2.92, -1.52], // community
  // 필라멘트 B — A 와 권도형 곁에서 엇갈린다
  [-1.62, 1.22],  // entertainment
  [-0.58, 0.78],  // music
  [0.82, -0.66],  // shopping
  [1.92, -1.28],  // productivity
  [3.02, -1.94],  // design
  // 마디 밖에 떨어진 것들 — 실이 안 닿는 자리에도 은하는 있다
  [-2.46, 0.34],  // news
  [2.34, 0.16],   // finance
  [0.06, -1.74],  // etc
] as const satisfies readonly (readonly [number, number])[];

/** 자리표가 카테고리 수와 **정확히** 맞는지 컴파일 타임에 확인한다.
 *  하나라도 어긋나면 마지막 자리로 조용히 떨어져 두 은하가 포개진다 —
 *  런타임에는 아무 티도 안 난다. */
const _sitesCoverCategories: typeof GALAXY_SITES extends {
  length: typeof EXPERIENCE_CATEGORIES.length;
}
  ? true
  : ['GALAXY_SITES 개수가 EXPERIENCE_CATEGORIES 와 다르다'] = true;
void _sitesCoverCategories;

/** 은하끼리의 이웃 간격(궤도 단위). 위 표에서 잰 값이다 — 표를 고치면
 *  여기도 같이 봐야 한다. 은하 반경이 이 값에서 나온다. */
const GALAXY_GAP = 1.2;

/** 은하 원반의 반경(궤도 단위). 원리 2 그대로. */
const GALAXY_R = GALAXY_GAP / LAYER_RATIO;

// ── 은하 안 (2·3단계) ──

/** 나선팔 개수. 둘이 고전적인 나선은하 모양이고, 갈래가 적은 은하에서도
 *  팔 하나에 몇 개씩은 남아 곡선이 읽힌다 — 넷으로 쪼개면 팔마다 한둘이라
 *  그냥 흩뿌린 것과 구분이 안 된다. */
const ARMS = 2;

/**
 * 나선의 감김. 로그 나선 r = r0·e^(bθ) 의 b 이고, **피치각 = atan(b)** 다.
 * 실제 나선은하가 10~25도라 0.30(약 17도)으로 잡았다.
 *
 * b 가 작을수록 한 바퀴 도는 동안 반경이 덜 늘어난다 — 즉 각도를 많이 쓴다.
 * 그게 원리 3 이 노린 것이다: 같은 면적에 더 많이 들어간다.
 */
const ARM_PITCH = 0.3;

/** 팔이 시작하는 반경(원반 반경에 대한 비율). 안쪽은 팽대부(bulge)라
 *  나선이 없다 — 0 에서 시작하면 중심에서 모든 팔이 한 점으로 모여 엉킨다. */
const BULGE = 0.18;

/** 팔이 감기는 총 각도(라디안). 팔 끝에서 반경이 딱 원반 끝이 되도록 역산한다 —
 *  `BULGE·e^(b·θmax) = 1  →  θmax = ln(1/BULGE)/b`. 그래야 팔이 원반을 꽉
 *  채우고 밖으로도 안 삐져나간다. 지금 값으로 0.91 바퀴다.
 *  **배치와 그리기가 이 한 값을 같이 쓴다** — 갈리면 별이 팔에서 벗어난다. */
const ARM_SPAN = Math.log(1 / BULGE) / ARM_PITCH;

/** 팔의 두께(라디안). 팔은 선이 아니라 띠다 — 0 이면 자로 그은 곡선이 되어
 *  1단계의 격자와 같은 문제(너무 규칙적이라 계기판이 아니라 도표)가 된다. */
const ARM_WIDTH = 0.55;

/** halo 가 놓이는 반경대(원반 반경에 대한 비율).
 *  **완결이 안쪽, 방치가 바깥이다.** 둘 다 원반을 떠난 것이지만 같지 않다 —
 *  끝낸 것은 자리를 잡고 멈춘 것이고, 놓은 것은 흘러나간 것이다.
 *  예전에는 이 구분을 '중심과의 선이 끊겼나'로 말했다(별자리 선). 그 선은
 *  버렸고, 이제 얼마나 멀리 나갔느냐가 그 말을 대신한다. */
const HALO_DONE = [1.08, 1.32] as const;
const HALO_LEFT = [1.44, 1.78] as const;

/** 은하가 차지하는 가장 바깥(원반 반경에 대한 비율). halo 끝이다 —
 *  이름표를 어디에 붙일지, 화면 밖 판정을 어디서 자를지가 여기서 나온다. */
const GALAXY_EDGE = HALO_LEFT[1];

// 위성(경험) 궤도면의 갈래는 outcome 이 정한다. 네 개로 고정된 값이라
// 나눠도 뭉개지지 않는다 — category 는 LLM 이 자유 텍스트로 쓰는 값이라
// 이론상 무한하고, 표기가 흔들리면(개발/dev/프로그래밍) 계속 늘어난다.
// 계 층에서 분야 묶음(여덟)이 방향을 잡는 것과 같은 위계다.
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
  // 만드는 일. 색상환에서 study 분홍(348°)과 life 자홍(309°) 사이가 비어 있어
  // 거기를 쓴다 — 옆 두 색과 40도 가까이 벌어져 검은 배경에서 갈린다.
  { key: 'design', label: 'design', cats: ['design'], color: [200, 120, 190] },
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

/** 카테고리 → 색. 등장 순서와 무관하게 언제나 같은 색이다 —
 *  예전에는 화면에 있는 값들을 정렬해 순서대로 팔레트를 나눠줬는데,
 *  값이 하나 늘면 그 뒤가 전부 밀려 어제 외운 색이 오늘 다른 뜻이 됐다. */
export function colorOfCategory(cat: string): [number, number, number] {
  return groupOfCategory(cat).color;
}

/** 이 갈래가 어느 은하에 속하는가. **카테고리 그대로**다 —
 *  EXPERIENCE_CATEGORIES 의 순서가 곧 GALAXY_SITES 의 순서다.
 *
 *  색 묶음(여덟)으로 접었던 때가 있는데, 그러면 `search` 갈래가 `ETC` 은하에
 *  들어가 왜 거기 있는지 알 길이 없었다 — 묶은 이유는 색이었지 자리가 아니다.
 *
 *  목록에 없는 값(예전 데이터, 표기 흔들림)은 마지막 칸(etc)으로 떨어진다.
 *  색이 groupOfCategory 로 같은 곳에 떨어지는 것과 짝이다.
 *
 *  **방향은 이제 아무 뜻도 없다.** 예전에는 분야가 방향 조각(SECTOR)이었는데,
 *  분야가 은하가 되면서 그 문법이 통째로 사라졌다 — 분야는 이제 '어느 쪽'이
 *  아니라 '어디'다. 조각을 나눌 이유도, 축을 그을 이유도 없어졌다. */
function galaxyIndexOf(t: ThreadBody): number {
  const i = EXPERIENCE_CATEGORIES.indexOf(t.category as ExperienceCategory);
  return i < 0 ? EXPERIENCE_CATEGORIES.length - 1 : i;
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

// 나이 → 반경의 절대식(`0.16 + √경과일 × 0.12`)이 여기 있었다. 로그 나선이
// 대신한다 — 이제 반경은 절대 경과일이 아니라 **그 은하 안에서의 나이 순위**
// 에서 나오고(spanOf), 그 순위가 나선 위의 θ 가 된다.
//
// 절대식을 버린 이유: 은하마다 시간대가 다르다. 4년 된 분야와 이번 주에 시작한
// 분야에 같은 자를 대면, 앞쪽은 전부 가장자리에 몰리고 뒤쪽은 전부 중심에
// 뭉친다 — 은하 안이 텅 비거나 테두리만 찬다. 은하는 저마다 제 시간을 갖는다.
//
// 잃은 것: 은하끼리 나이를 견줄 수 없다("저 분야가 더 오래됐나"). 얻은 것:
// 어느 은하를 들여다봐도 그 안이 고르게 차 있다. 지도가 먼저 답해야 하는 것은
// "이 분야 안에서 뭐가 오래된 일인가"라 이쪽이 맞다.

// ── 최근 표식 — 잔광 궤적 ───────────────────────────────
//
// **위성 층에서만 쓴다.** 계 층의 별은 안 돌아서 끌 길이 없다 — 거기서는
// 코로나(drawCorona)가 같은 일을 한다.
//
// 예전에는 맥동이었다. 최근 천체의 크기와 밝기가 같이 숨쉬었는데, 화면에서
// 유일하게 **뜻 없이 움직이는 것**이라 뭘 보려 해도 눈이 계속 그리로 끌려갔다.
// 게다가 크기는 이미 중요도의 축이라, 뛰는 동안에는 크기를 못 읽는다.
//
// 잔광은 새 움직임을 안 더한다 — 이미 돌고 있는 천체가 지나온 길일 뿐이다.
// 모양도 색도 새로 안 만든다(천체와 같은 그라디언트, 그 천체의 분야 색).
// 길이가 곧 순서다: 가장 최근이 가장 길게 끈다.
//
// 라디안으로 잰다. 초 단위로 재면 궤도마다 각속도가 달라(케플러) 안쪽 천체는
// 반 바퀴를 끌고 바깥 천체는 점 하나만 남는다 — 같은 "최근"이 다르게 보인다.
/**
 * ── 층이 배어 나오는 배율 (4단계) ──
 *
 * **크기에서 유도한다. 손으로 맞춘 값이 없다.**
 *
 * 한때 `R`, `R²` 으로 잡았다. "한 층 내려가는 배율 = LAYER_RATIO"(원리 2)를
 * 그대로 믿은 것인데 틀렸다 — 원리 2 는 **간격**에 대한 규칙이라 자식 반경은
 * 부모 *간격*의 1/R 이지 부모 *크기*의 1/R 이 아니다. 코스믹 웹은 은하 간격
 * (1.2)보다 훨씬 넓게 퍼져 있어서(반경 3.3) 우주/은하 비가 30 이 아니라 80 이
 * 된다. 그 어긋남 때문에 `R²`(=900)까지 당겨도 항성계가 별 후광 속에 파묻혀
 * 있었다 — 실제로는 만 배 넘게 당겨야 나오는 자리였다.
 *
 * 그래서 배율을 **"그게 화면을 채우는 지점"** 으로 직접 푼다. 반경 s 인 것은
 * `zr = FILL·maxR/s` 에서 화면을 채운다(fitZoom 의 정의에서 나온다).
 * 배어 나오기 시작하는 곳은 그 REVEAL_ONSET 배 — 문턱이 아니라 경사라,
 * 다 나오기 전에 이미 "저기 뭔가 있다"가 읽힌다.
 */
const FILL = 0.8;
const REVEAL_ONSET = 0.25;

/** 은하와 별 중 **누가 눌리는가**를 가르는 문턱(starReveal 기준).
 *  한 값을 양쪽이 반대로 써서 겹치는 구간이 없다 — 겹치면 은하가 제 별을
 *  삼킨다(판정 반경이 원반을 따라 자라고, nearest 가 그걸 CAPTURE 배로 또
 *  넓힌다). 별이 이만큼 드러났으면 누르려는 건 별이지 은하가 아니다. */
const STAR_HIT = 0.35;

/** id → 천체. */
function dominantBody(id: string | null, threads: ThreadBody[]): OrbitBody | null {
  if (!id) return null;
  return threads.find((t) => t.id === id) ?? null;
}

/** 위성계의 기준 반경(펼친 뒤). 계 화면의 작은 위성계는 이보다 훨씬 작으므로,
 *  위성 크기를 그 비율로 줄인다 — 안 줄이면 반경 60px 짜리 계 안에 반경 10px
 *  짜리 위성이 열 개 떠서 궤도가 안 보이고 덩어리만 남는다.
 *  완전히 비례시키면 계 화면에서 안 보일 만큼 작아지므로 제곱근으로 누른다. */
const SAT_REF_R = 235;
const satScaleOf = (R: number) => Math.max(0.42, Math.min(1, Math.sqrt(R / SAT_REF_R)));

/** 별의 크기(px) — 붙은 경험 수, 곧 질량이다.
 *
 *  예전에는 기억의 중요도였다. 그런데 중요도는 이제 광도라, 크기까지 맡으면
 *  한 값이 채널 둘을 쓰고 "얼마나 오래 붙들고 있는 일인가"는 화면에서 사라진다.
 *
 *  **관측 범위로 정규화한다.** 절대 로그(`3.5 + log1p(n)·2`)를 쓰던 때는
 *  1건이 4.9 · 2건이 5.7 이었다 — 실측 분포가 1~4건에 80%가 몰려 있어서
 *  데이터 대부분이 0.8px 안에 들어갔고, 후광까지 부드러우니 아무 차이도
 *  안 보였다. 로그는 그대로 두되(15건이 1건의 15배로 뜨면 계가 그것 하나가
 *  된다) **최솟값을 빼서** 있는 폭을 다 쓴다.
 *
 *  SIZE_MIN 을 3.2 → 4.6 으로 올렸다. 정규화가 **관측 범위**를 쓰기 때문에
 *  경험이 적은 갈래는 정확히 바닥값에 눌린다 — 지금 갈래 여섯 중 넷이 1건이라
 *  넷 다 3.2px 였고, 후광에 묻혀 "거기 뭔가 있다"조차 안 읽혔다. 바닥을
 *  올려도 천장(13)은 그대로라 질량 차이는 여전히 2.8배로 벌어진다. */
const SIZE_MIN = 4.6;
const SIZE_MAX = 13;

/**
 * 별은 배율을 따라 같이 커진다.
 *
 * 위성(경험)은 제 궤도 반경에 맞춰 커지다가 satScaleOf 의 상한에서 멈춘다.
 * 별을 고정 크기로 두면 확대할수록 그 차이가 좁혀져서, 다 당겼을 때 별이
 * 제 위성들과 같은 크기가 된다 — "누가 중심인가"가 화면에서 뒤집힌다.
 *
 * 은하 안에 막 들어선 배율(zr≈R)에서 1 이 되게 맞춘다 — 거기가 별밭을
 * 견주는 자리라, 그 화면의 크기가 기준이어야 한다.
 * 제곱근으로 누르고 상한을 둔다: 배율에 그대로 비례시키면 다 당겼을 때
 * 별 하나가 화면을 통째로 덮는다.
 */
const starGrowOf = (zr: number, starLayerZoom: number) =>
  Math.min(2.4, Math.max(0.28, Math.sqrt(zr / starLayerZoom)));

/** 광도가 후광을 얼마나 번지게 하나. 심(질량)은 안 건드린다 — drawStar 참고.
 *  크기 하한(별이 제 위성보다 커야 한다)이 이 값을 되나눠야 해서 밖으로 뺐다. */
const bloomOf = (lum: number) => 0.66 + 0.34 * Math.max(0, Math.min(1, lum));

/** 별이 제 위성 중 가장 큰 것보다 이만큼은 커야 한다.
 *  1 이면 딱 같은 크기라 위계가 안 읽힌다 — 주인이 손님보다 확실히 커야 한다. */
const STAR_OVER_SAT = 1.3;

/** 위성 알파의 천장(제 별에 대한 비율). 크기와 같은 이유다 — 근거가 제 별보다
 *  밝으면 안 된다. 너무 낮추면 근거끼리의 밝기 차(그게 memory_score 다)가
 *  같이 눌리므로 살짝만 깎는다. */
const SAT_UNDER_STAR = 0.82;

/** 겨눈 위성이 커지는 배율. **별의 크기 하한이 이 값을 알아야 한다** —
 *  모르면 겨누는 순간 경험이 제 갈래보다 커진다(실측 69.5px 대 56.5px). */
const SAT_LIT = 1.6;

/** 천체를 그린 반지름 = size × 이 값. 별과 위성이 계수가 달라(3.2 vs 4.1)
 *  size 끼리 직접 못 견준다 — 크기 하한을 풀 때 둘 다 필요하다. */
const STAR_GLOW = 3.2;
const SAT_GLOW = 4.1;

/** 순위별 잔광이 훑는 궤도각. 배열 길이가 곧 표식할 개수다.
 *  짧고 굵으면 궤적이 아니라 천체에 붙은 불꽃으로 보인다 — 길이가 순서를
 *  나타내려면 먼저 "길다"가 읽혀야 한다. */
const TRAIL_SPAN = [0.95, 0.6, 0.34] as const;
/** 잔광을 몇 점까지 쪼개 그리나.
 *  고정값을 쓰면 안 된다 — 같은 각도라도 바깥 궤도는 화면에서 훨씬 긴 호가
 *  되어서 점 사이가 벌어지고, 잔광이 아니라 **점선**으로 보인다(작은 위성에서
 *  실제로 그렇게 나왔다). 화면에서 잰 길이로 개수를 정하고, 그래도 모자라면
 *  아래에서 점 반지름에 간격만큼의 하한을 둬 서로 겹치게 만든다. */
const TRAIL_STEPS_MAX = 40;

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

/** 계에 놓인 별 하나. **안 돈다** — 자리가 고정이고 도는 것은 위성뿐이라
 *  궤도 요소는 위성 층(Sat)에만 남아 있다.
 *
 *  극좌표(a·plane)였다가 직교좌표가 됐다. 분야가 은하가 되면서 천체가 원점
 *  하나를 도는 게 아니라 **저마다 제 은하 중심 곁**에 놓이기 때문이다 —
 *  중심이 여럿이면 극좌표로는 표현이 안 된다. */
type Elem = {
  id: string;
  /** 궤도 단위 좌표. 원점은 권도형이다. */
  x: number;
  y: number;
  /** 광도 — 남은 기억의 중요도. 알파에 곱해진다 */
  lum: number;
  size: number;
  color: [number, number, number];
  /** 이 자리에 선 갈래 */
  mem: OrbitBody;
};

export function OrbitalMap({
  bodies,
  threads,
  centerLabel,
  latestIds,
  onComplete,
  onFocusChange,
}: {
  bodies: Body[];
  /** 계의 천체 전부. 갈래 하나가 별 하나다 — 당기면 속한 경험이 위성으로. */
  threads: ThreadBody[];
  centerLabel: string;
  /** 최근에 들어온 것들. **앞에 있을수록 최근이다** — 순서가 곧 표식의 세기라
   *  배열을 섞으면 화면의 뜻이 바뀐다.
   *  계에서는 갈래가, 펼친 뒤에는 경험이 같은 표식을 쓴다 — "이게 방금 그거다"가
   *  층을 건너 읽힌다. TRAIL_SPAN 이 정한 수(3)를 넘는 뒤쪽은 무시된다. */
  latestIds?: readonly string[];
  /** 갈래를 완결로 표시한다. 없으면 버튼 자체가 안 뜬다. */
  onComplete?: (threadId: string) => Promise<unknown>;
  /** 지금 화면이 무엇 하나에 대한 것인지. 눌러서 펼쳤거나, 당겨서 그 별의
   *  계 안에 들어와 있으면 그 천체를 넘긴다. 아니면 null.
   *  지도 바깥(계기판)이 이 값으로 물러나고 범례를 갈아 끼운다. */
  onFocusChange?: (viewing: OrbitBody | null) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /**
   * 겨눈 것의 판독값.
   *
   * `rows` 가 **라벨 붙은 표**다. 예전에는 한 줄에 전부 `·` 로 이어 붙였는데
   * (`기억 · THREAD_COMPLETE · BREAKTHROUGH · ACTIVE · DOCS · 경험 3건 · 날짜`),
   * 값이 전부 같은 모양의 대문자 토큰이라 **어느 게 뭔지 분간이 안 됐다** —
   * THREAD_COMPLETE 와 ACTIVE 와 DOCS 가 나란히 있는데 셋 다 다른 종류다.
   *
   * 값 자체는 enum 그대로 둔다. 한글 대응표를 두면 화면과 DB·프롬프트가 다른
   * 어휘를 쓰게 되고 값이 늘 때마다 번역을 빠뜨린다(tag 주석의 규칙).
   * 대신 **라벨**을 붙인다 — 그건 값이 아니라 "이 자리가 무엇인가"라 한글이 맞다.
   */
  const [probe, setProbe] = useState<{
    x: number;
    y: number;
    /** 이게 무엇인가. 제목 위에 작게 붙는다 — 은하 · 기억 · 갈래 · 경험 · 축 */
    kind: string;
    text: string;
    rows: { k: string; v: string }[];
    skills?: { name: string; firstTime: boolean }[];
  } | null>(null);
  const [focus, setFocus] = useState<OrbitBody | null>(null);
  const [picked, setPicked] = useState<Body | null>(null);

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

  // 최근 표식도 ref 로 읽는다. 그리기 이펙트의 의존성이 [bodies, threads]
  // 뿐이라, 값으로 쓰면 클로저가 첫 렌더의 값을 잡은 채로 남는다 —
  // 포커스에 들어가 위성 층으로 넘어가도 표식이 안 켜졌다.
  // picked·focus 가 이미 같은 이유로 ref 를 쓴다.
  //
  // id → 순위(0 이 가장 최근). 그리기 쪽은 프레임마다 천체 수십 개를 훑으므로
  // indexOf 로 매번 배열을 뒤지지 않게 Map 으로 한 번만 만든다.
  const latestRankRef = useRef<Map<string, number>>(new Map());
  latestRankRef.current = useMemo(
    () => new Map((latestIds ?? []).map((id, i) => [id, i])),
    [latestIds],
  );

  // 렌더 루프가 읽는 최신 포커스. 상태를 클로저에 가두지 않기 위해 ref 로 둔다.
  const focusRef = useRef<OrbitBody | null>(null);
  focusRef.current = focus;

  // 확대했을 때 화면을 가장 많이 차지한 별. 그리기 루프가 매 프레임 계산해
  // ref 에 넣고, 값이 **바뀔 때만** state 로 올린다 — 매 프레임 setState 하면
  // 60Hz 로 리렌더가 돌아 계가 통째로 느려진다(probe 가 쓰는 방식과 같다).
  const dominantIdRef = useRef<string | null>(null);
  const [dominantId, setDominantId] = useState<string | null>(null);
  /** state 에 실제로 들어 있는 값의 거울.
   *
   *  그리기 이펙트 안의 지역 변수로 "이미 올려보낸 값"을 기억하면, 이펙트가
   *  다시 만들어질 때(데이터가 갱신되거나 Fast Refresh) 그 기억만 null 로
   *  돌아가고 state 는 남는다. 그러면 지울 값과 기억이 둘 다 null 이라
   *  '안 바뀌었다'로 읽혀 **판독값이 영영 안 사라진다** — 계 전체로 물러났는데
   *  마지막으로 본 별의 이름이 위에 그대로 붙어 있었다.
   *  ref 는 이펙트와 수명이 다르므로 state 와 절대 어긋나지 않는다. */
  const dominantStateRef = useRef<string | null>(null);
  dominantStateRef.current = dominantId;
  /** 계 전체로 물러나기. 그리기 이펙트 안의 배율·이동 상태를 밖에서 건드릴
   *  유일한 통로다 — 완결 버튼처럼 DOM 쪽에서 화면을 되돌려야 할 때 쓴다. */
  const resetViewRef = useRef<(() => void) | null>(null);

  // 지도 바깥(계기판)이 물러나야 하는 상태.
  //
  // 펼쳤을 때만이 아니라 **한 별 안으로 당겨 들어왔을 때도** 물러난다. 그
  // 순간 화면은 그 별 하나에 대한 것이 되는데, 아래에 '최근 경험' 목록과
  // 캐릭터의 대사가 그대로 남아 있으면 읽을 것이 셋이 되고 그중 둘은 지금
  // 보고 있는 것과 문맥이 어긋난다(오늘 전체에 대한 말이다).
  useEffect(() => {
    onFocusChange?.(focus ?? dominantBody(dominantId, threads));
  }, [focus, dominantId, threads, onFocusChange]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const byId = new Map(bodies.map((b) => [b.id, b]));
    /** 별의 색 — 분야가 색상을, trigger 가 색온도를 준다.
     *  기억이 없으면 색온도가 없어 분야 색 그대로다. */
    const colorOf = (o: OrbitBody) => tempered(colorOfCategory(o.category), o.memory?.trigger ?? null);

    /** 관측 범위 안에서의 몫. lo 에서 0, hi 에서 1. 폭이 0 이면(전부 같은 값)
     *  없는 차이를 만들지 않도록 가운데로 준다. 화면 안에서 재는 것이라
     *  저장된 값(importance·experience_count)은 안 건드린다 — /memories 목록은
     *  절대값을 그대로 쓴다. */
    const spanOf = (vals: number[]) => {
      const lo = Math.min(...vals);
      const hi = Math.max(...vals);
      return (v: number) => (hi > lo ? (v - lo) / (hi - lo) : 0.5);
    };

    // ── 광도 ──
    //
    // 남긴 것들끼리의 순위다. 아직 안 남긴 것은 그 순위 밖의 어두운 별이라
    // 정규화에 안 넣는다 — 넣으면 "안 남김"이 최솟값 자리를 차지해서
    // 실제로 남은 것 중 가장 약한 것과 구분이 안 된다.
    const kept = threads.map((t) => t.memory?.importance).filter((n): n is number => n != null);
    const impRatio = spanOf(kept.length > 0 ? kept : [0]);
    // 이 화면이 기억을 아예 안 읽으면 "어둡다"가 "안 남았다"가 아니라
    // "모른다"는 뜻이 된다. 그때는 층을 나누지 않고 전부 제 밝기로 띄운다 —
    // 안 그러면 화면 전체가 LUM_DARK 로 깔려 아무것도 안 보인다.
    const anyKept = kept.length > 0;
    const lumOf = (t: ThreadBody) =>
      !anyKept
        ? 1
        : t.memory
          ? LUM_KEPT_MIN + (1 - LUM_KEPT_MIN) * impRatio(t.memory.importance)
          : LUM_DARK;

    // ── 질량 ──
    // 로그를 먼저 씌우고 그 위에서 범위를 잰다. 순서가 바뀌면 정규화가
    // 선형 공간에서 일어나 로그로 누른 뜻이 사라진다.
    const massRatio = spanOf(threads.map((t) => Math.log1p(t.experienceCount)));
    const sizeOfMass = (n: number) =>
      SIZE_MIN + (SIZE_MAX - SIZE_MIN) * massRatio(Math.log1p(n));

    // ══════════════════════════════════════════════════════
    // 은하 — 분야 하나가 은하 하나 (2·3·5단계)
    // ══════════════════════════════════════════════════════
    //
    // 예전에는 분야가 **방향**이었다. 중심에서 뻗은 40도 조각 하나가 분야
    // 하나였고, 별은 그 안에서 자리를 다퉜다. 그게 격자를 만들었다 —
    // 각도 자리 다섯 개(STAR_SLOTS)를 반경 순으로 번갈아 쓰니 별이 많아지면
    // 행과 열이 눈에 보였다.
    //
    // 조각 안에서는 나선을 감을 수가 없다. 로그 나선의 힘은 **각도를 많이
    // 쓴다**는 데 있는데(원리 3) 40도로는 감을 각도가 없다. 그래서 분야를
    // 방향이 아니라 **자리**로 옮긴다 — 은하다. 은하 하나를 얻으면 그 안에서
    // 온 원을 다 쓸 수 있고, 나선이 나선이 된다.
    //
    // 방향 문법은 여기서 완전히 사라진다. 조각도 축도 없다.

    /** 화면에 실제로 올라온 은하. 갈래가 하나도 없는 분야는 은하가 없다 —
     *  빈 자리를 그리면 "여기 뭔가 있었나"가 되고, 색 범례도 그렇게 정리했다. */
    type Galaxy = {
      key: string;
      label: string;
      /** 궤도 단위 좌표. GALAXY_SITES 에서 그대로 온다 — 데이터에 안 흔들린다. */
      x: number;
      y: number;
      color: [number, number, number];
      members: ThreadBody[];
    };

    const galaxies: Galaxy[] = [];
    {
      const byGalaxy = new Map<number, ThreadBody[]>();
      for (const t of threads) {
        const i = galaxyIndexOf(t);
        const list = byGalaxy.get(i) ?? [];
        list.push(t);
        byGalaxy.set(i, list);
      }
      for (const [i, members] of [...byGalaxy].sort((a, b) => a[0] - b[0])) {
        const cat = EXPERIENCE_CATEGORIES[i] ?? "etc";
        const site = GALAXY_SITES[i] ?? GALAXY_SITES[GALAXY_SITES.length - 1];
        galaxies.push({
          // 이름은 카테고리 그대로. **색만 묶음에서 가져온다** — 같은 결끼리
          // 같은 색이 되고(자홍 넷 = life), 무슨 일인지는 이름이 말한다.
          key: cat,
          label: cat,
          x: site[0],
          y: site[1],
          color: colorOfCategory(cat),
          members,
        });
      }
    }
    const galaxyByKey = new Map(galaxies.map((g) => [g.key, g]));

    // ── 은하 안에 갈래 놓기 ──
    //
    // 원반(진행 중)과 halo(완결·방치)로 갈린다. **같은 은하 안에서 두 층이다.**
    //
    //   원반  나선팔 위. 안쪽이 최근, 팔을 따라 나갈수록 오래됐다.
    //   halo  팔을 떠나 구형으로 흩어진다. 완결이 안쪽, 방치가 바깥.
    //
    // 이게 예전 '별자리 선'이 하던 말을 대신한다(계획서: 나선팔과 halo 이주가
    // 대신한다). 선이 끊겼나로 말하던 것을 이제 **어느 층에 있느냐**로 말한다 —
    // 선은 중심이 하나일 때만 성립하는 문법이라 은하가 여덟이면 못 쓴다.
    //
    // 나이는 **그 은하 안에서의 몫**으로 잰다. 절대 경과일을 쓰면 오래된 분야는
    // 전부 바깥에 몰리고 새 분야는 전부 중심에 몰려, 은하마다 안이 텅 비거나
    // 가장자리만 찬다. 은하는 저마다 제 시간을 갖는다.
    /**
     * 은하마다 제 기울기. **없으면 여덟 은하가 똑같은 자세로 서 있다** —
     * 같은 그림을 복사해 붙인 것처럼 보이고, 그게 "자연스럽지 않다"의 절반이다.
     * 키에서 뽑으므로 렌더마다 안 바뀐다.
     */
    const spinOf = (key: string) => phaseOf(`${key}spin`) * Math.PI * 2;

    /**
     * 나선팔 위의 한 점. 진행도 at(0=팽대부, 1=팔 끝) → 극좌표.
     *
     * **배치와 그리기가 이 함수 하나를 같이 쓴다.** 갈리면 별이 팔에서 벗어난다 —
     * 그러면 팔은 아무 데도 안 지나는 선이 되고, 별은 왜 거기 있는지 모를 점이 된다.
     */
    const armAt = (key: string, arm: number, at: number) => ({
      th: at * ARM_SPAN + (arm * Math.PI * 2) / ARMS + spinOf(key),
      r: BULGE * Math.exp(ARM_PITCH * (at * ARM_SPAN)),
    });

    const starXY = new Map<string, { x: number; y: number }>();
    for (const g of galaxies) {
      // **원반과 halo 가 각자 제 자를 쓴다.** 은하 전체로 한 번에 재면 안 된다 —
      // 진행 중인 것은 대개 최근이라 나이 순위의 아래쪽에 몰리고, 그러면 원반의
      // 별이 전부 팽대부 언저리에 뭉쳐 나선이 감기다 만다(실측: DEV 은하 37개
      // 중 진행 중이 12개였는데 전부 안쪽 1/3 에 들어갔다).
      // 층마다 제 안에서 순위를 매기면 어느 층이든 있는 폭을 다 쓴다 —
      // 광도·질량을 관측 범위로 정규화한 것과 같은 규칙이다.
      const disc = g.members.filter((t) => t.status === "active");
      const halo = g.members.filter((t) => t.status !== "active");
      const discAge = spanOf(disc.length > 0 ? disc.map((t) => Math.sqrt(t.ageDays)) : [0]);
      const haloAge = spanOf(halo.length > 0 ? halo.map((t) => Math.sqrt(t.ageDays)) : [0]);
      for (const t of g.members) {
        const inDisc = t.status === "active";
        const at = (inDisc ? discAge : haloAge)(Math.sqrt(t.ageDays));

        let r: number;
        let th: number;
        if (inDisc) {
          // 로그 나선 r = r0·e^(bθ). θ 를 나이에 매달면 반경이 저절로 따라온다.
          const arm = Math.floor(phaseOf(`${t.id}arm`) * ARMS) % ARMS;
          const p = armAt(g.key, arm, at);
          // 팔은 선이 아니라 띠다. 안 흩으면 자로 그은 곡선이 되어 1단계의
          // 격자와 같은 문제가 된다 — 규칙적이면 계기판이 아니라 도표다.
          th = p.th + (phaseOf(`${t.id}w`) - 0.5) * ARM_WIDTH;
          // 반경 쪽도 조금 흩는다. 팔의 두께는 각도만으로는 안 나온다 —
          // 바깥으로 갈수록 같은 각도가 더 넓어져 안쪽만 얇아 보인다.
          r = p.r * (1 + (phaseOf(`${t.id}rr`) - 0.5) * 0.16);
        } else {
          // halo — 팔을 떠났다. 각도는 뜻이 없다(궤도를 벗어난 것이니까).
          // 반경만 말한다: 끝낸 것은 가까이 멈추고, 놓은 것은 흘러나간다.
          const band = t.status === "completed" ? HALO_DONE : HALO_LEFT;
          th = phaseOf(`${t.id}h`) * Math.PI * 2;
          r = band[0] + (band[1] - band[0]) * at;
        }
        starXY.set(t.id, {
          x: g.x + Math.cos(th) * r * GALAXY_R,
          // 원반을 위에서 기울여 본다. 위성 층과 같은 투영이라 두 층이 한
          // 공간에 있는 것으로 읽힌다 — 정면으로 보면 그냥 점 무리다.
          y: g.y + Math.sin(th) * r * GALAXY_R * FLATTEN,
        });
      }
    }

    const els: Elem[] = threads.map((t) => {
      const at = starXY.get(t.id) ?? { x: 0, y: 0 };
      return {
        id: t.id,
        x: at.x,
        y: at.y,
        lum: lumOf(t),
        color: colorOf(t),
        size: sizeOfMass(t.experienceCount),
        mem: t,
      };
    });

    /** 우주의 크기(궤도 단위). 은하 자리 표에서 나오므로 **데이터에 안 흔들린다** —
     *  갈래가 백 개 늘어도 우주는 그대로고, 은하 안이 빽빽해질 뿐이다. */
    const maxR = galaxies.reduce(
      (mx, g) => Math.max(mx, Math.hypot(g.x, g.y) + GALAXY_R * GALAXY_EDGE),
      0.5,
    );

    /**
     * 우주의 **바깥 상자**. 축마다 따로 잰다 — 끌기 한계가 여기서 나온다.
     *
     * 반경(maxR) 하나로 두면 안 된다. 예전 한계는 `maxR × FLATTEN` 을 세로에
     * 썼는데, 그건 계가 원점 둘레의 **납작한 원반** 하나였을 때 값이다.
     * 지금 은하 자리(GALAXY_SITES)의 y 는 안 눌린 생값이라 — 눌리는 건 은하
     * *안*의 원반뿐이다 — 세로로 실제보다 좁게 잡혔다.
     *
     * 그래서 y 가 큰 은하는 화면 가운데로 데려올 수가 없었다. 실측: ETC 가
     * y=-1.34 인데 한계는 1.05 뿐이라 zr 9 부터 벽에 걸렸고, applyCamera 가
     * 앵커를 다시 잡으면서 화면이 위로 튕겼다. 드래그로도 안 올라갔다.
     * (COMMUNITY 는 -0.94 라 한계 안이었다 — 그래서 ETC 쪽만 그랬다.)
     *
     * 은하 **안**의 세로 폭에만 FLATTEN 을 먹인다. starXY 가 거기서만 눌렀다.
     */
    const worldMaxX =
      galaxies.reduce((mx, g) => Math.max(mx, Math.abs(g.x)), 0) + GALAXY_R * GALAXY_EDGE;
    const worldMaxY =
      galaxies.reduce((mx, g) => Math.max(mx, Math.abs(g.y)), 0) +
      GALAXY_R * GALAXY_EDGE * FLATTEN;

    /** 코스믹 웹의 실. 은하마다 가장 가까운 이웃 하나씩 이어 마디를 만든다 —
     *  전부 이으면 그물이 아니라 덩어리가 되고, 안 이으면 흩뿌린 점이 된다.
     *  중복(A→B 와 B→A)은 한 번만 그린다. */
    const filaments: [Galaxy, Galaxy][] = [];
    for (let i = 0; i < galaxies.length; i++) {
      let best = -1;
      let bestD = Infinity;
      for (let j = 0; j < galaxies.length; j++) {
        if (i === j) continue;
        const d = Math.hypot(galaxies[i].x - galaxies[j].x, galaxies[i].y - galaxies[j].y);
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      }
      if (best > i) filaments.push([galaxies[i], galaxies[best]]);
      else if (best >= 0 && best < i) {
        const dup = filaments.some(
          ([a, b]) =>
            (a === galaxies[i] && b === galaxies[best]) ||
            (b === galaxies[i] && a === galaxies[best]),
        );
        if (!dup) filaments.push([galaxies[best], galaxies[i]]);
      }
    }

    /** 방향 축의 이름. 그 방향이 무슨 뜻인지를 화면에 적어주는 값이다.
     *  **어휘가 하나다** — 분야. 색 범례와 같은 단어라 서로를 설명한다. */
    const axisKeyOf = (o: OrbitBody) => groupOfCategory(o.category).key;
    /** 포커스 원의 크기 근거. 별과 같은 기준(질량)이어야 넘겨주는 지점이 안 튄다. */
    const weightOf = (o: OrbitBody) => Math.log1p(o.experienceCount) * 4.2;

    /** 계에 올라온 것 전부. id 로 찾는다. */
    const orbitById = new Map<string, OrbitBody>();
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
    /** 계 전체가 화면에 들어오는 배율. 첫 진입과 "물러나기"의 기준점이다. */
    let fitZoom = 1;
    let fitted = false;
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
    // 카메라의 자리는 **앵커**로 잡는다 — "이 세계점이 이 화면점에 있다".
    // 화면 이동량(offX·offY)은 여기서 유도되는 값이지 상태가 아니다.
    // 왜 그래야 하는지는 아래 applyCamera 주석에.
    let anchorWX = 0; // 붙들어 둔 세계점
    let anchorWY = 0;
    let anchorSX = 0; // 그것이 있어야 할 화면점
    let anchorSY = 0;
    let anchorWXT = 0; // 목표(클릭으로 데려갈 때만 현재와 갈린다)
    let anchorWYT = 0;
    let anchorSXT = 0;
    let anchorSYT = 0;
    let offX = 0; // ← applyCamera 가 매 프레임 다시 푼다. 읽기 전용으로 쓴다.
    let offY = 0;
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
    // 착지 섬광. 느린 숨결만으로는 "지금 막 봤을 때" 눈에 안 들어온다 —
    // 주기가 몇 초라 첫 순간에는 아무 일도 안 일어나는 것처럼 보인다.
    // 화면에 들어온 순간과 펼친 순간에 크게 터뜨렸다가 잦아들게 한다.
    // 상시 표식이 아니라 도착 연출이라, 다른 채널과 안 겹친다.
    let flareAt = 0;
    let flare = 0;
    let lastFocused = false;

    // ── 축 전환 ──
    //
    // 계 전체의 축과 별 하나의 결과 축을 오간다. 예전에는 "지금 별 안인가"라는
    // **문턱**에 두 벌의 알파를 그대로 물려놨는데, 그게 켜지는 순간 한쪽은
    // 1 에서 0.5 로 다른 쪽은 0 에서 0.5 로 동시에 뛰어서 깜빡였다.
    // 문턱은 목표만 정하고, 실제 세기는 이 값이 시간을 두고 따라간다.
    let axisMix = 0;
    /** 직전 프레임에 어느 별 안이었나. 문턱을 벌리는 데 쓴다(히스테리시스). */
    let inStarId: string | null = null;
    /** 지금 당겨 들어가는 중인 대상.
     *
     *  inStarId 는 **도착한 뒤에야** 켜진다(화면을 얼마나 덮었는지로 재니까).
     *  그동안 계가 계속 돌면 대상이 제자리에 없다 — 배율 6 에서는 몇 도만
     *  돌아도 화면 밖이라, 다 당기고 나면 아무것도 없는 검은 화면이 남는다.
     *  누르는 순간부터 여기에 걸어 계를 멈춘다. */
    let lockedId: string | null = null;
    /** 지금 그리고 있는 축이 어느 별의 것인가. */
    let axisStarId: string | null = null;
    let axisAngles: Map<string, { sum: number; n: number }> | null = null;
    const hit = new Map<string, { x: number; y: number; r: number; kind: string }>();

    function resize() {
      // 창이 바뀌어도 **붙들어 둔 세계점은 그대로 둔다.**
      //
      // 예전에는 이동량을 0 으로 되돌렸다("근거가 무의미해진다"). 층이 하나일
      // 때는 그래도 됐는데 — 되돌려봐야 그 계의 중심이었으니까 — 지금은
      // 수천 배까지 들어갈 수 있어서, 은하 깊숙이 있다가 창이 조금만 바뀌면
      // 그 배율 그대로 우주 원점으로 내던져진다. 아무것도 없는 검은 화면이고
      // 어디로 돌아가야 할지도 모른다.
      //
      // 앵커로 두니 할 일이 거의 없다. 세계점(anchorW)은 창과 무관하므로
      // 그대로 두고, 화면점(anchorS)만 새 화면의 같은 **비율** 자리로 옮긴다.
      const rel =
        fitted && w > 0 && h > 0
          ? { x: anchorSX / w, y: anchorSY / h, tx: anchorSXT / w, ty: anchorSYT / h }
          : null;

      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = wrap!.clientWidth;
      h = wrap!.clientHeight;
      canvas!.width = Math.round(w * dpr);
      canvas!.height = Math.round(h * dpr);
      canvas!.style.width = `${w}px`;
      canvas!.style.height = `${h}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      // ── 축척 ──
      //
      // **역산이 사라졌다.** 예전에는 가장 빽빽한 한 쌍을 찾아 그 둘이 안
      // 겹칠 만큼 축척을 키웠는데(unitNeed · PACK_MARGIN · PACK_MAX), 그건
      // 겹침을 사후에 미는 일이었다. 배치가 원리 2(힐 구면)를 지키면 애초에
      // 안 겹치므로 그 계산이 통째로 필요 없다. 그리고 그 역산에는 병이
      // 있었다 — 우연히 거의 포개진 쌍이 하나만 있어도 축척이 수만 px/단위로
      // 튀어서, 다 물러나도 화면에 권도형만 남았다.
      //
      // 이제 궤도 단위는 그냥 화면 짧은 변에 매단다. 여기서 나온 baseUnit 은
      // 아래 fitZoom 이 다시 나눠 쓰므로 절대값 자체는 뜻이 없다 —
      // 화면 크기에 따라 계가 통째로 커지고 작아지기만 하면 된다.
      baseUnit = Math.min(w, h);

      // ── 기본 배율은 "우주 전체" 다 ──
      //
      // 배율 1 의 뜻: "px 그대로"가 아니라 **우주가 화면에 들어오는 배율**.
      // 확대·축소는 그 위에 얹히고, 층이 배어 나오는 문턱도 전부 이 값에
      // 대한 비율(zr)로 잰다 — 그래야 창 크기나 데이터가 문턱을 안 흔든다.
      fitZoom = (Math.min(w, h) * 0.44) / Math.max(1e-6, maxR * baseUnit);
      if (!fitted) {
        fitted = true;
        zoom = zoomTarget = fitZoom;
      }
      if (rel) {
        anchorSX = rel.x * w;
        anchorSY = rel.y * h;
        anchorSXT = rel.tx * w;
        anchorSYT = rel.ty * h;
      } else {
        // 첫 진입. 우주 원점이 화면 가운데다.
        anchorWX = anchorWY = anchorWXT = anchorWYT = 0;
        anchorSX = anchorSXT = w / 2;
        anchorSY = anchorSYT = h / 2;
      }
      applyCamera();
    }

    /** 이동량 한계. 우주가 화면에서 통째로 사라지지 않는 선까지만 —
     *  그 너머는 아무것도 없는 검은 화면이라 갈 이유가 없다.
     *
     *  **축마다 제 폭으로 잰다**(worldMaxX·worldMaxY). 반경 하나에 FLATTEN 을
     *  먹여 쓰던 예전 식은 세로를 실제보다 좁게 잡아서, 위쪽 은하를 가운데로
     *  데려올 수가 없었다 — 근거는 worldMaxY 주석에. */
    function offLimit(z: number) {
      const u = baseUnit * z;
      return {
        x: worldMaxX * u + w / 2,
        y: worldMaxY * u + h / 2,
      };
    }

    // ══════════════════════════════════════════════════════
    // 카메라 — **앵커 하나로 정의한다**
    // ══════════════════════════════════════════════════════
    //
    // 카메라 = 배율(zoom) + 앵커. 앵커는 약속이다:
    // **"세계점 (anchorW) 는 화면점 (anchorS) 에 있다."**
    // 화면 이동량은 상태가 아니라 그 약속에서 매 프레임 유도된다.
    //
    // ── 왜 이렇게 바꿨나 ──
    //
    // 예전에는 상태가 `zoom` 과 `offX` 두 벌이었고 각자 제 목표로 이징했다.
    // 그런데 화면 자리는
    //
    //     화면x = w/2 + offX + 세계x · baseUnit · zoom
    //
    // 처럼 둘이 **곱해져서** 나온다. offX 와 zoom 을 따로 선형 보간하면 중간
    // 프레임은 어느 앵커도 만족하지 않는다 — 도착점에서만 맞고 가는 내내
    // 대상이 미끄러지다 마지막에 제자리를 찾는다. 그게 손에 느껴지던
    // "확대가 지멋대로다"의 진짜 원인이었다. (그 전에 고친 '드래그가 목표를
    // 덮어쓴다'는 별개의 두 번째 버그였고, 그것만으로는 안 나았다.)
    //
    // 앵커로 두면 이 문제가 원천적으로 사라진다. 휠은 앵커를 커서에 **한 번
    // 못박고** 배율만 이징시킨다. 배율이 어떤 중간값이든 offX 는 그 배율에서
    // 앵커를 만족하도록 다시 풀리므로, 커서 밑의 점은 애니메이션 내내 한 픽셀도
    // 안 움직인다.
    //
    // ── 손짓별로 무엇을 만지나 ──
    //
    //   휠     앵커를 커서에 못박는다(현재=목표, 이징 없음). 배율만 이징.
    //   드래그 앵커의 **화면점**을 민다. 배율 목표는 안 건드린다.
    //   클릭   앵커 **목표**를 (대상, 화면 가운데)로. 앵커도 같이 이징해 미끄러져 온다.

    /** 지금 카메라에서 화면점 → 세계점. */
    const worldAt = (sx: number, sy: number) => ({
      x: (sx - cx) / unit,
      y: (sy - cy) / unit,
    });

    /**
     * 앵커의 화면점을 민다 — 그게 곧 이동이다.
     * 현재와 목표를 **같이** 밀어서 진행 중인 확대의 앵커를 안 깬다.
     */
    function panBy(dx: number, dy: number) {
      anchorSX += dx;
      anchorSY += dy;
      anchorSXT += dx;
      anchorSYT += dy;
    }

    /**
     * 화면점 (sx, sy) 아래의 세계점을 **그 자리에 못박고** 배율만 z 로 간다.
     * 휠이 쓰는 유일한 통로다.
     *
     * 앵커를 지금 카메라에서 뽑으므로 이 순간 화면은 한 칸도 안 움직인다.
     * 그리고 목표까지 같은 값으로 두므로 이징하는 동안에도 앵커가 안 흔들린다 —
     * 배율만 변하고 자리는 그 배율에서 다시 풀린다.
     */
    function zoomAt(z: number, sx: number, sy: number) {
      const wpt = worldAt(sx, sy);
      anchorWX = anchorWXT = wpt.x;
      anchorWY = anchorWYT = wpt.y;
      anchorSX = anchorSXT = sx;
      anchorSY = anchorSYT = sy;
      zoomTarget = z;
    }

    /**
     * 세계점 (wx, wy) 를 화면 가운데로 데려오며 배율 z 로 간다. 클릭이 쓴다.
     *
     * **대상을 지금 그 자리에 못박고, 그 화면점만 가운데로 미끄러뜨린다.**
     *
     * 예전에는 세계점(anchorW)을 이징했다. 그런데 배율은 로그로 가고 세계점은
     * 선형으로 가니 — 배율이 훨씬 빨리 자란다 — 중간 프레임에서는 아직 원점
     * 근처에 있는 채로 깊이 들어가 버렸다. 그래서 "권도형과 그 분야를 잇는
     * 선 가운데로 확 확대됐다가, 그다음 그 분야로 이동"처럼 **두 동작으로
     * 쪼개져** 보였다. 물러날 때도 같은 이유로 그랬다.
     *
     * 대상을 처음부터 앵커로 잡으면 그 일이 원천적으로 없다. 대상은 한 순간도
     * 화면에서 벗어나지 않고, 그 자리가 가운데로 미끄러지는 동안 배율만 자란다 —
     * 확대와 이동이 **한 동작**이 된다. 화면점 이징이라 눈에 보이는 속도도
     * 고르다(세계점 이징은 배율에 따라 화면 속도가 수천 배로 널뛴다).
     *
     * 시작할 때 화면은 한 칸도 안 움직인다: anchorS 를 지금 자리로 잡으므로
     * cx = anchorSX - wx·unit = (cx + wx·unit) - wx·unit = cx.
     */
    function zoomToPoint(wx: number, wy: number, z: number) {
      // 새 손짓이 앞선 손짓의 여운을 끈다.
      flingX = 0;
      flingY = 0;
      anchorWX = anchorWXT = wx;
      anchorWY = anchorWYT = wy;
      anchorSX = cx + wx * unit; // 지금 화면에서 대상이 있는 자리
      anchorSY = cy + wy * unit;
      anchorSXT = w / 2;
      anchorSYT = h / 2;
      zoomTarget = z;
    }

    /** 우주 전체로 물러난다. 원점(권도형)을 화면 가운데로 —
     *  들어갈 때와 **같은 규칙**이라 나오는 길도 한 동작이다. */
    function resetCamera() {
      zoomToPoint(0, 0, fitZoom);
    }

    /**
     * 앵커와 배율로부터 cx·cy·unit 을 푼다. 매 프레임 그리기 전에 부른다.
     *
     *   화면x = cx + 세계x · unit,  앵커 약속은 anchorSX = cx + anchorWX · unit
     *   → cx = anchorSX - anchorWX · unit
     *
     * 배율이 어떤 중간값이든 이 식이 앵커를 지킨다. 그래서 이징 중에도 붙들어
     * 둔 점이 안 미끄러진다 — 이게 이 카메라의 전부다.
     */
    function applyCamera() {
      unit = baseUnit * zoom;
      cx = anchorSX - anchorWX * unit;
      cy = anchorSY - anchorWY * unit;

      // 한계. 우주가 화면에서 통째로 사라지지 않는 선까지만 — 그 너머는
      // 아무것도 없는 검은 화면이라 갈 이유가 없다.
      //
      // 벽에 걸리면 **앵커를 그 자리로 다시 잡는다.** 좌표만 자르면 다음
      // 프레임에 같은 앵커가 또 벽 밖을 가리켜서, 벽에 붙은 채로 부르르 떤다.
      // 앵커를 옮기면 "여기까지"가 그대로 새 약속이 된다.
      const lim = offLimit(zoom);
      const rawX = cx - w / 2;
      const rawY = cy - h / 2;
      const ox = Math.max(-lim.x, Math.min(lim.x, rawX));
      const oy = Math.max(-lim.y, Math.min(lim.y, rawY));
      if (ox !== rawX) {
        cx = w / 2 + ox;
        anchorSX = anchorSXT = cx + anchorWX * unit;
      }
      if (oy !== rawY) {
        cy = h / 2 + oy;
        anchorSY = anchorSYT = cy + anchorWY * unit;
      }
      offX = ox;
      offY = oy;
    }

    /** 궤도 단위 좌표 → 화면 좌표. 카메라(cx·cy·unit) 하나만 걸린다. */
    const worldX = (x: number) => cx + x * unit;
    const worldY = (y: number) => cy + y * unit;

    /**
     * 항성계의 반경(궤도 단위) — **원리 2 그대로**(4단계).
     *
     *   은하 안 별끼리의 간격 = 원반 반경 / √(별 수)   (넓이를 고르게 나눈 값)
     *   항성계 반경          = 그 간격 / LAYER_RATIO
     *
     * 예전에는 `min(w,h) × satFieldF(n) × zr` 이었다 — 위성 수에 따라 손으로
     * 맞춘 곡선에 화면 크기를 곱한 값이라, 층 사이의 관계가 아니라 그냥 숫자
     * 였다. 이제는 은하가 커지면 항성계도 같이 커지고, 별이 빽빽해지면 같이
     * 줄어든다. 문턱(SAT_REVEAL)도 같은 비율에서 나오므로 서로 안 어긋난다.
     *
     * 별 수는 계 전체에서 가장 붐비는 은하를 기준으로 잡는다 — 은하마다
     * 다른 크기로 그리면 "이 별이 크다"가 은하마다 다른 뜻이 된다.
     */
    const densest = galaxies.reduce((mx, g) => Math.max(mx, g.members.length), 1);
    const starGap = (GALAXY_R * GALAXY_EDGE) / Math.sqrt(Math.max(4, densest));
    const satFieldR = starGap / LAYER_RATIO;

    // ── 층 배율 ──
    //
    // 반경 s 인 것이 화면을 채우는 배율. fitZoom 이 "우주(maxR)가 화면의
    // FILL 만큼을 덮는 배율"로 정의되므로, 같은 몫을 s 가 덮으려면
    // zr = FILL·maxR/s 다. 크기에서 바로 나오니 손으로 맞출 값이 없다.
    const fillZoom = (s: number) => (FILL * maxR) / Math.max(1e-9, s);
    /** 은하 하나가 화면을 채우는 배율 — 여기서 별이 다 드러난다 */
    const galaxyLayer = fillZoom(GALAXY_R * GALAXY_EDGE);
    /** 항성계 하나가 화면을 채우는 배율 — 여기서 경험이 다 드러난다 */
    const starLayer = fillZoom(satFieldR);

    /** 별의 화면 좌표. **시간을 안 받는다** — 별은 안 돈다.
     *  기울임(FLATTEN)은 은하 원반을 놓을 때 이미 y 에 먹여뒀다(starXY). */
    function orbitPoint(el: Elem) {
      return { x: worldX(el.x), y: worldY(el.y), theta: 0 };
    }

    // ── 위성(경험) 배치 ──
    //
    // 두 곳이 같은 배치를 쓴다.
    //   계 화면   — 별마다, 그 자리에서 작은 반경으로.
    //   펼친 뒤   — 고른 천체 하나만, 화면 가운데에서 큰 반경으로.
    // 예전에는 펼친 쪽에만 있었다(경험은 눌러야 나오는 층이었다). 이제 계
    // 화면에도 늘 떠 있으므로 식이 하나여야 한다 — 둘로 두면 펼치는 순간
    // 위성이 다른 자리로 튄다.
    //
    // R 과 원점(ox·oy)만 다르고 나머지는 전부 같다.

    /** 이 천체가 펼칠 경험들. 220건 상한 밖은 여기서 걸러진다. */
    function refsOf(o: OrbitBody): Body[] {
      return o.referencedIds.map((id) => byId.get(id)).filter(Boolean) as Body[];
    }

    /** 결과(outcome) 축의 각도. 갈래 한가운데라는 임의의 자리가 아니라, 그
     *  결과에 속한 위성들이 실제로 쓰는 평면 각도의 평균에 긋는다.
     *  (한 갈래의 폭이 25도 남짓이라 감싸돌 일이 없어 산술평균으로 충분하다.)
     *  계 화면(확대해서 별 안에 들어왔을 때)과 펼친 뒤가 같은 축을 써야
     *  전환하면서 축이 안 튄다. */
    function outcomeAngles(refs: Body[]) {
      const acc = new Map<string, { sum: number; n: number }>();
      for (const b of refs) {
        const oc = b.outcome ?? "explore";
        const oi = OUTCOME_ORDER.indexOf(oc);
        const base = (oi < 0 ? OUTCOME_ORDER.length - 1 : oi) * SAT_SECTOR;
        const ang = base + phaseOf(b.category) * SAT_SECTOR * SAT_FILL;
        const a = acc.get(oc) ?? { sum: 0, n: 0 };
        a.sum += ang;
        a.n += 1;
        acc.set(oc, a);
      }
      return acc;
    }

    function layoutSats(
      refs: Body[],
      sourceIds: string[],
      R: number,
      ox: number,
      oy: number,
      ts: number,
    ) {
      // 점수를 고정값(140)으로 나누면 실제 데이터가 0~70 일 때 표현 범위의
      // 절반만 쓰게 되어 차이가 뭉갠다. **그 계 안의** 최댓값으로 정규화해서
      // 있는 폭을 다 쓴다 — 별마다 따로 잰다. 전체 최댓값으로 재면 작은 별의
      // 위성이 전부 어둡게 뭉쳐 "이 일에서 뭐가 셌나"를 못 읽는다.
      const topScore = Math.max(1, ...refs.map((b) => b.memoryScore));

      return refs.map((b, i) => {
        // 기억 점수가 곧 그 경험의 광도다. 이 기억을 만든 힘이 셌던 경험이
        // 더 밝게 남는다 — 근거 여섯 개가 똑같은 밝기로 떠 있으면
        // "무엇 때문에 이 기억이 생겼는지"를 화면이 답하지 못한다.
        const ratio = Math.max(0, Math.min(1, b.memoryScore / topScore));
        const lum = 0.26 + ratio * 0.74;
        // 크기 폭을 넓혔다. 후광 세기만으로 구분되면 "밝다"는 인상만 남고
        // 어느 쪽이 더 큰지는 못 읽는다.
        // R 에 비례시킨다 — 계 화면의 작은 위성계에서 펼친 뒤와 같은 픽셀
        // 크기로 그리면 위성이 제 궤도보다 커져 덩어리가 된다.
        const size = (3.8 + ratio * 6.8) * satScaleOf(R);

        // 점수가 높을수록 안쪽에 놓인다. 핵심 근거가 기억에 가깝다.
        const ra = (0.92 - ratio * 0.42 + ((i % 3) - 1) * 0.06) * R;

        // 갈래는 outcome, 갈래 안의 자리는 category.
        // 같은 결과를 낸 경험들이 한 방향에 모이고, 그 안에서 카테고리별로 갈린다.
        const oi = OUTCOME_ORDER.indexOf(b.outcome ?? "");
        const base = (oi < 0 ? OUTCOME_ORDER.length - 1 : oi) * SAT_SECTOR;
        const plane =
          base + phaseOf(b.category) * SAT_SECTOR * SAT_FILL + (phaseOf(b.id) - 0.5) * 0.06;
        const omega = phaseOf(b.id) * Math.PI * 2;
        // 찌그러짐은 outcome. 막힌 경험일수록 기억과의 거리가 들쭉날쭉하다.
        const ecc = ECC[b.outcome ?? ""] ?? 0.3;

        const speed = 0.16 / Math.pow(ra / R, 1.5);
        const th = phaseOf(b.id) * Math.PI * 2 + ts * speed;
        const st = {
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
          isSource: sourceIds.includes(b.id),
          th,
          x: 0,
          y: 0,
        };
        const p = satPointAt(st, th, ox, oy);
        st.x = p.x;
        st.y = p.y;
        return st;
      });
    }

    type Sat = ReturnType<typeof layoutSats>[number];

    /** 위성 궤도 위 각도 th 의 화면 좌표. 배치와 잔광이 같이 쓴다 —
     *  한쪽만 고치면 잔광이 궤도에서 벗어난다. */
    function satPointAt(
      st: { ra: number; ecc: number; omega: number; plane: number },
      th: number,
      ox: number,
      oy: number,
    ) {
      const rr = (st.ra * (1 - st.ecc * st.ecc)) / (1 + st.ecc * Math.cos(th - st.omega));
      const lx = Math.cos(th) * rr;
      const ly = Math.sin(th) * rr * FLATTEN;
      const pc = Math.cos(st.plane);
      const ps = Math.sin(st.plane);
      return { x: ox + lx * pc - ly * ps, y: oy + lx * ps + ly * pc };
    }

    /** 위성 궤도선. 계 화면과 펼친 뒤가 같은 선을 쓴다. */
    function drawSatOrbit(st: Sat, ox: number, oy: number, alpha: number, lit: boolean) {
      const sb = st.ra * Math.sqrt(1 - st.ecc * st.ecc);
      ctx!.save();
      ctx!.translate(ox, oy);
      ctx!.rotate(st.plane); // ← 평면 기울기. 이게 방향이다.
      ctx!.scale(1, FLATTEN);
      ctx!.rotate(st.omega);
      ctx!.beginPath();
      ctx!.ellipse(-st.ra * st.ecc, 0, st.ra, sb, 0, 0, Math.PI * 2);
      ctx!.restore();
      // **선은 아무것도 안 말한다.** 예전에는 알파에 그 경험의 광도(lum)를
      // 섞었는데, 광도는 이미 천체 자체가 크기와 밝기로 말하고 있다 — 같은 값을
      // 선에 한 번 더 실어봐야 정보는 안 늘고 흐려서 안 보이는 선만 생긴다
      // (실측: 계 화면에서 알파 0.086 까지 떨어져 사실상 안 보였다).
      // 궤도선은 "이 천체가 지나는 길"이고, 그건 모두에게 같은 뜻이다.
      // 두께도 마찬가지 — 겨눴을 때만 굵어진다(그건 정보가 아니라 상호작용이다).
      ctx!.strokeStyle = lit
        ? `rgba(99,230,210,${0.5 * alpha})`
        : `rgba(${st.color.join(",")},${0.24 * alpha})`;
      ctx!.lineWidth = lit ? 1.2 : 0.9;
      ctx!.stroke();
    }

    /** 위성 하나. 이 기억을 실제로 만든 경험에는 테를 두른다. */
    function drawSat(st: Sat, alpha: number, lit: boolean) {
      drawPoint(st.x, st.y, st.size, st.lum, lit, alpha, st.color);
      if (!st.isSource) return;
      ctx!.strokeStyle = `rgba(${st.color.join(",")},${0.5 * alpha})`;
      ctx!.lineWidth = 0.9;
      ctx!.beginPath();
      ctx!.arc(st.x, st.y, st.size * 1.9, 0, Math.PI * 2);
      ctx!.stroke();
    }

    /** 잔광 한 점. 천체와 같은 그라디언트 어휘를 쓴다 — 잔광이 선으로 보이면
     *  궤도선(실선)과 다투게 되고, 그 선은 이미 "이 천체의 길"이라는 뜻을 갖고
     *  있다. 흐린 빛의 번짐이라 새로 읽을 것이 없다. */
    function trailDot(
      x: number,
      y: number,
      rad: number,
      [r, g, b]: readonly [number, number, number],
      a: number,
    ) {
      if (a <= 0.004 || rad <= 0.2) return;
      const gr = ctx!.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, `rgba(${r},${g},${b},${a})`);
      gr.addColorStop(0.45, `rgba(${r},${g},${b},${a * 0.5})`);
      gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx!.fillStyle = gr;
      ctx!.beginPath();
      ctx!.arc(x, y, rad, 0, Math.PI * 2);
      ctx!.fill();
    }

    /** 잔광 궤적. 지금 각도에서 뒤로 물러나며 점을 찍는다.
     *
     *  두 층이 같은 함수를 쓴다 — 계의 기억과 펼친 뒤의 경험은 궤도 계산이
     *  서로 다르지만(하나는 Elem, 하나는 위성), 각도를 주면 자리를 답하는 것은
     *  같다. 그 부분만 pointAt 으로 받는다.
     *
     *  꼬리부터 그린다. 머리 쪽이 나중에 얹혀야 천체와 이어지는 자리가 가장
     *  밝다 — 반대로 그리면 흐린 꼬리가 밝은 머리 위에 겹쳐 이음매가 흐려진다.
     */
    function drawTrail(
      rank: number,
      theta: number,
      size: number,
      rgb: readonly [number, number, number],
      alpha: number,
      pointAt: (theta: number) => { x: number; y: number },
    ) {
      const span = TRAIL_SPAN[rank];
      if (span == null || alpha <= 0.01) return;

      // 화면에서 실제로 얼마나 긴가. 현을 재는 것이라 굽은 만큼 짧게 나오지만,
      // 점 개수를 정하는 데는 충분하다(부족한 쪽은 아래 반지름 하한이 메운다).
      const head = pointAt(theta);
      const tail = pointAt(theta - span);
      const chord = Math.hypot(head.x - tail.x, head.y - tail.y);
      const steps = Math.max(8, Math.min(TRAIL_STEPS_MAX, Math.ceil(chord / 4)));
      const gap = chord / steps;

      // 도착 순간에만 한 번 밝아졌다 잦아든다(flare). 상시로 뛰는 게 아니라
      // "지금 막 켜졌다"는 신호라 맥동과 달리 시선을 붙들지 않는다.
      const gain = 0.46 + flare * 0.45;
      for (let k = steps; k >= 1; k--) {
        const f = k / steps; // 1 이 꼬리 끝
        const p = pointAt(theta - span * f);
        // 머리 쪽이 천체 후광(size×3.2)보다 확실히 가늘어야 한다. 비슷해지면
        // 천체가 한쪽으로 늘어난 것처럼 보여 크기(=중요도)를 잘못 읽는다.
        // 하한(gap×0.9)은 이웃한 점끼리 반드시 겹치게 해서 점선을 막는다.
        const rad = Math.max(gap * 0.9, size * (1.1 - 0.78 * f));
        trailDot(p.x, p.y, rad, rgb, alpha * gain * (1 - f) ** 1.4);
      }
    }

    /** 최근 표식 — 코로나.
     *
     *  계 층의 별은 안 돌아서 잔광(지나온 길)이 성립하지 않는다. 대신 후광
     *  바로 바깥에 고리 하나를 두른다. 새 색도 새 움직임도 안 더한다 — 그 별의
     *  색이고, 도착 순간의 섬광(flare)에만 한 번 밝아졌다 잦아든다.
     *  순위가 지름과 세기를 함께 정한다: 가장 최근이 가장 크고 진하다. */
    /**
     * 최근 표식 — 코로나. **층을 건너 같은 모양으로 쓴다.**
     *
     *   우주   방금 뭔가 들어온 **은하**
     *   은하   그 **별**(갈래)
     *   항성계 그 **경험** — 여기서는 실제로 도니까 잔광(drawTrail)이 대신한다
     *
     * 새 색도 새 움직임도 안 더한다. 색은 분야, 크기는 질량, 광도는 중요도로
     * 이미 다 찼고 — 고리는 아무 데도 안 쓰이는 유일한 채널이다. 맥동은 안 쓴다:
     * 화면에서 유일하게 뜻 없이 움직이는 것이 되어 뭘 보려 해도 눈이 끌려간다.
     *
     * @param bodyRad 그 천체가 실제로 그려진 반지름. 고리는 그 **바깥**에 둘러야
     *   고리로 읽힌다 — 안쪽이면 천체가 그냥 조금 커진 것처럼 보여 크기(=질량)를
     *   잘못 읽는다. 별과 은하는 반지름 셈법이 달라서 값으로 받는다.
     */
    function drawCorona(
      x: number,
      y: number,
      bodyRad: number,
      rank: number,
      rgb: readonly [number, number, number],
      alpha: number,
    ) {
      const span = TRAIL_SPAN[rank];
      if (span == null || alpha <= 0.01) return;
      const rad = bodyRad * (1.35 + span * 0.5);
      // 도착 순간에 한 번 밝아졌다 잦아든다(flare). 잦아든 뒤에도 남는 세기가
      // 표식의 본체다 — 예전엔 그게 0.32 라 몇 초 뒤엔 있는지도 몰랐다.
      const a = alpha * span * (0.5 + flare * 0.42);
      ctx!.strokeStyle = `rgba(${rgb.join(",")},${a})`;
      ctx!.lineWidth = 1 + span * 1.1;
      ctx!.beginPath();
      ctx!.arc(x, y, rad, 0, Math.PI * 2);
      ctx!.stroke();
    }

    // 경험 — 테두리가 있는 원이 아니라 빛 자체다. 단단한 가장자리를 그리지
    // 않고 중심에서 바깥으로 사그라드는 그라디언트만 그린다. 별은 심이 있는
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
      // 최근이라고 크기·밝기를 건드리지 않는다. 그건 잔광(drawTrail)이 맡는다 —
      // 여기서 또 밝히면 "밝다"가 광도(memoryScore)인지 최근인지 갈리지 않는다.
      const rad = size * (lit ? SAT_LIT : 1) * SAT_GLOW;
      const c = lit ? [143, 244, 228] : color;
      const gc = c.join(",");
      // 하한을 두는 이유: 점수가 0인 경험도 "있다"는 건 보여야 한다.
      // 완전히 사그라들면 근거 6건 중 몇 개가 화면에서 사라진다.
      //
      // 천장(SAT_UNDER_STAR)을 두는 이유는 다르다 — **주인보다 밝으면 안 된다.**
      // 별 알파는 satReveal 아래로 안 내려가는데(starLumOf), 위성 알파는
      // 그 satReveal 을 그대로 곱해 들어와서 가장 센 근거가 제 별과 알파가
      // 같아졌다. 크기는 이미 1.3배로 벌려뒀지만 밝기까지 같으면 "이 안의
      // 주인이 누구인가"가 한 채널 덜 말해진다.
      // 겨눈 것(lit)은 예외다. 그건 광도가 아니라 표식이라 채널이 다르다.
      const peak = Math.min(1, (lit ? 1 : (0.62 + lum * 0.38) * SAT_UNDER_STAR) * alpha);

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

    // 별 — 경험과 같은 원리다. 테두리 있는 원을 그리지 않고 중심에서
    // 사그라드는 그라디언트만 그린다. 단단한 원은 "가장자리가 어디까지인가"라는
    // 답할 수 없는 질문을 만든다 — 별에는 경계가 없다.
    // 경험과 갈리는 건 모양이 아니라 크기와 심의 흰빛, 그리고 맥동이다.
    function drawStar(
      x: number,
      y: number,
      radius: number,
      color: [number, number, number],
      lit: boolean,
      alpha: number,
      lum: number,
      t: number,
    ) {
      const [r, g, b] = lit ? [143, 244, 228] : color;
      // 아주 느린 맥동. 살아 있다는 표시 정도로만 — 5% 라 겨눠보지 않으면
      // 움직인다는 것도 모른다. "최근"은 여기서 안 다룬다(drawCorona).
      const pulse = reduced ? 1 : 1 + Math.sin(t * 0.5 + x * 0.01) * 0.05;
      // **광도는 알파와 후광 넓이를 같이 쓴다.**
      //
      // 알파만으로는 안 읽혔다. 안쪽이 흰빛으로 타는 그라디언트라 심은 어느
      // 밝기에서든 비슷하게 하얗고, 실제로 갈리는 건 바깥 후광이 어디까지
      // 번지느냐다 — 실제 별도 그렇게 보인다.
      const bloom = bloomOf(lum);
      const rad = radius * pulse * (lit ? 1.45 : 1) * STAR_GLOW * bloom;

      // 안쪽 10%만 흰빛으로 타들어가고, 거기서부터 색을 거쳐 사그라든다.
      // 정지점을 촘촘히 둬야 경계 없이도 "심이 있다"가 읽힌다.
      //
      // **정지점을 bloom 으로 되나눈다.** 안 그러면 광도가 심까지 같이 줄여서
      // 크기(질량)와 밝기가 한 덩어리로 읽힌다 — 작고 밝은 별과 크고 어두운
      // 별이 구분이 안 된다. 되나누면 심의 px 크기는 radius 만 따르고,
      // 광도는 **꼬리가 어디까지 번지느냐**만 정한다.
      // (bloom ≤ 1 이라 나눈 값은 커지고, 1 을 넘는 정지점은 잘라낸다 —
      //  가장 어두운 별은 꼬리 없이 심만 남는다.)
      const st = (v: number) => Math.min(1, v / bloom);
      const gr = ctx!.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, `rgba(255,255,255,${alpha})`);
      gr.addColorStop(st(0.09), `rgba(${r},${g},${b},${alpha})`);
      gr.addColorStop(st(0.2), `rgba(${r},${g},${b},${0.78 * alpha})`);
      gr.addColorStop(st(0.36), `rgba(${r},${g},${b},${0.34 * alpha})`);
      gr.addColorStop(st(0.62), `rgba(${r},${g},${b},${0.1 * alpha})`);
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
      /** 이 축을 **반직선**으로 그릴까(중심에서 라벨 쪽으로만).
       *
       *  지름으로 그으면 맞은편까지 선이 뻗는다. 방향이 반원만 쓰던 시절에는
       *  그게 맞았다 — 맞은편은 같은 뜻이었으니까(궤도면은 θ 와 θ+π 가 같다).
       *  기억은 이제 온 원을 쪼개 쓰므로 맞은편은 **다른 trigger 의 자리**다.
       *  지름으로 그으면 남의 조각을 가로지르고, 6조각이면 정반대 조각과
       *  선이 정확히 포개져 라벨 둘이 한 선을 나눠 갖게 된다. */
      ray?: (key: string) => boolean;
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

        // 반직선이면 시작점이 중심(t=0)이고, 지름이면 반대편 가장자리다.
        const tStart = o.ray?.(key) ? 0 : -tEdge;
        ctx!.beginPath();
        if (tIn < tOut) {
          ctx!.moveTo(ax0 + dx * tStart, ay0 + dy * tStart);
          ctx!.lineTo(ax0 + dx * Math.max(tStart, tIn), ay0 + dy * Math.max(tStart, tIn));
          ctx!.moveTo(ax0 + dx * Math.min(tEdge, tOut), ay0 + dy * Math.min(tEdge, tOut));
          ctx!.lineTo(ax0 + dx * tEdge, ay0 + dy * tEdge);
        } else {
          ctx!.moveTo(ax0 + dx * tStart, ay0 + dy * tStart);
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

      // 실제 시각으로 잰다. simT 는 겨누고 있으면 멈추는데, 섬광은 그 사이에도
      // 잦아들어야 한다 — 안 그러면 마우스를 올려둔 채로 영원히 터져 있다.
      if (flareAt === 0) flareAt = now;
      flare = reduced ? 0 : Math.exp(-(now - flareAt) / 1400);
      // 시간축이 둘이다.
      //   simT — 계 전체. 겨누고 있거나 별 하나에 붙어 있으면 멈춘다.
      //          별은 이제 안 돌지만 맥동·섬광이 이 시계를 쓴다.
      //   satT — 위성(경험). 겨누고 있을 때만 멈춘다.
      // 예전에는 하나였다. 그래서 포커스에 들어가는 순간 위성까지 같이 얼어
      // 근거가 도는 게 아니라 박혀 있었다 — 멈춰야 하는 건 배경이지 대상이 아니다.
      // 멈추는 것은 계(simT)뿐이다. 그 안의 경험(satT)은 계속 돈다.
      const scaleTarget = hovered || focusRef.current || inStarId || lockedId ? 0 : 1;
      tScale += (scaleTarget - tScale) * 0.16;
      simT += dt * tScale;
      const satTarget = hovered ? 0 : 1;
      satScale += (satTarget - satScale) * 0.16;
      satT += dt * satScale;
      const t = reduced ? 0 : simT;
      const ts = reduced ? 0 : satT;

      // 층을 넘나들 때마다 다시 터진다. 펼친 순간이 곧 그 층의 도착이다.
      if ((focusRef.current != null) !== lastFocused) {
        lastFocused = focusRef.current != null;
        flareAt = now;
      }

      const target = focusRef.current ? 1 : 0;
      // 들어갈 때와 나올 때의 속도를 나눈다. 들어가는 건 내가 고른 곳으로
      // 가는 거라 빠른 게 시원한데, 나오는 건 "어디서 나왔는지"를 눈으로
      // 따라가야 해서 같은 속도면 뚝 끊긴다.
      ft += (target - ft) * (focusRef.current ? 0.075 : 0.032);
      if (Math.abs(target - ft) < 0.002) ft = target;

      // 관성. 손을 뗀 속도로 계속 미끄러지다 잦아든다. 감쇠도 프레임 수가
      // 아니라 시간 기준이라 주사율이 달라도 같은 거리를 간다.
      //
      // **panBy 로 목표를 옮긴다.** 예전에는 지금 값만 밀고 `offXTarget = offX`
      // 로 목표를 덮어썼는데, 그러면 미끄러지는 중에 굴린 확대의 앵커가 다음
      // 프레임에 통째로 지워졌다 — 휠이 관성을 강제로 꺼야만 했던 이유다.
      if (!dragging && (flingX !== 0 || flingY !== 0)) {
        const before = { x: offX, y: offY };
        panBy(flingX * dt, flingY * dt);
        applyCamera(); // 벽에 걸렸는지 알려면 실제로 풀어봐야 한다
        // 벽에 닿으면 그 방향 속도를 버린다. 안 그러면 한계에 붙어 계속
        // 밀고 있는 상태가 되어 놓아준 느낌이 안 난다.
        if (Math.abs(offX - before.x) < Math.abs(flingX * dt) - 0.5) flingX = 0;
        if (Math.abs(offY - before.y) < Math.abs(flingY * dt) - 0.5) flingY = 0;
        const decay = Math.pow(0.05, dt); // 1초에 5% 남는다
        flingX *= decay;
        flingY *= decay;
        if (Math.hypot(flingX, flingY) < 8) flingX = flingY = 0;
      }

      // 확대는 프레임 수가 아니라 시간으로 수렴시킨다. 계수 곱셈(z += (t-z)*k)은
      // 화면 주사율에 따라 속도가 달라져서, 120Hz 에서는 60Hz 의 두 배로 빨라진다.
      // 배율과 이동은 **같은 계수**를 쓴다 — 따로 놀면 확대하는 동안 겨눈 지점이
      // 미끄러지고, 돌아올 때 한쪽이 먼저 도착해 끊겨 보인다.
      const k = 1 - Math.pow(0.0012, dt);
      //
      // **배율은 로그 공간에서 이징한다.** 층 폭이 수천 배라 선형으로 하면
      // 안쪽(작은 값)에서는 기어가고 바깥에서는 날아간다 — 같은 한 칸이
      // 어디서 굴렸느냐에 따라 전혀 다른 거리가 된다. 로그로 두면 "몇 배"가
      // 일정해서 어느 층에서든 같은 속도로 들어간다.
      //
      // 앵커는 클릭으로 데려갈 때만 목표와 갈린다(휠은 못박아 둔다).
      // 배율과 **같은 계수**를 써야 둘이 나란히 도착한다.
      if (zoom !== zoomTarget) {
        zoom = Math.exp(Math.log(zoom) + (Math.log(zoomTarget) - Math.log(zoom)) * k);
        if (Math.abs(Math.log(zoomTarget / zoom)) < 0.0004) zoom = zoomTarget;
      }
      if (anchorWX !== anchorWXT || anchorWY !== anchorWYT) {
        anchorWX += (anchorWXT - anchorWX) * k;
        anchorWY += (anchorWYT - anchorWY) * k;
        // 세계 단위라 문턱도 세계 단위여야 한다 — 화면 반 픽셀에 해당하는 양.
        const eps = 0.5 / Math.max(1e-9, baseUnit * zoomTarget);
        if (Math.abs(anchorWXT - anchorWX) < eps) anchorWX = anchorWXT;
        if (Math.abs(anchorWYT - anchorWY) < eps) anchorWY = anchorWYT;
      }
      if (anchorSX !== anchorSXT || anchorSY !== anchorSYT) {
        anchorSX += (anchorSXT - anchorSX) * k;
        anchorSY += (anchorSYT - anchorSY) * k;
        if (Math.abs(anchorSXT - anchorSX) < 0.3) anchorSX = anchorSXT;
        if (Math.abs(anchorSYT - anchorSY) < 0.3) anchorSY = anchorSYT;
      }
      applyCamera();

      // 이름표를 질량중심에 붙인다. 캔버스가 아니라 DOM 이라 여기서 옮긴다.
      if (centerLabelRef.current) {
        centerLabelRef.current.style.left = `${cx}px`;
        centerLabelRef.current.style.top = `${cy}px`;
      }

      ctx!.clearRect(0, 0, w, h);
      hit.clear();

      // ── 지금 어느 층을 보고 있나 ──
      //
      // 확대가 곧 "안을 들여다본다"라는 뜻을 갖는다. 층마다 배어 나오는
      // 구간이 있고, 그 구간은 전부 LAYER_RATIO 에서 나온다(4단계).
      // 문턱이 아니라 경사라 휠을 굴리는 동안 서서히 나타난다.
      //
      // 절대 배율로 박으면 안 된다 — 창 크기마다 기본 배율이 다르다.
      // "우주 전체에서 얼마나 당겼나"(zr)로 잰다.
      const zr = zoom / Math.max(1e-6, fitZoom);
      const ramp = (from: number, to: number) =>
        Math.max(0, Math.min(1, (zr - from) / (to - from)));
      /** 은하 안의 별이 드러난 정도 */
      const starReveal = ramp(galaxyLayer * REVEAL_ONSET, galaxyLayer);
      /** 별 안의 경험이 드러난 정도 */
      const satReveal = ramp(starLayer * REVEAL_ONSET, starLayer);

      /**
       * 화면에 실제로 쓰는 광도. **위성이 나올수록 1 로 올라간다.**
       *
       * 광도는 별끼리 견주는 값이라 별밭에서만 뜻이 있다. 그 안으로 당겨
       * 들어가면 견줄 대상은 옆 별이 아니라 제 위성이고, 거기서는 위계
       * (중심 > 별 > 경험)가 지켜져야 한다 — 어두운 별이 제 경험보다 흐리면
       * 누가 주인인지 화면이 뒤집힌다.
       *
       * 이 식이 그걸 **증명한다**(눈으로 맞춘 값이 아니다):
       *   위성 알파 ≤ sysAlpha · dimOf · satReveal      (drawPoint 의 peak 상한)
       *   별   알파  = sysAlpha · dimOf · (lum + (1-lum)·satReveal)
       *              ≥ sysAlpha · dimOf · satReveal      (lum ≥ 0 이므로)
       * 어떤 배율에서도 별이 제 위성보다 어두워지지 않는다.
       */
      const starLumOf = (el: Elem) => el.lum + (1 - el.lum) * satReveal;
      // 매 프레임 지우고 아래에서 다시 정한다. 안 지우면 물러난 뒤에도 마지막
      // 별의 판독값이 위에 남는다 — 위성계를 안 그리는 배율에서는 계산 자체가
      // 안 돌기 때문이다.
      dominantIdRef.current = null;

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
      // 초점은 그 천체의 자리다. 별은 안 돌지만 카메라(cx·cy·unit)가 움직이므로
      // 매 프레임 다시 구한다 — 클릭 순간의 화면 좌표를 저장해 쓰면 그사이
      // 배율이나 이동이 바뀐 만큼 착지점이 어긋난다.
      const focEl = foc ? els.find((e) => e.id === foc.id) : null;
      const fp = focEl ? orbitPoint(focEl) : null;
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
        // 깊이 정렬. 기울여 본 평면이므로 화면 아래쪽(y > cy)이 관찰자에게
        // 가까운 쪽이다. 뒤쪽을 먼저, 중심을, 그다음 앞쪽을 그려야 앞을 지나는
        // 천체가 중심 위로 지나간다 — 안 그러면 전부 중심 뒤로 숨는다.
        //
        // 자리와 위성계를 **그리기 전에 전부 구한다.** 축이 무엇을 가리킬지가
        // "지금 어느 별 안에 들어와 있나"에 달려 있는데, 축은 배경이라 제일
        // 먼저 그려야 한다 — 계산과 그리기 순서가 반대다.
        // 위성을 거느리는 것은 전부 배율을 따라 커진다. 제 위성이 커지는 만큼
        // 저도 커져야 "누가 중심인가"가 안 뒤집힌다.
        // 중심(권도형)은 안 커진다. 당겨 들어갔다는 건 중심을 벗어났다는 뜻이라
        // 어차피 화면 밖이고, 커지면 그 계의 주인과 크기를 다툰다.
        const starGrow = starGrowOf(zr, galaxyLayer);
        /** 질량에서 나온 크기. 아래에서 위성보다 작아지지 않게 한 번 더 걸러진다. */
        const massSizeOf = (el: Elem) =>
          el.mem.referencedIds.length > 0 ? el.size * starGrow : el.size;

        const placed = els.map((el) => ({ el, p: orbitPoint(el) }));

        // ── 화면 밖은 안 그린다 ──
        //
        // 축척이 고정이라 계가 화면보다 크다. 예전에는 전부를 화면에 우겨넣어서
        // 늘 다 보였고, 그래서 컬링이 필요 없었다 — 지금은 매 프레임 대부분이
        // 화면 밖이다. 위성계가 특히 비싸다(별 하나에 수십 개를 배치했다 버린다).
        //
        // 여유를 넉넉히 둔다. 후광이 화면 밖 중심에서 안으로 새어 들어오는데,
        // 딱 맞춰 자르면 가장자리에서 빛이 뚝 끊긴다.
        const onScreen = (x: number, y: number, pad: number) =>
          x > -pad && x < w + pad && y > -pad && y < h + pad;
        // 별은 전부 위성계를 갖는다. 갈래 하나가 항성계 하나이고 그 안에 경험이
        // 들어 있다 — 남겼느냐 아니냐는 광도가 이미 말하고 있다.
        // 경험이 하나도 안 걸린 것만 뺀다(그릴 게 없다).
        const starSats =
          satReveal > 0.01
            ? placed
                .filter(
                  ({ el, p }) =>
                    el.mem.referencedIds.length > 0 &&
                    !(foc && el.id === foc.id) &&
                    // 위성계 반경만큼 더 잡아준다 — 별은 밖인데 위성은 안으로
                    // 들어와 있을 수 있다.
                    onScreen(p.x, p.y, satFieldR * unit + 60),
                )
                .map(({ el, p }) => {
                  const refs = refsOf(el.mem);
                  const R = satFieldR * unit;
                  return { el, p, R, sats: layoutSats(refs, el.mem.sourceIds, R, p.x, p.y, ts) };
                })
            : [];

        // ── 별은 제 위성보다 커야 한다 ──
        //
        // 크기는 질량(경험 수)이고 위성 크기는 그 경험의 점수라, 둘은 서로 다른
        // 자에서 나온다 — 그냥 두면 위계가 뒤집힌다. 실측: 경험 1건짜리 어두운
        // 별이 반경 14.5px 인데 제 위성 중 가장 큰 것이 43px 이었다.
        // "주인이 손님보다 작다"는 건 눈이 먼저 알아채고, 그러면 확대해 들어간
        // 것이 무엇의 안인지가 화면에서 사라진다.
        //
        // 위성을 깎지 않고 별에 하한을 건다. 위성 크기는 "이 근거가 얼마나
        // 셌나"라 깎으면 뜻이 준다 — 반면 별 크기는 이미 다 견준 뒤라
        // (이 배율에서는 옆 별이 dimOf 로 지워져 있다) 키워도 잃는 게 없다.
        //
        // 그린 반지름끼리 견준다. 별과 위성은 size→반지름 계수가 달라
        // (STAR_GLOW 3.2 · SAT_GLOW 4.1) size 끼리 직접 비교하면 안 된다.
        // 광도가 후광을 좁히는 몫(bloomOf)까지 되나눠야 실제로 그려질 반지름이
        // 하한을 넘는다.
        //
        // **겨눈 상태(SAT_LIT)까지 미리 감안한다.** 안 그러면 위성을 겨누는
        // 순간 그것만 1.6배가 되어 제 별을 넘어선다(실측 69.5px 대 56.5px) —
        // 겨눔은 잠깐이지만 그 순간 위계가 뒤집히는 건 마찬가지다.
        // 호버 여부로 하한을 바꾸면 겨눌 때마다 별이 펄쩍 뛰므로, **항상**
        // 가장 큰 위성이 겨눠진 셈 치고 잡는다 — 별이 조금 커지는 대신
        // 크기가 손짓에 안 흔들린다.
        const satFloor = new Map<string, number>();
        for (const s of starSats) {
          const maxSat = s.sats.reduce((mx, st) => Math.max(mx, st.size), 0);
          if (maxSat <= 0) continue;
          const needRad = maxSat * SAT_LIT * SAT_GLOW * STAR_OVER_SAT;
          satFloor.set(s.el.id, needRad / (STAR_GLOW * bloomOf(starLumOf(s.el))));
        }
        /** 화면에 실제로 그리는 크기. 판정 반경도 이걸 써야 보이는 것과 눌리는
         *  것이 안 어긋난다. */
        const sizeOf = (el: Elem) => Math.max(massSizeOf(el), satFloor.get(el.id) ?? 0);

        // ── 화면을 차지한 별 ──
        //
        // 당겨서 한 별의 계 안으로 들어가면, 누르지 않아도 그 별의 판독값이
        // 위에 뜨고 축도 그 별의 것으로 갈린다. 확대한다는 것 자체가 "지금
        // 이걸 보고 있다"는 뜻이라, 거기서 한 번 더 누르라고 요구할 이유가 없다.
        //
        // 재는 것은 **화면을 덮은 넓이**다. 화면 중앙에 가까운 것으로 고르면
        // 끌어서 옆을 볼 때 정작 화면을 채운 별이 아니라 가운데 걸친 것이
        // 잡힌다. 원과 화면의 겹침을 외접 사각형으로 어림하고 π/4 를 곱한다 —
        // 순위만 가리면 되는 값이라 정확할 필요가 없다.
        let topStar: (typeof starSats)[number] | null = null;
        let topRatio = 0;
        for (const s of starSats) {
          const rad = Math.max(s.R, sizeOf(s.el) * STAR_GLOW);
          const ow = Math.max(0, Math.min(w, s.p.x + rad) - Math.max(0, s.p.x - rad));
          const oh = Math.max(0, Math.min(h, s.p.y + rad) - Math.max(0, s.p.y - rad));
          const ratio = ((ow * oh) / (w * h)) * (Math.PI / 4);
          if (ratio > topRatio) {
            topRatio = ratio;
            topStar = s;
          }
        }
        // 문턱이 있어야 한다. 없으면 멀찍이 걸친 별 하나 때문에 판독값이
        // 계속 떠 있고, 그러면 "이걸 보고 있다"는 뜻이 사라진다.
        //
        // 들어가는 문턱과 나오는 문턱을 벌린다. 하나만 두면 별이 경계에 걸쳐
        // 있을 때 — 궤도를 도는 별은 늘 조금씩 움직인다 — 프레임마다 켜졌다
        // 꺼져서 축과 판독값이 파르르 떤다.
        const wasIn = inStarId != null;
        const inStar =
          satReveal > (wasIn ? 0.4 : 0.5) && topRatio > (wasIn ? 0.034 : 0.05) ? topStar : null;
        inStarId = inStar?.el.id ?? null;
        dominantIdRef.current = inStarId;

        // ── 축 ──
        //
        // 두 벌이 겹쳐 있고 axisMix 가 그 사이를 건넌다.
        //   멀리서 — 계 전체의 축(기억은 trigger, 갈래는 분야)
        //   별 안에서 — 그 별에 딸린 경험들의 결과 축(해냄·일부·막힘·둘러봄)
        // 한쪽이 옅어지는 만큼 다른 쪽이 짙어진다. 축은 "지금 보고 있는 층에서
        // 방향이 무슨 뜻인가"를 적는 자리라, 층이 바뀌면 같이 바뀌어야 한다.
        // 축이 궤도보다 먼저다 — 선은 배경이지 대상이 아니다.
        const wantStarId = inStar?.el.id ?? null;
        if (wantStarId !== axisStarId) {
          // **다 물러난 뒤에 갈아 끼운다.** 별마다 축 각도가 통째로 다른 값이라,
          // 겹쳐서 페이드하면 선이 획 도는 것처럼 보인다. 나갔다 들어온다.
          if (axisMix < 0.02) {
            axisStarId = wantStarId;
            axisAngles = inStar ? outcomeAngles(refsOf(inStar.el.mem)) : null;
          }
        } else if (inStar) {
          // 같은 별이면 각도만 갱신한다. 위성이 돌아도 축은 거의 안 움직인다
          // (평면 각도의 평균이라 궤도 위치와 무관하다).
          axisAngles = outcomeAngles(refsOf(inStar.el.mem));
        }
        // 시간 기준 수렴. 프레임 수로 재면 120Hz 에서 60Hz 의 두 배로 빨라진다.
        const axisTarget = axisStarId != null && axisStarId === wantStarId ? 1 : 0;
        axisMix += (axisTarget - axisMix) * (1 - Math.pow(0.004, dt));
        if (Math.abs(axisTarget - axisMix) < 0.002) axisMix = axisTarget;

        // ── 지금 보고 있는 것 말고는 물러난다 ──
        //
        // 한 별 안으로 들어와도 옆 갈래의 별과 그 위성계가 같은 세기로 떠
        // 있으면, 지금 도는 위성이 누구 것인지 화면이 답을 못 한다 — 별끼리
        // 간격이 좁을수록(6개월치면 91개다) 통째로 겹쳐 보인다.
        // 다 지우지는 않는다. 어디쯤에 있는지는 남아야 돌아갈 길을 안 잃는다.
        const otherDim = inStar ? 1 - 0.86 * satReveal : 1;
        const dimOf = (id: string) => (inStar && id !== inStar.el.id ? otherDim : 1);

        // ══════════════════════════════════════════════════
        // 층 0 — 우주: 은하와 그 사이를 잇는 실
        // ══════════════════════════════════════════════════
        //
        // 예전에는 여기에 **축**이 있었다. 중심에서 뻗은 점선에 분야 이름을
        // 붙여 "이 방향이 무엇인가"를 적었다. 분야가 은하가 되면서 방향이
        // 아무 뜻도 안 갖게 됐고, 축도 같이 사라졌다 — 이제 분야는 '어느 쪽'이
        // 아니라 '어디'라, 이름표를 그 자리에 직접 붙이면 된다.
        //
        // 별이 다 드러날수록(starReveal) 이 층은 물러난다. 위층은 배경이고
        // 아래층은 없는 것 — 원리 1 이다.
        const galAlpha = sysAlpha * (1 - 0.72 * starReveal) * (1 - axisMix);

        if (galAlpha > 0.01) {
          // 필라멘트. 은하보다 먼저 — 실은 배경이지 마디가 아니다.
          ctx!.lineWidth = 1;
          for (const [a, b] of filaments) {
            const ax = worldX(a.x);
            const ay = worldY(a.y);
            const bx = worldX(b.x);
            const by = worldY(b.y);
            if (!onScreen(ax, ay, w) && !onScreen(bx, by, w)) continue;
            // 양 끝이 제 은하 색으로 물들고 가운데에서 만난다. 한 색으로
            // 그으면 실이 어느 쪽 것인지 모르게 되고, 그러면 그냥 배경 격자다.
            const lg = ctx!.createLinearGradient(ax, ay, bx, by);
            lg.addColorStop(0, `rgba(${a.color.join(",")},${0.3 * galAlpha})`);
            lg.addColorStop(0.5, `rgba(${NEUTRAL.join(",")},${0.1 * galAlpha})`);
            lg.addColorStop(1, `rgba(${b.color.join(",")},${0.3 * galAlpha})`);
            ctx!.strokeStyle = lg;
            ctx!.beginPath();
            ctx!.moveTo(ax, ay);
            ctx!.lineTo(bx, by);
            ctx!.stroke();
          }

          // 은하 자체. 원반 크기 그대로 그린다 — 멀리서는 점이고, 당기면
          // 그 안에서 별이 배어 나오면서 이 빛이 뒤로 물러난다.
          for (const g of galaxies) {
            const gx = worldX(g.x);
            const gy = worldY(g.y);
            const R = GALAXY_R * unit;
            // 아무리 물러나도 점 하나로는 남아야 한다. 안 그러면 우주 전체를
            // 보려고 물러났을 때 화면이 통째로 비어 "다 사라졌다"가 된다.
            const rad = Math.max(7, R * 1.5);
            if (!onScreen(gx, gy, rad * 3 + 60)) continue;
            const lit = hovered === `gal:${g.key}`;
            const rgb = (lit ? [143, 244, 228] : g.color).join(",");
            const a0 = galAlpha * (lit ? 1 : 0.9);
            const grd = ctx!.createRadialGradient(gx, gy, 0, gx, gy, rad * 2.6);
            grd.addColorStop(0, `rgba(${rgb},${0.62 * a0})`);
            grd.addColorStop(0.28, `rgba(${rgb},${0.26 * a0})`);
            grd.addColorStop(0.62, `rgba(${rgb},${0.07 * a0})`);
            grd.addColorStop(1, `rgba(${rgb},0)`);
            ctx!.fillStyle = grd;
            ctx!.beginPath();
            ctx!.arc(gx, gy, rad * 2.6, 0, Math.PI * 2);
            ctx!.fill();

            // ── 방금 뭔가 들어온 은하 ──
            //
            // 별에만 있던 표식을 한 층 위로 올린다. 없으면 지도를 열었을 때
            // 점 몇 개만 보이고 **어디서 방금 일이 있었는지 알 길이 없다** —
            // 아래층까지 내려가야 비로소 보였다.
            //
            // 은하의 순위는 그 안에서 가장 최근인 것을 따른다. 갈래 셋이 한
            // 은하에 몰리면 그 은하가 1등이지 3등이 아니다.
            let best: number | null = null;
            for (const t of g.members) {
              const rk = latestRankRef.current.get(t.id);
              if (rk != null && (best == null || rk < best)) best = rk;
            }
            // **별이 드러나면 사라진다.** 고리는 그 은하가 아직 *점*일 때 쓰는
            // 표식이다 — 안으로 들어가면 은하만 한 거대한 원이 되어 표식이
            // 아니라 노이즈가 되고, 그 층의 주인은 이미 별의 코로나다.
            if (best != null) {
              drawCorona(gx, gy, rad * 1.5, best, g.color, galAlpha * (1 - starReveal));
            }

            // 이름표. 축 라벨이 하던 일을 여기서 한다 — 다만 허공의 방향이
            // 아니라 실제로 그것이 있는 자리에 붙는다.
            // 원반 가장자리 바로 아래에 붙인다. 후광 반경(rad)에 매달면 당길수록
            // 이름표가 화면 밖으로 밀려나 정작 그 은하 안에서는 안 보인다.
            ctx!.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
            ctx!.textAlign = "center";
            ctx!.textBaseline = "top";
            ctx!.fillStyle = `rgba(${rgb},${(lit ? 0.95 : 0.6) * galAlpha})`;
            ctx!.fillText(g.label.toUpperCase(), gx, gy + Math.max(12, R * GALAXY_EDGE * FLATTEN) + 9);

            // ── 판정 ──
            //
            // **별이 눌리기 시작하면 은하는 안 눌린다.** 문턱을 별과 같은 값
            // (STAR_HIT)으로 두어 둘이 정확히 배타적이다.
            //
            // 안 그러면 은하가 제 별을 통째로 삼킨다. 판정 반경이 원반 크기를
            // 따라 자라는데 nearest 가 그걸 CAPTURE(2.4)배로 또 넓혀 잡으므로,
            // 실측 zr 27 에서 은하 하나가 반경 417px 를 먹었다 — 그 안의 별을
            // 누르려 하면 은하가 잡혀서 도로 밖으로 튕겨 나갔다.
            //
            // 반경도 **그려진 점**에 맞춘다. 원반 전체(rad)로 잡으면 눈에 보이는
            // 빛보다 훨씬 넓은 데가 눌려서 "왜 여기서 잡히지"가 된다.
            // 카메라가 움직이는 동안에는 아예 안 받는다 — 보이는 곳과 눌리는
            // 곳이 어긋난다.
            if (ez < 0.02 && starReveal < STAR_HIT) {
              hit.set(`gal:${g.key}`, {
                x: gx,
                y: gy,
                r: Math.max(16, Math.min(rad, 46)),
                kind: "galaxy",
              });
            }
          }
        }

        // ── 나선팔 자취 ──
        //
        // 팔 위에 놓인 별만으로는 나선이 안 읽힌다. 진행 중인 갈래는 원래
        // 소수라(실측: DEV 은하 37개 중 12개) 팔 하나에 예닐곱이고, 그 둘레를
        // halo 스물다섯이 감싸면 곡선이 묻힌다.
        //
        // 그래서 팔 자체를 긋는다. **예전 축 점선이 하던 일이다** — 라벨이
        // 가리키는 곳에 아무도 없으면 안 되듯, 별이 놓인 곡선은 보여야 그
        // 자리가 뜻을 갖는다. 배치와 **같은 식**을 쓰므로 별은 반드시 이 선
        // 위에 얹힌다(ARM_SPAN 을 상수로 뺀 이유).
        //
        // 은하 빛과 **반대로** 나타난다. 멀리서는 은하가 점이라 팔이 있을 자리가
        // 없고, 당겨서 별이 드러나는 만큼 팔도 같이 드러난다.
        const armAlpha = sysAlpha * starReveal * (1 - axisMix);
        if (armAlpha > 0.01) {
          for (const g of galaxies) {
            if (!g.members.some((t) => t.status === "active")) continue; // 원반이 비었다
            const R = GALAXY_R * unit;
            if (!onScreen(worldX(g.x), worldY(g.y), R * 2.6 + 80)) continue;

            // 점을 겹쳐 찍어 **띠**를 만든다. 1px 선으로 그었더니 그냥 선이었다 —
            // 실제 나선팔은 가스와 먼지가 깔린 넓고 흐릿한 길이지 그어놓은
            // 획이 아니다. 잔광(trailDot)이 이미 쓰는 어휘라 새 모양을 안 만든다.
            //
            // 점 사이가 벌어지면 띠가 아니라 **점선**이 된다(실제로 그렇게 나왔다).
            //
            // 개수를 반경 폭으로 정한 게 잘못이었다. 로그 나선의 호 길이는
            // 반경 폭의 `√(1+b²)/b` 배 — 지금 값으로 **3.5배**다. 그만큼 점이
            // 성기게 찍혔다. 호 길이로 재고, 그래도 벌어지면 점 반지름에
            // 직전 점까지의 거리만큼 하한을 둬 반드시 겹치게 한다
            // (drawTrail 이 같은 이유로 같은 짓을 한다).
            const span = R * (1 - BULGE);
            const arcLen = (Math.sqrt(1 + ARM_PITCH * ARM_PITCH) / ARM_PITCH) * span;
            const steps = Math.max(40, Math.min(220, Math.round(arcLen / 3)));
            for (let arm = 0; arm < ARMS; arm++) {
              let prev: { x: number; y: number } | null = null;
              for (let k = 0; k <= steps; k++) {
                const at = k / steps;
                const { th, r } = armAt(g.key, arm, at);
                const px = worldX(g.x + Math.cos(th) * r * GALAXY_R);
                const py = worldY(g.y + Math.sin(th) * r * GALAXY_R * FLATTEN);
                // 직전 점까지의 실제 거리. 나선은 안쪽이 촘촘하고 바깥이 성겨서
                // 한 값으로는 못 맞춘다 — 재서 쓴다.
                const gap = prev ? Math.hypot(px - prev.x, py - prev.y) : 0;
                prev = { x: px, y: py };

                // 두께는 반경을 따라 조금씩만 벌어진다. **가늘어야 한다** —
                // 별을 흩뿌린 폭(ARM_WIDTH)에 맞춰 띠를 그렸더니 팔이 아니라
                // 뭉개진 덩어리가 됐다. 별은 팔 **둘레에** 흩어지는 것이지
                // 팔이 그 폭을 다 채우는 게 아니다. 팔은 그 한가운데 지나는
                // 가는 빛줄기고, 부드러움은 두께가 아니라 겹친 점이 만든다.
                //
                // 최소 두께만 1.1 → 1.5 로 올린다. 두께를 더 키우면 예전처럼
                // 뭉개진 덩어리로 돌아가므로, 안 보이는 문제는 아래 세기로 푼다.
                const wide = Math.max(1.5, r * GALAXY_R * unit * ARM_WIDTH * 0.07);
                // 세기는 반대로 사그라든다. 안쪽이 진하고 끝에서 0 이어야
                // 잘린 자국이 안 남는다 — 팔은 끝나는 게 아니라 옅어져 사라진다.
                // 팽대부 쪽도 살짝 죽인다(안 그러면 두 팔이 중심에서 뭉친다).
                const fade = Math.pow(1 - at, 1.35) * Math.min(1, at * 6 + 0.25);
                // 세기 0.42 → 0.60. 가늘게 만든 대가로 팔이 배경에 묻혔다 —
                // 굵히는 대신 진하게 해서 "가는 빛줄기"라는 성격은 지킨다.
                trailDot(px, py, Math.max(wide, gap * 0.85), g.color, armAlpha * fade * 0.6);
              }
            }
          }
        }

        // 별 하나 안에 들어왔을 때의 결과(outcome) 축. 이건 남는다 —
        // 위성은 여전히 돌고, 그 방향에는 뜻이 있다.
        if (axisAngles && axisMix > 0.01) {
          drawAxes({
            angles: axisAngles,
            lit: hovered?.startsWith("axis:") ? hovered.slice(5) : null,
            alpha: sysAlpha * axisMix,
            offRgb: "150,175,210",
            hitPrefix: "axis:",
            hitKind: "axis",
            // 다 자리잡은 뒤에만 눌린다. 건너는 중에 판정을 켜면 보이는 세기와
            // 눌리는 범위가 어긋나 "흐린데 왜 잡히지"가 된다.
            canHit: ez < 0.02 && axisMix > 0.9,
          });
        }

        // ── 별자리 선은 없다 ──
        //
        // 별을 권도형과 잇던 실선이 있었다. 중심이 하나일 때만 성립하는
        // 문법이라 은하가 여덟이 되면서 못 쓰게 됐다 — 137개가 남의 은하를
        // 가로질러 원점까지 가면 그건 그물이 아니라 얼룩이다.
        //
        // 그 선이 하던 말("이어져 있나 / 놓았나")은 이제 **어느 층에 있느냐**가
        // 한다: 원반에 있으면 진행 중, halo 안쪽이면 끝낸 것, halo 바깥이면
        // 놓은 것. 계획서가 "나선팔과 halo 이주가 대신한다"고 한 자리다.

        // ── 최근에 들어온 것 ──
        //
        // 계 층에서는 잔광이 아니라 **코로나**다. 잔광은 "지나온 길"이라 도는
        // 것에만 성립하는데 별은 안 돈다 — 궤도가 없으면 끌 길도 없다.
        // (합치기 전에도 별은 n=0 이라 이 표식이 통째로 죽어 있었다.)
        //
        // 고리 하나로 대신한다. 새 색도 새 움직임도 안 더한다 — 그 별의 색으로
        // 제 후광 바로 바깥에 두른다. 순위가 곧 지름이자 세기다.
        // 펼친 뒤(위성 층)는 경험이 실제로 도니까 거기서는 잔광 그대로다.
        for (const { el, p } of placed) {
          const rank = latestRankRef.current.get(el.id);
          if (rank == null || rank >= TRAIL_SPAN.length) continue;
          if (!onScreen(p.x, p.y, sizeOf(el) * 6 + 40)) continue;
          drawCorona(
            p.x,
            p.y,
            sizeOf(el) * STAR_GLOW * bloomOf(starLumOf(el)),
            rank,
            el.color,
            sysAlpha * dimOf(el.id) * starReveal,
          );
        }

        // ── 위성계 ──
        //
        // 별마다 그 갈래의 경험이 둘레를 돈다. **멀리서는 안 보인다.**
        //
        // 처음엔 늘 그렸는데, 별 넷에 위성계 넷이 붙으니 화면이 궤도선으로 덮여
        // 정작 별자리(이 화면이 답해야 하는 것 — 무엇이 남았나)가 안 읽혔다.
        // 축척이 이 계기판의 규칙이다: 멀리서는 계의 모양, 당기면 그 안의 것.
        // 확대하면 자연스럽게 배어 나오고, 별을 누르면 그 별 것만 크게 펼쳐진다.
        if (starSats.length > 0) {
          const satAlphaBase = sysAlpha * satReveal;
          // 보이면 눌린다. 배어 나오기만 하고 못 누르면 "왜 안 눌리지"가 되고,
          // 그렇다고 아예 안 보일 때부터 켜면 안 보이는 것이 별을 가로챈다.
          const satCanHit = ez < 0.02 && satReveal > 0.2;
          const litOutcome = hovered?.startsWith("axis:") ? hovered.slice(5) : null;

          for (const { el, p, sats } of starSats) {
            const lit = hovered === el.id || (litAxis != null && litAxis === axisKeyOf(el.mem));
            // 남의 위성계는 거의 지운다. 여기가 제일 심하게 겹치는 자리다 —
            // 위성이 수십 개씩 도는데 그게 두 계 몫이면 그냥 얼룩이 된다.
            const satAlpha = satAlphaBase * dimOf(el.id);
            // 계 화면의 위성 궤도선은 조금 흐리다. 별이 넷이면 궤도선도 넷 벌이라
            // 펼친 뒤와 같은 세기로 그리면 선이 화면을 덮는다. 다만 0.55 는
            // 너무 깎은 값이었다 — 길이 안 보이면 위성이 그냥 흩어진 점이 된다.
            for (const st of sats) {
              const onAxis = litOutcome === (st.b.outcome ?? "explore");
              drawSatOrbit(st, p.x, p.y, satAlpha * 0.8, lit || onAxis);
            }
            for (const st of sats) {
              const rank = latestRankRef.current.get(st.b.id);
              if (rank == null) continue;
              drawTrail(rank, st.th, st.size, st.color, satAlpha, (th) =>
                satPointAt(st, th, p.x, p.y),
              );
            }
            for (const st of sats) {
              drawSat(
                st,
                satAlpha,
                hovered === st.b.id ||
                  pickedRef.current?.id === st.b.id ||
                  litOutcome === (st.b.outcome ?? "explore") ||
                  lit,
              );
              // 판정 반경은 별(size+14)보다 작게 둔다. nearest 가 가까운 쪽을
              // 고르므로, 별 한가운데를 눌렀는데 옆을 지나던 위성이 잡히는 일이
              // 없어야 한다.
              // 흐려진 남의 위성은 판정에서도 뺀다. 안 보이는 것이 눌리면
              // 지금 보고 있는 계의 위성을 겨눌 때마다 엉뚱한 게 잡힌다.
              if (satCanHit && dimOf(el.id) > 0.5) {
                hit.set(st.b.id, { x: st.x, y: st.y, r: Math.max(10, st.size + 6), kind: "exp" });
              }
            }
          }
        }

        for (const { el, p } of placed) {
          if (p.y > cy) continue; // 앞쪽은 나중에
          if (foc && el.id === foc.id) continue; // 모핑 중인 대상은 따로 그린다
          if (!onScreen(p.x, p.y, sizeOf(el) * 4 + 40)) continue;
          drawStar(p.x, p.y, sizeOf(el), el.color, hovered === el.id || (litAxis != null && litAxis === axisKeyOf(el.mem)), sysAlpha * dimOf(el.id) * starLumOf(el) * starReveal, starLumOf(el), t);
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
          if (!onScreen(p.x, p.y, sizeOf(el) * 4 + 40)) continue;
          drawStar(p.x, p.y, sizeOf(el), el.color, hovered === el.id || (litAxis != null && litAxis === axisKeyOf(el.mem)), sysAlpha * dimOf(el.id) * starLumOf(el) * starReveal, starLumOf(el), t);
        }
        ctx!.restore();

        // 판정은 변환이 걸리지 않은 정지 상태에서만 받는다. hit 좌표는 변환
        // 이전 공간이라, 카메라가 움직이는 동안 등록하면 보이는 곳과 눌리는
        // 곳이 어긋난다. 전환 중에는 아무것도 못 누르는 편이 낫다.
        // 보이는 것만 눌린다. 은하만 떠 있는 배율에서 아직 안 드러난 별이
        // 판정을 가로채면, 은하를 누르려다 그 안의 별로 끌려 들어간다.
        // 은하 판정과 **같은 문턱**을 반대로 쓴다 — 둘이 겹치는 구간이 없다.
        for (const { el, p } of placed) {
          if (ez < 0.02 && starReveal >= STAR_HIT && onScreen(p.x, p.y, 60)) {
            hit.set(el.id, { x: p.x, y: p.y, r: sizeOf(el) + 14, kind: "mem" });
          }
        }
      }

      // ── 천체 하나에 붙었을 때 ──
      if (foc && ft > 0.01) {
        const refs = refsOf(foc);
        // 궤도가 안에서 바깥으로 펴지며 나타난다. 다 자란 채로 페이드인하면
        // 대상이 커지는 움직임과 어긋나 두 층이 따로 논다.
        // zoom 을 곱한다. 위성은 unit 이 아니라 제 반경 R 로 놓이는 층이라,
        // 이걸 빼먹으면 계는 확대되는데 경험 궤도만 그대로였다.
        // 원점이 (cx, cy) 라 이동(offX·offY)은 이미 따라온다.
        const R = Math.min(w, h) * 0.3 * (0.78 + 0.22 * ez) * zoom;

        const sats = layoutSats(refs, foc.sourceIds, R, cx, cy, ts);
        const satAt = (st: Sat, th: number) => satPointAt(st, th, cx, cy);

        // ── 갈래 축 ──
        // 방향을 정하는 건 outcome 이고, category 는 그 갈래 안에서 조금 틀 뿐이다.
        // 그러니 축은 결과마다 하나면 된다 — 다만 갈래 한가운데라는 임의의 자리가
        // 아니라, 그 결과에 속한 위성들이 실제로 쓰는 평면 각도의 평균에 긋는다.
        // (한 갈래의 폭이 25도 남짓이라 감싸돌 일이 없어 산술평균으로 충분하다.)
        // 축은 색을 쓰지 않는다. 여러 카테고리를 아우르는 선이라 색을 주면
        // 그중 하나를 대표하는 것처럼 읽힌다 — 색은 천체에만 둔다.
        // 라벨을 겨누고 있으면 그 결과 갈래 전체가 켜진다.
        const litOutcome = hovered?.startsWith("axis:") ? hovered.slice(5) : null;

        drawAxes({
          angles: outcomeAngles(refs),
          lit: litOutcome,
          alpha: ez,
          offRgb: "150,175,210",
          hitPrefix: "axis:",
          hitKind: "axis",
          canHit: ez > 0.98,
        });

        // 궤도선은 전부 먼저. 선은 깊이를 다툴 만큼 두껍지 않다.
        for (const st of sats) {
          drawSatOrbit(st, cx, cy, ez, litOutcome === (st.b.outcome ?? "explore"));
        }

        // 잔광은 궤도선 다음, 위성보다 먼저. 계 화면과 같은 순서다.
        for (const st of sats) {
          const rank = latestRankRef.current.get(st.b.id);
          if (rank == null) continue;
          drawTrail(rank, st.th, st.size, st.color, ez, (th) => satAt(st, th));
        }

        // 뒤쪽 위성 → 기억 → 앞쪽 위성. 이래야 앞을 지나는 경험이
        // 기억 위로 지나간다(전부 먼저 그리면 늘 기억 뒤로 숨는다).
        // 이 기억을 실제로 만든 경험에는 테를 두른다. 나머지는 같은 작업에서
        // 딸려온 것들이라, 표시가 없으면 "왜 이 기억이 생겼는가"에 답이 안 된다.
        function drawFocusSat(st: Sat) {
          const on =
            hovered === st.b.id ||
            pickedRef.current?.id === st.b.id ||
            litOutcome === (st.b.outcome ?? "explore");
          drawSat(st, ez, on);
        }

        for (const st of sats) {
          if (st.y > cy) continue;
          drawFocusSat(st);
        }

        // 두 화면을 통틀어 계속 존재하는 유일한 것. 사라졌다 나타나는 게
        // 아니라 자리를 옮기며 자란다 — 이게 모핑이다. 그래서 알파도 1 이다.
        const toR = 18 + weightOf(foc) * 1.2;
        // 출발 크기도 계가 그렸을 크기와 같아야 넘겨주는 지점이 안 튄다.
        const fromR = focEl ? focEl.size : toR;
        // 펼친 대상은 알파도 후광도 안 깎는다. 지금 화면이 이것 하나에 대한
        // 것이라 다른 것과 비교할 대상이 없고, 광도는 비교로만 읽히는 값이다.
        drawStar(
          camX,
          camY,
          fromR + (toR - fromR) * ez,
          colorOf(foc),
          hovered === foc.id,
          1,
          1,
          t,
        );

        for (const st of sats) {
          if (st.y <= cy) continue;
          drawFocusSat(st);
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
        else if (p.kind === "galaxy") {
          // 은하 하나가 분야 하나다. 별의 밝기가 말하는 것을 숫자로도 적는다.
          const g = galaxyByKey.get(found.slice(4));
          const ms = g?.members ?? [];
          const n = (st: string) => ms.filter((t) => t.status === st).length;
          // 기억이 남은 갈래. 갈래당 기억은 하나라(uq_memories_thread)
          // 이 값이 곧 이 은하의 기억 수다.
          const kept = ms.filter((t) => t.memory != null).length;
          setProbe({
            x: p.x,
            y: p.y,
            kind: "은하",
            text: tag(g?.key ?? ""),
            // **전부 갈래를 분모로 쓴다.** 예전에는 `갈래 2건 · 기억 2건 ·
            // 끝냄 0건` 처럼 넷이 나란히 섰는데, 뒤 셋은 전부 '갈래' 안에 든
            // 부분집합이었다. 나란히 선 숫자는 더해서 읽히므로 "넷이 있나"
            // 또는 "기억 개수만큼 갈래가 부풀었나" 로 읽혔다 — 읽는 사람 탓이
            // 아니라 라벨이 포함관계를 한 마디도 안 한 탓이다.
            //
            // 분수로 적으면 그 관계가 값 자체에 들어간다. 기억은 따로 있는
            // 무언가가 아니라 **갈래가 기억이 된 것**이고(갈래당 하나 —
            // uq_memories_thread), 끝냄·잊혀짐도 그 갈래들의 상태다.
            //
            //   기억/갈래  2/2   갈래 둘 중 둘에 기억이 남았다
            //   끝냄       0/2
            //   잊혀짐     0/2
            //
            // 분모가 같으니 세 줄이 같은 모집단을 말한다는 게 눈에 보이고,
            // 더해서 읽을 여지가 없다.
            //
            // **halo 는 화면에 안 쓴다.** 코드 용어가 그대로 새어 나갔었다
            // ("나머지 0건은 halo") — 범례는 이미 한국어로 "팔 밖으로 밀려난 것 =
            // 끝냈거나 놓은 일" 이라 말하는데 여기만 다른 어휘였다.
            // status 가 'abandoned' 인 것을 '잊혀짐' 이라 부르는 것도 같은 이유다 —
            // 사람이 놓은 게 아니라 손이 안 가서 밀려난 것이라(야간 배치가
            // 30일 무활동으로 넘긴다) 그쪽이 실제에 가깝다.
            rows: [
              { k: "기억/갈래", v: `${kept}/${ms.length}` },
              { k: "끝냄", v: `${n("completed")}/${ms.length}` },
              { k: "잊혀짐", v: `${n("abandoned")}/${ms.length}` },
            ],
          });
        } else if (p.kind === "axis") {
          const oc = found.slice(5);
          const inGroup = (focusRef.current?.referencedIds ?? []).filter(
            (id) => (byId.get(id)?.outcome ?? "explore") === oc,
          ).length;
          setProbe({
            x: p.x,
            y: p.y,
            kind: "축 · 이 방향의 경험",
            text: tag(oc),
            rows: [{ k: "경험", v: `${inGroup}건` }],
          });
        } else if (p.kind === "mem" || p.kind === "focus") {
          const m = orbitById.get(found);
          // 데이터가 갱신되며 이 갈래가 빠졌을 수 있다(야간 배치의 망각 마킹 등).
          // 단언으로 두면 undefined.title 에서 프레임이 죽고, try/catch 가 삼켜
          // 그 프레임의 조준점까지 통째로 안 그려진다 — 커서가 사라진다.
          if (!m) setProbe(null);
          else
            setProbe({
              x: p.x,
              y: p.y,
              // **이게 무엇인지를 먼저 말한다 — 기억이거나, 아직 갈래거나.**
              //
              // 둘 다 갈래라고 적었었다. 천체가 하나뿐이니 맞는 말이긴 한데,
              // 그러면 화면에서 제일 밝은 것들이 무엇인지를 판독값이 답하지
              // 못한다 — 밝기는 "많이 남았다"인데 이름은 여전히 "갈래"였다.
              kind: m.memory ? "기억" : "갈래",
              text: clampSentence(m.title, PROBE_TEXT_LEN),
              // **날짜와 분야가 맨 위다.** "언제, 무슨 갈래냐"가 먼저 잡히고
              // 나머지는 그 뒤에 딸리는 값이다. 반경이 이미 "시작한 지"를
              // 말하지만 그건 상대값이라 날짜를 못 읽는다.
              rows: [
                {
                  k: m.completedAt ? "기간" : "시작",
                  v: m.completedAt
                    ? `${ymd(m.occurredAt)} → ${ymd(m.completedAt)}`
                    : ymd(m.occurredAt),
                },
                { k: "분야", v: tag(m.category) },
                { k: "상태", v: tag(m.status) },
                { k: "경험", v: `${m.referencedIds.length}건` },
                // 남은 이유는 **전부** 적는다. 여럿이면 그게 곧 그 기억의
                // 성격이라, 가장 센 것 하나만 보이면 나머지를 알 길이 없다.
                // 중요도는 안 적는다 — 광도가 이미 그 값이다.
                ...(m.memory
                  ? [{ k: "남은 이유", v: m.memory.triggers.map(tag).join(" · ") }]
                  : []),
              ],
              // 처음 쓴 스킬만. 호버는 훑는 자리라 일곱 개씩 늘어놓으면 아무것도
              // 안 읽힌다. trigger 가 왜 그 값인지에 답하는 것도 신규 쪽이다.
              // (전부는 눌러서 펼친 화면에 있다.)
              skills: m.memory?.skills.filter((sk) => sk.firstTime),
            });
        } else {
          const b = byId.get(found)!;
          setProbe({
            x: p.x,
            y: p.y,
            kind: "경험",
            text: clampSentence(b.summary, PROBE_TEXT_LEN),
            // 갈래와 **같은 순서**다 — 날짜·분야가 먼저. 층을 오가며 같은
            // 자리에서 같은 것을 읽게 된다.
            rows: [
              { k: "날짜", v: formatKstYmd(new Date(b.occurredAt), ".") },
              { k: "분야", v: tag(b.category) },
              { k: "결과", v: tag(b.outcome) },
              // 60 이 기억이 되는 문턱이다. 그 앞뒤가 곧 "이게 남았나"의 근거다.
              { k: "기억 점수", v: `M${b.memoryScore}` },
            ],
          });
        }
      } else if (found && probeRef.current) {
        const p = hit.get(found)!;
        placeProbe(probeRef.current, p.x, p.y);
      }

      // 조준점은 마지막에. 무엇보다 위에 있어야 가려지지 않는다.
      drawAim();


      // 화면을 차지한 별이 바뀌었을 때만 위로 올린다.
      if (dominantIdRef.current !== dominantStateRef.current) {
        setDominantId(dominantIdRef.current);
      }
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

      // **목표를 옮긴다 — 덮어쓰지 않는다.**
      //
      // 예전에는 `offX = offXTarget = offX + dx` 였다. 목표를 지금 값으로
      // 갈아엎는 식이라, 확대가 이징되는 동안 마우스가 조금만 움직이면 휠이
      // 붙들어 둔 앵커가 통째로 날아갔다 — 확대 방향이 손과 무관해지던 원인.
      // panBy 는 둘 다 같은 양만큼 밀어서 그 관계를 안 깬다: 확대는 제 앵커를
      // 지키고 드래그는 그 위에 평행이동만 얹는다.
      panBy(dx, dy);
    }
    function onLeave() {
      mouse = null;
    }
    function zoomToBody(id: string, z: number) {
      const el = els.find((e) => e.id === id);
      if (!el) return;
      // 당기는 동안 계를 멈춘다. 별은 안 돌지만 위성은 돌고, 그 위성계를
      // 겨눈 채로 들어가는 것이라 멈춰야 착지점이 안 어긋난다.
      lockedId = id;
      zoomToPoint(el.x, el.y, z);
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
      if (p.kind === "galaxy") {
        // **한 층 내려간다.** 은하를 누르면 그 은하가 화면을 채우고 별이
        // 드러난다 — 층을 하나씩 밟고 내려가는 것이 이 지도의 규칙이다.
        const g = galaxyByKey.get(hovered.slice(4));
        if (g) zoomToPoint(g.x, g.y, fitZoom * galaxyLayer);
        setPicked(null);
      } else if (p.kind === "mem") {
        const body = orbitById.get(hovered) ?? null;
        // **펼치지 않고 당긴다.** 확대하면 이미 그 안의 경험이 나오고 축도
        // 판독값도 그것의 것으로 갈리므로, 따로 펼친 층을 만들 이유가 없다 —
        // 화면이 하나면 어디서 어디로 갔는지를 안 잃는다.
        //
        // 경험이 하나도 안 걸린 것은 당겨봐야 나올 게 없다. 그건 펼친다.
        if (body && body.referencedIds.length > 0) {
          zoomToBody(hovered, fitZoom * starLayer);
          setFocus(null);
        } else {
          setFocus(body);
        }
        setPicked(null); // 다른 것으로 옮겨가면 이전 선택은 의미가 없다
      } else if (p.kind === "focus") {
        setFocus(null);
        setPicked(null);
      } else {
        setPicked(byId.get(hovered) ?? null);
      }
    }
    resetViewRef.current = () => {
      resetCamera();
      lockedId = null;
    };

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setFocus(null);
        setPicked(null);
        // 확대도 같이 푼다. 빠져나오는 키가 하나여야 한다 — 확대해 들어간
        // 상태에서 Escape 를 눌러 포커스만 풀리면 어디로 돌아가야 할지
        // 알려주는 게 화면에 없다.
        resetCamera();
      }
    }

    /** 확대 범위. **층 수가 정한다**(4단계).
     *
     *  아래로는 우주 전체보다 조금만 더 — 그 너머는 아무것도 없는 검은 화면이다.
     *  위로는 항성계가 다 드러나는 배율(R²)에서 조금 더. 층이 셋이라 폭이
     *  R² = 900 배다. 상수로 박으면 LAYER_RATIO 를 고칠 때마다 여기도 같이
     *  고쳐야 하고, 빼먹으면 가장 아래 층에 영영 못 닿는다. */
    const zoomMin = () => fitZoom * 0.85;
    const zoomMax = () => fitZoom * starLayer * 1.6;

    function onWheel(e: WheelEvent) {
      // 페이지가 같이 스크롤되면 지도 위에서 휠을 굴릴 수가 없다.
      // passive:false 로 걸어야 preventDefault 가 먹는다.
      e.preventDefault();

      const r = canvas!.getBoundingClientRect();
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;

      // 새 손짓이 앞선 손짓의 여운을 끈다. 미끄러지는 도중에 확대하면
      // 미끄러짐은 거기서 멈추고 확대만 이어진다 — 지도라면 그게 맞다.
      //
      // 예전에는 이게 **정확성을 위해 필수**였다(관성이 매 프레임 목표를
      // 덮어썼으니까). 이제 관성도 panBy 로 목표를 옮기기만 해서, 이 줄은
      // 순전히 손맛의 문제다. 지워도 확대는 안 깨진다.
      flingX = 0;
      flingY = 0;

      // 트랙패드 핀치는 ctrlKey 가 붙은 wheel 로 온다. deltaMode 0=픽셀,
      // 1=줄, 2=페이지 — 줄/페이지 단위로 오는 마우스 휠을 픽셀로 환산하지
      // 않으면 한 칸에 화면이 통째로 튄다.
      const unitPx = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1;
      const dy = e.deltaY * unitPx * (e.ctrlKey ? 3 : 1);
      // 한 칸에 얼마나 파고드나. 층이 셋이 되면서 오갈 폭이 수천 배가 됐다 —
      // 예전 계수(0.0016, 한 칸 1.21배)로는 바닥까지 마흔 칸이라 손목이 먼저
      // 지친다. 한 칸 1.45배면 스물넷이고, 한 층 안에서의 미세 조정도 아직
      // 할 만하다. (층을 건너뛰는 건 클릭이 맡는다.)
      const next = Math.min(
        zoomMax(),
        Math.max(zoomMin(), zoomTarget * Math.exp(-dy * 0.0031)),
      );
      if (next === zoomTarget) return;

      // 경험이 안 보일 만큼 물러나면 붙잡아 둔 것을 놓는다 — 계가 다시 돈다.
      if (next < fitZoom * starLayer * REVEAL_ONSET) lockedId = null;

      if (next <= fitZoom + 1e-6) {
        // 우주 전체로 물러나면 가운데로도 같이 돌아온다. 그 배율의 뜻이
        // "전체가 보인다"라, 한쪽으로 치우쳐 있으면 뜻이 안 산다.
        resetCamera();
        zoomTarget = next;
      } else {
        // 커서 밑의 점을 붙든다. 확대·축소 **양쪽 다** 같은 규칙이다 —
        // 들어갈 때와 나올 때 축이 다르면 굴리는 손과 화면이 따로 논다.
        zoomAt(next, sx, sy);
      }
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
  }, [bodies, threads]);


  // 위에 판독값을 띄울 대상.
  //
  // 눌러서 펼친 것이 먼저다. 아무것도 안 눌렀어도 확대해서 한 별의 계 안에
  // 들어와 있으면 그 별을 띄운다 — 당긴 것 자체가 "이걸 보고 있다"는 뜻이라,
  // 거기서 한 번 더 누르라고 요구할 이유가 없다.
  const dominant = useMemo(() => dominantBody(dominantId, threads), [dominantId, threads]);
  const headline: OrbitBody | null = focus ?? dominant;

  // 중심 천체가 쓰고 있는 색이 어느 분야인지. 범례에서 이것만 테를 두른다 —
  // 중심도 위성과 같은 팔레트를 쓰는데 표시가 없으면 "가운데 저 색은 뭔가"에
  // 답이 없다. 캔버스 안의 배분과 같은 함수를 써야 색이 어긋나지 않는다.
  const focusDominantGroup = headline ? groupOfCategory(headline.category).key : null;

  // 이 갈래의 경험에 등장하는 색 묶음만. 카테고리 단위로 적으면 같은 색인
  // 항목이 둘 나란히 놓여 "왜 같은 색이 둘이지"가 된다 — 색의 범례이므로
  // 색 단위로 적는다. 정확한 카테고리는 위성을 겨누면 판독값에 나온다.
  const focusGroups = (() => {
    if (!headline) return [] as typeof CAT_GROUPS;
    const known = new Set(headline.referencedIds);
    const keys = new Set(
      bodies.filter((b) => known.has(b.id)).map((b) => groupOfCategory(b.category).key),
    );
    return CAT_GROUPS.filter((g) => keys.has(g.key));
  })();

  return (
    <div ref={wrapRef} className="relative h-full w-full">
      {/* 키보드로도 닿아야 한다. 마우스 없이는 천체를 하나도 고를 수 없었다.
          Tab 으로 지도에 들어오면 Enter/Space 로 가장 밝은 별부터 펼치고
          Escape 로 나간다 — 캔버스라 스크린리더에는 요약을 대신 읽힌다. */}
      <canvas
        ref={canvasRef}
        className="map-canvas"
        tabIndex={0}
        role="img"
        aria-label={`별 지도 — 갈래 ${threads.length}개(그중 ${threads.filter((t) => t.memory != null).length}개가 남았다), 경험 ${bodies.length}개. Enter 로 가장 밝은 별을 펼치고 Escape 로 돌아온다.`}
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
        {/* 펼치면 이름표를 안 단다. 위쪽 판독값에 이미 제목과 상태가 다 적혀
            있어서 '갈래'는 같은 말을 한 번 더 하는 것뿐이고, 그 한 단어 때문에
            화면에 어휘가 하나 더 는다. */}
        <span className="tick">{focus ? "" : centerLabel}</span>
        {!focus && threads.length === 0 && (
          <div className="tick mt-3 opacity-60">아직 계에 아무것도 없다</div>
        )}
      </div>

      {probe && (
        <div
          ref={probeRef}
          className="probe"
          style={{ transform: `translate(${probe.x + 18}px, ${probe.y - 12}px)` }}
        >
          {/* 무엇인가 → 이름 → 값들. 위에서 아래로 좁혀 읽는다. */}
          <div className="readout mb-1.5 text-[11.5px] tracking-[0.16em] text-lum-3">
            {probe.kind}
          </div>
          <div className="font-sans text-[14.5px] leading-snug text-lum-0">{probe.text}</div>

          {/* 처음 쓴 스킬. 값들보다 위에 둔다 — "왜 남았나"에 답하는 것이라
              나머지 판독값보다 먼저 읽혀야 한다. */}
          {probe.skills && probe.skills.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
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
          )}

          {/* ── 값들 ──
              예전에는 이 전부가 한 줄에 `·` 로 이어져 있었다. 값이 죄다 같은
              모양의 대문자 토큰이라 어느 게 분야고 어느 게 상태인지 분간이
              안 됐다. 라벨을 왼쪽에 세우고 값을 오른쪽에 맞춘다 — 라벨 열이
              한 줄로 서니 눈이 세로로 훑고, 값 열도 자리가 고정된다. */}
          {probe.rows.length > 0 && (
            <>
              <div className="my-2 h-px" style={{ background: "rgba(160,185,220,0.16)" }} />
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                {probe.rows.map((r) => (
                  <Fragment key={r.k}>
                    <span className="readout text-[11.5px] text-lum-4">{r.k}</span>
                    <span className="readout text-[12px] text-lum-1">{r.v}</span>
                  </Fragment>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* 펼친 별, 또는 확대해서 화면을 채운 별 */}
      {headline && (
        <div className="pointer-events-none absolute left-1/2 top-16 w-full max-w-lg -translate-x-1/2 px-6 text-center">
          {/* key 를 대상 id 로 둔다. 확대하며 다른 별로 넘어갈 때 .settle 이
              다시 돌아야 "바뀌었다"가 읽힌다 — 같은 노드에 글자만 갈아끼우면
              제목이 소리 없이 뒤바뀐다. */}
          <div className="settle" key={headline.id}>
            <div className="tick mb-2">
              {`${tag(headline.status)} · 경험 ${headline.referencedIds.length}건 · ${ymd(headline.occurredAt)} 시작${
                headline.completedAt ? ` → ${ymd(headline.completedAt)} 완결` : ""
              }`}
              {headline.memory && (
                // 남았다면 그건 기억이다. 판독값(호버)과 **같은 단어**를 쓴다 —
                // 겨눴을 때와 들어왔을 때가 다른 이름으로 불리면 안 된다.
                // 광도가 "얼마나"를 말하고 이 줄이 "무엇 때문에"를 말한다.
                <div className="mt-1 text-lum-2">
                  기억 · {headline.memory.triggers.map(tag).join(" · ")}
                </div>
              )}
            </div>
            <h2 className="text-[18px] font-medium text-lum-0">{headline.title}</h2>

            {/* 완결은 사람만 안다. 브라우징 기록은 "무엇을 했나"를 말하는데
                완결은 "더 할 게 없다"는 판단이라 기록에 흔적이 없다 — 역대 LLM
                호출 75회 중 completed=true 가 한 번도 없었다.
                pointer-events-none 인 부모 안이라 이 버튼만 다시 켠다.

                **눌러서 펼친 것이 아니라 당겨서 들어온 것에도 뜬다.** 별을
                누르면 이제 펼치는 게 아니라 확대되기 때문이다 — focus 로만
                묶어두면 완결 버튼에 영영 닿을 수 없다.
                스쳐 지나가다 떠도 상관없다. 이 버튼은 또 한 번 눌러야 한다. */}
            {headline.status === "active" && onComplete && (
              <button
                type="button"
                disabled={completing}
                onClick={() => {
                  const id = headline.id;
                  setCompleting(true);
                  // 끝내고 나면 이 갈래는 진행 중이 아니다. 보고 있던 자리를
                  // 닫아 계 전체로 돌려보낸다 — 남아 있으면 방금 누른 버튼이
                  // 사라진 자리를 보게 된다.
                  onComplete(id).finally(() => {
                    setCompleting(false);
                    setFocus(null);
                    resetViewRef.current?.();
                  });
                }}
                className="readout pointer-events-auto mt-4 rounded-sm border border-[rgba(99,230,210,0.3)] px-3 py-1.5 text-[12.5px] text-lum-1 transition-colors hover:border-[rgba(99,230,210,0.6)] hover:text-lum-0 disabled:opacity-40"
              >
                {completing ? "…" : "끝"}
              </button>
            )}

            {/* 이 갈래에 남은 기억의 근거. 제목 바로 아래에 둔다 —
                무엇이 처음이었나가 먼저, 무슨 일이 있었나가 그다음이다. */}
            {headline.memory && headline.memory.skills.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center justify-center gap-x-2 gap-y-1.5">
                {headline.memory.skills.map((sk) => (
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
