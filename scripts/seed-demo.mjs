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

  return s;
}

// 개발만 있으면 성격 축이 한쪽으로 쏠린다. 쉬는 시간도 넣는다.
function watch(dayAgo, hour, minutes) {
  const start = at(dayAgo, hour);
  return {
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
const sessions = scenario().sort((a, b) => a.started_at.localeCompare(b.started_at));
const targets = LIMIT ? sessions.slice(0, LIMIT) : sessions;

console.log(`대상 ${targets.length}세션 · ${BASE}${DRY ? ' · DRY RUN' : ''}`);

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
      body: JSON.stringify(payload),
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
