// FTS 가 잠긴 갈래 후보를 제대로 골라내는지 잰다.
//   실행: npx tsx scripts/probe-candidates.mts
//
// probe-revive.mts 는 "후보가 이미 골라진 다음"을 가정하고 모델 판단만 봤다.
// 여기서는 그 앞단 — 950개 중에서 셋을 뽑는 부분 — 이 맞는지 본다.
//
// 잠긴 갈래가 실데이터에 없으므로 5eed 표식을 단 픽스처를 넣었다가 끝에 지운다.
// 어휘가 겹치는 이웃(Redis 캐싱 / Redis Pub-Sub / 캐시 문서화)을 일부러 섞는다 —
// 서로 안 닮은 것만 있으면 어떤 방식이든 맞히므로 시험이 안 된다.
import fs from 'node:fs';
import postgres from 'postgres';

const env = fs.readFileSync('.env.local', 'utf8');
const sql = postgres(env.match(/DATABASE_URL="?([^"\n]+)"?/)?.[1] ?? '', { prepare: false });

const [user] = await sql<{ id: string }[]>`
  select u.id from users u join experiences e on e.user_id = u.id
  group by u.id order by count(*) desc limit 1`;

const sid = (kind: number, i: number) =>
  `5eed${kind.toString(16).padStart(4, '0')}-0000-4000-8000-${i.toString(16).padStart(12, '0')}`;

/** 잠긴 갈래 픽스처. summaries 가 곧 색인 대상이다. */
const FIXTURES = [
  { title: 'Redis 캐싱 도입', cat: 'dev', days: 412,
    sums: ['Redis 를 붙여 조회 응답을 캐싱하기 시작했다', '캐시 무효화 전략을 TTL 로 갈지 명시적 삭제로 갈지 정하다 말았다'] },
  { title: 'Redis Pub/Sub 실험', cat: 'dev', days: 380,
    sums: ['Redis Pub/Sub 채널 구독 예제를 돌려봤다', 'PSUBSCRIBE 패턴 구독으로 알림을 받아봤다'] },
  { title: '캐시 계층 설계 문서화', cat: 'docs', days: 210,
    sums: ['L1/L2 캐시 계층 다이어그램을 그리다 말았다', '무효화 정책을 문서에 정리하려다 멈췄다'] },
  { title: 'Postgres 인덱스 튜닝', cat: 'dev', days: 250,
    sums: ['복합 인덱스 순서를 바꿔가며 explain analyze 를 재봤다', 'GIN 인덱스로 전문검색을 붙일지 알아봤다'] },
  { title: 'Figma 디자인 시스템 정리', cat: 'etc', days: 190,
    sums: ['Figma 컴포넌트 이름 규칙을 정하다 말았다', '색 토큰을 변수로 뽑아봤다'] },
  { title: '일본어 N2 단어장', cat: 'study', days: 95,
    sums: ['3주차 단어를 Anki 로 외우다 말았다', '문법 파트 예문을 정리했다'] },
  { title: '메타버스 행사 준비', cat: 'community', days: 140,
    sums: ['ZEP 맵을 만들어 팀 자리를 배치했다', '아이디어톤 발표 순서를 정했다'] },
  { title: 'Vercel 배포 파이프라인 정리', cat: 'dev', days: 320,
    sums: ['GitHub Actions 에서 Vercel 로 배포하는 흐름을 정리했다', '프리뷰 배포 도메인을 붙이다 말았다'] },
];

const APPLY = !process.argv.includes('--keep');

// ── 픽스처 넣기 ─────────────────────────────────────────────
const DAY = 86400000;
const now = Date.now();
let ei = 9000;
await sql.begin(async (tx) => {
  for (const [i, f] of FIXTURES.entries()) {
    const tid = sid(3, 9000 + i);
    const start = new Date(now - (f.days + 20) * DAY);
    const last = new Date(now - f.days * DAY);
    await tx`insert into threads (id, user_id, title, category, status, started_at, last_activity_at, experience_count)
             values (${tid}, ${user.id}, ${f.title}, ${f.cat}, 'abandoned', ${start}, ${last}, ${f.sums.length})`;
    for (const [j, sum] of f.sums.entries()) {
      const at = new Date(now - (f.days + 10 - j * 5) * DAY);
      await tx`insert into sessions (id, user_id, started_at, ended_at, duration_min, close_reason,
                 primary_category, activity_score, unique_domains, compressed_log, domains, processed_at)
               values (${sid(1, ei)}, ${user.id}, ${at}, ${at}, 40, 'idle', ${f.cat}, 80, 3,
                       ${sql.json({ seed: true })}, ${sql.json({ 'seed.local': 600 })}, ${at})`;
      await tx`insert into experiences (id, user_id, session_id, thread_id, occurred_at, summary, category, outcome, memory_score)
               values (${sid(2, ei)}, ${user.id}, ${sid(1, ei)}, ${tid}, ${at}, ${sum}, ${f.cat}, 'partial', 30)`;
      ei += 1;
    }
  }
});
console.log(`잠긴 갈래 ${FIXTURES.length}개 넣음 (경험 ${ei - 9000}건)\n`);

// ── 후보 조회 — 실제로 쓸 쿼리 ───────────────────────────────
const STOP = new Set(['the','and','com','www','https','확인','상태','프로젝트','작업','페이지','notion','figma','github','google']);
const toks = (s: string) =>
  [...new Set((s ?? '').toLowerCase().split(/[^a-z0-9가-힣]+/).filter((w) => w.length >= 2 && !STOP.has(w)))];

async function candidates(titles: string[], queries: string[]) {
  const tk = [...new Set([...titles, ...queries].flatMap(toks))].slice(0, 40);
  if (tk.length === 0) return [];
  const q = tk.join(' | ');
  return sql<{ title: string; rank: number; days: number }[]>`
    select t.title,
           round(sum(ts_rank(to_tsvector('simple', e.summary), to_tsquery('simple', ${q})))::numeric, 4) as rank,
           extract(day from now() - t.last_activity_at)::int as days
      from threads t
      join experiences e on e.thread_id = t.id
     where t.user_id = ${user.id}
       and t.status = 'abandoned'
       and (to_tsvector('simple', e.summary) @@ to_tsquery('simple', ${q})
         or to_tsvector('simple', t.title)  @@ to_tsquery('simple', ${q}))
     group by t.id, t.title, t.last_activity_at
     order by rank desc
     limit 3`;
}

const CASES = [
  { name: '캐시 무효화를 이어서', want: 'Redis 캐싱 도입',
    titles: ['Redis — Key eviction / TTL', 'Project NA — invalidateCache 붙이기'], queries: ['redis 캐시 무효화 ttl'] },
  { name: 'Pub/Sub 쪽', want: 'Redis Pub/Sub 실험',
    titles: ['Redis — Pub/Sub PSUBSCRIBE', '알림 채널 구독 붙이기'], queries: ['redis pubsub 채널 패턴 구독'] },
  { name: '캐시 설계 문서 마저', want: '캐시 계층 설계 문서화',
    titles: ['캐시 계층 설계 — L1/L2 다이어그램 | Notion', '무효화 정책 정리'], queries: ['캐시 계층 다이어그램'] },
  { name: '인덱스 튜닝 재개', want: 'Postgres 인덱스 튜닝',
    titles: ['PostgreSQL — Multicolumn Indexes', 'explain analyze'], queries: ['postgres 복합 인덱스 순서'] },
  { name: '배포 파이프라인 재개', want: 'Vercel 배포 파이프라인 정리',
    titles: ['Vercel — Deployment 프리뷰 도메인', 'GitHub Actions — deploy.yml'], queries: ['vercel 프리뷰 배포 도메인'] },
  { name: '무관 (후보 없어야 함)', want: '(없음)',
    titles: ['27인치 4K 모니터 - 쿠팡!'], queries: ['모니터 주사율 비교'] },
];

const out: Record<string, unknown>[] = [];
for (const c of CASES) {
  const t0 = Date.now();
  const rows = await candidates(c.titles, c.queries);
  const ms = Date.now() - t0;
  const top = rows[0]?.title ?? '(없음)';
  out.push({
    세션: c.name,
    기대: c.want,
    '1위': top,
    '후보 3개': rows.map((r) => `${r.title}(${r.rank})`).join(' · ') || '없음',
    ms,
    맞나: top === c.want ? '○' : '✗',
  });
}
console.table(out.map(({ 세션, 기대, '1위': a, ms, 맞나 }) => ({ 세션, 기대, '1위': a, ms, 맞나 })));
console.log('\n후보 3개 전체:');
for (const o of out) console.log(`  ${o.세션}\n    ${o['후보 3개']}`);

// ── 치우기 ──────────────────────────────────────────────────
if (APPLY) {
  await sql`delete from memories where thread_id::text like '5eed%' or experience_id::text like '5eed%'`;
  await sql`delete from experience_skills where experience_id::text like '5eed%'`;
  await sql`delete from experiences where id::text like '5eed%'`;
  await sql`delete from threads where id::text like '5eed%'`;
  await sql`delete from sessions where id::text like '5eed%'`;
  console.log('\n픽스처 지움 (--keep 을 붙이면 남긴다)');
}

await sql.end();
process.exit(0);
