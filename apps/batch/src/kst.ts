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

/**
 * 일기 대상 하루의 [start, end) 구간과 log_date 라벨.
 *
 * 배치는 KST 새벽 3시 — 새벽 4시 경계 "이전" — 에 돈다. 이 시각의 "어제"
 * (yesterdayKstRange)는 이미 그저께가 되어 버려서, 어젯밤에 쌓인 경험들이
 * 일기를 영영 못 받는 off-by-one 이 났다 (실측: 8/5 03:00 실행이 8/3 을 겨냥).
 * 일기의 대상은 "지금 끝나가는(또는 방금 끝난) 논리적 하루"다:
 *   - KST 0~3시대 실행(정규 크론): 아직 진행 중인 현재 하루 (1시간 뒤 마감)
 *   - KST 4시 이후 실행(수동 트리거 등): 가장 최근에 완전히 끝난 하루
 *
 * 알려진 한계: 정규 실행(3시) 후 3~4시 사이에 닫힌 세션은 일기에 못 들어간다 —
 * 계획서가 자정 대신 3시를 택하며 수용한 트레이드오프.
 */
export function diaryTargetKst(now: Date = new Date()): { start: Date; end: Date; logDate: string } {
  const currentStart = currentPeriodStart(now);
  // KST 0~3시대면 지금이 곧 그 하루의 끝자락 — 현재 구간이 대상.
  // 4시 이후면 현재 구간은 "오늘"이므로 한 구간 전(방금 끝난 하루)이 대상.
  const targetStart =
    kstHour(now) < DAY_BOUNDARY_HOUR ? currentStart : new Date(currentStart.getTime() - DAY_MS);
  const end = new Date(targetStart.getTime() + DAY_MS);
  return { start: targetStart, end, logDate: kstDayKey(targetStart) };
}
