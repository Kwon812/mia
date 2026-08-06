// ============================================================
// Experience Engine LLM 출력 검증 스키마
//
// LLM 이 세션(compressed_log)을 요약해 내놓는 구조화 출력을 검증한다.
// 검증에 실패하면 ingest_failures 에 남기고 세션은 재처리 대상으로 남는다
// (supabase/migrations/20260804000001_init.sql 의 experiences/dialogues 참고).
// ============================================================

import { z } from 'zod';

/** 경험 카테고리. 확장의 도메인 사전(apps/extension/src/session/categories.ts)이
 *  정본이고 여기는 그 사본이다 — 확장은 @na/db 를 의존하지 않는다(drizzle 이
 *  번들에 딸려온다). 한쪽을 고치면 반드시 다른 쪽도 고친다.
 *  세션의 primary_category 와 같은 어휘를 써야 LLM 이 "도메인 사전이 찍은 값"과
 *  "내용으로 다시 판정한 값"을 같은 축에서 비교할 수 있다. */
export const EXPERIENCE_CATEGORIES = [
  'dev',
  'study',
  'docs',
  'ai',
  'search',
  'community',
  'entertainment',
  'music',
  'shopping',
  'productivity',
  'news',
  'finance',
  'etc',
] as const;
export type ExperienceCategory = (typeof EXPERIENCE_CATEGORIES)[number];


export const EXPERIENCE_OUTCOMES = ['success', 'partial', 'stuck', 'explore'] as const;
export const DIALOGUE_SLOTS = ['morning', 'afternoon', 'evening', 'night'] as const;

const experienceSkillSchema = z.object({
  name: z.string(),
  weight: z.int().min(1).max(10),
});

/** 대사 길이 상한. dialogues.text 의 DB CHECK(char_length <= 80)와 같은 값이고,
 *  화면(하단 2줄)이 그 상한의 이유다. */
export const MAX_DIALOGUE_LEN = 80;

/**
 * 문장 경계에서 자른다. 대사(80자)와 요약(100자) 둘 다 이 규칙을 쓴다.
 *
 * 그냥 slice 하면 한복판에서 끊겨 화면에 그대로 드러난다 — 실측:
 *   "…threads 테이블들을 살펴봤어. 아"
 *   "…Figma, ZEP, Notion, ChatGPT 등을 오가면서 전체 "
 * 모델은 "80자 이내"라고 지시해도 105자를 낸다(실측 4개 중 3개 초과). 길이를
 * 지키게 하는 것보다 자르는 쪽을 고치는 게 확실하다.
 *
 * 상한 안쪽 마지막 문장부호까지만 남기고, 그게 너무 앞이면(문장이 하나도
 * 안 끝났으면) 마지막 어절에서 끊고 말줄임표를 붙인다.
 */
export function clampSentence(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;

  const head = t.slice(0, max);
  const lastSentence = Math.max(head.lastIndexOf('.'), head.lastIndexOf('!'), head.lastIndexOf('?'));
  // 절반은 넘겨야 문장으로 읽힌다. 너무 앞에서 끝나면 내용이 통째로 사라진다.
  if (lastSentence >= max * 0.5) return head.slice(0, lastSentence + 1).trim();

  const lastSpace = head.lastIndexOf(' ');
  const cut = lastSpace >= max * 0.5 ? head.slice(0, lastSpace) : head.slice(0, max - 1);
  return `${cut.trim()}…`;
}

const experienceDialogueSchema = z.object({
  slot: z.enum(DIALOGUE_SLOTS),
  // **자르면 될 것을 폐기 사유로 삼지 않는다.** 예전에는 .max(80) 이라
  // 대사 한 줄이 81자면 zod 가 출력 전체를 반려했고, 멀쩡한 summary·category·
  // outcome·skills·thread 까지 통째로 버려져 그 세션은 경험이 되지 못했다
  // (실측: 2026-08-05 14:07 세션, ingest_failures 의 too_big/maximum:80).
  //
  // 진짜 제약은 dialogues.text 의 DB CHECK(char_length <= 80) 이고, 엔진이
  // INSERT 직전에 clampDialogue 로 이미 만족시킨다 — 검증이 그보다 앞서 도는
  // 바람에 자를 기회조차 없이 폐기됐던 것이다. 여기서 잘라 넘긴다.
  //
  // 대사는 파이프라인에서 가장 안 중요한 값이다(LLM 창작물이고 슬롯당 1행씩
  // 덮어써진다). 그게 가장 중요한 값을 죽이면 안 된다.
  text: z.string().transform((s) => clampSentence(s, MAX_DIALOGUE_LEN)),
});

// thread 부착 판정 — 세션 종료 시 Experience Engine 안에서 함께 결정한다
// (계획서 11장 미결정 항목 확정: LLM 이 이미 컨텍스트를 보고 있어 호출이 늘지 않음).
//   action='attach' → existing_thread_id 는 프롬프트에 넘긴 활성 thread 목록 중 하나.
//                      LLM 환각으로 목록에 없는 id 를 낼 수 있으니 애플리케이션
//                      레벨에서 재검증 후 아니면 new 로 강등한다(이 스키마는 형태만 검증).
//   action='new'    → title 필수("Redis 캐싱 도입" 같은 작업명).
export const experienceThreadSchema = z.object({
  action: z.enum(['attach', 'new']),
  // 형태만 본다. z.uuid() 로 조이면 LLM 이 "thread-1" 같은 걸 냈을 때 스키마
  // 단계에서 실패해 경험 전체가 폐기된다 — 바로 위 주석이 약속한 "new 로 강등"
  // 경로에 도달조차 못 한다. 실제 존재 여부는 엔진이 목록과 대조한다.
  existing_thread_id: z.string().max(64).nullable(),
  title: z.string().min(1).nullable(),
  completed: z.boolean(),
});

export const experienceOutputSchema = z.object({
  // 상한은 넉넉히 두고 초과분은 엔진이 자른다. 101자라고 경험 전체를 버리는
  // 것은 손실이 너무 크다 — 이 파일이 dialogues 에서 이미 그렇게 판단했다.
  summary: z.string().min(1).max(600),
  detail: z.string().optional(),
  category: z.enum(EXPERIENCE_CATEGORIES),
  outcome: z.enum(EXPERIENCE_OUTCOMES),
  is_first_time: z.boolean(),
  // 툴 스키마에 maxItems 가 없어 strict:true 도 개수를 못 막는다. 넘치면
  // 엔진의 dedupeSkills 가 합치고 앞에서부터 자른다.
  skills: z.array(experienceSkillSchema).max(40),
  // 프롬프트는 4개(슬롯당 1개)를 요구하지만 검증은 **개수를 강제하지 않는다** —
  // 대사는 캐시일 뿐이라, 개수 미달로 경험 전체를 버리는 것(llm_output_invalid)이
  // 더 큰 손실이다. 부족한 슬롯은 이전 대사가 남아있으면 그걸로 버틴다.
  // 예전에 min(3) 이었다가 min(1) 로 완화한 이력이 있는데(2026-08-04 실패),
  // 0개일 때도 같은 논리가 그대로 성립하므로 하한을 아예 없앤다.
  dialogues: z.array(experienceDialogueSchema).max(16),
  thread: experienceThreadSchema,
});

export type ExperienceOutput = z.infer<typeof experienceOutputSchema>;
