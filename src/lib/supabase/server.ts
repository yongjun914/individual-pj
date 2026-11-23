import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { connection } from "next/server";

import { getSupabaseEnv } from "./env";

/** 서버 컴포넌트·서버 액션·Route Handler에서 쓰는 Supabase 클라이언트 */
export async function createClient() {
  // cookies()를 먼저 호출해야 빌드 시 미리 렌더링을 멈추고 요청 시점으로 미룬다.
  const cookieStore = await cookies();
  // 링크 미리 불러오기(partial prefetching)는 쿠키가 있는 상태로도 미리 렌더링한다.
  // 그때 Supabase가 토큰 만료 확인에 현재 시각(Date.now)을 써서 경고가 나므로, 실제 요청 시점에만 실행한다.
  await connection();
  const { url, publishableKey } = getSupabaseEnv();

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // 서버 컴포넌트에서는 쿠키를 쓸 수 없다. 세션 갱신은 proxy가 맡는다.
        }
      },
    },
  });
}
