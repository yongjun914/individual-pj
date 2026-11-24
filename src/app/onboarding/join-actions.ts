"use server";

import { refresh } from "next/cache";

import { requireUserId } from "@/lib/auth";
import { UUID } from "@/lib/expense-input";
import { createClient } from "@/lib/supabase/server";

export type FoundOrganization = { id: string; schoolName: string; name: string; termName: string; requested: boolean };

/** DB 함수가 낸 한국어 안내는 그대로, 그 밖은 일반 문구로 */
function friendly(error: { message?: string } | null, fallback: string) {
  const message = error?.message ?? "";
  return /[가-힣]/.test(message) ? message : fallback;
}

/** 학생회 찾기: 학교·학생회 이름에 검색어(2자 이상)가 들어간 곳. 이미 멤버인 곳은 빠진다. */
export async function searchOrganizations(query: string): Promise<{ ok: true; items: FoundOrganization[] } | { ok: false; error: string }> {
  const q = query.trim();
  if (q.length < 2) return { ok: false, error: "학교나 학생회 이름을 2글자 이상 입력해 주세요." };
  if (q.length > 50) return { ok: false, error: "검색어가 너무 길어요." };

  await requireUserId("/onboarding");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_organizations", { p_query: q });
  if (error) {
    console.error("학생회 찾기 실패", error);
    return { ok: false, error: "학생회를 찾지 못했어요. 잠시 후 다시 시도해 주세요." };
  }
  const items = ((data ?? []) as { organization_id: string; school_name: string; name: string; term_name: string; requested: boolean }[]).map(
    (r) => ({ id: r.organization_id, schoolName: r.school_name, name: r.name, termName: r.term_name, requested: r.requested }),
  );
  return { ok: true, items };
}

/** 참여 요청 보내기 (진행 중인 요청이 있으면 메시지만 바뀐다) */
export async function requestJoin(orgId: string, message: string): Promise<{ error: string } | null> {
  if (!UUID.test(orgId)) return { error: "잘못된 요청입니다." };
  if (message.trim().length > 200) return { error: "남길 말은 200자 이내로 써 주세요." };
  await requireUserId("/onboarding");
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_join", { p_org_id: orgId, p_message: message.trim() });
  if (error) {
    console.error("참여 요청 실패", error);
    return { error: friendly(error, "요청을 보내지 못했어요. 잠시 후 다시 시도해 주세요.") };
  }
  refresh();
  return null;
}

export async function cancelJoinRequest(requestId: string): Promise<{ error: string } | null> {
  if (!UUID.test(requestId)) return { error: "잘못된 요청입니다." };
  await requireUserId("/onboarding");
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_join_request", { p_request_id: requestId });
  if (error) {
    console.error("참여 요청 취소 실패", error);
    return { error: friendly(error, "요청을 취소하지 못했어요.") };
  }
  refresh();
  return null;
}
