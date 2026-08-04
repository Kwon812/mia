// ============================================================
// POST /api/connect · DELETE /api/connect
//
// 확장 발급 키(na_...)를 사이트에 한 번 입력해 이 브라우저를 캐릭터와
// 연결한다. OAuth 가 붙기 전까지의 다리 — httpOnly 쿠키(na_key)에 키를
// 그대로 저장하고, 서버 컴포넌트는 이 쿠키로 users 를 조회한다.
// ============================================================

import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { users } from '@na/db';
import { db } from '@/lib/db';
import { NA_KEY_COOKIE, NA_KEY_MAX_AGE_SECONDS } from '@/lib/current-user';

export async function POST(req: Request) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      body = undefined;
    }

    const extensionKey =
      typeof body === 'object' && body !== null
        ? (body as Record<string, unknown>).extension_key
        : undefined;

    if (typeof extensionKey !== 'string' || extensionKey.length === 0) {
      return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
    }

    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.extensionKey, extensionKey))
      .limit(1);

    if (!rows[0]) {
      return NextResponse.json({ error: 'invalid_key' }, { status: 401 });
    }

    const res = new NextResponse(null, { status: 204 });
    res.cookies.set(NA_KEY_COOKIE, extensionKey, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: NA_KEY_MAX_AGE_SECONDS,
      path: '/',
    });
    return res;
  } catch (err) {
    console.error('[POST /api/connect] failed', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}

// 연결 해제 — 쿠키만 지운다. 서버 데이터는 그대로 남는다.
export async function DELETE() {
  const res = new NextResponse(null, { status: 204 });
  res.cookies.set(NA_KEY_COOKIE, '', { path: '/', maxAge: 0 });
  return res;
}
