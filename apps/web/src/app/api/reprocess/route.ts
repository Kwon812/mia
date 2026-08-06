// ============================================================
// POST /api/reprocess — processed_at NULL 세션 재처리 스윕.
//
// Experience Engine 이 실패하면(LLM 출력 검증 실패 등) 세션은 processed_at
// NULL 로 남는다 (계획서 05·10장 — idx_sessions_unprocessed 가 이걸 위해 있다).
// 이 엔드포인트가 그 세션들을 다시 엔진에 태운다. 프롬프트/스키마를 고친 뒤
// 수동 호출하거나, 필요해지면 Vercel cron 으로 주기 실행을 걸 수 있다.
//
// 인증: 관리용이므로 확장 키가 아니라 service role 키를 X-Admin-Key 로 받는다.
// ============================================================

import { NextResponse } from 'next/server';
import { and, eq, isNull, notExists, sql } from 'drizzle-orm';
import { ingestFailures, sessions } from '@na/db';
import { db } from '@/lib/db';
import { processSession } from '@/lib/experience-engine';

/** 여기서는 세션을 순차로 태우므로 시간이 개수만큼 곱해진다. */
export const maxDuration = 60;

// 한 번에 처리할 개수. maxDuration 에서 거꾸로 계산한 값이다 —
// processSession 이 실측 8초쯤(LLM 6.5초 + 조회·트랜잭션)이라 60초에 6건이면
// 여유가 남는다.
//
// 예전에는 20 이었고 주석에 "함수 타임아웃 방어"라고 적혀 있었는데, 20 × 8초 =
// 160초라 어떤 기본값으로도 방어가 안 되는 숫자였다. 넘긴 뒤의 세션들은 응답에
// 성공으로 안 잡히고 그냥 안 돌았다.
//
// 남은 것은 다음 호출에서 처리된다 — processed_at 이 NULL 로 남아 다시 대상이 된다.
const SWEEP_LIMIT = 6;
// 이 횟수만큼 실패한 세션은 스윕 대상에서 뺀다. 사람이 프롬프트를 고친 뒤
// ingest_failures 를 지우면 다시 대상이 된다.
const MAX_ATTEMPTS = 3;

export async function POST(req: Request) {
  if (req.headers.get('x-admin-key') !== process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // 영구 실패한 세션을 제외한다. 예전에는 실패 횟수도 백오프도 없어서,
  // 프롬프트와 영영 맞지 않는 세션 20건이 고착되면 이후 몇 번을 호출해도
  // 매번 그 20건만 다시 뽑아 LLM 20회를 태우고 전부 실패했다 — 그 뒤에 쌓인
  // 세션은 한 번도 처리되지 않는데 응답의 swept:20 은 성공처럼 보였다.
  const failedTooOften = db
    .select({ n: sql<number>`1` })
    .from(ingestFailures)
    .where(eq(ingestFailures.sessionId, sessions.id))
    .groupBy(ingestFailures.sessionId)
    .having(sql`count(*) >= ${MAX_ATTEMPTS}`);

  const unprocessed = await db
    .select({ id: sessions.id, userId: sessions.userId })
    .from(sessions)
    .where(and(isNull(sessions.processedAt), notExists(failedTooOften)))
    .orderBy(sessions.receivedAt)
    .limit(SWEEP_LIMIT);

  const results: { session_id: string; ok: boolean }[] = [];
  for (const s of unprocessed) {
    // 순차 실행 — LLM 동시 호출 폭주 방지. processSession 은 내부에서 실패를
    // 삼키고 ingest_failures 에 기록하므로, 성공 여부는 processed_at 이 실제로
    // 채워졌는지로 판정한다.
    try {
      await processSession(s.id, s.userId);
    } catch (err) {
      console.error('[reprocess] failed', s.id, err);
    }
    const [row] = await db
      .select({ processedAt: sessions.processedAt })
      .from(sessions)
      .where(eq(sessions.id, s.id));
    results.push({ session_id: s.id, ok: row?.processedAt != null });
  }

  return NextResponse.json({ swept: unprocessed.length, results });
}
