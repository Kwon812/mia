-- 기억을 갈래당 하나로 모은다.
--
-- 지금은 경험 하나가 60점을 넘을 때마다 기억이 따로 생긴다. 그래서 같은 갈래에
-- 기억이 셋씩 붙었다(실데이터: "Project NA 기술 아키텍처 설계" 경험 9건 → 기억 3개).
-- 셋은 결국 같은 주제인데 제목만 다르고, 게다가 셋 다 누르면 같은 위성 9건이
-- 뜬다 — 기억의 근거가 "자기 경험 + 같은 갈래 경험 전부"였기 때문이다.
-- 새벽 2시 기억이 4시간 뒤 경험까지 근거로 보여주는 셈이었다.
--
-- 바꾸면: 그 갈래에 기억이 이미 있으면 새로 만들지 않고 **경험 id 를 배열에
-- 더한다.** 위성은 그 배열이 되어 실제로 그 기억을 만든 것들만 뜬다.
--
-- trigger 도 배열이다. 1월에 처음 써본 도구가 있었고(new_skill) 3월에 6건째가
-- 됐다면(deepened) 둘 다 사실이다. 화면은 방향·이심률에 값 하나가 필요하니
-- 읽을 때 가장 센 것을 고른다 — 저장은 전부, 선택은 읽을 때.
--
-- FK 를 잃는다. 배열 컬럼에는 참조 무결성을 못 건다. experiences 를 지우는 건
-- 재구축뿐이고 그때 memories 도 함께 지워지므로 실무상 문제가 없다.

alter table memories
  add column if not exists experience_ids uuid[] not null default '{}',
  add column if not exists triggers text[] not null default '{}',
  -- 배열이 늘어난 기억만 밤에 다시 요약한다. 세션 처리 중에 LLM 을 부르면
  -- "세션당 1회" 규칙이 깨지고 after() 안의 작업이 길어진다.
  add column if not exists needs_resummary boolean not null default false;

-- 기존 값을 배열로 옮긴다.
update memories
   set experience_ids = case when experience_id is null then '{}' else array[experience_id] end,
       triggers       = array[trigger]
 where cardinality(experience_ids) = 0;

-- 이미 한 갈래에 여럿 붙어 있는 기억을 하나로 합친다.
--
-- 남기는 것은 **가장 이른 것**이다. 그 일이 처음 남을 만해진 순간이고,
-- occurred_at 이 곧 지도의 반경(나이)이라 나중 것을 남기면 그 일이 실제보다
-- 최근에 시작한 것처럼 보인다.
--
-- 제목·본문은 손대지 않고 needs_resummary 만 세운다. 합쳐진 근거로 다시 쓰는
-- 것은 밤 배치의 일이다 — 마이그레이션이 LLM 을 부를 수는 없다.
with ranked as (
  select id, user_id, thread_id, experience_ids, triggers, importance,
         first_value(id) over w as keep_id
    from memories
   where thread_id is not null and forgotten_at is null
  window w as (partition by user_id, thread_id order by occurred_at, id)
),
merged as (
  select keep_id,
         array(select distinct unnest(array_agg(experience_ids_flat))) as ids,
         array(select distinct unnest(array_agg(trigger_flat)))       as trs,
         max(importance) as imp,
         count(*) filter (where id <> keep_id) as absorbed
    from (
      select r.id, r.keep_id, r.importance,
             unnest(case when cardinality(r.experience_ids)=0 then array[null::uuid] else r.experience_ids end) as experience_ids_flat,
             unnest(case when cardinality(r.triggers)=0 then array[null::text] else r.triggers end) as trigger_flat
        from ranked r
    ) x
   group by keep_id
)
update memories m
   set experience_ids  = array(select u from unnest(merged.ids) u where u is not null),
       triggers        = array(select t from unnest(merged.trs) t where t is not null),
       importance      = merged.imp,
       needs_resummary = merged.absorbed > 0
  from merged
 where m.id = merged.keep_id;

delete from memories m
 where m.thread_id is not null
   and m.forgotten_at is null
   and exists (
     select 1 from memories o
      where o.user_id = m.user_id and o.thread_id = m.thread_id
        and o.forgotten_at is null
        and (o.occurred_at, o.id) < (m.occurred_at, m.id)
   );

-- 갈래당 기억 하나. 여기부터는 append 로만 자란다.
-- thread_id 가 NULL 인 기억(갈래 없는 경험에서 나온 것)은 이 제약을 안 받는다.
create unique index if not exists uq_memories_thread
  on memories (user_id, thread_id)
  where thread_id is not null and forgotten_at is null;

create index if not exists idx_memories_resummary
  on memories (user_id)
  where needs_resummary;

comment on column memories.experience_ids is
  '이 기억을 만든 경험들. 조건을 넘길 때마다 더해진다. 위성으로 펼쳐지는 목록.';
comment on column memories.triggers is
  '왜 남았는지 전부. 화면은 가장 센 것 하나로 방향·이심률을 정한다.';

-- 재요약도 LLM 호출이라 원본을 남긴다. kind CHECK 에 종류를 더한다 —
-- 안 넣으면 요약은 성공하는데 "무엇을 뱉었나"만 조용히 유실된다.
alter table llm_outputs drop constraint if exists llm_outputs_kind_check;
alter table llm_outputs add constraint llm_outputs_kind_check
  check (kind in ('experience', 'daily_log', 'memory_resummary'));
