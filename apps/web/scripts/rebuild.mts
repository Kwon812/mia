// 파생 데이터를 지우고 세션에서 처음부터 다시 만든다.
//   미리보기: npx tsx --tsconfig scripts/tsconfig.json scripts/rebuild.mts
//   실행:     ... scripts/rebuild.mts --apply
//
// 왜 이렇게 하나: apply-reprocess 는 판정 필드만 UPDATE 해서 thread_id 를 못 고친다.
// 그런데 지금 문제는 경험 10건이 쓰레드 하나로 뭉친 것이라 thread 를 다시 만들어야
// 한다. thread 는 파생값이고 sessions 가 원본이므로, 파생을 전부 지우고
// processSession 을 시간순으로 다시 태우면 된다 — 로직을 복제하지 않고
// 운영 코드 경로를 그대로 쓴다는 것이 요점이다.
//
// 시간순이 중요하다. processSession 은 "그 시점의 활성 thread 목록"을 보고
// attach/new 를 정하므로, 순서가 뒤바뀌면 다른 결과가 나온다.
import fs from 'node:fs';
import postgres from 'postgres';

// ⚠️ 환경변수를 **import 전에** 세팅해야 한다.
// @/lib/db 는 모듈 최상위에서 createDb() 를 부르고, 그게 process.env.DATABASE_URL
// 을 읽는다. 스크립트가 .env.local 을 직접 파싱해 자기 연결에만 쓰면 앱 쪽 db 는
// URL 이 없어 localhost 로 붙으려다 ECONNREFUSED 로 죽는다.
// 실제로 이 실수로 파생 데이터를 지운 뒤 10건 전부 실패한 적이 있다.
const envFile = fs.readFileSync('.env.local', 'utf8');
const readEnv = (k: string) => envFile.match(new RegExp(`${k}="?([^"\n]+)"?`))?.[1] ?? '';
process.env.DATABASE_URL ||= readEnv('DATABASE_URL');
process.env.ANTHROPIC_API_KEY ||= readEnv('ANTHROPIC_API_KEY');

const { processSession } = await import('../src/lib/experience-engine');

const APPLY = process.argv.includes('--apply');
const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

const before = await sql`select
  (select count(*)::int from experiences) as 경험,
  (select count(*)::int from threads) as 쓰레드,
  (select count(*)::int from memories) as 기억,
  (select count(*)::int from user_skills) as 스킬`;
console.table(before);

const sessions = await sql`select id, user_id, started_at from sessions order by started_at`;
console.log(`대상 세션 ${sessions.length}건 (시간순)`);

if (!APPLY) {
  console.log('\n— 미리보기. 실행하려면 --apply —');
  console.log('지울 것: memories · experience_skills · experiences · threads · user_skills');
  console.log('남길 것: sessions · dialogues · daily_logs · llm_outputs · ingest_failures');
  console.log('보관 후 복원: corrections · questions (세션 id 로 다시 잇는다)');
  console.log('⚠️ daily_logs.experience_ids 는 옛 id 를 가리키게 된다 —');
  console.log('   재구축 뒤 apps/batch/scripts/rebuild-diary.mts 로 그 날짜들을 다시 만들 것');
  await sql.end();
  process.exit(0);
}

// 지우기 전에 **재구축 경로가 실제로 동작하는지** 먼저 확인한다.
// 앞선 사고의 교훈이다 — 지우는 것은 되돌릴 수 없고, 재구축은 실패할 수 있다.
{
  const { db } = await import('../src/lib/db');
  const { sessions: sessionsTable } = await import('@na/db');
  const probe = await db.select({ id: sessionsTable.id }).from(sessionsTable).limit(1);
  if (probe.length === 0) throw new Error('앱 db 연결 확인 실패 — 지우지 않고 중단한다');
  console.log('앱 db 연결 확인 ✓');
}

// 사람 판단(declared)은 **experiences 를 cascade 로 물고 있다.**
// delete from experiences 가 corrections·questions 를 조용히 데려간다 —
// 실제로 이 스크립트를 처음 돌렸을 때 교정 2건이 그렇게 사라졌다.
// 다른 파생 데이터와 성격이 다르다: 이건 다시 만들 수 없다. 모델이 낸 값이
// 아니라 사람이 준 값이고, 재구축은 그걸 복원할 방법이 없다.
//
// experiences.session_id 가 UNIQUE 라 세션 id 를 열쇠로 다시 이을 수 있다.
// experience_id 자체는 재구축 때마다 새로 발급되므로 쓸모가 없다.
const declared = {
  corrections: await sql`
    select c.user_id, e.session_id, c.field, c.model_value, c.human_value,
           c.source, c.created_at
    from corrections c join experiences e on e.id = c.experience_id`,
  questions: await sql`
    select q.user_id, e.session_id, q.field, q.model_value, q.text,
           q.asked_at, q.answered_at, q.dismissed_at
    from questions q join experiences e on e.id = q.experience_id`,
};
console.log(`사람 판단 보관: 교정 ${declared.corrections.length}건 · 질문 ${declared.questions.length}건`);

// 백업
const backup = {
  experiences: await sql`select * from experiences`,
  threads: await sql`select * from threads`,
  memories: await sql`select * from memories`,
  userSkills: await sql`select * from user_skills`,
  experienceSkills: await sql`select * from experience_skills`,
  declared,
};
const path = `/tmp/na-rebuild-backup-${Date.now()}.json`;
fs.writeFileSync(path, JSON.stringify(backup, null, 1));
console.log(`백업: ${path}`);

// FK 순서대로 지운다. sessions 는 건드리지 않는다 — 원본이다.
await sql.begin(async (tx) => {
  await tx`delete from memories`;
  await tx`delete from experience_skills`;
  await tx`delete from experiences`;
  await tx`delete from threads`;
  await tx`delete from user_skills`;
  await tx`update sessions set processed_at = null`;
});
console.log('파생 데이터 삭제 완료');

let ok = 0;
for (const [i, s] of sessions.entries()) {
  await processSession(s.id, s.user_id);
  const [row] = await sql`select processed_at from sessions where id = ${s.id}`;
  const done = row?.processed_at != null;
  if (done) ok += 1;
  console.log(`  ${i + 1}/${sessions.length} ${done ? '✓' : '✗'} ${s.started_at.toISOString().slice(0, 16)}`);
}
console.log(`\n${ok}/${sessions.length} 처리 성공`);

// 사람 판단 복원 — 세션 id 로 새 experience 를 찾아 다시 잇는다.
// model_value 는 백업한 값 그대로 넣는다. 그건 "그때 모델이 뭐라고 했나"의
// 박제본이고, 재구축으로 모델 판정이 바뀌었더라도 그 쌍은 역사적 사실이다.
{
  let restored = 0;
  let orphaned = 0;
  for (const q of declared.questions) {
    const [e] = await sql`select id from experiences where session_id = ${q.session_id}`;
    if (!e) { orphaned += 1; continue; }
    await sql`insert into questions (user_id, experience_id, field, model_value, text, asked_at, answered_at, dismissed_at)
      values (${q.user_id}, ${e.id}, ${q.field}, ${q.model_value}, ${q.text}, ${q.asked_at}, ${q.answered_at}, ${q.dismissed_at})
      on conflict do nothing`;
    restored += 1;
  }
  for (const c of declared.corrections) {
    const [e] = await sql`select id from experiences where session_id = ${c.session_id}`;
    if (!e) { orphaned += 1; continue; }
    await sql`insert into corrections (user_id, experience_id, field, model_value, human_value, source, created_at)
      values (${c.user_id}, ${e.id}, ${c.field}, ${c.model_value}, ${c.human_value}, ${c.source}, ${c.created_at})`;
    restored += 1;
  }
  console.log(`사람 판단 복원: ${restored}건${orphaned ? ` · 세션 매칭 실패 ${orphaned}건 (백업 파일에 남아있다)` : ''}`);
}

// 캐릭터 캐시 재계산 (배치의 character-cache 와 같은 정의)
await sql`update characters c set
  experience_count = (select count(*) from experiences where user_id = c.user_id),
  memory_count = (select count(*) from memories where user_id = c.user_id and forgotten_at is null),
  skill_count = (select count(*) from user_skills where user_id = c.user_id),
  active_days = (select count(distinct ((occurred_at at time zone 'Asia/Seoul') - interval '4 hour')::date)
                 from experiences where user_id = c.user_id),
  oldest_memory_at = (select min(occurred_at) from memories where user_id = c.user_id),
  last_computed_at = now()`;

console.table(await sql`select
  (select count(*)::int from experiences) as 경험,
  (select count(*)::int from threads) as 쓰레드,
  (select count(*)::int from memories) as 기억,
  (select count(*)::int from user_skills) as 스킬`);
console.table(await sql`select left(title,30) as 쓰레드, category, status, experience_count as 경험수 from threads order by started_at`);
await sql.end();

// postgres.js 는 커넥션을 유지하므로 이벤트 루프가 안 비고 프로세스가 끝나지
// 않는다. 이 스크립트는 커넥션 풀을 **둘** 쓴다 — 자기 sql 과 위에서 import 한
// 앱/배치 쪽 db 다. 자기 것만 닫으면 나머지 하나가 프로세스를 붙잡는다.
// 실제로 이 스크립트들이 최대 75분간 좀비로 남아 있었다(할 일은 진작 끝냈다).
// 배치의 index.ts 도 같은 이유로 명시적 종료를 쓴다.
process.exit(0);
