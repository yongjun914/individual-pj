export type MemberRole = "treasurer" | "president" | "member";

export const ROLE_LABELS: Record<MemberRole, string> = {
  treasurer: "총무",
  president: "회장",
  member: "집행부원",
};

export function roleLabel(role: string) {
  return ROLE_LABELS[role as MemberRole] ?? role;
}
