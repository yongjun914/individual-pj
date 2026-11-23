import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { signOut } from "@/app/auth/actions";
import { requireUserId } from "@/lib/auth";
import { STATUS_LABELS, type ExpenseStatus } from "@/lib/expenses";
import { formatShortDate, formatWon } from "@/lib/format";
import { getActiveMemberships } from "@/lib/memberships";
import { roleLabel } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

type RecentExpense = {
  id: string;
  spent_on: string;
  merchant: string;
  amount: number;
  status: ExpenseStatus;
  categories: { name: string } | null;
};

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
  const [{ data: recent }, { count: needsReceipt }] = await Promise.all([
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
      .select("id", { count: "exact", head: true })
      .in("term_id", termIds)
      .is("deleted_at", null)
      .eq("status", "needs_receipt"),
  ]);

  return (
    <>
      <header className="flex items-center justify-between">
        <p className="text-sm text-zinc-500">
          {profile?.display_name ? `${profile.display_name}님` : "안녕하세요"}
        </p>
        <form action={signOut}>
          <button type="submit" className="text-sm text-zinc-500 underline-offset-4 hover:underline">
            로그아웃
          </button>
        </form>
      </header>

      <section className="space-y-3">
        {memberships.map((m) => (
          <div
            key={m.terms.id}
            className="space-y-1 rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800"
          >
            <p className="text-sm text-zinc-500">{m.terms.organizations.school_name}</p>
            <h1 className="text-xl font-semibold">{m.terms.organizations.name}</h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {m.terms.name} · {roleLabel(m.role)}
            </p>
          </div>
        ))}
      </section>

      <Link
        href="/expenses/new"
        className="flex h-14 items-center justify-center rounded-2xl bg-blue-600 text-lg font-semibold text-white hover:bg-blue-700"
      >
        + 지출 등록
      </Link>

      {needsReceipt ? (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          영수증이 필요한 지출이 <strong>{needsReceipt}건</strong> 있어요.
        </p>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-zinc-500">최근 지출</h2>
        {recent && recent.length > 0 ? (
          <ul className="divide-y divide-zinc-200 rounded-2xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {recent.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{e.merchant || "사용처 없음"}</p>
                  <p className="text-sm text-zinc-500">
                    {formatShortDate(e.spent_on)}
                    {e.categories ? ` · ${e.categories.name}` : ""}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-semibold">{formatWon(e.amount)}</p>
                  <p
                    className={`text-xs ${
                      e.status === "needs_receipt" ? "text-amber-600" : "text-zinc-500"
                    }`}
                  >
                    {STATUS_LABELS[e.status]}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700">
            아직 등록한 지출이 없어요.
          </p>
        )}
      </section>

      <Link href="/onboarding" className="text-center text-sm text-zinc-500 underline-offset-4 hover:underline">
        다른 학생회 만들기
      </Link>
    </>
  );
}
