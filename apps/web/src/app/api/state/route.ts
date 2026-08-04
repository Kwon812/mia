// ============================================================
// GET /api/state
//
// 새 탭/사이트 진입 시 읽는 캐릭터 홈 화면 데이터(계획서 09장).
// LLM 호출 없이 캐시된 파생값 + 오늘자 원본만 조합해서 내려준다.
// ============================================================

import { and, desc, eq, gte } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { characters, dialogues, experiences, sessions } from '@na/db';
import type { StateResponse } from '@na/shared';
import { db } from '@/lib/db';
import { getUserByExtensionKey } from '@/lib/api-auth';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// "오늘"의 경계는 자정이 아니라 KST 새벽 4시다(계획서 04장 day 규칙).
// 새벽 작업이 자정을 넘겨도 하루로 묶이게 하려는 의도.
//
// 구현: now 를 KST 오프셋만큼 밀어 "UTC 게터로 KST 벽시계 값을 읽는" 트릭을 쓴다.
// 그 벽시계 시각이 4시 이전이면 전날 04:00 KST, 이후면 당일 04:00 KST 가 경계다.
// 마지막에 다시 KST 오프셋을 빼서 실제 UTC 시각(Date)으로 되돌린다.
function getKstDayBoundary(now = new Date()): Date {
  const kstWallClock = new Date(now.getTime() + KST_OFFSET_MS);
  const kstHour = kstWallClock.getUTCHours();
  const dayOffset = kstHour < 4 ? -1 : 0;

  const boundaryAsKstWallClock = Date.UTC(
    kstWallClock.getUTCFullYear(),
    kstWallClock.getUTCMonth(),
    kstWallClock.getUTCDate() + dayOffset,
    4,
    0,
    0,
    0,
  );

  return new Date(boundaryAsKstWallClock - KST_OFFSET_MS);
}

export async function GET(req: Request) {
  try {
    const user = await getUserByExtensionKey(req);
    if (!user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const dayBoundary = getKstDayBoundary();

    const [characterRow, dialogueRows, todaySessions, todayExperiences] = await Promise.all([
      db.select().from(characters).where(eq(characters.userId, user.id)).limit(1),
      db.select().from(dialogues).where(eq(dialogues.userId, user.id)),
      db
        .select()
        .from(sessions)
        .where(and(eq(sessions.userId, user.id), gte(sessions.startedAt, dayBoundary)))
        .orderBy(desc(sessions.startedAt)),
      db
        .select()
        .from(experiences)
        .where(and(eq(experiences.userId, user.id), gte(experiences.occurredAt, dayBoundary)))
        .orderBy(desc(experiences.occurredAt)),
    ]);

    const character = characterRow[0];
    const daysTogether = Math.floor((Date.now() - user.createdAt.getTime()) / DAY_MS);

    const body: StateResponse = {
      character: {
        name: character?.name ?? null,
        level: character?.level ?? 1,
        experience_count: character?.experienceCount ?? 0,
        skill_count: character?.skillCount ?? 0,
        memory_count: character?.memoryCount ?? 0,
        days_together: daysTogether,
      },
      emotion: null, // 감정 파생 계산은 후속 작업
      dialogues: dialogueRows.map((d) => ({ slot: d.slot, text: d.text })),
      today: {
        sessions: todaySessions.map((s) => ({
          id: s.id,
          started_at: s.startedAt.toISOString(),
          ended_at: s.endedAt.toISOString(),
          duration_min: s.durationMin,
          primary_category: s.primaryCategory,
          activity_score: s.activityScore,
          tags: s.tags ?? [],
        })),
        experiences: todayExperiences.map((e) => ({
          id: e.id,
          occurred_at: e.occurredAt.toISOString(),
          summary: e.summary,
          outcome: e.outcome,
          is_first_time: e.isFirstTime,
        })),
      },
    };

    return NextResponse.json(body, { status: 200 });
  } catch (err) {
    console.error('[GET /api/state] failed', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
