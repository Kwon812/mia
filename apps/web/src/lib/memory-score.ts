// ============================================================
// Memory Engine 점수 계산 — 순수 함수, LLM 재호출 금지 (계획서 05장)
//
//   신규 스킬 등장(user_skills 에 없던 스킬 포함)         +50
//   is_first_time                                        +40
//   직전 experience 와 3일 이상 간격                       +30
//   duration_min 이 최근 세션 평균(해당 유저 최근 20개)의
//     2배 이상                                            +20
//   최근 experiences 3건과 category+주요 스킬이 모두 같음
//     (같은 패턴 반복)                                     -30
//
// 여기서 반환하는 값은 experiences.memory_score 에 그대로 들어간다.
// 임계값 판정(장기 기억으로 승격할지)과 memories 테이블 생성은
// thread 의 상태 변화를 입력으로 하는 후속 작업이다 — "기억의 입력은
// experience 가 아니라 thread의 상태 변화다"(계획서 05장). 이 파일은
// 그 판정에 쓰일 원시 점수만 계산한다.
// ============================================================

/** 최근 experience 3건 중 하나 — 패턴 반복 판정에 필요한 최소 정보만 담는다. */
export interface RecentExperienceSummary {
  category: string;
  /** weight 가 가장 큰 스킬의 이름. 스킬이 없었으면 null */
  primarySkillName: string | null;
}

export interface MemoryScoreInput {
  /** 이번 경험에 등장한 스킬 중 user_skills 에 없던 것이 하나라도 있으면 true */
  hasNewSkill: boolean;
  /** LLM 이 판정한 is_first_time */
  isFirstTime: boolean;
  /** 직전 experience(occurred_at 기준)와의 간격(일). 직전 경험이 없으면 null */
  daysSinceLastExperience: number | null;
  /** 이번 세션의 duration_min */
  durationMin: number;
  /** 해당 유저의 최근 세션(이번 세션 제외) 최대 20개의 duration_min */
  recentSessionDurations: number[];
  /** 이번 경험의 category */
  category: string;
  /** 이번 경험에서 weight 가 가장 큰 스킬의 이름. 스킬이 없으면 null */
  primarySkillName: string | null;
  /** occurred_at DESC 최근 experience 3건. 정확히 3건이 있을 때만 반복 판정을 한다 */
  recentExperiences: RecentExperienceSummary[];
}

function average(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((sum, n) => sum + n, 0) / nums.length;
}

// 최근 3건이 모두 존재하고, 그 3건 전부가 이번 경험과 category·주요 스킬이
// 같으면 "같은 패턴 반복"으로 본다. 3건 미만이면 판단 근거 부족으로 취급한다.
function isRepeatingPattern(input: MemoryScoreInput): boolean {
  if (input.recentExperiences.length !== 3) return false;
  return input.recentExperiences.every(
    (exp) => exp.category === input.category && exp.primarySkillName === input.primarySkillName,
  );
}

export function calculateMemoryScore(input: MemoryScoreInput): number {
  let score = 0;

  if (input.hasNewSkill) score += 50;
  if (input.isFirstTime) score += 40;

  if (input.daysSinceLastExperience !== null && input.daysSinceLastExperience >= 3) {
    score += 30;
  }

  const avgDuration = average(input.recentSessionDurations);
  if (avgDuration > 0 && input.durationMin >= avgDuration * 2) {
    score += 20;
  }

  if (isRepeatingPattern(input)) {
    score -= 30;
  }

  return score;
}
