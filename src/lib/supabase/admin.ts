import 'server-only';

import { createClient } from '@supabase/supabase-js';

// service_role 클라이언트 — API 라우트(확장 수신부) 전용.
// 확장은 Supabase Auth 가 아니라 익명 extension_key 로 식별되므로
// 모든 쓰기는 이 클라이언트로 서버에서만 수행한다. RLS 를 우회한다.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}
