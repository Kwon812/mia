-- ============================================================
-- 사람 판단(declared) 저장소
--
-- 이 시스템에서 사람의 판단이 들어오는 **유일한 지점**이다. experiences ·
-- dialogues · daily_logs 는 전부 LLM 생성물(inferred)이라, 그것만으로는
-- 1년 뒤에 학습 데이터를 뽑아도 모델을 다시 학습시키는 꼴이 된다.
-- assertion class 는 packages/shared/src/assertion.ts 참고
-- (declared > observed > inferred).
--
-- 두 테이블로 나눈 이유:
--   corrections — 사람이 실제로 내린 판단. 행이 있으면 반드시 답이 있다.
--   questions   — 캐릭터가 던진 질문과 그 결말. **침묵도 기록**해야 한다.
-- 하나로 합치면 human_value 가 NULL 인 행이 "안 물어봤다"인지 "묻고 답을
-- 못 받았다"인지 구분되지 않는다. 1년 뒤 데이터셋을 뽑을 때 이 둘을
-- 섞으면 무응답이 동의로 둔갑한다.
-- ============================================================

-- ── 교정 (append-only) ──
-- UPDATE 하지 않는다. 같은 필드를 두 번 고치면 두 행이 쌓이고 최신 행이 이긴다.
-- 덮어쓰면 (모델 출력, 사람 정답) 쌍이 사라지는데, 학습에 필요한 건 정답이
-- 아니라 그 **쌍**이다. 사람이 마음을 바꾼 이력 자체도 신호다.
create table if not exists corrections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  experience_id uuid not null references experiences(id) on delete cascade,

  -- 무엇을 고쳤나. 이산 필드만 받는다 — 자유 서술은 비용 대비 회수가 나쁘고
  -- (사용자 결정으로 층 3 제외), 이산값이라야 학습에 바로 쓰인다.
  field text not null,
  -- 모델이 냈던 값. 교정 시점에 experiences 에서 읽어 박제한다 —
  -- experiences 는 불변이지만 재처리(apply-reprocess)로 값이 바뀔 수 있어,
  -- 참조가 아니라 사본이어야 쌍이 보존된다.
  model_value text not null,
  human_value text not null,

  -- 'diary' = /diary 에서 칩을 눌러 고침, 'ask' = 캐릭터 질문에 답함
  source text not null,
  question_id uuid, -- source='ask' 일 때 questions.id. FK 는 아래에서 건다

  created_at timestamptz not null default now(),

  constraint corrections_field_check
    check (field in ('outcome', 'category', 'is_first_time')),
  constraint corrections_source_check
    check (source in ('diary', 'ask'))
);

-- 경험의 "현재 교정값"을 읽는 경로 — (experience_id, field) 최신 1건.
create index if not exists idx_corrections_latest
  on corrections (experience_id, field, created_at desc);

-- 데이터셋 추출 경로 — 유저별 시간순 전량 스캔.
create index if not exists idx_corrections_user_time
  on corrections (user_id, created_at desc);

-- ── 질문 (캐릭터가 물은 것) ──
-- answered_at 도 dismissed_at 도 NULL 인 행 = **침묵**이다. "안 고쳤다"를
-- "맞다"로 세면 데이터가 조용히 오염된다 — 무응답은 대부분 동의가 아니라
-- 안 본 것이다. 물어본 시각을 남겨야 그 구분이 산다.
create table if not exists questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  experience_id uuid not null references experiences(id) on delete cascade,

  field text not null,
  model_value text not null,
  text text not null, -- 캐릭터가 던진 문장

  asked_at timestamptz not null default now(),
  answered_at timestamptz,
  dismissed_at timestamptz, -- 사용자가 "모르겠어"로 넘김 — 침묵과 구분한다

  constraint questions_field_check
    check (field in ('outcome', 'category', 'is_first_time')),
  -- 같은 경험의 같은 필드를 두 번 묻지 않는다. 하루 1건짜리 예산이라
  -- 중복 질문 하나가 그날치를 통째로 버리는 셈이 된다.
  constraint questions_unique_target unique (experience_id, field)
);

-- 오늘 물어볼 게 있는지 / 미답변이 있는지 확인하는 경로.
create index if not exists idx_questions_open
  on questions (user_id, asked_at desc);

alter table corrections
  add constraint corrections_question_fk
  foreign key (question_id) references questions(id) on delete set null;
