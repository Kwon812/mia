// ============================================================
// KST(UTC+9) "새벽 4시 경계 하루" — 이 규칙의 유일한 정본.
//
// 자정이 아니라 새벽 4시를 경계로 삼는다(계획서 04장). 새벽 0~3시대 활동은
// "어제 밤"의 연장이다. 이 정의에 daily_logs.log_date, threads 무활동 판정,
// character-cache 의 active_days, personality 의 night_morning 축, 그리고
// 웹의 "오늘 세션/관측 시간"이 전부 매달려 있다.
//
// 예전에는 같은 규칙이 apps/web/src/lib/date.ts 와 apps/batch/src/kst.ts 에
// 따로 구현돼 있었다. 규칙 자체가 같아 보여도 두 벌이면 한쪽만 고쳐지는 날이
// 오고, 그러면 "오늘"의 정의가 화면과 배치에서 갈린다 — 그 순간부터 일기에
// 안 들어간 세션이 화면에는 오늘 것으로 뜬다. 그래서 여기로 모았다.
// 두 앱은 이 파일만 다시 내보낸다.
// ============================================================

export const DAY_MS = 24 * 60 * 60 * 1000;
export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
export const DAY_BOUNDARY_HOUR = 4;

/** UTC Date 를 "UTC 게터로 KST 벽시계 값을 읽을 수 있는" Date 로 옮긴다. */
export function toKstWallClock(date: Date): Date {
  return new Date(date.getTime() + KST_OFFSET_MS);
}

/** KST 로컬 시(0~23). 새벽 4시 경계와 무관한 순수 시각. */
export function kstHour(date: Date): number {
  return toKstWallClock(date).getUTCHours();
}

/**
 * 그 시각이 속한 "하루"의 시작(KST 새벽 4시)을 실제 UTC Date 로.
 * KST 04:00~다음날 03:59:59 가 한 하루다.
 */
export function kstDayStart(now: Date = new Date()): Date {
  const kst = toKstWallClock(now);
  const dayOffset = kst.getUTCHours() < DAY_BOUNDARY_HOUR ? -1 : 0;
  const boundaryAsKstWallClock = Date.UTC(
    kst.getUTCFullYear(),
    kst.getUTCMonth(),
    kst.getUTCDate() + dayOffset,
    DAY_BOUNDARY_HOUR,
    0,
    0,
    0,
  );
  return new Date(boundaryAsKstWallClock - KST_OFFSET_MS);
}

/**
 * 그 시각이 속한 하루의 라벨("YYYY-MM-DD"). 라벨은 그 하루가 **시작하는**
 * KST 달력 날짜다 — KST 00:00~03:59 는 전날 라벨로 떨어진다.
 * daily_logs.log_date 값으로 그대로 쓴다.
 */
export function kstDayKey(date: Date): string {
  const shifted = new Date(toKstWallClock(date).getTime() - DAY_BOUNDARY_HOUR * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

/** 같은 하루 라벨을 뺄셈할 수 있는 숫자(에폭 ms)로. 날짜 산술 전용. */
export function kstDayIndex(date: Date): number {
  const shifted = new Date(toKstWallClock(date).getTime() - DAY_BOUNDARY_HOUR * 60 * 60 * 1000);
  return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
}

/**
 * 함께한 날 수. **첫날이 1일째다** — 0일째는 없다.
 *
 * 경과 시간을 24 로 나누면 안 된다. 어젯밤 10시에 시작해 오늘 저녁이면 이미
 * 이틀째인데 19시간이라 0 이 나온다. 밤 11시에 시작한 사람은 자정이 지나도,
 * 다음날 밤 10시가 되어도 계속 0일째다 — 24시간을 꽉 채워야 하루로 세어지니까.
 * "며칠째"는 흐른 시간이 아니라 넘어온 날 경계의 수를 묻는 말이다.
 */
export function kstDaysTogether(from: Date, now: Date = new Date()): number {
  return Math.round((kstDayIndex(now) - kstDayIndex(from)) / DAY_MS) + 1;
}

/**
 * "어제"(가장 최근에 완전히 끝난 하루)의 [start, end) UTC 구간.
 * 배치가 새벽 3시(경계 이전)에 도는 것을 감안한다.
 */
export function yesterdayKstRange(now: Date = new Date()): { start: Date; end: Date } {
  const end = kstDayStart(now);
  const start = new Date(end.getTime() - DAY_MS);
  return { start, end };
}

/** yesterdayKstRange(now) 구간의 라벨. */
export function yesterdayKstLogDate(now: Date = new Date()): string {
  return kstDayKey(yesterdayKstRange(now).start);
}

/**
 * 일기 대상 하루의 [start, end) 구간과 log_date 라벨.
 *
 * 배치는 KST 새벽 3시 — 새벽 4시 경계 "이전" — 에 돈다. 이 시각의 "어제"
 * (yesterdayKstRange)는 이미 그저께가 되어 버려서, 어젯밤에 쌓인 경험들이
 * 일기를 영영 못 받는 off-by-one 이 났다(실측: 8/5 03:00 실행이 8/3 을 겨냥).
 * 일기의 대상은 "지금 끝나가는(또는 방금 끝난) 논리적 하루"다:
 *   - KST 0~3시대 실행(정규 크론): 아직 진행 중인 현재 하루 (1시간 뒤 마감)
 *   - KST 4시 이후 실행(수동 트리거 등): 가장 최근에 완전히 끝난 하루
 *
 * 알려진 한계: 정규 실행(3시) 후 3~4시 사이에 닫힌 세션은 일기에 못 들어간다 —
 * 계획서가 자정 대신 3시를 택하며 수용한 트레이드오프.
 */
export function diaryTargetKst(now: Date = new Date()): { start: Date; end: Date; logDate: string } {
  const currentStart = kstDayStart(now);
  const targetStart =
    kstHour(now) < DAY_BOUNDARY_HOUR ? currentStart : new Date(currentStart.getTime() - DAY_MS);
  const end = new Date(targetStart.getTime() + DAY_MS);
  return { start: targetStart, end, logDate: kstDayKey(targetStart) };
}

/**
 * 특정 log_date("YYYY-MM-DD")의 하루 구간을 만든다 — 과거 일기 재생성용.
 *
 * daily-logs 잡은 diaryTargetKst() 로 "방금 끝난 하루"만 겨냥한다. 그런데
 * 경험이 뒤늦게 생기는 경우가 있다(엔진이 실패했다가 재처리로 복구되는 등).
 * 그러면 그 경험은 이미 쓰인 일기의 근거에서 빠진 채로 남고, /diary 화면에도
 * 안 떠서 판정을 고칠 수조차 없다 — 실제로 2026-08-05 에 그런 일이 있었다.
 *
 * daily_logs 는 PK 가 (user_id, log_date) 라 같은 날짜를 다시 돌리면 덮어쓴다.
 * experiences 가 불변이라 언제든 다시 만들 수 있다는 설계(계획서 05장)를
 * 실제로 부를 수 있게 하는 함수다.
 */
export function diaryRangeForLogDate(logDate: string): { start: Date; end: Date; logDate: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(logDate)) {
    throw new Error(`log_date 형식이 아니다: ${logDate}`);
  }
  const [y, m, d] = logDate.split('-').map(Number);
  // 라벨은 그 하루가 **시작하는** KST 달력 날짜다(kstDayKey 참고).
  // 즉 시작은 그 날짜의 KST 04:00.
  const start = new Date(Date.UTC(y, m - 1, d, DAY_BOUNDARY_HOUR) - KST_OFFSET_MS);
  return { start, end: new Date(start.getTime() + DAY_MS), logDate };
}
