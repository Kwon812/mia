// ============================================================
// 절차 추출 — 반복되는 조작 열을 찾는다.
//
// 경험·갈래·기억과 **독립이다.** 해석 층 위가 아니라 옆이다.
//
//   관측 → 세션(compressed_log)
//           ├─ 해석 → 경험 → 갈래 → 기억    LLM 판정 · 주관적 · 검증 불가
//           └─ 절차 → 스킬                   반복 매칭 · 기계적 · 돌려보면 안다
//
// 붙이지 않는 이유가 셋이다. 갈래 부착이 실측 F1 54% 라 그 오류를 물려받게
// 되고, 절차는 몇 주에 걸친 세션을 가로질러야 하는데 갈래는 그걸 주제별로
// 잘라놓으며, 무엇보다 검증 방식이 다르다 — 갈래가 잘 묶였는지는 확인할
// 방법이 없어서 F1 이니 순도니 만들어 재야 했지만 절차는 돌려보면 안다.
//
// 여기는 **전부 코드다. LLM 을 부르지 않는다.** 이름 짓기와 SKILL.md 산문만
// 나중에 LLM 이 맡고, 그것도 사람이 승인한 것에만 돈다.
// ============================================================

/** 확장이 남긴 조작 하나 (apps/extension/src/session/types.ts 의 ActionRecord). */
export type Act = {
  t: string;
  label?: string;
  sel?: string;
  mut?: true;
  /** 직전 조작으로부터 흐른 초 */
  dt?: number;
};

export type ProcSession = {
  id: string;
  startedAt: Date;
  compressedLog: unknown;
};

/** 열쇠가 붙은 조작 하나. 도메인은 구간에서 물려받는다. */
export type Step = {
  key: string;
  domain: string;
  /** 태그명. 라벨도 셀렉터도 없을 때 화면이 기댈 마지막 이름이다. */
  tag: string;
  label?: string;
  sel?: string;
  mut: boolean;
  dt: number;
  isInput: boolean;
};

// ── 문턱들 ──────────────────────────────────────────────
// 전부 실데이터를 보고 정할 값이다. 지금 값은 출발점일 뿐이고, 추출 결과를
// 눈으로 본 뒤에 옮긴다 — 감으로 정한 문턱은 감으로 정한 가설과 같다.

/** 절차로 볼 최소 길이. 두 단계짜리는 자동화해도 아낄 게 없다. */
const MIN_LEN = 3;
/** 최대 길이. 이보다 길면 두 절차가 붙어 뽑힌 것에 가깝다. */
const MAX_LEN = 10;
/** 이 초 이상 비면 다른 일로 넘어간 것으로 본다. 절차 안에서는 안 이어진다. */
const BREAK_SEC = 300;
/** 후보로 올릴 최소 반복. 사람이 답하면 자동 확신이 필요 없으므로 2다. */
const MIN_RUNS = 2;

/**
 * 절차의 이음매가 되지 않는 조작.
 *
 * 알림 배너를 닫거나 실수로 누른 뒤로가기 같은 것들이다. 이게 섞이면 같은
 * 절차가 매번 다른 열로 보여서 반복이 안 잡힌다. n-gram 은 연속을 보기
 * 때문에 중간에 하나만 끼어도 끊긴다.
 */
const NOISE = /^(닫기|취소|뒤로|다음|이전|더보기|알림|close|cancel|back|next|prev|dismiss|skip)$/i;

/** 라벨에서 그때그때 달라지는 부분을 지운다 — 매달 하는 일이 매번 새 절차로 보이지 않게. */
function normalizeLabel(s: string): string {
  return s
    .replace(/\d{4}-\d{2}-\d{2}/g, '<date>')
    .replace(/\d{4}[./]\d{1,2}([./]\d{1,2})?/g, '<date>')
    .replace(/\d+/g, 'N')
    .trim()
    .slice(0, 40);
}

/**
 * 비교에 쓸 열쇠. 두 실행이 같은 절차인지는 이걸로 가른다.
 *
 * 안정 셀렉터가 있으면 그게 가장 정확하다 — 화면 문구가 바뀌어도 같은 것을
 * 가리킨다. 없으면 도메인·태그·정규화된 라벨로 떨어진다.
 */
function keyOf(a: Act, domain: string): string {
  if (a.sel) return `${domain}|${a.sel}`;
  const label = a.label ? normalizeLabel(a.label) : '';
  return `${domain}|${a.t}|${label}`;
}

/** 입력 조작인가 — 절차에서는 이 자리가 곧 매개변수다. */
function isInputAct(a: Act): boolean {
  return a.t === 'input' || a.t === 'select' || a.t === 'textarea';
}

/** 세션 하나를 조작 열로 편다. 구간의 도메인을 조작에 물려준다. */
export function stepsOf(compressedLog: unknown): Step[] {
  const log = compressedLog as { segments?: { domain?: string; acts?: Act[] }[] } | null;
  if (!log || !Array.isArray(log.segments)) return [];

  const out: Step[] = [];
  for (const seg of log.segments) {
    const domain = seg?.domain ?? 'etc';
    for (const a of seg?.acts ?? []) {
      if (!a || typeof a.t !== 'string') continue;
      if (a.label && NOISE.test(a.label.trim())) continue;
      out.push({
        key: keyOf(a, domain),
        domain,
        tag: a.t,
        label: a.label,
        sel: a.sel,
        mut: a.mut === true,
        dt: typeof a.dt === 'number' ? a.dt : 0,
        isInput: isInputAct(a),
      });
    }
  }
  return out;
}

export type Candidate = {
  /** 열쇠들을 이은 것. 같은 절차면 같다. */
  signature: string;
  /** 대표 단계 — 첫 실행의 것. 화면에 그린다. */
  steps: Step[];
  /** 몇 번 나타났나 (서로 다른 세션 수) */
  runs: number;
  /** 언제 처음·마지막으로 했나 */
  firstAt: Date;
  lastAt: Date;
  /** 매번 걸린 시간(초) 중앙값. 자동화할 값어치의 근거다. */
  medianSec: number;
  /** 무언가를 바꾸는 조작이 있나 — 자동 승격 가능 여부의 기준이다 */
  mutates: boolean;
  /** 매개변수 자리 (steps 의 인덱스) */
  paramIdx: number[];
  /** 순위 점수 */
  score: number;
};

/**
 * 반복되는 조작 열을 찾는다.
 *
 * 세션이 여러 작업을 담고 있어도 미리 자르지 않는다. **경계는 반복이 준다** —
 * 절차와 딴짓 사이의 이음매는 매번 다른 자리라 두 번 나타날 일이 없고,
 * 절차 안쪽만 살아남는다. 갈래에서는 못 쓰는 방법이다(경험은 한 번뿐이라
 * 비교 대상이 없다). 절차는 반복이 전제라 쓸 수 있다.
 *
 * n-gram 을 해시로 센다. 세션 쌍마다 LCS 를 돌리면 1년 1,460세션에 쌍이
 * 100만 개라 못 돌린다. 조각을 버킷에 담으면 전체 조작 수에 선형이다.
 */
export function findProcedures(
  sessions: ProcSession[],
  minRuns = MIN_RUNS,
  /** 이보다 긴 열은 안 만든다. 한 번뿐인 것을 훑을 때는 짧게 잘라야 한다 —
   *  극대만 남기는 규칙 탓에, 상한까지 길게 만들면 그 길이짜리만 살아남고
   *  정작 읽을 만한 짧은 열이 전부 그 안에 먹힌다. */
  maxLen = MAX_LEN,
): Candidate[] {
  type Bucket = {
    steps: Step[];
    sessions: Set<string>;
    durations: number[];
    firstAt: Date;
    lastAt: Date;
  };
  const buckets = new Map<string, Bucket>();

  for (const s of sessions) {
    const steps = stepsOf(s.compressedLog);
    if (steps.length < MIN_LEN) continue;

    for (let i = 0; i < steps.length; i++) {
      for (let k = MIN_LEN; k <= maxLen && i + k <= steps.length; k++) {
        const run = steps.slice(i, i + k);
        // 긴 공백을 건너뛰는 조각은 절차가 아니다 — 그 사이에 다른 일을 했다.
        // 첫 단계의 dt 는 "이 절차를 시작하기까지"라 여기 안 든다.
        if (run.slice(1).some((x) => x.dt >= BREAK_SEC)) break;
        const sig = run.map((x) => x.key).join(' → ');
        let b = buckets.get(sig);
        if (!b) {
          b = {
            steps: run,
            sessions: new Set(),
            durations: [],
            firstAt: s.startedAt,
            lastAt: s.startedAt,
          };
          buckets.set(sig, b);
        }
        // 한 세션 안에서 같은 절차를 두 번 해도 세션은 하나로 센다 — 반복은
        // "다시 하는 일인가"를 묻는 것이라 같은 자리에서의 되풀이와 다르다.
        b.sessions.add(s.id);
        b.durations.push(run.slice(1).reduce((t, x) => t + x.dt, 0));
        if (s.startedAt < b.firstAt) b.firstAt = s.startedAt;
        if (s.startedAt > b.lastAt) b.lastAt = s.startedAt;
      }
    }
  }

  const survived = [...buckets.entries()].filter(([, b]) => b.sessions.size >= minRuns);

  // 긴 것이 살아남으면 그 안에 든 짧은 것은 버린다. 「테이블 → 필터」와
  // 「테이블 → 필터 → 내보내기」가 둘 다 뜨면 사람이 같은 것을 두 번 본다.
  const bySig = new Set(survived.map(([sig]) => sig));
  const maximal = survived.filter(([sig, b]) => {
    for (const other of bySig) {
      if (other === sig) continue;
      if (other.length > sig.length && other.includes(sig)) {
        // 더 긴 것이 같은 횟수만큼 반복됐다면 짧은 쪽은 그 일부일 뿐이다.
        const ob = buckets.get(other)!;
        if (ob.sessions.size >= b.sessions.size) return false;
      }
    }
    return true;
  });

  const out: Candidate[] = [];
  for (const [signature, b] of maximal) {
    const mutates = b.steps.some((x) => x.mut);
    const paramIdx = b.steps.map((x, i) => (x.isInput ? i : -1)).filter((i) => i >= 0);
    const sorted = [...b.durations].sort((x, y) => x - y);
    const medianSec = sorted[Math.floor(sorted.length / 2)] ?? 0;

    out.push({
      signature,
      steps: b.steps,
      runs: b.sessions.size,
      firstAt: b.firstAt,
      lastAt: b.lastAt,
      medianSec,
      mutates,
      paramIdx,
      score: rank({ runs: b.sessions.size, len: b.steps.length, mutates, medianSec }),
    });
  }

  return out.sort((a, b) => b.score - a.score);
}

/**
 * 무엇이 쌓이고 있나.
 *
 * 후보가 0개일 때 "없다" 만 말하면 사람은 이게 도는 중인지 고장인지 모른다.
 * 한 번만 나온 열을 보여주면 **한 번 더 하면 절차가 된다**가 눈에 들어오고,
 * 무엇이 걸러졌는지 보이면 문턱이 맞는지도 스스로 판단할 수 있다.
 */
export type Digest = {
  sessions: number;
  /** 조작이 있는 세션. 나머지는 관측 계층을 붙이기 전 것이다. */
  withActs: number;
  acts: number;
  /** 어디서 얼마나 — 무엇을 주로 하는지가 여기 드러난다. */
  byDomain: { domain: string; n: number }[];
  /** 아직 한 번뿐인 열. 되풀이하면 후보가 된다. */
  once: Candidate[];
  /** 오가기만 하고 아무것도 안 바꾼 것 */
  oscillations: number;
  /** 세션마다 무엇을 했나 — 도메인이 바뀌는 자리로 끊어 읽는다. */
  flows: { at: Date; legs: { domain: string; n: number; sample: string }[] }[];
};

/** 한 세션의 흐름 — 도메인이 바뀔 때마다 한 토막. */
function flowOf(steps: Step[]): { domain: string; n: number; sample: string }[] {
  const legs: { domain: string; n: number; sample: string }[] = [];
  for (const s of steps) {
    const last = legs[legs.length - 1];
    if (last && last.domain === s.domain) {
      last.n += 1;
      continue;
    }
    legs.push({ domain: s.domain, n: 1, sample: (s.label ?? s.sel ?? s.tag).slice(0, 36) });
  }
  return legs;
}

export function digest(sessions: ProcSession[], found: Candidate[]): Digest {
  const byDomain = new Map<string, number>();
  let acts = 0;
  let withActs = 0;
  for (const s of sessions) {
    const st = stepsOf(s.compressedLog);
    if (st.length > 0) withActs += 1;
    acts += st.length;
    for (const x of st) byDomain.set(x.domain, (byDomain.get(x.domain) ?? 0) + 1);
  }

  // 한 번만 나온 열. 문턱을 1 로 낮춰 다시 찾고, 이미 후보가 된 것은 뺀다.
  const known = new Set(found.map((c) => c.signature));
  // **짧게 잘라 찾는다.** 상한까지 길게 만들면 극대만 남기는 규칙 탓에
  // 열 단계짜리 덩어리만 살아남는다 — 사람이 읽고 "아 저거" 할 크기가 아니고,
  // 되풀이될 만한 것은 대개 짧다.
  const all1 = findProcedures(sessions, 1, 4);
  const cands = all1
    .filter((c) => !known.has(c.signature) && !looksLikeOscillation(c))
    // 같은 곳을 되풀이해 누른 것은 절차가 아니라 손버릇이다.
    .filter((c) => new Set(c.steps.map((s) => s.key)).size >= 3)
    .sort((a, b) => b.score - a.score);

  // **겹치는 것을 합친다.** 한 번뿐인 열은 같은 자리의 슬라이딩 조각이
  // 수십 개씩 나온다 — 실측에서 열 개가 전부 같은 구간의 다른 창이었다.
  // 사람에게는 하나만 보여주면 된다.
  const once: Candidate[] = [];
  const taken: Set<string>[] = [];
  for (const c of cands) {
    if (once.length >= 5) break;
    const keys = new Set(c.steps.map((s) => s.key));
    const overlaps = taken.some((t) => {
      let hit = 0;
      for (const k of keys) if (t.has(k)) hit += 1;
      return hit / keys.size > 0.4;
    });
    if (overlaps) continue;
    taken.push(keys);
    once.push(c);
  }

  return {
    sessions: sessions.length,
    withActs,
    acts,
    byDomain: [...byDomain.entries()]
      .map(([domain, n]) => ({ domain, n }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 8),
    once,
    oscillations: findProcedures(sessions, 1).filter(looksLikeOscillation).length,
    // 무엇을 했나. 절차가 아직 안 잡혀도 관측이 도는 것은 여기서 보인다.
    flows: sessions
      .map((s) => ({ at: s.startedAt, steps: stepsOf(s.compressedLog) }))
      .filter((x) => x.steps.length > 0)
      .slice(0, 5)
      .map((x) => ({ at: x.at, legs: flowOf(x.steps).slice(0, 10) })),
  };
}

/**
 * 순위 — 무엇부터 물어볼까.
 *
 * 반복이 많고, 단계가 많고, 실제로 뭔가를 바꾸고, 매번 오래 걸릴수록 위다.
 * 「네 번 반복」은 사실이고 「매번 3분 20초」가 이유다 — 사람이 승인을 결정할
 * 때 실제로 보는 것은 뒤쪽이다.
 */
function rank(x: { runs: number; len: number; mutates: boolean; medianSec: number }): number {
  const time = Math.min(600, x.medianSec) / 60; // 분. 10분에서 자른다
  return x.runs * x.len * (x.mutates ? 2 : 1) * (1 + time);
}

/**
 * 진동인가 — 「A → B → A」처럼 오간 것.
 *
 * 실데이터에서 `localhost → supabase.com → localhost` 가 7세션에 나왔지만
 * 절차가 아니었다. 코드 고치고 DB 확인하고 다시 코드로 간 것이고, **아무것도
 * 바뀌지 않았다.** 종결 조작(mut)이 없다는 것이 그 표시다.
 *
 * 도메인 수준에서 첫 곳과 끝 곳이 같고 바꾼 게 없으면 진동으로 본다.
 */
export function looksLikeOscillation(c: Candidate): boolean {
  if (c.mutates) return false;
  const first = c.steps[0]?.domain;
  const last = c.steps[c.steps.length - 1]?.domain;
  return first === last;
}
