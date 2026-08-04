// ============================================================
// KST(UTC+9) 새벽 4시 경계 "하루" 유틸 — 배치 잡 공용.
//
// daily_logs.log_date, threads 무활동 판정, character-cache 의 active_days,
// personality 의 night_morning 축이 전부 "하루"를 어떻게 자르느냐에 의존한다.
// 자정이 아니라 새벽 4시를 경계로 삼는다 — 새벽 0~3시대 활동은 "어제 밤"의
// 연장으로 취급한다(계획서 05장 "야간 · 새벽 3시" 배치 실행 시각과도 맞물린다).
// ============================================================

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_BOUNDARY_HOUR = 4;

/**
 * 주어진 시각(UTC Date)이 속하는 "KST 새벽 4시 경계 하루"의 라벨(YYYY-MM-DD).
 * 라벨은 그 하루가 "시작하는" KST 달력 날짜다 — 즉 KST 04:00~다음날 03:59:59 구간이
 * 전부 이 하루에 속한다. KST 00:00~03:59 는 전날 라벨로 떨어진다.
 */
export function kstDayKey(date: Date): string {
  const kstMs = date.getTime() + KST_OFFSET_MS;
  const shifted = new Date(kstMs - DAY_BOUNDARY_HOUR * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

/** 주어진 시각(UTC Date)의 KST 로컬 시(0~23). 새벽4시 경계와 무관한 순수 시각. */
export function kstHour(date: Date): number {
  return new Date(date.getTime() + KST_OFFSET_MS).getUTCHours();
}

// `now` 가 속한 "현재 하루" 구간의 시작 시각(UTC Date, 새벽4시 경계).
function currentPeriodStart(now: Date): Date {
  const kstNow = new Date(now.getTime() + KST_OFFSET_MS);
  const todayBoundaryKstEpoch = Date.UTC(
    kstNow.getUTCFullYear(),
    kstNow.getUTCMonth(),
    kstNow.getUTCDate(),
    DAY_BOUNDARY_HOUR,
    0,
    0,
    0,
  );
  const todayBoundaryUtcMs = todayBoundaryKstEpoch - KST_OFFSET_MS;
  return now.getTime() >= todayBoundaryUtcMs ? new Date(todayBoundaryUtcMs) : new Date(todayBoundaryUtcMs - DAY_MS);
}

/**
 * "어제"(KST 새벽4시 경계 하루)의 [start, end) UTC 구간.
 * 배치가 새벽 3시(경계 이전)에 도는 것을 감안해, `now` 가 속한 하루의
 * 바로 이전(=가장 최근에 완전히 끝난) 하루를 돌려준다.
 */
export function yesterdayKstRange(now: Date = new Date()): { start: Date; end: Date } {
  const end = currentPeriodStart(now);
  const start = new Date(end.getTime() - DAY_MS);
  return { start, end };
}

/** yesterdayKstRange(now) 구간의 kstDayKey 라벨. daily_logs.log_date 값으로 그대로 쓴다. */
export function yesterdayKstLogDate(now: Date = new Date()): string {
  const { start } = yesterdayKstRange(now);
  return kstDayKey(start);
}
