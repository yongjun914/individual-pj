/** 지출 목록 필터 (주소의 검색 조건) */

export const RECEIPT_FILTERS = ["all", "missing", "attached", "excused"] as const;
export type ReceiptFilter = (typeof RECEIPT_FILTERS)[number];

export const RECEIPT_FILTER_LABELS: Record<ReceiptFilter, string> = {
  all: "전체",
  missing: "영수증 없음",
  attached: "영수증 있음",
  excused: "사유서",
};

/** 영수증 필터 → 지출 상태 */
export const RECEIPT_FILTER_STATUS = {
  missing: "needs_receipt",
  attached: "complete",
  excused: "excused",
} as const;

/** 행사 필터에서 '미분류'를 뜻하는 값 */
export const UNCATEGORIZED = "none";

export type ExpenseFilters = {
  term: string | null;
  from: string | null;
  to: string | null;
  category: string | null;
  receipt: ReceiptFilter;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

type RawParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function validDate(value: string | undefined) {
  return value && ISO_DATE.test(value) && !Number.isNaN(Date.parse(value)) ? value : null;
}

/** 주소의 검색 조건을 검사해 필터로 바꾼다. 형식이 틀린 값은 버린다. */
export function parseFilters(params: RawParams): ExpenseFilters {
  const term = first(params.term);
  const category = first(params.category);
  const receipt = first(params.receipt);

  let from = validDate(first(params.from));
  let to = validDate(first(params.to));
  if (from && to && from > to) [from, to] = [to, from];

  return {
    term: term && UUID.test(term) ? term : null,
    from,
    to,
    category: category === UNCATEGORIZED || (category && UUID.test(category)) ? category : null,
    receipt: RECEIPT_FILTERS.includes(receipt as ReceiptFilter) ? (receipt as ReceiptFilter) : "all",
  };
}

export function hasActiveFilter(f: ExpenseFilters) {
  return Boolean(f.term || f.from || f.to || f.category || f.receipt !== "all");
}
