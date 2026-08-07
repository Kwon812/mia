-- 한 세션에서 경험이 여럿 나올 수 있게 한다.
--
-- 지금까지는 "한 세션 = 한 경험"이 스키마에 박혀 있었다(session_id UNIQUE).
-- 그런데 실측하면 한 세션에 서로 다른 작업이 섞인다 — 18세션 중 6건에서 대상이
-- 둘 이상이었고, 그중 셋은 Project NA 와 Army Sim 이 한 세션에 들어 있었다.
-- 셋 다 Project NA 갈래로 흡수돼, Army Sim 갈래는 경험 2건으로 과소 기록됐다.
-- 요약 한 문장이 두 프로젝트를 말하니 outcome 도 자동으로 partial 이 된다
-- ("아키텍처 설계를 마무리하고 Army Sim 게임 플레이를 테스트했다").
--
-- 세션 자체는 안 나눈다. 그건 관측이고, 확장은 대상을 판정할 수 없다 —
-- localhost 가 어느 프로젝트인지는 도메인이 아니라 **페이지 제목**에만 있다.
-- 게다가 도메인으로 끊으면 `저장소 → 배포 → 로컬 서버` 같은 **같은 일의 표면
-- 이동**까지 잘려서, success 판정의 유일한 근거인 "적용·확인" 흐름이 사라진다.
-- 나누는 것은 해석 층(LLM)의 일이다.

-- ── 멱등성을 먼저 갈아끼운다 ──
--
-- 이 UNIQUE 는 "세션당 하나"라는 규칙일 뿐 아니라 **중복 처리 방어**를 겸하고
-- 있었다. 동시에 두 번 처리되면 두 번째 INSERT 가 여기 막히고, 엔진은 그걸
-- 신호로 트랜잭션을 통째로 롤백한다. 그냥 풀면 그 방어가 사라져 경험이 두 벌
-- 생긴다.
--
-- 대신 sessions.processed_at 을 조건부로 선점한다(엔진이 트랜잭션 맨 앞에서
--   update sessions set processed_at = now() where id = ? and processed_at is null
-- 를 돌리고 0행이면 롤백). 잠금이 세션 한 행에 걸려 의도도 더 분명하다.
alter table experiences drop constraint if exists experiences_session_id_key;

-- UNIQUE 가 인덱스도 겸하고 있었다. 세션으로 경험을 찾는 경로(재처리·상세)가
-- 남아 있으므로 일반 인덱스로 대신한다.
create index if not exists idx_exp_session on experiences (session_id);

-- 세션 안에서 이 경험이 어느 구간들에서 나왔는지. 모델이 배정하고 코드가
-- 검증한다. 시간(occurred_at·duration_min)도 여기서 계산된다.
-- 빈 배열이면 "세션 전체"라는 뜻이다(나뉘지 않은 경험, 그리고 옛 경험 전부).
alter table experiences
  add column if not exists segment_ids integer[] not null default '{}';

-- 이 경험에 귀속된 시간(분). 세션 duration_min 을 구간 체류 시간 비율로 나눈 값.
-- 나뉘지 않았으면 세션 길이와 같다.
--
-- 왜 필요한가: 기억 점수의 '평소보다 긴 세션'(+20)이 duration_min 을 본다.
-- 197분 세션을 둘로 쪼개고 각자에게 197분을 주면 **둘 다** +20 을 받는다.
alter table experiences
  add column if not exists duration_min integer;

comment on column experiences.segment_ids is
  '이 경험이 나온 compressed_log.segments 인덱스. 빈 배열이면 세션 전체.';
comment on column experiences.duration_min is
  '이 경험에 귀속된 분. 세션을 나눴으면 그 몫만. NULL 이면 세션 길이를 쓴다.';
