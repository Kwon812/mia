// ============================================================
// POST /api/register
//
// 확장이 설치 직후 호출한다. 바디 없음 — 익명 extension_key 를
// 발급하고 users/characters/devices 행을 트랜잭션으로 함께 만든다.
// 회원가입 화면·비밀번호가 없는 게 v1 의 핵심 결정이다(계획서 08장).
// ============================================================

import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { characters, devices, users } from '@na/db';
import type { RegisterResponse } from '@na/shared';
import { db } from '@/lib/db';

// TODO: 레이트리밋 없음. v1 은 확장 설치 트리거로만 호출되므로 우선 생략.
// 악용(대량 가입)이 확인되면 IP 기반 리밋을 여기에 추가한다.

function generateExtensionKey(): string {
  return `na_${randomBytes(24).toString('base64url')}`;
}

export async function POST() {
  try {
    const extensionKey = generateExtensionKey();

    const user = await db.transaction(async (tx) => {
      // users.extension_key 는 이제 진실이 아니다. 읽는 쪽은 전부 devices 를
      // 보는데도 여기서 같이 채우는 것은, 컬럼이 아직 NOT NULL 이고 되돌릴
      // 곳으로 남겨뒀기 때문이다 — 이중 쓰기는 컬럼을 지울 때 같이 없어진다.
      const [insertedUser] = await tx
        .insert(users)
        .values({ extensionKey })
        .returning({ id: users.id });

      await tx.insert(characters).values({ userId: insertedUser.id });

      // 발급한 키가 사는 곳. 지금은 유저당 하나지만, 같은 유저에 두 번째
      // 기기가 붙는 순간부터 이 표가 유일한 진실이 된다.
      await tx.insert(devices).values({ extensionKey, userId: insertedUser.id });

      return insertedUser;
    });

    const body: RegisterResponse = { extension_key: extensionKey };

    return NextResponse.json(body, { status: 201 });
  } catch (err) {
    console.error('[POST /api/register] failed', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
