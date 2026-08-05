// 새 프롬프트가 같은 세션에서 무엇을 뱉는지, 아무것도 쓰지 않고 확인한다.
//   실행: npx tsx scripts/dry-reprocess.ts
// processSession 은 경험을 새로 INSERT 하므로 재실행이 곧 중복이다.
// 여기서는 LLM 호출까지만 하고 DB 는 읽기만 한다.
//
// 문맥은 "그 세션이 처리되던 시점"에 맞춘다 — 시드(5eed)는 빼고, 그 세션보다
// 앞선 것만 넣는다. 지금 상태 그대로 넣으면 나중에 쌓인 스킬 때문에
// is_first_time 이 부당하게 false 로 눌린다.
import fs from 'node:fs';
import postgres from 'postgres';
import Anthropic from '@anthropic-ai/sdk';
import {
  MODEL,
  TOOL_NAME,
  RECORD_EXPERIENCE_TOOL,
  SYSTEM_PROMPT_V3,
  buildUserMessage,
} from '../src/lib/experience-engine';

const env = fs.readFileSync('.env.local', 'utf8');
const pick = (k: string) => env.match(new RegExp(`${k}="?([^"\n]+)"?`))?.[1] ?? '';
process.env.ANTHROPIC_API_KEY ||= pick('ANTHROPIC_API_KEY');
const sql = postgres(pick('DATABASE_URL'), { prepare: false });
const client = new Anthropic();

const rows = await sql`
  select s.id, s.user_id, s.started_at, s.primary_category, s.duration_min, s.domains, s.compressed_log,
         e.outcome as old_outcome, e.is_first_time as old_first, e.category as old_category,
         e.memory_score as old_score, left(e.summary, 40) as old_summary
  from sessions s join experiences e on e.session_id = s.id
  where e.id::text not like '5eed%' order by s.started_at`;

console.log(`대상 ${rows.length}건 · 모델 ${MODEL}\n`);
const out: Record<string, unknown>[] = [];

for (const [i, r] of rows.entries()) {
  const skills = await sql`
    select distinct on (es.skill_name) es.skill_name as name, e.occurred_at as last_used_at
    from experience_skills es join experiences e on e.id = es.experience_id
    where e.user_id = ${r.user_id} and e.occurred_at < ${r.started_at} and e.id::text not like '5eed%'
    order by es.skill_name, e.occurred_at desc`;
  const recent = await sql`
    select summary, category, outcome from experiences
    where user_id = ${r.user_id} and occurred_at < ${r.started_at} and id::text not like '5eed%'
    order by occurred_at desc limit 3`;
  const threads = await sql`
    select t.id, t.title, t.category, t.experience_count from threads t
    where t.user_id = ${r.user_id} and t.status = 'active' and t.id::text not like '5eed%'
    order by t.last_activity_at desc limit 5`;

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    // 판정 작업이다. 기본값 1.0 으로는 같은 세션을 두 번 돌리면 outcome 이
    // 바뀐다 — 실제로 explore↔success↔partial 이 4/7 건 흔들렸다.
    // 창작(대사)도 같은 호출에 섞여 있지만, 흔들려선 안 되는 쪽을 우선한다.
    temperature: 0,
    system: SYSTEM_PROMPT_V3,
    tools: [RECORD_EXPERIENCE_TOOL],
    tool_choice: { type: 'tool', name: TOOL_NAME },
    messages: [{
      role: 'user',
      content: buildUserMessage(
        { primaryCategory: r.primary_category, durationMin: r.duration_min,
          domains: r.domains, compressedLog: r.compressed_log },
        skills.map((s: any) => ({ name: s.name, lastUsedAt: s.last_used_at })),
        recent as any,
        threads.map((t: any) => ({ id: t.id, title: t.title, category: t.category, experienceCount: t.experience_count })),
      ),
    }],
  });
  const tu: any = res.content.find((b: any) => b.type === 'tool_use' && b.name === TOOL_NAME);
  const n = tu?.input ?? {};
  const flag = (a: unknown, b: unknown) => (a === b ? '  ' : '←');
  out.push({
    '#': i + 1,
    '분': r.duration_min,
    'outcome': `${r.old_outcome} → ${n.outcome} ${flag(r.old_outcome, n.outcome)}`,
    'first': `${r.old_first} → ${n.is_first_time} ${flag(r.old_first, n.is_first_time)}`,
    'category': `${r.old_category} → ${n.category} ${flag(r.old_category, n.category)}`,
    '스킬': (n.skills ?? []).map((s: any) => s.name).join(','),
  });
  console.log(`[${i + 1}] ${r.old_summary}`);
  console.log(`    이전 컨텍스트: 스킬 ${skills.length} · 최근경험 ${recent.length} · 작업 ${threads.length}`);
  console.log(`    새 요약: ${n.summary}\n`);
}
console.table(out);
await sql.end();
