-- ============================================================
-- 갈래 교정을 버린다. 20260808000001 을 되돌린다.
--
-- 왜 만들었었나 — 경험이 잘못된 갈래에 붙으면 그 갈래의 "최근:" 줄이 오염되고,
-- 다음 세션의 모델이 그 줄을 보고 또 붙는 연쇄가 실측됐다. 사람이 풀 수단을
-- 주려고 넣었다.
--
-- 왜 버리나 — **그 연쇄는 다른 것이 풀었다.** 재구축 4회차에서 모델이 교정
-- 없이 스스로 갈랐다:
--
--   08-05 23:54  주 → new "KT Cloud TECH UP 2기 팀 프로젝트"
--   08-06 01:01  주 → attach (그 갈래)
--   08-06 02:01  +  → attach KT Cloud TECH UP 2기
--   08-06 03:01  +  → attach KT Cloud TECH UP 2기
--   08-06 23:52  주 → attach KT Cloud TECH UP 2기
--
-- 실제로 푼 것은 진행 중 갈래 후보 목록을 넓힌 쪽이다(어휘 tsquery 검색 +
-- 상한 5→8). 그건 남긴다. 교정은 오히려 모델이 지은 갈래 이름을 덮어썼다.
--
-- 그리고 갈래 교정은 이 시스템에 **경험이 갈래를 떠나는** 상태를 새로 만들었다.
-- 엔진 경로에는 그런 일이 없어서, 다음 다섯 가지가 전부 미정의였다:
--   ① 원래 기억의 근거가 0건이 되면?
--   ② deepened(6건 쌓임)가 5건으로 줄면 취소되나?
--   ③ 원래 갈래가 비면 그 기억은 삭제인가?
--   ④ 옮긴 경험이 목적지에서 기억 조건을 못 넘으면 기억이 사라지는 게 맞나?
--   ⑤ memory_score 를 다시 재나, 저장값을 쓰나?
-- 모순의 원인이 기능 자체라, 규칙을 다섯 개 더 만드는 대신 기능을 버린다.
--
-- 사람이 갈래를 고칠 수단은 사라진다. 모델이 틀리면 재구축이 유일한 방법이다.
-- ============================================================

-- 쌓인 갈래 교정 행을 지운다. experiences.thread_id 는 이미 옮겨진 상태로
-- 두어도 된다 — 다음 재구축에서 모델 판정대로 다시 깔린다.
delete from corrections where field = 'thread';
delete from questions   where field = 'thread';

alter table corrections drop constraint if exists corrections_field_check;
alter table corrections add constraint corrections_field_check
  check (field in ('outcome', 'category', 'is_first_time'));

alter table questions drop constraint if exists questions_field_check;
alter table questions add constraint questions_field_check
  check (field in ('outcome', 'category', 'is_first_time'));
