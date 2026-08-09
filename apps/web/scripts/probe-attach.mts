// 갈래 부착 판정을 **DB 에 안 쓰고** 시간순으로 시뮬레이션한다.
//
// 왜 재구축을 안 쓰나: rebuild.mts 는 파생을 통째로 지우고 다시 만든다. 가설
// 하나 재보자고 실데이터를 갈아엎을 수는 없고, 실패한 가설이면 되돌리기도
// 번거롭다. 여기서는 갈래 목록을 **메모리에** 들고 세션을 시간순으로 태우며
// attach/new 판정만 본다.
//
// 순서가 중요하다 — 그 시점의 갈래 목록이 판정을 좌우하므로, 시간순이 아니면
// 다른 결과가 나온다(rebuild.mts 와 같은 이유).
//
//   실행: npx tsx --tsconfig apps/web/scripts/tsconfig.json apps/web/scripts/probe-attach.mts [규칙파일]
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

/** 메모리 안의 갈래. DB 에 안 쓴다. */
type Th = { id: string; title: string; category: string; n: number;
            recent: string[]; targets: Map<string, number>; lastAt: number };
const threads: Th[] = [];

/** 그 경험이 실제로 머문 곳 — 판정이 맞았는지 사람이 보려고 찍는다. */
function topTargets(segs: any[], ids: number[]): [string, number][] {
  const t = new Map<string, number>();
  const use = ids.length ? ids.filter(i => i < segs.length) : segs.map((_, i) => i);
  for (const i of use) { const x = segs[i]; if (!x) continue;
    const k = `${x.domain}${x.title ? '·' + String(x.title).slice(0, 26) : ''}`;
    t.set(k, (t.get(k) ?? 0) + (x.sec ?? 0)); }
  return [...t.entries()].sort((a,b)=>b[1]-a[1]);
}

const rows = await sql`select id, user_id, started_at, primary_category, duration_min,
  close_reason, activity_score, domains, compressed_log from sessions order by started_at`;
console.log(RULE ? `규칙 ${RULE.trim().length}자\n` : '규칙 없음 (기준선)\n');

for (const s of rows) {
  const skills = await sql`select skill_name as name, last_used_at as "lastUsedAt" from user_skills
    where user_id=${s.user_id} order by last_used_at desc limit 50`;
  // 갈래 목록은 **메모리에서** 만든다 — 최근 활동순 8개
  const list = [...threads].sort((a,b)=>b.lastAt-a.lastAt).slice(0,8).map(t=>({
    id: t.id, title: t.title, category: t.category, experienceCount: t.n,
    lastSummary: t.recent[0],
    idleDays: Math.floor((new Date(s.started_at).getTime()-t.lastAt)/86400000),
  }));

  const res = await client.messages.create({
    model: MODEL, max_tokens: 2048, temperature: 0,
    system: SYSTEM_PROMPT_V9 + RULE, tools: [RECORD_EXPERIENCE_TOOL],
    tool_choice: { type:'tool', name: TOOL_NAME },
    messages: [{ role:'user', content: buildUserMessage(
      { primaryCategory: s.primary_category, durationMin: s.duration_min, closeReason: s.close_reason,
        activityScore: s.activity_score, domains: s.domains as any, compressedLog: s.compressed_log },
      skills as any, [] as any, list as any) }],
  });
  const out:any = (res.content.find((b:any)=>b.type==='tool_use') as any)?.input ?? {};
  const segs = (s.compressed_log as any)?.segments ?? [];
  const items = planItems(out, segmentsOf(s.compressed_log), s.duration_min);
  const decisions = [out.thread, ...(out.also??[]).map((a:any)=>a.thread)];

  console.log(`${kst(s.started_at)} ${String(s.duration_min).padStart(3)}분 → ${items.length}건`);
  items.forEach((it, i) => {
    const d = decisions[i] ?? { action: 'new', title: null };
    const top = topTargets(segs, it.segmentIds).slice(0,2)
      .map(([k,v])=>`${Math.round(v/60)}분 ${k}`).join(' | ');
    let th = threads.find(t => t.id === d.existing_thread_id);
    if (d.action === 'attach' && th) {
      th.n += 1; th.recent.unshift(it.summary); th.lastAt = new Date(it.occurredAt).getTime();
      console.log(`   ↳ attach "${th.title}"`);
    } else {
      const title = d.title?.trim() || it.summary.slice(0, 40);
      th = { id: `t${threads.length+1}`, title, category: it.category, n: 1,
             recent: [it.summary], targets: new Map(), lastAt: new Date(it.occurredAt).getTime() };
      threads.push(th);
      console.log(`   ↳ NEW    "${title}"`);
    }
    for (const [k,v] of topTargets(segs, it.segmentIds)) th.targets.set(k,(th.targets.get(k)??0)+v);
    console.log(`     ${String(it.summary).slice(0,58)}`);
    console.log(`     실제: ${top || '(구간 없음)'}`);
  });
}

console.log(`\n=== 결과: 갈래 ${threads.length}개 ===`);
for (const t of [...threads].sort((a,b)=>b.n-a.n)) {
  const top=[...t.targets.entries()].sort((a,b)=>b[1]-a[1]).slice(0,3)
    .map(([k,v])=>`${Math.round(v/60)}분 ${k}`).join(' · ');
  console.log(`  ${String(t.n).padStart(2)}건  "${t.title}"\n        ${top}`);
}
await sql.end();
