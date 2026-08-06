// KST 새벽 4시 경계 "하루" — 정본은 @na/shared 의 kst.ts 다.
// 웹과 배치가 같은 규칙을 두 벌로 갖고 있으면 한쪽만 고쳐지는 날이 오고,
// 그때부터 일기에 안 들어간 세션이 화면에는 오늘 것으로 뜬다.
// 호출부 경로를 유지하려고 이 파일은 다시 내보내기만 한다.
export {
  DAY_MS,
  KST_OFFSET_MS,
  DAY_BOUNDARY_HOUR,
  toKstWallClock,
  kstHour,
  kstDayStart,
  kstDayKey,
  kstDayIndex,
  kstDaysTogether,
  yesterdayKstRange,
  yesterdayKstLogDate,
  diaryTargetKst,
  diaryRangeForLogDate,
} from '@na/shared';
