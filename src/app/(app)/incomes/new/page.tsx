import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Page } from "@/components/page";
import { can } from "@/lib/permissions";
import { requireUserId } from "@/lib/auth";
import { todayInSeoul } from "@/lib/format";
import { getActiveMemberships } from "@/lib/memberships";
import { createClient } from "@/lib/supabase/server";
import { termOrgLabel } from "@/lib/terms";

import { IncomeForm } from "../income-form";

export const metadata: Metadata = { title: "수입 등록" };

export default function NewIncomePage() {
  return (
    <Page width="narrow">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">수입 등록</h1>
        <Link href="/incomes" className="text-sm text-zinc-500 underline-offset-4 hover:underline">
          취소
        </Link>
      </div>
      <Suspense fallback={<p className="text-zinc-500">불러오는 중…</p>}>
        <NewIncomeContent />
      </Suspense>
    </Page>
  );
}

async function NewIncomeContent() {
  const userId = await requireUserId("/incomes/new");
  const supabase = await createClient();
  const memberships = await getActiveMemberships(supabase, userId);
  if (memberships.length === 0) redirect("/onboarding");

  const managed = memberships.filter((m) => can(m, "incomes"));
  if (managed.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700">
        수입 관리 권한이 없어요. 학회장·부학회장에게 권한을 요청해 주세요.
      </p>
    );
  }

  return (
    <IncomeForm
      terms={managed.map((m) => ({ id: m.terms.id, label: `${termOrgLabel(m.terms.name, m.terms.organizations.name)}` }))}
      today={todayInSeoul()}
    />
  );
}
