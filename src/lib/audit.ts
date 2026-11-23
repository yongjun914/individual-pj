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

export type AuditIncomeInput = {
  id: string;
  received_on: string;
  created_at: string;
  source: string;
  payer: string;
  amount: number;
  memo: string;
};

export type SourceTotal = { source: string; count: number; total: number };

export type AuditReport = {
  rows: AuditRow[];
  /** 지출 합계 (결산내역서의 '총 집행액') */
  total: number;
  /** 수입 (결산내역서의 '예산내역') */
  incomes: AuditIncomeInput[];
  incomeTotal: number;
  incomeSources: SourceTotal[];
  /** 수입 - 지출 */
  balance: number;
  counts: { receipt: number; excused: number; missing: number; cancelled: number };
  checks: AuditCheck[];
  categories: CategoryTotal[];
};

const UNCATEGORIZED = "미분류";

function label(e: { spent_on: string; merchant: string; amount: number }) {
  const [, m, d] = e.spent_on.split("-").map(Number);
  return `${m}월 ${d}일 ${e.merchant || "사용처 없음"} ${e.amount.toLocaleString("ko-KR")}원`;
}

/**
 * 감사 자료를 만든다. 취소된 지출은 번호·합계에서 빼고 점검에서만 알린다.
 * 수입은 결산내역서의 '예산내역'(예산액)이 된다.
 */
export function buildAuditReport(expenses: AuditExpenseInput[], incomeInputs: AuditIncomeInput[] = []): AuditReport {
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

  const incomes = [...incomeInputs].sort(
    (a, b) => a.received_on.localeCompare(b.received_on) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  );
  const incomeTotal = incomes.reduce((s, i) => s + i.amount, 0);

  if (incomes.length === 0 && rows.length > 0) {
    checks.push({
      key: "no-income",
      level: "warning",
      title: "수입이 하나도 없어요",
      description: "이월액·학회비 같은 수입을 넣어야 결산내역서의 예산액과 잔액이 맞아요.",
      items: [],
    });
  }
  const unsorted = incomes.filter((i) => i.source === "기타");
  if (unsorted.length > 0) {
    checks.push({
      key: "income-other",
      level: "warning",
      title: "항목이 '기타'인 수입",
      description: "입금 문자나 거래내역에서 자동으로 들어온 수입은 '기타'로 들어가요. 맞는 항목으로 바꿔 주세요.",
      items: unsorted.map((i) => {
        const [, m, d] = i.received_on.split("-").map(Number);
        return { id: `income:${i.id}`, no: null, label: `${m}월 ${d}일 ${i.payer || "입금자 없음"} ${i.amount.toLocaleString("ko-KR")}원` };
      }),
    });
  }

  const bySource = new Map<string, SourceTotal & { firstOn: string }>();
  for (const i of incomes) {
    const s = bySource.get(i.source) ?? { source: i.source, count: 0, total: 0, firstOn: i.received_on };
    s.count += 1;
    s.total += i.amount;
    bySource.set(i.source, s);
  }
  // 양식처럼: 이월액 → 회비·별도 납입 등 (받은 날짜 순) → 이자·할인·기타
  const rank = (s: string) => (/이월/.test(s) ? 0 : /이자|할인|캐시백|환급|기타/.test(s) ? 2 : 1);
  const incomeSources = [...bySource.values()]
    .sort((a, b) => rank(a.source) - rank(b.source) || a.firstOn.localeCompare(b.firstOn) || b.total - a.total)
    .map(({ source, count, total }) => ({ source, count, total }));

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

  const total = rows.reduce((s, r) => s + r.amount, 0);
  const levelRank: Record<CheckLevel, number> = { error: 0, warning: 1, info: 2 };
  checks.sort((a, b) => levelRank[a.level] - levelRank[b.level]);
  return {
    rows,
    total,
    incomes,
    incomeTotal,
    incomeSources,
    balance: incomeTotal - total,
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
