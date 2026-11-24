import { isAdminRole } from "@/lib/roles";

/**
 * 기능별 권한. 기본으로 모두 허용이고, 관리자가 사람마다 해제할 수 있다.
 * (지출 등록과 본인 지출 수정은 권한과 관계없이 누구나 할 수 있다)
 * DB(has_term_permission)와 같은 규칙을 화면에서 버튼을 보일지 정할 때 쓴다.
 */
export const PERMISSIONS = ["expenses_all", "incomes", "events", "audit", "payments", "settings"] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<Permission, { label: string; description: string }> = {
  expenses_all: { label: "모든 지출 수정", description: "다른 사람이 등록한 지출도 고치거나 지울 수 있어요." },
  incomes: { label: "수입 관리", description: "이월액·학회비 같은 수입을 등록하고 고칠 수 있어요." },
  events: { label: "행사 관리", description: "행사를 만들고 참석 명단을 관리할 수 있어요." },
  audit: { label: "감사 자료", description: "감사 준비 화면과 지출 변경 이력을 볼 수 있어요." },
  payments: { label: "결제 문자 연동", description: "결제 문자 연동 토큰과 수신 기록을 관리할 수 있어요." },
  settings: { label: "학생회 설정", description: "학생회 정보와 행사 분류(지출 항목)를 바꿀 수 있어요." },
};

export type PermissionHolder = { role: string; revoked_permissions?: string[] | null };

/** 이 멤버십으로 이 기능을 쓸 수 있는지 */
export function can(m: PermissionHolder | null | undefined, permission: Permission) {
  if (!m) return false;
  if (isAdminRole(m.role)) return true;
  return !(m.revoked_permissions ?? []).includes(permission);
}

/** 여러 학생회 중 하나라도 이 기능을 쓸 수 있는지 */
export function canAny(ms: PermissionHolder[], permission: Permission) {
  return ms.some((m) => can(m, permission));
}
