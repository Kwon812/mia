// ============================================================
// 감정 파생 — 계획서 06장.
//
// emotions 테이블은 없다. 조회 시점의 최근 경험(+스킬 재등장 정보)에서
// 매번 계산하는 순수 함수다. 저장하지 않으므로 "3주 전의 기쁨"이 남지 않고,
// 시간이 지나면 자연히 '평온'으로 감쇠한다.
//
// 우선순위(위에서부터 먼저 만족하는 규칙이 이긴다):
//   1. 최근 경험에 첫 시도(is_first_time) 포함        → 흥분
//   2. 가장 최근 3건이 연달아 stuck                   → 답답
//   3. 직전 경험과 3일 이상 공백 후 새 경험            → 반가움
//   4. 30일 이상 안 쓰던 스킬이 재등장                 → 그리움
//   해당 없음                                          → 평온
// 시간 감쇠: 가장 최근 경험이 48시간보다 이전이면 규칙과 무관하게 평온.
// ============================================================

import type { ExperienceOutcome } from '@na/db';

export type EmotionLabel = '흥분' | '답답' | '반가움' | '그리움' | '평온';

export type Emotion = {
  label: EmotionLabel;
  reason: string;
};

// 감정 계산에 필요한 경험 하나 — 최신순(occurredAt desc)으로 정렬해 전달한다.
export type EmotionExperienceInput = {
  occurredAt: Date;
  outcome: ExperienceOutcome | null;
  isFirstTime: boolean;
  skillNames: string[];
};

// "재등장" 판정용 — 스킬이 이번(가장 최근 경험) 재등장 직전에 마지막으로
// 쓰였던 시각. user_skills 캐시의 lastUsedAt 은 이미 이번 경험으로 갱신돼
// 있어(간격이 0이 되어) 못 쓴다 — 호출부가 experience_skills 이력에서
// "이번 경험보다 이전" 사용 시각만 따로 구해 넘겨야 한다.
export type EmotionSkillInput = {
  skillName: string;
  lastUsedAt: Date;
};

const STUCK_STREAK = 3;
const COMEBACK_GAP_DAYS = 3;
const SKILL_LONELY_GAP_DAYS = 30;
const EXCITEMENT_WINDOW_HOURS = 48;
const DECAY_HOURS = 48;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export function deriveEmotion(
  recentExperiences: EmotionExperienceInput[],
  skillsBeforeLatest: EmotionSkillInput[] = [],
  now: Date = new Date(),
): Emotion {
  if (recentExperiences.length === 0) {
    return { label: '평온', reason: '아직 경험이 없다' };
  }

  const latest = recentExperiences[0];
  const hoursSinceLatest = (now.getTime() - latest.occurredAt.getTime()) / HOUR_MS;
  if (hoursSinceLatest >= DECAY_HOURS) {
    return { label: '평온', reason: '마지막 경험이 48시간보다 이전이라 감정이 가라앉았다' };
  }

  // 1. 흥분 — 최근 경험 중 처음 해보는 것이 있었다
  //
  // 시간 창이 필요하다. 표본(최근 5건) 전체를 훑으면, 경험이 드문 사용자는
  // 몇 달 전의 첫 시도 하나로 감정이 영구히 '흥분'에 고정된다 — 3일 만에
  // 돌아온 오늘도 '반가움'이 아니라 '흥분'이다. is_first_time 을 관대하게
  // 판정하도록 프롬프트를 바꿨기 때문에 더 잘 걸린다.
  const excitementCutoff = now.getTime() - EXCITEMENT_WINDOW_HOURS * HOUR_MS;
  if (
    recentExperiences.some(
      (e) => e.isFirstTime && e.occurredAt.getTime() >= excitementCutoff,
    )
  ) {
    return { label: '흥분', reason: '최근 경험 중 처음 해보는 것이 있었다' };
  }

  // 2. 답답 — 가장 최근 경험 3건이 연달아 stuck
  if (
    recentExperiences.length >= STUCK_STREAK &&
    recentExperiences.slice(0, STUCK_STREAK).every((e) => e.outcome === 'stuck')
  ) {
    return { label: '답답', reason: '최근 세 경험이 연달아 막혔다' };
  }

  // 3. 반가움 — 직전 경험과 3일 이상 공백 후 복귀
  if (recentExperiences.length >= 2) {
    const gapDays = (latest.occurredAt.getTime() - recentExperiences[1].occurredAt.getTime()) / DAY_MS;
    if (gapDays >= COMEBACK_GAP_DAYS) {
      return { label: '반가움', reason: `${Math.floor(gapDays)}일 만에 돌아왔다` };
    }
  }

  // 4. 그리움 — 30일 이상 안 쓰던 스킬이 이번 경험에 재등장
  for (const skillName of latest.skillNames) {
    const prior = skillsBeforeLatest.find((s) => s.skillName === skillName);
    if (!prior) continue;
    const gapDays = (latest.occurredAt.getTime() - prior.lastUsedAt.getTime()) / DAY_MS;
    if (gapDays >= SKILL_LONELY_GAP_DAYS) {
      return { label: '그리움', reason: `${skillName}을(를) ${Math.floor(gapDays)}일 만에 다시 썼다` };
    }
  }

  return { label: '평온', reason: '특별한 변화 없이 평소와 같다' };
}
