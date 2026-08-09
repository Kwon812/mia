// ============================================================
// Project NA — Drizzle 스키마 (쿼리 레이어 전용)
//
// 마이그레이션의 유일한 진실은
//   supabase/migrations/20260804000001_init.sql
// 이다. 이 파일은 그 DDL 을 타입 안전하게 다시 표현한 것일 뿐,
// drizzle-kit generate/push 로 이 파일에서 마이그레이션을 만들지 않는다.
// (컬럼을 고치고 싶으면 새 Supabase SQL 마이그레이션을 먼저 쓰고
//  이 파일을 그에 맞춰 손으로 동기화한다.)
// ============================================================

import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  date,
  index,
  uniqueIndex,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

// ------------------------------------------------------------
// 공용 enum 유니온 타입
// DB 에는 네이티브 enum 이 아니라 TEXT + CHECK 로만 존재하므로
// drizzle 컬럼도 pgEnum 이 아닌 text({ enum: [...] }) 로 맞춘다.
// ------------------------------------------------------------

export const CLOSE_REASONS = ['idle', 'switch', 'maxlen', 'day', 'shutdown'] as const;
export type CloseReason = (typeof CLOSE_REASONS)[number];

export const THREAD_STATUSES = ['active', 'completed', 'abandoned'] as const;
export type ThreadStatus = (typeof THREAD_STATUSES)[number];

export const EXPERIENCE_OUTCOMES = ['success', 'partial', 'stuck', 'explore'] as const;
export type ExperienceOutcome = (typeof EXPERIENCE_OUTCOMES)[number];

export const DIALOGUE_SLOTS = ['morning', 'afternoon', 'evening', 'night'] as const;
export type DialogueSlot = (typeof DIALOGUE_SLOTS)[number];

// ============================================================
// 1. 사용자 / 캐릭터
// ============================================================

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  extensionKey: text('extension_key').notNull().unique(), // 확장이 발급받는 익명 키
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const characters = pgTable('characters', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name'), // 사용자가 지어준 이름. NULL = 아직 없음
  namedAt: timestamp('named_at', { withTimezone: true }),

  // 아래는 전부 파생 캐시. 야간 배치에서 재계산한다.
  level: smallint('level').notNull().default(1),
  experienceCount: integer('experience_count').notNull().default(0),
  skillCount: integer('skill_count').notNull().default(0),
  activeDays: integer('active_days').notNull().default(0),
  memoryCount: integer('memory_count').notNull().default(0),
  oldestMemoryAt: timestamp('oldest_memory_at', { withTimezone: true }), // Lv.30 툴 게이팅 조건

  lastComputedAt: timestamp('last_computed_at', { withTimezone: true }),
});

// ============================================================
// 2. 세션 — 확장이 보낸 관측 단위
// ============================================================

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey(), // 클라이언트 생성 UUID. DB 기본값 없음(defaultRandom 금지)
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }).notNull(),
    durationMin: integer('duration_min').notNull(),

    closeReason: text('close_reason', { enum: CLOSE_REASONS }).notNull(),
    continuedFrom: uuid('continued_from').references((): AnyPgColumn => sessions.id), // maxlen 절단 시 이전 세션

    primaryCategory: text('primary_category').notNull(),
    activityScore: integer('activity_score').notNull(),
    uniqueDomains: smallint('unique_domains').notNull(),
    switchCount: smallint('switch_count').notNull().default(0),
    tags: text('tags').array().default([]), // 'scattered' 등

    compressedLog: jsonb('compressed_log').notNull().$type<unknown>(), // LLM 입력 원본
    domains: jsonb('domains').notNull().$type<Record<string, number>>(), // { "github.com": 320, ... }

    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }), // NULL = LLM 미처리
  },
  (t) => [
    // PK 가 클라이언트 UUID 라서 재시도 중복이 자동으로 막힌다.
    // 서버는 ON CONFLICT DO NOTHING 으로 받으면 끝.
    index('idx_sessions_unprocessed')
      .on(t.userId, t.receivedAt)
      .where(sql`${t.processedAt} is null`),
    index('idx_sessions_user_time').on(t.userId, t.startedAt.desc()),
    // text({ enum }) 은 TS 타입만 좁힌다. DB 레벨 CHECK 도 명시적으로 남긴다.
    check('sessions_close_reason_check', sql`${t.closeReason} in ('idle','switch','maxlen','day','shutdown')`),
  ],
);

// ============================================================
// 3. 스레드 — 여러 경험에 걸친 하나의 작업
//    (experiences 가 참조하므로 먼저 정의)
// ============================================================

export const threads = pgTable(
  'threads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    title: text('title').notNull(), // "Redis 캐싱 도입"
    category: text('category').notNull(),
    status: text('status', { enum: THREAD_STATUSES }).notNull().default('active'),

    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    experienceCount: integer('experience_count').notNull().default(1),
  },
  (t) => [
    index('idx_threads_active').on(t.userId, t.lastActivityAt.desc()).where(sql`${t.status} = 'active'`),
    check('threads_status_check', sql`${t.status} in ('active','completed','abandoned')`),
  ],
);

// status 전이가 곧 기억 생성 트리거다.
//   started            → "Unity 시작"
//   active → completed → "첫 게임 출시"
//   30일 무활동        → abandoned (기억 아님. 성격 축 '완결형↔탐색형' 입력)

// ============================================================
// 4. 경험 — 의미 단위. 불변.
// ============================================================

export const experiences = pgTable(
  'experiences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // UNIQUE 가 아니다 — 한 세션에서 경험이 여럿 나올 수 있다(대상이 둘 이상인
    // 세션). 예전에는 이 UNIQUE 가 "세션당 하나"와 **중복 처리 방어**를 겸했는데,
    // 방어는 sessions.processed_at 조건부 선점으로 옮겼다(experience-engine).
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    threadId: uuid('thread_id').references(() => threads.id), // 나중에 부착. 유일한 UPDATE 대상

    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(), // session.started_at. 정렬은 항상 이걸로
    summary: text('summary').notNull(), // "Redis 캐싱 구현 성공"
    detail: text('detail'), // 2~3문장. 일기 생성용
    category: text('category').notNull(),

    outcome: text('outcome', { enum: EXPERIENCE_OUTCOMES }),
    isFirstTime: boolean('is_first_time').notNull().default(false), // 신규 스킬 포함 여부
    memoryScore: integer('memory_score').notNull().default(0), // Memory Engine 점수

    /** 이 경험이 나온 compressed_log.segments 인덱스. 빈 배열이면 세션 전체. */
    segmentIds: integer('segment_ids').array().notNull().default([]),
    /** 이 경험에 귀속된 분. 나눴으면 그 몫만. NULL 이면 세션 길이를 쓴다. */
    durationMin: integer('duration_min'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_exp_user_time').on(t.userId, t.occurredAt.desc()),
    index('idx_exp_session').on(t.sessionId),
    index('idx_exp_thread').on(t.threadId).where(sql`${t.threadId} is not null`),
    index('idx_exp_unthreaded').on(t.userId, t.occurredAt).where(sql`${t.threadId} is null`),
    check('experiences_outcome_check', sql`${t.outcome} in ('success','partial','stuck','explore')`),
  ],
);

// outcome 이 감정의 재료다.
//   stuck 3연속  → 답답
//   success      → 성취
//   explore      → 호기심
// emotion 컬럼을 두지 않는 이유: 감정은 시점에 따라 달라지는 파생값이다.

// ============================================================
// 5. 스킬
// ============================================================

export const experienceSkills = pgTable(
  'experience_skills',
  {
    experienceId: uuid('experience_id')
      .notNull()
      .references(() => experiences.id, { onDelete: 'cascade' }),
    skillName: text('skill_name').notNull(), // 'TypeScript', 'Unity'
    weight: smallint('weight').notNull().default(1),
    // 'programming' | 'art' | 'life' — 그 경험에서 LLM 이 판단한 갈래.
    // NULL 이면 미판단(마이그레이션 이전 데이터, 또는 모델이 빠뜨린 경우).
    // user_skills.domain 은 이 열의 최빈값이다.
    domain: text('domain'),
  },
  (t) => [
    primaryKey({ columns: [t.experienceId, t.skillName] }),
    index('idx_expskill_name').on(t.skillName),
    index('idx_expskill_domain').on(t.skillName, t.domain),
  ],
);

// 파생 캐시. experience_skills 에서 언제든 재계산 가능.
export const userSkills = pgTable(
  'user_skills',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    skillName: text('skill_name').notNull(),
    domain: text('domain').notNull(), // 'programming' | 'art' | 'life' — DB 제약 없는 자유 텍스트
    points: integer('points').notNull().default(0),
    useCount: integer('use_count').notNull().default(0),
    firstUsedAt: timestamp('first_used_at', { withTimezone: true }).notNull(), // is_first_time 판정 기준
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull(), // "오래 안 쓴 스킬 재등장" 판정
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.skillName] }),
    index('idx_userskill_recent').on(t.userId, t.lastUsedAt.desc()),
  ],
);

// ============================================================
// 6. 장기 기억
// ============================================================

export const memories = pgTable(
  'memories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    threadId: uuid('thread_id').references(() => threads.id),
    /** @deprecated experienceIds 로 옮겼다. 옛 행 조회용으로만 남는다. */
    experienceId: uuid('experience_id').references(() => experiences.id),
    /** 이 기억을 만든 경험들. 조건을 넘길 때마다 더해진다.
     *  갈래당 기억은 하나이고(uq_memories_thread), 여기에 쌓인다.
     *  배열이라 FK 를 못 건다 — 경험을 지우는 건 재구축뿐이고 그때 기억도
     *  함께 지워지므로 실무상 문제가 없다. */
    experienceIds: uuid('experience_ids').array().notNull().default([]),

    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    title: text('title').notNull(), // "첫 게임 출시"
    body: text('body').notNull(),
    importance: smallint('importance').notNull(),
    // 'new_skill' | 'thread_complete' | 'breakthrough' | 'deepened' | 'revival' | 'comeback'
    // DB 에 CHECK 는 없다(자유 텍스트). 값을 늘려도 마이그레이션이 필요 없지만
    // 목록은 여기서 관리한다 — experience-engine 의 trigger 선택과 짝이다.
    /** @deprecated triggers 로 옮겼다. */
    trigger: text('trigger').notNull(),
    /** 왜 남았는지 **전부**. 1월에 처음 써본 게 있었고(new_skill) 3월에 6건째가
     *  됐다면(deepened) 둘 다 사실이다. 화면은 방향·이심률에 값 하나가 필요하니
     *  읽을 때 가장 센 것을 고른다 — 저장은 전부, 선택은 읽을 때. */
    triggers: text('triggers').array().notNull().default([]),
    /** 배열이 늘어난 기억만 밤에 다시 요약한다. 세션 처리 중에 LLM 을 부르면
     *  "세션당 1회"가 깨지고 after() 안의 작업이 길어진다. */
    needsResummary: boolean('needs_resummary').notNull().default(false),

    refCount: integer('ref_count').notNull().default(0), // searchMemory 로 불려간 횟수
    lastReferencedAt: timestamp('last_referenced_at', { withTimezone: true }),
    forgottenAt: timestamp('forgotten_at', { withTimezone: true }), // Lv.80 망각. 삭제하지 않고 마킹
  },
  (t) => [
    index('idx_mem_user_time').on(t.userId, t.occurredAt.desc()).where(sql`${t.forgottenAt} is null`),
    // GIN 전문검색 인덱스. title || ' ' || body 표현식에 대한 함수형 인덱스.
    index('idx_mem_search').using('gin', sql`to_tsvector('simple', ${t.title} || ' ' || ${t.body})`),
  ],
);

// 망각 기준: importance 낮음 + ref_count 0 + 180일 경과
// 삭제가 아니라 forgotten_at 마킹. searchMemory 결과에서만 빠진다.
// 성능 최적화가 서사와 일치하는 지점.

// ============================================================
// 7. 성격 — 스냅샷
// ============================================================

export const personalitySnapshots = pgTable(
  'personality_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    computedAt: timestamp('computed_at', { withTimezone: true }).notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(), // 2주 이동평균 구간
    windowEnd: timestamp('window_end', { withTimezone: true }).notNull(),

    // 각 축 -100 ~ +100 (범위는 CHECK 로 강제하지 않음. 원본 DDL 도 강제하지 않는다)
    focusScatter: smallint('focus_scatter').notNull(), // 몰입형(+) ↔ 산만형(-)
    depthBreadth: smallint('depth_breadth').notNull(), // 집중형(+) ↔ 멀티형(-)
    finishExplore: smallint('finish_explore').notNull(), // 완결형(+) ↔ 탐색형(-)
    pioneerMaster: smallint('pioneer_master').notNull(), // 개척형(+) ↔ 숙련형(-)
    nightMorning: smallint('night_morning').notNull(), // 새벽형(+) ↔ 아침형(-)

    sampleSize: integer('sample_size').notNull(), // 근거 세션 수. 적으면 신뢰도 낮음
  },
  (t) => [index('idx_persona_user').on(t.userId, t.computedAt.desc())],
);

// 갱신이 아니라 append. compareSnapshot(t1, t2) 가 Lv.50 툴이다.
// 축 산출은 전부 sessions 에서 나온다. experiences 를 안 봐도 된다.
//   focus_scatter  = f(세션 평균 길이, scattered 태그 비율)
//   depth_breadth  = f(세션당 unique_domains)
//   finish_explore = f(threads completed / (completed + abandoned))
//   pioneer_master = f(is_first_time 비율)
//   night_morning  = f(started_at 시간대 분포)

// ============================================================
// 8. 일기 — 파생 테이블
// ============================================================

export const dailyLogs = pgTable(
  'daily_logs',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    logDate: date('log_date').notNull(), // DATE. 새벽 4시 기준 하루 (문자열 모드 — 아래 주석 참고)
    summary: text('summary').notNull(),
    learned: text('learned').array().default([]),
    emotion: text('emotion'),
    experienceIds: uuid('experience_ids').array().notNull(), // 재생성 근거
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
    promptVersion: smallint('prompt_version').notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.userId, t.logDate] })],
);

// date() 는 기본값(모드 미지정)이 문자열 모드다. "YYYY-MM-DD" 문자열로
// 주고받아 "새벽 4시 기준 하루"라는 서버 로컬 규칙에 타임존 변환이
// 끼어들지 않게 한다. SQL 컬럼 타입은 DDL 그대로 DATE.
//
// prompt_version 이 핵심. 프롬프트를 개선하면 과거 일기를 전부
// 재생성할 수 있다. experiences 가 불변이라 가능한 일.

// ============================================================
// 9. 대사 캐시
// ============================================================

export const dialogues = pgTable(
  'dialogues',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    slot: text('slot', { enum: DIALOGUE_SLOTS }).notNull(),
    text: text('text').notNull(), // CHECK char_length(text) <= 80 — 주석 참고
    sourceSessionId: uuid('source_session_id').references(() => sessions.id),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.slot] }),
    check('dialogues_slot_check', sql`${t.slot} in ('morning','afternoon','evening','night')`),
    check('dialogues_text_length_check', sql`char_length(${t.text}) <= 80`),
  ],
);

// 사이트/새 탭 진입 시 이 4행만 읽는다. LLM 호출 없음.
// CHECK 로 길이를 강제한다. 화면이 무너지는 것을 DB 레벨에서 막는 편이
// 프롬프트로 부탁하는 것보다 확실하다.

// ============================================================
// 10. 전송 실패 추적
// ============================================================

export const ingestFailures = pgTable('ingest_failures', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  sessionId: uuid('session_id'),
  reason: text('reason').notNull(),
  payload: jsonb('payload').$type<unknown>(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
});

// LLM 응답이 스키마 검증에 실패하면 여기 남긴다.
// 세션은 processed_at NULL 로 남아 재처리 대상이 된다.

// ------------------------------------------------------------
// LLM 원본 출력 — 튜닝용
//
// ingest_failures 가 "실패"만 남기는 탓에 성공한 판정의 근거가 어디에도
// 없었다. outcome 이 왜 explore 였는지 나중에 물으면, 세션을 다시 LLM 에
// 태우는 것 말고는 답할 방법이 없었다 — 그마저도 비교 대상인 이전 출력은
// 이미 experiences 로 가공된 뒤라 원본이 남아 있지 않았다.
// 여기에는 tool_use.input 을 가공 전 그대로 넣고, 모델과 프롬프트 버전을
// 함께 남겨 "v3 → v4 에서 stuck 이 나오기 시작했다" 같은 비교를 가능하게 한다.
// ------------------------------------------------------------

export const LLM_OUTPUT_KINDS = ['experience', 'daily_log', 'memory_resummary'] as const;
export type LlmOutputKind = (typeof LLM_OUTPUT_KINDS)[number];

export const llmOutputs = pgTable(
  'llm_outputs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: LLM_OUTPUT_KINDS }).notNull(),
    // kind 에 따라 하나만 채워진다. session_id 에 FK 를 걸지 않는 것은
    // ingest_failures 와 같은 이유 — 세션이 지워져도 판정 이력은 남아야 한다.
    sessionId: uuid('session_id'),
    logDate: date('log_date'),
    model: text('model').notNull(),
    promptVersion: smallint('prompt_version').notNull(),
    /** tool_use.input 원본. tool_use 블록 자체가 없었으면 null. */
    output: jsonb('output').$type<unknown>(),
    /** 'max_tokens' 면 잘린 출력이다 — 검증을 통과했더라도 내용이 반쪽이다. */
    stopReason: text('stop_reason'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    /** zod 검증 통과 여부. false 면 이 출력으로는 아무것도 만들어지지 않았다. */
    valid: boolean('valid').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_llm_outputs_session').on(t.sessionId).where(sql`${t.sessionId} is not null`),
    index('idx_llm_outputs_user_time').on(t.userId, t.createdAt.desc()),
    check('llm_outputs_kind_check', sql`${t.kind} in ('experience','daily_log')`),
  ],
);

// ============================================================
// 11. 사람 판단 (declared)
//
// supabase/migrations/20260806000002_corrections.sql 대응.
// experiences·dialogues·daily_logs 가 전부 LLM 생성물(inferred)이라,
// 사람의 판단이 시스템에 들어오는 유일한 통로다.
// ============================================================

/**
 * 교정 가능한 필드 — 이산값만 받는다. 자유 서술은 받지 않는다(사용자 결정).
 *
 * thread 만 성질이 다르다. 나머지 셋은 라벨이라 읽을 때 겹치면 되지만
 * 갈래는 관계(FK)라 experiences.thread_id 를 실제로 옮긴다. 후보 목록·
 * "최근:" 줄·경험 개수가 전부 thread_id 조인에서 나오므로, 겹쳐 읽기로만
 * 처리하면 조인 지점 하나만 빠뜨려도 교정이 아무 데도 안 쓰이는 라벨
 * 더미가 된다. (모델 출력, 사람 정답) 쌍은 corrections 행에 그대로 남는다.
 *
 * 한 번 넣었다 뺐다가 다시 넣었다 — 이유는
 * supabase/migrations/20260809000001_thread_correction_again.sql 에 있다.
 * 요약하면, 옮기기가 만드는 미정의 상태 다섯을 규칙 다섯 개가 아니라
 * 원칙 하나로 답했다: **기억은 발화한 사실이므로, 옮기기는 갈래 배정만
 * 바꾸고 기억 평가를 다시 돌리지 않는다.**
 */
export const CORRECTION_FIELDS = ['outcome', 'category', 'is_first_time', 'thread'] as const;
/** map — 지도에서 직접 고친 것. 캐릭터가 물어서(ask)도 일기에서(diary)도 아니다. */
export const CORRECTION_SOURCES = ['diary', 'ask', 'map'] as const;

/**
 * 캐릭터가 던진 질문. **침묵을 기록하기 위한 테이블**이다.
 *
 * answered_at 도 dismissed_at 도 NULL 이면 무응답 — "안 고쳤다"를 "맞다"로
 * 세면 데이터가 조용히 오염된다. 무응답은 대개 동의가 아니라 안 본 것이다.
 */
export const questions = pgTable(
  'questions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    experienceId: uuid('experience_id')
      .notNull()
      .references(() => experiences.id, { onDelete: 'cascade' }),

    field: text('field', { enum: CORRECTION_FIELDS }).notNull(),
    modelValue: text('model_value').notNull(),
    text: text('text').notNull(), // 캐릭터가 던진 문장

    askedAt: timestamp('asked_at', { withTimezone: true }).notNull().defaultNow(),
    answeredAt: timestamp('answered_at', { withTimezone: true }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }), // "모르겠어" — 침묵과 구분
  },
  (t) => [
    index('idx_questions_open').on(t.userId, t.askedAt.desc()),
    check('questions_field_check', sql`${t.field} in ('outcome','category','is_first_time','thread')`),
    unique('questions_unique_target').on(t.experienceId, t.field),
  ],
);

/**
 * 사람이 실제로 내린 판단. **append-only** — UPDATE 하지 않는다.
 *
 * 같은 필드를 두 번 고치면 두 행이 쌓이고 최신 행이 이긴다. 덮어쓰면
 * (모델 출력, 사람 정답) 쌍이 사라지는데, 학습에 필요한 건 정답이 아니라
 * 그 쌍이다. experiences 를 직접 UPDATE 하지 않는 이유도 같다 —
 * 그쪽은 불변이 설계 전제고 재처리(apply-reprocess)가 그 위에 서 있다.
 */
export const corrections = pgTable(
  'corrections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    experienceId: uuid('experience_id')
      .notNull()
      .references(() => experiences.id, { onDelete: 'cascade' }),

    field: text('field', { enum: CORRECTION_FIELDS }).notNull(),
    /** 모델이 냈던 값의 **사본**. 참조가 아니라 사본인 이유는 재처리로
     *  experiences 값이 바뀌어도 쌍이 보존돼야 하기 때문이다. */
    modelValue: text('model_value').notNull(),
    humanValue: text('human_value').notNull(),

    source: text('source', { enum: CORRECTION_SOURCES }).notNull(),
    questionId: uuid('question_id').references(() => questions.id, { onDelete: 'set null' }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_corrections_latest').on(t.experienceId, t.field, t.createdAt.desc()),
    index('idx_corrections_user_time').on(t.userId, t.createdAt.desc()),
    check('corrections_field_check', sql`${t.field} in ('outcome','category','is_first_time','thread')`),
    check('corrections_source_check', sql`${t.source} in ('diary','ask','map')`),
  ],
);

// ------------------------------------------------------------
// CHECK 제약 표현 방식 정리
//   sessions.close_reason / threads.status / experiences.outcome / dialogues.slot
//     → text({ enum: [...] }) 로 TS 유니온 타입까지 좁히고, check() 로 동일한
//       값 목록을 DB 레벨 제약으로도 남겼다 (이중 표현이지만 의도적).
//   dialogues.text 길이(<=80)
//     → check() 로 char_length 표현식을 그대로 옮겼다.
//   그 외 마이그레이션에 있는 CHECK 는 전부 위 목록으로 커버된다.
// ------------------------------------------------------------

// ============================================================
// 15. 되풀이한 절차 (procedures)
//
// supabase/migrations/20260809000002_procedures.sql 대응.
//
// 경험·갈래·기억과 **독립이다.** 세션의 조작 열에서 바로 뽑으며 해석 층을
// 거치지 않는다 — 갈래 부착이 실측 F1 54% 라 그 위에 얹으면 오류를 물려받고,
// 무엇보다 검증 방식이 다르다(갈래는 확인할 길이 없고 절차는 돌려보면 안다).
//
// 후보는 계산이고 이 표는 사람이 답한 것만 담는다.
// ============================================================

export const PROCEDURE_STATUSES = ['approved', 'rejected'] as const;
export type ProcedureStatus = (typeof PROCEDURE_STATUSES)[number];

export const procedures = pgTable(
  'procedures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** 열쇠들을 이은 것. 정규화 규칙이 바뀌면 값도 바뀌고, 그러면 거절했던
     *  후보가 목록에 다시 뜬다 — 한 번 더 거절하면 되는 정도로 본다. */
    signature: text('signature').notNull(),
    status: text('status', { enum: PROCEDURE_STATUSES }).notNull(),
    /** 사람이 지은 이름. 거절한 것은 없다. */
    name: text('name'),
    /** **승인 시점의 단계.** 이후 계산이 건드리지 않는다 — 매번 다시 계산하면
     *  승인한 뒤에 그 절차를 조금 다르게 한 번 하는 것만으로 스킬이 몰래
     *  바뀐다. 승인한 것과 도는 것이 달라지면 안 된다. */
    steps: jsonb('steps').notNull().default([]),
    /** 무언가를 바꾸는 조작이 있나. 사람 없이 돌려도 되는지의 기준이다 —
     *  읽기 전용은 최악이 헛수고고 바꾸는 것은 최악이 되돌릴 수 없다. */
    mutates: boolean('mutates').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_procedures_user_sig').on(t.userId, t.signature),
    index('idx_procedures_user').on(t.userId, t.createdAt.desc()),
    check('procedures_status_check', sql`${t.status} in ('approved','rejected')`),
  ],
);
