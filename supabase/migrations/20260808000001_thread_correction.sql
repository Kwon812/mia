-- ============================================================
-- 교정 가능한 필드에 thread 를 추가한다.
--
-- 왜 필요한가 — 실측된 연쇄 오염:
--   08-04 23:58  "Army Sim 확인 후 ZEP kt cloud 세션"  → Project NA 갈래에 잘못 붙음
--   08-05 02:11  "Project NA … ZEP 메타버스 세션을 오가며"  ← 그 갈래의 "최근:" 줄이 오염됨
--   08-05 23:54  "KT Cloud TECH UP 2기 행사 참여"        ← 목록이 ZEP 을 말하니 붙음
--   08-06 01:01  "KT Cloud TECH UP 2기 행사 중 Figma…"    ← 굳어짐
-- 한 번 잘못 붙으면 그 갈래의 "최근:" 줄이 다음 판정을 끌어당긴다. 프롬프트에
-- "분야가 같다는 건 attach 의 근거가 아니다"가 있어도, 최근 줄이 실제로 그
-- 주제를 말하고 있으면 규칙이 걸릴 자리가 없다.
--
-- 8/6 이전 세션은 로그에 sec(체류시간)이 없어 — 57분 세션의 측정 총합이 5분 —
-- 경험 분할이 구조적으로 불가능했고, 그래서 교정될 기회 없이 연쇄가 이어졌다.
--
-- **thread 만 다른 점**: 나머지 세 필드는 라벨이라 읽을 때 겹치면 되지만,
-- 갈래는 관계(FK)다. 후보 목록·"최근:" 줄·경험 개수가 전부 thread_id 조인에서
-- 나오므로 겹쳐 읽기로만 처리하면 조인 지점 하나만 빠뜨려도 교정이 아무 데도
-- 안 쓰이는 라벨 더미가 된다. 그래서 experiences.thread_id 를 실제로 옮긴다.
-- (모델 출력, 사람 정답) 쌍은 corrections 행에 그대로 남으므로 append-only 의
-- **이유**는 지켜진다 — model_value 에 옮기기 전 갈래 제목을 박제한다.
--
-- human_value 는 갈래 **제목**이다. id 가 아닌 이유: 재구축(rebuild.mts)이
-- threads 를 통째로 다시 만들어 uuid 가 매번 새로 발급된다. 제목으로 두면
-- 재구축 때 그 제목의 갈래를 찾고, 없으면 만들어서 다시 잇는다 —
-- 사람이 "이건 KT Cloud 갈래다"라고 말한 것은 그 갈래가 있어야 한다는
-- 선언이기도 하다.
-- ============================================================

alter table corrections drop constraint if exists corrections_field_check;
alter table corrections add constraint corrections_field_check
  check (field in ('outcome', 'category', 'is_first_time', 'thread'));

-- questions 도 같은 열거를 쓴다. 캐릭터가 갈래를 묻는 경로는 아직 없지만,
-- 두 제약이 갈리면 나중에 질문 경로를 열 때 조용히 막힌다.
alter table questions drop constraint if exists questions_field_check;
alter table questions add constraint questions_field_check
  check (field in ('outcome', 'category', 'is_first_time', 'thread'));
