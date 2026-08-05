// 시드 데이터 정리. id 가 5eed 로 시작하는 것만 지운다.
// FK 때문에 memories → experience_skills → experiences → sessions → threads 순서.
import postgres from 'postgres';
import fs from 'node:fs';
const url = fs.readFileSync('.env.local','utf8').match(/DATABASE_URL="?([^"\n]+)"?/)[1];
const sql = postgres(url, { prepare: false });
const like = '5eed%';
await sql.begin(async (tx) => {
  const m = await tx`delete from memories where id::text like ${like} returning 1`;
  const es = await tx`delete from experience_skills where experience_id::text like ${like} returning 1`;
  const e = await tx`delete from experiences where id::text like ${like} returning 1`;
  const s = await tx`delete from sessions where id::text like ${like} returning 1`;
  const t = await tx`delete from threads where id::text like ${like} returning 1`;
  console.log(`기억 ${m.length} · 스킬연결 ${es.length} · 경험 ${e.length} · 세션 ${s.length} · 작업 ${t.length} 삭제`);
  await tx`update characters c set
      experience_count=(select count(*) from experiences where user_id=c.user_id),
      memory_count=(select count(*) from memories where user_id=c.user_id),
      oldest_memory_at=(select min(occurred_at) from memories where user_id=c.user_id),
      last_computed_at=now()`;
});
await sql.end();
