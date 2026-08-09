// 콜드 스토리지의 원본을 지금 압축기에 다시 태워 compressed_log 를 갈아끼운다.
//   미리보기: npx tsx --tsconfig apps/web/scripts/tsconfig.json apps/web/scripts/restore-sec.mts
//   실행:     ... restore-sec.mts --apply
//
// 왜 필요한가: 2026-08-06 이전 압축기는 구간별 체류 시간(sec)을 안 실었다.
// sec 이 없으면 planItems 가 "시간을 못 믿는다"고 판단해 **분할을 아예 포기**한다
// (그게 맞다 — 신뢰할 수 없는 값을 절대 문턱에 댈 수는 없다). 그래서 그 세션들은
// 몇 번을 재구축해도 한 덩어리로 남는다.
//
// 원본이 Storage 에 있으면 이야기가 다르다. 지어내는 게 아니라 **못 읽고 있던 것을
// 읽는 것**이다 — 같은 이벤트를 같은 압축기에 태우면 sec 이 나온다.
// 실측(08-06 20:02): 226분 세션에서 SOLDIER : A DAY 38분이 드러났다. 그 전에는
// 요약에 한 글자도 없었다.
//
// 원본이 없는 세션(원본 수집이 붙기 전)은 건너뛴다. 요약문을 보고 사람이 어림해서
// 넣으면 그건 관측이 아니라 추측이고, experiences 에 들어가는 순간 모델 판정과
// 구분되지 않는다.
//
// processed_at 을 null 로 되돌리므로 재처리·재구축 대상이 된다.
import fs from 'node:fs'; import zlib from 'node:zlib';
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';
import { buildCompressedLog, normalizeEvent } from './apps/extension/src/session/builder';
import type { RawEvent, SessionDraft } from './apps/extension/src/session/types';
const env = fs.readFileSync('.env.local','utf8');
const g=(k:string)=>env.match(new RegExp(`${k}="?([^"\n]+)"?`))?.[1]??'';
const APPLY = process.argv.includes('--apply');
const sb = createClient(g('NEXT_PUBLIC_SUPABASE_URL'), g('SUPABASE_SERVICE_ROLE_KEY'));
const sql = postgres(g('DATABASE_URL'),{prepare:false});
const kst=(d:any)=>new Date(new Date(d).getTime()+9*3600*1000).toISOString().replace('T',' ').slice(5,16);

const all = await sql`select id, user_id, started_at, duration_min, compressed_log from sessions order by started_at`;
let done=0, skip=0;
for (const s of all) {
  const segs=(s.compressed_log as any)?.segments??[];
  if (segs.some((x:any)=>typeof x.sec==='number')) { skip++; continue; }
  const date = new Date(new Date(s.started_at).getTime()+9*3600*1000).toISOString().slice(0,10);
  const blob = await sb.storage.from('na-raw').download(`raw/${s.user_id}/${date}/${s.id}.jsonl.gz`);
  if (!blob.data) { console.log(`  ${kst(s.started_at)} 원본 없음 — 건너뜀`); continue; }
  const raws: RawEvent[] = zlib.gunzipSync(Buffer.from(await blob.data.arrayBuffer()))
    .toString('utf8').trim().split('\n').map(l=>JSON.parse(l));
  const events = raws.map(normalizeEvent).sort((a,b)=>a.at-b.at);
  if (events.length===0) { console.log(`  ${kst(s.started_at)} 이벤트 0건`); continue; }
  const draft: SessionDraft = { id: s.id, startedAt: events[0].at, lastActivityAt: events.at(-1)!.at,
    primaryCategory:'dev', events, switchCount:0, tags:[], domains:{}, activityScore:0 };
  const built = buildCompressedLog(draft);
  // 옛 로그의 tags 만 지키고 나머지는 새 압축기 결과로 통째로 갈아끼운다.
  // earlier 를 조건부로 얹으면, 옛 로그에 있던 earlier 가 새 결과엔 없을 때
  // 그대로 남아 구간 수와 어긋난다 — 번호(i)가 가리키는 자리가 달라진다.
  const merged: Record<string, unknown> = {
    tags: (s.compressed_log as any)?.tags ?? [],
    segments: built.segments,
    queries: built.queries,
  };
  if (built.earlier) merged.earlier = built.earlier;
  const tot = new Map<string,number>();
  for (const x of built.segments) { const k=`${x.domain} · ${(x.title??'').slice(0,34)}`; tot.set(k,(tot.get(k)??0)+(x.sec??0)); }
  for (const p of built.earlier?.top??[]) tot.set(p.label,(tot.get(p.label)??0)+p.sec);
  const big=[...tot.entries()].filter(([,v])=>v>=600).sort((a,b)=>b[1]-a[1]);
  console.log(`  ${kst(s.started_at)} ${String(s.duration_min).padStart(3)}분 · 이벤트 ${String(raws.length).padStart(4)} · 구간 ${built.segments.length}${built.earlier?'+earlier':''} · 10분↑ 대상 ${big.length}개`);
  big.slice(0,4).forEach(([k,v])=>console.log(`        ${String(Math.round(v/60)).padStart(3)}분  ${k}`));
  if (APPLY) await sql`update sessions set compressed_log = ${merged as any}, processed_at = null where id = ${s.id}`;
  done++;
}
console.log(`\n${APPLY?'복원 완료':'미리보기'} ${done}건 · 이미 sec 있음 ${skip}건`);
if (!APPLY) console.log('실행: --apply');
await sql.end();
