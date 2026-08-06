-- ============================================================
-- 원본 관측 콜드 스토리지 버킷
--
-- sessions.compressed_log 아래에 있는 압축 전 이벤트를 그대로 보관한다.
-- compressed_log 는 Haiku 프롬프트 입력이라 앞으로도 작게 유지하고
-- (MAX_QUERIES=15, MAX_SEGMENT_PATHS=3, 제목 200자 절단), 손실 없는 원본은
-- 여기 따로 쌓는다. 둘은 소비자가 달라서 하나로 겸할 수 없다.
--
-- 경로: raw/{user_id}/{YYYY-MM-DD}/{session_id}.jsonl.gz  (KST 달력일)
-- 규모: 1인 기준 연 ~45MB (세션당 gzip 후 ~5KB × 하루 25세션)
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'na-raw',
  'na-raw',
  -- ⚠️ 반드시 private. public 이면 경로만 알아도 남의 원본이 열린다.
  false,
  2097152, -- 2MB — apps/web/src/app/api/raw/route.ts 의 MAX_BODY_BYTES 와 같은 값
  array['application/gzip']
)
on conflict (id) do nothing;

-- storage.objects 에 정책을 만들지 않는다. RLS 기본값이 deny 라 anon/authenticated
-- 는 접근할 수 없고, 쓰기는 service_role(= createAdminClient, RLS 우회)로만 한다.
-- 정책을 하나라도 여는 순간 이 버킷의 격리가 그 정책의 정확성에 의존하게 된다.
