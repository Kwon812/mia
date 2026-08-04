// threads: 마지막 활동 시각 기준 30일간 무활동인 thread 를 abandoned 상태로 전이한다.
// 이미 abandoned/closed 등 종료 상태인 thread 는 대상에서 제외.
// TODO: 마지막 메시지/세션 시각 조회 -> 30일 초과 필터 -> status 업데이트 구현.

import type { Db } from "@na/db";

export async function markAbandonedThreads(db: Db): Promise<void> {
  console.log("[threads] start");

  // TODO: 30일 이상 무활동 thread 조회 (마지막 메시지/세션 시각 기준)
  // TODO: status = 'abandoned' 로 일괄 업데이트

  console.log("[threads] done");
}
