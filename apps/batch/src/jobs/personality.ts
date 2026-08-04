// personality: 성격 축 5개는 sessions 데이터만으로 계산한다 (별도 설문/입력 없음).
// 최근 2주(14일) 이동평균으로 스무딩한 값을 personality_snapshots 테이블에 append 방식으로 적재한다.
// TODO: 축별 raw score 계산 -> 2주 이동평균 -> snapshot insert 로직 구현.

import type { Db } from "@na/db";

export async function recomputePersonality(db: Db): Promise<void> {
  console.log("[personality] start");

  // TODO: 대상 사용자 목록 조회
  // TODO: 최근 14일 sessions 기반 축별 raw score 계산
  // TODO: 기존 snapshot과 결합해 이동평균 산출
  // TODO: personality_snapshots 테이블에 append insert

  console.log("[personality] done");
}
