"use server";

import { refresh } from "next/cache";

import { requireUserId } from "@/lib/auth";
import { UUID } from "@/lib/expense-input";
import { ROLE_OPTIONS, type MemberRole } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

export type RequestActionError = { error: string } | null;

/** DB 함수가 낸 한국어 안내는 그대로 보여 주고, 그 밖의 오류는 일반 문구로 */
function friendly(error: { message?: string } | null, fallback: string) {
  const message = error?.message ?? "";
  return /[가-힣]/.test(message) ? message : fallback;
}

/** 임원·부원·총무: 역할·직책 변경을 요청한다 (진행 중인 요청이 있으면 새 요청으로 바뀐다) */
export async function requestRoleChange(termId: string, role: string, position: string): Promise<RequestActionError> {
  if (!UUID.test(termId) || !ROLE_OPTIONS.includes(role as MemberRole)) return { error: "잘못된 요청입니다." };
  const trimmed = position.trim();
  if (trimmed.length > 50) return { error: "부서·직책은 50자 이내로 입력해 주세요." };

  await requireUserId("/me");
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_role_change", { p_term_id: termId, p_role: role, p_position: trimmed });
  if (error) {
    console.error("직책 변경 요청 실패", error);
    return { error: friendly(error, "요청하지 못했어요. 잠시 후 다시 시도해 주세요.") };
  }
  refresh();
  return null;
}

export async function cancelRoleRequest(requestId: string): Promise<RequestActionError> {
  if (!UUID.test(requestId)) return { error: "잘못된 요청입니다." };
  await requireUserId("/me");
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_role_request", { p_request_id: requestId });
  if (error) {
    console.error("직책 변경 요청 취소 실패", error);
    return { error: friendly(error, "요청을 취소하지 못했어요.") };
  }
  refresh();
  return null;
}

/** 학회장·부학회장: 요청을 승인하면 역할·직책이 바로 바뀐다 */
export async function decideRoleRequest(requestId: string, approve: boolean): Promise<RequestActionError> {
  if (!UUID.test(requestId)) return { error: "잘못된 요청입니다." };
  await requireUserId("/members");
  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_role_request", { p_request_id: requestId, p_approve: approve });
  if (error) {
    console.error("직책 변경 요청 처리 실패", error);
    return { error: friendly(error, "요청을 처리하지 못했어요.") };
  }
  refresh();
  return null;
}
