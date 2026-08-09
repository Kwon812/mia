// 프롬프트 규칙을 실세션에 A/B 로 건다. 아무것도 쓰지 않는다.
//
// 합성 픽스처는 정답을 내가 정하므로, 픽스처 설계의 artifact 를 프롬프트 효과로
// 오독하기 쉽다(실제로 겪었다 — github 구간을 SOLDIER 와 안 붙여놨더니 왕복
// 근거로는 "다른 일" 이 맞는 답이 되어버렸다). 실세션은 정답이 없는 대신
// **분할 개수와 무엇이 갈렸나**를 볼 수 있다.
//
//   실행: npx tsx --tsconfig apps/web/scripts/tsconfig.json apps/web/scripts/probe-split.mts [규칙파일]
import fs from 'node:fs';
import postgres from 'postgres';
import Anthropic from '@anthropic-ai/sdk';
import { MODEL, TOOL_NAME, RECORD_EXPERIENCE_TOOL, SYSTEM_PROMPT_V9,
         buildUserMessage, segmentsOf, planItems } from '../src/lib/experience-engine';

const env = fs.readFileSync('.env.local','utf8');
const pick=(k:string)=>env.match(new RegExp(`${k}="?([^"\n]+)"?`))?.[1]??'';
process.env.ANTHROPIC_API_KEY ||= pick('ANTHROPIC_API_KEY');
const sql = postgres(pick('DATABASE_URL'),{prepare:false});
const client = new Anthropic();
const RULE = process.argv[2] ? fs.readFileSync(process.argv[2],'utf8') : '';
const kst=(d:any)=>new Date(new Date(d).getTime()+9*3600*1000).toISOString().replace('T',' ').slice(5,16);

const rows = await sql`select id, user_id, started_at, primary_category, duration_min,
  close_reason, activity_score, domains, compressed_log from sessions order by started_at`;
console.log(RULE ? `규칙 ${RULE.trim().length}자\n` : '규칙 없음 (기준선)\n');
let total = 0;
for (const s of rows) {
  const skills = await sql`select skill_name as name, last_used_at as "lastUsedAt" from user_skills
    where user_id=${s.user_id} order by last_used_at desc limit 50`;
  const recent = await sql`select summary, category, outcome from experiences
    where user_id=${s.user_id} and occurred_at < ${s.started_at} order by occurred_at desc limit 3`;
  const threads = await sql`select id, title, category, experience_count as "experienceCount" from threads
    where user_id=${s.user_id} and started_at < ${s.started_at} order by last_activity_at desc limit 8`;
  const res = await client.messages.create({
    model: MODEL, max_tokens: 2048, temperature: 0,
    system: SYSTEM_PROMPT_V9 + RULE, tools: [RECORD_EXPERIENCE_TOOL],
    tool_choice: { type:'tool', name: TOOL_NAME },
    messages: [{ role:'user', content: buildUserMessage(
      { primaryCategory: s.primary_category, durationMin: s.duration_min, closeReason: s.close_reason,
        activityScore: s.activity_score, domains: s.domains as any, compressedLog: s.compressed_log },
      skills as any, recent as any, threads as any) }],
  });
  const out:any = (res.content.find((b:any)=>b.type==='tool_use') as any)?.input ?? {};
  const items = planItems(out, segmentsOf(s.compressed_log), s.duration_min);
  total += items.length;
  console.log(`${kst(s.started_at)} ${String(s.duration_min).padStart(3)}분 → ${items.length}건`);
  items.forEach(it=>console.log(`     ${String(it.durationMin).padStart(3)}분  ${String(it.summary).slice(0,62)}`));
}
console.log(`\n세션 ${rows.length}건 → 경험 ${total}건`);
await sql.end();
