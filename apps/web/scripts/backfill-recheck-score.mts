// 옮기기 버그로 잘못 들어간 근거를 걷어낸다.
//
// promoteIfEarned 가 deepened 를 >= 6 으로 판정해서, 6건을 넘긴 갈래에
// 무엇을 옮기든 그 경험이 자기 점수와 무관하게 근거가 됐다. 엔진은 === 6 이라
// 딱 한 번만 발동한다. 코드는 고쳤고 이 스크립트가 남은 자국을 지운다.
//
// 올바른 근거란: 그 갈래에서 스스로 문턱을 넘은 경험들 + deepened 가 발동한
// 순간의 경험 하나(시간순 6번째).
//
//   npx tsx --tsconfig scripts/tsconfig.json scripts/backfill-recheck-score.mts [--apply]
import fs from 'node:fs';
import postgres from 'postgres';

const APPLY = process.argv.includes('--apply');
const THRESHOLD = 60;
const DEEPENED_AT = 6;
const url = fs.readFileSync('.env.local', 'utf8').match(/DATABASE_URL="?([^"\n]+)"?/)![1];
const sql = postgres(url, { prepare: false });

const mems = await sql`
  select m.id, m.title, m.thread_id, m.triggers, m.experience_ids, m.importance,
         t.title tt
  from memories m left join threads t on t.id = m.thread_id
  where m.forgotten_at is null`;

let changed = 0;
for (const m of mems as any[]) {
  const exps = await sql`
    select id, memory_score, occurred_at, substring(summary,1,40) sm
    from experiences where thread_id = ${m.thread_id} order by occurred_at`;

  const want = new Set<string>();
  for (const e of exps as any[]) if (e.memory_score >= THRESHOLD) want.add(e.id);
  // deepened 가 남아 있다면 그 순간의 경험(시간순 6번째)도 근거다.
  if (m.triggers.includes('deepened') && exps.length >= DEEPENED_AT) {
    want.add((exps as any[])[DEEPENED_AT - 1].id);
  }
  // 이 갈래에 없는 경험이 근거로 남아 있을 수도 있다(옮겨 나갔는데 안 빠진 것).
  const inThread = new Set((exps as any[]).map((e) => e.id));
  const kept = (m.experience_ids as string[]).filter((id) => want.has(id) && inThread.has(id));
  const dropped = (m.experience_ids as string[]).filter((id) => !kept.includes(id));

  if (dropped.length === 0) continue;
  changed++;
  console.log(`\n"${m.tt}" — 근거 ${m.experience_ids.length} → ${kept.length}`);
  for (const id of dropped) {
    const e = (exps as any[]).find((x) => x.id === id);
    console.log(`   빼기  M${String(e?.memory_score ?? '?').padStart(4)}  ${e?.sm ?? '(이 갈래에 없음)'}`);
  }

  if (APPLY) {
    if (kept.length === 0) {
      // 근거가 하나도 안 남으면 기억이 아니다 — 갈래로 강등한다.
      // 사람이 정한 규칙이다: 기억은 근거에 대한 현재 판정이다.
      await sql`delete from memories where id = ${m.id}`;
      console.log('   → 근거 0건이라 기억을 지운다 (갈래로 강등)');
    } else {
      await sql`update memories set experience_ids = ${kept}, needs_resummary = true where id = ${m.id}`;
    }
  }
}

console.log(changed === 0 ? '\n걷어낼 것 없음' : APPLY ? `\n${changed}개 기억 정리함 · 제목은 오늘 밤에 다시 뽑힌다` : '\n미리보기다. 쓰려면 --apply');
await sql.end();
