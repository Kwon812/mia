// ============================================================
// Experience Engine LLM 출력 검증 스키마
//
// LLM 이 세션(compressed_log)을 요약해 내놓는 구조화 출력을 검증한다.
// 검증에 실패하면 ingest_failures 에 남기고 세션은 재처리 대상으로 남는다
// (supabase/migrations/20260804000001_init.sql 의 experiences/dialogues 참고).
// ============================================================

import { z } from 'zod';

export const EXPERIENCE_OUTCOMES = ['success', 'partial', 'stuck', 'explore'] as const;
export const DIALOGUE_SLOTS = ['morning', 'afternoon', 'evening', 'night'] as const;

const experienceSkillSchema = z.object({
  name: z.string(),
  weight: z.int().min(1).max(10),
});

const experienceDialogueSchema = z.object({
  slot: z.enum(DIALOGUE_SLOTS),
  text: z.string().max(80), // dialogues.text 의 CHECK char_length <= 80 과 동일
});

// thread 부착 판정 — 세션 종료 시 Experience Engine 안에서 함께 결정한다
// (계획서 11장 미결정 항목 확정: LLM 이 이미 컨텍스트를 보고 있어 호출이 늘지 않음).
//   action='attach' → existing_thread_id 는 프롬프트에 넘긴 활성 thread 목록 중 하나.
//                      LLM 환각으로 목록에 없는 id 를 낼 수 있으니 애플리케이션
//                      레벨에서 재검증 후 아니면 new 로 강등한다(이 스키마는 형태만 검증).
//   action='new'    → title 필수("Redis 캐싱 도입" 같은 작업명).
export const experienceThreadSchema = z.object({
  action: z.enum(['attach', 'new']),
  existing_thread_id: z.uuid().nullable(),
  title: z.string().min(1).nullable(),
  completed: z.boolean(),
});

export const experienceOutputSchema = z.object({
  summary: z.string().min(1).max(100),
  detail: z.string().optional(),
  category: z.string(),
  outcome: z.enum(EXPERIENCE_OUTCOMES),
  is_first_time: z.boolean(),
  skills: z.array(experienceSkillSchema).max(10),
  // 프롬프트는 4개(슬롯당 1개)를 요구하지만 검증은 1개부터 받는다 — 대사는
  // 캐시일 뿐이라, 개수 미달로 경험 전체를 버리는 것(llm_output_invalid)이
  // 더 큰 손실이다. 부족한 슬롯은 이전 대사가 남아있으면 그걸로 버틴다.
  dialogues: z.array(experienceDialogueSchema).min(1).max(4),
  thread: experienceThreadSchema,
});

export type ExperienceOutput = z.infer<typeof experienceOutputSchema>;
