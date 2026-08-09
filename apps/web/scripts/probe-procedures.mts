// 절차 추출을 실데이터에 돌려본다. 문턱을 감으로 정하지 않기 위해서다 —
// 무엇이 나오는지 보고 옮긴다.
//   npx tsx --tsconfig scripts/tsconfig.json scripts/probe-procedures.mts [--demo]
//
// --demo 는 합성 세션으로 돈다. 실데이터에 조작이 쌓이기 전에 로직이 맞는지
// 보기 위한 것이고, 여기서 통과한다고 실데이터에서 통한다는 뜻은 아니다 —
// 잡음의 실제 모양은 진짜 브라우징에서만 나온다.
import fs from 'node:fs';
import postgres from 'postgres';
import { findProcedures, looksLikeOscillation, stepsOf } from '../src/lib/procedure';

const DEMO = process.argv.includes('--demo');

/** 합성 세션. 절차 하나가 앞뒤 잡음에 싸여 세 번 반복되고, 진동도 하나 섞는다. */
function demoSessions() {
  const seg = (domain: string, acts: unknown[]) => ({ domain, category: 'dev', sec: 600, acts });
  const a = (label: string, sel?: string, mut?: true, dt = 3) => ({ t: 'button', label, sel, mut, dt });
  const inp = (sel: string, dt = 2) => ({ t: 'input', label: 'date 10자', sel, dt });
  // 절차: 테이블 → 필터 → 날짜입력 → 내보내기 → 시트 붙여넣기
  const proc = () => [
    seg('supabase.com', [
      a('experiences', '[data-testid="tbl"]'),
      a('필터', '#filter'),
      inp('[name="from"]'),
      a('CSV 내보내기', '#export', true, 5),
    ]),
    seg('docs.google.com', [a('붙여넣기', '#paste', true, 4)]),
  ];
  return [
    // 앞뒤에 매번 다른 잡음이 붙는다 — 이음매는 반복되지 않아 저절로 걸러져야 한다
    { id: 's1', startedAt: new Date('2026-08-01'), compressedLog: { segments: [seg('mail.example.com', [a('메일 열기')]), ...proc(), seg('youtube.com', [a('재생')])] } },
    { id: 's2', startedAt: new Date('2026-08-08'), compressedLog: { segments: [seg('slack.example.com', [a('채널')]), ...proc()] } },
    { id: 's3', startedAt: new Date('2026-08-15'), compressedLog: { segments: [...proc(), seg('news.example.com', [a('기사')])] } },
    // 진동 — 오가기만 하고 아무것도 안 바꾼다. 걸러져야 한다.
    { id: 's4', startedAt: new Date('2026-08-02'), compressedLog: { segments: [
      seg('localhost:3000', [a('대시보드', '#dash')]), seg('supabase.com', [a('테이블 보기', '#peek')]),
      seg('localhost:3000', [a('대시보드', '#dash')]) ] } },
    { id: 's5', startedAt: new Date('2026-08-09'), compressedLog: { segments: [
      seg('localhost:3000', [a('대시보드', '#dash')]), seg('supabase.com', [a('테이블 보기', '#peek')]),
      seg('localhost:3000', [a('대시보드', '#dash')]) ] } },
  ];
}

let sessions: { id: string; startedAt: Date; compressedLog: unknown }[];
let sql: ReturnType<typeof postgres> | null = null;
if (DEMO) {
  sessions = demoSessions();
  console.log('합성 데이터로 돈다 (--demo)\n');
} else {
  const url = fs.readFileSync('.env.local', 'utf8').match(/DATABASE_URL="?([^"\n]+)"?/)![1];
  sql = postgres(url, { prepare: false });
  const rows = await sql`
    select id, started_at, compressed_log from sessions
    where compressed_log is not null order by started_at`;
  sessions = (rows as any[]).map((r) => ({
    id: r.id, startedAt: new Date(r.started_at), compressedLog: r.compressed_log,
  }));
}

const withActs = sessions.filter((s) => stepsOf(s.compressedLog).length > 0);
const totalSteps = sessions.reduce((n, s) => n + stepsOf(s.compressedLog).length, 0);
console.log(`세션 ${sessions.length}개 · 조작이 있는 세션 ${withActs.length}개 · 조작 ${totalSteps}개`);

if (totalSteps === 0) {
  console.log('\n아직 조작이 없다. 세션이 닫혀 서버로 올라와야 나온다(30분 유휴 또는 maxlen).');
  console.log('로직만 보려면 --demo');
  await sql?.end();
  process.exit(0);
}

const cands = findProcedures(sessions);
const real = cands.filter((c) => !looksLikeOscillation(c));
console.log(`후보 ${cands.length}개 (진동 제외 ${real.length}개)\n`);

for (const c of real.slice(0, 10)) {
  const min = Math.floor(c.medianSec / 60), sec = Math.round(c.medianSec % 60);
  console.log(`■ ${c.runs}번 · 매번 ${min}분 ${sec}초 · ${c.steps.length}단계${c.mutates ? ' · 바꿈' : ''}`);
  c.steps.forEach((s, i) =>
    console.log(`    ${i + 1}. ${s.domain} · ${s.label ?? s.sel ?? s.t}` +
      `${s.mut ? '  ⚠바꿈' : ''}${c.paramIdx.includes(i) ? '  ←매개변수' : ''}`));
  console.log();
}
if (real.length === 0) console.log('(반복 2회 이상인 절차가 아직 없다)');
const osc = cands.length - real.length;
if (osc > 0) console.log(`진동으로 걸러낸 것 ${osc}개 — 오가기만 하고 아무것도 안 바꾼 열`);
await sql?.end();
