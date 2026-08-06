// 특정 날짜의 일기를 다시 만든다.
//   미리보기: npx tsx scripts/rebuild-diary.mts 2026-08-05
//   실행:     npx tsx scripts/rebuild-diary.mts 2026-08-05 --apply
//
// 정규 배치는 "방금 끝난 하루"만 겨냥한다(diaryTargetKst). 그런데 경험이
// 뒤늦게 생기는 경우가 있다 — 엔진이 실패했다가 재처리로 복구되면, 그 경험은
// 이미 쓰인 일기의 근거(daily_logs.experience_ids)에서 빠진 채 남는다.
// 그러면 /diary 화면에도 안 떠서 판정을 고칠 수조차 없다.
//
// daily_logs 는 PK 가 (user_id, log_date) 라 같은 날짜를 다시 돌리면 덮어쓴다.
// experiences 가 불변이라 언제든 다시 만들 수 있다는 설계가 여기서 실현된다.
//
// ⚠️ LLM 을 유저당 1회 호출한다(비용). 그래서 --apply 없이는 대상만 보여준다.
import fs from 'node:fs';
import postgres from 'postgres';
import { createDb } from '@na/db';
import { diaryRangeForLogDate } from '../src/kst';
import { generateDailyLogs } from '../src/jobs/daily-logs';

const logDate = process.argv[2];
const APPLY = process.argv.includes('--apply');

if (!logDate || !/^\d{4}-\d{2}-\d{2}$/.test(logDate)) {
  console.error('사용법: rebuild-diary.mts <YYYY-MM-DD> [--apply]');
  process.exit(1);
}

// 배치는 Render 환경변수로 도는데, 로컬 실행에서는 웹의 .env.local 을 빌려 쓴다.
if (!process.env.DATABASE_URL) {
  const env = fs.readFileSync('../web/.env.local', 'utf8');
  const pick = (k: string) => env.match(new RegExp(`${k}="?([^"\n]+)"?`))?.[1] ?? '';
  process.env.DATABASE_URL = pick('DATABASE_URL');
  process.env.ANTHROPIC_API_KEY = pick('ANTHROPIC_API_KEY');
}

const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
const { start, end } = diaryRangeForLogDate(logDate);

const rows = await sql`
  select e.user_id, count(*)::int as n
  from experiences e
  where e.occurred_at >= ${start} and e.occurred_at < ${end}
  group by 1`;

const existing = await sql`
  select user_id, array_length(experience_ids, 1) as n
  from daily_logs where log_date = ${logDate}`;

console.log(`대상 ${logDate} (${start.toISOString()} ~ ${end.toISOString()})`);
for (const r of rows) {
  const before = existing.find((e) => e.user_id === r.user_id)?.n ?? 0;
  console.log(`  user=${r.user_id.slice(0, 8)} 경험 ${r.n}건 · 현재 일기 근거 ${before}건`);
}
if (rows.length === 0) console.log('  (그날 경험이 없다 — 만들 일기도 없다)');

if (!APPLY) {
  console.log('\n미리보기다. 실제로 다시 만들려면 --apply 를 붙인다 (유저당 LLM 1회).');
  await sql.end();
  process.exit(0);
}

console.log('');
await generateDailyLogs(createDb(process.env.DATABASE_URL!), logDate);

const after = await sql`
  select user_id, array_length(experience_ids, 1) as n, prompt_version, left(summary, 60) as s
  from daily_logs where log_date = ${logDate}`;
console.log('\n재생성 결과');
for (const a of after) {
  console.log(`  user=${a.user_id.slice(0, 8)} 근거 ${a.n}건 · v${a.prompt_version}`);
  console.log(`    ${a.s}…`);
}

await sql.end();

// postgres.js 는 커넥션을 유지하므로 이벤트 루프가 안 비고 프로세스가 끝나지
// 않는다. 이 스크립트는 커넥션 풀을 **둘** 쓴다 — 자기 sql 과 위에서 import 한
// 앱/배치 쪽 db 다. 자기 것만 닫으면 나머지 하나가 프로세스를 붙잡는다.
// 실제로 이 스크립트들이 최대 75분간 좀비로 남아 있었다(할 일은 진작 끝냈다).
// 배치의 index.ts 도 같은 이유로 명시적 종료를 쓴다.
process.exit(0);
