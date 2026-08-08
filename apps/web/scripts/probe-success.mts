// "success 가 안 나오는 게 프롬프트 탓인가 데이터 탓인가"를 가른다.
//   실행: npx tsx --tsconfig scripts/tsconfig.json scripts/probe-success.mts
//
// 실운영 76회 중 success 0건인데, 골든셋에서는 여러 케이스가 success 를 낸다.
// 그렇다면 프롬프트가 막고 있는 게 아니라 실제 세션이 그렇게 안 생겼을
// 가능성이 크다. 문맥(스킬·최근 경험·갈래)은 실데이터 그대로 두고 세션만
// 바꿔가며, 어디서부터 success 가 나오는지 경계를 찾는다.
//
// DB 는 읽기만 한다.
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

const T = (h: number, m = 0) =>
  new Date(Date.UTC(2026, 7, 6, h - 9, m)).toISOString().replace('Z', '+09:00');
const seg = (domain: string, category: string, title: string, h: number, m: number, dur: number) =>
  ({ domain, category, title, start: T(h, m), end: T(h, m + dur) });

type Sess = {
  primaryCategory: string;
  durationMin: number;
  closeReason: 'idle';
  activityScore: number;
  domains: Record<string, number>;
  compressedLog: unknown;
};

// 위에서 아래로 갈수록 "실제 세션"에 가까워진다. 어느 줄에서 success 가
// 꺼지는지가 곧 경계다.
const CASES: { name: string; sess: Sess }[] = [
  {
    name: '① 한 주제, 막힘 → 해결 → 확인까지',
    sess: { primaryCategory: 'dev', durationMin: 44, closeReason: 'idle', activityScore: 520,
      domains: { 'stackoverflow.com': 900, localhost: 1740 },
      compressedLog: { tags: [], queries: [{ q: 'drizzle onConflictDoUpdate 문법', n: 2, first: T(14, 0), last: T(14, 12) }],
        segments: [
          seg('stackoverflow.com', 'dev', 'drizzle upsert 예제', 14, 0, 15),
          seg('localhost', 'dev', 'Project NA — upsert 적용 후 동작 확인', 14, 15, 29),
        ] } },
  },
  {
    name: '② 한 주제 + 배포·확인까지',
    sess: { primaryCategory: 'dev', durationMin: 52, closeReason: 'idle', activityScore: 480,
      domains: { 'github.com': 900, 'vercel.com': 1400, localhost: 820 },
      compressedLog: { tags: [], queries: [],
        segments: [
          seg('github.com', 'dev', 'Project NA — PR #42 merge', 15, 0, 9),
          seg('vercel.com', 'dev', 'Deployment — Building → Ready', 15, 9, 23),
          seg('localhost', 'dev', 'Project NA — 정상 동작 확인', 15, 32, 20),
        ] } },
  },
  {
    name: '③ 한 주제인데 확인 없이 끝',
    sess: { primaryCategory: 'dev', durationMin: 40, closeReason: 'idle', activityScore: 400,
      domains: { localhost: 2400 },
      compressedLog: { tags: [], queries: [{ q: 'zod transform', n: 1, first: T(16, 0), last: T(16, 2) }],
        segments: [seg('localhost', 'dev', 'Project NA — 대사 길이 자르기 구현', 16, 0, 40)] } },
  },
  {
    name: '④ 두 주제, 둘 다 확인까지',
    sess: { primaryCategory: 'dev', durationMin: 61, closeReason: 'idle', activityScore: 560,
      domains: { localhost: 2000, 'supabase.com': 1660 },
      compressedLog: { tags: [], queries: [],
        segments: [
          seg('localhost', 'dev', 'Project NA — 확대 붙이고 동작 확인', 17, 0, 30),
          seg('supabase.com', 'dev', 'SQL Editor — 인덱스 생성 후 확인', 17, 30, 31),
        ] } },
  },
  {
    name: '⑤ 실제 세션 모양 — 여러 사이트를 오가며 확인',
    sess: { primaryCategory: 'dev', durationMin: 57, closeReason: 'idle', activityScore: 430,
      domains: { localhost: 1200, 'supabase.com': 900, 'claude.ai': 800, 'github.com': 520 },
      compressedLog: { tags: [], queries: [],
        segments: [
          seg('claude.ai', 'ai', 'Project NA 기술 아키텍처 논의', 18, 0, 14),
          seg('localhost', 'dev', 'Project NA', 18, 14, 16),
          seg('supabase.com', 'dev', 'Table editor — experiences', 18, 30, 15),
          seg('github.com', 'dev', 'Kwon812/mia', 18, 45, 12),
        ] } },
  },
];

const out: Record<string, unknown>[] = [];
for (const c of CASES) {
  const res = await client.messages.create({
    model: MODEL, max_tokens: 1024, temperature: 0,
    system: SYSTEM_PROMPT_V9,
    tools: [RECORD_EXPERIENCE_TOOL], tool_choice: { type: 'tool', name: TOOL_NAME },
    messages: [{ role: 'user', content: buildUserMessage(
      c.sess,
      skills.map((s: any) => ({ name: s.name, lastUsedAt: s.last_used_at })),
      recent as any,
      active.map((t: any) => ({ id: t.id, title: t.title, category: t.category, experienceCount: t.experience_count })),
    ) }],
  });
  const tu: any = res.content.find((b: any) => b.type === 'tool_use' && b.name === TOOL_NAME);
  const n = tu?.input ?? {};
  out.push({
    세션: c.name,
    outcome: n.outcome === 'success' ? '★ success' : n.outcome,
    category: n.category,
    요약: String(n.summary ?? '').slice(0, 40),
  });
}
console.table(out);

await sql.end();
process.exit(0);
