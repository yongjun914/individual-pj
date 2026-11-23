"use server";

import { requireUserId } from "@/lib/auth";
import {
  categoryBelongsToTerm,
  toExpenseColumns,
  UUID,
  validateExpenseInput,
  type ExpenseInput,
  type FieldErrors,
} from "@/lib/expense-input";
import { MAX_RECEIPTS } from "@/lib/expenses";
import { createClient } from "@/lib/supabase/server";

export type CreateExpenseResult =
  | { ok: true; expenseId: string; organizationId: string; termId: string }
  | { ok: false; error?: string; fieldErrors?: FieldErrors };

/** 1단계: 지출을 '영수증 필요' 상태로 저장한다. 영수증 업로드는 브라우저가 이어서 한다. */
export async function createExpense(input: ExpenseInput): Promise<CreateExpenseResult> {
  const fieldErrors = validateExpenseInput(input);
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  const userId = await requireUserId("/expenses/new");
  const supabase = await createClient();

  const { data: term } = await supabase
    .from("terms")
    .select("id, organization_id, is_active")
    .eq("id", input.termId)
    .maybeSingle();

  if (!term || !term.is_active) {
    return { ok: false, error: "이 학생회의 현재 기수에 지출을 등록할 수 없습니다." };
  }

  if (!(await categoryBelongsToTerm(supabase, input.categoryId, input.termId))) {
    return { ok: false, fieldErrors: { categoryId: "행사를 다시 골라 주세요." } };
  }

  const { data, error } = await supabase
    .from("expenses")
    .insert({ term_id: input.termId, ...toExpenseColumns(input), created_by: userId })
    .select("id")
    .single();

  if (error || !data) {
    console.error("지출 등록 실패", error);
    return { ok: false, error: "지출을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }

  return { ok: true, expenseId: data.id, organizationId: term.organization_id, termId: term.id };
}

export type AttachResult = { ok: true } | { ok: false; error: string };

/** 2단계: 업로드된 영수증 파일을 지출에 연결하고, 한 장 이상이면 '완료'로 바꾼다. */
export async function attachReceipts(
  expenseId: string,
  organizationId: string,
  termId: string,
  paths: string[],
): Promise<AttachResult> {
  if (!UUID.test(expenseId) || !UUID.test(organizationId) || !UUID.test(termId)) {
    return { ok: false, error: "잘못된 요청입니다." };
  }
  if (paths.length === 0) return { ok: true };
  if (paths.length > MAX_RECEIPTS) return { ok: false, error: `영수증은 ${MAX_RECEIPTS}장까지 올릴 수 있습니다.` };

  // 이 지출 폴더 안의 파일만 연결한다.
  const prefix = `${organizationId}/${termId}/${expenseId}/`;
  if (!paths.every((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/"))) {
    return { ok: false, error: "잘못된 파일 경로입니다." };
  }

  const userId = await requireUserId("/expenses/new");
  const supabase = await createClient();

  // 이미 붙은 영수증과 합쳐 최대 장수를 넘지 않게
  const { count: existing } = await supabase
    .from("receipts")
    .select("id", { count: "exact", head: true })
    .eq("expense_id", expenseId);
  if ((existing ?? 0) + paths.length > MAX_RECEIPTS) {
    return { ok: false, error: `영수증은 ${MAX_RECEIPTS}장까지 붙일 수 있습니다.` };
  }

  const { error: insertError } = await supabase
    .from("receipts")
    .insert(paths.map((storage_path) => ({ expense_id: expenseId, storage_path, created_by: userId })));

  if (insertError) {
    console.error("영수증 연결 실패", insertError);
    return { ok: false, error: "영수증을 지출에 연결하지 못했습니다." };
  }

  // 사유서를 썼다가 영수증을 찾아 붙인 경우도 '완료'로 (사유는 변경 이력에 남는다)
  const { error: updateError } = await supabase
    .from("expenses")
    .update({ status: "complete", missing_reason: null })
    .eq("id", expenseId)
    .in("status", ["needs_receipt", "excused"]);

  if (updateError) {
    console.error("지출 상태 변경 실패", updateError);
    return { ok: false, error: "영수증은 올렸지만 상태를 바꾸지 못했습니다." };
  }

  return { ok: true };
}
