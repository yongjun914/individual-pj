"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import { requireUserId } from "@/lib/auth";
import {
  categoryBelongsToTerm,
  toExpenseColumns,
  UUID,
  validateExpenseInput,
  type ExpenseInput,
  type FieldErrors,
} from "@/lib/expense-input";
import { createClient } from "@/lib/supabase/server";

export type UpdateExpenseResult = { ok: true } | { ok: false; error?: string; fieldErrors?: FieldErrors };

const NO_PERMISSION = "이 지출을 고칠 권한이 없거나, 이미 끝난 연도의 지출입니다.";

/** 지출 내용 수정. 연도·작성자·상태는 바꾸지 않는다. */
export async function updateExpense(expenseId: string, input: ExpenseInput): Promise<UpdateExpenseResult> {
  if (!UUID.test(expenseId)) return { ok: false, error: "잘못된 요청입니다." };
  const fieldErrors = validateExpenseInput(input);
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  await requireUserId(`/expenses/${expenseId}/edit`);
  const supabase = await createClient();

  const { data: expense } = await supabase
    .from("expenses")
    .select("id, term_id, deleted_at")
    .eq("id", expenseId)
    .maybeSingle();
  if (!expense || expense.deleted_at) return { ok: false, error: "지출을 찾을 수 없습니다." };

  if (!(await categoryBelongsToTerm(supabase, input.categoryId, expense.term_id))) {
    return { ok: false, fieldErrors: { categoryId: "행사를 다시 골라 주세요." } };
  }

  const { data, error } = await supabase
    .from("expenses")
    .update(toExpenseColumns(input))
    .eq("id", expenseId)
    .is("deleted_at", null)
    .select("id");

  if (error) {
    console.error("지출 수정 실패", error);
    return { ok: false, error: "지출을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
  // RLS에 막히면 에러 없이 0건이 된다.
  if (!data || data.length === 0) return { ok: false, error: NO_PERMISSION };

  return { ok: true };
}

export type ActionState = { error: string } | null;

/** 지출 삭제 (기록은 남기고 deleted_at만 채운다) */
export async function deleteExpense(expenseId: string): Promise<ActionState> {
  if (!UUID.test(expenseId)) return { error: "잘못된 요청입니다." };
  await requireUserId(`/expenses/${expenseId}`);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("expenses")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", expenseId)
    .is("deleted_at", null)
    .select("id");

  if (error) {
    console.error("지출 삭제 실패", error);
    return { error: "지출을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
  if (!data || data.length === 0) return { error: NO_PERMISSION };

  redirect("/expenses");
}

/** 사유서 최소·최대 길이 */
const REASON_MIN = 10;
const REASON_MAX = 1000;

/**
 * 영수증 분실 사유서 작성·수정 (F-11). 영수증이 한 장도 없는 지출만 '사유서' 상태로 바꾼다.
 * 감사 출력에서 영수증 대신 이 사유가 들어간다.
 */
export async function submitMissingReason(expenseId: string, reason: string): Promise<ActionState> {
  if (!UUID.test(expenseId)) return { error: "잘못된 요청입니다." };
  const text = reason.trim();
  if (text.length < REASON_MIN) return { error: `사유를 ${REASON_MIN}자 이상 적어 주세요.` };
  if (text.length > REASON_MAX) return { error: `${REASON_MAX}자 이내로 적어 주세요.` };

  await requireUserId(`/expenses/${expenseId}`);
  const supabase = await createClient();

  const { count } = await supabase
    .from("receipts")
    .select("id", { count: "exact", head: true })
    .eq("expense_id", expenseId);
  if ((count ?? 0) > 0) return { error: "영수증이 붙어 있는 지출은 사유서를 쓸 수 없어요." };

  const { data, error } = await supabase
    .from("expenses")
    .update({ status: "excused", missing_reason: text })
    .eq("id", expenseId)
    .in("status", ["needs_receipt", "excused"])
    .is("deleted_at", null)
    .select("id");

  if (error) {
    console.error("사유서 저장 실패", error);
    return { error: "사유서를 저장하지 못했어요. 잠시 후 다시 시도해 주세요." };
  }
  if (!data || data.length === 0) return { error: NO_PERMISSION };

  refresh();
  return null;
}

/** 사유서 취소: 다시 '영수증 필요'로 되돌린다 (영수증을 찾은 경우 등) */
export async function withdrawMissingReason(expenseId: string): Promise<ActionState> {
  if (!UUID.test(expenseId)) return { error: "잘못된 요청입니다." };
  await requireUserId(`/expenses/${expenseId}`);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("expenses")
    .update({ status: "needs_receipt", missing_reason: null })
    .eq("id", expenseId)
    .eq("status", "excused")
    .select("id");

  if (error) {
    console.error("사유서 취소 실패", error);
    return { error: "사유서를 취소하지 못했어요." };
  }
  if (!data || data.length === 0) return { error: NO_PERMISSION };

  refresh();
  return null;
}

/** 영수증 한 장 삭제. 마지막 장을 지우면 지출을 '영수증 필요'로 되돌린다. */
export async function deleteReceipt(receiptId: string): Promise<ActionState> {
  if (!UUID.test(receiptId)) return { error: "잘못된 요청입니다." };
  await requireUserId("/expenses");
  const supabase = await createClient();

  const { data: deleted, error } = await supabase
    .from("receipts")
    .delete()
    .eq("id", receiptId)
    .select("expense_id, storage_path");

  if (error) {
    console.error("영수증 삭제 실패", error);
    return { error: "영수증을 삭제하지 못했습니다." };
  }
  const receipt = deleted?.[0];
  if (!receipt) return { error: "영수증을 삭제할 권한이 없습니다." };

  const { error: storageError } = await supabase.storage.from("receipts").remove([receipt.storage_path]);
  if (storageError) console.error("영수증 파일 삭제 실패(기록은 삭제됨)", receipt.storage_path, storageError);

  const { count } = await supabase
    .from("receipts")
    .select("id", { count: "exact", head: true })
    .eq("expense_id", receipt.expense_id);

  if ((count ?? 0) === 0) {
    await supabase
      .from("expenses")
      .update({ status: "needs_receipt" })
      .eq("id", receipt.expense_id)
      .eq("status", "complete");
  }

  refresh();
  return null;
}
