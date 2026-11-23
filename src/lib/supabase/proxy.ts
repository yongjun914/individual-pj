import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getSupabaseEnv, hasSupabaseEnv } from "./env";

/** 로그인 없이 볼 수 있는 경로 */
const PUBLIC_PATHS = ["/login", "/auth"];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** 요청마다 Supabase 로그인 세션(쿠키)을 갱신하고, 로그인 여부에 따라 화면을 보낸다. */
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
  const { data } = await supabase.auth.getClaims();
  const isLoggedIn = Boolean(data?.claims?.sub);
  const { pathname, search } = request.nextUrl;

  // 로그인 안 한 사용자가 보호된 화면에 오면 로그인으로 (다녀온 뒤 원래 화면으로 복귀)
  if (!isLoggedIn && !isPublicPath(pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    return redirectWithCookies(loginUrl, response);
  }

  // 이미 로그인했으면 로그인 화면 대신 홈으로
  if (isLoggedIn && pathname === "/login") {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = "/";
    homeUrl.search = "";
    return redirectWithCookies(homeUrl, response);
  }

  return response;
}

/** 리다이렉트할 때도 갱신된 세션 쿠키를 잃지 않게 옮겨 담는다. */
function redirectWithCookies(url: URL, from: NextResponse) {
  const redirect = NextResponse.redirect(url);
  from.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  return redirect;
}
