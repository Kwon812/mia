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
import { getKstDayBoundary } from '@/lib/date';

// "오늘" 경계는 lib/date.ts 의 getKstDayBoundary 를 단일 소스로 쓴다
// (KST 새벽 4시 — 계획서 04장 day 규칙. 중복 구현 금지).
const DAY_MS = 24 * 60 * 60 * 1000; // days_together 계산용 (24시간 단위)


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
