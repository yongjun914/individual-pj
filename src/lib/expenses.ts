export const PAYMENT_METHODS = ["card", "transfer", "cash"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  card: "학생회 카드",
  transfer: "계좌이체",
  cash: "현금",
};

export type ExpenseStatus = "needs_receipt" | "complete" | "excused" | "cancelled";

export const STATUS_LABELS: Record<ExpenseStatus, string> = {
  needs_receipt: "영수증 필요",
  complete: "완료",
  excused: "사유서",
  cancelled: "취소",
};

/** 합계에서 빼는 상태 (결제 취소된 건은 쓴 돈이 아니다) */
export function countsTowardTotal(status: ExpenseStatus) {
  return status !== "cancelled";
}

export type SummaryRow = { term_id: string; amount: number; status: ExpenseStatus };
export type TermSummary = { total: number; count: number };

/** 기수별 지출 합계와 건수 (취소 건 제외) */
export function summarizeByTerm(rows: SummaryRow[]) {
  const result: Record<string, TermSummary> = {};
  for (const r of rows) {
    if (!countsTowardTotal(r.status)) continue;
    const s = (result[r.term_id] ??= { total: 0, count: 0 });
    s.total += r.amount;
    s.count += 1;
  }
  return result;
}

/** 한 건 최대 금액 (입력 실수 방지용, 1억 원) */
export const MAX_AMOUNT = 100_000_000;

/** 한 지출에 붙일 수 있는 영수증 최대 장수 */
export const MAX_RECEIPTS = 5;
