import 'server-only';

import { eq } from 'drizzle-orm';
import { users } from '@na/db';
import { db } from './db';

// 확장이 보내는 익명 식별 헤더.
export const EXTENSION_KEY_HEADER = 'x-extension-key';

// X-Extension-Key 헤더로 users 행을 찾는다.
// 헤더가 없거나 등록되지 않은 키면 null — 라우트에서 401 로 응답한다.
export async function getUserByExtensionKey(
  req: Request,
): Promise<{ id: string; createdAt: Date } | null> {
  const key = req.headers.get(EXTENSION_KEY_HEADER);
  if (!key) return null;

  const rows = await db
    .select({ id: users.id, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.extensionKey, key))
    .limit(1);

  return rows[0] ?? null;
}
