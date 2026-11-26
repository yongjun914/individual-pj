import { getCurrentUserId } from "@/lib/auth";
import { getActiveMemberships } from "@/lib/memberships";
import { createClient } from "@/lib/supabase/server";

import { schoolBrand, type SchoolBrand } from "./school-brand";

/** 로그인한 사용자의 (첫 번째) 학생회 학교에 맞는 표시. 로그인 전이거나 학생회가 없으면 기본. */
export async function getMySchoolBrand(): Promise<SchoolBrand> {
  try {
    const userId = await getCurrentUserId();
    if (!userId) return "default";
    const supabase = await createClient();
    const memberships = await getActiveMemberships(supabase, userId);
    return schoolBrand(memberships[0]?.terms.organizations.school_name);
  } catch {
    return "default";
  }
}
