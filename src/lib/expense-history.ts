import { PAYMENT_METHOD_LABELS, STATUS_LABELS, type ExpenseStatus, type PaymentMethod } from "@/lib/expenses";
import { formatShortDate, formatWon } from "@/lib/format";

/** 변경 이력(audit_logs)의 한 행 */
export type AuditLogRow = {
  id: number;
  actor_id: string | null;
  action: "insert" | "update";
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  created_at: string;
};

export type FieldChange = { label: string; before: string; after: string };

type Formatter = (value: unknown, categoryNames: Map<string, string>) => string;

const text: Formatter = (v) => (typeof v === "string" && v.trim() ? v : "(없음)");

/** 이력에 보여 줄 칸과 표시 방법. 여기 없는 칸(updated_at 등)은 숨긴다. */
const FIELDS: Record<string, { label: string; format: Formatter }> = {
  amount: { label: "금액", format: (v) => (typeof v === "number" ? formatWon(v) : String(v ?? "")) },
  merchant: { label: "사용처", format: text },
  spent_on: { label: "사용일", format: (v) => (typeof v === "string" ? formatShortDate(v) : "") },
  category_id: {
    label: "행사",
    format: (v, names) => (typeof v === "string" ? (names.get(v) ?? "(삭제된 행사)") : "미분류"),
  },
  payment_method: {
    label: "결제 수단",
    format: (v) => PAYMENT_METHOD_LABELS[v as PaymentMethod] ?? String(v ?? ""),
  },
  items: { label: "품목", format: text },
  memo: { label: "메모", format: text },
  status: { label: "상태", format: (v) => STATUS_LABELS[v as ExpenseStatus] ?? String(v ?? "") },
  missing_reason: { label: "사유서", format: text },
  deleted_at: { label: "삭제", format: (v) => (v ? "삭제됨" : "삭제 안 됨") },
};

/** 수정 이력 한 건에서 바뀐 칸만 뽑는다 */
export function describeChanges(log: AuditLogRow, categoryNames: Map<string, string>): FieldChange[] {
  if (log.action !== "update" || !log.old_data || !log.new_data) return [];
  const changes: FieldChange[] = [];
  for (const [key, { label, format }] of Object.entries(FIELDS)) {
    const before = log.old_data[key] ?? null;
    const after = log.new_data[key] ?? null;
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    changes.push({ label, before: format(before, categoryNames), after: format(after, categoryNames) });
  }
  return changes;
}
