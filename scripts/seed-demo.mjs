#!/usr/bin/env node
// ============================================================
// 데모 계정에 그럴듯한 14일치를 심는다.
//
// **표에 직접 INSERT 하지 않는다.** 세션을 만들어 POST /api/sessions 에 태우면
// experience-engine 이 실제로 돌아 경험·갈래·기억·스킬이 생긴다. 손으로 18개
// 표를 채우는 것보다 적게 쓰고, 정합성이 공짜로 따라온다 — 경험이 갈래에
// 붙고 스킬 수가 맞는 걸 사람이 계산할 필요가 없다.
//
// 덤이 하나 더 있다. 이 스크립트를 돌리는 것 자체가 파이프라인 시연이다.
// "AI 를 어디에 썼냐"는 물음에 세션 하나 넣고 경험이 나오는 걸 보여주면 된다.
//
// 사용법:
//   node scripts/seed-demo.mjs --key na_xxx [--base https://...] [--dry] [--limit N]
//
// 주의: 세션 하나당 LLM 1회다. 순차로 보낸다 — 한꺼번에 쏘면 비용도 그렇고
// 서버 쪽 after() 가 몰린다.
// ============================================================

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const BASE = opt('base', process.env.NA_BASE ?? 'https://mia-web-nine.vercel.app');
const KEY = opt('key', process.env.NA_DEMO_KEY ?? '');
const DRY = args.includes('--dry');
const LIMIT = Number(opt('limit', '0')) || 0;
// 특정 날짜분만 보낸다. 두 번 돌려 중복을 만들지 않으려고 둔다 —
// 이미 심어둔 계정에 오늘치만 더할 때 쓴다.
const ONLY = args.includes('--only') ? Number(opt('only', 'NaN')) : null;
// 어느 묶음을 보낼지. base 는 처음 심은 개발 위주 14일치, diverse 는 그 위에
// 분야를 넓혀 얹는 묶음이다. 같은 계정에 더하는 것이므로 base 를 다시 보내면
// 14일치가 두 벌이 된다.
const SET = opt('set', 'base');

if (!KEY) {
  console.error('키가 없다. --key na_... 또는 NA_DEMO_KEY 를 준다.');
  process.exit(1);
}

// 오늘 자정(KST) 기준으로 거슬러 올라간다. KST 로 고정하는 이유는 서버의
// 하루 경계(새벽 4시 KST)와 어긋나면 "어제"가 어제가 아니게 되기 때문이다.
const KST = 9 * 60 * 60 * 1000;
const todayKstMidnight = (() => {
  const nowKst = new Date(Date.now() + KST);
  return Date.UTC(nowKst.getUTCFullYear(), nowKst.getUTCMonth(), nowKst.getUTCDate()) - KST;
})();
const at = (dayAgo, hour, min = 0) =>
  todayKstMidnight - dayAgo * 86400_000 + hour * 3600_000 + min * 60_000;

const iso = (ms) => new Date(ms).toISOString();
const uuid = () => crypto.randomUUID();

// ── 반복하는 절차 ─────────────────────────────────────────
//
// 셀렉터가 같으면 같은 절차로 묶인다(keyOf 는 `domain|sel`). 서로 다른 세션
// **2개 이상**에, dt 300초 안쪽으로 이어진 **3단계 이상**이 있어야 후보가 된다.
// 이게 없으면 /procedures 가 빈 화면이라, 정작 제일 설명하기 좋은 기능을
// 못 보여준다.
const DEPLOY_CHECK = [
  { t: 'click', label: 'Deployments', sel: 'a[href$="/deployments"]', dt: 9 },
  { t: 'click', label: 'Production', sel: 'a[data-testid="deployment-row"]', dt: 21 },
  { t: 'click', label: 'Build Logs', sel: 'button[data-testid="build-logs"]', dt: 16 },
];
const DB_CHECK = [
  { t: 'click', label: 'Table Editor', sel: 'a[href*="/editor"]', dt: 11 },
  { t: 'click', label: 'sessions', sel: 'div[data-tree-item="sessions"]', dt: 24 },
  { t: 'click', label: 'Run', sel: 'button[type="submit"][form="sql"]', mut: true, dt: 31 },
];

// 아침에 세 군데를 순서대로 여는 것 — 도메인을 넘나드는 절차다.
// stepsOf 가 구간을 순서대로 펴서 조작 열로 만들기 때문에, 구간이 달라도
// dt 가 300초 안쪽이면 한 절차로 묶인다. 개발 얘기가 아닌 절차라 무엇을
// 자동화하겠다는 건지 설명하기도 쉽다.
const MORNING = [
  { t: 'click', label: '받은편지함', sel: 'a[href*="#inbox"]', dt: 8 },
  { t: 'click', label: '주간 보기', sel: 'button[aria-label*="주"]', dt: 19 },
  { t: 'click', label: '오늘 할 일', sel: 'div[data-block-id="today"]', dt: 23 },
];

// 주말마다 하는 가계부 정리.
const LEDGER = [
  { t: 'click', label: '이번 달 지출', sel: 'a[href*="/spending"]', dt: 12 },
  { t: 'click', label: '카테고리별', sel: 'button[data-tab="category"]', dt: 27 },
  { t: 'click', label: '메모 저장', sel: 'button[type="submit"][name="memo"]', mut: true, dt: 34 },
];

const seg = (domain, category, startMs, sec, extra = {}) => ({
  domain,
  category,
  start: iso(startMs),
  end: iso(startMs + sec * 1000),
  sec,
  ...extra,
});

// ── 시나리오 ──────────────────────────────────────────────
//
// 사이드 프로젝트를 만드는 2주. 갈래가 몇 개 이어지도록 같은 주제를 며칠에
// 걸쳐 반복한다 — 갈래 부착이 붙을 자리가 있어야 화면이 빈칸이 아니다.
function scenario() {
  const s = [];

  const dev = (dayAgo, hour, minutes, parts, opts = {}) => {
    const start = at(dayAgo, hour);
    let cursor = start;
    const segments = parts.map((p) => {
      const one = seg(p.d, p.c ?? 'dev', cursor, p.sec, {
        ...(p.title ? { title: p.title } : {}),
        ...(p.paths ? { paths: p.paths } : {}),
        ...(p.acts ? { acts: p.acts } : {}),
      });
      cursor += p.sec * 1000 + 20_000;
      return one;
    });
    const domains = {};
    for (const p of parts) domains[p.d] = (domains[p.d] ?? 0) + p.sec;
    s.push({
      _day: dayAgo,
      id: uuid(),
      started_at: iso(start),
      ended_at: iso(start + minutes * 60_000),
      duration_min: minutes,
      close_reason: opts.close ?? 'idle',
      primary_category: opts.cat ?? 'dev',
      activity_score: opts.score ?? Math.round(minutes * 7.5),
      unique_domains: Object.keys(domains).length,
      switch_count: Math.max(0, parts.length - 1),
      tags: opts.tags ?? [],
      compressed_log: {
        segments,
        tags: opts.tags ?? [],
        queries: opts.queries ?? [],
      },
      domains,
    });
  };

  // ── 1주차 — 확장 프로그램 세션화 ──
  dev(13, 10, 74, [
    { d: 'github.com', sec: 1500, title: 'mia · 세션 판단 규칙', paths: ['/Kwon812/mia/blob/main/apps/extension/src/session/rules.ts'] },
    { d: 'developer.mozilla.org', c: 'docs', sec: 900, title: 'chrome.alarms - MDN' },
    { d: 'localhost', sec: 1400, title: 'Project NA', paths: ['/'] },
  ], { queries: [{ q: 'mv3 service worker alarm 최소 주기', n: 2, first: iso(at(13, 10, 5)), last: iso(at(13, 10, 42)) }] });

  dev(12, 14, 96, [
    { d: 'localhost', sec: 2600, title: 'Project NA', paths: ['/', '/diary'] },
    { d: 'github.com', sec: 1700, title: 'mia · builder.ts' },
    { d: 'stackoverflow.com', c: 'community', sec: 900, title: 'IndexedDB transaction aborted' },
  ], { close: 'maxlen' });

  dev(11, 9, 52, [
    { d: 'vercel.com', c: 'productivity', sec: 1200, title: 'mia-web – Deployments', acts: DEPLOY_CHECK },
    { d: 'localhost', sec: 1500, title: 'Project NA' },
  ]);

  s.push(watch(11, 22, 41));

  // ── 2주차 — 구글 로그인, 배포 파이프라인 ──
  dev(9, 11, 88, [
    { d: 'supabase.com', c: 'productivity', sec: 1800, title: 'mia · Table Editor', acts: DB_CHECK },
    { d: 'github.com', sec: 1600, title: 'mia · devices 마이그레이션' },
    { d: 'claude.ai', c: 'ai', sec: 1100, title: 'Claude' },
  ], { queries: [{ q: 'supabase google oauth redirect_uri_mismatch', n: 3, first: iso(at(9, 11, 20)), last: iso(at(9, 12, 10)) }] });

  dev(8, 15, 63, [
    { d: 'developer.mozilla.org', c: 'docs', sec: 1400, title: 'SameSite cookies - MDN' },
    { d: 'localhost', sec: 1900, title: 'Project NA · /connect' },
  ]);

  dev(7, 10, 105, [
    { d: 'github.com', sec: 2200, title: 'mia · auth callback' },
    { d: 'vercel.com', c: 'productivity', sec: 1300, title: 'mia-web – Deployments', acts: DEPLOY_CHECK },
    { d: 'localhost', sec: 2100, title: 'Project NA' },
  ], { close: 'maxlen', tags: ['long'] });

  s.push(study(6, 20, 47));
  s.push(watch(6, 23, 35));

  dev(5, 13, 71, [
    { d: 'supabase.com', c: 'productivity', sec: 1500, title: 'mia · SQL Editor', acts: DB_CHECK },
    { d: 'localhost', sec: 1800, title: 'Project NA · /connect/google' },
  ]);

  dev(4, 9, 58, [
    { d: 'github.com', sec: 1700, title: 'mia · CI 워크플로' },
    { d: 'docs.github.com', c: 'docs', sec: 1100, title: 'Workflow syntax for GitHub Actions' },
  ], { queries: [{ q: 'github actions npm ci workspaces', n: 1, first: iso(at(4, 9, 12)), last: iso(at(4, 9, 12)) }] });

  s.push(study(3, 21, 52));

  dev(2, 14, 82, [
    { d: 'localhost', sec: 2400, title: 'Project NA · /procedures' },
    { d: 'github.com', sec: 1500, title: 'mia · procedure.ts' },
    { d: 'claude.ai', c: 'ai', sec: 900, title: 'Claude' },
  ]);

  // ── 어제 — 일기가 생기려면 어제 경험이 1건 이상이어야 한다 ──
  dev(1, 10, 93, [
    { d: 'vercel.com', c: 'productivity', sec: 1400, title: 'mia-web – Deployments', acts: DEPLOY_CHECK },
    { d: 'github.com', sec: 2000, title: 'mia · devices claim' },
    { d: 'localhost', sec: 2200, title: 'Project NA' },
  ], { close: 'maxlen' });

  dev(1, 16, 44, [
    { d: 'supabase.com', c: 'productivity', sec: 1300, title: 'mia · Table Editor', acts: DB_CHECK },
    { d: 'localhost', sec: 900, title: 'Project NA · /skills' },
  ]);

  s.push(watch(1, 22, 38));

  // ── 오늘 ──
  //
  // 야간 배치는 "어제"를 **실행 시점** 기준으로 잡는다(daily-logs 에 날짜 인자가
  // 없다). 그래서 과거로만 심어두면 오늘 밤 크론이 도는 시점의 어제에는 경험이
  // 없어서 일기가 영영 안 생긴다. 오늘치를 넣어야 다음 배치가 일기를 만든다.
  dev(0, 9, 67, [
    { d: 'github.com', sec: 1800, title: 'mia · 데모 계정' },
    { d: 'vercel.com', c: 'productivity', sec: 1100, title: 'mia-web – Deployments', acts: DEPLOY_CHECK },
    { d: 'localhost', sec: 1000, title: 'Project NA · /demo' },
  ]);

  dev(0, 11, 39, [
    { d: 'supabase.com', c: 'productivity', sec: 1200, title: 'mia · Table Editor', acts: DB_CHECK },
    { d: 'claude.ai', c: 'ai', sec: 700, title: 'Claude' },
  ]);

  return s;
}

// ── 분야를 넓히는 묶음 ────────────────────────────────────
//
// base 가 개발 쪽으로 쏠려 있어서 성격 축도 스킬도 한 방향만 나온다. 사람은
// 하루 종일 코드만 보지 않는다 — 아침에 메일을 열고, 점심에 뭘 사고, 주말에
// 가계부를 맞추고, 밤에 음악을 튼다. 그게 다 관측 대상이다.
//
// 같은 계정에 얹는다. 이미 있는 14일 위에 겹쳐 깔리므로 하루가 두세 갈래로
// 채워지고, 그게 실제 사용에 더 가깝다.
function diverseScenario() {
  const s = [];

  const S = (dayAgo, hour, minutes, cat, parts, opts = {}) => {
    const start = at(dayAgo, hour);
    let cursor = start;
    const segments = parts.map((p) => {
      const one = seg(p.d, p.c ?? cat, cursor, p.sec, {
        ...(p.title ? { title: p.title } : {}),
        ...(p.paths ? { paths: p.paths } : {}),
        ...(p.acts ? { acts: p.acts } : {}),
      });
      cursor += p.sec * 1000 + 15_000;
      return one;
    });
    const domains = {};
    for (const p of parts) domains[p.d] = (domains[p.d] ?? 0) + p.sec;
    s.push({
      _day: dayAgo,
      id: uuid(),
      started_at: iso(start),
      ended_at: iso(start + minutes * 60_000),
      duration_min: minutes,
      close_reason: opts.close ?? 'idle',
      primary_category: cat,
      activity_score: opts.score ?? Math.round(minutes * (opts.passive ? 1.3 : 5.5)),
      unique_domains: Object.keys(domains).length,
      switch_count: Math.max(0, parts.length - 1),
      tags: opts.tags ?? [],
      compressed_log: { segments, tags: opts.tags ?? [], queries: opts.queries ?? [] },
      domains,
    });
  };

  // 아침 루틴 — 절차로 잡히려면 서로 다른 세션 2개 이상에 같은 조작 열이 있어야 한다.
  const morning = (dayAgo) =>
    S(dayAgo, 8, 26, 'productivity', [
      { d: 'mail.google.com', sec: 420, title: '받은편지함', acts: [MORNING[0]] },
      { d: 'calendar.google.com', sec: 300, title: '캘린더', acts: [MORNING[1]] },
      { d: 'notion.so', sec: 660, title: '주간 보드', acts: [MORNING[2]] },
    ]);

  morning(12);
  morning(9);
  morning(5);
  morning(2);

  // 디자인
  S(13, 15, 71, 'design', [
    { d: 'figma.com', sec: 2600, title: '포트폴리오 리뉴얼 – 시안 B' },
    { d: 'dribbble.com', sec: 900, title: 'Editorial layout' },
    { d: 'fonts.google.com', sec: 500, title: 'Pretendard 대체 찾기' },
  ], { queries: [{ q: '한글 웹폰트 가변 폰트 성능', n: 2, first: iso(at(13, 15, 8)), last: iso(at(13, 15, 40)) }] });

  S(6, 14, 84, 'design', [
    { d: 'figma.com', sec: 3400, title: '포트폴리오 리뉴얼 – 모바일' },
    { d: 'coolors.co', sec: 700, title: '팔레트' },
  ], { close: 'maxlen' });

  // 언어 공부
  S(11, 21, 38, 'study', [
    { d: 'duolingo.com', sec: 1500, title: '일본어 · 유닛 12' },
    { d: 'jisho.org', c: 'docs', sec: 600, title: '漢字 검색' },
  ]);
  S(7, 21, 44, 'study', [
    { d: 'duolingo.com', sec: 1700, title: '일본어 · 유닛 13' },
    { d: 'youtube.com', c: 'study', sec: 800, title: 'JLPT N3 문법 정리' },
  ]);
  S(3, 22, 33, 'study', [{ d: 'duolingo.com', sec: 1800, title: '일본어 · 유닛 14' }]);

  // 가계부 — 주말마다
  S(10, 11, 41, 'finance', [
    { d: 'toss.im', sec: 1900, title: '이번 달 지출', acts: LEDGER },
    { d: 'notion.so', c: 'productivity', sec: 500, title: '가계부' },
  ]);
  S(4, 11, 37, 'finance', [
    { d: 'toss.im', sec: 1700, title: '이번 달 지출', acts: LEDGER },
    { d: 'notion.so', c: 'productivity', sec: 400, title: '가계부' },
  ]);

  // 뉴스 · 커뮤니티
  S(12, 20, 29, 'news', [
    { d: 'news.hada.io', sec: 1000, title: 'GeekNews' },
    { d: 'news.ycombinator.com', c: 'community', sec: 700, title: 'Hacker News' },
  ], { passive: true });
  S(5, 19, 34, 'community', [
    { d: 'reddit.com', sec: 1300, title: 'r/webdev' },
    { d: 'news.hada.io', c: 'news', sec: 600, title: 'GeekNews' },
  ], { passive: true });

  // 쇼핑 — 러닝화 고르기, 며칠에 걸쳐 이어진다(갈래가 붙을 자리)
  S(9, 13, 46, 'shopping', [
    { d: 'coupang.com', sec: 1500, title: '러닝화 검색' },
    { d: 'blog.naver.com', c: 'search', sec: 900, title: '러닝화 추천 후기' },
  ], { queries: [{ q: '초보 러닝화 추천 발볼', n: 4, first: iso(at(9, 13, 3)), last: iso(at(9, 13, 38)) }] });
  S(8, 12, 31, 'shopping', [
    { d: 'nike.com', sec: 1200, title: '페가수스 41' },
    { d: 'coupang.com', sec: 500, title: '가격 비교' },
  ]);

  // 음악 · 오락
  S(10, 23, 52, 'music', [{ d: 'music.youtube.com', sec: 2900, title: 'Lo-fi 작업용' }], { passive: true });
  S(4, 22, 47, 'entertainment', [{ d: 'netflix.com', sec: 2600, title: '다큐 · 심해' }], { passive: true });
  S(2, 23, 43, 'music', [{ d: 'music.youtube.com', sec: 2400, title: '재즈 피아노' }], { passive: true });

  // 요리 · 생활
  S(7, 18, 27, 'search', [
    { d: 'youtube.com', sec: 1100, title: '집에서 라구 파스타' },
    { d: '10000recipe.com', c: 'docs', sec: 400, title: '라구 소스' },
  ], { queries: [{ q: '라구 파스타 우유 대체', n: 1, first: iso(at(7, 18, 6)), last: iso(at(7, 18, 6)) }] });

  // 여행 계획 — 갈래가 며칠 이어진다
  S(6, 20, 39, 'search', [
    { d: 'google.com', sec: 800, title: '오사카 3박 4일' },
    { d: 'blog.naver.com', sec: 1200, title: '오사카 자유여행 코스' },
  ]);
  S(3, 20, 55, 'productivity', [
    { d: 'notion.so', sec: 2000, title: '오사카 일정표' },
    { d: 'skyscanner.co.kr', c: 'search', sec: 900, title: '항공권 검색' },
  ]);

  // AI 로 뭔가 만들어보기
  S(8, 16, 58, 'ai', [
    { d: 'claude.ai', sec: 2200, title: 'Claude' },
    { d: 'notion.so', c: 'productivity', sec: 800, title: '아이디어 노트' },
  ]);

  // 오늘 — 배치가 오늘 밤 일기를 쓰려면 오늘 경험이 있어야 한다
  morning(0);
  S(0, 10, 49, 'design', [
    { d: 'figma.com', sec: 2100, title: '포트폴리오 리뉴얼 – 정리' },
    { d: 'notion.so', c: 'productivity', sec: 600, title: '주간 보드' },
  ]);

  return s;
}

// 개발만 있으면 성격 축이 한쪽으로 쏠린다. 쉬는 시간도 넣는다.
function watch(dayAgo, hour, minutes) {
  const start = at(dayAgo, hour);
  return {
    _day: dayAgo,
    id: uuid(),
    started_at: iso(start),
    ended_at: iso(start + minutes * 60_000),
    duration_min: minutes,
    close_reason: 'idle',
    primary_category: 'entertainment',
    activity_score: Math.round(minutes * 1.2),
    unique_domains: 1,
    switch_count: 0,
    tags: ['passive'],
    compressed_log: {
      segments: [seg('youtube.com', 'entertainment', start, minutes * 60 - 120, { title: '개발 브이로그' })],
      tags: ['passive'],
      queries: [],
    },
    domains: { 'youtube.com': minutes * 60 - 120 },
  };
}

function study(dayAgo, hour, minutes) {
  const start = at(dayAgo, hour);
  const half = Math.floor((minutes * 60 - 180) / 2);
  return {
    _day: dayAgo,
    id: uuid(),
    started_at: iso(start),
    ended_at: iso(start + minutes * 60_000),
    duration_min: minutes,
    close_reason: 'idle',
    primary_category: 'study',
    activity_score: Math.round(minutes * 4),
    unique_domains: 2,
    switch_count: 1,
    tags: [],
    compressed_log: {
      segments: [
        seg('developer.mozilla.org', 'docs', start, half, { title: 'Using the Web Storage API' }),
        seg('youtube.com', 'study', start + (half + 60) * 1000, half, { title: 'PostgreSQL 인덱스 설계' }),
      ],
      tags: [],
      queries: [{ q: 'postgres partial index 언제 쓰나', n: 1, first: iso(start + 60_000), last: iso(start + 60_000) }],
    },
    domains: { 'developer.mozilla.org': half, 'youtube.com': half },
  };
}

// ── 전송 ──────────────────────────────────────────────────
const chosen = SET === 'diverse' ? diverseScenario() : scenario();
const sessions = chosen.sort((a, b) => a.started_at.localeCompare(b.started_at));
const filtered = ONLY === null ? sessions : sessions.filter((x) => x._day === ONLY);
const targets = LIMIT ? filtered.slice(0, LIMIT) : filtered;

console.log(`[${SET}] 대상 ${targets.length}세션 · ${BASE}${DRY ? ' · DRY RUN' : ''}`);

let ok = 0;
let fail = 0;
for (const [i, payload] of targets.entries()) {
  const tag = `${i + 1}/${targets.length} ${payload.started_at.slice(0, 16)} ${payload.primary_category} ${payload.duration_min}분`;
  if (DRY) {
    console.log(`  [dry] ${tag}`);
    ok += 1;
    continue;
  }
  try {
    const res = await fetch(`${BASE}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Extension-Key': KEY },
      // _day 는 어느 날짜분인지 고르기 위한 표시일 뿐이다. 서버 스키마에 없다.
      body: JSON.stringify((({ _day, ...rest }) => rest)(payload)),
    });
    if (res.ok) {
      console.log(`  ok   ${tag}`);
      ok += 1;
    } else {
      const body = await res.text();
      console.error(`  FAIL ${tag} → ${res.status} ${body.slice(0, 200)}`);
      fail += 1;
    }
  } catch (err) {
    console.error(`  FAIL ${tag} → ${err.message}`);
    fail += 1;
  }
  // 세션마다 LLM 이 한 번 돈다. 몰아치지 않게 사이를 둔다.
  if (!DRY) await new Promise((r) => setTimeout(r, 1500));
}

console.log(`\n성공 ${ok} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
