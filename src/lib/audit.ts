/**
 * 감사 자료 계산: 증빙 번호 매기기, 출력 전 점검(F-15), 행사별 합계.
 * 엑셀과 증빙 PDF가 같은 번호를 쓰도록 여기서 한 번만 정한다.
 *
 * 순수 함수만 두고 다른 모듈을 가져오지 않는다 (node --test로 바로 테스트하려고).
 */

export type AuditStatus = "needs_receipt" | "complete" | "excused" | "cancelled";

export type AuditExpenseInput = {
  id: string;
  spent_on: string;
  created_at: string;
  merchant: string;
  amount: number;
  items: string;
  payment_method: "card" | "transfer" | "cash";
  status: AuditStatus;
  memo: string;
  missing_reason: string | null;
  category: string | null;
  receipts: { id: string; storage_path: string; created_at: string }[];
};

export type Evidence = "receipt" | "excused" | "missing";

export type AuditRow = AuditExpenseInput & {
  /** 증빙 번호 (1부터) */
  no: number;
  evidence: Evidence;
};

export type CheckLevel = "error" | "warning" | "info";

export type AuditCheck = {
  key: string;
  level: CheckLevel;
  title: string;
  description: string;
  /** 해당 지출 (번호와 함께) */
  items: { id: string; no: number | null; label: string }[];
};

export type CategoryTotal = { category: string; count: number; total: number };

export type AuditReport = {
  rows: AuditRow[];
  total: number;
  counts: { receipt: number; excused: number; missing: number; cancelled: number };
  checks: AuditCheck[];
  categories: CategoryTotal[];
};

const UNCATEGORIZED = "미분류";

function label(e: { spent_on: string; merchant: string; amount: number }) {
  const [, m, d] = e.spent_on.split("-").map(Number);
  return `${m}월 ${d}일 ${e.merchant || "사용처 없음"} ${e.amount.toLocaleString("ko-KR")}원`;
}

/** 감사 자료를 만든다. 취소된 지출은 번호·합계에서 빼고 점검에서만 알린다. */
export function buildAuditReport(expenses: AuditExpenseInput[]): AuditReport {
  const sorted = [...expenses].sort(
    (a, b) => a.spent_on.localeCompare(b.spent_on) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  );
  const cancelled = sorted.filter((e) => e.status === "cancelled");

  const rows: AuditRow[] = sorted
    .filter((e) => e.status !== "cancelled")
    .map((e, i) => ({
      ...e,
      receipts: [...e.receipts].sort((a, b) => a.created_at.localeCompare(b.created_at)),
      no: i + 1,
      evidence: e.receipts.length > 0 ? "receipt" : e.status === "excused" ? "excused" : "missing",
    }));

  const item = (r: AuditRow) => ({ id: r.id, no: r.no, label: label(r) });
  const checks: AuditCheck[] = [];
  const add = (check: AuditCheck) => {
    if (check.items.length > 0) checks.push(check);
  };

  add({
    key: "missing",
    level: "error",
    title: "영수증이 없는 지출",
    description: "영수증을 붙이거나, 잃어버렸으면 분실 사유서를 써 주세요.",
    items: rows.filter((r) => r.evidence === "missing").map(item),
  });
  add({
    key: "zero",
    level: "error",
    title: "금액이 0원인 지출",
    description: "금액을 확인해 주세요.",
    items: rows.filter((r) => r.amount <= 0).map(item),
  });
  add({
    key: "uncategorized",
    level: "warning",
    title: "행사가 정해지지 않은 지출",
    description: "감사 양식의 항목에 맞게 행사를 골라 주세요.",
    items: rows.filter((r) => !r.category).map(item),
  });
  add({
    key: "no-merchant",
    level: "warning",
    title: "사용처가 비어 있는 지출",
    description: "어디에 쓴 돈인지 적어 주세요.",
    items: rows.filter((r) => !r.merchant.trim() || r.merchant.trim() === "(내용 없음)").map(item),
  });

  // 같은 날 같은 금액이 두 번 이상: 결제 문자와 거래내역 가져오기가 겹쳤을 수 있다
  const groups = new Map<string, AuditRow[]>();
  for (const r of rows) {
    const key = `${r.spent_on}|${r.amount}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  add({
    key: "duplicate",
    level: "warning",
    title: "같은 날 같은 금액인 지출",
    description: "같은 결제가 두 번 등록됐는지 확인해 주세요. 실제로 따로 쓴 돈이면 그대로 두면 돼요.",
    items: [...groups.values()].filter((g) => g.length > 1).flat().map(item),
  });

  add({
    key: "excused",
    level: "info",
    title: "분실 사유서로 대신한 지출",
    description: "증빙 PDF에 영수증 대신 사유서 페이지가 들어가요.",
    items: rows.filter((r) => r.evidence === "excused").map(item),
  });
  add({
    key: "cancelled",
    level: "info",
    title: "결제 취소된 지출 (제외)",
    description: "번호와 합계에서 뺐어요.",
    items: cancelled.map((e) => ({ id: e.id, no: null, label: label(e) })),
  });

  const byCategory = new Map<string, CategoryTotal>();
  for (const r of rows) {
    const name = r.category ?? UNCATEGORIZED;
    const c = byCategory.get(name) ?? { category: name, count: 0, total: 0 };
    c.count += 1;
    c.total += r.amount;
    byCategory.set(name, c);
  }
  const categories = [...byCategory.values()].sort(
    (a, b) => Number(a.category === UNCATEGORIZED) - Number(b.category === UNCATEGORIZED) || b.total - a.total,
  );

  return {
    rows,
    total: rows.reduce((s, r) => s + r.amount, 0),
    counts: {
      receipt: rows.filter((r) => r.evidence === "receipt").length,
      excused: rows.filter((r) => r.evidence === "excused").length,
      missing: rows.filter((r) => r.evidence === "missing").length,
      cancelled: cancelled.length,
    },
    checks,
    categories,
  };
}

/** 증빙 칸에 들어갈 글 */
export function evidenceLabel(r: AuditRow) {
  if (r.evidence === "receipt") return `영수증 ${r.receipts.length}장`;
  if (r.evidence === "excused") return "분실 사유서";
  return "없음";
}
