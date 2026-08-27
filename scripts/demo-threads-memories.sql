-- ============================================================
-- 데모 계정의 갈래·기억을 채운다. **LLM 을 부르지 않는다.**
--
-- supabase/migrations 에 두지 않는 이유: 이건 스키마가 아니라 특정 계정의
-- 데이터다. 거기 있으면 새 환경마다 실행되고, 아래 키가 하드코딩돼 있다.
--
-- Supabase 대시보드 → SQL Editor 에 통째로 붙여넣고 실행한다.
-- **두 번 돌려도 안전하다** — 이미 있는 이름·갈래·기억은 건드리지 않는다.
--
-- 기억 본문은 손으로 쓴 것이다. 실제 서비스에서 이 자리는 모델이 쓴다
-- (memory-resummary). 데모 화면을 채우는 용도다.
-- ============================================================

do $$
declare
  demo_key text := 'na_8YQcrfm5c7oLt8yvzPugTP5OSIgNzGGC';

  uid    uuid;
  r      record;
  tid    uuid;
  ev_ids uuid[];
  ev_at  timestamptz;
  n      int;
  imp    smallint;

  made_threads  int := 0;
  made_memories int := 0;
begin
  select d.user_id into uid from devices d where d.extension_key = demo_key;
  if uid is null then
    raise exception '그 키로 등록된 기기가 없다: %', demo_key;
  end if;

  for r in
    select * from (values
      ('design',        '포트폴리오 리뉴얼',   '시안을 세 번 갈아엎었다',
       '처음 잡은 레이아웃이 계속 답답했는데, 여백을 늘리고 나서야 이유를 알았다. 글자를 줄이는 게 아니라 사이를 벌리는 문제였다.'),
      ('study',         '일본어 공부',         '유닛 하나를 사흘 만에 끝냈다',
       '매일 밤 조금씩 붙잡았더니 12에서 14까지 갔다. 한자는 여전히 헷갈리지만 문장이 눈에 들어오기 시작했다.'),
      ('shopping',      '러닝화 고르기',       '발볼 때문에 이틀을 뒤졌다',
       '후기를 아무리 읽어도 결국 발볼이 문제였다. 모델 이름보다 그 한 가지를 먼저 봤어야 했다.'),
      ('finance',       '가계부 정리',         '주말마다 같은 순서로 맞춘다',
       '지출을 카테고리로 나누고 메모를 남기는 것까지가 한 묶음이 됐다. 두 번째부터는 십오 분이면 끝났다.'),
      ('productivity',  '아침에 여는 세 군데', '메일, 캘린더, 노션 순서가 굳었다',
       '어느 날부터 순서가 정해졌다. 먼저 오늘 뭐가 오는지 보고, 그다음에 뭘 할지 정한다.'),
      ('search',        '오사카 계획',         '가고 싶은 곳을 먼저 적었다',
       '일정부터 짜려니 막혔는데, 가고 싶은 데를 먼저 늘어놓으니 순서는 저절로 잡혔다.'),
      ('ai',            'AI 로 만들어보기',    '물어보는 방식을 바꿨다',
       '한 번에 다 시키면 엉뚱한 게 나왔다. 쪼개서 묻고 중간을 확인하니 훨씬 나았다.'),
      ('dev',           'Project NA 만들기',   '키가 계정이던 걸 기기로 낮췄다',
       '브라우저를 지우면 캐릭터가 사라지는 게 계속 걸렸다. 키를 기기로 내리고 계정을 따로 두니 그 문제가 통째로 없어졌다.'),
      ('community',     '읽을거리 훑기',       '남의 실패담이 제일 남는다',
       '새 기술 소개보다 삽질 기록이 더 오래 기억에 남았다.'),
      ('news',          '뉴스 훑기',           null::text, null::text),
      ('music',         '작업할 때 듣는 것',   null::text, null::text),
      ('entertainment', '쉬는 시간',           null::text, null::text),
      ('docs',          '문서 읽기',           null::text, null::text)
    ) as p(category, title, mem_title, mem_body)
  loop
    select count(*) into n from experiences e
    where e.user_id = uid and e.category = r.category;
    continue when n = 0;

    select t.id into tid from threads t
    where t.user_id = uid and t.category = r.category
    order by t.started_at limit 1;

    if tid is null then
      insert into threads (user_id, title, category, status,
                           started_at, last_activity_at, experience_count)
      select uid, r.title, r.category, 'active',
             min(e.occurred_at), max(e.occurred_at), count(*)::int
      from experiences e
      where e.user_id = uid and e.category = r.category
      returning id into tid;
      made_threads := made_threads + 1;
    end if;

    -- 아직 어느 갈래에도 안 붙은 경험만 붙인다. 이미 붙은 것은 그대로 둔다 —
    -- experience-engine 이 판단해서 붙여둔 것이라 그게 더 정확하다.
    update experiences set thread_id = tid
    where user_id = uid and category = r.category and thread_id is null;

    update threads set
      experience_count = (select count(*)::int from experiences where thread_id = tid),
      last_activity_at = (select max(occurred_at) from experiences where thread_id = tid)
    where id = tid;

    if r.mem_title is not null
       and not exists (select 1 from memories m where m.thread_id = tid) then

      ev_ids := array(
        select e.id from experiences e
        where e.thread_id = tid
        order by e.memory_score desc, e.occurred_at desc
        limit 3
      );
      select e.occurred_at into ev_at from experiences e where e.id = ev_ids[1];

      -- importance 는 1~10 이다 (memory-score.ts 의 memoryImportance 와 같은 범위).
      imp := least(10, greatest(4, 4 + coalesce(array_length(ev_ids, 1), 0) + (n / 6)))::smallint;

      insert into memories (user_id, thread_id, experience_id, experience_ids, occurred_at,
                            title, body, importance, trigger, triggers)
      values (uid, tid, ev_ids[1], ev_ids, ev_at,
              r.mem_title, r.mem_body, imp, 'new_skill', array['new_skill']);
      made_memories := made_memories + 1;
    end if;
  end loop;

  raise notice '갈래 % 개, 기억 % 개를 새로 만들었다', made_threads, made_memories;
end $$;

-- 결과 확인.
select
  (select name from characters where user_id = d.user_id)                       as 이름,
  (select count(*) from threads     where user_id = d.user_id)                  as 갈래,
  (select count(*) from memories    where user_id = d.user_id)                  as 기억,
  (select count(*) from experiences where user_id = d.user_id)                  as 경험,
  (select count(*) from experiences where user_id = d.user_id and thread_id is null) as 갈래없는경험
from devices d
where d.extension_key = 'na_8YQcrfm5c7oLt8yvzPugTP5OSIgNzGGC';
