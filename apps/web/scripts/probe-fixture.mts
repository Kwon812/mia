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
// 연쇄를 끊는다. 갈래 목록을 모델의 앞선 판단이 아니라 **정답**으로 만들어
// 물려준다. 호출이 서로 독립이 되므로 흔들림이 사라지고, "제대로 된 갈래가
// 있을 때 제대로 고르는가"만 깨끗하게 잰다.
//
// 연쇄 시험(기본)이 재는 것과 다른 것이다. 저쪽은 오판이 다음 선택지를
// 오염시키는 폭포까지 포함해서 재고, 이쪽은 판단력만 잰다. 잡음의 출처가
// 모델인지 연쇄인지 가르려면 둘 다 필요하다.
const ORACLE = args.includes('--oracle');
// 가상의 사람. 세션이 끝날 때마다 그 세션이 만든 경험만 훑어보고(어제 것은
// 안 본다 — 지도에서 오늘 것을 보는 셈이다), 남의 갈래에 들어간 것을 확률
// P 로 옮긴다. 옮긴 기록은 corrections 패턴이 되어 다음 프롬프트에 실린다.
const CORRECT = num('correct', 0);
// 대조 키워드. 갈래가 다룬 것 중 **다른 갈래에 없는 것**만 싣는다.
// H1 이 실패한 이유가 겹치는 것까지 다 실어서였다(localhost·Table Editor 가
// 두 갈래에 다 나온다). 겹치는 것을 빼면 갈라짐의 축만 남는다.
const KW = args.includes('--kw');
// 교정을 제목 쌍이 아니라 **대조축**으로 적는다.
//   제목 쌍: "베타 스토어 배포 → 알파 대시보드 (1회)"  — 다음에 쓸 데가 없다
//   대조축: "같은 도메인이어도 갈래가 다르다 → db.example.com (5회)"  — 쌓이고 재사용된다
// category 교정이 먹히는 건 값 공간이 좁아 같은 줄이 반복되기 때문이다.
// 갈래도 같은 성질을 갖게 하려면 무엇이 갈라짐의 축인지로 적어야 한다.
const AXIS = args.includes('--axis');

const RUNS = num('runs',1), N = num('n',40), SEED = num('seed',42);
let rngState = SEED >>> 0;
const rnd = () => ((rngState = (rngState*1664525+1013904223)>>>0) / 4294967296);
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
/** 이 갈래에만 있는 것 — 다른 갈래와 겹치는 표면은 뺀다 */
function uniqueOf(t:any, others:any[]): string {
  const elsewhere = new Set<string>();
  for (const o of others) if (o.id !== t.id) for (const k of o.targets.keys()) elsewhere.add(k);
  return [...t.targets.entries()].filter(([k]:any)=>!elsewhere.has(k))
    .sort((a:any,b:any)=>b[1]-a[1]).slice(0,3)
    .map(([k,v]:any)=>`${k} ${Math.round(v/60)}분`).join(' · ');
}

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
  const assign: { thread:string; key:string; title:string; session:string;
                  summary:string; domains:string[] }[] = [];
  let splitOk=0, splitTotal=0, oracleOk=0, oracleTotal=0;
  const rawAssign: { thread:string; key:string }[] = [];   // 모델의 날것 판단
  const patterns = new Map<string, number>();               // "잘못된 갈래 → 옳은 갈래"
  const homeOf = new Map<string, Th>();                     // 정답 키가 자리잡은 갈래

  // 정답 갈래 — 오라클 모드에서 매 세션 앞에 놓는다.
  const oracle = new Map<string, Th>();
  if (ORACLE) {
    for (const fx of FIXTURES) {
      const segs = (fx.session.compressedLog as any).segments as any[];
      fx.owners.forEach((k,i)=>{
        let t = oracle.get(k);
        if (!t) { t = { id:`o-${k}`, title:'', category:segs[i].category, n:0, recent:[],
                        targets:new Map(), lastAt:0, keys:new Map(), domains:new Set() };
                  oracle.set(k,t); }
        t.domains.add(segs[i].domain);
        const key = `${segs[i].domain} · ${String(segs[i].title).slice(0,26)}`;
        t.targets.set(key,(t.targets.get(key)??0)+segs[i].sec);
      });
    }
    // 제목·건수·최근 줄은 갈래가 실제로 다룬 것에서 뽑는다
    for (const [k,t] of oracle) {
      const top=[...t.targets.entries()].sort((a,b)=>b[1]-a[1]);
      t.title = String(top[0][0].split(' · ')[1] ?? k);
      t.n = FIXTURES.filter(f=>f.expect.includes(k)).length;
      t.recent = [`${t.title} 작업을 이어갔다.`];
    }
  }

  for (const fx of FIXTURES) {
    const segDomains = new Set<string>(
      ((fx.session.compressedLog as any).segments as any[]).map(s=>s.domain));
    // 오라클 모드에서는 이 세션의 정답 갈래 + 헷갈리라고 넣는 남의 갈래를 함께 준다
    const base = ORACLE
      ? [...oracle.values()].filter(t =>
          fx.expect.includes(t.id.slice(2)) || [...t.domains].some(d=>segDomains.has(d))
          || Math.abs([...oracle.keys()].indexOf(t.id.slice(2))) < 8)
      : threads;
    const pool = FILTER
      ? base.filter(t => [...t.domains].some(d => segDomains.has(d)))
      : base;
    const list = [...pool].sort((a,b)=>b.lastAt-a.lastAt).slice(0,8).map(t=>{
      const top=[...t.targets.entries()].sort((a,b)=>b[1]-a[1]).slice(0,3)
        .map(([k,v])=>`${k} ${Math.round(v/60)}분`).join(' · ');
      return { id:t.id, title:t.title, category:t.category, experienceCount:t.n,
        lastSummary: KW
          ? `[이 갈래에만 있는 것] ${uniqueOf(t, pool) || '(아직 없음)'}\n   최근: ${t.recent[0]}`
          : WITH_TARGETS ? `[주로 다룬 것] ${top}\n   최근: ${t.recent[0]}` : t.recent[0],
        idleDays: 0 };
    });
    let out:any = {};
    try {
      const res = await client.messages.create({
        model: MODEL, max_tokens: 2048, temperature: 0,
        system: SYSTEM_PROMPT_V9 + RULE, tools:[RECORD_EXPERIENCE_TOOL],
        tool_choice:{type:'tool',name:TOOL_NAME},
        messages:[{role:'user',content: buildUserMessage(
        fx.session as any, [] as any, [] as any, list as any, [] as any,
        [...patterns.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8)
          .map(([k,count])=>{ const [from,to]=k.split(' → ');
            return { field:'thread' as any, from, to, count }; }))}],
      });
      tokIn += res.usage.input_tokens; tokOut += res.usage.output_tokens;
      out = (res.content.find((b:any)=>b.type==='tool_use') as any)?.input ?? {};
    } catch (e:any) { console.log(`   ! ${fx.name} 실패: ${e.message?.slice(0,60)}`); continue; }

    const segs = (fx.session.compressedLog as any).segments;
    const items = planItems(out, segmentsOf(fx.session.compressedLog), fx.session.durationMin);
    const dec = [out.thread, ...(out.also??[]).map((a:any)=>a.thread)];
    splitTotal++; if (items.length === fx.expect.length) splitOk++;

    const lines:string[] = [];
    const mine = assign.length;
    items.forEach((it,i)=>{
      const truth = truthOf(fx.owners, segs, it.segmentIds);
      const d = dec[i] ?? { action:'new', title:null };
      let th = (ORACLE ? [...oracle.values(), ...threads] : threads)
        .find(t=>t.id===d.existing_thread_id);
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

      const myDomains = (it.segmentIds.length ? it.segmentIds : segs.map((_:any,i:number)=>i))
        .map((i:number)=>segs[i]?.domain).filter(Boolean) as string[];
      assign.push({ thread: th.id, key: truth, title: th.title, session: fx.name,
                    summary: it.summary, domains: myDomains });
      rawAssign.push({ thread: th.id, key: truth });   // 고치기 전, 모델이 정한 그대로
      // 오라클 채점 — 정답 갈래가 목록에 있었는데 거기로 갔는가
      if (ORACLE) {
        const want = oracle.get(truth);
        const offered = want && pool.some(t=>t.id===want.id);
        if (offered) { oracleTotal++; if (d.action==='attach' && d.existing_thread_id===want!.id) oracleOk++; }
      }
      lines.push(`   ${truth.padEnd(9)} → ${attached?'attach':'NEW   '} "${th.title.slice(0,30)}"`);
    });
    // ---- 가상의 사람이 고친다 ----
    if (CORRECT > 0) {
      for (let k = mine; k < assign.length; k++) {
        const a = assign[k];
        const th = threads.find(t=>t.id===a.thread);
        if (!th) continue;
        const dom = [...th.keys.entries()].sort((x,y)=>y[1]-x[1])[0]?.[0];
        if (dom === a.key) continue;             // 다수와 같으면 사람 눈에 안 띈다
        if (rnd() >= CORRECT) continue;          // 매번 고치지는 않는다
        // 옮긴다
        th.keys.set(a.key, (th.keys.get(a.key) ?? 1) - 1);
        if ((th.keys.get(a.key) ?? 0) <= 0) th.keys.delete(a.key);
        th.n -= 1;
        let home = homeOf.get(a.key);
        if (!home || home.id === th.id) {
          home = { id:`t${threads.length+1}`, title:a.summary.slice(0,32), category:th.category, n:0,
                   recent:[], targets:new Map(), lastAt:threads.length, keys:new Map(),
                   domains:new Set() };
          threads.push(home); homeOf.set(a.key, home);
        }
        home.n += 1; home.keys.set(a.key,(home.keys.get(a.key)??0)+1);
        home.recent.unshift(a.summary);
        for (const [d] of th.targets) if (!home.targets.has(d)) home.targets.set(d,1);
        for (const d of th.domains) home.domains.add(d);
        if (AXIS) {
          // 잘못 붙었던 갈래와 **겹쳤던** 것이 곧 안 갈라지는 축이다.
          // 겹쳤는데도 사람이 갈랐으니, 그 겹침은 근거가 아니었다는 뜻이다.
          const host = (d:string) => d.split(':')[0];
          const srcHosts = new Set([...th.domains].map(host));
          for (const d of new Set(a.domains)) {
            if (th.domains.has(d))
              patterns.set(`같은 도메인이어도 갈래가 다르다 → ${d}`, (patterns.get(`같은 도메인이어도 갈래가 다르다 → ${d}`)??0)+1);
            else if (srcHosts.has(host(d)))
              patterns.set(`같은 호스트라도 포트가 다르면 다른 갈래다 → ${host(d)}`, (patterns.get(`같은 호스트라도 포트가 다르면 다른 갈래다 → ${host(d)}`)??0)+1);
          }
        } else {
          const pk = `${th.title.slice(0,24)} → ${home.title.slice(0,24)}`;
          patterns.set(pk,(patterns.get(pk)??0)+1);
        }
        a.thread = home.id; a.title = home.title;   // 최종 상태는 고쳐진 상태
      }
    }
    for (let k = mine; k < assign.length; k++)
      if (!homeOf.has(assign[k].key)) homeOf.set(assign[k].key, threads.find(t=>t.id===assign[k].thread)!);

    if (RUNS === 1) console.log(`${fx.name}  기대 ${fx.expect.length}건 → ${items.length}건\n${lines.join('\n')}`);
  }

  const raw = pairF1(rawAssign);
  const { p, r, f1 } = CORRECT > 0 ? raw : pairF1(assign);   // 교정 시험은 날것으로 잰다
  if (CORRECT > 0) {
    const fin = pairF1(assign);
    console.log(`  [교정 ${CORRECT}${AXIS?' 대조축':' 제목쌍'}] 모델 날것 F1 ${(raw.f1*100).toFixed(1)}% · 고친 뒤 F1 ${(fin.f1*100).toFixed(1)}%`);
    // 규칙이 쌓이는가 — 전부 1회면 재사용이 안 된다는 뜻이고, F1 과 무관하게 경로가 죽는다.
    const cnts=[...patterns.values()];
    console.log(`     규칙 ${patterns.size}줄 · 총 ${cnts.reduce((a,b)=>a+b,0)}회 · 2회 이상인 줄 ${cnts.filter(c=>c>1).length} · 최대 ${Math.max(0,...cnts)}회`);
    [...patterns.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5)
      .forEach(([k,v])=>console.log(`       ${String(v).padStart(2)}회  ${k}`));
  }
  if (ORACLE) console.log(`  [오라클] 정답 갈래가 목록에 있을 때 그리로 간 비율 ${oracleOk}/${oracleTotal} = ${(oracleOk/Math.max(1,oracleTotal)*100).toFixed(1)}%`);
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
