// character-cache: 전 유저 대상으로 experience_count·skill_count·active_days·
// memory_count·oldest_memory_at·level 을 원본 테이블에서 다시 세어 캐시에 반영한다.
// characters 의 이 컬럼들은 전부 파생 캐시(계획서 스키마 주석) — 이 배치가 유일한
// 진실(experiences/user_skills/memories)로부터 재계산하는 지점이다.
//
// 레벨 공식은 Experience Engine(세션 종료 시 실시간 갱신)과 여기서 반드시 같은
// packages/shared/src/level.ts::calculateLevel 을 써야 한다 — 공식을 두 곳에
// 따로 두면 실시간 레벨과 배치 후 레벨이 어긋난다.

import { eq, sql } from 'drizzle-orm';
import { calculateLevel } from '@na/shared';
import { characters, experiences, memories, userSkills, users, type Db } from '@na/db';
import { kstDayKey } from '../kst';

const DAY_MS = 24 * 60 * 60 * 1000;

export async function refreshCharacterCache(db: Db): Promise<void> {
  console.log('[character-cache] start');

  const userRows = await db.select({ id: users.id, createdAt: users.createdAt }).from(users);
  const now = new Date();

  let updated = 0;

  for (const user of userRows) {
    const [{ count: experienceCount }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(experiences)
      .where(eq(experiences.userId, user.id));

    const [{ count: skillCount }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(userSkills)
      .where(eq(userSkills.userId, user.id));

    // active_days = 경험이 있는 고유 KST(새벽4시 경계) 날짜 수.
    const occurredAtRows = await db
      .select({ occurredAt: experiences.occurredAt })
      .from(experiences)
      .where(eq(experiences.userId, user.id));
    const activeDays = new Set(occurredAtRows.map((r) => kstDayKey(r.occurredAt))).size;

    const [memoryAgg] = await db
      .select({
        count: sql<number>`count(*)::int`,
        oldest: sql<Date | null>`min(${memories.occurredAt})`,
      })
      .from(memories)
      .where(eq(memories.userId, user.id));
    const memoryCount = memoryAgg?.count ?? 0;
    // min(timestamptz) 를 raw sql 로 뽑으면 스키마 컬럼 매핑을 안 거쳐서 Date 로
    // 자동 변환되지 않을 수 있다 — update 시 timestamp 컬럼 직렬화(toISOString)가
    // 기대하는 Date 로 명시적으로 감싼다.
    const oldestMemoryAt = memoryAgg?.oldest ? new Date(memoryAgg.oldest) : null;

    const daysSinceCreated = Math.floor((now.getTime() - user.createdAt.getTime()) / DAY_MS);
    const level = calculateLevel({ experienceCount, skillCount, daysSinceCreated });

    await db
      .update(characters)
      .set({
        experienceCount,
        skillCount,
        activeDays,
        memoryCount,
        oldestMemoryAt,
        level,
        lastComputedAt: now,
      })
      .where(eq(characters.userId, user.id));

    updated += 1;
  }

  console.log(`[character-cache] ${updated}명 갱신`);
  console.log('[character-cache] done');
}
