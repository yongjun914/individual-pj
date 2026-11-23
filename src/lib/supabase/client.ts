import { createBrowserClient } from "@supabase/ssr";

import { getSupabaseEnv } from "./env";

/** 클라이언트 컴포넌트에서 쓰는 Supabase 클라이언트 */
export function createClient() {
  const { url, publishableKey } = getSupabaseEnv();
  return createBrowserClient(url, publishableKey);
}
