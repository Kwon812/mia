import 'server-only';

import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import { characters, users } from '@na/db';
import { db } from './db';

// 사이트가 사용자를 알아보는 다리 — 확장이 발급한 extension_key 를
// httpOnly 쿠키로 한 번 저장해두고, 서버 컴포넌트는 이 쿠키만으로
// users+characters 를 조회한다(OAuth 붙기 전까지의 임시 식별 방식).
export const NA_KEY_COOKIE = 'na_key';
export const NA_KEY_MAX_AGE_SECONDS = 60 * 60 * 24 * 400; // 400일

export type CurrentUser = {
  userId: string;
  createdAt: Date;
  character: {
    name: string | null;
    namedAt: Date | null;
    level: number;
    experienceCount: number;
    skillCount: number;
    activeDays: number;
    memoryCount: number;
    oldestMemoryAt: Date | null;
    lastComputedAt: Date | null;
  };
};

// cookies() 의 na_key → users+characters 조인 한 번으로 현재 사용자를 읽는다.
// 쿠키가 없거나 등록되지 않은 키면 null — 호출부가 /connect 로 redirect() 한다.
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const cookieStore = await cookies();
  const key = cookieStore.get(NA_KEY_COOKIE)?.value;
  if (!key) return null;

  const rows = await db
    .select({
      userId: users.id,
      createdAt: users.createdAt,
      name: characters.name,
      namedAt: characters.namedAt,
      level: characters.level,
      experienceCount: characters.experienceCount,
      skillCount: characters.skillCount,
      activeDays: characters.activeDays,
      memoryCount: characters.memoryCount,
      oldestMemoryAt: characters.oldestMemoryAt,
      lastComputedAt: characters.lastComputedAt,
    })
    .from(users)
    .innerJoin(characters, eq(characters.userId, users.id))
    .where(eq(users.extensionKey, key))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    userId: row.userId,
    createdAt: row.createdAt,
    character: {
      name: row.name,
      namedAt: row.namedAt,
      level: row.level,
      experienceCount: row.experienceCount,
      skillCount: row.skillCount,
      activeDays: row.activeDays,
      memoryCount: row.memoryCount,
      oldestMemoryAt: row.oldestMemoryAt,
      lastComputedAt: row.lastComputedAt,
    },
  };
}
