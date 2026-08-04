// ============================================================
// Experience Engine — 세션 종료 후 LLM 1회로 "경험"을 추출한다.
//
// POST /api/sessions 가 저장 성공 응답을 보낸 뒤 next/server 의 after() 안에서
// processSession(sessionId, userId) 를 조용히 호출한다. 실패해도 API 응답에는
// 영향이 없고, sessions.processed_at 이 NULL 로 남아 재처리 대상이 된다
// (계획서 05장 "Experience Engine").
//
// thread 부착도 이 안에서 함께 결정한다(계획서 11장 미결정 항목 확정) — LLM 이
// 이미 세션 컨텍스트를 보고 있으니 "이 경험이 기존 작업의 연장인지" 판단에
// 별도 호출이 필요 없다. 기억(memories) 생성은 LLM 호출 없이 규칙 기반이다.
// ============================================================

import 'server-only';
import { randomUUID } from 'node:crypto';
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
  memories,
  sessions,
  threads,
  userSkills,
  users,
} from '@na/db';
import { calculateLevel, experienceOutputSchema, type ExperienceOutput } from '@na/shared';
import { db } from './db';
import { calculateMemoryScore, type RecentExperienceSummary } from './memory-score';

// ------------------------------------------------------------
// LLM 호출 설정
// ------------------------------------------------------------

// 저비용 모델. 세션 하나당 1회만 호출되므로 Haiku 로 충분하다 (claude-api 스킬 캐시 기준 모델 ID).
const MODEL = 'claude-haiku-4-5';

const TOOL_NAME = 'record_experience';

// v2 — compressed_log 에 검색 쿼리(queries)와 페이지 제목(segments[].title),
// 경로 예시(segments[].paths)가 추가됨에 따라 이를 활용하도록 지시를 보강했다
// (v1: 도메인·시간만으로 추측 → v2: 무엇을 검색·열람했는지까지 반영).
// 프롬프트를 바꾸면 버전을 올리고 dailyLogs.promptVersion 처럼 이력을 남길지 검토한다.
const SYSTEM_PROMPT_V2 = `너는 사용자의 브라우징 세션 하나를 "경험" 하나로 압축하는 엔진이다.

사용자 메시지로 이번 세션의 압축 로그(compressed_log)·카테고리·길이(분)·방문 도메인과,
이 사용자의 기존 컨텍스트(보유 스킬 목록, 최근 경험 3건, 진행 중인 작업 목록)를 함께 받는다.

compressed_log 에는 구간(segments)마다 도메인·카테고리·시간 외에 그 구간에서 관측된
페이지 제목(title)과 경로 예시(paths)가, 그리고 세션 전체의 검색어 목록(queries)이
들어있다. 검색 쿼리는 사용자가 무엇을 궁금해했는지, 페이지 제목은 무엇을 읽었는지
알려준다. 이걸 근거로 summary·detail·skills 를 "github.com 에 90분 머물렀다" 같은
막연한 도메인 요약이 아니라 구체적인 내용으로 만들어라(예: 검색어가
"redis cache invalidation" 이고 이어서 GitHub 이슈·MDN 페이지 제목이 보이면 "Redis
캐시 무효화 방법을 찾아봤다"처럼). 단, title/paths 에 개인정보(이름·계좌번호·주문번호
등으로 보이는 문자열)가 보이면 그 값을 요약·detail 에 그대로 옮기지 말고 일반화해서
서술한다.

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
- dialogues: **반드시 4개** — morning, afternoon, evening, night 슬롯당 정확히 하나씩.
  하나라도 빠뜨리면 안 된다. 각각 이번 세션 내용을 반영해 캐릭터가 사용자에게 건네는
  자연스러운 한국어 반말 한 마디, 80자 이내. 시간대에 맞는 어감으로 쓴다
  (아침이면 하루를 여는 톤, 밤이면 하루를 돌아보는 톤).
- thread: 이 경험이 "진행 중인 작업 목록"에 있는 기존 작업의 연장이면
  action="attach" 로 하고 existing_thread_id 에 그 목록에 있는 id 를 그대로 적는다
  (목록에 없는 id 를 만들어내지 않는다). 새로운 작업이면 action="new" 로 하고
  title 에 그 작업을 부르는 짧은 명사구를 적는다("Redis 캐싱 도입" 같은). completed 는
  이번 경험으로 그 작업이 완결됐다고 볼 수 있으면 true — 애매하면 false.`;

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
        description:
          '반드시 4개 — morning/afternoon/evening/night 슬롯당 정확히 하나씩. 각 80자 이내 반말.',
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
      thread: {
        type: 'object',
        description:
          '이 경험이 기존 진행 중 작업(thread)의 연장인지, 새 작업인지 판단한 결과.',
        properties: {
          action: {
            type: 'string',
            enum: ['attach', 'new'],
            description:
              'attach: "진행 중인 작업 목록"에 있는 기존 작업의 연장. new: 새로운 작업의 시작.',
          },
          existing_thread_id: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            description:
              'action이 attach일 때 "진행 중인 작업 목록"에서 고른 thread의 id 를 그대로 적는다. new일 때는 null.',
          },
          title: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            description:
              'action이 new일 때 이 작업을 부르는 짧은 명사구 제목("Redis 캐싱 도입" 같은). attach일 때는 null.',
          },
          completed: {
            type: 'boolean',
            description: '이 경험으로 그 작업이 완결됐다고 볼 수 있는가.',
          },
        },
        required: ['action', 'existing_thread_id', 'title', 'completed'],
        additionalProperties: false,
      },
    },
    required: ['summary', 'category', 'outcome', 'is_first_time', 'skills', 'dialogues', 'thread'],
    additionalProperties: false,
  },
};

// ------------------------------------------------------------
// Memory Engine — thread 완결과 별개로 memory_score 가 이 임계값을 넘으면
// 'new_skill' 또는 'comeback' 트리거로 memories 를 하나 더 남긴다.
// 어느 트리거인지는 breakdown 에서 어느 규칙이 발동했는지로 정한다.
// ------------------------------------------------------------
const MEMORY_SCORE_THRESHOLD = 80;

function clampImportance(score: number): number {
  return Math.min(10, Math.max(1, Math.round(score / 10)));
}

const DAY_MS = 24 * 60 * 60 * 1000;

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

interface ActiveThreadRow {
  id: string;
  title: string;
  category: string;
  experienceCount: number;
}

function buildActiveThreadsList(activeThreads: ActiveThreadRow[]): string {
  if (activeThreads.length === 0) return '(진행 중인 작업 없음)';
  return activeThreads
    .map((t, i) => `${i + 1}. id=${t.id} · "${t.title}" (카테고리: ${t.category}, 경험 ${t.experienceCount}건)`)
    .join('\n');
}

function buildUserMessage(
  session: SessionRow,
  existingSkills: ExistingSkillRow[],
  recentExperiences: RecentExperienceRow[],
  activeThreads: ActiveThreadRow[],
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
    '### 진행 중인 작업(thread) 목록 (최근 활동순, 최대 5개)',
    buildActiveThreadsList(activeThreads),
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

    // 활성 thread 최대 5개 — "이 경험이 기존 진행 중 작업의 연장인지" 판단용 컨텍스트.
    const activeThreadRows = await db
      .select({
        id: threads.id,
        title: threads.title,
        category: threads.category,
        experienceCount: threads.experienceCount,
      })
      .from(threads)
      .where(and(eq(threads.userId, userId), eq(threads.status, 'active')))
      .orderBy(desc(threads.lastActivityAt))
      .limit(5);

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
      system: SYSTEM_PROMPT_V2,
      tools: [RECORD_EXPERIENCE_TOOL],
      tool_choice: { type: 'tool', name: TOOL_NAME },
      messages: [
        {
          role: 'user',
          content: buildUserMessage(sessionForPrompt, existingSkillRows, recentExperienceRows, activeThreadRows),
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

    // thread 부착 판정 — LLM 환각 방어: 목록에 없는 existing_thread_id 면 new 로 강등.
    const activeThreadsById = new Map(activeThreadRows.map((t) => [t.id, t]));
    let threadAction: 'attach' | 'new' = output.thread.action;
    let attachTargetId = output.thread.existing_thread_id;
    if (threadAction === 'attach' && (!attachTargetId || !activeThreadsById.has(attachTargetId))) {
      threadAction = 'new';
      attachTargetId = null;
    }

    const threadId = threadAction === 'new' ? randomUUID() : attachTargetId!;
    const threadTitle =
      threadAction === 'new'
        ? output.thread.title?.trim() || output.summary.slice(0, 100)
        : (activeThreadsById.get(threadId)?.title ?? output.summary.slice(0, 100));

    // 6. Memory Engine 점수 (순수 함수, LLM 재호출 없음)
    const daysSinceLastExperience =
      recentExperienceRows.length > 0
        ? Math.floor((session.startedAt.getTime() - recentExperienceRows[0].occurredAt.getTime()) / DAY_MS)
        : null;

    const recentExperienceSummaries: RecentExperienceSummary[] = recentExperienceRows.map((e) => ({
      category: e.category,
      primarySkillName: primarySkillByExperienceId.get(e.id) ?? null,
    }));

    const memoryScoreResult = calculateMemoryScore({
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
      // action='new' 인 thread 는 experiences.thread_id FK 때문에 experience insert 보다
      // 먼저 만들어야 한다(참조 대상이 존재해야 FK 를 통과한다). 'attach' 는 기존 thread 를
      // 그대로 참조하므로 여기서 할 일이 없고, 카운트 갱신은 insertedExperience 확인 후로 미룬다
      // — 그래야 동시 처리로 experience insert 가 취소될 때 기존 thread 카운트가 잘못 증가하지 않는다.
      if (threadAction === 'new') {
        await tx.insert(threads).values({
          id: threadId,
          userId,
          title: threadTitle,
          category: output.category,
          status: 'active',
          startedAt: session.startedAt,
          lastActivityAt: session.startedAt,
          experienceCount: 1,
        });
      }

      const [insertedExperience] = await tx
        .insert(experiences)
        .values({
          userId,
          sessionId,
          threadId, // insert 시점에 부착 — 이렇게 하면 "유일한 UPDATE 대상"이던 thread_id 에 대한 UPDATE 자체가 없어진다.
          occurredAt: session.startedAt,
          summary: output.summary,
          detail: output.detail ?? null,
          category: output.category,
          outcome: output.outcome,
          isFirstTime: output.is_first_time,
          memoryScore: memoryScoreResult.score,
        })
        .onConflictDoNothing({ target: experiences.sessionId })
        .returning({ id: experiences.id });

      // experiences.session_id 는 UNIQUE — 동시 처리로 이미 만들어졌다면 조용히 종료.
      // (기억 생성, attach 갱신 등 아래 모든 부수효과는 여기서 함께 취소된다. action='new' 로
      // 위에서 만든 thread 행은 이 드문 경합에서 고아로 남을 수 있지만, 매 세션마다 새
      // thread 를 만드는 정상 경로에서는 발생하지 않는 감내 가능한 트레이드오프다.)
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
              // "사용자가 실제로 쓴 시각" 기준 — experiences.occurred_at 과 마찬가지로
              // session.startedAt 을 쓴다(서버가 처리한 시각 `now` 가 아니다).
              firstUsedAt: session.startedAt,
              lastUsedAt: session.startedAt,
            })
            .onConflictDoUpdate({
              target: [userSkills.userId, userSkills.skillName],
              set: {
                points: sql`${userSkills.points} + ${skill.weight}`,
                useCount: sql`${userSkills.useCount} + 1`,
                // GREATEST 로 역행을 막는다 — 세션은 며칠 늦게 도착할 수 있어서
                // (예: 8/1 세션이 8/4 에 뒤늦게 도착) startedAt 을 무조건 덮어쓰면
                // 이미 8/3 으로 가 있던 lastUsedAt 이 8/1 로 되돌아간다.
                // 이 값은 프롬프트 컨텍스트("마지막 사용: ...")와 감정 판정
                // ("오래 안 쓴 스킬 재등장 → 그리움")에 그대로 쓰이므로 정확해야 한다.
                // (sql 템플릿에 Date 객체를 그대로 넣으면 컬럼 직렬화를 안 거쳐서
                // Date.toString() 형태로 바인딩되는 문제가 있어 ISO 문자열 + 명시적
                // 캐스트로 넘긴다.)
                lastUsedAt: sql`GREATEST(${userSkills.lastUsedAt}, ${session.startedAt.toISOString()}::timestamptz)`,
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

      // thread 부착 — action='new' 는 위에서 이미 만들었으니, 'attach' 인 경우만
      // 활동시각·경험수를 갱신한다.
      if (threadAction === 'attach') {
        await tx
          .update(threads)
          .set({
            lastActivityAt: session.startedAt,
            experienceCount: sql`${threads.experienceCount} + 1`,
          })
          .where(eq(threads.id, threadId));
      }

      // thread 완결 → status 전이 + 기억 생성. thread 완결과 별개로 memory_score
      // 임계값을 넘으면 'new_skill'/'comeback' 기억을 하나 더 남긴다(둘 다 발생 가능).
      let newMemoriesCount = 0;

      if (output.thread.completed) {
        await tx.update(threads).set({ status: 'completed', completedAt: now }).where(eq(threads.id, threadId));

        await tx.insert(memories).values({
          userId,
          threadId,
          experienceId: insertedExperience.id,
          occurredAt: session.startedAt,
          title: threadTitle,
          body: output.detail ?? output.summary,
          importance: clampImportance(memoryScoreResult.score),
          trigger: 'thread_complete',
        });
        newMemoriesCount += 1;
      }

      if (memoryScoreResult.score >= MEMORY_SCORE_THRESHOLD) {
        const trigger =
          memoryScoreResult.breakdown.hasNewSkill || memoryScoreResult.breakdown.isFirstTime
            ? 'new_skill'
            : 'comeback';

        await tx.insert(memories).values({
          userId,
          threadId,
          experienceId: insertedExperience.id,
          occurredAt: session.startedAt,
          title: output.summary,
          body: output.detail ?? output.summary,
          importance: clampImportance(memoryScoreResult.score),
          trigger,
        });
        newMemoriesCount += 1;
      }

      const [{ count: skillCount }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(userSkills)
        .where(eq(userSkills.userId, userId));

      const [characterRow] = await tx
        .select({
          experienceCount: characters.experienceCount,
          memoryCount: characters.memoryCount,
          oldestMemoryAt: characters.oldestMemoryAt,
        })
        .from(characters)
        .where(eq(characters.userId, userId))
        .for('update');

      const newExperienceCount = (characterRow?.experienceCount ?? 0) + 1;
      const daysSinceSignup = userRow ? Math.floor((now.getTime() - userRow.createdAt.getTime()) / DAY_MS) : 0;
      const newLevel = calculateLevel({
        experienceCount: newExperienceCount,
        skillCount,
        daysSinceCreated: daysSinceSignup,
      });

      const newMemoryCount = (characterRow?.memoryCount ?? 0) + newMemoriesCount;
      const existingOldestMemoryAt = characterRow?.oldestMemoryAt ?? null;
      const newOldestMemoryAt =
        newMemoriesCount > 0
          ? existingOldestMemoryAt && existingOldestMemoryAt < session.startedAt
            ? existingOldestMemoryAt
            : session.startedAt
          : existingOldestMemoryAt;

      await tx
        .update(characters)
        .set({
          experienceCount: newExperienceCount,
          skillCount,
          level: newLevel,
          memoryCount: newMemoryCount,
          oldestMemoryAt: newOldestMemoryAt,
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
