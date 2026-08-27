// ============================================================
// Supabase 세션 갱신.
//
// **파일 이름이 proxy.ts 인 것에 이유가 있다.** Next 16 에서 middleware 는
// deprecated 되고 proxy 로 이름이 바뀌었다(node_modules/next/dist/docs 의
// 01-app/03-api-reference/03-file-conventions/middleware.md). 바깥의 Supabase
// SSR 예제는 전부 아직 middleware.ts 로 적혀 있으므로 그대로 옮겨오면 이
// 파일은 조용히 실행되지 않는다 — 세션이 만료되어도 갱신되지 않고, 로그인이
// 며칠 뒤에 저절로 풀리는 형태로만 드러난다.
//
// 하는 일은 하나다. 요청마다 토큰을 갱신하고 갱신된 쿠키를 응답에 실어 보낸다.
// 서버 컴포넌트는 쿠키를 쓸 수 없어서(lib/supabase/server.ts 의 setAll 주석)
// 이 자리가 아니면 갱신할 곳이 없다.
// ============================================================

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // 이 호출 자체가 갱신을 일으킨다. 반환값은 쓰지 않는다 — 누구인지 판단하는
  // 일은 getCurrentUser 가 하고, 여기서는 쿠키만 최신으로 만든다.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  // api 를 제외하는 이유: 확장이 부르는 경로다. 쿠키가 아예 없고 X-Extension-Key
  // 로만 식별되므로, 갱신할 세션이 없는데 매 요청 auth 서버를 한 번씩 더 치게 된다.
  // auth 도 제외한다 — 콜백은 자기가 직접 쿠키를 심는다.
  matcher: ['/((?!api|auth|_next/static|_next/image|favicon.ico).*)'],
};
