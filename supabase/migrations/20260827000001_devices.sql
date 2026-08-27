-- ============================================================
-- devices — 키를 계정에서 떼어낸다.
--
-- 지금까지 extension_key 는 users 의 컬럼이었다. 키 하나가 곧 유저 하나라는
-- 뜻이고, 거기서 두 가지가 따라 나왔다.
--
--   기기를 못 합친다. 노트북과 데스크톱은 각각 키를 발급받으므로 각각 다른
--   캐릭터가 된다. 한 사람이 쓰는데 둘로 갈린다.
--
--   잃으면 끝이다. 08-08 에 실제로 났다 — IndexedDB 가 비면서 새 키가
--   발급됐고, 그때부터 세션은 이름 없는 새 계정에 쌓였다. 사이트 쿠키는 옛
--   키라 화면에는 아무 일도 없어 보였고, 며칠 뒤 "경험이 왜 하나뿐이지"로
--   발견됐다.
--
-- 둘 다 "키 = 계정" 이라는 한 가지에서 나온다. 키를 기기로 낮추면 사라진다.
--
--   키 = 기기        여러 개여도 된다. 잃어도 계정은 남는다.
--   계정 = users     구글 신원이 붙을 자리(다음 마이그레이션)
--
-- **이 마이그레이션은 동작을 바꾸지 않는다.** 지금 있는 키를 그대로 기기로
-- 복사할 뿐이고, 유저당 기기는 여전히 하나다. users.extension_key 도 그대로
-- 둔다 — 읽는 쪽만 여기로 옮기고, 컬럼을 지우는 것은 한참 뒤 별도 작업이다.
-- 되돌릴 곳을 남겨두지 않고 인증 경로를 갈아끼우지 않는다.
-- ============================================================

create table if not exists devices (
  -- 키 자체가 열쇠다. users 에서 UNIQUE 였던 성질을 그대로 가져온다.
  extension_key text primary key,

  user_id uuid not null references users(id) on delete cascade,

  -- '회사 노트북' 처럼 사람이 붙이는 이름. 기기가 둘 이상이 되기 전에는
  -- 쓸 곳이 없어 NULL 로 둔다.
  label text,

  created_at   timestamptz not null default now(),

  -- 기기 목록에서 "이거 아직 쓰는 기기인가"를 판단할 값. 매 요청마다 쓰면
  -- 읽기 경로가 쓰기 경로가 되므로, 세션 마감 전송처럼 드문 지점에서만
  -- 갱신할 참이다. 그 지점이 붙기 전까지는 created_at 과 같은 값이다.
  last_seen_at timestamptz not null default now()
);

-- "이 유저의 기기 목록" 이 유일한 비-PK 조회 패턴이다.
create index if not exists devices_user_id_idx on devices (user_id);

-- 지금 있는 키를 전부 기기로 옮긴다. **데이터는 하나도 안 움직인다** —
-- sessions·experiences 등 11개 테이블이 참조하는 users.id 가 그대로이기 때문에,
-- 이 전환에 실질적인 데이터 마이그레이션이 없다.
-- created_at 을 users 것으로 맞추는 이유: 기기가 계정보다 나중에 생긴 것처럼
-- 보이면 나중에 "가장 오래된 기기"를 물을 때 답이 틀린다.
insert into devices (extension_key, user_id, created_at, last_seen_at)
select extension_key, id, created_at, created_at
from users
on conflict (extension_key) do nothing;

-- 다른 표와 같은 취급. 정책을 따로 두지 않으므로 service role 외에는 못 읽는다.
alter table devices enable row level security;
