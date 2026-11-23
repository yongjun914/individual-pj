import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { requireUserId } from "@/lib/auth";
import { todayInSeoul } from "@/lib/format";
import { getActiveMemberships } from "@/lib/memberships";
import { createClient } from "@/lib/supabase/server";

import { ExpenseForm, type CategoryOption, type TermOption } from "./expense-form";

export const metadata: Metadata = { title: "지출 등록" };

export default function NewExpensePage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-6 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">지출 등록</h1>
        <Link href="/" className="text-sm text-zinc-500 underline-offset-4 hover:underline">
          취소
        </Link>
      </div>
      <Suspense fallback={<p className="text-zinc-500">불러오는 중…</p>}>
        <NewExpenseContent />
      </Suspense>
    </main>
  );
}

async function NewExpenseContent() {
  const userId = await requireUserId("/expenses/new");
  const supabase = await createClient();
  const memberships = await getActiveMemberships(supabase, userId);

  if (memberships.length === 0) redirect("/onboarding");

  const terms: TermOption[] = memberships.map((m) => ({
    id: m.terms.id,
    label: `${m.terms.organizations.name} · ${m.terms.name}`,
  }));

  const { data: categories } = await supabase
    .from("categories")
    .select("id, term_id, name")
    .in(
      "term_id",
      terms.map((t) => t.id),
    )
    .order("sort_order")
    .overrideTypes<CategoryOption[], { merge: false }>();

  return <ExpenseForm terms={terms} categories={categories ?? []} today={todayInSeoul()} />;
}
