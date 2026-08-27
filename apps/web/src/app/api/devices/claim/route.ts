// ============================================================
// POST /api/devices/claim
//
// 새로 깐 확장을 이미 있는 계정에 붙인다. **재설치 = 캐릭터 분실** 을 끝내는
// 마지막 조각이다.
//
// 지금까지는 이랬다. 확장을 다시 깔면 /api/register 가 새 키와 함께 익명
// 계정을 하나 만든다(Day 0 를 지키려면 그래야 한다 — 첫 설치와 구분할 방법이
// 없으니까). 구글을 이어뒀으면 사이트에서 옛 캐릭터를 **볼 수는** 있지만,
// 그 브라우저가 올리는 세션은 여전히 새 익명 계정으로 간다. 화면과 기록이
// 서로 다른 곳을 보는 상태다.
//
// 그 기기 행의 주인을 바꾸면 끝난다. 데이터는 움직이지 않는다.
//
// 네 갈래로 답한다.
//   이미 내 것        → ok        (같은 버튼을 두 번 눌러도 안전하다)
//   다른 계정에 묶임   → owned     (뺏을 수 없다)
//   익명 + 빈 계정     → ok        (기기를 옮기고 빈 계정을 지운다)
//   익명 + 기록 있음   → has_data  (합치기는 아직 없다. 아래 참고)
//
// 마지막 갈래를 거절로 두는 이유. 두 계정의 기록을 합치려면 user_id 를 참조하는
// 11개 표를 한 트랜잭션에서 옮겨야 하는데, 그중 여럿이 (user_id, ...) 유니크라
// 겹치면 어느 쪽을 버릴지 정하는 문제가 따로 생긴다. 조용히 반쯤 합치는 것보다
// 못 한다고 말하는 쪽이 낫다 — 사람이 그 사이에 뭘 잃었는지 알 수 있다.
// ============================================================

import { NextResponse } from 'next/server';
import { and, count, eq, isNull, notExists } from 'drizzle-orm';
import { characters, devices, sessions, users } from '@na/db';
import { db } from '@/lib/db';
import { getGoogleUser } from '@/lib/current-user';

type ClaimResult = 'ok' | 'owned' | 'has_data' | 'unknown_key';

/** api/connect 와 같은 방어. 이 라우트는 세션 쿠키로 인증하고 **바꾸는**
 *  조작을 하므로, 크로스사이트에서 온 폼 전송이면 그 자체로 CSRF 다.
 *  거기와 달리 Origin 없는 요청도 막는다 — 이걸 부르는 것은 우리 페이지의
 *  자바스크립트뿐이라 Origin 이 항상 붙는다. */
function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(req.url).host;
  } catch {
    return false;
  }
}

async function claim(targetUserId: string, extensionKey: string): Promise<ClaimResult> {
  const rows = await db
    .select({ ownerId: devices.userId, ownerAuthId: users.authId, ownerName: characters.name })
    .from(devices)
    .innerJoin(users, eq(users.id, devices.userId))
    .innerJoin(characters, eq(characters.userId, users.id))
    .where(eq(devices.extensionKey, extensionKey))
    .limit(1);

  const prev = rows[0];
  if (!prev) return 'unknown_key';
  if (prev.ownerId === targetUserId) return 'ok'; // 두 번 눌러도 안전하다
  if (prev.ownerAuthId !== null) return 'owned';

  // 익명이지만 비어 있나. 세션이 뿌리다 — 경험·스킬·기억이 전부 세션에서 나온다.
  // 이름을 지어준 것도 기록으로 친다. 숫자는 안 쌓였어도 사람이 들인 것이다.
  const [{ value: sessionCount }] = await db
    .select({ value: count() })
    .from(sessions)
    .where(eq(sessions.userId, prev.ownerId));
  if (sessionCount > 0 || prev.ownerName !== null) return 'has_data';

  await db.transaction(async (tx) => {
    // 기기를 옮긴다. 이 UPDATE 가 조작의 전부고, 나머지는 뒤처리다.
    //
    // isNull(users.authId) 를 다시 확인하는 이유: 위에서 읽은 뒤 커밋되기
    // 전까지 그 계정이 구글에 연결됐을 수 있다. 그 경우 0행이 바뀌고, 빈
    // 계정인 줄 알고 지우는 일이 없어야 한다.
    const moved = await tx
      .update(devices)
      .set({ userId: targetUserId })
      .where(eq(devices.extensionKey, extensionKey))
      .returning({ key: devices.extensionKey });
    if (!moved[0]) throw new Error('device disappeared');

    // 빈 익명 계정을 지운다. 안 지우면 기기 없는 유령 계정이 매 재설치마다
    // 하나씩 쌓인다. characters 는 ON DELETE CASCADE 로 따라 지워진다.
    //
    // **"세션이 없다" 를 여기서 다시, 삭제 조건 안에서 본다.** 위의 count 는
    // 사람에게 이유를 말해주기 위한 것이고, 그것만 믿고 지우면 count 와 delete
    // 사이에 도착한 세션이 cascade 로 함께 사라진다 — 방금 올라온 기록을
    // 지우는 셈이다. 확장은 세션 마감 때 올리므로 좁지만 실재하는 창이다.
    //
    // 조건에 걸려 0행이 지워지면 기기만 옮겨지고 계정은 남는다. 세션 하나가
    // 딸린 유령 계정이 남는 쪽이, 그 세션을 지우는 쪽보다 낫다.
    const removed = await tx
      .delete(users)
      .where(
        and(
          eq(users.id, prev.ownerId),
          isNull(users.authId),
          notExists(tx.select({ one: sessions.id }).from(sessions).where(eq(sessions.userId, prev.ownerId))),
        ),
      )
      .returning({ id: users.id });

    if (!removed[0]) {
      console.warn('[claim] 옮기는 사이에 기록이 생겨 빈 계정을 지우지 않았다', prev.ownerId);
    }
  });

  return 'ok';
}

export async function POST(req: Request) {
  try {
    if (!isSameOrigin(req)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    // **기기 쿠키가 아니라 구글 세션이다.** 기기를 옮기는 주체는 계정이어야
    // 한다 — 기기 쿠키로도 됐다면 남의 브라우저에 남은 쿠키 하나로 그 사람의
    // 기기를 자기 쪽으로 가져올 수 있다.
    const me = await getGoogleUser();
    if (!me) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
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

    if (typeof extensionKey !== 'string' || !/^na_[A-Za-z0-9_-]{16,}$/.test(extensionKey)) {
      return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
    }

    const result = await claim(me.userId, extensionKey);
    if (result !== 'ok') {
      return NextResponse.json({ error: result }, { status: 409 });
    }
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    // err 를 통째로 찍지 않는다 — drizzle 오류 메시지의 params 에 기기 키가 있다.
    console.error('[POST /api/devices/claim] failed', err instanceof Error ? err.name : 'unknown');
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
