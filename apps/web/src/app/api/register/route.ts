// ============================================================
// POST /api/register
//
// 확장이 설치 직후 호출한다. 바디 없음 — 익명 extension_key 를
// 발급하고 users/characters 행을 트랜잭션으로 함께 만든다.
// 회원가입 화면·비밀번호가 없는 게 v1 의 핵심 결정이다(계획서 08장).
// ============================================================

import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { characters, users } from '@na/db';
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
      const [insertedUser] = await tx
        .insert(users)
        .values({ extensionKey })
        .returning({ id: users.id });

      await tx.insert(characters).values({ userId: insertedUser.id });

      return insertedUser;
    });

    const body: RegisterResponse = { extension_key: extensionKey };

    return NextResponse.json(body, { status: 201 });
  } catch (err) {
    console.error('[POST /api/register] failed', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
