// ============================================================
// 화면 대신 API 로 값을 가져온다.
//
// DOM 을 긁는 것은 읽기에 나쁜 도구다. 셀렉터가 깨지고, 배경 탭은 렌더링이
// 억제되고, 값은 늦게 채워진다 — 하루를 그것만 고쳤는데 고칠수록 다음 게
// 나왔다. 사이트가 UI 를 한 번 바꾸면 처음부터다.
//
// 그래서 **DOM 은 "무엇을 원하는지 짚는 도구"로만 쓰고 실행은 API 로 한다.**
//
// ── 집은 값이 API 의 어느 필드인지 어떻게 아나 ──
//
// 맞춰본다. 사람이 화면에서 "$1.88" 을 집는 순간 그 도메인의 API 를 호출해
// 응답을 전부 펼치고, 같은 값을 가진 필드를 찾는다.
//
//   집은 값   "$1.88"
//   응답      { data: [ { amount: { value: 1.88 } } ] }
//   찾음      data[0].amount.value
//
// 이게 다리다. 그리고 **집는 순간 판정된다** — 값을 못 찾으면 그 자리에서
// "이건 API 로 못 가져온다"고 말한다. 나중에 돌려보고 알게 되는 게 아니다.
//
// 등록되지 않은 도메인은 API 를 못 쓴다. 자체 프로젝트나 관리자 페이지가
// 그렇다. 그때는 그렇다고 말한다 — 있는 척하지 않는다.
// ============================================================

/** 두드려볼 곳 하나. 값 하나를 찾으려고 여러 군데를 본다. */
export interface Probe {
  path: string;
  /** 오늘 기준 며칠 치를 볼까 — 기간을 요구하는 API 에만 쓴다. */
  days?: number;
}

export interface ApiService {
  /** 사람에게 보이는 이름 */
  label: string;
  /** 어느 화면이 이 서비스인가 */
  domains: string[];
  base: string;
  /** 키를 어디서 받나 — 화면이 그대로 안내한다 */
  keyHint: string;
  keyUrl: string;
  probes: Probe[];
}

/**
 * 아는 서비스들.
 *
 * 경로와 응답 모양은 각 서비스 문서에 매인 값이라 바뀔 수 있다. 여기 한
 * 곳에만 적어두는 이유가 그것이다 — 틀리면 이 표만 고치면 된다.
 */
export const API_SERVICES: Record<string, ApiService> = {
  render: {
    label: 'Render',
    domains: ['dashboard.render.com'],
    base: 'https://api.render.com/v1',
    keyHint: 'Account Settings → API Keys 에서 발급',
    keyUrl: 'https://dashboard.render.com/u/settings#api-keys',
    probes: [{ path: '/services?limit=50' }, { path: '/services?limit=20&includePreviews=false' }],
  },
  openai: {
    label: 'OpenAI',
    domains: ['platform.openai.com'],
    base: 'https://api.openai.com/v1',
    // 사용량·비용은 일반 API 키로 안 되고 조직 관리자 키가 따로 필요하다.
    keyHint: '조직 설정 → Admin keys (일반 API 키로는 사용량이 안 보인다)',
    keyUrl: 'https://platform.openai.com/settings/organization/admin-keys',
    probes: [
      { path: '/organization/costs', days: 30 },
      { path: '/organization/usage/completions', days: 30 },
    ],
  },
  vercel: {
    label: 'Vercel',
    domains: ['vercel.com'],
    base: 'https://api.vercel.com',
    keyHint: 'Account Settings → Tokens 에서 발급',
    keyUrl: 'https://vercel.com/account/tokens',
    probes: [{ path: '/v6/deployments?limit=20' }],
  },
  supabase: {
    label: 'Supabase',
    domains: ['supabase.com'],
    base: 'https://api.supabase.com/v1',
    keyHint: 'Account → Access Tokens 에서 발급',
    keyUrl: 'https://supabase.com/dashboard/account/tokens',
    probes: [{ path: '/projects' }],
  },
};

/** 이 화면이 아는 서비스인가. 포트는 떼고 본다. */
export function serviceFor(domain: string): { id: string; svc: ApiService } | null {
  const host = domain.split(':')[0];
  for (const [id, svc] of Object.entries(API_SERVICES)) {
    if (svc.domains.some((d) => host === d || host.endsWith(`.${d}`))) return { id, svc };
  }
  return null;
}

/** 응답을 펼쳐 `경로 → 값` 으로 만든다. 배열은 인덱스로 짚는다. */
export function flatten(v: unknown, prefix = '', out: Record<string, unknown> = {}): Record<string, unknown> {
  if (v === null || typeof v !== 'object') {
    if (prefix) out[prefix] = v;
    return out;
  }
  if (Array.isArray(v)) {
    // 앞쪽만 본다. 목록이 길어도 사람이 화면에서 보는 것은 위쪽이다.
    v.slice(0, 20).forEach((x, i) => flatten(x, `${prefix}[${i}]`, out));
    return out;
  }
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    flatten(x, prefix ? `${prefix}.${k}` : k, out);
  }
  return out;
}

/**
 * 화면에서 집은 글자에서 숫자를 뽑는다. "$1.88 / $3.00" → 1.88
 *
 * **날짜·시각은 숫자로 안 본다.** 실측에서 Render 로그("Aug 10 10:35:03 AM
 * …")를 집었더니 10 이 뽑혔고, 하필 분석 스크립트 설정의 sampleRate 가
 * 10 이라 거기 걸렸다 — 로그를 읽으려던 자리가 엉뚱한 API 를 가리키게 됐다.
 *
 * 날짜에서 뽑은 숫자는 그 값을 대표하지 않는다. 우연히 맞을 뿐이다.
 */
export function numberIn(text: string): number | null {
  const t = text.trim();
  // 날짜·시각으로 시작하거나 그것이 대부분인 글자.
  if (
    /^\s*(mon|tue|wed|thu|fri|sat|sun|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(t) ||
    /^\s*\d{4}[-./]\d{1,2}[-./]\d{1,2}/.test(t) ||
    /^\s*\d{1,2}:\d{2}/.test(t) ||
    /\d{1,2}:\d{2}:\d{2}/.test(t.slice(0, 40))
  ) {
    return null;
  }
  const m = t.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/**
 * 못 찾았을 때 **가까운 값들**을 보여준다.
 *
 * "그 값이 없어" 만으로는 다음에 뭘 할지 모른다. 응답에 1.8823 이 있는데
 * 화면이 1.88 로 적은 것이라면 사람은 보자마자 안다 — 자릿수 문제인지,
 * 애초에 다른 데서 오는 값인지가 눈에 들어온다.
 */
export function nearbyNumbers(flat: Record<string, unknown>, want: number, n = 5): string[] {
  const rows: { path: string; v: number; d: number }[] = [];
  for (const [path, v] of Object.entries(flat)) {
    if (typeof v !== 'number' || v === 0) continue;
    // 자릿수가 비슷한 것만. 1.88 을 찾는데 1200000 을 보여줘야 소용없다.
    const ratio = Math.abs(v) / Math.abs(want || 1);
    if (ratio > 2000 || ratio < 0.0005) continue;
    rows.push({ path, v, d: Math.abs(v - want) });
  }
  return rows
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map((r) => `${r.path}=${r.v}`);
}

export interface Match {
  path: string;
  value: unknown;
  /** 어느 probe 에서 나왔나 */
  probe: string;
  /** 얼마나 확실한가 — 여럿이면 위에서부터 고른다 */
  how: 'number' | 'text' | 'sum' | 'count' | 'scaled' | 'rounded';
}

/**
 * 화면의 숫자와 응답의 숫자가 같은 것인가.
 *
 * 그대로 비교하면 안 된다. 화면은 사람이 읽으라고 다듬은 값이고 응답은
 * 기계가 쓰는 값이라, 같은 것이 다르게 적힌다.
 *
 *   $1.88  ↔  188        돈은 대개 최소 단위(센트)로 저장된다
 *   $1.88  ↔  1.8823     화면이 두 자리로 반올림했다
 *   1.2K   ↔  1200       화면이 줄여 적었다 (이건 numberIn 이 못 읽어 못 맞춘다)
 *
 * 배수를 인정하면 우연히 맞을 여지도 함께 커진다. 그래서 어떻게 맞았는지를
 * 남겨 순위를 낮춘다 — 그대로 맞은 것이 언제나 먼저다.
 */
export function sameNumber(want: number, v: number): Match['how'] | null {
  if (want === 0) return null; // 0 은 응답에 널려 있어 우연히 맞는다
  if (Math.abs(v - want) < 1e-9) return 'number';
  // 화면이 두 자리로 반올림했나. 1.8823 → 1.88
  if (Math.abs(Math.round(v * 100) / 100 - want) < 1e-9) return 'rounded';
  // 최소 단위로 저장됐나. 1.88 ↔ 188, 1880 (센트·밀)
  for (const k of [100, 1000, 1e6]) {
    if (Math.abs(v - want * k) < 1e-6) return 'scaled';
    if (Math.abs(v * k - want) < 1e-6) return 'scaled';
  }
  return null;
}

/**
 * 같은 자리의 값들을 묶어 합과 개수를 낸다.
 *
 * **화면의 값은 API 필드와 1:1 이 아니다.** 대시보드가 보여주는 숫자는 대개
 * 여러 항목을 더한 것이다 — "Total tokens 0" 은 응답 어딘가에 0 이 박혀
 * 있는 게 아니라, 항목들을 더했더니 0 이거나 애초에 항목이 없는 것이다.
 * 실측에서 API 를 12개 잡고도 값을 못 찾은 이유가 이것이었다.
 *
 * `data[0].x`, `data[1].x` 를 `data[*].x` 로 묶어 합과 개수를 만든다.
 * 개수도 세는 이유는 "N건" 꼴이 대시보드에 흔하기 때문이다.
 */
export function groupSums(flat: Record<string, unknown>): Record<string, { sum: number; count: number }> {
  const g: Record<string, { sum: number; count: number }> = {};
  for (const [path, v] of Object.entries(flat)) {
    const star = path.replace(/\[\d+\]/g, '[*]');
    if (star === path) continue; // 배열 안이 아니면 묶을 게 없다
    if (!g[star]) g[star] = { sum: 0, count: 0 };
    g[star].count += 1;
    if (typeof v === 'number') g[star].sum += v;
  }
  return g;
}

/**
 * 집은 값이 응답 어디에 있는지 찾는다.
 *
 * 숫자를 먼저 본다. 화면의 "$1.88" 과 응답의 1.88 은 표기가 달라도 같은
 * 값이고, 그 일치는 우연이기 어렵다. 문자열은 그다음이다 — "Live" 같은
 * 상태값이 거기 걸린다.
 *
 * 못 찾으면 빈 배열이고, 그것이 곧 "이 값은 API 로 못 가져온다"는 답이다.
 */
export function findValue(flat: Record<string, unknown>, picked: string, probe: string): Match[] {
  const out: Match[] = [];
  const want = picked.trim();
  const wantNum = numberIn(want);

  // 합계와 개수도 본다. 대시보드 숫자는 대개 이쪽이다.
  //
  // **0 은 안 맞춘다.** 빈 배열의 합도 0 이고 안 쓴 항목도 0 이라, 우연히
  // 맞는 자리가 응답마다 수십 개씩 나온다. 그중 아무거나 골라 저장하면
  // 다음에 값이 생겼을 때 엉뚱한 자리를 읽는다 — 틀렸는지도 모른 채.
  // 0 인 값은 화면에서 읽는 편이 낫다.
  if (wantNum !== null && wantNum !== 0) {
    for (const [star, { sum, count }] of Object.entries(groupSums(flat))) {
      const how = sameNumber(wantNum, sum);
      if (how) out.push({ path: star, value: sum, probe, how: how === 'number' ? 'sum' : how });
      else if (count === wantNum) out.push({ path: `${star}#count`, value: count, probe, how: 'count' });
    }
  }

  for (const [path, v] of Object.entries(flat)) {
    if (v === null || v === undefined) continue;

    if (wantNum !== null && typeof v === 'number') {
      const how = sameNumber(wantNum, v);
      if (how) out.push({ path, value: v, probe, how });
      continue;
    }
    if (typeof v === 'string' && v.length > 0 && v.length < 80) {
      const a = v.trim().toLowerCase();
      const b = want.toLowerCase();
      if (a === b || (b.includes(a) && a.length >= 3)) {
        out.push({ path, value: v, probe, how: 'text' });
      }
    }
  }
  // 그대로 박힌 숫자가 가장 믿을 만하고, 그다음이 합계다. 경로가 짧을수록
  // 바깥쪽이라 안정적이다.
  // 그대로 맞은 것이 먼저다. 배수·반올림은 우연히 맞을 여지가 더 크다.
  const rank = { number: 0, rounded: 1, sum: 2, scaled: 3, count: 4, text: 5 } as const;
  return out.sort((x, y) =>
    rank[x.how] === rank[y.how] ? x.path.length - y.path.length : rank[x.how] - rank[y.how],
  );
}

/** 저장된 경로로 값을 꺼낸다. `data[0].amount.value` 꼴. */
export function readPath(obj: unknown, path: string): unknown {
  // `a[*].b` 는 그 자리의 값을 전부 더한다. `a[*].b#count` 는 개수를 센다.
  // 화면이 보여주는 숫자가 합계일 때 쓰는 길이다.
  if (path.includes('[*]')) {
    const wantCount = path.endsWith('#count');
    const p = wantCount ? path.slice(0, -6) : path;
    const flat = flatten(obj);
    let sum = 0;
    let count = 0;
    for (const [k, v] of Object.entries(flat)) {
      if (k.replace(/\[\d+\]/g, '[*]') !== p) continue;
      count += 1;
      if (typeof v === 'number') sum += v;
    }
    return wantCount ? count : sum;
  }

  let cur: unknown = obj;
  for (const seg of path.split('.')) {
    const m = seg.match(/^([^[]*)((\[\d+\])*)$/);
    if (!m) return undefined;
    if (m[1]) {
      if (cur === null || typeof cur !== 'object') return undefined;
      cur = (cur as Record<string, unknown>)[m[1]];
    }
    for (const idx of m[2].match(/\d+/g) ?? []) {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[Number(idx)];
    }
  }
  return cur;
}

/** 기간을 요구하는 API 를 위해 시각을 채운다. */
export function urlFor(svc: ApiService, probe: Probe, now: number): string {
  const url = new URL(svc.base + probe.path);
  if (probe.days) {
    const start = Math.floor((now - probe.days * 24 * 3600 * 1000) / 1000);
    url.searchParams.set('start_time', String(start));
  }
  return url.toString();
}
