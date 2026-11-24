"use server";

import { requireUserId } from "@/lib/auth";
import { toExpenseColumns, UUID, validateExpenseInput } from "@/lib/expense-input";
import { createClient } from "@/lib/supabase/server";

/** 한 번에 가져올 수 있는 최대 건수 */
const MAX_IMPORT = 500;

export type ImportCandidate = {
  /** 화면에서 줄을 구분하는 값 (파일의 줄 번호) */
  key: string;
  spentOn: string;
  amount: number;
};

export type DuplicateMatch = { key: string; expenseId: string; merchant: string; spentOn: string };

function shiftDate(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * 이미 등록된 지출과 겹치는 줄을 찾는다 (결제 문자로 먼저 들어온 지출 등).
 * 금액이 같고 날짜가 하루 안쪽이면 같은 지출로 본다. 기존 지출 하나는 한 줄에만 짝지어진다.
 */
export async function findDuplicates(termId: string, candidates: ImportCandidate[]): Promise<DuplicateMatch[]> {
  if (!UUID.test(termId) || candidates.length === 0 || candidates.length > MAX_IMPORT) return [];
  const valid = candidates.filter((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.spentOn) && Number.isInteger(c.amount));
  if (valid.length === 0) return [];

  await requireUserId("/expenses/import");
  const supabase = await createClient();

  const dates = valid.map((c) => c.spentOn).sort();
  const { data: existing } = await supabase
    .from("expenses")
    .select("id, spent_on, amount, merchant")
    .eq("term_id", termId)
    .is("deleted_at", null)
    .neq("status", "cancelled")
    .gte("spent_on", shiftDate(dates[0], -1))
    .lte("spent_on", shiftDate(dates[dates.length - 1], 1));

  const pool = [...(existing ?? [])] as { id: string; spent_on: string; amount: number; merchant: string }[];
  const matches: DuplicateMatch[] = [];
  for (const c of valid) {
    const near = [c.spentOn, shiftDate(c.spentOn, -1), shiftDate(c.spentOn, 1)];
    // 같은 날짜를 먼저, 그다음 하루 차이
    const idx = near
      .map((day) => pool.findIndex((e) => e.amount === c.amount && e.spent_on === day))
      .find((i) => i >= 0);
    if (idx === undefined) continue;
    const [hit] = pool.splice(idx, 1);
    matches.push({ key: c.key, expenseId: hit.id, merchant: hit.merchant, spentOn: hit.spent_on });
  }
  return matches;
}

export type ImportRow = { spentOn: string; merchant: string; amount: number; method: string };

export type ImportResult = { ok: true; created: number } | { ok: false; error: string };

/** 고른 줄을 '영수증 필요' 지출로 한꺼번에 만든다 */
export async function importExpenses(termId: string, rows: ImportRow[]): Promise<ImportResult> {
  if (!UUID.test(termId)) return { ok: false, error: "학생회를 다시 골라 주세요." };
  if (rows.length === 0) return { ok: false, error: "가져올 줄을 골라 주세요." };
  if (rows.length > MAX_IMPORT) return { ok: false, error: `한 번에 ${MAX_IMPORT}건까지 가져올 수 있어요. 기간을 나눠 주세요.` };

  const inputs = rows.map((r) => ({
    termId,
    spentOn: r.spentOn,
    merchant: r.merchant.trim().slice(0, 100) || "(내용 없음)",
    amount: r.amount,
    items: "",
    paymentMethod: r.method,
    categoryId: "",
    memo: "",
  }));

  for (const [i, input] of inputs.entries()) {
    const errors = validateExpenseInput(input);
    const first = Object.values(errors)[0];
    if (first) return { ok: false, error: `${i + 1}번째 줄(${input.merchant}): ${first}` };
  }

  const userId = await requireUserId("/expenses/import");
  const supabase = await createClient();

  const { data: term } = await supabase.from("terms").select("id, is_active").eq("id", termId).maybeSingle();
  if (!term || !term.is_active) return { ok: false, error: "이 학생회의 현재 연도에 지출을 등록할 수 없습니다." };

  const { data, error } = await supabase
    .from("expenses")
    .insert(inputs.map((input) => ({ term_id: termId, ...toExpenseColumns(input), created_by: userId })))
    .select("id");

  if (error) {
    console.error("거래내역 가져오기 실패", error);
    return { ok: false, error: "지출을 저장하지 못했어요. 잠시 후 다시 시도해 주세요." };
  }

  return { ok: true, created: data?.length ?? 0 };
}
