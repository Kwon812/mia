// ============================================================
// 지금 API 를 얼마나 쓰고 있나 — 팝업 한 줄로.
//
// 대시보드를 세 군데 열어보지 않으려고 만든 자리다. 그래서 원칙이 둘이다.
//
// 1) **키는 이 브라우저를 안 떠난다.** 서버로 안 보낸다. sw.ts 의
//    `na_api_keys` 를 그대로 쓴다 — 값 집기(api-registry) 에서 이미 넣은
//    Render·OpenAI 키가 있으면 다시 안 물어본다.
//
// 2) **호출은 서비스 워커에서 한다.** host_permissions 덕에 CORS 를 안 타고,
//    팝업이 닫혀도 캐시가 남아 다음에 열 때 즉시 뜬다. 팝업은 여기서 만든
//    **문자열만** 받는다 (popup.ts 는 값 import 를 못 한다 — vite.config.ts
//    주석 참고).
//
// ── 무엇을 보여주나 ──
//
// **이달 얼마 썼나, 오늘 얼마 썼나.** 거기에 월 구독료를 더한 이달 총액.
//
// 남은 크레딧(잔액)은 **일부러 안 넣었다.** 두 곳 다 잔액 API 가 없다 —
// OpenAI 의 credit_grants 는 브라우저 세션 키를 요구해 API 키로는 401 이고,
// Anthropic 은 엔드포인트 자체가 없다. 사용액을 빼서 흉내낼 수는 있지만
// 그건 API 가 준 값이 아니라 우리가 지어낸 값이고, 어긋나도 어긋난 줄
// 모른다.
//
// ── 구독료는 왜 사람이 적나 ──
//
// 구독료도 API 가 안 준다. cost_report 는 **API 사용액만** 담는다 —
// claude.ai 의 Pro/Max 는 청구 주체가 아예 달라서 Console 에 나타나지도
// 않는다. ChatGPT Plus 도 마찬가지다.
//
// 그런데 이건 잔액과 성질이 다르다. **고정값이다.** 매달 같은 $20 이고,
// 요금제를 바꾸기 전까지 어긋날 여지가 없다. 계산해서 지어내는 값이
// 아니라 사람이 이미 아는 상수를 옮겨 적는 것뿐이라 넣는다.
//
// 그래서 숫자마다 출처가 갈린다. API 사용액은 그쪽이 말한 값, 구독료는
// 네가 적은 값 — 화면에서도 따로 적어 섞이지 않게 한다.
//
// ── 어떤 키가 필요한가 ──
//
//   OpenAI      조직 Admin key (sk-admin…). 일반 sk-proj… 는 401 이다.
//               GET /v1/organization/costs        — 개인 계정도 발급된다
//   Anthropic   조직 Admin key (sk-ant-admin01…). 일반 키는 401 이다.
//               GET /v1/organizations/cost_report — 개인 계정엔 이 API 가 없다
//   Render      일반 API key (rnd_…). 비용 API 가 아예 없어서 —
//               서비스 수와 대역폭으로 대신한다.
//
// 셋 다 "요금"을 같은 방식으로 주지 않는다. 그래서 억지로 한 줄에 맞추지
// 않고, 각자 줄 수 있는 것을 그대로 보여준다. 없는 것은 없다고 적는다.
// ============================================================

export type UsageProviderId = 'openai' | 'anthropic' | 'render';

/** 팝업이 그대로 그리는 한 줄. 계산은 전부 여기서 끝난다. */
export interface UsageLine {
  k: string;
  v: string;
}

export interface UsageEntry {
  id: UsageProviderId;
  label: string;
  keyHint: string;
  keyUrl: string;
  /** 키가 저장돼 있나 — 팝업이 입력란을 그릴지 정한다 */
  hasKey: boolean;
  /** 사람이 적어둔 월 구독료(USD). API 가 주는 값이 아니다 */
  subUsd: number | null;
  /** 큰 글씨 자리 — 못 읽었으면 null */
  headline: string | null;
  /**
   * 그 큰 숫자가 **무엇인가**. 칸마다 줄 수 있는 것이 달라서 이름이 없으면
   * 못 읽는다 — Render 는 애초에 금액이 아니다.
   */
  headlineLabel: string | null;
  lines: UsageLine[];
  /** 최근 며칠치 막대. 0..1 로 정규화된 값 — 빈 배열이면 안 그린다 */
  spark: number[];
  /** 왜 못 읽었나. 사람이 다음에 뭘 할지 알 수 있게 적는다 */
  error: string | null;
}

export interface UsageSnapshot {
  entries: UsageEntry[];
  /** 언제 읽은 값인가 (epoch ms) */
  fetchedAt: number;
  /** 달러로 값이 나온 것들의 이달 합계. 하나도 없으면 null */
  totalUsd: string | null;
  /** 이번 달의 시작 (epoch ms, UTC) — "8월 1일부터" 를 적으려고 */
  periodStart: number;
}

export interface UsageProviderMeta {
  label: string;
  keyHint: string;
  keyUrl: string;
}

/**
 * 키를 어디서 받나. 화면이 이 문장을 그대로 보여준다 —
 * "권한이 없다"는 답을 받았을 때 사람이 바로 다음 걸음을 알아야 한다.
 */
export const USAGE_PROVIDERS: Record<UsageProviderId, UsageProviderMeta> = {
  openai: {
    label: 'OpenAI',
    keyHint: 'Admin key (sk-admin…). 일반 API 키로는 사용량이 안 보인다',
    keyUrl: 'https://platform.openai.com/settings/organization/admin-keys',
  },
  anthropic: {
    // 개인 계정에는 Admin API 자체가 없다. 키를 아무리 다시 넣어도 안 되는
    // 자리라, 401 을 보기 전에 미리 적어둔다.
    //
    // **Console 키여야 한다.** claude.ai 의 Enterprise 키(sk-ant-api01…)는
    // 구성원 관리·컴플라이언스용이라 비용 API 를 안 받는다. 둘 다 "관리자
    // 키"라 불려서 헷갈리는 자리다.
    label: 'Claude',
    keyHint: 'Console(platform.claude.com) → Settings → Admin keys · sk-ant-admin01… · 개인 계정엔 이 API 가 없다',
    keyUrl: 'https://platform.claude.com/settings/admin-keys',
  },
  render: {
    label: 'Render',
    keyHint: 'API key (rnd_…). Account Settings → API Keys',
    keyUrl: 'https://dashboard.render.com/u/settings#api-keys',
  },
};

export const USAGE_PROVIDER_IDS: UsageProviderId[] = ['openai', 'anthropic', 'render'];

// ── 기간 ────────────────────────────────────────────────────
//
// **UTC 로 자른다.** 세 서비스 모두 하루 단위 집계가 UTC 경계다. 로컬
// 자정으로 자르면 한국(UTC+9)에서는 매일 9시간이 어긋나 "오늘 쓴 돈"이
// 어제 것과 섞인다.

/** 이번 달 1일 00:00 UTC (epoch ms) */
export function monthStartUtc(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

/** 오늘 00:00 UTC (epoch ms) */
export function dayStartUtc(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

// ── 표기 ────────────────────────────────────────────────────

/**
 * 달러 표기. **작은 값을 0 으로 뭉개지 않는다** — $0.004 를 "$0.00" 으로
 * 적으면 "안 쓰고 있다"로 읽힌다. 실제로는 쓰고 있는데.
 */
export function formatUsd(usd: number): string {
  if (usd === 0) return '$0';
  if (Math.abs(usd) < 0.01) return `$${usd.toFixed(4)}`;
  if (Math.abs(usd) < 100) return `$${usd.toFixed(2)}`;
  return `$${Math.round(usd).toLocaleString('en-US')}`;
}

/** 바이트 → "1.2 GB" */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

/** 막대용 정규화. 최댓값이 0 이면(아무것도 안 썼으면) 안 그린다. */
export function normalize(values: number[], take = 14): number[] {
  const tail = values.slice(-take);
  const max = Math.max(...tail, 0);
  if (max <= 0) return [];
  return tail.map((v) => Math.max(0, v) / max);
}

// ── 응답 읽기 ───────────────────────────────────────────────
//
// 응답 모양은 서비스 문서에 매인 값이라 바뀔 수 있다. 그래서 파싱을 fetch 와
// 떼어놨다 — 여기만 테스트하면 모양이 바뀌었는지 알 수 있다.

/** 하루치 비용. `at` 은 그 버킷의 시작(epoch ms). */
export interface CostDay {
  at: number;
  usd: number;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

/**
 * 숫자를 꺼낸다. **문자열로 와도 받는다.**
 *
 * 돈은 문자열로 오는 경우가 잦다 — 부동소수 오차 없이 옮기려는 것이고,
 * 실제로 OpenAI 는 `"1.880642850000000000000000000"` 처럼 스물몇 자리로 보낸다.
 * 문서 예시에는 `0.06` 이라고 **숫자로** 적혀 있어서 그 말을 믿었다가,
 * 조직이 $1.88 을 쓴 달에 팝업이 $0 을 띄웠다 — 타입이 안 맞으면 그냥
 * 건너뛰니까 오류도 안 나고 조용히 0 이 된다. 그게 제일 찾기 어려운 종류다.
 */
function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * OpenAI Costs API.
 *
 *   { data: [ { start_time: 1786147200,
 *               results: [ { amount: { value: "1.8806428500000", currency: 'usd' } } ] } ] }
 *
 * `amount.value` 는 **달러**다 (Anthropic 은 센트다 — 아래 참고). 그리고
 * **문자열로 온다** — 문서 예시는 숫자로 적혀 있지만 실제 응답은 아니다
 * (toNumber 주석 참고). 쓴 게 없는 날은 `results` 가 빈 배열로 온다.
 *
 * `start_time_iso` 도 같이 오지만 안 쓴다. 실측에서 그 필드만 타임존 접미사
 * (`+00:00`)가 빠진 버킷이 섞여 왔다 — 그대로 Date.parse 하면 그 하루만
 * 로컬 시각으로 읽혀 "오늘"이 어긋난다. epoch 인 `start_time` 이 안전하다.
 */
export function parseOpenAiCosts(json: unknown): CostDay[] {
  const root = asRecord(json);
  const data = Array.isArray(root?.data) ? root.data : [];
  const out: CostDay[] = [];
  for (const bucket of data) {
    const b = asRecord(bucket);
    if (!b) continue;
    const at = typeof b.start_time === 'number' ? b.start_time * 1000 : 0;
    let usd = 0;
    for (const r of Array.isArray(b.results) ? b.results : []) {
      const v = toNumber(asRecord(asRecord(r)?.amount)?.value);
      if (v !== null) usd += v;
    }
    out.push({ at, usd });
  }
  return out.sort((a, b) => a.at - b.at);
}

/**
 * Anthropic Cost Report.
 *
 *   { data: [ { starting_at: '2025-08-01T00:00:00Z',
 *               results: [ { amount: '123.45', currency: 'USD' } ] } ] }
 *
 * **`amount` 는 센트다.** 문서가 명시한다 — "lowest currency units",
 * "123.45" 가 $1.23. 이걸 놓치면 100 배 틀린 금액이 뜨는데, 하필 그럴듯한
 * 자릿수라 틀린 줄도 모른다. 그래서 여기서 한 번만 나눈다.
 * 문자열로 오는 것도 그래서다(부동소수 오차 없이 옮기려고).
 */
export function parseAnthropicCosts(json: unknown): CostDay[] {
  const root = asRecord(json);
  const data = Array.isArray(root?.data) ? root.data : [];
  const out: CostDay[] = [];
  for (const bucket of data) {
    const b = asRecord(bucket);
    if (!b) continue;
    const at = typeof b.starting_at === 'string' ? Date.parse(b.starting_at) : NaN;
    let cents = 0;
    for (const r of Array.isArray(b.results) ? b.results : []) {
      const n = toNumber(asRecord(r)?.amount);
      if (n !== null) cents += n;
    }
    out.push({ at: Number.isFinite(at) ? at : 0, usd: cents / 100 });
  }
  return out.sort((a, b) => a.at - b.at);
}

/**
 * Render 메트릭. 시리즈 배열이고 각 시리즈에 시점별 값이 들어 있다.
 *
 *   [ { labels: [...], unit: 'bytes', values: [ { timestamp, value } ] } ]
 *
 * 서비스마다 시리즈가 하나씩 오므로 전부 더한다.
 */
export function parseRenderMetric(json: unknown): number {
  if (!Array.isArray(json)) return 0;
  let sum = 0;
  for (const series of json) {
    const s = asRecord(series);
    for (const point of Array.isArray(s?.values) ? s.values : []) {
      const v = asRecord(point)?.value;
      if (typeof v === 'number' && Number.isFinite(v)) sum += v;
    }
  }
  return sum;
}

export interface RenderService {
  id: string;
  suspended: boolean;
  /** 어느 리전인가. 메트릭을 **리전별로 나눠 불러야** 해서 필요하다 */
  region: string;
}

/**
 * Render 서비스 목록. `[{ service: {...}, cursor }]` 꼴이다.
 *
 * 리전은 타입에 따라 `serviceDetails.region` 에 있기도 하고 위에 바로
 * 붙기도 한다. 정적 사이트처럼 아예 없는 것도 있어서 그때는 빈 문자열이다.
 */
export function parseRenderServices(json: unknown): RenderService[] {
  if (!Array.isArray(json)) return [];
  const out: RenderService[] = [];
  for (const row of json) {
    const svc = asRecord(asRecord(row)?.service) ?? asRecord(row);
    const id = svc?.id;
    if (typeof id !== 'string') continue;
    const detailRegion = asRecord(svc?.serviceDetails)?.region;
    const region =
      typeof detailRegion === 'string' ? detailRegion : typeof svc?.region === 'string' ? svc.region : '';
    out.push({ id, suspended: svc?.suspended === 'suspended' || svc?.suspended === true, region });
  }
  return out;
}

/**
 * 리전별로 묶는다.
 *
 * **한 요청에 한 리전만 된다.** 여러 리전을 한 번에 물으면 Render 가
 * `querying resources from multiple regions is not supported` 로 400 을
 * 낸다 — 서비스를 두 리전에 걸쳐 두고 있으면 대역폭이 통째로 안 나온다.
 */
export function groupByRegion(services: RenderService[]): Map<string, string[]> {
  const g = new Map<string, string[]>();
  for (const s of services) {
    const list = g.get(s.region);
    if (list) list.push(s.id);
    else g.set(s.region, [s.id]);
  }
  return g;
}

// ── 오류 문장 ───────────────────────────────────────────────

/**
 * 왜 못 읽었나.
 *
 * 401 을 그냥 "권한 없음" 이라고 적으면 사람은 키를 다시 복사해 넣어보고
 * 또 같은 걸 본다. 여기서 갈리는 것은 대개 **키 종류**다 — 일반 키로는
 * 조직 사용량을 못 본다. 그래서 그 문장을 직접 적는다.
 */
export function usageErrorFor(id: UsageProviderId, status: number, body = ''): string {
  const meta = USAGE_PROVIDERS[id];
  // 400 은 "요청이 잘못됐다"만으로는 손쓸 데가 없다. 그쪽이 적어 보낸 이유를
  // 그대로 보여주는 편이 어떤 번역보다 낫다.
  const why = body ? ` — ${body}` : '';
  if (status === 401 || status === 403) {
    if (id === 'render') return `키가 안 먹혀 (${status}). ${meta.keyHint}`;
    return `일반 키로는 사용량을 못 봐 (${status}). ${meta.keyHint}`;
  }
  if (status === 404) return 'API 경로가 바뀌었어 (404).';
  if (status === 429) return '요청이 너무 잦대 (429). 잠깐 뒤에 다시.';
  if (status >= 500) return `${meta.label} 쪽 문제야 (${status}).`;
  if (status === 400 || status === 422) return `요청을 못 알아들었대 (${status})${why}`;
  return `${meta.label} 이 ${status} 로 답했어${why}`;
}

export function usageNetErrorFor(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  if (/abort|timeout/i.test(m)) return '응답이 너무 늦어 끊었어.';
  if (/failed to fetch|networkerror|load failed/i.test(m)) return '연결이 안 됐어.';
  return `부르다 실패했어 — ${m}`;
}

// ── 호출 ────────────────────────────────────────────────────

/** 팝업이 열려 있는 동안 사람을 세워두지 않는다. 10초면 충분히 기다린 것이다. */
const TIMEOUT_MS = 10_000;

/**
 * 실패했을 때 **본문도 같이 들고 온다.**
 *
 * 상태 코드만으로는 400 앞에서 손을 못 쓴다 — "요청이 잘못됐다"는 것만
 * 알고 어디가 잘못됐는지는 모르는데, 정작 그 답은 응답 본문에 적혀 있다.
 * 실제로 Render 대역폭이 400 을 뱉었을 때 여기서 막혀 한참을 돌아갔다.
 */
export function briefBody(text: string): string {
  const t = text.trim();
  if (!t) return '';
  try {
    const j = JSON.parse(t) as Record<string, unknown>;
    // 서비스마다 담는 자리가 다르다. 흔한 것들을 훑고, 없으면 통째로 줄인다.
    const err = j.error;
    const msg =
      (typeof err === 'string' && err) ||
      (typeof (err as Record<string, unknown>)?.message === 'string' &&
        ((err as Record<string, unknown>).message as string)) ||
      (typeof j.message === 'string' && j.message) ||
      '';
    if (msg) return msg.slice(0, 160);
  } catch {
    /* JSON 이 아니면 원문을 줄여 쓴다 */
  }
  return t.replace(/\s+/g, ' ').slice(0, 160);
}

async function getJson(
  url: string,
  headers: Record<string, string>,
): Promise<{ ok: true; json: unknown } | { ok: false; status: number; body: string }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json', ...headers }, signal: ctl.signal });
    if (!res.ok) {
      // 본문 읽기가 실패해도 상태 코드는 지킨다.
      const body = await res.text().catch(() => '');
      return { ok: false, status: res.status, body: briefBody(body) };
    }
    return { ok: true, json: await res.json() };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 하루치 비용 배열 → 팝업 한 칸. openai·anthropic 이 똑같이 쓴다.
 *
 * 큰 글씨는 **이달 총액**(API 사용액 + 구독료)이다. 구독료를 안 적었으면
 * 사용액이 곧 총액이라 같은 숫자다.
 *
 * 구독료가 있으면 아래 줄에 API 사용액을 따로 적는다 — 큰 숫자만 보면
 * "이번 달에 이만큼 나갔다"이고, 쪼갠 줄을 보면 그중 얼마가 내가 부른
 * 호출 때문인지가 보인다. 둘은 다른 질문이고 둘 다 필요하다.
 */
function costEntry(
  days: CostDay[],
  now: number,
  subUsd: number | null,
): Partial<UsageEntry> & { monthUsd: number } {
  const today = dayStartUtc(now);
  const monthUsd = days.reduce((a, d) => a + d.usd, 0);
  const todayUsd = days.find((d) => d.at === today)?.usd ?? 0;

  const lines: UsageLine[] = [{ k: '오늘', v: formatUsd(todayUsd) }];
  if (subUsd !== null) {
    lines.push({ k: 'API', v: formatUsd(monthUsd) }, { k: '구독', v: formatUsd(subUsd) });
  }

  return {
    headline: formatUsd(monthUsd + (subUsd ?? 0)),
    headlineLabel: '이달',
    lines,
    spark: normalize(days.map((d) => d.usd)),
    monthUsd,
  };
}

/**
 * OpenAI — 조직 비용.
 *
 * `start_time` 은 초 단위 유닉스 시각이다(밀리초로 보내면 엉뚱한 미래를
 * 가리켜 빈 응답이 온다). `limit` 은 버킷 개수라 한 달이면 31 이면 되고,
 * 그 안에 다 들어오므로 페이지를 넘길 일이 없다.
 */
async function fetchOpenAi(
  key: string,
  now: number,
  subUsd: number | null,
): Promise<Partial<UsageEntry> & { monthUsd?: number }> {
  const url =
    `https://api.openai.com/v1/organization/costs` +
    `?start_time=${Math.floor(monthStartUtc(now) / 1000)}&bucket_width=1d&limit=31`;
  const res = await getJson(url, { Authorization: `Bearer ${key}` });
  if (!res.ok) return { error: usageErrorFor('openai', res.status, res.body) };
  return { ...costEntry(parseOpenAiCosts(res.json), now, subUsd), error: null };
}

/**
 * Anthropic — 조직 비용.
 *
 * `anthropic-version` 을 안 붙이면 400 이다. 키는 Authorization 이 아니라
 * `x-api-key` 로 간다. limit 상한이 31 이라 한 달이 딱 한 쪽이다.
 */
async function fetchAnthropic(
  key: string,
  now: number,
  subUsd: number | null,
): Promise<Partial<UsageEntry> & { monthUsd?: number }> {
  const url =
    `https://api.anthropic.com/v1/organizations/cost_report` +
    `?starting_at=${encodeURIComponent(new Date(monthStartUtc(now)).toISOString())}` +
    `&bucket_width=1d&limit=31`;
  const res = await getJson(url, { 'x-api-key': key, 'anthropic-version': '2023-06-01' });
  if (!res.ok) return { error: usageErrorFor('anthropic', res.status, res.body) };
  return { ...costEntry(parseAnthropicCosts(res.json), now, subUsd), error: null };
}

/**
 * Render — 비용 API 가 **없다.**
 *
 * 없는 것을 있는 척하지 않는다. 대신 청구서를 움직이는 것들을 보여준다:
 * 돌고 있는 서비스 수와 이달 대역폭. 요금 자체는 대시보드에서 본다.
 */
async function fetchRender(
  key: string,
  now: number,
  subUsd: number | null,
): Promise<Partial<UsageEntry>> {
  const auth = { Authorization: `Bearer ${key}` };
  const svcRes = await getJson('https://api.render.com/v1/services?limit=100', auth);
  if (!svcRes.ok) return { error: usageErrorFor('render', svcRes.status, svcRes.body) };

  const services = parseRenderServices(svcRes.json);
  const live = services.filter((s) => !s.suspended);
  const lines: UsageLine[] = [
    { k: '서비스', v: `${live.length}개 실행 중${services.length > live.length ? ` · ${services.length - live.length}개 중지` : ''}` },
  ];

  // 대역폭은 서비스를 지정해야 나오고, **리전별로 나눠 물어야 한다**
  // (groupByRegion 주석 참고). 리전 수만큼 요청이 늘지만 대개 한둘이고,
  // 하루 해상도면 한 달이 31 점이라 응답도 가볍다.
  if (live.length > 0) {
    const groups = [...groupByRegion(live.slice(0, 40))];
    const results = await Promise.all(
      groups.map(async ([region, ids]) => {
        const url = new URL('https://api.render.com/v1/metrics/bandwidth');
        url.searchParams.set('startTime', new Date(monthStartUtc(now)).toISOString());
        url.searchParams.set('endTime', new Date(now).toISOString());
        url.searchParams.set('resolutionSeconds', '86400');
        for (const id of ids) url.searchParams.append('resource', id);
        const bw = await getJson(url.toString(), auth);
        return bw.ok
          ? { bytes: parseRenderMetric(bw.json), failed: null }
          : { bytes: 0, failed: `${region || '리전없음'} ${bw.status}${bw.body ? ` ${bw.body}` : ''}` };
      }),
    );

    const bytes = results.reduce((a, r) => a + r.bytes, 0);
    const failed = results.map((r) => r.failed).filter((v): v is string => v !== null);

    // 한 리전이 실패해도 나머지는 살린다. 다만 **부분 합계를 전체인 척
    // 적지 않는다** — 모르는 채로 작아 보이는 숫자가 제일 나쁘다.
    if (failed.length === 0) {
      lines.push({ k: '이달 대역폭', v: formatBytes(bytes) });
    } else if (failed.length < results.length) {
      lines.push({ k: '이달 대역폭', v: `${formatBytes(bytes)} (일부 누락 — ${failed.join(', ')})` });
    } else {
      lines.push({ k: '이달 대역폭', v: `못 읽음 — ${failed.join(', ')}` });
    }
  }

  // 요금 API 가 없으니 큰 글씨에 적을 것도 없다 — 구독료를 적어뒀다면 그것만은
  // 확실히 나가는 돈이라 거기 올린다.
  return {
    headline: subUsd !== null ? formatUsd(subUsd) : null,
    headlineLabel: subUsd !== null ? '구독' : null,
    lines,
    spark: [],
    error: null,
  };
}

/**
 * 세 곳을 **동시에** 부른다.
 *
 * 순서대로 부르면 한 곳이 느릴 때 나머지가 다 그만큼 늦는다. 하나가
 * 죽어도 나머지는 그대로 뜬다 — 그게 여기 있는 이유다(한 화면에서
 * 셋을 보려고 만들었는데 하나 때문에 셋 다 못 보면 소용이 없다).
 */
export async function buildUsageSnapshot(
  keys: Partial<Record<UsageProviderId, string | null>>,
  /** 사람이 적어둔 월 구독료(USD). API 가 안 주는 값이라 여기로 들어온다 */
  subs: Partial<Record<UsageProviderId, number | null>>,
  now: number,
): Promise<UsageSnapshot> {
  const jobs = USAGE_PROVIDER_IDS.map(async (id): Promise<UsageEntry & { monthUsd?: number }> => {
    const meta = USAGE_PROVIDERS[id];
    const key = keys[id] ?? '';
    const sub = typeof subs[id] === 'number' ? (subs[id] as number) : null;
    const base: UsageEntry = {
      id,
      label: meta.label,
      keyHint: meta.keyHint,
      keyUrl: meta.keyUrl,
      hasKey: !!key,
      subUsd: sub,
      headline: null,
      headlineLabel: null,
      lines: [],
      spark: [],
      error: null,
    };
    // 키가 없어도 구독료는 안다 — 그것만이라도 보여준다. 키를 안 넣었다고
    // 매달 나가는 돈이 화면에서 사라지면 합계가 실제보다 싸 보인다.
    if (!key) {
      return sub === null
        ? base
        : { ...base, headline: formatUsd(sub), headlineLabel: '구독', lines: [{ k: '구독', v: formatUsd(sub) }] };
    }
    try {
      const got =
        id === 'openai'
          ? await fetchOpenAi(key, now, sub)
          : id === 'anthropic'
            ? await fetchAnthropic(key, now, sub)
            : await fetchRender(key, now, sub);
      return { ...base, ...got };
    } catch (err) {
      return { ...base, error: usageNetErrorFor(err) };
    }
  });

  const entries = await Promise.all(jobs);
  // 합계는 **사용액 + 구독료**다. 사용액을 못 읽은 칸(오류·키 없음)도 구독료는
  // 더한다 — 그쪽이 답을 안 했다고 돈이 안 나가는 게 아니다.
  const counted = entries.filter((e) => typeof e.monthUsd === 'number' || e.subUsd !== null);
  const sum = counted.reduce((a, e) => a + (e.monthUsd ?? 0) + (e.subUsd ?? 0), 0);
  return {
    entries: entries.map(({ monthUsd: _drop, ...e }) => e),
    fetchedAt: now,
    totalUsd: counted.length > 0 ? formatUsd(sum) : null,
    periodStart: monthStartUtc(now),
  };
}
