-- ============================================================
-- Project NA — 초기 스키마 (docs/na-schema.sql 기반)
-- 2026-08-04
--
-- 설계 원칙
--   1. experiences 는 불변. UPDATE 는 thread_id 부착 1회만 허용.
--   2. 나머지는 전부 experiences 에서 재계산 가능한 파생 테이블.
--   3. occurred_at(실제 발생) 과 received_at(서버 도착) 을 분리한다.
--      세션은 며칠 뒤에 도착할 수 있다.
--   4. emotions 테이블은 만들지 않는다. 최근 경험에서 매번 계산한다.
--
-- 원본 문서와의 차이: threads 를 experiences 보다 먼저 생성한다.
-- (experiences.thread_id 가 threads 를 참조하므로 원본 순서로는 실행 불가)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- 1. 사용자 / 캐릭터
-- ============================================================

CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  extension_key   TEXT UNIQUE NOT NULL,   -- 확장이 발급받는 익명 키
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE characters (
  user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT,                   -- 사용자가 지어준 이름. NULL = 아직 없음
  named_at        TIMESTAMPTZ,

  -- 아래는 전부 파생 캐시. 야간 배치에서 재계산한다.
  level           SMALLINT NOT NULL DEFAULT 1,
  experience_count INT     NOT NULL DEFAULT 0,
  skill_count     INT      NOT NULL DEFAULT 0,
  active_days     INT      NOT NULL DEFAULT 0,
  memory_count    INT      NOT NULL DEFAULT 0,
  oldest_memory_at TIMESTAMPTZ,           -- Lv.30 툴 게이팅 조건

  last_computed_at TIMESTAMPTZ
);

-- buildTools() 가 이 한 행만 읽으면 되도록 전부 여기 모은다.
-- JOIN 없이 툴 게이팅 판정 끝.


-- ============================================================
-- 2. 세션 — 확장이 보낸 관측 단위
-- ============================================================

CREATE TABLE sessions (
  id              UUID PRIMARY KEY,       -- 클라이언트 생성. 서버 생성 아님
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  started_at      TIMESTAMPTZ NOT NULL,
  ended_at        TIMESTAMPTZ NOT NULL,
  duration_min    INT NOT NULL,

  close_reason    TEXT NOT NULL
                  CHECK (close_reason IN ('idle','switch','maxlen','day','shutdown')),
  continued_from  UUID REFERENCES sessions(id),   -- maxlen 절단 시 이전 세션

  primary_category TEXT NOT NULL,
  activity_score  INT NOT NULL,
  unique_domains  SMALLINT NOT NULL,
  switch_count    SMALLINT NOT NULL DEFAULT 0,
  tags            TEXT[] DEFAULT '{}',    -- 'scattered' 등

  compressed_log  JSONB NOT NULL,         -- LLM 입력 원본
  domains         JSONB NOT NULL,         -- { "github.com": 320, ... }

  received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at    TIMESTAMPTZ             -- NULL = LLM 미처리
);

-- PK 가 클라이언트 UUID 라서 재시도 중복이 자동으로 막힌다.
-- 서버는 ON CONFLICT DO NOTHING 으로 받으면 끝.

CREATE INDEX idx_sessions_unprocessed
  ON sessions(user_id, received_at)
  WHERE processed_at IS NULL;

CREATE INDEX idx_sessions_user_time
  ON sessions(user_id, started_at DESC);


-- ============================================================
-- 3. 스레드 — 여러 경험에 걸친 하나의 작업
--    (experiences 가 참조하므로 먼저 생성)
-- ============================================================

CREATE TABLE threads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  title           TEXT NOT NULL,          -- "Redis 캐싱 도입"
  category        TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','completed','abandoned')),

  started_at      TIMESTAMPTZ NOT NULL,
  last_activity_at TIMESTAMPTZ NOT NULL,
  completed_at    TIMESTAMPTZ,
  experience_count INT NOT NULL DEFAULT 1
);

CREATE INDEX idx_threads_active
  ON threads(user_id, last_activity_at DESC)
  WHERE status = 'active';

-- status 전이가 곧 기억 생성 트리거다.
--   started            → "Unity 시작"
--   active → completed → "첫 게임 출시"
--   30일 무활동        → abandoned (기억 아님. 성격 축 '완결형↔탐색형' 입력)


-- ============================================================
-- 4. 경험 — 의미 단위. 불변.
-- ============================================================

CREATE TABLE experiences (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id      UUID NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  thread_id       UUID REFERENCES threads(id),   -- 나중에 부착. 유일한 UPDATE 대상

  occurred_at     TIMESTAMPTZ NOT NULL,   -- session.started_at. 정렬은 항상 이걸로
  summary         TEXT NOT NULL,          -- "Redis 캐싱 구현 성공"
  detail          TEXT,                   -- 2~3문장. 일기 생성용
  category        TEXT NOT NULL,

  outcome         TEXT CHECK (outcome IN ('success','partial','stuck','explore')),
  is_first_time   BOOLEAN NOT NULL DEFAULT false,  -- 신규 스킬 포함 여부
  memory_score    INT NOT NULL DEFAULT 0,          -- Memory Engine 점수

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_exp_user_time  ON experiences(user_id, occurred_at DESC);
CREATE INDEX idx_exp_thread     ON experiences(thread_id) WHERE thread_id IS NOT NULL;
CREATE INDEX idx_exp_unthreaded ON experiences(user_id, occurred_at)
                                 WHERE thread_id IS NULL;

-- outcome 이 감정의 재료다.
--   stuck 3연속  → 답답
--   success      → 성취
--   explore      → 호기심
-- emotion 컬럼을 두지 않는 이유: 감정은 시점에 따라 달라지는 파생값이다.


-- ============================================================
-- 5. 스킬
-- ============================================================

CREATE TABLE experience_skills (
  experience_id   UUID NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
  skill_name      TEXT NOT NULL,          -- 'TypeScript', 'Unity'
  weight          SMALLINT NOT NULL DEFAULT 1,
  PRIMARY KEY (experience_id, skill_name)
);

CREATE INDEX idx_expskill_name ON experience_skills(skill_name);

-- 파생 캐시. experience_skills 에서 언제든 재계산 가능.
CREATE TABLE user_skills (
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_name      TEXT NOT NULL,
  domain          TEXT NOT NULL,          -- 'programming' | 'art' | 'life'
  points          INT NOT NULL DEFAULT 0,
  use_count       INT NOT NULL DEFAULT 0,
  first_used_at   TIMESTAMPTZ NOT NULL,   -- is_first_time 판정 기준
  last_used_at    TIMESTAMPTZ NOT NULL,   -- "오래 안 쓴 스킬 재등장" 판정
  PRIMARY KEY (user_id, skill_name)
);

CREATE INDEX idx_userskill_recent ON user_skills(user_id, last_used_at DESC);


-- ============================================================
-- 6. 장기 기억
-- ============================================================

CREATE TABLE memories (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  thread_id       UUID REFERENCES threads(id),
  experience_id   UUID REFERENCES experiences(id),

  occurred_at     TIMESTAMPTZ NOT NULL,
  title           TEXT NOT NULL,          -- "첫 게임 출시"
  body            TEXT NOT NULL,
  importance      SMALLINT NOT NULL,
  trigger         TEXT NOT NULL,          -- 'new_skill' | 'thread_complete' | 'comeback'

  ref_count       INT NOT NULL DEFAULT 0,       -- searchMemory 로 불려간 횟수
  last_referenced_at TIMESTAMPTZ,
  forgotten_at    TIMESTAMPTZ                   -- Lv.80 망각. 삭제하지 않고 마킹
);

CREATE INDEX idx_mem_user_time ON memories(user_id, occurred_at DESC)
                                WHERE forgotten_at IS NULL;
CREATE INDEX idx_mem_search    ON memories
       USING GIN (to_tsvector('simple', title || ' ' || body));

-- 망각 기준: importance 낮음 + ref_count 0 + 180일 경과
-- 삭제가 아니라 forgotten_at 마킹. searchMemory 결과에서만 빠진다.
-- 성능 최적화가 서사와 일치하는 지점.


-- ============================================================
-- 7. 성격 — 스냅샷
-- ============================================================

CREATE TABLE personality_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  computed_at     TIMESTAMPTZ NOT NULL,
  window_start    TIMESTAMPTZ NOT NULL,   -- 2주 이동평균 구간
  window_end      TIMESTAMPTZ NOT NULL,

  -- 각 축 -100 ~ +100
  focus_scatter   SMALLINT NOT NULL,      -- 몰입형(+) ↔ 산만형(-)
  depth_breadth   SMALLINT NOT NULL,      -- 집중형(+) ↔ 멀티형(-)
  finish_explore  SMALLINT NOT NULL,      -- 완결형(+) ↔ 탐색형(-)
  pioneer_master  SMALLINT NOT NULL,      -- 개척형(+) ↔ 숙련형(-)
  night_morning   SMALLINT NOT NULL,      -- 새벽형(+) ↔ 아침형(-)

  sample_size     INT NOT NULL            -- 근거 세션 수. 적으면 신뢰도 낮음
);

CREATE INDEX idx_persona_user ON personality_snapshots(user_id, computed_at DESC);

-- 갱신이 아니라 append. compareSnapshot(t1, t2) 가 Lv.50 툴이다.
-- 축 산출은 전부 sessions 에서 나온다. experiences 를 안 봐도 된다.
--   focus_scatter  = f(세션 평균 길이, scattered 태그 비율)
--   depth_breadth  = f(세션당 unique_domains)
--   finish_explore = f(threads completed / (completed + abandoned))
--   pioneer_master = f(is_first_time 비율)
--   night_morning  = f(started_at 시간대 분포)


-- ============================================================
-- 8. 일기 — 파생 테이블
-- ============================================================

CREATE TABLE daily_logs (
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  log_date        DATE NOT NULL,          -- 새벽 4시 기준 하루
  summary         TEXT NOT NULL,
  learned         TEXT[] DEFAULT '{}',
  emotion         TEXT,
  experience_ids  UUID[] NOT NULL,        -- 재생성 근거
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  prompt_version  SMALLINT NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, log_date)
);

-- prompt_version 이 핵심. 프롬프트를 개선하면 과거 일기를 전부
-- 재생성할 수 있다. experiences 가 불변이라 가능한 일.


-- ============================================================
-- 9. 대사 캐시
-- ============================================================

CREATE TABLE dialogues (
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slot            TEXT NOT NULL CHECK (slot IN ('morning','afternoon','evening','night')),
  text            TEXT NOT NULL CHECK (char_length(text) <= 80),
  source_session_id UUID REFERENCES sessions(id),
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, slot)
);

-- 사이트/새 탭 진입 시 이 4행만 읽는다. LLM 호출 없음.
-- CHECK 로 길이를 강제한다. 화면이 무너지는 것을 DB 레벨에서 막는 편이
-- 프롬프트로 부탁하는 것보다 확실하다.


-- ============================================================
-- 10. 전송 실패 추적
-- ============================================================

CREATE TABLE ingest_failures (
  id              BIGSERIAL PRIMARY KEY,
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  session_id      UUID,
  reason          TEXT NOT NULL,
  payload         JSONB,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- LLM 응답이 스키마 검증에 실패하면 여기 남긴다.
-- 세션은 processed_at NULL 로 남아 재처리 대상이 된다.


-- ============================================================
-- RLS — 모든 접근은 서버(service_role)를 경유한다.
-- anon 키로는 아무 테이블도 읽을 수 없다.
-- ============================================================

ALTER TABLE users                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE characters             ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions               ENABLE ROW LEVEL SECURITY;
ALTER TABLE threads                ENABLE ROW LEVEL SECURITY;
ALTER TABLE experiences            ENABLE ROW LEVEL SECURITY;
ALTER TABLE experience_skills      ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_skills            ENABLE ROW LEVEL SECURITY;
ALTER TABLE memories               ENABLE ROW LEVEL SECURITY;
ALTER TABLE personality_snapshots  ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_logs             ENABLE ROW LEVEL SECURITY;
ALTER TABLE dialogues              ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingest_failures        ENABLE ROW LEVEL SECURITY;
