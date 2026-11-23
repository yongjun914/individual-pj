/** Supabase 환경변수가 모두 설정되어 있는지 */
export function hasSupabaseEnv() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

/** Supabase 접속 정보. 설정되지 않았으면 에러를 던진다. */
export function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error(
      "Supabase 환경변수가 없습니다. .env.example을 복사해 .env.local을 만들고 값을 채워 주세요.",
    );
  }

  return { url, publishableKey };
}
