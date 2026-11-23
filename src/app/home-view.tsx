import Link from "next/link";

import { signOut } from "@/app/auth/actions";
import { ExpenseList, type ExpenseListItem } from "@/components/expense-list";
import type { TermSummary } from "@/lib/expenses";
import { formatWon } from "@/lib/format";
import type { ActiveMembership } from "@/lib/memberships";
import { roleLabel } from "@/lib/roles";

export type RecentExpense = ExpenseListItem;

/** 이번 기수 수입·지출·잔액 (결산내역서의 '예산액 - 총 집행액 = 잔액') */
function TermBalance({ income, expense, expenseCount }: { income: number; expense: number; expenseCount: number }) {
  const balance = income - expense;
  return (
    <dl className="grid grid-cols-3 gap-2 pt-3 text-center">
      <Link href="/incomes" className="rounded-xl bg-zinc-50 px-2 py-2 hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800">
        <dt className="text-xs text-zinc-500">수입</dt>
        <dd className="font-semibold text-green-700 dark:text-green-400">{formatWon(income)}</dd>
      </Link>
      <Link href="/expenses" className="rounded-xl bg-zinc-50 px-2 py-2 hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800">
        <dt className="text-xs text-zinc-500">지출 {expenseCount}건</dt>
        <dd className="font-semibold">{formatWon(expense)}</dd>
      </Link>
      <div className="rounded-xl bg-zinc-50 px-2 py-2 dark:bg-zinc-900">
        <dt className="text-xs text-zinc-500">잔액</dt>
        <dd className={`font-semibold ${balance < 0 ? "text-red-600" : ""}`}>{formatWon(balance)}</dd>
      </div>
    </dl>
  );
}

/** 홈 화면 표시 부분 (데이터는 page.tsx가 불러와 넘긴다) */
export function HomeView({
  displayName,
  memberships,
  summary,
  incomeTotals,
  recent,
  needsReceipt,
}: {
  displayName: string | null;
  memberships: ActiveMembership[];
  summary: Record<string, TermSummary>;
  incomeTotals: Record<string, number>;
  recent: RecentExpense[];
  needsReceipt: number;
}) {
  return (
    <>
      <header className="flex items-center justify-between">
        <p className="text-sm text-zinc-500">{displayName ? `${displayName}님` : "안녕하세요"}</p>
        <div className="flex items-center gap-4">
          <Link href="/settings" className="text-sm text-zinc-500 underline-offset-4 hover:underline">
            설정
          </Link>
          <form action={signOut}>
            <button type="submit" className="text-sm text-zinc-500 underline-offset-4 hover:underline">
              로그아웃
            </button>
          </form>
        </div>
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
            <TermBalance
              income={incomeTotals[m.terms.id] ?? 0}
              expense={summary[m.terms.id]?.total ?? 0}
              expenseCount={summary[m.terms.id]?.count ?? 0}
            />
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

      <div className="flex justify-center gap-4 text-sm text-zinc-500">
        {memberships.some((m) => m.role === "treasurer" || m.role === "president") && (
          <>
            <Link href="/audit" className="underline-offset-4 hover:underline">
              감사 준비
            </Link>
            <Link href="/settings/payments" className="underline-offset-4 hover:underline">
              결제 문자 연동
            </Link>
          </>
        )}
        <Link href="/onboarding" className="underline-offset-4 hover:underline">
          다른 학생회 만들기
        </Link>
      </div>
    </>
  );
}
