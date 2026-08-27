-- ============================================================
-- 데모 계정의 캐릭터 캐시를 다시 센다. **LLM 을 부르지 않는다.**
--
-- 앞의 두 SQL 로 세션·경험·갈래·기억을 넣어도 화면 숫자는 안 바뀐다.
-- characters 의 카운트는 전부 파생 캐시이고, 원본에서 다시 세는 일은 야간
-- 배치(character-cache)가 한다. 그 계산을 그대로 SQL 로 옮긴 것이다.
--
-- **created_at 을 되돌리는 것이 핵심이다.** calculateLevel 은
--   레벨 = min( 1 + floor(sqrt(경험수 × 스킬수)),  floor(가입후일수/3) + 1 )
-- 인데, 데모 계정은 오늘 만들어졌으므로 뒤쪽 항이 1 이다. 3개월치를 넣어도
-- 레벨이 1 에 묶이고 "함께한 지 1일"로 뜬다 — 데이터는 3개월인데 캐릭터는
-- 오늘 태어난 것으로 보인다.
--
-- 다시 돌려도 안전하다(항상 원본에서 다시 센다).
-- 세 파일 중 **맨 마지막**에 돌린다.
-- ============================================================

do $$
declare
  demo_key text := 'na_8YQcrfm5c7oLt8yvzPugTP5OSIgNzGGC';
  uid uuid;
  exp_n int; skill_n int; mem_n int; active_n int;
  oldest_mem timestamptz; first_seen timestamptz;
  days_since int; lv int;
begin
  select d.user_id into uid from devices d where d.extension_key = demo_key;
  if uid is null then raise exception '그 키로 등록된 기기가 없다: %', demo_key; end if;

  -- 캐릭터가 태어난 날을 가장 오래된 세션에 맞춘다.
  select min(started_at) into first_seen from sessions where user_id = uid;
  if first_seen is not null then
    update users set created_at = first_seen where id = uid;
  end if;

  select count(*)::int into exp_n   from experiences where user_id = uid;
  select count(*)::int into skill_n from user_skills where user_id = uid;
  select count(*)::int, min(occurred_at) into mem_n, oldest_mem
    from memories where user_id = uid;

  -- 활동일 = 경험이 있는 KST 하루의 수. 하루 경계가 새벽 4시라 +5시간이다
  -- (KST 는 UTC+9, 거기서 경계 4시간을 뺀다 — kstDayKey 와 같은 계산).
  select count(distinct ((occurred_at at time zone 'UTC') + interval '5 hours')::date)::int
    into active_n from experiences where user_id = uid;

  -- kstDaysTogether(created_at, now) - 1 과 같다 = KST 기준 날짜 차이.
  select greatest(0,
    (((now() at time zone 'UTC') + interval '5 hours')::date
     - ((first_seen at time zone 'UTC') + interval '5 hours')::date))::int
    into days_since;

  lv := least(
    1 + floor(sqrt(greatest(0, exp_n)::numeric * greatest(0, skill_n)::numeric))::int,
    (days_since / 3) + 1
  );

  update characters set
    experience_count = exp_n,
    skill_count      = skill_n,
    memory_count     = mem_n,
    active_days      = active_n,
    oldest_memory_at = oldest_mem,
    level            = lv::smallint,
    last_computed_at = now()
  where user_id = uid;

  raise notice '경험 % · 스킬 % · 기억 % · 활동일 % · 함께한 지 %일 → 레벨 %',
    exp_n, skill_n, mem_n, active_n, days_since + 1, lv;
end $$;

select c.name as 이름, c.level as 레벨, c.experience_count as 경험, c.skill_count as 스킬,
       c.memory_count as 기억, c.active_days as 활동일, u.created_at::date as 시작일
from devices d
join users u on u.id = d.user_id
join characters c on c.user_id = u.id
where d.extension_key = 'na_8YQcrfm5c7oLt8yvzPugTP5OSIgNzGGC';
