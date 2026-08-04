// threads: 마지막 활동 시각 기준 30일간 무활동인 active thread 를 abandoned 상태로 전이한다.
// 기억을 만들지 않는다 — abandoned 는 성격 축(완결형↔탐색형)의 입력일 뿐이다(계획서 03/06장).
// 대상은 전체 유저의 active thread 중 정지 기준을 넘긴 것 — 이 잡은 특정 유저군으로
// 좁힐 이유가 없는 "잡별 자연 대상"이다.

import { and, eq, lt } from 'drizzle-orm';
import { threads, type Db } from '@na/db';

const ABANDON_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export async function markAbandonedThreads(db: Db): Promise<void> {
  console.log('[threads] start');

  const cutoff = new Date(Date.now() - ABANDON_AFTER_MS);

  const abandoned = await db
    .update(threads)
    .set({ status: 'abandoned' })
    .where(and(eq(threads.status, 'active'), lt(threads.lastActivityAt, cutoff)))
    .returning({ id: threads.id });

  console.log(`[threads] abandoned ${abandoned.length} thread(s) (cutoff=${cutoff.toISOString()})`);
  console.log('[threads] done');
}
