-- ============================================================
-- 되풀이한 절차 — 사람이 답한 것만 남긴다.
--
-- 후보는 **계산**이고 여기 남는 것은 **저장**이다. 후보는 세션의 조작 열에서
-- 매번 새로 뽑으므로 표가 필요 없다. 사람이 답한 것만 남는다.
--
-- 왜 남겨야 하나:
--   거절 — 안 남기면 「아니야」 누른 것이 다음 주에 또 올라온다.
--   승인 — 이름은 계산에서 안 나오고, 무엇보다 **단계를 얼려야** 한다.
--
-- 얼리는 것이 핵심이다. 실행용 단계를 매번 다시 계산하면, 승인한 뒤에 그
-- 절차를 조금 다르게 한 번 하는 것만으로 스킬이 몰래 바뀐다 — 승인한 것과
-- 도는 것이 달라진다.
--
-- signature 로 잇는다. 열쇠들을 이은 문자열이라 정규화 규칙이 바뀌면 값도
-- 바뀌고, 그러면 거절했던 후보가 목록에 다시 뜬다. 한 번 더 거절하면 되는
-- 정도라 받아들인다 — 규칙을 실데이터 보고 고칠 참인데 그때까지 승인을
-- 못 하게 막는 쪽이 더 비싸다.
-- ============================================================

create table if not exists procedures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,

  -- 후보를 식별하는 열쇠 열. 정규화 규칙이 바뀌면 이 값도 바뀐다.
  signature text not null,

  -- approved: 사람이 절차로 인정했다. rejected: 자동화할 값어치가 없다.
  status text not null,

  -- 사람이 지은 이름. 거절한 것은 없다.
  name text,

  -- **승인 시점의 단계.** 이후 계산이 이 값을 건드리지 않는다.
  steps jsonb not null default '[]'::jsonb,

  -- 무언가를 바꾸는 조작이 있나. 나중에 사람 없이 돌려도 되는지의 기준이다 —
  -- 읽기 전용은 최악이 헛수고고 바꾸는 것은 최악이 되돌릴 수 없다.
  mutates boolean not null default false,

  created_at timestamptz not null default now(),

  constraint procedures_status_check check (status in ('approved', 'rejected'))
);

-- 같은 절차에 두 번 답할 수는 없다. 마음이 바뀌면 지우고 다시 답한다.
create unique index if not exists uq_procedures_user_sig on procedures (user_id, signature);
create index if not exists idx_procedures_user on procedures (user_id, created_at desc);
