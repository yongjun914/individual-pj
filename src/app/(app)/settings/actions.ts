"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import { requireUserId } from "@/lib/auth";
import { UUID } from "@/lib/expense-input";
import { unlinkKakaoUser } from "@/lib/kakao";
import { PERMISSIONS, type Permission } from "@/lib/permissions";
import { ADMIN_ROLES, ROLE_OPTIONS, type MemberRole } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

/** 실패하면 안내 문구, 성공하면 null */
export type ActionError = { error: string } | null;

const ROLES: MemberRole[] = ROLE_OPTIONS;
const MANAGER_ROLES: MemberRole[] = ADMIN_ROLES;
const NO_PERMISSION = "권한이 없어요. 학회장·부학회장에게 권한을 요청해 주세요.";

const isRole = (v: unknown): v is MemberRole => ROLES.includes(v as MemberRole);

/** update/delete가 RLS에 막히면 에러 없이 0건이라, 바뀐 행이 있는지로 판단한다 */
function affected(data: unknown[] | null) {
  return Boolean(data && data.length > 0);
}

// ---------------------------------------------------------------------
// 학생회 정보
// ---------------------------------------------------------------------

export async function updateOrganization(orgId: string, schoolName: string, name: string): Promise<ActionError> {
  if (!UUID.test(orgId)) return { error: "잘못된 요청입니다." };
  const school = schoolName.trim();
  const org = name.trim();
  if (!school || school.length > 100) return { error: "학교 이름을 1~100자로 입력해 주세요." };
  if (!org || org.length > 100) return { error: "학생회 이름을 1~100자로 입력해 주세요." };

  await requireUserId("/settings");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .update({ school_name: school, name: org })
    .eq("id", orgId)
    .select("id");
  if (error) console.error("학생회 정보 수정 실패", error);
  if (error || !affected(data)) return { error: NO_PERMISSION };

  refresh();
  return null;
}

// ---------------------------------------------------------------------
// 초대 링크
// ---------------------------------------------------------------------

export type CreateInvitationResult = { ok: true; token: string } | { ok: false; error: string };

export async function createInvitation(termId: string, role: string): Promise<CreateInvitationResult> {
  if (!UUID.test(termId) || !isRole(role)) return { ok: false, error: "잘못된 요청입니다." };

  const userId = await requireUserId("/settings");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invitations")
    .insert({ term_id: termId, role, created_by: userId })
    .select("token")
    .single();

  if (error || !data) {
    console.error("초대 링크 생성 실패", error);
    return { ok: false, error: "초대 링크를 만들지 못했어요. 학회장·부학회장만 만들 수 있어요." };
  }

  refresh();
  return { ok: true, token: data.token as string };
}

export async function revokeInvitation(invitationId: string): Promise<ActionError> {
  if (!UUID.test(invitationId)) return { error: "잘못된 요청입니다." };
  await requireUserId("/settings");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invitations")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", invitationId)
    .is("revoked_at", null)
    .select("id");
  if (error) console.error("초대 링크 폐기 실패", error);
  if (error || !affected(data)) return { error: "초대 링크를 폐기하지 못했어요." };

  refresh();
  return null;
}

// ---------------------------------------------------------------------
// 멤버
// ---------------------------------------------------------------------

export type MemberAccess = { role: string; position: string; revoked: string[] };

/**
 * 학생회원 관리: 역할·부서/직책·기능 권한을 한 번에 바꾼다 (학회장·부학회장·총무만, DB에서도 검사).
 * 내 역할은 바꿀 수 없다 (관리 권한을 잃지 않게). 내 직책 이름은 바꿀 수 있다.
 */
export async function updateMemberAccess(membershipId: string, access: MemberAccess): Promise<ActionError> {
  if (!UUID.test(membershipId) || !isRole(access.role)) return { error: "잘못된 요청입니다." };
  const position = access.position.trim();
  if (position.length > 50) return { error: "부서·직책은 50자 이내로 입력해 주세요." };
  const revoked = [...new Set(access.revoked)].filter((p): p is Permission => PERMISSIONS.includes(p as Permission));

  const userId = await requireUserId("/members");
  const supabase = await createClient();

  const { data: target } = await supabase.from("memberships").select("user_id, role").eq("id", membershipId).maybeSingle();
  if (!target) return { error: "멤버를 찾을 수 없어요." };
  if (target.user_id === userId && target.role !== access.role) {
    return { error: "내 역할은 바꿀 수 없어요. 다른 학회장·부학회장에게 부탁해 주세요." };
  }

  const { data, error } = await supabase
    .from("memberships")
    .update({ role: access.role, position, revoked_permissions: revoked })
    .eq("id", membershipId)
    .select("id");
  if (error) console.error("멤버 권한 변경 실패", error);
  if (error || !affected(data)) return { error: "학생회원 관리는 학회장·부학회장만 할 수 있어요." };

  refresh();
  return null;
}

export async function removeMember(membershipId: string): Promise<ActionError> {
  if (!UUID.test(membershipId)) return { error: "잘못된 요청입니다." };
  const userId = await requireUserId("/settings");
  const supabase = await createClient();

  const { data: target } = await supabase.from("memberships").select("user_id").eq("id", membershipId).maybeSingle();
  if (!target) return { error: "멤버를 찾을 수 없어요." };
  if (target.user_id === userId) return { error: "나 자신은 내보낼 수 없어요." };

  const { data, error } = await supabase.from("memberships").delete().eq("id", membershipId).select("id");
  if (error) console.error("멤버 내보내기 실패", error);
  if (error || !affected(data)) return { error: NO_PERMISSION };

  refresh();
  return null;
}

// ---------------------------------------------------------------------
// 행사 카테고리
// ---------------------------------------------------------------------

function checkCategoryName(name: string) {
  const n = name.trim();
  if (!n) return { error: "행사 이름을 입력해 주세요." };
  if (n.length > 50) return { error: "50자 이내로 입력해 주세요." };
  return null;
}

/** 같은 이름이 있으면 DB 고유 제약(23505)에 걸린다 */
function categoryError(error: { code?: string } | null) {
  if (error?.code === "23505") return { error: "같은 이름의 행사가 이미 있어요." };
  return { error: NO_PERMISSION };
}

export async function addCategory(termId: string, name: string): Promise<ActionError> {
  if (!UUID.test(termId)) return { error: "잘못된 요청입니다." };
  const invalid = checkCategoryName(name);
  if (invalid) return invalid;

  await requireUserId("/settings");
  const supabase = await createClient();
  const { data: last } = await supabase
    .from("categories")
    .select("sort_order")
    .eq("term_id", termId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase
    .from("categories")
    .insert({ term_id: termId, name: name.trim(), sort_order: (last?.sort_order ?? 0) + 10 });
  if (error) {
    console.error("행사 추가 실패", error);
    return categoryError(error);
  }

  refresh();
  return null;
}

export async function renameCategory(categoryId: string, name: string): Promise<ActionError> {
  if (!UUID.test(categoryId)) return { error: "잘못된 요청입니다." };
  const invalid = checkCategoryName(name);
  if (invalid) return invalid;

  await requireUserId("/settings");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .update({ name: name.trim() })
    .eq("id", categoryId)
    .select("id");
  if (error) console.error("행사 이름 변경 실패", error);
  if (error || !affected(data)) return categoryError(error);

  refresh();
  return null;
}

/** 행사 삭제. 이 행사로 분류된 지출은 '미분류'가 된다(DB에서 자동). */
export async function deleteCategory(categoryId: string): Promise<ActionError> {
  if (!UUID.test(categoryId)) return { error: "잘못된 요청입니다." };
  await requireUserId("/settings");
  const supabase = await createClient();
  const { data, error } = await supabase.from("categories").delete().eq("id", categoryId).select("id");
  if (error) console.error("행사 삭제 실패", error);
  if (error || !affected(data)) return { error: NO_PERMISSION };

  refresh();
  return null;
}

/** 행사 순서를 한 칸 옮긴다 (이웃과 sort_order를 맞바꾼다) */
export async function moveCategory(categoryId: string, direction: "up" | "down"): Promise<ActionError> {
  if (!UUID.test(categoryId)) return { error: "잘못된 요청입니다." };
  await requireUserId("/settings");
  const supabase = await createClient();

  const { data: current } = await supabase
    .from("categories")
    .select("id, term_id, sort_order")
    .eq("id", categoryId)
    .maybeSingle();
  if (!current) return { error: "행사를 찾을 수 없어요." };

  const { data: all } = await supabase
    .from("categories")
    .select("id, sort_order")
    .eq("term_id", current.term_id)
    .order("sort_order")
    .order("name");
  const list = all ?? [];
  const idx = list.findIndex((c) => c.id === categoryId);
  const swapWith = list[direction === "up" ? idx - 1 : idx + 1];
  if (idx < 0 || !swapWith) return null;

  // 순서 값이 같으면 맞바꿔도 그대로라 10 단위로 다시 매긴다
  const reordered = [...list];
  reordered.splice(idx, 1);
  reordered.splice(direction === "up" ? idx - 1 : idx + 1, 0, list[idx]);
  for (const [i, c] of reordered.entries()) {
    const sortOrder = (i + 1) * 10;
    if (c.sort_order === sortOrder) continue;
    const { error } = await supabase.from("categories").update({ sort_order: sortOrder }).eq("id", c.id);
    if (error) {
      console.error("행사 순서 변경 실패", error);
      return { error: NO_PERMISSION };
    }
  }

  refresh();
  return null;
}

// ---------------------------------------------------------------------
// 기수 전환
// ---------------------------------------------------------------------

export type StartTermResult = { ok: true; carried: number } | { ok: false; error: string };

/**
 * 새 기수 시작: 지금 기수를 닫고(읽기 전용) 새 기수를 연다. 카테고리는 함께 옮겨진다.
 * 고른 멤버는 같은 역할로 새 기수에 넣는다 (나머지는 새 초대 링크로 들어와야 한다).
 */
export async function startNewTerm(
  orgId: string,
  termName: string,
  myRole: string,
  carryMembershipIds: string[],
): Promise<StartTermResult> {
  const name = termName.trim();
  if (!UUID.test(orgId)) return { ok: false, error: "잘못된 요청입니다." };
  if (!name || name.length > 50) return { ok: false, error: "새 기수 이름을 1~50자로 입력해 주세요." };
  if (!MANAGER_ROLES.includes(myRole as MemberRole)) return { ok: false, error: "새 기수에서 내 역할은 학회장·부학회장·총무 중 하나여야 해요." };
  if (!carryMembershipIds.every((id) => UUID.test(id))) return { ok: false, error: "잘못된 요청입니다." };

  const userId = await requireUserId("/settings");
  const supabase = await createClient();

  // 옮길 멤버는 전환 전에 읽어 둔다 (지금 기수의 멤버만)
  const { data: oldTerm } = await supabase
    .from("terms")
    .select("id")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .maybeSingle();
  if (!oldTerm) return { ok: false, error: "현재 기수를 찾을 수 없어요." };

  const { data: carry } =
    carryMembershipIds.length > 0
      ? await supabase
          .from("memberships")
          .select("user_id, role")
          .eq("term_id", oldTerm.id)
          .in("id", carryMembershipIds)
      : { data: [] };

  const { data: newTermId, error } = await supabase.rpc("start_new_term", {
    p_org_id: orgId,
    p_term_name: name,
    p_my_role: myRole,
  });
  if (error || !newTermId) {
    console.error("기수 전환 실패", error);
    return { ok: false, error: "기수를 전환하지 못했어요. 학회장·부학회장만 할 수 있어요." };
  }

  const rows = (carry ?? [])
    .filter((m) => m.user_id !== userId)
    .map((m) => ({ term_id: newTermId as string, user_id: m.user_id, role: m.role }));

  if (rows.length > 0) {
    const { error: carryError } = await supabase.from("memberships").insert(rows);
    if (carryError) {
      console.error("멤버 옮기기 실패", carryError);
      return { ok: false, error: "새 기수는 만들었지만 멤버를 옮기지 못했어요. 초대 링크로 다시 초대해 주세요." };
    }
  }

  refresh();
  return { ok: true, carried: rows.length };
}

// ---------------------------------------------------------------------
// 내 정보
// ---------------------------------------------------------------------

export async function updateMyName(displayName: string): Promise<ActionError> {
  const name = displayName.trim();
  if (!name || name.length > 50) return { error: "이름을 1~50자로 입력해 주세요." };
  const userId = await requireUserId("/settings");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .update({ display_name: name })
    .eq("id", userId)
    .select("id");
  if (error || !affected(data)) {
    if (error) console.error("이름 변경 실패", error);
    return { error: "이름을 저장하지 못했어요." };
  }
  refresh();
  return null;
}

// ---------------------------------------------------------------------
// 회원 탈퇴
// ---------------------------------------------------------------------

/**
 * 회원 탈퇴: 계정과 개인정보(이름·이메일·카카오 연결)를 지운다.
 * 학생회 회계 기록(지출·수입·영수증·이력)은 감사 때문에 남고, 작성자만 비워진다.
 */
export async function deleteMyAccount(confirmText: string): Promise<ActionError> {
  if (confirmText.trim() !== "탈퇴") return { error: "확인을 위해 '탈퇴'라고 입력해 주세요." };

  await requireUserId("/settings");
  const supabase = await createClient();
  const { data: kakaoUserId, error } = await supabase.rpc("delete_my_account");

  if (error) {
    console.error("회원 탈퇴 실패", error);
    // 유일한 총무·회장이라 막힌 경우는 DB가 준 안내를 그대로 보여 준다
    return { error: error.message.includes("유일한") ? error.message : "탈퇴하지 못했어요. 잠시 후 다시 시도해 주세요." };
  }

  if (typeof kakaoUserId === "string" && kakaoUserId) {
    await unlinkKakaoUser(kakaoUserId);
  }

  // 계정은 이미 지워졌으니 이 기기의 로그인 쿠키만 정리한다
  await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  redirect("/login?notice=deleted");
}
