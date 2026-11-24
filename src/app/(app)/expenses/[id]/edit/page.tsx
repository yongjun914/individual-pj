import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { Page } from "@/components/page";
import { requireUserId } from "@/lib/auth";
import { todayInSeoul } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { termOrgLabel } from "@/lib/terms";

import { ExpenseForm, type CategoryOption } from "../../new/expense-form";
import { getExpenseDetail } from "../data";

export const metadata: Metadata = { title: "지출 수정" };

export default function EditExpensePage({ params }: PageProps<"/expenses/[id]/edit">) {
  return (
    <Page width="narrow">
      <Suspense fallback={<p className="text-zinc-500">불러오는 중…</p>}>
        <EditContent params={params} />
      </Suspense>
    </Page>
  );
}

async function EditContent({ params }: { params: PageProps<"/expenses/[id]/edit">["params"] }) {
  const { id } = await params;
  const userId = await requireUserId(`/expenses/${id}/edit`);
  const supabase = await createClient();

  const detail = await getExpenseDetail(supabase, userId, id);
  if (!detail) notFound();
  // 고칠 수 없는 지출이면 상세 화면으로 (이유는 상세 화면에 나온다)
  if (!detail.canEdit) redirect(`/expenses/${id}`);
  const { expense } = detail;

  const { data: categories } = await supabase
    .from("categories")
    .select("id, term_id, name")
    .eq("term_id", expense.term_id)
    .order("sort_order")
    .overrideTypes<CategoryOption[], { merge: false }>();

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">지출 수정</h1>
        <Link href={`/expenses/${id}`} className="text-sm text-zinc-500 underline-offset-4 hover:underline">
          취소
        </Link>
      </div>
      <ExpenseForm
        terms={[{ id: expense.term_id, label: `${termOrgLabel(expense.terms.name, expense.terms.organizations.name)}` }]}
        categories={categories ?? []}
        today={todayInSeoul()}
        expense={{
          id: expense.id,
          termId: expense.term_id,
          spentOn: expense.spent_on,
          merchant: expense.merchant,
          amount: expense.amount,
          items: expense.items,
          paymentMethod: expense.payment_method,
          categoryId: expense.category_id ?? "",
          memo: expense.memo,
        }}
      />
    </>
  );
}
