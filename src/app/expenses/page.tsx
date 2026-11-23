import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ExpenseList, type ExpenseListItem } from "@/components/expense-list";
import { requireUserId } from "@/lib/auth";
import { countsTowardTotal } from "@/lib/expenses";
import { formatWon } from "@/lib/format";
import { getActiveMemberships } from "@/lib/memberships";
import { createClient } from "@/lib/supabase/server";

import {
  hasActiveFilter,
  parseFilters,
  RECEIPT_FILTER_LABELS,
  RECEIPT_FILTER_STATUS,
  RECEIPT_FILTERS,
  UNCATEGORIZED,
  type ExpenseFilters,
} from "./filters";

export const metadata: Metadata = { title: "지출 목록" };

/** 한 번에 불러오는 최대 건수 (Supabase 기본 상한) */
const MAX_ROWS = 1000;

const fieldClass =
  "h-11 w-full rounded-xl border border-zinc-300 bg-white px-3 text-base outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 dark:border-zinc-700 dark:bg-zinc-900";

type Category = { id: string; term_id: string; name: string };

export default function ExpensesPage({ searchParams }: PageProps<"/expenses">) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-6 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">지출 목록</h1>
        <Link href="/" className="text-sm text-zinc-500 underline-offset-4 hover:underline">
          홈
        </Link>
      </div>
      <Suspense fallback={<p className="text-zinc-500">불러오는 중…</p>}>
        <ExpensesContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function ExpensesContent({ searchParams }: { searchParams: PageProps<"/expenses">["searchParams"] }) {
  const filters = parseFilters(await searchParams);
  const userId = await requireUserId("/expenses");
  const supabase = await createClient();
  const memberships = await getActiveMemberships(supabase, userId);

  if (memberships.length === 0) redirect("/onboarding");

  const allTermIds = memberships.map((m) => m.terms.id);
  // 내가 속하지 않은 기수 id가 들어오면 무시
  const termIds = filters.term && allTermIds.includes(filters.term) ? [filters.term] : allTermIds;

  const { data: categories } = await supabase
    .from("categories")
    .select("id, term_id, name")
    .in("term_id", allTermIds)
    .order("sort_order")
    .overrideTypes<Category[], { merge: false }>();

  let query = supabase
    .from("expenses")
    .select("id, spent_on, merchant, amount, status, categories(name)")
    .in("term_id", termIds)
    .is("deleted_at", null);

  if (filters.from) query = query.gte("spent_on", filters.from);
  if (filters.to) query = query.lte("spent_on", filters.to);
  if (filters.category === UNCATEGORIZED) query = query.is("category_id", null);
  else if (filters.category) query = query.eq("category_id", filters.category);
  if (filters.receipt !== "all") query = query.eq("status", RECEIPT_FILTER_STATUS[filters.receipt]);

  const { data, error } = await query
    .order("spent_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS)
    .overrideTypes<ExpenseListItem[], { merge: false }>();

  if (error) throw error;
  const expenses = data ?? [];
  const counted = expenses.filter((e) => countsTowardTotal(e.status));
  const total = counted.reduce((sum, e) => sum + e.amount, 0);

  const multiTerm = memberships.length > 1;
  const termName = (termId: string) => {
    const m = memberships.find((x) => x.terms.id === termId);
    return m ? m.terms.organizations.name : "";
  };
  const categoryOptions = (categories ?? []).filter((c) => termIds.includes(c.term_id));

  return (
    <>
      <FilterForm
        filters={filters}
        terms={multiTerm ? memberships.map((m) => ({ id: m.terms.id, label: `${m.terms.organizations.name} · ${m.terms.name}` })) : []}
        categories={categoryOptions.map((c) => ({
          id: c.id,
          label: multiTerm && termIds.length > 1 ? `${termName(c.term_id)} · ${c.name}` : c.name,
        }))}
      />

      <section className="flex items-baseline justify-between rounded-2xl bg-zinc-100 px-5 py-4 dark:bg-zinc-900">
        <p className="text-sm text-zinc-500">합계 {counted.length}건</p>
        <p className="text-xl font-semibold">{formatWon(total)}</p>
      </section>

      {counted.length < expenses.length ? (
        <p className="-mt-4 text-xs text-zinc-500">결제 취소된 지출은 합계에서 뺐어요.</p>
      ) : null}

      {expenses.length >= MAX_ROWS ? (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          지출이 너무 많아 최근 {MAX_ROWS}건만 보여요. 기간을 좁혀 주세요.
        </p>
      ) : null}

      <ExpenseList
        items={expenses}
        emptyText={hasActiveFilter(filters) ? "조건에 맞는 지출이 없어요." : "아직 등록한 지출이 없어요."}
      />

      <Link
        href="/expenses/new"
        className="flex h-12 items-center justify-center rounded-2xl bg-blue-600 font-semibold text-white hover:bg-blue-700"
      >
        + 지출 등록
      </Link>
    </>
  );
}

type Option = { id: string; label: string };

function FilterForm({ filters, terms, categories }: { filters: ExpenseFilters; terms: Option[]; categories: Option[] }) {
  return (
    <Form action="/expenses" className="space-y-3 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
      {terms.length > 0 ? (
        <label className="block space-y-1">
          <span className="text-sm text-zinc-500">학생회</span>
          <select name="term" defaultValue={filters.term ?? ""} className={fieldClass}>
            <option value="">전체</option>
            {terms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <label className="block space-y-1">
          <span className="text-sm text-zinc-500">시작일</span>
          <input type="date" name="from" defaultValue={filters.from ?? ""} className={fieldClass} />
        </label>
        <label className="block space-y-1">
          <span className="text-sm text-zinc-500">종료일</span>
          <input type="date" name="to" defaultValue={filters.to ?? ""} className={fieldClass} />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="block space-y-1">
          <span className="text-sm text-zinc-500">행사</span>
          <select name="category" defaultValue={filters.category ?? ""} className={fieldClass}>
            <option value="">전체</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
            <option value={UNCATEGORIZED}>미분류</option>
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-sm text-zinc-500">영수증</span>
          <select name="receipt" defaultValue={filters.receipt} className={fieldClass}>
            {RECEIPT_FILTERS.map((r) => (
              <option key={r} value={r}>
                {RECEIPT_FILTER_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          className="h-11 flex-1 rounded-xl bg-zinc-900 font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          조회
        </button>
        {hasActiveFilter(filters) ? (
          <Link href="/expenses" className="text-sm text-zinc-500 underline-offset-4 hover:underline">
            초기화
          </Link>
        ) : null}
      </div>
    </Form>
  );
}
