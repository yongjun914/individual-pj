"use server";

import { redirect } from "next/navigation";

import { requireUserId } from "@/lib/auth";
import { UUID } from "@/lib/expense-input";
import {
  guessIncomeSource,
  toIncomeColumns,
  validateIncomeInput,
  type IncomeFieldErrors,
  type IncomeInput,
} from "@/lib/income-input";
import { createClient } from "@/lib/supabase/server";

export type IncomeResult = { ok: true; id: string } | { ok: false; error?: string; fieldErrors?: IncomeFieldErrors };

const NO_PERMISSION = "현재 기수의 총무·회장만 수입을 기록할 수 있어요.";

export async function createIncome(input: IncomeInput): Promise<IncomeResult> {
  const fieldErrors = validateIncomeInput(input);
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  const userId = await requireUserId("/incomes/new");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("incomes")
    .insert({ term_id: input.termId, ...toIncomeColumns(input), created_by: userId })
    .select("id")
    .single();

  if (error || !data) {
    console.error("수입 등록 실패", error);
    return { ok: false, error: NO_PERMISSION };
  }
  return { ok: true, id: data.id };
}

export async function updateIncome(incomeId: string, input: IncomeInput): Promise<IncomeResult> {
  if (!UUID.test(incomeId)) return { ok: false, error: "잘못된 요청입니다." };
  const fieldErrors = validateIncomeInput(input);
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  await requireUserId(`/incomes/${incomeId}`);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("incomes")
    .update(toIncomeColumns(input))
    .eq("id", incomeId)
    .is("deleted_at", null)
    .select("id");

  if (error) console.error("수입 수정 실패", error);
  if (error || !data || data.length === 0) return { ok: false, error: NO_PERMISSION };
  return { ok: true, id: incomeId };
}

export async function deleteIncome(incomeId: string): Promise<{ error: string } | null> {
  if (!UUID.test(incomeId)) return { error: "잘못된 요청입니다." };
  await requireUserId(`/incomes/${incomeId}`);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("incomes")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", incomeId)
    .is("deleted_at", null)
    .select("id");

  if (error) console.error("수입 삭제 실패", error);
  if (error || !data || data.length === 0) return { error: NO_PERMISSION };
  redirect("/incomes");
}

// ---------------------------------------------------------------------
// 거래내역 가져오기에서 쓰는 수입 저장
// ---------------------------------------------------------------------

export type IncomeImportRow = { receivedOn: string; payer: string; amount: number; hint: string };

export async function importIncomes(termId: string, rows: IncomeImportRow[]): Promise<{ ok: true; created: number } | { ok: false; error: string }> {
  if (!UUID.test(termId)) return { ok: false, error: "학생회를 다시 골라 주세요." };
  if (rows.length === 0) return { ok: true, created: 0 };
  if (rows.length > 500) return { ok: false, error: "한 번에 500건까지 가져올 수 있어요." };

  const inputs: IncomeInput[] = rows.map((r) => ({
    termId,
    receivedOn: r.receivedOn,
    source: guessIncomeSource(`${r.hint} ${r.payer}`),
    payer: r.payer.slice(0, 100),
    amount: r.amount,
    paymentMethod: "transfer",
    memo: "",
  }));
  for (const [i, input] of inputs.entries()) {
    const first = Object.values(validateIncomeInput(input))[0];
    if (first) return { ok: false, error: `수입 ${i + 1}번째 줄(${input.payer || "입금자 없음"}): ${first}` };
  }

  const userId = await requireUserId("/expenses/import");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("incomes")
    .insert(inputs.map((input) => ({ term_id: termId, ...toIncomeColumns(input), created_by: userId })))
    .select("id");

  if (error) {
    console.error("수입 가져오기 실패", error);
    return { ok: false, error: NO_PERMISSION };
  }
  return { ok: true, created: data?.length ?? 0 };
}

/** 이미 기록된 수입과 겹치는 입금 줄 (같은 금액, 날짜 하루 안쪽) */
export async function findIncomeDuplicates(
  termId: string,
  candidates: { key: string; receivedOn: string; amount: number }[],
): Promise<{ key: string; payer: string; receivedOn: string }[]> {
  if (!UUID.test(termId) || candidates.length === 0 || candidates.length > 500) return [];
  await requireUserId("/expenses/import");
  const supabase = await createClient();

  const dates = candidates.map((c) => c.receivedOn).sort();
  const shift = (iso: string, days: number) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const { data } = await supabase
    .from("incomes")
    .select("id, received_on, amount, payer")
    .eq("term_id", termId)
    .is("deleted_at", null)
    .gte("received_on", shift(dates[0], -1))
    .lte("received_on", shift(dates[dates.length - 1], 1));

  const pool = [...(data ?? [])] as { id: string; received_on: string; amount: number; payer: string }[];
  const matches: { key: string; payer: string; receivedOn: string }[] = [];
  for (const c of candidates) {
    const idx = [c.receivedOn, shift(c.receivedOn, -1), shift(c.receivedOn, 1)]
      .map((day) => pool.findIndex((e) => e.amount === c.amount && e.received_on === day))
      .find((i) => i >= 0);
    if (idx === undefined) continue;
    const [hit] = pool.splice(idx, 1);
    matches.push({ key: c.key, payer: hit.payer, receivedOn: hit.received_on });
  }
  return matches;
}
