import Link from "next/link";

import { STATUS_LABELS, type ExpenseStatus } from "@/lib/expenses";
import { formatShortDate, formatWon } from "@/lib/format";

export type ExpenseListItem = {
  id: string;
  spent_on: string;
  merchant: string;
  amount: number;
  status: ExpenseStatus;
  categories: { name: string } | null;
};

/** 지출 목록 (홈 최근 지출, 지출 목록 화면에서 같이 쓴다). 누르면 상세 화면으로 간다. */
export function ExpenseList({ items, emptyText }: { items: ExpenseListItem[]; emptyText: string }) {
  if (items.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700">
        {emptyText}
      </p>
    );
  }

  return (
    <ul className="divide-y divide-zinc-200 overflow-hidden rounded-2xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
      {items.map((e) => {
        const cancelled = e.status === "cancelled";
        return (
          <li key={e.id}>
            <Link
              href={`/expenses/${e.id}`}
              className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900"
            >
              <div className="min-w-0">
                <p className={`truncate font-medium ${cancelled ? "text-zinc-400 line-through" : ""}`}>
                  {e.merchant || "사용처 없음"}
                </p>
                <p className="text-sm text-zinc-500">
                  {formatShortDate(e.spent_on)}
                  {e.categories ? ` · ${e.categories.name}` : ""}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className={`font-semibold ${cancelled ? "text-zinc-400 line-through" : ""}`}>
                  {formatWon(e.amount)}
                </p>
                <p className={`text-xs ${e.status === "needs_receipt" ? "text-amber-600" : "text-zinc-500"}`}>
                  {STATUS_LABELS[e.status]}
                </p>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
