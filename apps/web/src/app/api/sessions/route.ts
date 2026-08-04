// ============================================================
// POST /api/sessions
//
// 확장이 세션 종료 시 보내는 관측 단위를 받는다(계획서 04·05장).
// 클라이언트가 생성한 UUID 가 PK 라서 재전송에도 멱등하다 —
// onConflictDoNothing 으로 중복을 그냥 흡수한다.
// ============================================================

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ingestFailures, sessions } from '@na/db';
import { sessionPayloadSchema, type SessionPayload } from '@na/shared';
import { db } from '@/lib/db';
import { getUserByExtensionKey } from '@/lib/api-auth';

// postgres 패키지가 던지는 에러의 최소 형태. FK 위반은 code '23503'.
// drizzle-orm(postgres-js) 은 원본 PostgresError 를 그대로 던지지 않고
// DrizzleQueryError 로 한 번 감싸며, 원본은 err.cause 에 들어간다.
// 그래서 err.code 와 err.cause.code 를 둘 다 확인해야 한다.
type PgError = { code?: string; message?: string; cause?: unknown };

function isForeignKeyViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as PgError;
  if (e.code === '23503') return true;
  return isForeignKeyViolation(e.cause);
}

// body.id 가 uuid 꼴인지만 가볍게 확인한다 — ingest_failures.session_id 채우기용.
// (본 검증은 sessionPayloadSchema 가 담당한다)
function extractLikelySessionId(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const id = (body as Record<string, unknown>).id;
  return typeof id === 'string' && z.uuid().safeParse(id).success ? id : null;
}

function toSessionRow(userId: string, payload: SessionPayload) {
  return {
    id: payload.id,
    userId,
    startedAt: new Date(payload.started_at),
    endedAt: new Date(payload.ended_at),
    durationMin: payload.duration_min,
    closeReason: payload.close_reason,
    continuedFrom: payload.continued_from ?? null,
    primaryCategory: payload.primary_category,
    activityScore: payload.activity_score,
    uniqueDomains: payload.unique_domains,
    switchCount: payload.switch_count,
    tags: payload.tags,
    compressedLog: payload.compressed_log,
    domains: payload.domains,
  };
}

export async function POST(req: Request) {
  try {
    const user = await getUserByExtensionKey(req);
    if (!user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      rawBody = undefined;
    }

    const parsed = sessionPayloadSchema.safeParse(rawBody);

    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      const issuesSummary = issues.map((i) => `${i.path}: ${i.message}`).join('; ');

      await db.insert(ingestFailures).values({
        userId: user.id,
        sessionId: extractLikelySessionId(rawBody),
        reason: `validation_failed: ${issuesSummary}`,
        payload: rawBody ?? null,
      });

      return NextResponse.json({ error: 'validation_failed', issues }, { status: 400 });
    }

    const payload = parsed.data;

    try {
      const inserted = await db
        .insert(sessions)
        .values(toSessionRow(user.id, payload))
        .onConflictDoNothing({ target: sessions.id })
        .returning({ id: sessions.id });

      return NextResponse.json({ accepted: true, duplicate: inserted.length === 0 }, { status: 202 });
    } catch (err) {
      // continued_from 이 FK 다. maxlen 절단 시 이전 세션을 가리키는데
      // 그 이전 세션이 (아직) 존재하지 않으면 FK 위반이 난다.
      // continued_from 을 null 로 떨어뜨려 재시도하고, 원인은 ingest_failures 에 남긴다.
      if (isForeignKeyViolation(err) && payload.continued_from) {
        await db.insert(ingestFailures).values({
          userId: user.id,
          sessionId: payload.id,
          reason: 'orphan_continued_from',
          payload: rawBody ?? null,
        });

        const retried = await db
          .insert(sessions)
          .values({ ...toSessionRow(user.id, payload), continuedFrom: null })
          .onConflictDoNothing({ target: sessions.id })
          .returning({ id: sessions.id });

        return NextResponse.json(
          { accepted: true, duplicate: retried.length === 0 },
          { status: 202 },
        );
      }

      throw err;
    }
  } catch (err) {
    console.error('[POST /api/sessions] failed', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
