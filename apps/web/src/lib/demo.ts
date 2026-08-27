import 'server-only';

import { eq } from 'drizzle-orm';
import { devices } from '@na/db';
import { db } from './db';

// ============================================================
// 데모 계정 — 남의 캐릭터를 구경시켜 주기 위한 자리.
//
// 화면을 따로 만들지 않았다. 목데이터로 분기하는 길도 있었는데, 페이지가
// 여섯이고 저마다 자기 쿼리를 직접 해서(홈만 십수 개) 데이터 로딩을 두 벌로
// 들고 있게 된다. 그러면 데모 경로와 실제 경로가 갈라지고, 갈라진 순간부터
// 데모는 "실제로 되는 것"의 증거가 아니게 된다.
//
// 그래서 데모는 **그냥 다른 계정**이다. /demo 가 그 계정의 기기 키를 쿠키로
// 심고, 나머지는 전부 평소 코드가 평소 데이터를 읽는다.
//
// 대신 쓰기를 막는다. 구경하러 온 사람이 이름을 바꾸거나 절차를 승인하면
// 다음 사람이 보는 화면이 달라진다.
// ============================================================

/** 데모 계정에서 바꾸려 할 때 돌려줄 말. 캐릭터 말투를 따른다. */
export const DEMO_BLOCKED = '여긴 구경용이라 바꾸는 건 막아뒀어. 확장을 설치하면 네 캐릭터에서 다 해볼 수 있어.';

/** 해석된 데모 계정 id. 못 찾은 경우는 캐시하지 않는다 — 키만 먼저 넣고
 *  시드를 나중에 돌릴 수 있고, 그때 재시작 없이 붙어야 한다. */
let cachedDemoUserId: string | null = null;

/**
 * 데모 계정의 user id. `NA_DEMO_KEY`(데모 기기의 확장 키)로 찾는다.
 *
 * 환경변수로 두는 이유: 표에 열을 하나 더 다는 것보다 싸다. 마이그레이션이
 * 코드보다 먼저 가야 하는 제약이 또 생기는 것도 피하고 싶었다.
 * 안 넣어두면 그냥 데모가 없는 상태로 돈다(가드는 아무도 안 막는다).
 */
export async function getDemoUserId(): Promise<string | null> {
  const key = process.env.NA_DEMO_KEY;
  if (!key) return null;
  if (cachedDemoUserId) return cachedDemoUserId;

  try {
    const rows = await db
      .select({ userId: devices.userId })
      .from(devices)
      .where(eq(devices.extensionKey, key))
      .limit(1);

    const found = rows[0]?.userId ?? null;
    if (found) cachedDemoUserId = found;
    return found;
  } catch (err) {
    // 여기서 실패하면 가드가 열린다. 받아들이는 이유: 이 조회가 안 되는
    // 상황이면 바로 뒤의 실제 쓰기도 어차피 안 된다. 반대로 "모르면 막는다"로
    // 두면 DB 가 잠깐 흔들릴 때 **모든 사용자의** 쓰기가 막힌다.
    console.error('[demo] 데모 계정 조회 실패', err instanceof Error ? err.name : 'unknown');
    return null;
  }
}

/** 이 사용자가 데모 계정인가. 서버 액션마다 이걸 보고 바꾸는 조작을 거른다. */
export async function isDemoUser(userId: string): Promise<boolean> {
  const demoId = await getDemoUserId();
  return demoId !== null && demoId === userId;
}
