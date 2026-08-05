// ============================================================
// KST 날짜·시간 유틸 — 여러 페이지(홈·기억·스킬·성격)가 공통으로 쓴다.
//
// "하루"의 경계(새벽 4시) 규칙 자체는 여기 없다. @na/shared 의 kst.ts 가
// 정본이고 배치도 같은 것을 쓴다 — 두 벌로 두면 한쪽만 고쳐지는 날이 오고,
// 그 순간부터 "오늘"의 정의가 화면과 배치에서 갈린다.
// 이 파일은 그 위에 얹는 표기(포맷)와 대사 슬롯만 담당한다.
// ============================================================

import type { DialogueSlot } from '@na/db';
import { DAY_MS, kstDayStart, toKstWallClock } from '@na/shared';

export { DAY_MS, kstDaysTogether } from '@na/shared';

/** "오늘"의 시작 시각(KST 새벽 4시). 이름은 호출부 호환을 위해 유지한다. */
export const getKstDayBoundary = kstDayStart;

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

// KST 달력일(자정 기준) 경과 일수 — 스킬 NEW 배지 전용.
// 새벽 4시 경계가 아니라 자정 기준인 점에 유의한다. "며칠 전에 처음 썼나"는
// 하루의 논리적 경계보다 달력이 자연스럽다.
export function kstDaysSince(date: Date, now: Date = new Date()): number {
  const d = toKstWallClock(date);
  const n = toKstWallClock(now);
  const dateMidnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const nowMidnight = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
  return Math.round((nowMidnight - dateMidnight) / DAY_MS);
}
