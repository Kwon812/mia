-- 스킬의 domain 을 경험 단위로 남긴다.
--
-- 지금까지 domain 은 user_skills 에만 있었고, 값은 코드가 **세션 category 하나를**
-- 그 세션에서 나온 스킬 전부에 똑같이 찍어 만들었다. 그래서 dev 세션에서 쓴
-- Figma 와 Notion 이 programming 으로 저장됐다. 게다가 upsert 의 SET 절에
-- domain 이 없어서 그 스킬이 처음 등장한 세션의 값이 영구히 고정됐다.
--
-- 이제 LLM 이 스킬마다 직접 고르고, 그 판단을 경험에 붙여 둔다.
-- experiences 가 불변이라 이 값도 근거로 남고, user_skills.domain 은 여기서
-- 최빈값으로 다시 계산된다 — 세션 처리 순서가 바뀌어도 같은 값이 나온다.
--
-- NULL 을 허용한다. 모델이 빠뜨린 경우와 이 마이그레이션 이전 데이터가 여기
-- 해당하고, 최빈값 계산에서 그냥 빠진다(전부 NULL 이면 user_skills 는 기존 값을 지킨다).
alter table experience_skills
  add column if not exists domain text;

comment on column experience_skills.domain is
  'programming | art | life — 그 경험에서 LLM 이 판단한 스킬의 갈래. NULL 은 미판단.';

-- user_skills.domain 을 이 열의 최빈값으로 계산할 때 쓴다.
create index if not exists idx_expskill_domain
  on experience_skills (skill_name, domain);
