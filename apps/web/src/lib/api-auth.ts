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

  // 조회 실패를 그대로 던지면 상위 catch 가 err 를 통째로 로그에 찍는다.
  // drizzle 의 DrizzleQueryError 메시지에는 바인딩 파라미터가 들어 있고,
  // 여기서는 그게 인증 키 원문이다. 이름만 남기고 삼킨다(=401 로 떨어진다).
  try {
    const rows = await db
      .select({ id: users.id, createdAt: users.createdAt })
      .from(users)
      .where(eq(users.extensionKey, key))
      .limit(1);
    return rows[0] ?? null;
  } catch (err) {
    console.error('[api-auth] 키 조회 실패', err instanceof Error ? err.name : 'unknown');
    return null;
  }
}
