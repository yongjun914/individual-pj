import { createClient } from "@supabase/supabase-js";

import { getSupabaseEnv } from "./env";

/**
 * 로그인 세션 없이 쓰는 서버용 Supabase 클라이언트 (웹훅처럼 쿠키가 없는 요청).
 * 공개 키만 쓰므로 RLS와 함수 권한이 그대로 적용된다.
 */
export function createAnonClient() {
  const { url, publishableKey } = getSupabaseEnv();
  return createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
