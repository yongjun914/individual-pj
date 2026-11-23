import { NextResponse, type NextRequest } from "next/server";

import { safeNextPath } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/** 소셜 로그인 후 돌아오는 곳: 인증 코드를 세션으로 바꾸고 원래 가려던 곳으로 보낸다. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, origin));
    }
  }

  const loginUrl = new URL("/login", origin);
  loginUrl.searchParams.set("error", "callback");
  loginUrl.searchParams.set("next", next);
  return NextResponse.redirect(loginUrl);
}
