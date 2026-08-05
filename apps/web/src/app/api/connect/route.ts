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

/** 이 요청이 우리 사이트에서 온 것인가.
 *
 *  이 라우트는 쿠키를 심는다 = 로그인이다. Origin 검사가 없으면 로그인 CSRF 가
 *  성립한다: 공격자가 text/plain 폼(프리플라이트 없음)으로 자기 키를 심는
 *  POST 를 피해자 브라우저에서 쏘면, SameSite=Lax 는 최상위 POST 응답의
 *  Set-Cookie 를 막지 않으므로 피해자 브라우저가 공격자 계정으로 묶인다.
 *  이후 피해자가 남기는 이름·활동이 공격자 계정에 쌓이고 공격자가 그걸 읽는다. */
function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  // 확장(chrome-extension://) 과 서버 간 호출에는 Origin 이 없을 수 있다.
  // 없는 경우는 브라우저가 만든 크로스사이트 폼 전송이 아니므로 통과시킨다.
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(req.url).host;
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  try {
    if (!isSameOrigin(req)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

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
    // err 를 통째로 찍으면 안 된다. drizzle 의 DrizzleQueryError 는 메시지에
    // "Failed query: ... params: [...]" 를 넣는데, 여기 params 에는 extension_key
    // 가 들어 있다 — 그 키가 곧 인증 자격증명 전체다(비밀번호 없음).
    console.error('[POST /api/connect] failed', err instanceof Error ? err.name : 'unknown');
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}

// 연결 해제 — 쿠키만 지운다. 서버 데이터는 그대로 남는다.
export async function DELETE() {
  const res = new NextResponse(null, { status: 204 });
  res.cookies.set(NA_KEY_COOKIE, '', { path: '/', maxAge: 0 });
  return res;
}
