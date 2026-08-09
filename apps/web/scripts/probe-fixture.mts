// 생성한 세션 열로 갈래 부착을 시험한다. 구간마다 정답 소유자가 있으므로 채점된다.
//   npx tsx apps/web/scripts/probe-fixture.mts [규칙파일] [--threads] [--runs=2] [--n=40] [--seed=42]
//   --threads : 갈래 목록에 「주로 다룬 것」을 함께 준다 (H1)
//
// 채점: 항목의 구간 중 시간이 가장 많은 소유자를 그 항목의 정답으로 본다(위치 대조가
// 아니다 — 모델이 항목 수를 틀려도 남은 항목은 제대로 채점된다).
//
// 점수는 **쌍 F1** 이다. 경험 두 개를 짝지어, 같은 갈래에 들어갔는지와 정답 키가
// 같은지를 견준다.
//   정밀도 = (같은 갈래 & 같은 키) / (같은 갈래)   ← 섞으면 떨어진다
//   재현율 = (같은 갈래 & 같은 키) / (같은 키)     ← 흩으면 떨어진다
// 한쪽만 보는 척도는 못 쓴다. "몇 건이 제자리에 갔나"는 전부 한 갈래로 뭉개도
// 높게 나오고("첫 등장한 갈래가 그 키의 집"이 되어버린다), "순도"는 갈래를
// 잘게 쪼갤수록 높아진다. F1 은 양쪽을 동시에 벌한다.
import fs from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { MODEL, TOOL_NAME, RECORD_EXPERIENCE_TOOL, SYSTEM_PROMPT_V9,
         buildUserMessage, segmentsOf, planItems } from '../src/lib/experience-engine';
import { generate } from './gen-fixtures.mts';

const env = fs.readFileSync('.env.local','utf8');
process.env.ANTHROPIC_API_KEY ||= env.match(/ANTHROPIC_API_KEY="?([^"\n]+)"?/)![1];
const client = new Anthropic();
let tokIn=0, tokOut=0;
const args = process.argv.slice(2);
const num = (f:string, d:number) => Number(args.find(a=>a.startsWith(`--${f}=`))?.split('=')[1] ?? d);
const WITH_TARGETS = args.includes('--threads');
// H4: 후보를 코드가 거른다. 이번 세션과 도메인이 하나도 안 겹치는 갈래는
// 아예 보여주지 않는다 — 모델에게 "붙이지 마라"를 설득하는 대신 선택지에서 뺀다.
const FILTER = args.includes('--filter');
const RUNS = num('runs',1), N = num('n',40), SEED = num('seed',42);
const ruleFile = args.find(a => !a.startsWith('--'));
const RULE = ruleFile ? fs.readFileSync(ruleFile,'utf8') : '';
const TAG = args.find(a=>a.startsWith('--tag='))?.split('=')[1] ?? (ruleFile ?? '기준선');

type Th = { id:string; title:string; category:string; n:number; recent:string[];
            targets:Map<string,number>; lastAt:number; keys:Map<string,number>;
            domains:Set<string> };

const topOf = (segs:any[], ids:number[]) => {
  const t = new Map<string,number>();
  const use = ids.length ? ids.filter(i=>i<segs.length) : segs.map((_,i)=>i);
  for (const i of use) { const x=segs[i]; if(!x) continue;
    const k = `${x.domain}${x.title?' · '+String(x.title).slice(0,26):''}`;
    t.set(k,(t.get(k)??0)+(x.sec??0)); }
  return [...t.entries()].sort((a,b)=>b[1]-a[1]);
};
/** 이 항목의 정답 — 구간 소유자 중 시간 최다 */
const truthOf = (owners:string[], segs:any[], ids:number[]) => {
  const t = new Map<string,number>();
  const use = ids.length ? ids.filter(i=>i<segs.length) : segs.map((_,i)=>i);
  for (const i of use) t.set(owners[i], (t.get(owners[i])??0)+(segs[i]?.sec??0));
  return [...t.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0] ?? '?';
};

const FIXTURES = generate(N, SEED);
const TRUTH_THREADS = new Set(FIXTURES.flatMap(f=>f.expect)).size;
console.log(`${TAG} · ${N}세션 · ${RUNS}회 · 정답 갈래 ${TRUTH_THREADS}개${WITH_TARGETS?' · 「주로 다룬 것」(H1)':''}${RULE?` · 규칙 ${RULE.trim().length}자`:''}\n`);

/** 쌍 F1 — 같은 갈래에 묶였는가 vs 같은 정답 키인가 */
function pairF1(assign: { thread:string; key:string }[]) {
  let tp=0, sameThread=0, sameKey=0;
  for (let a=0; a<assign.length; a++) for (let b=a+1; b<assign.length; b++) {
    const t = assign[a].thread===assign[b].thread, k = assign[a].key===assign[b].key;
    if (t) sameThread++; if (k) sameKey++; if (t&&k) tp++;
  }
  const p = sameThread ? tp/sameThread : 1, r = sameKey ? tp/sameKey : 1;
  return { p, r, f1: p+r ? 2*p*r/(p+r) : 0 };
}

const f1s:number[]=[], precs:number[]=[], recs:number[]=[], counts:number[]=[], splits:number[]=[];
const dump:any[] = [];
for (let run=0; run<RUNS; run++) {
  const threads: Th[] = [];
  const assign: { thread:string; key:string; title:string; session:string }[] = [];
  let splitOk=0, splitTotal=0;

  for (const fx of FIXTURES) {
    const segDomains = new Set<string>(
      ((fx.session.compressedLog as any).segments as any[]).map(s=>s.domain));
    const pool = FILTER
      ? threads.filter(t => [...t.domains].some(d => segDomains.has(d)))
      : threads;
    const list = [...pool].sort((a,b)=>b.lastAt-a.lastAt).slice(0,8).map(t=>{
      const top=[...t.targets.entries()].sort((a,b)=>b[1]-a[1]).slice(0,3)
        .map(([k,v])=>`${k} ${Math.round(v/60)}분`).join(' · ');
      return { id:t.id, title:t.title, category:t.category, experienceCount:t.n,
        lastSummary: WITH_TARGETS ? `[주로 다룬 것] ${top}\n   최근: ${t.recent[0]}` : t.recent[0],
        idleDays: 0 };
    });
    let out:any = {};
    try {
      const res = await client.messages.create({
        model: MODEL, max_tokens: 2048, temperature: 0,
        system: SYSTEM_PROMPT_V9 + RULE, tools:[RECORD_EXPERIENCE_TOOL],
        tool_choice:{type:'tool',name:TOOL_NAME},
        messages:[{role:'user',content: buildUserMessage(fx.session as any, [] as any, [] as any, list as any)}],
      });
      tokIn += res.usage.input_tokens; tokOut += res.usage.output_tokens;
      out = (res.content.find((b:any)=>b.type==='tool_use') as any)?.input ?? {};
    } catch (e:any) { console.log(`   ! ${fx.name} 실패: ${e.message?.slice(0,60)}`); continue; }

    const segs = (fx.session.compressedLog as any).segments;
    const items = planItems(out, segmentsOf(fx.session.compressedLog), fx.session.durationMin);
    const dec = [out.thread, ...(out.also??[]).map((a:any)=>a.thread)];
    splitTotal++; if (items.length === fx.expect.length) splitOk++;

    const lines:string[] = [];
    items.forEach((it,i)=>{
      const truth = truthOf(fx.owners, segs, it.segmentIds);
      const d = dec[i] ?? { action:'new', title:null };
      let th = threads.find(t=>t.id===d.existing_thread_id);
      const attached = d.action==='attach' && !!th;
      if (attached && th) { th.n+=1; th.recent.unshift(it.summary); }
      else { th = { id:`t${threads.length+1}`, title:d.title?.trim()||it.summary.slice(0,32),
                    category:it.category, n:1, recent:[it.summary], targets:new Map(),
                    lastAt:0, keys:new Map(), domains:new Set() };
             threads.push(th); }
      th.lastAt = threads.length + assign.length;
      th.keys.set(truth,(th.keys.get(truth)??0)+1);
      for (const [k,v] of topOf(segs,it.segmentIds)) th.targets.set(k,(th.targets.get(k)??0)+v);
      const use = it.segmentIds.length ? it.segmentIds : segs.map((_:any,i:number)=>i);
      for (const i of use) if (segs[i]) th.domains.add(segs[i].domain);

      assign.push({ thread: th.id, key: truth, title: th.title, session: fx.name });
      lines.push(`   ${truth.padEnd(9)} → ${attached?'attach':'NEW   '} "${th.title.slice(0,30)}"`);
    });
    if (RUNS === 1) console.log(`${fx.name}  기대 ${fx.expect.length}건 → ${items.length}건\n${lines.join('\n')}`);
  }

  const { p, r, f1 } = pairF1(assign);
  console.log(`\n  --- ${run+1}회차 · F1 ${(f1*100).toFixed(1)}% (정밀 ${(p*100).toFixed(0)} / 재현 ${(r*100).toFixed(0)}) · 갈래 ${threads.length}(정답 ${TRUTH_THREADS}) · 분할 ${splitOk}/${splitTotal} ---`);
  [...threads].sort((a,b)=>b.n-a.n).slice(0,12).forEach(t=>{
    const ks=[...t.keys.entries()].sort((a,b)=>b[1]-a[1]);
    console.log(`      ${String(t.n).padStart(2)}건 ${ks.length>1?'✗섞임':'✓순수'} [${ks.map(([k,v])=>`${k}:${v}`).join(' ')}] "${t.title.slice(0,34)}"`);
  });
  console.log();
  f1s.push(f1); precs.push(p); recs.push(r); counts.push(threads.length); splits.push(splitOk/splitTotal);
  dump.push({ run, f1, p, r, threads: threads.length, assign });
}

const avg=(a:number[])=>a.reduce((x,y)=>x+y,0)/a.length;
const pct=(a:number[])=>a.map(x=>(x*100).toFixed(0)+'%').join(' · ');
fs.writeFileSync(`/tmp/na-fixture-${TAG}.json`, JSON.stringify({ TAG, N, SEED, RUNS, dump }, null, 1));
console.log(`=== ${TAG} · ${RUNS}회 평균 ===`);
console.log(`  쌍 F1      ${(avg(f1s)*100).toFixed(1)}%   (${pct(f1s)})`);
console.log(`    정밀도   ${(avg(precs)*100).toFixed(1)}%   — 낮으면 남의 갈래에 섞었다`);
console.log(`    재현율   ${(avg(recs)*100).toFixed(1)}%   — 낮으면 같은 것을 갈라놨다`);
console.log(`  분할 일치   ${(avg(splits)*100).toFixed(1)}%   (${pct(splits)})`);
console.log(`  갈래 개수   ${avg(counts).toFixed(1)}   (${counts.join(' · ')}) — 정답 ${TRUTH_THREADS}`);
const cost = tokIn/1e6*1 + tokOut/1e6*5;   // Haiku 4.5: $1/M 입력 · $5/M 출력
console.log(`  토큰 입력 ${tokIn.toLocaleString()} · 출력 ${tokOut.toLocaleString()} · 비용 $${cost.toFixed(3)} (약 ${Math.round(cost*1400).toLocaleString()}원)`);
