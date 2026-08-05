// 시드 데이터 정리. id 가 5eed 로 시작하는 것만 지운다.
//
// 행을 지우는 것만으로는 부족하다. user_skills 는 경험을 참조하지 않고 사용자당
// 하나로 집계돼 있어서, 시드 경험을 지워도 그 경험이 올려놓은 포인트·횟수가
// 그대로 남는다 (Docker 10회 63점처럼 존재하지 않는 이력이 남는다).
// 그래서 남은 experience_skills 로부터 통째로 다시 만든다 — 갱신 규칙은
// experience-engine 의 upsert 와 같다: points=SUM(weight), use_count=COUNT(*),
// first/last_used_at = MIN/MAX(session.started_at).
//
// daily_logs · dialogues 는 건드리지 않는다. 실제 배치가 만든 것이고 id 에
// 시드 표식이 없어 구분할 수도 없다.
import postgres from 'postgres';
import fs from 'node:fs';
const url = fs.readFileSync('.env.local', 'utf8').match(/DATABASE_URL="?([^"\n]+)"?/)[1];
const sql = postgres(url, { prepare: false });
const like = '5eed%';

await sql.begin(async (tx) => {
  // FK 순서: memories → experience_skills → experiences → sessions → threads
  const m = await tx`delete from memories where id::text like ${like} returning 1`;
  const es = await tx`delete from experience_skills where experience_id::text like ${like} returning 1`;
  const e = await tx`delete from experiences where id::text like ${like} returning 1`;
  const s = await tx`delete from sessions where id::text like ${like} returning 1`;
  const t = await tx`delete from threads where id::text like ${like} returning 1`;
  console.log(`삭제 — 기억 ${m.length} · 스킬연결 ${es.length} · 경험 ${e.length} · 세션 ${s.length} · 작업 ${t.length}`);

  // user_skills 재구축. 남은 참조가 없는 스킬은 사라진다.
  const del = await tx`
    delete from user_skills us where not exists (
      select 1 from experience_skills es
      join experiences e on e.id = es.experience_id
      where e.user_id = us.user_id and es.skill_name = us.skill_name
    ) returning 1`;
  const upd = await tx`
    update user_skills us set
      points = agg.points, use_count = agg.uses,
      first_used_at = agg.first_at, last_used_at = agg.last_at
    from (
      select e.user_id, es.skill_name,
             sum(es.weight)::int as points, count(*)::int as uses,
             min(sess.started_at) as first_at, max(sess.started_at) as last_at
      from experience_skills es
      join experiences e on e.id = es.experience_id
      join sessions sess on sess.id = e.session_id
      group by 1, 2
    ) agg
    where agg.user_id = us.user_id and agg.skill_name = us.skill_name returning 1`;
  console.log(`스킬 — 제거 ${del.length} · 재계산 ${upd.length}`);

  await tx`update characters c set
      experience_count = (select count(*) from experiences where user_id = c.user_id),
      memory_count = (select count(*) from memories where user_id = c.user_id and forgotten_at is null),
      skill_count = (select count(*) from user_skills where user_id = c.user_id),
      -- active_days = 경험이 있는 고유 KST(새벽4시 경계) 날짜 수. 배치와 같은 정의.
      active_days = (select count(distinct
          ((occurred_at at time zone 'Asia/Seoul') - interval '4 hour')::date)
        from experiences where user_id = c.user_id),
      oldest_memory_at = (select min(occurred_at) from memories where user_id = c.user_id),
      last_computed_at = now()`;
});

console.table(await sql`select experience_count, skill_count, memory_count from characters`);
console.table(await sql`select skill_name, use_count, points from user_skills order by points desc`);
await sql.end();
