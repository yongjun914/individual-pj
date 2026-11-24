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

const STATUS_STYLE: Record<ExpenseStatus, string> = {
  needs_receipt: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  complete: "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300",
  excused: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  cancelled: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

/** 목록 칸이 넓을 때(카드 너비 42rem 이상) 표처럼 보이게 하는 칸 너비: 날짜 | 사용처 | 행사 | 상태 | 금액 */
const COLS = "@2xl:grid @2xl:grid-cols-[6.5rem_minmax(0,1fr)_9rem_7rem_9rem] @2xl:items-center @2xl:gap-4";

/**
 * 지출 목록 (홈 최근 지출, 지출 목록 화면에서 같이 쓴다). 누르면 상세 화면으로 간다.
 * 좁은 칸(휴대폰, 홈의 좁은 카드): 두 줄 카드 / 넓은 칸: 표 형태. 화면이 아니라 목록 칸 너비로 고른다.
 */
export function ExpenseList({ items, emptyText }: { items: ExpenseListItem[]; emptyText: string }) {
  if (items.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-zinc-300 p-6 text-center text-zinc-500 dark:border-zinc-700">
        {emptyText}
      </p>
    );
  }

  return (
    <div className="@container overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
      <div className={`hidden bg-zinc-50 px-4 py-2 text-sm font-medium text-zinc-500 dark:bg-zinc-900 ${COLS}`}>
        <span>사용일</span>
        <span>사용처</span>
        <span>행사</span>
        <span>상태</span>
        <span className="text-right">금액</span>
      </div>
      <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {items.map((e) => {
          const cancelled = e.status === "cancelled";
          const strike = cancelled ? "text-zinc-400 line-through" : "";
          return (
            <li key={e.id}>
              <Link
                href={`/expenses/${e.id}`}
                className={`flex items-center justify-between gap-3 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900 ${COLS}`}
              >
                {/* PC 칸 */}
                <span className="hidden text-zinc-500 tabular-nums @2xl:block">{formatShortDate(e.spent_on)}</span>
                <span className={`hidden truncate font-medium @2xl:block ${strike}`}>{e.merchant || "사용처 없음"}</span>
                <span className="hidden truncate text-zinc-600 @2xl:block dark:text-zinc-400">{e.categories?.name ?? "미분류"}</span>
                <span className="hidden @2xl:block">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[e.status]}`}>{STATUS_LABELS[e.status]}</span>
                </span>
                <span className={`hidden text-right font-semibold tabular-nums @2xl:block ${strike}`}>{formatWon(e.amount)}</span>

                {/* 휴대폰 카드 */}
                <div className="min-w-0 @2xl:hidden">
                  <p className={`truncate font-medium ${strike}`}>{e.merchant || "사용처 없음"}</p>
                  <p className="text-sm text-zinc-500">
                    {formatShortDate(e.spent_on)} · {e.categories?.name ?? "미분류"}
                  </p>
                </div>
                <div className="shrink-0 text-right @2xl:hidden">
                  <p className={`font-semibold tabular-nums ${strike}`}>{formatWon(e.amount)}</p>
                  <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[e.status]}`}>
                    {STATUS_LABELS[e.status]}
                  </span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
