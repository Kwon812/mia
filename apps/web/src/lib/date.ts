// ============================================================
// KST(UTC+9) 날짜·시간 유틸 — 여러 페이지(홈·기억·스킬·성격)가 공통으로 쓴다.
//
// "하루"의 경계는 자정이 아니라 새벽 4시다(계획서 04장 day 규칙).
// 로직은 apps/web/src/app/api/state/route.ts 의 getKstDayBoundary 와 동일하게
// 맞춘다 — 두 곳이 어긋나면 "오늘" 의 정의가 화면마다 달라진다.
// ============================================================

import type { DialogueSlot } from '@na/db';

export const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_BOUNDARY_HOUR = 4;

// UTC Date 를 "UTC 게터로 KST 벽시계 값을 읽을 수 있는" Date 로 옮긴다.
function toKstWallClock(date: Date): Date {
  return new Date(date.getTime() + KST_OFFSET_MS);
}

// "오늘"의 시작 시각(KST 새벽 4시)을 실제 UTC Date 로 반환한다.
export function getKstDayBoundary(now: Date = new Date()): Date {
  const kstWallClock = toKstWallClock(now);
  const kstHour = kstWallClock.getUTCHours();
  const dayOffset = kstHour < DAY_BOUNDARY_HOUR ? -1 : 0;

  const boundaryAsKstWallClock = Date.UTC(
    kstWallClock.getUTCFullYear(),
    kstWallClock.getUTCMonth(),
    kstWallClock.getUTCDate() + dayOffset,
    DAY_BOUNDARY_HOUR,
    0,
    0,
    0,
  );

  return new Date(boundaryAsKstWallClock - KST_OFFSET_MS);
}

// 현재 KST 시간대 slot — dialogues.slot 매칭용.
export function getCurrentDialogueSlot(now: Date = new Date()): DialogueSlot {
  const h = toKstWallClock(now).getUTCHours();
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 18) return 'afternoon';
  if (h >= 18 && h < 23) return 'evening';
  return 'night';
}

// 세션 시간 표기 — 서버 로케일과 무관하게 KST 24시간제로 고정.
export function formatKstTime(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Seoul',
  }).format(date);
}

export function formatKstTimeRange(startedAt: Date, endedAt: Date): string {
  return `${formatKstTime(startedAt)}–${formatKstTime(endedAt)}`;
}

// KST 기준 "YYYY-MM-DD" (구분자 지정 가능 — 기억/일기는 '.', 스킬은 '-')
export function formatKstYmd(date: Date, sep = '-'): string {
  const kst = toKstWallClock(date);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  return `${y}${sep}${m}${sep}${d}`;
}

// 기억 타임라인의 월 그룹 라벨 — "2026년 8월"
export function formatKstMonthLabel(date: Date): string {
  const kst = toKstWallClock(date);
  return `${kst.getUTCFullYear()}년 ${kst.getUTCMonth() + 1}월`;
}

// KST 달력일 기준 경과 일수(반올림 없이 자정 대 자정) — 스킬 NEW 배지 판정용.
/** 그 날짜가 속한 "하루"의 키(KST 새벽 4시 경계). 4시 이전은 전날에 속한다. */
function kstDayKey(date: Date): number {
  const shifted = new Date(toKstWallClock(date).getTime() - DAY_BOUNDARY_HOUR * 60 * 60 * 1000);
  return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
}

/** 함께한 날 수. **첫날이 1일째다** — 0일째는 없다.
 *
 *  경과 시간을 24 로 나누면 안 된다. 어젯밤 10시에 시작해 오늘 저녁이면
 *  이미 이틀째인데, 19시간이라 0 이 나온다. 밤 11시에 시작하면 한 시간 뒤
 *  자정에 이틀째가 되어야 하는데 24시간을 꽉 채워야 하루로 세어진다.
 *  "며칠째"는 흐른 시간이 아니라 넘어온 날 경계의 수를 묻는 말이다.
 *
 *  경계는 이 앱의 "오늘"과 같은 새벽 4시를 쓴다. 자정 기준인
 *  kstDaysSince 를 쓰면 새벽 2시에 하루가 넘어가 세션·일기와 어긋난다. */
export function kstDaysTogether(from: Date, now: Date = new Date()): number {
  return Math.round((kstDayKey(now) - kstDayKey(from)) / DAY_MS) + 1;
}

export function kstDaysSince(date: Date, now: Date = new Date()): number {
  const d = toKstWallClock(date);
  const n = toKstWallClock(now);
  const dateMidnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const nowMidnight = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
  return Math.round((nowMidnight - dateMidnight) / DAY_MS);
}
