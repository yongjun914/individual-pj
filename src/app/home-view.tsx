import Link from "next/link";

import { signOut } from "@/app/auth/actions";
import { ExpenseList, type ExpenseListItem } from "@/components/expense-list";
import type { TermSummary } from "@/lib/expenses";
import { formatWon } from "@/lib/format";
import type { ActiveMembership } from "@/lib/memberships";
import { roleLabel } from "@/lib/roles";

export type RecentExpense = ExpenseListItem;

/** 홈 화면 표시 부분 (데이터는 page.tsx가 불러와 넘긴다) */
export function HomeView({
  displayName,
  memberships,
  summary,
  recent,
  needsReceipt,
}: {
  displayName: string | null;
  memberships: ActiveMembership[];
  summary: Record<string, TermSummary>;
  recent: RecentExpense[];
  needsReceipt: number;
}) {
  return (
    <>
      <header className="flex items-center justify-between">
        <p className="text-sm text-zinc-500">{displayName ? `${displayName}님` : "안녕하세요"}</p>
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
            <div className="flex items-baseline justify-between pt-3">
              <p className="text-sm text-zinc-500">이번 기수 지출</p>
              <p className="text-right">
                <span className="text-xl font-semibold">{formatWon(summary[m.terms.id]?.total ?? 0)}</span>
                <span className="ml-1 text-sm text-zinc-500">{summary[m.terms.id]?.count ?? 0}건</span>
              </p>
            </div>
          </div>
        ))}
      </section>

      <Link
        href="/expenses/new"
        className="flex h-14 items-center justify-center rounded-2xl bg-blue-600 text-lg font-semibold text-white hover:bg-blue-700"
      >
        + 지출 등록
      </Link>

      {needsReceipt > 0 && (
        <Link
          href="/expenses?receipt=missing"
          className="block rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-200 dark:hover:bg-amber-900"
        >
          영수증이 필요한 지출이 <strong>{needsReceipt}건</strong> 있어요. →
        </Link>
      )}

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-zinc-500">최근 지출</h2>
          <Link href="/expenses" className="text-sm text-blue-600 underline-offset-4 hover:underline">
            전체 보기
          </Link>
        </div>
        <ExpenseList items={recent} emptyText="아직 등록한 지출이 없어요." />
      </section>

      <Link href="/onboarding" className="text-center text-sm text-zinc-500 underline-offset-4 hover:underline">
        다른 학생회 만들기
      </Link>
    </>
  );
}
