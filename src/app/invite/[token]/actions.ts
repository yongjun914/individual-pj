"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

/** 초대 수락: 해당 연도의 멤버가 되고 홈으로 이동 */
export async function acceptInvitation(formData: FormData) {
  const token = formData.get("token");
  if (typeof token !== "string" || !token) redirect("/");

  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_invitation", { p_token: token });

  if (error) {
    console.error("accept_invitation 실패", error);
    redirect(`/invite/${encodeURIComponent(token)}?error=1`);
  }

  redirect("/");
}
