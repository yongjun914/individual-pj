"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { safeNextPath } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const PROVIDERS = ["google", "kakao"] as const;
type Provider = (typeof PROVIDERS)[number];

function isProvider(value: unknown): value is Provider {
  return PROVIDERS.includes(value as Provider);
}

/** 소셜 로그인 시작: 제공자 로그인 페이지로 보낸다. */
export async function signInWithProvider(formData: FormData) {
  const provider = formData.get("provider");
  const next = safeNextPath(formData.get("next"));

  if (!isProvider(provider)) {
    redirect("/login?error=provider");
  }

  const origin =
    (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });

  if (error || !data.url) {
    redirect(`/login?error=oauth&next=${encodeURIComponent(next)}`);
  }

  redirect(data.url);
}
