// 분할 문턱(MIN_SPLIT_SEC)을 바꿔가며 실세션에서 무엇이 달라지는지 쓸어본다.
//
// 문턱은 **모델 출력과 무관한 순수 로컬 계산**이다. 그래서 출력을 한 번만 받아
// 캐시해두고 문턱만 바꾸면, 같은 출력 위에서 문턱만 비교하는 정확한 실험이 된다
// (매번 LLM 을 다시 부르면 출력이 흔들려 문턱 효과와 구분되지 않는다).
//
//   1회차: LLM 호출 → /tmp/na-outputs.json 에 캐시
//   2회차: 캐시를 읽어 문턱만 쓸어본다 (호출 0회)
import fs from 'node:fs';
import postgres from 'postgres';
import Anthropic from '@anthropic-ai/sdk';
import { MODEL, TOOL_NAME, RECORD_EXPERIENCE_TOOL, SYSTEM_PROMPT_V9,
         buildUserMessage, segmentsOf } from '../src/lib/experience-engine';

const env = fs.readFileSync('.env.local','utf8');
const pick=(k:string)=>env.match(new RegExp(`${k}="?([^"\n]+)"?`))?.[1]??'';
process.env.ANTHROPIC_API_KEY ||= pick('ANTHROPIC_API_KEY');
const sql = postgres(pick('DATABASE_URL'),{prepare:false});
const CACHE = '/tmp/na-outputs.json';
const kst=(d:any)=>new Date(new Date(d).getTime()+9*3600*1000).toISOString().replace('T',' ').slice(5,16);

const rows = await sql`select id, user_id, started_at, primary_category, duration_min,
  close_reason, activity_score, domains, compressed_log from sessions order by started_at`;

let cache: Record<string, any> = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE,'utf8')) : {};
const miss = rows.filter((s:any)=>!cache[s.id]);
if (miss.length > 0) {
  const client = new Anthropic();
  console.log(`LLM 호출 ${miss.length}건…`);
  for (const s of miss) {
    const skills = await sql`select skill_name as name, last_used_at as "lastUsedAt" from user_skills
      where user_id=${s.user_id} order by last_used_at desc limit 50`;
    const recent = await sql`select summary, category, outcome from experiences
      where user_id=${s.user_id} and occurred_at < ${s.started_at} order by occurred_at desc limit 3`;
    const threads = await sql`select id, title, category, experience_count as "experienceCount" from threads
      where user_id=${s.user_id} and started_at < ${s.started_at} order by last_activity_at desc limit 8`;
    const res = await new Anthropic().messages.create({
      model: MODEL, max_tokens: 2048, temperature: 0,
      system: SYSTEM_PROMPT_V9, tools: [RECORD_EXPERIENCE_TOOL],
      tool_choice: { type:'tool', name: TOOL_NAME },
      messages: [{ role:'user', content: buildUserMessage(
        { primaryCategory: s.primary_category, durationMin: s.duration_min, closeReason: s.close_reason,
          activityScore: s.activity_score, domains: s.domains as any, compressedLog: s.compressed_log },
        skills as any, recent as any, threads as any) }],
    });
    cache[s.id] = (res.content.find((b:any)=>b.type==='tool_use') as any)?.input ?? {};
    fs.writeFileSync(CACHE, JSON.stringify(cache));
  }
}

/** planItems 의 분할 판정만 떼어내 문턱을 인자로 받는다. */
function countSplit(out:any, segList:any[], minSec:number): { n:number; dropped:number[] } {
  const rest = (out.also ?? []).map((a:any)=>({ ids:[...(a.segment_ids ?? [])] }));
  if (rest.length===0) return { n:1, dropped:[] };
  const secOf=(i:number)=>{const g=segList[i]; if(!g) return 0;
    if (typeof g.sec==='number'&&g.sec>=0) return g.sec;
    if(!g.start||!g.end) return 0;
    const ms=new Date(g.end).getTime()-new Date(g.start).getTime();
    return Number.isFinite(ms)&&ms>0?Math.round(ms/1000):0; };
  const valid=(i:number)=>Number.isInteger(i)&&i>=0&&i<segList.length;
  const total = segList.reduce((a,_,i)=>a+secOf(i),0);
  const seen=new Set<number>();
  const ok = total>0 && rest.every((r:any)=>r.ids.length>0 && r.ids.every((i:number)=>{
    if(!valid(i)||seen.has(i)) return false; seen.add(i); return true; }));
  if (!ok) return { n:1, dropped:[] };
  if (!segList.some((g:any)=>typeof g?.sec==='number')) return { n:1, dropped:[] };
  const mins = rest.map((r:any)=>Math.round(r.ids.reduce((a:number,i:number)=>a+secOf(i),0)/60));
  const kept = mins.filter((m:number)=>m*60>=minSec).slice(0,2);
  return { n: 1+kept.length, dropped: mins.filter((m:number)=>m*60<minSec) };
}

const THRESHOLDS = [10,7,5,3].map(m=>m*60);
console.log('\n세션            길이   ' + THRESHOLDS.map(t=>`${t/60}분`.padStart(5)).join('') + '   흡수된 곁가지(분)');
const totals = new Map<number,number>(THRESHOLDS.map(t=>[t,0]));
for (const s of rows) {
  const segList = segmentsOf(s.compressed_log);
  const cells = THRESHOLDS.map(t=>{ const r=countSplit(cache[s.id], segList, t);
    totals.set(t,(totals.get(t)??0)+r.n); return r; });
  const drop = cells[0].dropped.filter(m=>m>0);
  if (new Set(cells.map(c=>c.n)).size>1 || drop.length>0)
    console.log(`${kst(s.started_at)} ${String(s.duration_min).padStart(4)}분  ` +
      cells.map(c=>`${c.n}건`.padStart(5)).join('') + `   ${drop.join(', ')||'—'}`);
}
console.log('\n문턱별 경험 총수 (세션 ' + rows.length + '건)');
for (const t of THRESHOLDS) console.log(`  ${String(t/60).padStart(2)}분 → ${totals.get(t)}건`);
await sql.end();
