import 'server-only';

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// 서버 컴포넌트/서버 액션용 클라이언트.
// Lv.5 계정 연결(구글 OAuth) 이후 세션 쿠키 기반 조회에 쓴다.
export async function createServerSupabase() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // 서버 컴포넌트에서 호출되면 쓰기가 불가능하다. 미들웨어가 갱신을 담당.
          }
        },
      },
    },
  );
}
