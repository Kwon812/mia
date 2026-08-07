// 7건 재판정 반영. processSession 은 INSERT 라 재실행이 곧 중복이므로 쓸 수 없다.
// 여기서는 판정 필드만 UPDATE 한다.
//
// 건드리는 것 : experiences(summary·detail·category·outcome·is_first_time·memory_score),
//               memories.importance
// 안 건드리는 것: experience_skills / user_skills / threads / dialogues
//   — 최초 처리 때 이미 반영됐고, 다시 태우면 사용 횟수·포인트가 이중 계상된다.
//
// memory_score 는 전체 재계산 대신 is_first_time 항(+40)만 차분으로 옮긴다.
// 나머지 항(hasNewSkill·comeback·longSession…)은 그때의 DB 상태에서 나온 값이라
// 지금 다시 계산하면 오히려 틀린다 — 그 사이 시드 데이터가 들어왔다.
//
// temperature 0 에서도 2/7 이 흔들려 3회 다수결로 정한다.
import fs from 'node:fs';
import postgres from 'postgres';
import Anthropic from '@anthropic-ai/sdk';
import { MODEL, TOOL_NAME, RECORD_EXPERIENCE_TOOL, SYSTEM_PROMPT_V7, buildUserMessage } from '../src/lib/experience-engine';

const PASSES = 3;
const FIRST_TIME_POINTS = 40;
const APPLY = process.argv.includes('--apply');

const env = fs.readFileSync('.env.local', 'utf8');
const pick = (k: string) => env.match(new RegExp(`${k}="?([^"\n]+)"?`))?.[1] ?? '';
process.env.ANTHROPIC_API_KEY ||= pick('ANTHROPIC_API_KEY');
const sql = postgres(pick('DATABASE_URL'), { prepare: false });
const client = new Anthropic();

const rows = await sql`
  select s.id as session_id, s.user_id, s.started_at, s.primary_category, s.duration_min,
         s.domains, s.compressed_log,
         e.id as exp_id, e.outcome as old_outcome, e.is_first_time as old_first,
         e.category as old_category, e.memory_score as old_score, left(e.summary,38) as old_summary
  from sessions s join experiences e on e.session_id = s.id
  where e.id::text not like '5eed%' order by s.started_at`;

const majority = <T,>(xs: T[]): T => {
  const c = new Map<string, { v: T; n: number }>();
  for (const x of xs) {
    const k = JSON.stringify(x);
    c.set(k, { v: x, n: (c.get(k)?.n ?? 0) + 1 });
  }
  return [...c.values()].sort((a, b) => b.n - a.n)[0].v;
};

const plan: any[] = [];
for (const r of rows) {
  const skills = await sql`
    select distinct on (es.skill_name) es.skill_name as name, e.occurred_at as last_used_at
    from experience_skills es join experiences e on e.id = es.experience_id
    where e.user_id=${r.user_id} and e.occurred_at<${r.started_at} and e.id::text not like '5eed%'
    order by es.skill_name, e.occurred_at desc`;
  const recent = await sql`
    select summary, category, outcome from experiences
    where user_id=${r.user_id} and occurred_at<${r.started_at} and id::text not like '5eed%'
    order by occurred_at desc limit 3`;
  const threads = await sql`
    select id, title, category, experience_count from threads
    where user_id=${r.user_id} and status='active' and id::text not like '5eed%'
    order by last_activity_at desc limit 5`;
  const content = buildUserMessage(
    { primaryCategory: r.primary_category, durationMin: r.duration_min,
      closeReason: r.close_reason, activityScore: r.activity_score,
      domains: r.domains, compressedLog: r.compressed_log },
    skills.map((s: any) => ({ name: s.name, lastUsedAt: s.last_used_at })),
    recent as any,
    threads.map((t: any) => ({ id: t.id, title: t.title, category: t.category, experienceCount: t.experience_count })),
  );

  const outs: any[] = [];
  for (let i = 0; i < PASSES; i++) {
    const res = await client.messages.create({
      model: MODEL, max_tokens: 1024, temperature: 0,
      system: SYSTEM_PROMPT_V7, tools: [RECORD_EXPERIENCE_TOOL],
      tool_choice: { type: 'tool', name: TOOL_NAME },
      messages: [{ role: 'user', content }],
    });
    const tu: any = res.content.find((b: any) => b.type === 'tool_use' && b.name === TOOL_NAME);
    if (tu) outs.push(tu.input);
  }
  const outcome = majority(outs.map((o) => o.outcome));
  const first = majority(outs.map((o) => o.is_first_time));
  const category = majority(outs.map((o) => o.category));
  const chosen = outs.find((o) => o.outcome === outcome && o.is_first_time === first && o.category === category) ?? outs[0];
  const score = r.old_score - (r.old_first ? FIRST_TIME_POINTS : 0) + (first ? FIRST_TIME_POINTS : 0);

  plan.push({
    exp_id: r.exp_id, summary: chosen.summary, detail: chosen.detail ?? null,
    category, outcome, first, score,
    표: { '요약': r.old_summary,
      outcome: `${r.old_outcome}→${outcome}`, first: `${r.old_first}→${first}`,
      category: `${r.old_category}→${category}`, score: `${r.old_score}→${score}`,
      '일치': `${outs.filter((o) => o.outcome === outcome).length}/${outs.length}` },
  });
}
console.table(plan.map((p) => p.표));

if (!APPLY) { console.log('\n— 미리보기. 반영하려면 --apply —'); await sql.end(); process.exit(0); }

await sql.begin(async (tx) => {
  for (const p of plan) {
    await tx`update experiences set summary=${p.summary}, detail=${p.detail},
             category=${p.category}, outcome=${p.outcome}, is_first_time=${p.first},
             memory_score=${p.score} where id=${p.exp_id}`;
    await tx`update memories set importance=greatest(1, least(10, round(${p.score}::numeric/10)))
             where experience_id=${p.exp_id}`;
  }
  // 건수 자체는 안 바뀌지만(UPDATE 만 했다) 중요도가 바뀌었으니 캐시 시각은 갱신한다.
  // 트랜잭션 안에서는 실패를 삼키면 안 된다 — 한 문장이 죽으면 트랜잭션 전체가
  // 오염돼 뒤따르는 문장이 전부 무효가 된다.
  await tx`update characters set last_computed_at=now()`;
});
const gained = plan.filter((p) => p.score >= 60 && p.표.score.split('→')[0] < 60);
console.log(`\n반영 완료 · 문턱(60) 신규 통과 ${gained.length}건`);
await sql.end();
