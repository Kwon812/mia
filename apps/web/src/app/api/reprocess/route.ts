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
import { eq, isNull } from 'drizzle-orm';
import { sessions } from '@na/db';
import { db } from '@/lib/db';
import { processSession } from '@/lib/experience-engine';

const SWEEP_LIMIT = 20; // 한 번에 최대 20개 — 함수 타임아웃 방어

export async function POST(req: Request) {
  if (req.headers.get('x-admin-key') !== process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const unprocessed = await db
    .select({ id: sessions.id, userId: sessions.userId })
    .from(sessions)
    .where(isNull(sessions.processedAt))
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
