"use server";

import { requireUserId } from "@/lib/auth";
import { MAX_AMOUNT, MAX_RECEIPTS, PAYMENT_METHODS, type PaymentMethod } from "@/lib/expenses";
import { createClient } from "@/lib/supabase/server";

export type ExpenseInput = {
  termId: string;
  spentOn: string;
  merchant: string;
  amount: number;
  items: string;
  paymentMethod: string;
  categoryId: string;
  memo: string;
};

type Field = "termId" | "spentOn" | "merchant" | "amount" | "items" | "paymentMethod" | "categoryId" | "memo";

export type CreateExpenseResult =
  | { ok: true; expenseId: string; organizationId: string; termId: string }
  | { ok: false; error?: string; fieldErrors?: Partial<Record<Field, string>> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function validate(input: ExpenseInput) {
  const e: Partial<Record<Field, string>> = {};
  if (!UUID.test(input.termId)) e.termId = "학생회를 골라 주세요.";
  if (!ISO_DATE.test(input.spentOn) || Number.isNaN(Date.parse(input.spentOn))) {
    e.spentOn = "날짜를 확인해 주세요.";
  }
  if (!input.merchant.trim()) e.merchant = "사용처를 입력해 주세요.";
  else if (input.merchant.trim().length > 100) e.merchant = "100자 이내로 입력해 주세요.";
  if (!Number.isInteger(input.amount) || input.amount <= 0) e.amount = "금액을 입력해 주세요.";
  else if (input.amount > MAX_AMOUNT) e.amount = "금액이 너무 큽니다. 다시 확인해 주세요.";
  if (input.items.length > 500) e.items = "500자 이내로 입력해 주세요.";
  if (!PAYMENT_METHODS.includes(input.paymentMethod as PaymentMethod)) e.paymentMethod = "결제 수단을 골라 주세요.";
  if (input.categoryId && !UUID.test(input.categoryId)) e.categoryId = "행사를 다시 골라 주세요.";
  if (input.memo.length > 1000) e.memo = "1000자 이내로 입력해 주세요.";
  return e;
}

/** 1단계: 지출을 '영수증 필요' 상태로 저장한다. 영수증 업로드는 브라우저가 이어서 한다. */
export async function createExpense(input: ExpenseInput): Promise<CreateExpenseResult> {
  const fieldErrors = validate(input);
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

  const { data, error } = await supabase
    .from("expenses")
    .insert({
      term_id: input.termId,
      spent_on: input.spentOn,
      merchant: input.merchant.trim(),
      amount: input.amount,
      items: input.items.trim(),
      payment_method: input.paymentMethod,
      category_id: input.categoryId || null,
      memo: input.memo.trim(),
      created_by: userId,
    })
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

  const { error: insertError } = await supabase
    .from("receipts")
    .insert(paths.map((storage_path) => ({ expense_id: expenseId, storage_path, created_by: userId })));

  if (insertError) {
    console.error("영수증 연결 실패", insertError);
    return { ok: false, error: "영수증을 지출에 연결하지 못했습니다." };
  }

  const { error: updateError } = await supabase
    .from("expenses")
    .update({ status: "complete" })
    .eq("id", expenseId)
    .eq("status", "needs_receipt");

  if (updateError) {
    console.error("지출 상태 변경 실패", updateError);
    return { ok: false, error: "영수증은 올렸지만 상태를 바꾸지 못했습니다." };
  }

  return { ok: true };
}
