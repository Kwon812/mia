// ============================================================
// GET /demo
//
// 구경하러 온 사람을 데모 계정으로 들여보낸다. 하는 일은 기기 키 쿠키를 심는
// 것뿐이고, 그 뒤로는 평소 코드가 평소 데이터를 읽는다 — 데모용 화면이 따로
// 있는 게 아니라 **그냥 다른 계정**이다(lib/demo.ts 주석).
//
// 키가 없거나 그 기기가 등록돼 있지 않으면 /connect 로 보낸다. 쿠키만 심고
// 홈으로 보내면 getCurrentUser 가 빈손이라 어차피 다시 튕기는데, 그때는
// 사람이 왜 튕겼는지 알 방법이 없다.
// ============================================================

import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { devices } from '@na/db';
import { db } from '@/lib/db';
import { NA_KEY_COOKIE, NA_KEY_MAX_AGE_SECONDS } from '@/lib/current-user';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const key = process.env.NA_DEMO_KEY;

  if (!key) {
    return NextResponse.redirect(new URL('/connect?demo=unset', url.origin));
  }

  try {
    const rows = await db
      .select({ userId: devices.userId })
      .from(devices)
      .where(eq(devices.extensionKey, key))
      .limit(1);

    if (!rows[0]) {
      return NextResponse.redirect(new URL('/connect?demo=missing', url.origin));
    }
  } catch (err) {
    console.error('[GET /demo] 조회 실패', err instanceof Error ? err.name : 'unknown');
    return NextResponse.redirect(new URL('/connect?demo=error', url.origin));
  }

  const res = NextResponse.redirect(new URL('/', url.origin));
  res.cookies.set(NA_KEY_COOKIE, key, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: NA_KEY_MAX_AGE_SECONDS,
    path: '/',
  });
  return res;
}
