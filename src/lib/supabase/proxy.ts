import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getSupabaseEnv, hasSupabaseEnv } from "./env";

/** 요청마다 Supabase 로그인 세션(쿠키)을 갱신한다. */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  // 환경변수가 아직 없으면(초기 세팅 단계) 세션 처리를 건너뛴다.
  if (!hasSupabaseEnv()) return response;

  const { url, publishableKey } = getSupabaseEnv();

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // createServerClient와 getClaims 사이에 다른 코드를 넣지 않는다(세션이 끊길 수 있음).
  await supabase.auth.getClaims();

  return response;
}
