// character-cache: 최신 personality_snapshots 와 누적 경험치를 바탕으로 레벨/캐릭터 표시용 캐시를 갱신한다.
// 클라이언트가 매 요청마다 재계산하지 않도록 미리 구운(pre-computed) 값을 저장해두는 용도.
// TODO: 레벨 산정 로직 + 캐릭터 표시 필드 계산 -> 캐시 테이블 upsert 구현.

import type { Db } from "@na/db";

export async function refreshCharacterCache(db: Db): Promise<void> {
  console.log("[character-cache] start");

  // TODO: 대상 사용자 목록 조회
  // TODO: 최신 personality_snapshots + 누적 경험치로 레벨 계산
  // TODO: 캐릭터 캐시 테이블 upsert

  console.log("[character-cache] done");
}
