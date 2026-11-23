import type { SupabaseClient } from "@supabase/supabase-js";

import { MAX_AMOUNT, PAYMENT_METHODS, type PaymentMethod } from "@/lib/expenses";

/** 지출 등록·수정 폼에서 서버로 보내는 값 */
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

export type ExpenseField = keyof ExpenseInput;
export type FieldErrors = Partial<Record<ExpenseField, string>>;

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 입력값 검사. 틀린 칸마다 안내 문구를 돌려준다. */
export function validateExpenseInput(input: ExpenseInput): FieldErrors {
  const e: FieldErrors = {};
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

/** 고른 행사가 같은 기수의 것인지 (미분류면 통과) */
export async function categoryBelongsToTerm(supabase: SupabaseClient, categoryId: string, termId: string) {
  if (!categoryId) return true;
  const { data } = await supabase
    .from("categories")
    .select("id")
    .eq("id", categoryId)
    .eq("term_id", termId)
    .maybeSingle();
  return Boolean(data);
}

/** DB에 저장할 칸으로 바꾼다 (기수·작성자 제외) */
export function toExpenseColumns(input: ExpenseInput) {
  return {
    spent_on: input.spentOn,
    merchant: input.merchant.trim(),
    amount: input.amount,
    items: input.items.trim(),
    payment_method: input.paymentMethod as PaymentMethod,
    category_id: input.categoryId || null,
    memo: input.memo.trim(),
  };
}
