import type { SupabaseClient } from "@supabase/supabase-js";

import { UUID } from "@/lib/expense-input";
import type { ExpenseStatus, PaymentMethod } from "@/lib/expenses";
import type { MemberRole } from "@/lib/roles";

export type ExpenseDetail = {
  id: string;
  term_id: string;
  category_id: string | null;
  spent_on: string;
  merchant: string;
  amount: number;
  items: string;
  payment_method: PaymentMethod;
  status: ExpenseStatus;
  memo: string;
  missing_reason: string | null;
  payment_event_id: string | null;
  created_by: string | null;
  created_at: string;
  deleted_at: string | null;
  categories: { name: string } | null;
  terms: {
    id: string;
    name: string;
    is_active: boolean;
    organization_id: string;
    organizations: { name: string };
  };
};

/**
 * 지출 한 건과 내 권한을 불러온다. 볼 수 없거나 없는 지출이면 null.
 * 화면에서 버튼을 보일지 정하는 용도이고, 실제 권한은 DB(RLS)가 다시 검사한다.
 */
export async function getExpenseDetail(supabase: SupabaseClient, userId: string, expenseId: string) {
  if (!UUID.test(expenseId)) return null;

  const { data: expense } = await supabase
    .from("expenses")
    .select(
      "id, term_id, category_id, spent_on, merchant, amount, items, payment_method, status, memo, missing_reason, payment_event_id, created_by, created_at, deleted_at, categories(name), terms!inner(id, name, is_active, organization_id, organizations!inner(name))",
    )
    .eq("id", expenseId)
    .maybeSingle()
    .overrideTypes<ExpenseDetail, { merge: false }>();

  if (!expense) return null;

  const { data: membership } = await supabase
    .from("memberships")
    .select("role")
    .eq("term_id", expense.term_id)
    .eq("user_id", userId)
    .maybeSingle();

  const role = (membership?.role ?? null) as MemberRole | null;
  const isManager = role === "treasurer" || role === "president";
  const canEdit =
    expense.terms.is_active &&
    !expense.deleted_at &&
    (isManager || (role === "member" && expense.created_by === userId));

  return { expense, role, canEdit };
}
