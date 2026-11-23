import { createClient } from "@supabase/supabase-js";

import { getSupabaseEnv } from "./env";

/**
 * 서비스 키(secret key)로 접속하는 서버 전용 클라이언트. RLS를 무시하므로 꼭 필요한 곳에서만 쓴다.
 * 지금은 카카오 '연결 해제' 웹훅에서만 쓴다. 키가 없으면 null.
 */
export function createServiceClient() {
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey) return null;
  const { url } = getSupabaseEnv();
  return createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
