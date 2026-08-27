import 'server-only';

import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import { characters, devices, users } from '@na/db';
import { db } from './db';
import { createServerSupabase } from './supabase/server';

// 사이트가 사용자를 알아보는 다리. 문이 둘이다.
//
//   구글 세션   — 계정에 직접 닿는다. 어느 기기에서 열든 같은 캐릭터다.
//   기기 쿠키   — 확장이 발급한 키. 이 브라우저가 곧 신원이다.
//
// **구글이 먼저다.** 둘 다 있고 서로 다른 계정을 가리킬 수 있기 때문이다 —
// 빌려 쓴 브라우저에 남은 옛 기기 키, 정리 안 한 프로필 같은 것들. 그때
// 사람이 방금 명시적으로 한 행동(로그인)이 브라우저에 눌러붙어 있던 것보다
// 우선해야 한다.
export const NA_KEY_COOKIE = 'na_key';
export const NA_KEY_MAX_AGE_SECONDS = 60 * 60 * 24 * 400; // 400일

export type CurrentUser = {
  userId: string;
  createdAt: Date;
  /** 구글 신원이 붙어 있나. 붙어 있으면 이 브라우저를 잃어도 되찾을 수 있다. */
  linked: boolean;
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

// 두 조회가 같은 열을 읽는다. 한쪽만 고치면 화면이 문에 따라 달라진다.
const SELECTION = {
  userId: users.id,
  createdAt: users.createdAt,
  authId: users.authId,
  name: characters.name,
  namedAt: characters.namedAt,
  level: characters.level,
  experienceCount: characters.experienceCount,
  skillCount: characters.skillCount,
  activeDays: characters.activeDays,
  memoryCount: characters.memoryCount,
  oldestMemoryAt: characters.oldestMemoryAt,
  lastComputedAt: characters.lastComputedAt,
} as const;

type Row = {
  userId: string;
  createdAt: Date;
  authId: string | null;
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

function toCurrentUser(row: Row): CurrentUser {
  return {
    userId: row.userId,
    createdAt: row.createdAt,
    linked: row.authId !== null,
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

/**
 * 구글 세션의 주인. **기기 쿠키는 보지 않는다.**
 *
 * export 된 이유가 여기 있다. 기기를 계정 사이에서 옮기는 조작(devices/claim)의
 * 주체는 계정이어야지 브라우저여선 안 된다 — 기기 쿠키로도 그게 됐다면, 남의
 * 브라우저에 남은 쿠키 하나로 그 사람의 기기를 자기 계정에 가져올 수 있다.
 *
 * getSession 이 아니라 getClaims 인 것은 서명을 검증하기 때문이다 — 쿠키는
 * 신뢰할 수 없는 저장소라 거기 담긴 user 객체를 그대로 믿으면 안 된다
 * (auth-js 문서가 명시한다).
 */
export async function getGoogleUser(): Promise<CurrentUser | null> {
  let authId: string | undefined;
  try {
    const supabase = await createServerSupabase();
    const { data } = await supabase.auth.getClaims();
    authId = data?.claims.sub;
  } catch (err) {
    // 인증 서버가 흔들려도 기기 쿠키 쪽 문은 열려 있어야 한다.
    console.error('[current-user] 구글 세션 조회 실패', err instanceof Error ? err.name : 'unknown');
    return null;
  }
  if (!authId) return null;

  const rows = await db
    .select(SELECTION)
    .from(users)
    .innerJoin(characters, eq(characters.userId, users.id))
    .where(eq(users.authId, authId))
    .limit(1);

  return rows[0] ? toCurrentUser(rows[0]) : null;
}

/** 확장이 발급한 기기 키. 쿠키에 담긴 값 자체는 예전과 같지만 뜻이 달라졌다 —
 *  "나는 이 계정이다"가 아니라 "나는 이 기기다"이고, 계정은 devices 를 한 번
 *  거쳐 나온다. */
async function fromDeviceCookie(): Promise<CurrentUser | null> {
  const cookieStore = await cookies();
  const key = cookieStore.get(NA_KEY_COOKIE)?.value;
  if (!key) return null;

  const rows = await db
    .select(SELECTION)
    .from(devices)
    .innerJoin(users, eq(users.id, devices.userId))
    .innerJoin(characters, eq(characters.userId, users.id))
    .where(eq(devices.extensionKey, key))
    .limit(1);

  return rows[0] ? toCurrentUser(rows[0]) : null;
}

// 어느 문도 안 열리면 null — 호출부가 /connect 로 redirect() 한다.
export async function getCurrentUser(): Promise<CurrentUser | null> {
  return (await getGoogleUser()) ?? (await fromDeviceCookie());
}
