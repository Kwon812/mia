// "어떤 세션이면 갈래가 완결로 판정되나"를 실제 프롬프트로 재본다.
//   실행: npx tsx --tsconfig scripts/tsconfig.json scripts/probe-complete.mts
//
// DB 는 읽기만 한다 — 지금 살아 있는 갈래·스킬·최근 경험을 그대로 문맥으로
// 넣고, compressed_log 만 후보로 갈아끼운다. 그래야 "이 프롬프트가 이 문맥에서
// 무엇을 완결로 보는가"라는 질문에 답이 된다. 세션을 지어내서 새 문맥으로
// 돌리면 프롬프트가 아니라 내가 만든 이야기를 시험하는 꼴이 된다.
//
// 완결은 성격상 드물게 나와야 한다(프롬프트가 그렇게 못 박고 있다). 그래서
// 후보를 "확실히 끝남 → 애매 → 확실히 진행 중" 순으로 늘어놓고 경계가 어디서
// 갈리는지 본다.
import fs from 'node:fs';
import postgres from 'postgres';
import Anthropic from '@anthropic-ai/sdk';
import {
  MODEL,
  TOOL_NAME,
  RECORD_EXPERIENCE_TOOL,
  SYSTEM_PROMPT_V7,
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

// 목데이터(5eed)는 뺀다 — 지금 진짜로 붙들고 있는 일만 문맥이다.
const skills = await sql`
  select distinct on (es.skill_name) es.skill_name as name, e.occurred_at as last_used_at
  from experience_skills es join experiences e on e.id = es.experience_id
  where e.user_id = ${user.id} and e.id::text not like '5eed%'
  order by es.skill_name, e.occurred_at desc`;
const recent = await sql`
  select summary, category, outcome from experiences
  where user_id = ${user.id} and id::text not like '5eed%'
  order by occurred_at desc limit 3`;
const threads = await sql`
  select t.id, t.title, t.category, t.experience_count
  from threads t
  where t.user_id = ${user.id} and t.status = 'active' and t.id::text not like '5eed%'
  order by t.last_activity_at desc limit 5`;

console.log(`문맥 — 스킬 ${skills.length} · 최근경험 ${recent.length} · 살아있는 갈래 ${threads.length}`);
for (const t of threads) console.log(`  · ${t.title} (${t.category}, 경험 ${t.experience_count}건)`);
console.log('');

/** 후보 세션. compressed_log 는 확장이 만드는 모양을 흉내낸다. */
const CASES: { name: string; log: unknown; domains: Record<string, number>; min: number }[] = [
  {
    name: '① 배포하고 동작까지 확인',
    min: 52,
    domains: { 'vercel.com': 1400, 'github.com': 900, 'na.example.app': 800 },
    log: {
      visits: [
        { domain: 'github.com', title: 'Project NA — PR #42 merge', sec: 540 },
        { domain: 'vercel.com', title: 'Deployment — Building → Ready', sec: 1400 },
        { domain: 'na.example.app', title: '궤도 지도 — 정상 동작 확인', sec: 800 },
      ],
      queries: ['vercel deploy 실패시 롤백'],
    },
  },
  {
    name: '② 기능 붙이고 테스트 통과',
    min: 61,
    domains: { 'localhost:3000': 2100, 'github.com': 700 },
    log: {
      visits: [
        { domain: 'localhost:3000', title: 'threads 페이지 — 방향축 확인', sec: 2100 },
        { domain: 'github.com', title: 'Project NA — Actions: all checks passed', sec: 700 },
      ],
      queries: ['vitest snapshot 갱신'],
    },
  },
  {
    name: '③ 고치긴 했는데 남은 게 있다',
    min: 48,
    domains: { 'localhost:3000': 1800, 'supabase.com': 900 },
    log: {
      visits: [
        { domain: 'localhost:3000', title: '갈래 방향 수정 — 확인', sec: 1800 },
        { domain: 'supabase.com', title: 'SQL Editor — threads 조회', sec: 900 },
      ],
      queries: ['남은 것: 빈 갈래 처리', 'daily_logs experience_ids 재생성'],
    },
  },
  {
    name: '④ 문서만 읽고 적용 안 함',
    min: 44,
    domains: { 'nextjs.org': 1500, 'react.dev': 1100 },
    log: {
      visits: [
        { domain: 'nextjs.org', title: 'Docs — after() API', sec: 1500 },
        { domain: 'react.dev', title: 'useSyncExternalStore', sec: 1100 },
      ],
      queries: ['next after 백그라운드 처리'],
    },
  },
  {
    name: '⑤ 여러 주제를 오감',
    min: 70,
    domains: { 'github.com': 800, 'youtube.com': 900, 'supabase.com': 700, 'notion.so': 600 },
    log: {
      visits: [
        { domain: 'github.com', title: 'Project NA — 이슈 훑기', sec: 800 },
        { domain: 'youtube.com', title: '아이디어톤 발표 영상', sec: 900 },
        { domain: 'supabase.com', title: 'Table editor', sec: 700 },
        { domain: 'notion.so', title: '회고 정리', sec: 600 },
      ],
      queries: ['zep 메타버스', 'supabase rls'],
    },
  },
];

const out: Record<string, unknown>[] = [];

for (const c of CASES) {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    temperature: 0, // 판정이다. 같은 입력이 같은 답을 내야 비교가 성립한다.
    system: SYSTEM_PROMPT_V7,
    tools: [RECORD_EXPERIENCE_TOOL],
    tool_choice: { type: 'tool', name: TOOL_NAME },
    messages: [
      {
        role: 'user',
        content: buildUserMessage(
          {
            primaryCategory: 'dev',
            durationMin: c.min,
            closeReason: 'idle',
            activityScore: 120,
            domains: c.domains,
            compressedLog: c.log,
          },
          skills.map((s: any) => ({ name: s.name, lastUsedAt: s.last_used_at })),
          recent as any,
          threads.map((t: any) => ({
            id: t.id,
            title: t.title,
            category: t.category,
            experienceCount: t.experience_count,
          })),
        ),
      },
    ],
  });

  const tu: any = res.content.find((b: any) => b.type === 'tool_use' && b.name === TOOL_NAME);
  const n = tu?.input ?? {};
  const target = threads.find((t: any) => t.id === n.thread?.existing_thread_id);
  out.push({
    후보: c.name,
    완결: n.thread?.completed ? '★ TRUE' : 'false',
    작업: n.thread?.action,
    붙은갈래: n.thread?.action === 'attach' ? String(target?.title ?? '(없는 id)').slice(0, 22) : String(n.thread?.title ?? '').slice(0, 22),
    outcome: n.outcome,
    요약: String(n.summary ?? '').slice(0, 44),
  });
}

console.table(out);

// ── 2단계: 세션을 ①로 고정하고 **갈래 제목만** 바꾼다 ──
//
// 1단계에서 다섯 후보가 전부 false 였는데, 붙은 갈래가 전부 "Project NA 기술
// 아키텍처 설계"였다. 배포 한 번으로 '아키텍처 설계'가 끝나지는 않으니 모델이
// 맞게 판단한 것일 수 있다 — 그렇다면 완결을 가르는 건 세션이 얼마나 깔끔하게
// 끝났느냐가 아니라 **갈래의 범위**다. 문맥만 바꿔 확인한다(DB 는 안 건드린다).
const SCOPES = [
  'Project NA 기술 아키텍처 설계',
  'Project NA 궤도 지도 배포',
  '갈래 페이지 방향축 수정',
];
const base = CASES[0];
const target: any = threads[0];
const out2: Record<string, unknown>[] = [];

for (const title of SCOPES) {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    temperature: 0,
    system: SYSTEM_PROMPT_V7,
    tools: [RECORD_EXPERIENCE_TOOL],
    tool_choice: { type: 'tool', name: TOOL_NAME },
    messages: [
      {
        role: 'user',
        content: buildUserMessage(
          {
            primaryCategory: 'dev',
            durationMin: base.min,
            closeReason: 'idle',
            activityScore: 120,
            domains: base.domains,
            compressedLog: base.log,
          },
          skills.map((s: any) => ({ name: s.name, lastUsedAt: s.last_used_at })),
          recent as any,
          // 대상 갈래의 제목만 갈아끼운다. id·개수는 그대로다.
          threads.map((t: any) =>
            t.id === target.id
              ? { id: t.id, title, category: t.category, experienceCount: t.experience_count }
              : { id: t.id, title: t.title, category: t.category, experienceCount: t.experience_count },
          ),
        ),
      },
    ],
  });
  const tu: any = res.content.find((b: any) => b.type === 'tool_use' && b.name === TOOL_NAME);
  const n = tu?.input ?? {};
  out2.push({
    '갈래 제목': title,
    완결: n.thread?.completed ? '★ TRUE' : 'false',
    작업: n.thread?.action,
    outcome: n.outcome,
  });
}

console.log('\n세션은 ①(배포하고 동작 확인) 고정 · 갈래 제목만 교체');
console.table(out2);

await sql.end();
process.exit(0);
