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

/** 화면에서 집은 글자에서 숫자를 뽑는다. "$1.88 / $3.00" → 1.88 */
function numberIn(text: string): number | null {
  const m = text.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

export interface Match {
  path: string;
  value: unknown;
  /** 어느 probe 에서 나왔나 */
  probe: string;
  /** 얼마나 확실한가 — 여럿이면 위에서부터 고른다 */
  how: 'number' | 'text';
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

  for (const [path, v] of Object.entries(flat)) {
    if (v === null || v === undefined) continue;

    if (wantNum !== null && typeof v === 'number') {
      // 소수점 표기가 다를 수 있다(1.88 vs 1.8800). 아주 작은 차이는 같게 본다.
      if (Math.abs(v - wantNum) < 1e-6) out.push({ path, value: v, probe, how: 'number' });
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
  // 숫자 일치가 더 믿을 만하다. 경로가 짧을수록 바깥쪽이라 안정적이다.
  return out.sort(
    (x, y) => (x.how === y.how ? x.path.length - y.path.length : x.how === 'number' ? -1 : 1),
  );
}

/** 저장된 경로로 값을 꺼낸다. `data[0].amount.value` 꼴. */
export function readPath(obj: unknown, path: string): unknown {
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
