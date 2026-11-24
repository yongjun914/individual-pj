"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export type CreateOrgState = {
  error?: string;
  fieldErrors?: Partial<Record<"schoolName" | "name" | "termName" | "role", string>>;
  values?: { schoolName: string; name: string; termName: string; role: string };
};

const ROLES = ["president", "vice_president", "treasurer"] as const;

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/** 학생회 생성: 학생회 + 첫 기수 + 내 역할 + 기본 카테고리를 한 번에 만든다. */
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
  if (!values.termName) fieldErrors.termName = "기수 이름을 입력해 주세요.";
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
  });

  if (error) {
    console.error("create_organization 실패", error);
    return { error: "학생회를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.", values };
  }

  redirect("/");
}
