import type { SupabaseClient } from "@supabase/supabase-js";

export type ActiveMembership = {
  role: string;
  terms: {
    id: string;
    name: string;
    organizations: { id: string; name: string; school_name: string };
  };
};

/** 내가 속한 학생회 중 '활성 기수'의 멤버십 목록 */
export async function getActiveMemberships(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("memberships")
    .select("role, terms!inner(id, name, organizations!inner(id, name, school_name))")
    .eq("user_id", userId)
    .eq("terms.is_active", true)
    .overrideTypes<ActiveMembership[], { merge: false }>();

  if (error) throw error;
  return data ?? [];
}
