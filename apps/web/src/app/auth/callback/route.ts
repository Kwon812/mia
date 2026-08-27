// ============================================================
// GET /auth/callback
//
// 구글에서 돌아오는 자리. 여기서 하는 일이 곧 **계정 이관**이다.
//
// 순서가 전부다. 만약 "구글 신원으로 users 를 찾고, 없으면 새로 만든다"를
// 먼저 하면 빈 계정이 생기고 키우던 캐릭터는 옛 키에만 남는다 — 08-08 사고와
// 똑같은 모양이 인증 레이어에서 재현된다. 그래서 규칙은 이 순서다.
//
//   auth_id 로 users 찾음      → 그 계정으로 들어간다 (재방문)
//   아니고 기기 쿠키가 유효    → 그 계정에 auth_id 를 박는다  ← 이관
//   둘 다 아님                 → **거절한다**
//
// 마지막 줄이 중요하다. 구글만으로는 새 계정을 만들지 않는다. 계정이 생기는
// 곳은 확장 설치(POST /api/register) 하나뿐이고 앞으로도 그렇다 — 계획서의
// Day 0 가 "설치 → 익명 키 → 바로 시작" 이라서, 구글은 이미 있는 캐릭터에
// 문을 하나 더 다는 일이지 가입이 아니다.
//
// 이렇게 두면 덤으로 빈 계정 찌꺼기가 원천적으로 안 생긴다.
// ============================================================

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { and, eq, isNull } from 'drizzle-orm';
import { devices, users } from '@na/db';
import { db } from '@/lib/db';
import { createServerSupabase } from '@/lib/supabase/server';
import { NA_KEY_COOKIE } from '@/lib/current-user';

/** 실패 이유는 그대로 사용자에게 보여줄 말이 된다(/connect 가 읽는다). */
type AttachResult = 'ok' | 'no_device' | 'already_linked';

async function attach(authId: string, deviceKey: string | undefined): Promise<AttachResult> {
  // 1. 이미 이 구글 신원에 묶인 계정이 있나 — 그냥 재방문이다.
  const linked = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.authId, authId))
    .limit(1);
  if (linked[0]) return 'ok';

  // 2. 이 브라우저가 들고 있는 기기 키의 주인에게 신원을 박는다. 여기가 이관이다.
  if (!deviceKey) return 'no_device';

  const owner = await db
    .select({ userId: devices.userId })
    .from(devices)
    .where(eq(devices.extensionKey, deviceKey))
    .limit(1);
  if (!owner[0]) return 'no_device';

  // isNull 조건이 이 UPDATE 의 핵심이다. 이미 다른 구글 신원이 박힌 계정을
  // 덮어쓰면 원래 주인이 자기 캐릭터에서 쫓겨난다 — 기기 키는 브라우저에
  // 남아 있을 수 있고(빌려준 노트북, 정리 안 한 옛 프로필), 그 키로 아무
  // 구글 계정이나 이 캐릭터를 가져갈 수 있게 된다.
  const updated = await db
    .update(users)
    .set({ authId, linkedAt: new Date() })
    .where(and(eq(users.id, owner[0].userId), isNull(users.authId)))
    .returning({ id: users.id });

  return updated[0] ? 'ok' : 'already_linked';
}

export async function GET(req: Request) {
  const url = new URL(req.url);

  // 구글이 거절한 경우(사용자가 취소 등) — 코드 없이 error 만 온다.
  if (url.searchParams.get('error')) {
    return NextResponse.redirect(new URL('/connect?auth=cancelled', url.origin));
  }

  const code = url.searchParams.get('code');
  if (!code) {
    return NextResponse.redirect(new URL('/connect?auth=failed', url.origin));
  }

  const supabase = await createServerSupabase();

  try {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error || !data.user) {
      return NextResponse.redirect(new URL('/connect?auth=failed', url.origin));
    }

    const cookieStore = await cookies();
    const result = await attach(data.user.id, cookieStore.get(NA_KEY_COOKIE)?.value);

    if (result !== 'ok') {
      // 붙일 곳이 없는 세션을 남겨두지 않는다. 남겨두면 "로그인은 됐는데
      // 계정이 없는" 상태가 되어 /connect 와 홈 사이를 오가게 된다.
      await supabase.auth.signOut();
      return NextResponse.redirect(new URL(`/connect?auth=${result}`, url.origin));
    }

    return NextResponse.redirect(new URL('/', url.origin));
  } catch (err) {
    // err 를 통째로 찍지 않는다 — drizzle 의 오류 메시지에는 바인딩 파라미터가
    // 들어 있고, 여기서 그건 기기 키다(api/connect 의 같은 주석 참고).
    console.error('[GET /auth/callback] failed', err instanceof Error ? err.name : 'unknown');
    return NextResponse.redirect(new URL('/connect?auth=failed', url.origin));
  }
}
