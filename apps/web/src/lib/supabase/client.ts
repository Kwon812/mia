'use client';

import { createBrowserClient } from '@supabase/ssr';

// 브라우저 클라이언트. RLS 가 전부 잠겨 있으므로 직접 테이블 접근은 불가하고
// 인증(OAuth) 플로우 용도로만 쓴다. 데이터는 항상 서버 API 를 경유한다.
export function createBrowserSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
