// "잠긴 갈래를 후보로 주면 모델이 붙이나"를 만들기 전에 확인한다.
//   실행: npx tsx --tsconfig scripts/tsconfig.json scripts/probe-revive.mts
//
// completed 가 83회 연속 false 였던 전례가 있다. 프롬프트가 부정 신호를 겹겹이
// 두면 모델은 안전한 쪽(new)으로 도망친다 — 그렇다면 후보를 골라 넣는 장치를
// 아무리 잘 만들어도 헛돈다. 코드를 쓰기 전에 그것부터 잰다.
//
// DB 는 읽기만 한다. 잠긴 갈래는 실데이터에 없으므로 문맥에만 지어 넣는다
// (프롬프트 인자일 뿐이라 저장되지 않는다).
import fs from 'node:fs';
import postgres from 'postgres';
import Anthropic from '@anthropic-ai/sdk';
import {
  MODEL,
  TOOL_NAME,
  RECORD_EXPERIENCE_TOOL,
  SYSTEM_PROMPT_V9,
  buildUserMessage,
} from '../src/lib/experience-engine';

const env = fs.readFileSync('.env.local', 'utf8');
const pick = (k: string) => env.match(new RegExp(`${k}="?([^"\n]+)"?`))?.[1] ?? '';
process.env.ANTHROPIC_API_KEY ||= pick('ANTHROPIC_API_KEY');
const sql = postgres(pick('DATABASE_URL'), { prepare: false });
const client = new Anthropic();

const [user] = await sql<{ id: string }[]>`
  select u.id from users u join experiences e on e.user_id = u.id
  group by u.id order by count(*) desc limit 1`;
const skills = await sql`
  select distinct on (es.skill_name) es.skill_name as name, e.occurred_at as last_used_at
  from experience_skills es join experiences e on e.id = es.experience_id
  where e.user_id = ${user.id} order by es.skill_name, e.occurred_at desc`;
const recent = await sql`
  select summary, category, outcome from experiences
  where user_id = ${user.id} order by occurred_at desc limit 3`;
const active = await sql`
  select t.id, t.title, t.category, t.experience_count from threads t
  where t.user_id = ${user.id} and t.status = 'active'
  order by t.last_activity_at desc limit 5`;

const DORMANT_ID = '00000000-0000-4000-8000-000000000001';

/** 잠긴 갈래 절을 진행 중 목록 **뒤에** 끼워 넣는다. 실제 구현도 같은 자리다. */
function withDormant(base: string, block: string | null): string {
  if (!block) return base;
  return base.replace('\n## 이번 세션', `\n${block}\n\n## 이번 세션`);
}

const DORMANT_BLOCK = [
  '### 잠긴 작업(thread) — 30일 넘게 손 안 댔다',
  `- [${DORMANT_ID}] Redis 캐싱 도입 (dev, 경험 6건, 마지막 활동 412일 전)`,
  '  마지막: 캐시 무효화 전략을 정하다 말았다',
].join('\n');

/** 이번 세션 — 그 잠긴 일을 다시 집어든 모양새다. */
const SESSION: {
  primaryCategory: string;
  durationMin: number;
  closeReason: 'idle';
  activityScore: number;
  domains: Record<string, number>;
  compressedLog: unknown;
} = {
  primaryCategory: 'dev',
  durationMin: 58,
  closeReason: 'idle' as const,
  activityScore: 130,
  domains: { 'localhost': 1900, 'redis.io': 1100, 'github.com': 600 },
  compressedLog: {
    tags: [],
    queries: ['redis 캐시 무효화 전략', 'ttl vs 명시적 invalidation'],
    segments: [
      { title: 'Redis — Key eviction', domain: 'redis.io', category: 'docs' },
      { title: 'Project NA — 캐시 무효화 붙이기', domain: 'localhost', category: 'dev' },
      { title: 'Kwon812/mia — cache PR', domain: 'github.com', category: 'dev' },
    ],
  },
};

async function ask(label: string, block: string | null, extraRule: string) {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    temperature: 0,
    system: SYSTEM_PROMPT_V9 + extraRule,
    tools: [RECORD_EXPERIENCE_TOOL],
    tool_choice: { type: 'tool', name: TOOL_NAME },
    messages: [
      {
        role: 'user',
        content: withDormant(
          buildUserMessage(
            SESSION,
            skills.map((s: any) => ({ name: s.name, lastUsedAt: s.last_used_at })),
            recent as any,
            active.map((t: any) => ({
              id: t.id,
              title: t.title,
              category: t.category,
              experienceCount: t.experience_count,
            })),
          ),
          block,
        ),
      },
    ],
  });
  const tu: any = res.content.find((b: any) => b.type === 'tool_use' && b.name === TOOL_NAME);
  const n = tu?.input ?? {};
  const id = n.thread?.existing_thread_id;
  return {
    조건: label,
    작업: n.thread?.action,
    붙은곳:
      n.thread?.action === 'new'
        ? `(새로) ${String(n.thread?.title ?? '').slice(0, 20)}`
        : id === DORMANT_ID
          ? '★ 잠긴 갈래'
          : String(active.find((t: any) => t.id === id)?.title ?? '(없는 id)').slice(0, 20),
    outcome: n.outcome,
  };
}

// 규칙 문장이 있어야 붙는지, 목록만 줘도 붙는지 가른다. 문장이 필요 없다면
// 프롬프트를 덜 건드리는 편이 낫다 — 골든셋 분포를 흔들 위험이 그만큼 준다.
const RULE = `

  "잠긴 작업" 목록에 있는 항목에도 attach 할 수 있다. 그 일을 **다시 시작한 게
  분명할 때만** 붙인다 — 도구나 사이트가 같다는 것만으로는 부족하고, 그때 하다
  만 것의 다음 단계여야 한다.`;

const out = [
  await ask('① 잠긴 갈래 안 보여줌 (지금 상태)', null, ''),
  await ask('② 목록에만 넣음 (규칙 문장 없음)', DORMANT_BLOCK, ''),
  await ask('③ 목록 + 규칙 문장', DORMANT_BLOCK, RULE),
];
console.table(out);

// ── 2단계: 잠긴 갈래 다섯 개 중 하나를 겨냥한다 ──
//
// 1단계는 "붙일 의사가 있나"만 봤다. 후보가 하나뿐이라 고를 것도 없었다.
// 실제로는 여러 개가 후보로 올라오고, 그중에는 같은 도구를 쓰지만 다른 일도
// 섞인다(Redis 캐싱 vs Redis Pub/Sub). 그걸 가르는지가 진짜 시험이다.
const POOL = [
  { id: 'd1', title: 'Redis 캐싱 도입', cat: 'dev', n: 6, days: 412, last: '캐시 무효화 전략을 정하다 말았다' },
  { id: 'd2', title: 'Redis Pub/Sub 실험', cat: 'dev', n: 3, days: 380, last: '채널 구독 예제를 돌려보고 끝냈다' },
  { id: 'd3', title: 'Postgres 인덱스 튜닝', cat: 'dev', n: 5, days: 250, last: '복합 인덱스 순서를 바꿔 재보다 말았다' },
  { id: 'd4', title: 'Figma 디자인 시스템 정리', cat: 'design', n: 4, days: 190, last: '컴포넌트 이름 규칙을 정하다 말았다' },
  { id: 'd5', title: '일본어 N2 단어장', cat: 'study', n: 9, days: 95, last: '3주차 단어를 외우다 말았다' },
];
const uuid = (i: number) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
const POOL_BLOCK = [
  '### 잠긴 작업(thread) — 30일 넘게 손 안 댔다',
  ...POOL.flatMap((d, i) => [
    `- [${uuid(i)}] ${d.title} (${d.cat}, 경험 ${d.n}건, 마지막 활동 ${d.days}일 전)`,
    `  마지막: ${d.last}`,
  ]),
].join('\n');

const TARGETS: { name: string; want: string; sess: typeof SESSION }[] = [
  {
    name: '캐시 무효화를 이어서 함',
    want: 'Redis 캐싱 도입',
    sess: { ...SESSION,
      domains: { localhost: 1900, 'redis.io': 1100, 'github.com': 600 },
      compressedLog: { tags: [], queries: ['redis 캐시 무효화 ttl'], segments: [
        { title: 'Redis — Key eviction / TTL', domain: 'redis.io', category: 'docs' },
        { title: 'Project NA — 캐시 무효화 붙이기', domain: 'localhost', category: 'dev' },
      ] } },
  },
  {
    name: '같은 도구지만 Pub/Sub 쪽',
    want: 'Redis Pub/Sub 실험',
    sess: { ...SESSION,
      domains: { localhost: 1500, 'redis.io': 1400 },
      compressedLog: { tags: [], queries: ['redis pubsub 채널 패턴 구독'], segments: [
        { title: 'Redis — Pub/Sub PSUBSCRIBE', domain: 'redis.io', category: 'docs' },
        { title: 'Project NA — 알림 채널 구독 붙이기', domain: 'localhost', category: 'dev' },
      ] } },
  },
  {
    name: '인덱스 튜닝 재개',
    want: 'Postgres 인덱스 튜닝',
    sess: { ...SESSION,
      domains: { 'supabase.com': 1700, 'postgresql.org': 900 },
      compressedLog: { tags: [], queries: ['postgres 복합 인덱스 순서 explain'], segments: [
        { title: 'PostgreSQL — Multicolumn Indexes', domain: 'postgresql.org', category: 'docs' },
        { title: 'SQL Editor — explain analyze', domain: 'supabase.com', category: 'dev' },
      ] } },
  },
  {
    name: '어느 것과도 무관 (새 일이어야 한다)',
    want: '(새 갈래)',
    sess: { ...SESSION, primaryCategory: 'shopping',
      domains: { 'www.coupang.com': 2000 },
      compressedLog: { tags: [], queries: ['27인치 4k 모니터 비교'], segments: [
        { title: '모니터 - 쿠팡!', domain: 'www.coupang.com', category: 'shopping' },
      ] } },
  },
];

const out2: Record<string, unknown>[] = [];
for (const t of TARGETS) {
  const res = await client.messages.create({
    model: MODEL, max_tokens: 1024, temperature: 0,
    system: SYSTEM_PROMPT_V9 + RULE,
    tools: [RECORD_EXPERIENCE_TOOL], tool_choice: { type: 'tool', name: TOOL_NAME },
    messages: [{ role: 'user', content: withDormant(
      buildUserMessage(t.sess,
        skills.map((s: any) => ({ name: s.name, lastUsedAt: s.last_used_at })),
        recent as any,
        active.map((a: any) => ({ id: a.id, title: a.title, category: a.category, experienceCount: a.experience_count })),
      ), POOL_BLOCK) }],
  });
  const tu: any = res.content.find((b: any) => b.type === 'tool_use' && b.name === TOOL_NAME);
  const n = tu?.input ?? {};
  const id = n.thread?.existing_thread_id;
  const idx = POOL.findIndex((_, i) => uuid(i) === id);
  const got = n.thread?.action === 'new'
    ? `(새로) ${String(n.thread?.title ?? '').slice(0, 18)}`
    : idx >= 0 ? POOL[idx].title
      : String(active.find((a: any) => a.id === id)?.title ?? '(없는 id)').slice(0, 18);
  out2.push({
    세션: t.name,
    기대: t.want,
    실제: got,
    맞나: got === t.want || (t.want === '(새 갈래)' && n.thread?.action === 'new') ? '○' : '✗',
  });
}
console.log('\n잠긴 갈래 5개 중 하나 겨냥');
console.table(out2);

// ── 3단계: 후보 셋이 **전부 비슷할 때** ──
//
// 2단계 풀에는 Figma·일본어처럼 명백히 무관한 것이 섞여 있었는데, 실제로는
// 그런 게 후보에 오르지 않는다 — FTS 가 어휘 겹침으로 골라 보내므로 화면에
// 도착하는 셋은 서로 닮아 있다. 그 상태에서도 갈리는지가 진짜 조건이다.
const NEAR = [
  { title: 'Redis 캐싱 도입', cat: 'dev', n: 6, days: 412, last: '무효화 전략을 정하다 말았다' },
  { title: 'Redis 캐시 히트율 모니터링', cat: 'dev', n: 4, days: 300, last: '히트율 지표를 대시보드에 올리다 말았다' },
  { title: '캐시 계층 설계 문서화', cat: 'docs', n: 3, days: 210, last: '계층 다이어그램을 그리다 말았다' },
];
const nuuid = (i: number) => `00000000-0000-4000-8000-${String(i + 11).padStart(12, '0')}`;
const NEAR_BLOCK = [
  '### 잠긴 작업(thread) — 30일 넘게 손 안 댔다',
  ...NEAR.flatMap((d, i) => [
    `- [${nuuid(i)}] ${d.title} (${d.cat}, 경험 ${d.n}건, 마지막 활동 ${d.days}일 전)`,
    `  마지막: ${d.last}`,
  ]),
].join('\n');

const NEAR_CASES: { name: string; want: string; sess: typeof SESSION }[] = [
  {
    name: '무효화 전략을 정하고 코드에 붙임',
    want: 'Redis 캐싱 도입',
    sess: { ...SESSION, domains: { localhost: 2000, 'redis.io': 900 },
      compressedLog: { tags: [], queries: ['redis 캐시 무효화 ttl vs 명시적 삭제'], segments: [
        { title: 'Redis — Key eviction / TTL', domain: 'redis.io', category: 'docs' },
        { title: 'Project NA — invalidateCache 붙이기', domain: 'localhost', category: 'dev' },
      ] } },
  },
  {
    name: '히트율 지표를 대시보드에 올림',
    want: 'Redis 캐시 히트율 모니터링',
    sess: { ...SESSION, domains: { 'grafana.com': 1600, localhost: 900 },
      compressedLog: { tags: [], queries: ['redis keyspace hits misses 지표'], segments: [
        { title: 'Grafana — Redis dashboard 패널 추가', domain: 'grafana.com', category: 'dev' },
        { title: 'Project NA — /metrics 캐시 히트율 노출', domain: 'localhost', category: 'dev' },
      ] } },
  },
  {
    name: '캐시 설계 문서를 마저 씀',
    want: '캐시 계층 설계 문서화',
    sess: { ...SESSION, primaryCategory: 'docs', domains: { 'app.notion.com': 2200 },
      compressedLog: { tags: [], queries: ['캐시 계층 다이어그램 표기'], segments: [
        { title: '캐시 계층 설계 — L1/L2 다이어그램 | Notion', domain: 'app.notion.com', category: 'docs' },
        { title: '무효화 정책 정리 | Notion', domain: 'app.notion.com', category: 'docs' },
      ] } },
  },
];

const out3: Record<string, unknown>[] = [];
for (const c of NEAR_CASES) {
  const res = await client.messages.create({
    model: MODEL, max_tokens: 1024, temperature: 0,
    system: SYSTEM_PROMPT_V9 + RULE,
    tools: [RECORD_EXPERIENCE_TOOL], tool_choice: { type: 'tool', name: TOOL_NAME },
    messages: [{ role: 'user', content: withDormant(
      buildUserMessage(c.sess,
        skills.map((s: any) => ({ name: s.name, lastUsedAt: s.last_used_at })),
        recent as any,
        active.map((a: any) => ({ id: a.id, title: a.title, category: a.category, experienceCount: a.experience_count })),
      ), NEAR_BLOCK) }],
  });
  const tu: any = res.content.find((b: any) => b.type === 'tool_use' && b.name === TOOL_NAME);
  const n = tu?.input ?? {};
  const id = n.thread?.existing_thread_id;
  const idx = NEAR.findIndex((_, i) => nuuid(i) === id);
  const got = n.thread?.action === 'new'
    ? `(새로) ${String(n.thread?.title ?? '').slice(0, 20)}`
    : idx >= 0 ? NEAR[idx].title
      : String(active.find((a: any) => a.id === id)?.title ?? '(없는 id)').slice(0, 20);
  out3.push({ 세션: c.name, 기대: c.want, 실제: got, 맞나: got === c.want ? '○' : '✗' });
}
console.log('\n후보 셋이 전부 비슷할 때 (FTS 가 실제로 보낼 모양)');
console.table(out3);

await sql.end();
process.exit(0);
