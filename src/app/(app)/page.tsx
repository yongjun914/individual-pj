import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Page } from "@/components/page";
import { requireUserId } from "@/lib/auth";
import { summarizeByTerm, type SummaryRow } from "@/lib/expenses";
import { getActiveMemberships } from "@/lib/memberships";
import { can } from "@/lib/permissions";
import { isAdminRole } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

import { HomeView, type GuideState, type RecentExpense } from "./home-view";

export default function Home() {
  return (
    <Page>
      <Suspense fallback={<p className="text-zinc-500">불러오는 중…</p>}>
        <HomeContent />
      </Suspense>
    </Page>
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
  const primary = memberships[0];

  const [{ data: recent }, { data: summaryRows }, { data: incomeRows }, { count: memberCount }, { count: tokenCount }] =
    await Promise.all([
      supabase
        .from("expenses")
        .select("id, spent_on, merchant, amount, status, categories(name)")
        .in("term_id", termIds)
        .is("deleted_at", null)
        .order("spent_on", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(8)
        .overrideTypes<RecentExpense[], { merge: false }>(),
      supabase
        .from("expenses")
        .select("term_id, amount, status")
        .in("term_id", termIds)
        .is("deleted_at", null)
        .overrideTypes<SummaryRow[], { merge: false }>(),
      supabase.from("incomes").select("term_id, amount").in("term_id", termIds).is("deleted_at", null),
      supabase.from("memberships").select("id", { count: "exact", head: true }).eq("term_id", primary.terms.id),
      // 결제 연동 권한이 있어야 결과가 나온다 (RLS)
      supabase
        .from("webhook_tokens")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", primary.terms.organizations.id)
        .is("revoked_at", null),
    ]);

  const summary = summarizeByTerm(summaryRows ?? []);
  const incomeTotals: Record<string, number> = {};
  for (const r of incomeRows ?? []) {
    incomeTotals[r.term_id as string] = (incomeTotals[r.term_id as string] ?? 0) + Number(r.amount);
  }
  const needsReceipt = (summaryRows ?? []).filter((r) => r.status === "needs_receipt").length;

  // 시작 가이드: 대표 학생회(첫 번째) 기준
  const primaryRows = (summaryRows ?? []).filter((r) => r.term_id === primary.terms.id);
  const guide: GuideState = {
    canIncome: can(primary, "incomes"),
    canAudit: can(primary, "audit"),
    canPayments: can(primary, "payments"),
    canSettings: can(primary, "settings"),
    isAdmin: isAdminRole(primary.role),
    hasIncome: (incomeRows ?? []).some((r) => r.term_id === primary.terms.id),
    hasExpense: primaryRows.length > 0,
    receiptsDone: primaryRows.length > 0 && primaryRows.every((r) => r.status !== "needs_receipt"),
    hasMembers: (memberCount ?? 0) > 1,
    hasPaymentLink: (tokenCount ?? 0) > 0,
  };

  return (
    <HomeView
      displayName={profile?.display_name || null}
      memberships={memberships}
      summary={summary}
      incomeTotals={incomeTotals}
      recent={recent ?? []}
      needsReceipt={needsReceipt}
      guide={guide}
    />
  );
}
