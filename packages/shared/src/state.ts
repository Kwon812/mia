// ============================================================
// GET /api/state 응답 스키마
//
// 새 탭/사이트 진입 시 조회하는 캐릭터 홈 화면 데이터.
// emotion 은 감정 파생 계산(후속 작업)이 붙기 전까지 항상 null 이다.
// ============================================================

import { z } from 'zod';
import { EXPERIENCE_OUTCOMES, DIALOGUE_SLOTS } from './experience';

export const stateCharacterSchema = z.object({
  name: z.string().nullable(),
  level: z.number().int(),
  experience_count: z.number().int(),
  skill_count: z.number().int(),
  memory_count: z.number().int(),
  days_together: z.number().int(),
});

export const stateDialogueSchema = z.object({
  slot: z.enum(DIALOGUE_SLOTS),
  text: z.string(),
});

export const stateSessionSchema = z.object({
  id: z.uuid(),
  started_at: z.iso.datetime(),
  ended_at: z.iso.datetime(),
  duration_min: z.number().int(),
  primary_category: z.string(),
  activity_score: z.number().int(),
  tags: z.array(z.string()),
});

export const stateExperienceSchema = z.object({
  id: z.uuid(),
  occurred_at: z.iso.datetime(),
  summary: z.string(),
  outcome: z.enum(EXPERIENCE_OUTCOMES).nullable(),
  is_first_time: z.boolean(),
});

export const stateResponseSchema = z.object({
  character: stateCharacterSchema,
  emotion: z.null(), // 감정 파생 계산은 후속 작업 — 자리만 잡아둔다
  dialogues: z.array(stateDialogueSchema),
  today: z.object({
    sessions: z.array(stateSessionSchema),
    experiences: z.array(stateExperienceSchema),
  }),
});

export type StateResponse = z.infer<typeof stateResponseSchema>;
