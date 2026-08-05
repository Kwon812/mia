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
  // 상한이 있어야 한다. 없으면 컬럼 타입(SMALLINT/INT)을 넘긴 값이 zod 를
  // 통과해 DB 에서 numeric field overflow 로 터진다 — 400 이 아니라 500 이고
  // ingest_failures 행도 안 남아 추적이 안 된다.
  duration_min: z.int().positive().max(60 * 24), // 하루 이상은 있을 수 없다

  close_reason: z.enum(CLOSE_REASONS),
  // maxlen 절단 시 이전 세션. 재시도/최초 세션에는 없다.
  continued_from: z.uuid().nullable().optional(),
  primary_category: z.string().min(1).max(64),
  activity_score: z.int().min(0).max(2_000_000_000), // INT
  unique_domains: z.int().min(1).max(32_767), // SMALLINT
  switch_count: z.int().min(0).max(32_767).default(0), // SMALLINT
  tags: z.array(z.string().max(64)).max(32).default([]), // 'scattered' 등
  compressed_log: z.unknown(), // LLM 입력 원본 JSONB. 형태를 여기서 강제하지 않는다
  domains: z.record(z.string().max(253), z.number()), // { "github.com": 320, ... }
})
  // 구간 정합성. 없으면 미래 시각·역전된 구간이 그대로 저장돼, 2030년짜리
  // 경험이 매일 "오늘 세션"으로 뜨고 감정의 48시간 감쇠도 영원히 안 걸린다.
  .refine((p) => new Date(p.ended_at).getTime() > new Date(p.started_at).getTime(), {
    message: 'ended_at 이 started_at 보다 빠르다',
    path: ['ended_at'],
  })
  .refine((p) => new Date(p.started_at).getTime() < Date.now() + 60 * 60 * 1000, {
    message: 'started_at 이 미래다',
    path: ['started_at'],
  });

export type SessionPayload = z.infer<typeof sessionPayloadSchema>;
