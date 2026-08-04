// ============================================================
// 캐릭터 레벨 공식 — 계획서 06장
//   레벨 = min(1 + floor(sqrt(경험 수 * 고유 스킬 수)), floor(가입 후 일수 / 3) + 1)
//
// Experience Engine(세션 종료 시 즉시 반영)과 야간 배치(character-cache 재계산)
// 둘 다 이 함수 하나를 import 해서 쓴다 — 공식을 두 곳에 복붙하면 어느 한쪽만
// 고쳤을 때 실시간 레벨과 배치 후 레벨이 어긋난다.
//
// 상수·계수는 튜닝 대상이다("초반은 가파르게, 뒤로 갈수록 완만하게" — Lv.5 를
// 사흘 안에 도달시키는 것이 목표). 바꿀 때는 이 파일 하나만 고치면 된다.
// ============================================================

export interface CalculateLevelInput {
  /** 누적 experience 행 수 */
  experienceCount: number;
  /** 고유 스킬(user_skills) 개수 */
  skillCount: number;
  /** 가입(users.created_at) 후 경과 일수 */
  daysSinceCreated: number;
}

const LEVEL_BASE = 1;
const LEVEL_SIGNUP_DIVISOR_DAYS = 3;

export function calculateLevel(input: CalculateLevelInput): number {
  const byActivity = LEVEL_BASE + Math.floor(Math.sqrt(input.experienceCount * input.skillCount));
  const bySignupAge = Math.floor(input.daysSinceCreated / LEVEL_SIGNUP_DIVISOR_DAYS) + 1;
  return Math.min(byActivity, bySignupAge);
}
