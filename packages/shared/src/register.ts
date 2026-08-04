// ============================================================
// POST /api/register 응답 스키마
//
// 확장이 익명으로 발급받는 users.extension_key 를 돌려준다.
// ============================================================

import { z } from 'zod';

export const registerResponseSchema = z.object({
  extension_key: z.string().min(20),
});

export type RegisterResponse = z.infer<typeof registerResponseSchema>;
