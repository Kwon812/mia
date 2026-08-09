// 갈래 하나를 에이전트가 읽는 SKILL.md 로 내보낸다.
//
// automation 의 스킬(클릭 순서를 재생하는 실행 아티팩트)과는 종류가 다르다.
// 여기서 만드는 것은 **맥락 문서**다 — 에이전트가 "이 사람이 이 일을 어떻게
// 하는가"를 알고 그 사람처럼 판단하게 만든다. 손을 자동화하는 게 아니라
// 판단을 자동화한다.
//
// 재료는 전부 이미 있는 것이다. 새 관측이 필요 없다:
//   experience_skills 가중합   무슨 도구를 쓰나
//   sessions.domains 누적      어디서 일하나
//   experiences 시간순         무슨 일을 했나
//   corrections                **이 사람의 판단 기준** ← 다른 데서 못 얻는다
//
//   실행: npx tsx --tsconfig apps/web/scripts/tsconfig.json apps/web/scripts/export-skills.mts [최소경험수]
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import Anthropic from '@anthropic-ai/sdk';

const env = fs.readFileSync('.env.local','utf8');
const pick=(k:string)=>env.match(new RegExp(`${k}="?([^"\n]+)"?`))?.[1]??'';
process.env.ANTHROPIC_API_KEY ||= pick('ANTHROPIC_API_KEY');
const sql = postgres(pick('DATABASE_URL'),{prepare:false});
const client = new Anthropic();
const MIN = Number(process.argv[2] ?? 5);
const OUT = '.claude/skills';

const SYSTEM = `너는 한 사람의 작업 기록을 읽고, **AI 에이전트가 그 사람 대신 그 일을
이어받을 때 읽을 문서**를 쓴다.

목적은 요약이 아니다. 에이전트가 이 문서만 보고 "이 사람이 이 일을 어떻게 하는지"를
알고 그대로 판단할 수 있어야 한다.

write_skill 툴을 반드시 한 번 호출한다.

- name: 파일 이름이 될 짧은 kebab-case 영문 슬러그.
- description: **에이전트가 이 문서를 불러올지 말지를 이 한 줄로 정한다.** 무엇에 관한
  것인지와 **어떤 상황에서 필요한지**를 함께 적는다. 한 문장.
- body: 마크다운 본문. 아래를 지킨다.
    · 근거에 없는 것을 지어내지 않는다. 도구·도메인·수치는 준 것만 쓴다.
    · "이 사람은 ~한다" 처럼 관찰로 쓴다. 조언하거나 훈수 두지 않는다.
    · **사람이 고친 판정이 있으면 그것을 가장 무겁게 다룬다** — 그게 이 사람의
      판단 기준이고, 에이전트가 흉내 내야 할 부분이다.
    · 결과 분포에서 읽히는 것이 있으면 적는다(예: 완결 신호가 없다면 "끝났는지는
      사람에게 물어야 한다").
    · 400자~900자. 목록을 쓰되 장식하지 않는다.`;

const TOOL: Anthropic.Tool = {
  name: 'write_skill', description: '에이전트용 스킬 문서를 쓴다.', strict: true,
  input_schema: { type:'object', properties: {
    name: { type:'string', description:'kebab-case 영문 슬러그' },
    description: { type:'string', description:'언제 이 문서가 필요한지. 한 문장' },
    body: { type:'string', description:'마크다운 본문' },
  }, required:['name','description','body'], additionalProperties:false },
};

const threads = await sql`select id, title, category, status, experience_count, started_at
  from threads where experience_count >= ${MIN} order by experience_count desc`;
console.log(`대상 갈래 ${threads.length}개 (경험 ${MIN}건 이상)\n`);

for (const t of threads) {
  const exps = await sql`select occurred_at, summary, detail, outcome, duration_min
    from experiences where thread_id=${t.id} order by occurred_at`;
  const skills = await sql`select es.skill_name, sum(es.weight)::int w, count(*)::int n
    from experience_skills es join experiences e on e.id=es.experience_id
    where e.thread_id=${t.id} group by 1 order by 2 desc limit 10`;
  const doms = await sql`select key as d, sum(value::int)::int sec from sessions s,
    jsonb_each_text(s.domains) where s.id in (select session_id from experiences where thread_id=${t.id})
    group by 1 order by 2 desc limit 8`;
  const corr = await sql`select c.field, c.model_value, c.human_value, left(e.summary,50) as s
    from corrections c join experiences e on e.id=c.experience_id
    where e.thread_id=${t.id} and c.model_value <> c.human_value`;
  const oc = await sql`select outcome, count(*)::int n from experiences where thread_id=${t.id} group by 1 order by 2 desc`;

  const content = [
    `작업 이름: ${t.title}`,
    `분야: ${t.category} · 상태: ${t.status} · 경험 ${exps.length}건 · 총 ${exps.reduce((a:number,e:any)=>a+(e.duration_min??0),0)}분`,
    ``, `## 쓴 도구 (비중 · 등장 횟수)`,
    ...skills.map((s:any)=>`- ${s.skill_name} (${s.w} · ${s.n}회)`),
    ``, `## 머문 곳`,
    ...doms.map((d:any)=>`- ${d.d} ${Math.round(d.sec/60)}분`),
    ``, `## 한 일 (시간순)`,
    ...exps.map((e:any,i:number)=>`${i+1}. [${e.outcome}] ${e.summary}${e.detail?` — ${e.detail}`:''}`),
    ``, `## 결과 분포`,
    ...oc.map((r:any)=>`- ${r.outcome}: ${r.n}건`),
    ``, corr.length ? `## 사람이 직접 고친 판정 (이 사람의 기준)` : `## 사람이 고친 판정: 없음`,
    ...corr.map((c:any)=>`- ${c.field}: 모델은 "${c.model_value}" 라 했으나 사람은 "${c.human_value}" 로 고침 — "${c.s}"`),
  ].join('\n');

  const res = await client.messages.create({
    model:'claude-haiku-4-5', max_tokens:2048, temperature:0,
    system: SYSTEM, tools:[TOOL], tool_choice:{type:'tool',name:'write_skill'},
    messages:[{role:'user',content}],
  });
  const out:any = (res.content.find((b:any)=>b.type==='tool_use') as any)?.input;
  if (!out?.name) { console.error(`✗ ${t.title}`); continue; }

  const dir = path.join(OUT, out.name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir,'SKILL.md'),
    `---\nname: ${out.name}\ndescription: ${out.description}\n---\n\n${out.body}\n`);
  console.log(`✓ ${dir}/SKILL.md  (${out.body.length}자 · in ${res.usage.input_tokens} out ${res.usage.output_tokens})`);
}
await sql.end();
