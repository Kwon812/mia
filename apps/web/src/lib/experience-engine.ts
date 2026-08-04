// ============================================================
// Experience Engine — 세션 종료 후 LLM 1회로 "경험"을 추출한다.
//
// POST /api/sessions 가 저장 성공 응답을 보낸 뒤 next/server 의 after() 안에서
// processSession(sessionId, userId) 를 조용히 호출한다. 실패해도 API 응답에는
// 영향이 없고, sessions.processed_at 이 NULL 로 남아 재처리 대상이 된다
// (계획서 05장 "Experience Engine").
// ============================================================

import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import {
  DIALOGUE_SLOTS,
  EXPERIENCE_OUTCOMES,
  characters,
  dialogues,
  experienceSkills,
  experiences,
  ingestFailures,
  sessions,
  userSkills,
  users,
} from '@na/db';
import { experienceOutputSchema, type ExperienceOutput } from '@na/shared';
import { db } from './db';
import { calculateMemoryScore, type RecentExperienceSummary } from './memory-score';

// ------------------------------------------------------------
// LLM 호출 설정
// ------------------------------------------------------------

// 저비용 모델. 세션 하나당 1회만 호출되므로 Haiku 로 충분하다 (claude-api 스킬 캐시 기준 모델 ID).
const MODEL = 'claude-haiku-4-5';

const TOOL_NAME = 'record_experience';

// v1 — 프롬프트를 바꾸면 버전을 올리고 dailyLogs.promptVersion 처럼 이력을 남길지 검토한다.
const SYSTEM_PROMPT_V1 = `너는 사용자의 브라우징 세션 하나를 "경험" 하나로 압축하는 엔진이다.

사용자 메시지로 이번 세션의 압축 로그(compressed_log)·카테고리·길이(분)·방문 도메인과,
이 사용자의 기존 컨텍스트(보유 스킬 목록, 최근 경험 3건)를 함께 받는다.

기존 컨텍스트를 반드시 참고해서 다음 두 가지를 구분해야 한다.
  "TypeScript로 기능을 구현했다"   ← 기존 스킬 목록에 이미 있던 것 (늘 하던 것)
  "처음으로 TypeScript를 써봤다"   ← 기존 스킬 목록에 없던 것 (신규 스킬 획득, is_first_time=true)

record_experience 툴을 반드시 한 번 호출해서 다음을 채운다.
- summary: 이 세션을 한 문장으로, "~했다"체로 요약한다.
- detail: 2~3문장으로 조금 더 자세히 설명한다 (선택).
- category: 이 경험의 카테고리.
- outcome: success(성공) | partial(부분 성공) | stuck(막힘) | explore(탐색/실험) 중 하나.
- is_first_time: 기존 스킬 목록에 없던 것을 이번에 처음 시도했으면 true.
- skills: 이번에 사용하거나 습득한 스킬과 비중(weight, 1~10). 기존 스킬 목록과 이름이
  겹치면 반드시 동일한 표기를 재사용한다 — "TS"·"타입스크립트"처럼 같은 스킬을 다른
  이름으로 만들어내지 않는다.
- dialogues: 아침(morning)·오후(afternoon)·저녁(evening)·밤(night) 각 시간대에 캐릭터가
  사용자에게 건넬 반말 한 마디. 이번 세션 내용을 반영한 자연스러운 한국어 반말으로,
  각 80자를 넘기지 않는다.`;

// strict: true 로 스키마 위반 자체를 막는다. 그래도 최종 검증은 항상
// experienceOutputSchema.safeParse 로 한다 (weight 범위 등 strict 가 못 잡는 제약도 있다).
const RECORD_EXPERIENCE_TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description:
    '이번 브라우징 세션을 "경험" 하나로 압축한 결과를 기록한다. 반드시 이 툴을 호출해서 응답한다.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description: '세션을 한 문장으로 요약. "~했다"체로 끝낸다. 100자 이내.',
      },
      detail: {
        type: 'string',
        description: '2~3문장으로 조금 더 자세히 설명. 없어도 된다.',
      },
      category: {
        type: 'string',
        description: '이 경험의 카테고리.',
      },
      outcome: {
        type: 'string',
        enum: [...EXPERIENCE_OUTCOMES],
        description: 'success | partial | stuck | explore 중 하나.',
      },
      is_first_time: {
        type: 'boolean',
        description: '기존 스킬 목록에 없던 것을 이번에 처음 시도했는가.',
      },
      skills: {
        type: 'array',
        description:
          '이번에 사용/습득한 스킬 목록. 기존 스킬 목록과 이름이 겹치면 동일 표기를 재사용한다.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '스킬 이름. 기존 표기와 일치시킨다.' },
            weight: { type: 'integer', description: '이 경험에서 이 스킬의 비중. 1~10.' },
          },
          required: ['name', 'weight'],
          additionalProperties: false,
        },
      },
      dialogues: {
        type: 'array',
        description: '시간대별(morning/afternoon/evening/night) 반말 대사. 각 80자 이내. 3~4개.',
        items: {
          type: 'object',
          properties: {
            slot: { type: 'string', enum: [...DIALOGUE_SLOTS] },
            text: { type: 'string', description: '80자 이내 반말 대사.' },
          },
          required: ['slot', 'text'],
          additionalProperties: false,
        },
      },
    },
    required: ['summary', 'category', 'outcome', 'is_first_time', 'skills', 'dialogues'],
    additionalProperties: false,
  },
};

// ------------------------------------------------------------
// 캐릭터 레벨 공식 — 계획서 06장
//   레벨 = min(1 + floor(sqrt(경험 수 * 고유 스킬 수)), floor(가입 후 일수 / 3) + 1)
//
// 주의: 이 공식은 (아직 미구현인) 야간 배치의 레벨 재계산과 반드시 동일하게
// 유지해야 한다. 한쪽만 고치면 세션 종료 시 레벨과 야간 배치 후 레벨이
// 어긋난다. 상수·계수는 튜닝 대상이며, 바꿀 때는 두 곳을 함께 바꾼다.
// ------------------------------------------------------------
const LEVEL_BASE = 1;
const LEVEL_SIGNUP_DIVISOR_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

function calculateCharacterLevel(input: {
  experienceCount: number;
  uniqueSkillCount: number;
  daysSinceSignup: number;
}): number {
  const byActivity = LEVEL_BASE + Math.floor(Math.sqrt(input.experienceCount * input.uniqueSkillCount));
  const bySignupAge = Math.floor(input.daysSinceSignup / LEVEL_SIGNUP_DIVISOR_DAYS) + 1;
  return Math.min(byActivity, bySignupAge);
}

// ------------------------------------------------------------
// category → user_skills.domain 간단 매핑. 애매하면 'life'.
// domain 은 스킬이 "처음 생성"될 때만 정해지고, 이후 upsert 에서는 바뀌지 않는다.
// ------------------------------------------------------------
const PROGRAMMING_KEYWORDS = [
  '개발',
  '코딩',
  '코드',
  '프로그래밍',
  '디버그',
  '리팩토링',
  '버그',
  '엔지니어링',
  'dev',
  'code',
  'coding',
  'program',
  'engineer',
  'debug',
  'refactor',
  'backend',
  'frontend',
  'api',
  'typescript',
  'javascript',
  'python',
];

const ART_KEYWORDS = [
  '디자인',
  '그림',
  '음악',
  '작곡',
  '사진',
  '영상',
  '편집',
  '창작',
  '드로잉',
  'design',
  'art',
  'music',
  'drawing',
  'paint',
  'photo',
  'illustration',
];

function mapCategoryToDomain(category: string): 'programming' | 'art' | 'life' {
  const c = category.toLowerCase();
  if (PROGRAMMING_KEYWORDS.some((k) => c.includes(k))) return 'programming';
  if (ART_KEYWORDS.some((k) => c.includes(k))) return 'art';
  return 'life';
}

// LLM 이 같은 스킬을 중복으로 낼 수 있으니 이름으로 합치고 weight 는 1~10 으로 clamp 한다.
function dedupeSkills(skills: ExperienceOutput['skills']): { name: string; weight: number }[] {
  const merged = new Map<string, number>();
  for (const s of skills) {
    const clamped = Math.min(10, Math.max(1, Math.round(s.weight)));
    merged.set(s.name, Math.min(10, (merged.get(s.name) ?? 0) + clamped));
  }
  return Array.from(merged.entries()).map(([name, weight]) => ({ name, weight }));
}

// ------------------------------------------------------------
// 프롬프트 조립
// ------------------------------------------------------------

interface SessionRow {
  primaryCategory: string;
  durationMin: number;
  domains: Record<string, number>;
  compressedLog: unknown;
}

interface ExistingSkillRow {
  name: string;
  lastUsedAt: Date;
}

interface RecentExperienceRow {
  summary: string;
  category: string;
  outcome: string | null;
}

function buildUserMessage(
  session: SessionRow,
  existingSkills: ExistingSkillRow[],
  recentExperiences: RecentExperienceRow[],
): string {
  const skillsList =
    existingSkills.length > 0
      ? existingSkills.map((s) => `- ${s.name} (마지막 사용: ${s.lastUsedAt.toISOString().slice(0, 10)})`).join('\n')
      : '(아직 기록된 스킬 없음)';

  const recentList =
    recentExperiences.length > 0
      ? recentExperiences.map((e, i) => `${i + 1}. [${e.category}/${e.outcome ?? '-'}] ${e.summary}`).join('\n')
      : '(아직 기록된 경험 없음)';

  return [
    '## 기존 컨텍스트',
    '### 보유 스킬 목록',
    skillsList,
    '',
    '### 최근 경험 3건 (최신순)',
    recentList,
    '',
    '## 이번 세션',
    `- 카테고리: ${session.primaryCategory}`,
    `- 길이: ${session.durationMin}분`,
    `- 방문 도메인(도메인별 체류 시간 등): ${JSON.stringify(session.domains)}`,
    '- 압축 로그(타임라인):',
    JSON.stringify(session.compressedLog),
  ].join('\n');
}

// ------------------------------------------------------------
// 메인 파이프라인
// ------------------------------------------------------------

export async function processSession(sessionId: string, userId: string): Promise<void> {
  try {
    // 1. 멱등 가드
    const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
    if (!session || session.processedAt) return;

    // 2. 컨텍스트 로드
    const existingSkillRows = await db
      .select({ name: userSkills.skillName, lastUsedAt: userSkills.lastUsedAt })
      .from(userSkills)
      .where(eq(userSkills.userId, userId))
      .orderBy(desc(userSkills.lastUsedAt))
      .limit(50);
    const existingSkillNames = new Set(existingSkillRows.map((s) => s.name));

    const recentExperienceRows = await db
      .select({
        id: experiences.id,
        summary: experiences.summary,
        category: experiences.category,
        outcome: experiences.outcome,
        occurredAt: experiences.occurredAt,
      })
      .from(experiences)
      .where(eq(experiences.userId, userId))
      .orderBy(desc(experiences.occurredAt))
      .limit(3);

    // 최근 경험 3건 각각의 "주요 스킬"(weight 최댓값) — 반복 패턴 판정용.
    const primarySkillByExperienceId = new Map<string, string | null>();
    if (recentExperienceRows.length > 0) {
      const skillRows = await db
        .select({
          experienceId: experienceSkills.experienceId,
          skillName: experienceSkills.skillName,
          weight: experienceSkills.weight,
        })
        .from(experienceSkills)
        .where(
          inArray(
            experienceSkills.experienceId,
            recentExperienceRows.map((e) => e.id),
          ),
        );

      const bestPerExperience = new Map<string, { name: string; weight: number }>();
      for (const row of skillRows) {
        const current = bestPerExperience.get(row.experienceId);
        if (!current || row.weight > current.weight) {
          bestPerExperience.set(row.experienceId, { name: row.skillName, weight: row.weight });
        }
      }
      for (const exp of recentExperienceRows) {
        primarySkillByExperienceId.set(exp.id, bestPerExperience.get(exp.id)?.name ?? null);
      }
    }

    // 최근 20개 세션(이번 세션 제외)의 duration_min — 평균 대비 2배 판정용.
    const recentSessionRows = await db
      .select({ durationMin: sessions.durationMin })
      .from(sessions)
      .where(and(eq(sessions.userId, userId), ne(sessions.id, sessionId)))
      .orderBy(desc(sessions.startedAt))
      .limit(20);

    const [userRow] = await db.select({ createdAt: users.createdAt }).from(users).where(eq(users.id, userId)).limit(1);

    // 3. LLM 1회 호출 — structured output 은 tool use(단일 툴 강제) 방식.
    const client = new Anthropic();

    const sessionForPrompt: SessionRow = {
      primaryCategory: session.primaryCategory,
      durationMin: session.durationMin,
      domains: session.domains,
      compressedLog: session.compressedLog,
    };

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT_V1,
      tools: [RECORD_EXPERIENCE_TOOL],
      tool_choice: { type: 'tool', name: TOOL_NAME },
      messages: [
        {
          role: 'user',
          content: buildUserMessage(sessionForPrompt, existingSkillRows, recentExperienceRows),
        },
      ],
    });

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use' && block.name === TOOL_NAME,
    );

    if (!toolUse) {
      await db.insert(ingestFailures).values({
        userId,
        sessionId,
        reason: 'llm_output_invalid: no tool_use block in response',
        payload: response.content,
      });
      return;
    }

    // 4. 출력 검증
    const parsed = experienceOutputSchema.safeParse(toolUse.input);
    if (!parsed.success) {
      await db.insert(ingestFailures).values({
        userId,
        sessionId,
        reason: `llm_output_invalid: ${parsed.error.message}`,
        payload: toolUse.input,
      });
      return;
    }

    const output = parsed.data;
    const dedupedSkills = dedupeSkills(output.skills);
    const hasNewSkill = dedupedSkills.some((s) => !existingSkillNames.has(s.name));
    const primarySkillName = dedupedSkills.length > 0 ? [...dedupedSkills].sort((a, b) => b.weight - a.weight)[0].name : null;

    // 6. Memory Engine 점수 (순수 함수, LLM 재호출 없음)
    const daysSinceLastExperience =
      recentExperienceRows.length > 0
        ? Math.floor((session.startedAt.getTime() - recentExperienceRows[0].occurredAt.getTime()) / DAY_MS)
        : null;

    const recentExperienceSummaries: RecentExperienceSummary[] = recentExperienceRows.map((e) => ({
      category: e.category,
      primarySkillName: primarySkillByExperienceId.get(e.id) ?? null,
    }));

    const memoryScore = calculateMemoryScore({
      hasNewSkill,
      isFirstTime: output.is_first_time,
      daysSinceLastExperience,
      durationMin: session.durationMin,
      recentSessionDurations: recentSessionRows.map((r) => r.durationMin),
      category: output.category,
      primarySkillName,
      recentExperiences: recentExperienceSummaries,
    });

    // 5. 저장 (트랜잭션)
    const now = new Date();
    const domain = mapCategoryToDomain(output.category);

    await db.transaction(async (tx) => {
      const [insertedExperience] = await tx
        .insert(experiences)
        .values({
          userId,
          sessionId,
          occurredAt: session.startedAt,
          summary: output.summary,
          detail: output.detail ?? null,
          category: output.category,
          outcome: output.outcome,
          isFirstTime: output.is_first_time,
          memoryScore,
        })
        .onConflictDoNothing({ target: experiences.sessionId })
        .returning({ id: experiences.id });

      // experiences.session_id 는 UNIQUE — 동시 처리로 이미 만들어졌다면 조용히 종료.
      if (!insertedExperience) return;

      if (dedupedSkills.length > 0) {
        await tx
          .insert(experienceSkills)
          .values(dedupedSkills.map((s) => ({ experienceId: insertedExperience.id, skillName: s.name, weight: s.weight })))
          .onConflictDoNothing({ target: [experienceSkills.experienceId, experienceSkills.skillName] });

        for (const skill of dedupedSkills) {
          await tx
            .insert(userSkills)
            .values({
              userId,
              skillName: skill.name,
              domain,
              points: skill.weight,
              useCount: 1,
              firstUsedAt: now,
              lastUsedAt: now,
            })
            .onConflictDoUpdate({
              target: [userSkills.userId, userSkills.skillName],
              set: {
                points: sql`${userSkills.points} + ${skill.weight}`,
                useCount: sql`${userSkills.useCount} + 1`,
                lastUsedAt: now,
              },
            });
        }
      }

      for (const d of output.dialogues) {
        // DB CHECK(char_length <= 80) 이 막기 전에 서버에서 먼저 절단한다.
        const text = d.text.slice(0, 80);
        await tx
          .insert(dialogues)
          .values({ userId, slot: d.slot, text, sourceSessionId: sessionId })
          .onConflictDoUpdate({
            target: [dialogues.userId, dialogues.slot],
            set: { text, sourceSessionId: sessionId, generatedAt: now },
          });
      }

      const [{ count: skillCount }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(userSkills)
        .where(eq(userSkills.userId, userId));

      const [characterRow] = await tx
        .select({ experienceCount: characters.experienceCount })
        .from(characters)
        .where(eq(characters.userId, userId))
        .for('update');

      const newExperienceCount = (characterRow?.experienceCount ?? 0) + 1;
      const daysSinceSignup = userRow ? Math.floor((now.getTime() - userRow.createdAt.getTime()) / DAY_MS) : 0;
      const newLevel = calculateCharacterLevel({
        experienceCount: newExperienceCount,
        uniqueSkillCount: skillCount,
        daysSinceSignup,
      });

      await tx
        .update(characters)
        .set({
          experienceCount: newExperienceCount,
          skillCount,
          level: newLevel,
          lastComputedAt: now,
        })
        .where(eq(characters.userId, userId));

      await tx.update(sessions).set({ processedAt: now }).where(eq(sessions.id, sessionId));
    });
  } catch (err) {
    console.error('[processSession] failed', sessionId, err);
    try {
      await db.insert(ingestFailures).values({
        userId,
        sessionId,
        reason: `experience_engine_error: ${err instanceof Error ? err.message : String(err)}`,
        payload: null,
      });
    } catch (logErr) {
      console.error('[processSession] failed to record ingest_failures', sessionId, logErr);
    }
  }
}
