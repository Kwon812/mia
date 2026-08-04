// ============================================================
// POST /api/sessions 페이로드 검증 스키마
//
// sessions 테이블(supabase/migrations/20260804000001_init.sql) 1:1 대응.
// id 는 클라이언트(확장)가 생성한 UUID — 서버는 이 값을 그대로 PK 로 쓴다.
// ============================================================

import { z } from 'zod';

export const CLOSE_REASONS = ['idle', 'switch', 'maxlen', 'day', 'shutdown'] as const;

export const sessionPayloadSchema = z.object({
  id: z.uuid(),
  started_at: z.iso.datetime(),
  ended_at: z.iso.datetime(),
  duration_min: z.int().positive(),
  close_reason: z.enum(CLOSE_REASONS),
  // maxlen 절단 시 이전 세션. 재시도/최초 세션에는 없다.
  continued_from: z.uuid().nullable().optional(),
  primary_category: z.string().min(1),
  activity_score: z.int().min(0),
  unique_domains: z.int().min(1),
  switch_count: z.int().min(0).default(0),
  tags: z.array(z.string()).default([]), // 'scattered' 등
  compressed_log: z.unknown(), // LLM 입력 원본 JSONB. 형태를 여기서 강제하지 않는다
  domains: z.record(z.string(), z.number()), // { "github.com": 320, ... }
});

export type SessionPayload = z.infer<typeof sessionPayloadSchema>;
