import { redirect } from "next/navigation";
import { Suspense } from "react";

import { requireUserId } from "@/lib/auth";
import { summarizeByTerm, type SummaryRow } from "@/lib/expenses";
import { getActiveMemberships } from "@/lib/memberships";
import { createClient } from "@/lib/supabase/server";

import { HomeView, type RecentExpense } from "./home-view";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-6 py-10">
      <Suspense fallback={<p className="text-zinc-500">불러오는 중…</p>}>
        <HomeContent />
      </Suspense>
    </main>
  );
}

async function HomeContent() {
  const userId = await requireUserId("/");
  const supabase = await createClient();

  const [memberships, { data: profile }] = await Promise.all([
    getActiveMemberships(supabase, userId),
    supabase.from("profiles").select("display_name").eq("id", userId).maybeSingle(),
  ]);

  // 속한 학생회가 없으면 학생회 만들기로
  if (memberships.length === 0) redirect("/onboarding");

  const termIds = memberships.map((m) => m.terms.id);
  const [{ data: recent }, { data: summaryRows }, { data: incomeRows }] = await Promise.all([
    supabase
      .from("expenses")
      .select("id, spent_on, merchant, amount, status, categories(name)")
      .in("term_id", termIds)
      .is("deleted_at", null)
      .order("spent_on", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(5)
      .overrideTypes<RecentExpense[], { merge: false }>(),
    supabase
      .from("expenses")
      .select("term_id, amount, status")
      .in("term_id", termIds)
      .is("deleted_at", null)
      .overrideTypes<SummaryRow[], { merge: false }>(),
    supabase.from("incomes").select("term_id, amount").in("term_id", termIds).is("deleted_at", null),
  ]);

  const summary = summarizeByTerm(summaryRows ?? []);
  const incomeTotals: Record<string, number> = {};
  for (const r of incomeRows ?? []) {
    incomeTotals[r.term_id as string] = (incomeTotals[r.term_id as string] ?? 0) + Number(r.amount);
  }
  const needsReceipt = (summaryRows ?? []).filter((r) => r.status === "needs_receipt").length;

  return (
    <HomeView
      displayName={profile?.display_name || null}
      memberships={memberships}
      summary={summary}
      incomeTotals={incomeTotals}
      recent={recent ?? []}
      needsReceipt={needsReceipt}
    />
  );
}
