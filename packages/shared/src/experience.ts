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

export const experienceOutputSchema = z.object({
  summary: z.string().min(1).max(100),
  detail: z.string().optional(),
  category: z.string(),
  outcome: z.enum(EXPERIENCE_OUTCOMES),
  is_first_time: z.boolean(),
  skills: z.array(experienceSkillSchema).max(10),
  dialogues: z.array(experienceDialogueSchema).min(3).max(4),
});

export type ExperienceOutput = z.infer<typeof experienceOutputSchema>;
