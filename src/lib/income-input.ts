import { MAX_AMOUNT } from "@/lib/expenses";

/** 수입 항목 예시 (직접 입력도 된다). 결산내역서 '예산내역'의 항목 이름에 맞췄다. */
export const INCOME_SOURCES = ["이월액", "학회비", "행사 별도 납입", "학교 지원금", "협찬·후원", "이자", "카드 할인", "기타"] as const;

/** 수입은 카드로 받지 않으므로 계좌이체·현금만 */
export const INCOME_METHODS = ["transfer", "cash"] as const;
export type IncomeMethod = (typeof INCOME_METHODS)[number];
export const INCOME_METHOD_LABELS: Record<IncomeMethod, string> = { transfer: "계좌 입금", cash: "현금" };

export type IncomeInput = {
  termId: string;
  receivedOn: string;
  source: string;
  payer: string;
  amount: number;
  paymentMethod: string;
  memo: string;
};

export type IncomeFieldErrors = Partial<Record<keyof IncomeInput, string>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validateIncomeInput(input: IncomeInput): IncomeFieldErrors {
  const e: IncomeFieldErrors = {};
  if (!UUID.test(input.termId)) e.termId = "학생회를 골라 주세요.";
  if (!ISO_DATE.test(input.receivedOn) || Number.isNaN(Date.parse(input.receivedOn))) e.receivedOn = "날짜를 확인해 주세요.";
  if (!input.source.trim()) e.source = "수입 항목을 골라 주세요.";
  else if (input.source.trim().length > 50) e.source = "50자 이내로 입력해 주세요.";
  if (input.payer.trim().length > 100) e.payer = "100자 이내로 입력해 주세요.";
  if (!Number.isInteger(input.amount) || input.amount <= 0) e.amount = "금액을 입력해 주세요.";
  else if (input.amount > MAX_AMOUNT) e.amount = "금액이 너무 큽니다. 다시 확인해 주세요.";
  if (!INCOME_METHODS.includes(input.paymentMethod as IncomeMethod)) e.paymentMethod = "받은 방식을 골라 주세요.";
  if (input.memo.length > 1000) e.memo = "1000자 이내로 입력해 주세요.";
  return e;
}

export function toIncomeColumns(input: IncomeInput) {
  return {
    received_on: input.receivedOn,
    source: input.source.trim(),
    payer: input.payer.trim(),
    amount: input.amount,
    payment_method: input.paymentMethod as IncomeMethod,
    memo: input.memo.trim(),
  };
}

/** 통장 입금 내용으로 수입 항목을 짐작한다 (거래내역 가져오기용) */
export function guessIncomeSource(text: string) {
  if (/이월/.test(text)) return "이월액";
  if (/총회|MT|행사|참가비/.test(text)) return "행사 별도 납입";
  if (/회비/.test(text)) return "학회비";
  if (/지원|교비|학교|대학/.test(text)) return "학교 지원금";
  if (/협찬|후원|기부/.test(text)) return "협찬·후원";
  if (/이자|결산/.test(text)) return "이자";
  if (/할인|캐시백|환급/.test(text)) return "카드 할인";
  return "기타";
}
