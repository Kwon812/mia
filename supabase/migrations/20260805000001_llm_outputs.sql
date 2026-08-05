-- ============================================================
-- llm_outputs — LLM 이 뱉은 원본 출력 보관
--
-- ingest_failures 는 "실패"만 남긴다. 그래서 성공한 판정의 근거가 어디에도
-- 없었다 — outcome 이 왜 explore 였는지, is_first_time 이 왜 false 였는지를
-- 나중에 물으면 답할 방법이 세션을 다시 LLM 에 태우는 것뿐이었다.
-- 실제로 프롬프트를 고친 뒤 효과를 재려고 7건을 다시 돌려야 했고, 그때
-- 비교 대상인 "이전 출력"은 이미 experiences 로 가공된 뒤라 원본이 없었다.
--
-- 여기에는 tool_use.input 을 가공 전 상태로 그대로 넣는다. 프롬프트 버전과
-- 모델을 함께 남겨야 "v3 에서 v4 로 바꿨더니 stuck 이 나오기 시작했다" 같은
-- 비교가 가능하다.
--
-- 검증 실패분도 valid=false 로 함께 남긴다 — ingest_failures 와 겹치지만
-- 그쪽은 운영 알림용(왜 세션이 안 처리됐나)이고 이쪽은 튜닝용(모델이 무엇을
-- 뱉었나)이라 목적이 다르다.
-- ============================================================

CREATE TABLE llm_outputs (
  id              BIGSERIAL   PRIMARY KEY,
  user_id         UUID        REFERENCES users(id) ON DELETE CASCADE,

  -- 'experience'  = 세션 1건 → 경험 (apps/web experience-engine)
  -- 'daily_log'   = 하루치 경험 → 일기 (apps/batch daily-logs)
  kind            TEXT        NOT NULL,

  -- kind 에 따라 하나만 채워진다. session_id 에 FK 를 걸지 않는 것은
  -- ingest_failures 와 같은 이유다 — 세션이 지워져도 판정 이력은 남아야
  -- 튜닝에 쓸 수 있다.
  session_id      UUID,
  log_date        DATE,

  model           TEXT        NOT NULL,
  prompt_version  SMALLINT    NOT NULL,

  -- tool_use.input 원본. tool_use 블록 자체가 없었으면 NULL.
  output          JSONB,
  -- 'end_turn' | 'max_tokens' | 'tool_use' ... — max_tokens 면 잘린 출력이다.
  stop_reason     TEXT,
  input_tokens    INT,
  output_tokens   INT,

  -- zod 검증 통과 여부. false 면 이 출력으로는 아무것도 만들어지지 않았다.
  valid           BOOLEAN     NOT NULL,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT llm_outputs_kind_check CHECK (kind IN ('experience', 'daily_log'))
);

-- "이 세션이 무엇을 뱉었나" — 재처리 전후 비교의 주 진입점.
CREATE INDEX idx_llm_outputs_session ON llm_outputs (session_id) WHERE session_id IS NOT NULL;
-- "최근 판정들이 어떻게 갈렸나" — 분포 확인·프롬프트 버전 비교용.
CREATE INDEX idx_llm_outputs_user_time ON llm_outputs (user_id, created_at DESC);

ALTER TABLE llm_outputs ENABLE ROW LEVEL SECURITY;
