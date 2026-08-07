// 6개월치 가짜 데이터를 넣는다. LLM 은 안 부른다.
//   미리보기: npx tsx --tsconfig scripts/tsconfig.json scripts/seed-6months.mts
//   실행:     ... scripts/seed-6months.mts --apply
//   지우기:   ... scripts/seed-6months.mts --clear
//
// 왜: 지금 실데이터는 이틀치(경험 15건, 갈래 5개)라 궤도가 몇 달 뒤 어떻게
// 보일지 알 수 없다. 반경은 log1p 라 바깥이 촘촘해지고, 방향은 섹터 여덟에
// 갈래가 몰린다 — 둘 다 데이터가 쌓여야만 드러나는 문제다.
//
// 안전장치 둘:
//  1) 모든 id 가 '5eed' 로 시작한다. 이 프로젝트가 이미 쓰는 시드 표식이고
//     (dry-reprocess 가 not like '5eed%' 로 거른다), --clear 가 그것만 지운다.
//  2) user_skills 는 건드리지 않는다. 그 테이블은 PK 가 (user_id, skill_name)
//     이라 id 표식을 붙일 수가 없어서, 넣으면 진짜 스킬과 섞여 되돌릴 수 없다.
//     대신 experience_skills 만 넣는다 — 호버 칩은 뜨고 /skills 는 안 더럽힌다.
//
// 값은 결정적이다(고정 시드 PRNG). 몇 번 돌려도 같은 데이터가 나오므로
// "어제 본 화면"과 비교할 수 있다.
import fs from 'node:fs';
import postgres from 'postgres';

const APPLY = process.argv.includes('--apply');
const CLEAR = process.argv.includes('--clear');
// 연 단위 확인용. 1~4년 전에 갈래를 세 개씩만 놓는다 — 반경 곡선이 해를
// 갈라 보여주는지는 6개월치로는 알 수 없다(그 안에선 전부 같은 해다).
const YEARS = process.argv.includes('--years');

const env = fs.readFileSync('.env.local', 'utf8');
const sql = postgres(env.match(/DATABASE_URL="?([^"\n]+)"?/)?.[1] ?? '', { prepare: false });

// ── 결정적 난수 ──────────────────────────────────────────────
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260806);
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));

/** 5eed 표식이 붙은 UUID. kind 로 종류를 나눠 눈으로도 구분된다. */
const sid = (kind: number, i: number) =>
  `5eed${kind.toString(16).padStart(4, '0')}-0000-4000-8000-${i.toString(16).padStart(12, '0')}`;

// ── 소재 ─────────────────────────────────────────────────────
// 카테고리별로 갈래 제목과 스킬을 준비한다. 열셋을 다 쓴다 — 섹터 여덟이
// 전부 채워져야 방향 규칙이 실제로 검증된다.
const KINDS: {
  cat: string;
  weight: number;
  titles: string[];
  skills: [string, 'programming' | 'art' | 'life'][];
}[] = [
  { cat: 'dev', weight: 26, titles: ['결제 모듈 리팩터링', '실시간 알림 파이프라인', 'CI 빌드 시간 단축', '인증 서버 교체', '오프라인 동기화 구현'], skills: [['TypeScript', 'programming'], ['Postgres', 'programming'], ['Docker', 'programming'], ['GitHub Actions', 'programming']] },
  { cat: 'ai', weight: 12, titles: ['프롬프트 평가 자동화', '임베딩 검색 튜닝', '로컬 추론 서버 실험'], skills: [['Claude', 'programming'], ['LangChain', 'programming'], ['Ollama', 'programming']] },
  { cat: 'docs', weight: 9, titles: ['API 문서 개편', '온보딩 가이드 작성'], skills: [['OpenAPI', 'programming'], ['Markdown', 'life']] },
  { cat: 'study', weight: 8, titles: ['분산 시스템 강의 완주', '일본어 N2 준비', '선형대수 복습'], skills: [['Anki', 'life'], ['Coursera', 'life']] },
  { cat: 'community', weight: 7, titles: ['오픈소스 이슈 대응', '스터디 모임 운영'], skills: [['Discord', 'life'], ['Reddit', 'life']] },
  { cat: 'music', weight: 6, titles: ['앰비언트 트랙 작업', '홈 레코딩 세팅'], skills: [['Ableton', 'art'], ['Logic Pro', 'art']] },
  { cat: 'entertainment', weight: 6, titles: ['시즌 정주행', '인디 게임 클리어'], skills: [['Steam', 'life'], ['Netflix', 'life']] },
  { cat: 'productivity', weight: 6, titles: ['작업 기록 체계 정리', '주간 회고 루틴'], skills: [['Notion', 'life'], ['Obsidian', 'life']] },
  { cat: 'search', weight: 5, titles: ['이사 지역 조사', '장비 비교 조사'], skills: [['Google', 'life']] },
  { cat: 'news', weight: 5, titles: ['반도체 업계 동향 추적'], skills: [['RSS', 'life']] },
  { cat: 'finance', weight: 4, titles: ['연말정산 정리', '가계 지출 점검'], skills: [['Excel', 'life']] },
  { cat: 'shopping', weight: 3, titles: ['모니터 교체', '책상 셋업 개편'], skills: [['Coupang', 'life']] },
  { cat: 'etc', weight: 3, titles: ['잡다한 정리', '계정 정리'], skills: [['1Password', 'life']] },
];
const KIND_POOL = KINDS.flatMap((k) => Array<typeof k>(k.weight).fill(k));

const OUTCOMES = ['success', 'partial', 'stuck', 'explore'] as const;
const VERBS = ['확인했다', '정리했다', '고쳤다', '막혔다', '뜯어봤다', '되돌렸다', '비교해봤다', '끝냈다'];
// 여섯 개를 다 쓴다. 'deepened' 가 빠져 있었는데, 지도가 trigger 마다 방향을
// 한 조각씩 떼주므로 빠진 값은 그 조각이 영영 비어 있다는 뜻이 된다 —
// "골고루"를 확인하려면 여섯 조각이 다 차야 한다.
const TRIGGERS = ['new_skill', 'thread_complete', 'breakthrough', 'deepened', 'revival', 'comeback'];

/** 지도가 방향을 정할 때 쓰는 우선순위와 같다(@na/shared 의 strongestTrigger).
 *  스크립트라 패키지를 안 끌어오고 목록만 맞춰 둔다. */
const TRIGGER_RANK = ['thread_complete', 'new_skill', 'breakthrough', 'deepened', 'revival', 'comeback'];
const strongest = (ts: string[]) =>
  [...ts].sort(
    (a, b) =>
      (TRIGGER_RANK.indexOf(a) < 0 ? 99 : TRIGGER_RANK.indexOf(a)) -
      (TRIGGER_RANK.indexOf(b) < 0 ? 99 : TRIGGER_RANK.indexOf(b)),
  )[0];

const DAY = 86400000;
const DAYS = 180;

// ── 지우기 ───────────────────────────────────────────────────
if (CLEAR) {
  // FK 순서대로. memories → experience_skills → experiences → threads → sessions
  //
  // 기억은 **자기 id 로만 지우면 안 된다.** 앱이 만든 기억(예: /threads 의
  // "이 일 끝났어" 버튼)은 id 가 무작위라 표식이 없는데 시드 갈래를 참조할 수
  // 있다. 그러면 threads 삭제가 FK 에 막혀 지우기가 통째로 실패한다 —
  // 실제로 그렇게 한 번 막혔다. 가리키는 대상이 시드면 같이 지운다.
  const r1 = await sql`
    delete from memories
     where id::text like '5eed%'
        or thread_id::text like '5eed%'
        or experience_id::text like '5eed%'`;
  const r2 = await sql`delete from experience_skills where experience_id::text like '5eed%'`;
  const r3 = await sql`delete from experiences where id::text like '5eed%'`;
  const r4 = await sql`delete from threads where id::text like '5eed%'`;
  const r5 = await sql`delete from sessions where id::text like '5eed%'`;
  console.log(`지웠다 — 기억 ${r1.count} · 경험스킬 ${r2.count} · 경험 ${r3.count} · 갈래 ${r4.count} · 세션 ${r5.count}`);
  await sql.end();
  process.exit(0);
}

// ── 대상 유저 ────────────────────────────────────────────────
const [user] = await sql<{ id: string }[]>`
  select u.id from users u
  join experiences e on e.user_id = u.id
  group by u.id order by count(*) desc limit 1`;
if (!user) {
  console.error('경험을 가진 유저가 없다. 시드를 붙일 대상을 못 정한다.');
  await sql.end();
  process.exit(1);
}

// ── 생성 ─────────────────────────────────────────────────────
const now = Date.now();
type Th = { id: string; cat: string; title: string; started: number; last: number; n: number; status: string };
type Ex = { id: string; sess: string; at: number; cat: string; outcome: string; score: number; first: boolean; th: Th; summary: string };

const threads: Th[] = [];
const exps: Ex[] = [];
let ti = 0;
let ei = 0;

// 연 단위 모드: 1~4년 전에 세 개씩. 각 갈래에 경험 둘.
if (YEARS) {
  for (let y = 1; y <= 4; y++) {
    for (let k = 0; k < 3; k++) {
      const kind = KINDS[(y * 3 + k) % KINDS.length];
      // 같은 해 안에서도 조금 벌린다 — 반경이 겹치는지 보려면 붙어 있어야 한다.
      const start = now - (y * 365 + k * 25) * DAY;
      const th: Th = {
        id: sid(3, 5000 + ti++),
        cat: kind.cat,
        title: `${y}년 전 · ${kind.titles[k % kind.titles.length]}`,
        started: start,
        last: start + 20 * DAY,
        n: 2,
        status: y >= 3 ? 'abandoned' : 'completed',
      };
      threads.push(th);
      for (let e = 0; e < 2; e++) {
        const at = start + e * 18 * DAY;
        exps.push({
          id: sid(2, 5000 + ei),
          sess: sid(1, 5000 + ei),
          at,
          cat: kind.cat,
          outcome: e === 1 ? 'success' : 'partial',
          score: e === 1 ? 72 : 40,
          first: e === 0,
          th,
          summary: `${th.title} — ${pick(VERBS)}`,
        });
        ei++;
      }
    }
  }
}

for (let d = YEARS ? -1 : DAYS; d >= 0; d--) {
  const dayStart = now - d * DAY;
  const dow = new Date(dayStart).getDay();
  // 주말엔 덜 한다. 하루 0~5세션.
  const n = dow === 0 || dow === 6 ? int(0, 2) : int(1, 5);

  for (let s = 0; s < n; s++) {
    const kind = pick(KIND_POOL);

    // 그 분야의 살아있는 갈래에 붙거나, 새 갈래를 연다.
    // 최근 3주 안에 손댄 갈래만 후보다 — 그래야 오래된 갈래가 자연히 놓인다.
    const open = threads.filter((t) => t.cat === kind.cat && dayStart - t.last < 21 * DAY);
    let th: Th;
    if (open.length > 0 && rnd() < 0.72) {
      th = pick(open);
    } else {
      th = { id: sid(3, ti++), cat: kind.cat, title: pick(kind.titles), started: dayStart, last: dayStart, n: 0, status: 'active' };
      threads.push(th);
    }

    const at = dayStart + int(9, 23) * 3600000 + int(0, 59) * 60000;
    th.last = Math.max(th.last, at);
    th.n++;

    const outcome = pick(OUTCOMES);
    exps.push({
      id: sid(2, ei),
      sess: sid(1, ei),
      at,
      cat: kind.cat,
      outcome,
      // 기억 점수는 결과에 따라 치우친다 — 전부 균등하면 위성 반경·광도가 안 갈린다.
      score: outcome === 'success' ? int(45, 95) : outcome === 'partial' ? int(25, 70) : int(5, 45),
      first: rnd() < 0.18,
      th,
      summary: `${th.title} — ${pick(kind.titles)} 관련해서 ${pick(VERBS)}`,
    });
    ei++;
  }
}

// 갈래 마감. 오래 손 안 댄 것은 놓았거나(abandoned) 끝냈다(completed).
// 연 단위 모드는 위에서 이미 정해뒀다.
for (const t of YEARS ? [] : threads) {
  const idle = (now - t.last) / DAY;
  if (idle > 30) t.status = rnd() < 0.55 ? 'abandoned' : 'completed';
  else if (idle > 10 && rnd() < 0.4) t.status = 'completed';
}

// 기억. 점수 60 이상이거나 갈래를 끝낸 경험에서 나온다(엔진 규칙과 같다).
//
// **갈래당 하나로 모은다.** 예전에는 자격을 얻은 경험마다 기억을 하나씩
// 만들었는데, 엔진은 그러지 않는다 — 같은 갈래면 있던 기억에 근거를 더하고
// occurred_at 은 처음 것 그대로 둔다(memory-recheck 의 append 분기).
// 지도가 "별 하나 = 갈래 하나"를 전제로 그리므로, 안 모으면 한 갈래가 별
// 셋으로 뜬다.
const qualified = exps.filter(
  (e) => e.score >= 60 || (e.th.status === 'completed' && e.at === e.th.last),
);
const byThread = new Map<string, typeof qualified>();
for (const e of qualified) {
  const list = byThread.get(e.th.id) ?? [];
  list.push(e);
  byThread.set(e.th.id, list);
}
const mems = [...byThread.values()].map((list, i) => {
  // 시간 순. 첫 번째가 이 기억이 생긴 시점이고 그 자리는 안 움직인다.
  const sorted = [...list].sort((a, b) => a.at - b.at);
  const triggerOf = (e: (typeof sorted)[number]) =>
    e.th.status === 'completed' && e.at === e.th.last
      ? 'thread_complete'
      : e.first
        ? 'new_skill'
        : pick(TRIGGERS);
  const triggers = [...new Set(sorted.map(triggerOf))];
  return {
    id: sid(4, i),
    exp: sorted[0],
    all: sorted,
    // 방향·이심률은 가장 센 것 하나가 정한다. 저장은 전부(triggers).
    trigger: strongest(triggers),
    triggers,
    // 근거가 쌓일수록 중요해진다 — 엔진의 memoryImportance 와 같은 방향이다.
    importance: Math.max(
      1,
      Math.min(10, Math.round(Math.max(...sorted.map((e) => e.score)) / 11) + sorted.length - 1),
    ),
  };
});

console.log(`유저 ${user.id.slice(0, 8)} · ${YEARS ? '1~4년 전 (연 단위)' : `${DAYS}일치`}`);
console.log(`  세션·경험 ${exps.length} · 갈래 ${threads.length} · 기억 ${mems.length}`);
const byStatus = threads.reduce<Record<string, number>>((a, t) => ((a[t.status] = (a[t.status] ?? 0) + 1), a), {});
console.log(`  갈래 상태 ${JSON.stringify(byStatus)}`);
const byCat = threads.reduce<Record<string, number>>((a, t) => ((a[t.cat] = (a[t.cat] ?? 0) + 1), a), {});
console.log(`  갈래 분야 ${JSON.stringify(byCat)}`);

if (!APPLY) {
  console.log('\n미리보기다. 넣으려면 --apply, 되돌리려면 --clear.');
  await sql.end();
  process.exit(0);
}

// FK 순서: sessions → threads → experiences → experience_skills → memories
await sql`insert into sessions ${sql(
  exps.map((e) => ({
    id: e.sess,
    user_id: user.id,
    started_at: new Date(e.at),
    ended_at: new Date(e.at + int(10, 180) * 60000),
    duration_min: int(10, 180),
    close_reason: 'idle',
    primary_category: e.cat,
    activity_score: int(20, 95),
    unique_domains: int(1, 9),
    switch_count: int(0, 12),
    compressed_log: sql.json({ seed: true }),
    domains: sql.json({ 'seed.local': 600 }),
    processed_at: new Date(e.at),
  })),
)}`;

await sql`insert into threads ${sql(
  threads.map((t) => ({
    id: t.id,
    user_id: user.id,
    title: t.title,
    category: t.cat,
    status: t.status,
    started_at: new Date(t.started),
    last_activity_at: new Date(t.last),
    completed_at: t.status === 'completed' ? new Date(t.last) : null,
    experience_count: t.n,
  })),
)}`;

for (let i = 0; i < exps.length; i += 500) {
  await sql`insert into experiences ${sql(
    exps.slice(i, i + 500).map((e) => ({
      id: e.id,
      user_id: user.id,
      session_id: e.sess,
      thread_id: e.th.id,
      occurred_at: new Date(e.at),
      summary: e.summary,
      detail: `${e.summary}. 세부 내용은 시드 데이터라 비어 있다.`,
      category: e.cat,
      outcome: e.outcome,
      is_first_time: e.first,
      memory_score: e.score,
    })),
  )}`;
}

const eskills = exps.flatMap((e) => {
  const kind = KINDS.find((k) => k.cat === e.cat)!;
  const n = Math.min(kind.skills.length, int(1, 3));
  return kind.skills.slice(0, n).map(([name, domain]) => ({
    experience_id: e.id,
    skill_name: name,
    weight: int(1, 10),
    domain,
  }));
});
for (let i = 0; i < eskills.length; i += 500) {
  await sql`insert into experience_skills ${sql(eskills.slice(i, i + 500))} on conflict do nothing`;
}

await sql`insert into memories ${sql(
  mems.map((m) => ({
    id: m.id,
    user_id: user.id,
    thread_id: m.exp.th.id,
    experience_id: m.exp.id,
    // 근거 전부. 화면이 테두리(sourceIds)로 "그중 뭐가 남겼나"를 가른다.
    experience_ids: m.all.map((e) => e.id),
    occurred_at: new Date(m.exp.at),
    title: `${m.exp.th.title} — ${m.exp.outcome === 'success' ? '해냈다' : '남은 것이 있다'}`,
    body: m.exp.summary,
    importance: m.importance,
    trigger: m.trigger,
    triggers: m.triggers,
  })),
)}`;

console.log('\n넣었다. 되돌리려면 --clear.');
await sql.end();
// postgres.js 는 커넥션을 유지해 이벤트 루프가 안 빈다. 명시적으로 끝낸다.
process.exit(0);
