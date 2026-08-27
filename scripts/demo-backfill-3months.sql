-- ============================================================
-- 데모 계정에 3개월치를 채운다. **LLM 을 부르지 않는다.**
--
-- 세션과 경험을 직접 넣는다. 최근 14일은 이미 파이프라인이 만든 진짜 산출물이라
-- 건드리지 않고, 그 이전 15~104일차(약 3개월)를 채운다.
--
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 실행한다.
-- **다시 돌려도 안전하다** — tags 에 'backfill' 이 붙은 것만 지우고 다시 넣는다.
--
-- 이 파일을 먼저 돌리고, 그다음 demo-threads-memories.sql 을 돌린다.
-- 그래야 여기서 넣은 경험까지 갈래에 붙는다.
-- ============================================================

do $$
declare
  demo_key text := 'na_8YQcrfm5c7oLt8yvzPugTP5OSIgNzGGC';
  uid uuid;

  cats text[] := array['design','study','shopping','finance','productivity','search',
                       'ai','dev','community','news','music','entertainment','docs'];
  doms text[] := array['figma.com','duolingo.com','coupang.com','toss.im','notion.so','google.com',
                       'claude.ai','github.com','reddit.com','news.hada.io','music.youtube.com',
                       'netflix.com','developer.mozilla.org'];
  -- 카테고리마다 세 가지. 인덱스는 (카테고리-1)*3 + 변형.
  sums text[] := array[
    '시안 레이아웃을 다시 잡음',      '컴포넌트 정리하고 이름 통일',   '색 대비 맞추다 팔레트 교체',
    '단어 복습하고 문법 하나 정리',   '유닛 하나 끝내고 오답 다시 봄', '듣기 연습 20분',
    '가격 비교하다 후기까지 읽음',    '장바구니 정리하고 하나만 남김', '반품 신청하고 대체품 찾음',
    '이번 달 지출 카테고리 정리',     '구독료 두 개 해지',             '예산 다시 잡음',
    '주간 보드 정리하고 일정 옮김',   '밀린 할 일 세 개 처리',         '메모를 노트로 옮겨 묶음',
    '궁금한 거 찾다가 다른 데로 샘',  '자료 몇 개 골라 저장',          '비교해보고 하나로 정함',
    '프롬프트 쪼개서 다시 물어봄',    '초안 받아서 손으로 고침',       '결과 정리해서 노트에 붙임',
    '버그 재현하고 원인 좁힘',        '리팩터링하고 테스트 돌림',      '배포하고 로그 확인',
    '스레드 훑다가 하나 길게 읽음',   '댓글 달고 답 기다림',           '북마크 정리',
    '헤드라인 훑고 두 개만 읽음',     '기사 하나 끝까지 읽음',         '요약만 보고 넘김',
    '작업하면서 틀어둠',              '플레이리스트 새로 만듦',        '앨범 하나 통째로 들음',
    '한 편 보고 끔',                  '보다가 중간에 멈춤',            '몰아서 두 편',
    '문서 훑고 예제만 따라해봄',      '레퍼런스 찾다가 정독',          '변경 이력 확인'
  ];
  outs text[] := array['success','partial','explore','stuck'];

  d int; k int; ci int; sec int; dur int; hh int;
  ts timestamptz; sid uuid; made int := 0;
begin
  select dv.user_id into uid from devices dv where dv.extension_key = demo_key;
  if uid is null then raise exception '그 키로 등록된 기기가 없다: %', demo_key; end if;

  -- 다시 돌릴 수 있게 지난번 백필을 먼저 치운다. experiences 는 cascade 로 따라 지워진다.
  delete from sessions where user_id = uid and 'backfill' = any(tags);

  for d in 15..104 loop
    -- 하루에 한둘. 가끔 쉬는 날을 만든다(사람은 매일 같은 양을 쓰지 않는다).
    continue when d % 9 = 0;

    for k in 0..(d % 2) loop
      -- 13 과 서로소인 5 를 곱해 카테고리를 골고루 돌린다.
      ci  := ((d * 5 + k * 7) % 13) + 1;
      dur := 18 + ((d * 7 + k * 11) % 72);
      sec := dur * 60 - 120;
      hh  := 9 + ((d + k * 6) % 12);
      ts  := date_trunc('day', now()) - (d || ' days')::interval + (hh || ' hours')::interval;
      sid := gen_random_uuid();

      insert into sessions (id, user_id, started_at, ended_at, duration_min, close_reason,
                            primary_category, activity_score, unique_domains, switch_count,
                            tags, compressed_log, domains, processed_at)
      values (
        sid, uid, ts, ts + (dur || ' minutes')::interval, dur,
        (array['idle','switch','maxlen','day'])[1 + (d % 4)],
        cats[ci],
        greatest(1, dur * (case when cats[ci] in ('music','entertainment','news') then 1 else 5 end)),
        1 + (d % 3)::smallint,
        (d % 4)::smallint,
        array['backfill'],
        jsonb_build_object(
          'segments', jsonb_build_array(jsonb_build_object(
            'domain', doms[ci], 'category', cats[ci],
            'start', to_char(ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
            'end',   to_char((ts + (sec || ' seconds')::interval) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
            'sec', sec)),
          'tags', jsonb_build_array(), 'queries', jsonb_build_array()),
        jsonb_build_object(doms[ci], sec),
        ts + interval '2 minutes'
      );

      insert into experiences (user_id, session_id, thread_id, occurred_at, summary, detail,
                               category, outcome, is_first_time, memory_score, segment_ids, duration_min)
      values (
        uid, sid, null, ts,
        sums[(ci - 1) * 3 + 1 + ((d + k) % 3)],
        null,
        cats[ci],
        outs[1 + ((d * 3 + k) % 4)],
        (d % 11 = 0),
        20 + ((d * 13 + k * 5) % 45),
        array[0],
        dur
      );

      made := made + 1;
    end loop;
  end loop;

  raise notice '세션·경험 % 건을 넣었다', made;
end $$;

-- 결과 확인.
select
  (select count(*) from sessions    where user_id = d.user_id) as 세션,
  (select count(*) from experiences where user_id = d.user_id) as 경험,
  (select min(started_at)::date from sessions where user_id = d.user_id) as 처음,
  (select max(started_at)::date from sessions where user_id = d.user_id) as 마지막,
  (select count(distinct category) from experiences where user_id = d.user_id) as 분야수
from devices d where d.extension_key = 'na_8YQcrfm5c7oLt8yvzPugTP5OSIgNzGGC';
