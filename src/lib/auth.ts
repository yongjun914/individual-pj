import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

/** 로그인 후 돌아갈 경로를 검사한다. 외부 주소로 튀지 않게 사이트 안 경로만 허용. */
export function safeNextPath(value: unknown, fallback = "/") {
  if (typeof value !== "string") return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return fallback;
  }
  return value;
}

/** 현재 로그인한 사용자 id. 로그인하지 않았으면 null */
export async function getCurrentUserId() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims?.sub ?? null;
}

/** 로그인이 필요한 화면에서 사용. 로그인하지 않았으면 로그인 화면으로 보낸다. */
export async function requireUserId(nextPath = "/") {
  const userId = await getCurrentUserId();
  if (!userId) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  return userId;
}
