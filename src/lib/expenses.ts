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

/** 한 건 최대 금액 (입력 실수 방지용, 1억 원) */
export const MAX_AMOUNT = 100_000_000;

/** 한 지출에 붙일 수 있는 영수증 최대 장수 */
export const MAX_RECEIPTS = 5;
