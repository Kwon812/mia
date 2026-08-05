// ============================================================
// Memory Engine 점수 계산 — 순수 함수, LLM 재호출 금지 (계획서 05장)
//
//   신규 스킬 등장(user_skills 에 없던 스킬 포함)         +50
//   is_first_time                                        +40
//   막힘 → 성공 (직전이 stuck 인데 이번에 success)          +35
//   직전 experience 와 3일 이상 간격                       +30
//   30일 이상 안 쓰던 스킬이 다시 등장                      +25
//   duration_min 이 최근 세션 평균(해당 유저 최근 20개)의
//     2배 이상                                            +20
//   최근 experiences 3건과 category+주요 스킬이 모두 같음
//     (같은 패턴 반복)                                     -30
//
// "막힘 → 성공"과 "휴면 스킬 재등장"은 나중에 추가됐다. 원래 규칙 다섯 개로는
// 신규 스킬과 첫 시도가 겹치는 경우 말고는 임계값을 넘을 길이 사실상 없어서,
// 하루에 여섯 번을 겪어도 기억이 하나도 안 남는 일이 실제로 있었다.
// 둘 다 드물게 발동하면서 "기억할 만한 순간"이라는 뜻이 분명한 신호다.
//
// score 는 그대로 experiences.memory_score 에 들어간다.
// breakdown 은 어떤 규칙이 발동했는지 내역이다 — thread 완결과 별개로
// memory_score ≥ 80 일 때 그 신호가 "신규 스킬" 쪽인지 "3일 공백 복귀" 쪽인지
// 호출자(experience-engine)가 판단해서 memories.trigger('new_skill' | 'comeback')
// 를 고르는 데 쓴다. 임계값 판정과 memories 테이블 생성 자체는 thread 의 상태
// 변화를 입력으로 하는 후속 작업이다 — "기억의 입력은 experience 가 아니라
// thread의 상태 변화다"(계획서 05장). 이 파일은 원시 점수와 내역만 계산한다.
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
  /** 직전 경험이 stuck 이었는데 이번이 success 인가 — 막혔던 걸 뚫었다 */
  brokeThrough: boolean;
  /** 30일 이상 안 쓰던 스킬이 이번에 다시 등장했는가 */
  dormantSkillReturned: boolean;
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

/** 어떤 규칙이 발동했는지 내역. score 는 이 값들의 합(-30~+200)이다. */
export interface MemoryScoreBreakdown {
  /** +50 — 신규 스킬 등장 */
  hasNewSkill: boolean;
  /** +40 — 해당 스킬 첫 시도(is_first_time) */
  isFirstTime: boolean;
  /** +35 — 막혔던 것을 뚫었다 */
  brokeThrough: boolean;
  /** +25 — 오래 묵혀둔 스킬이 돌아왔다 */
  dormantSkillReturned: boolean;
  /** +30 — 3일 이상 공백 후 복귀 */
  comeback: boolean;
  /** +20 — 세션 길이가 평소(최근 20개 평균)의 2배 이상 */
  longSession: boolean;
  /** -30 — 최근 3건과 category+주요 스킬이 모두 같은 반복 패턴 */
  repeatingPattern: boolean;
}

export interface MemoryScoreResult {
  score: number;
  breakdown: MemoryScoreBreakdown;
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

export function calculateMemoryScore(input: MemoryScoreInput): MemoryScoreResult {
  const comeback = input.daysSinceLastExperience !== null && input.daysSinceLastExperience >= 3;

  const avgDuration = average(input.recentSessionDurations);
  const longSession = avgDuration > 0 && input.durationMin >= avgDuration * 2;

  const repeatingPattern = isRepeatingPattern(input);

  const breakdown: MemoryScoreBreakdown = {
    hasNewSkill: input.hasNewSkill,
    isFirstTime: input.isFirstTime,
    brokeThrough: input.brokeThrough,
    dormantSkillReturned: input.dormantSkillReturned,
    comeback,
    longSession,
    repeatingPattern,
  };

  let score = 0;
  if (breakdown.hasNewSkill) score += 50;
  if (breakdown.isFirstTime) score += 40;
  if (breakdown.brokeThrough) score += 35;
  if (breakdown.comeback) score += 30;
  if (breakdown.dormantSkillReturned) score += 25;
  if (breakdown.longSession) score += 20;
  if (breakdown.repeatingPattern) score -= 30;

  return { score, breakdown };
}
