/**
 * 학생회 안 역할.
 *   관리자(학회장·부학회장·총무): 모든 기능 + 학생회원 관리
 *   임원(부장·차장)·부원: 기본으로 모든 기능, 관리자가 기능별로 해제할 수 있다
 */
export type MemberRole = "president" | "vice_president" | "treasurer" | "officer" | "member";

export const ROLE_LABELS: Record<MemberRole, string> = {
  president: "학회장",
  vice_president: "부학회장",
  treasurer: "총무",
  officer: "임원(부장·차장)",
  member: "부원",
};

/** 화면에서 고를 수 있는 순서 */
export const ROLE_OPTIONS: MemberRole[] = ["president", "vice_president", "treasurer", "officer", "member"];

/** 학생회원 관리를 할 수 있는 역할 */
export const ADMIN_ROLES: MemberRole[] = ["president", "vice_president", "treasurer"];

export function roleLabel(role: string) {
  return ROLE_LABELS[role as MemberRole] ?? role;
}

export function isAdminRole(role: string) {
  return ADMIN_ROLES.includes(role as MemberRole);
}
