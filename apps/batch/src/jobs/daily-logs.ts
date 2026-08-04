// daily-logs: 전날(KST 기준) 종료된 sessions 를 요약해 일기(diary log) 레코드를 생성한다.
// 이미 생성된 날짜는 스킵(idempotent)하도록 unique key(user_id, date) 기준으로 upsert 예정.
// TODO: 세션 -> LLM 요약 -> daily_logs 테이블 insert 로직 구현.

import type { Db } from "@na/db";

export async function generateDailyLogs(db: Db): Promise<void> {
  console.log("[daily-logs] start");

  // TODO: 대상 사용자 목록 조회 (전날 세션이 있는 사용자)
  // TODO: 사용자별 세션 로그 수집
  // TODO: LLM(ANTHROPIC_API_KEY) 호출로 일기 초안 생성
  // TODO: daily_logs 테이블에 insert/upsert

  console.log("[daily-logs] done");
}
