"use server";

import { createHash, randomBytes } from "node:crypto";

import { refresh } from "next/cache";

import { requireUserId } from "@/lib/auth";
import { UUID } from "@/lib/expense-input";
import { createClient } from "@/lib/supabase/server";

export type IssueTokenResult = { ok: true; token: string } | { ok: false; error: string };

/** 웹훅 토큰 발급. 원문은 이 응답에서 한 번만 보여 주고, DB에는 해시만 저장한다. */
export async function issueWebhookToken(organizationId: string, label: string): Promise<IssueTokenResult> {
  if (!UUID.test(organizationId)) return { ok: false, error: "잘못된 요청입니다." };
  const trimmed = label.trim();
  if (trimmed.length > 50) return { ok: false, error: "이름은 50자 이내로 입력해 주세요." };

  const userId = await requireUserId("/settings/payments");
  const supabase = await createClient();

  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");

  const { error } = await supabase.from("webhook_tokens").insert({
    organization_id: organizationId,
    token_hash: tokenHash,
    label: trimmed,
    created_by: userId,
  });

  if (error) {
    console.error("웹훅 토큰 발급 실패", error);
    return { ok: false, error: "토큰을 만들지 못했어요. 올해의 총무만 만들 수 있어요." };
  }

  return { ok: true, token };
}

/** 웹훅 토큰 폐기 (되돌릴 수 없다) */
export async function revokeWebhookToken(tokenId: string): Promise<{ error: string } | null> {
  if (!UUID.test(tokenId)) return { error: "잘못된 요청입니다." };
  await requireUserId("/settings/payments");
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("webhook_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", tokenId)
    .is("revoked_at", null)
    .select("id");

  if (error || !data || data.length === 0) {
    if (error) console.error("웹훅 토큰 폐기 실패", error);
    return { error: "토큰을 폐기하지 못했어요." };
  }

  refresh();
  return null;
}
