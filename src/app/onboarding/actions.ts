"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

/** 이미 있는 같은 이름의 학생회 (만들기 전에 안내) */
export type SameOrganization = {
  id: string;
  schoolName: string;
  name: string;
  leader: string;
  createdOn: string;
  memberCount: number;
  isMember: boolean;
  requested: boolean;
};

export type CreateOrgState = {
  error?: string;
  fieldErrors?: Partial<Record<"schoolName" | "name" | "termName" | "role", string>>;
  values?: { schoolName: string; name: string; termName: string; role: string };
  duplicates?: SameOrganization[];
};

const ROLES = ["president", "vice_president"] as const;

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/** 학생회 생성: 학생회 + 첫 연도 + 내 역할 + 기본 카테고리를 한 번에 만든다. */
export async function createOrganization(
  _prev: CreateOrgState,
  formData: FormData,
): Promise<CreateOrgState> {
  const values = {
    schoolName: text(formData, "schoolName"),
    name: text(formData, "name"),
    termName: text(formData, "termName"),
    role: text(formData, "role"),
  };

  const fieldErrors: CreateOrgState["fieldErrors"] = {};
  if (!values.schoolName) fieldErrors.schoolName = "학교 이름을 입력해 주세요.";
  else if (values.schoolName.length > 100) fieldErrors.schoolName = "100자 이내로 입력해 주세요.";
  if (!values.name) fieldErrors.name = "학생회 이름을 입력해 주세요.";
  else if (values.name.length > 100) fieldErrors.name = "100자 이내로 입력해 주세요.";
  if (!values.termName) fieldErrors.termName = "연도를 입력해 주세요.";
  else if (values.termName.length > 50) fieldErrors.termName = "50자 이내로 입력해 주세요.";
  if (!ROLES.includes(values.role as (typeof ROLES)[number])) {
    fieldErrors.role = "역할을 골라 주세요.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { fieldErrors, values };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_organization", {
    p_school_name: values.schoolName,
    p_name: values.name,
    p_term_name: values.termName,
    p_my_role: values.role,
    p_allow_duplicate: formData.get("allowDuplicate") === "1",
  });

  // 같은 이름의 학생회가 이미 있으면: 만들지 않고 그 학생회를 보여 준다 (참여 요청 / 그래도 만들기)
  if (error && /같은 이름/.test(error.message)) {
    const { data } = await supabase.rpc("find_same_organizations", { p_school_name: values.schoolName, p_name: values.name });
    const duplicates = (
      (data ?? []) as {
        organization_id: string;
        school_name: string;
        name: string;
        leader: string;
        created_on: string;
        member_count: number;
        is_member: boolean;
        requested: boolean;
      }[]
    ).map((d) => ({
      id: d.organization_id,
      schoolName: d.school_name,
      name: d.name,
      leader: d.leader,
      createdOn: d.created_on,
      memberCount: d.member_count,
      isMember: d.is_member,
      requested: d.requested,
    }));
    return { values, duplicates };
  }

  if (error) {
    console.error("create_organization 실패", error);
    return { error: "학생회를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.", values };
  }

  redirect("/");
}
