"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { findIncomeDuplicates, importIncomes } from "@/app/incomes/actions";
import { PAYMENT_METHOD_LABELS } from "@/lib/expenses";
import { formatShortDate, formatWon } from "@/lib/format";
import { guessIncomeSource } from "@/lib/income-input";
import { parseWorkbookSheets, type Cell, type StatementRow } from "@/lib/statement-import";

import { findDuplicates, importExpenses, type DuplicateMatch } from "./actions";

type TermOption = { id: string; label: string; canIncome: boolean };

/** 올릴 수 있는 파일 최대 크기 */
const MAX_FILE_SIZE = 5 * 1024 * 1024;

const selectClass =
  "h-11 w-full rounded-xl border border-zinc-300 bg-white px-3 text-base outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 dark:border-zinc-700 dark:bg-zinc-900";

type Preview = {
  fileName: string;
  sheetName: string;
  format: "bank" | "card";
  rows: StatementRow[];
  duplicates: Map<number, DuplicateMatch>;
  incomeDuplicates: Map<number, { payer: string; receivedOn: string }>;
};

const pad = (n: number) => String(n).padStart(2, "0");

/** 엑셀 셀의 Date를 해석기가 읽는 글자로 바꾼다 (브라우저 시간대 = 한국 시간 기준) */
function toCell(value: unknown): Cell {
  if (value instanceof Date) {
    // 엑셀 날짜는 소수라 14:05가 14:04:59.999로 읽히기도 한다 → 분 단위로 반올림
    const d = new Date(Math.round(value.getTime() / 60_000) * 60_000);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return null;
}

/** 글자 파일(CSV, HTML로 된 .xls)을 읽는다. UTF-8이 아니면 한국 은행에서 흔한 EUC-KR로 읽는다. */
function decodeText(bytes: Uint8Array) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("euc-kr").decode(bytes);
  }
}

/** 엑셀 원본 형식인지 (xlsx는 PK로, 옛 xls는 D0 CF로 시작) */
function isBinaryWorkbook(bytes: Uint8Array) {
  return (bytes[0] === 0x50 && bytes[1] === 0x4b) || (bytes[0] === 0xd0 && bytes[1] === 0xcf);
}

async function readSheets(file: File) {
  const XLSX = await import("xlsx");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const workbook = isBinaryWorkbook(bytes)
    ? XLSX.read(bytes, { type: "array", cellDates: true, dense: true })
    : XLSX.read(decodeText(bytes).replace(/^﻿/, ""), { type: "string", cellDates: true, dense: true });
  return workbook.SheetNames.map((name) => {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, raw: true, defval: null });
    return { name, rows: rows.map((row) => row.map(toCell)) };
  });
}

type ImportDone = { expenses: number; incomes: number };

export function ImportFlow({ terms }: { terms: TermOption[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [termId, setTermId] = useState(terms[0]?.id ?? "");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  /** 고른 줄 번호 (지출·수입 공통, 줄 번호는 파일 안에서 하나뿐) */
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [done, setDone] = useState<ImportDone | null>(null);

  const canIncome = terms.find((t) => t.id === termId)?.canIncome ?? false;

  function analyze(file: File, forTerm: string) {
    setError(null);
    setDone(null);
    setPreview(null);
    if (file.size > MAX_FILE_SIZE) {
      setError("파일이 너무 커요(5MB까지). 조회 기간을 나눠서 받아 주세요.");
      return;
    }
    const withIncome = terms.find((t) => t.id === forTerm)?.canIncome ?? false;

    startTransition(async () => {
      setStatus("파일을 읽는 중…");
      let sheets;
      try {
        sheets = await readSheets(file);
      } catch (e) {
        console.error(e);
        setStatus(null);
        setError(
          /password|encrypt/i.test(String(e))
            ? "암호가 걸린 파일이에요. 엑셀에서 암호를 풀고 다시 저장한 뒤 올려 주세요."
            : "파일을 읽지 못했어요. 엑셀(.xlsx, .xls)이나 CSV 파일인지 확인해 주세요.",
        );
        return;
      }

      const parsed = parseWorkbookSheets(sheets);
      if (!parsed.ok) {
        setStatus(null);
        setError(parsed.error);
        return;
      }

      const expenses = parsed.rows.filter((r) => r.kind === "expense" && r.spentOn && r.amount);
      const deposits = withIncome ? parsed.rows.filter((r) => r.kind === "deposit" && r.spentOn && r.amount) : [];
      setStatus("이미 등록된 내역과 비교하는 중…");
      const [matches, incomeMatches] = await Promise.all([
        findDuplicates(forTerm, expenses.map((r) => ({ key: String(r.line), spentOn: r.spentOn!, amount: r.amount! }))),
        deposits.length > 0
          ? findIncomeDuplicates(forTerm, deposits.map((r) => ({ key: String(r.line), receivedOn: r.spentOn!, amount: r.amount! })))
          : Promise.resolve([]),
      ]);
      const duplicates = new Map(matches.map((m) => [Number(m.key), m]));
      const incomeDuplicates = new Map(incomeMatches.map((m) => [Number(m.key), m]));

      setPreview({
        fileName: file.name,
        sheetName: parsed.sheetName,
        format: parsed.format,
        rows: parsed.rows,
        duplicates,
        incomeDuplicates,
      });
      setSelected(
        new Set([
          ...expenses.filter((r) => !r.cancelledInFile && !duplicates.has(r.line)).map((r) => r.line),
          ...deposits.filter((r) => !incomeDuplicates.has(r.line)).map((r) => r.line),
        ]),
      );
      setStatus(null);
    });
  }

  function toggle(line: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(line)) next.delete(line);
      else next.add(line);
      return next;
    });
  }

  function setAll(lines: number[], on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const l of lines) {
        if (on) next.add(l);
        else next.delete(l);
      }
      return next;
    });
  }

  const expenseRows = preview?.rows.filter((r) => r.kind === "expense") ?? [];
  const incomeRows = canIncome ? (preview?.rows.filter((r) => r.kind === "deposit") ?? []) : [];
  const skipped = preview?.rows.filter((r) => r.kind !== "expense" && !(canIncome && r.kind === "deposit")) ?? [];
  const pickedExpenses = expenseRows.filter((r) => selected.has(r.line));
  const pickedIncomes = incomeRows.filter((r) => selected.has(r.line));
  const picked = pickedExpenses.length + pickedIncomes.length;

  function submit() {
    if (!preview) return;
    setError(null);
    startTransition(async () => {
      setStatus(`${picked}건을 저장하는 중…`);
      const result: ImportDone = { expenses: 0, incomes: 0 };
      if (pickedExpenses.length > 0) {
        const r = await importExpenses(
          termId,
          pickedExpenses.map((x) => ({ spentOn: x.spentOn!, merchant: x.merchant, amount: x.amount!, method: x.method })),
        );
        if (!r.ok) {
          setStatus(null);
          setError(r.error);
          return;
        }
        result.expenses = r.created;
      }
      if (pickedIncomes.length > 0) {
        const r = await importIncomes(
          termId,
          pickedIncomes.map((x) => ({ receivedOn: x.spentOn!, payer: x.merchant, amount: x.amount!, hint: x.merchant })),
        );
        if (!r.ok) {
          setStatus(null);
          setError(result.expenses > 0 ? `지출 ${result.expenses}건은 저장했지만, 수입은 저장하지 못했어요. ${r.error}` : r.error);
          return;
        }
        result.incomes = r.created;
      }
      setStatus(null);
      setDone(result);
      setPreview(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {done && (
        <div className="space-y-2 rounded-xl bg-green-50 px-4 py-3 text-sm text-green-800 dark:bg-green-950 dark:text-green-200">
          <p>
            {done.expenses > 0 && (
              <>
                지출 <strong>{done.expenses}건</strong>
              </>
            )}
            {done.expenses > 0 && done.incomes > 0 && ", "}
            {done.incomes > 0 && (
              <>
                수입 <strong>{done.incomes}건</strong>
              </>
            )}
            을 기록했어요.
          </p>
          <div className="flex flex-wrap gap-4">
            {done.expenses > 0 && (
              <button type="button" onClick={() => router.push("/expenses?receipt=missing")} className="font-medium underline-offset-4 hover:underline">
                영수증 붙이러 가기 →
              </button>
            )}
            {done.incomes > 0 && (
              <button type="button" onClick={() => router.push("/incomes")} className="font-medium underline-offset-4 hover:underline">
                수입 항목 확인하기 →
              </button>
            )}
          </div>
        </div>
      )}

      {terms.length > 1 && (
        <label className="block space-y-1">
          <span className="text-sm font-medium">학생회</span>
          <select
            value={termId}
            onChange={(e) => {
              setTermId(e.target.value);
              setPreview(null);
            }}
            className={selectClass}
            disabled={isPending}
          >
            {terms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      )}

      <label
        className={`flex h-14 cursor-pointer items-center justify-center rounded-2xl border border-dashed border-zinc-400 text-base font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-900 ${
          isPending ? "pointer-events-none opacity-60" : ""
        }`}
      >
        {status ?? (preview ? "다른 파일 고르기" : "거래내역 파일 고르기")}
        <input
          type="file"
          accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
          className="sr-only"
          disabled={isPending}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) analyze(file, termId);
            e.target.value = "";
          }}
        />
      </label>

      {!preview && !done && (
        <div className="space-y-1 rounded-xl bg-zinc-100 p-4 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          <p className="font-medium text-zinc-800 dark:text-zinc-200">파일 받는 방법</p>
          <p>은행 인터넷뱅킹(PC) → 거래내역 조회 → 기간 선택 → 엑셀 저장</p>
          <p>카드사 홈페이지 → 이용내역(승인내역) 조회 → 엑셀 다운로드</p>
          <p className="text-zinc-500">파일은 이 폰·컴퓨터 안에서만 읽고 서버에 올리지 않아요.</p>
          {!canIncome && <p className="text-zinc-500">입금(수입)은 총무·회장만 가져올 수 있어요.</p>}
        </div>
      )}

      {preview && (
        <>
          <p className="text-sm text-zinc-500">
            {preview.fileName}
            {preview.sheetName ? ` · ${preview.sheetName}` : ""} · {preview.format === "bank" ? "통장 거래내역" : "카드 이용내역"}
          </p>

          <RowSection
            title="가져올 지출"
            emptyText="가져올 출금·결제 건이 없어요."
            rows={expenseRows}
            selected={selected}
            onToggle={toggle}
            onSetAll={setAll}
            renderSub={(r) => `${PAYMENT_METHOD_LABELS[r.method]}`}
            renderWarning={(r) => {
              const dup = preview.duplicates.get(r.line);
              return dup ? `이미 등록된 지출과 겹쳐요 (${formatShortDate(dup.spentOn)} ${dup.merchant || "사용처 없음"})` : null;
            }}
          />

          {canIncome && incomeRows.length > 0 && (
            <RowSection
              title="가져올 수입"
              emptyText=""
              rows={incomeRows}
              selected={selected}
              onToggle={toggle}
              onSetAll={setAll}
              positive
              renderSub={(r) => `항목: ${guessIncomeSource(r.merchant)} (가져온 뒤 고칠 수 있어요)`}
              renderWarning={(r) => {
                const dup = preview.incomeDuplicates.get(r.line);
                return dup ? `이미 기록된 수입과 겹쳐요 (${formatShortDate(dup.receivedOn)} ${dup.payer || "입금자 없음"})` : null;
              }}
            />
          )}

          {skipped.length > 0 && (
            <details className="rounded-2xl border border-zinc-200 p-4 text-sm dark:border-zinc-800">
              <summary className="cursor-pointer font-medium">
                가져오지 않는 줄 {skipped.length}건 (입금 {skipped.filter((r) => r.kind === "deposit").length} · 취소{" "}
                {skipped.filter((r) => r.kind === "cancel").length} · 읽지 못함 {skipped.filter((r) => r.kind === "invalid").length})
              </summary>
              <ul className="mt-2 space-y-1 text-zinc-600 dark:text-zinc-400">
                {skipped.map((r) => (
                  <li key={r.line}>
                    {r.line}번째 줄 · {r.kind === "deposit" ? "입금" : r.kind === "cancel" ? "취소" : "읽지 못함"}
                    {r.merchant ? ` · ${r.merchant}` : ""}
                    {r.amount ? ` · ${formatWon(r.amount)}` : ""}
                    {r.note ? ` · ${r.note}` : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <button
            type="button"
            onClick={submit}
            disabled={isPending || picked === 0}
            className="h-12 w-full rounded-xl bg-blue-600 text-base font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {isPending
              ? (status ?? "저장하는 중…")
              : `가져오기 (지출 ${pickedExpenses.length}건${canIncome ? ` · 수입 ${pickedIncomes.length}건` : ""})`}
          </button>
        </>
      )}
    </div>
  );
}

function RowSection({
  title,
  emptyText,
  rows,
  selected,
  onToggle,
  onSetAll,
  renderSub,
  renderWarning,
  positive,
}: {
  title: string;
  emptyText: string;
  rows: StatementRow[];
  selected: Set<number>;
  onToggle: (line: number) => void;
  onSetAll: (lines: number[], on: boolean) => void;
  renderSub: (r: StatementRow) => string;
  renderWarning: (r: StatementRow) => string | null;
  positive?: boolean;
}) {
  const lines = rows.map((r) => r.line);
  const allOn = rows.length > 0 && rows.every((r) => selected.has(r.line));
  const total = rows.filter((r) => selected.has(r.line)).reduce((s, r) => s + (r.amount ?? 0), 0);

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">
          {title} ({rows.length}건{total > 0 ? ` · 고른 금액 ${formatWon(total)}` : ""})
        </h2>
        {rows.length > 0 && (
          <button type="button" onClick={() => onSetAll(lines, !allOn)} className="text-sm text-blue-600 underline-offset-4 hover:underline">
            {allOn ? "모두 해제" : "모두 선택"}
          </button>
        )}
      </div>
      {rows.length > 0 ? (
        <ul className="divide-y divide-zinc-200 overflow-hidden rounded-2xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {rows.map((r) => {
            const warning = renderWarning(r);
            return (
              <li key={r.line}>
                <label className="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900">
                  <input
                    type="checkbox"
                    checked={selected.has(r.line)}
                    onChange={() => onToggle(r.line)}
                    className="mt-1 h-5 w-5 shrink-0 accent-blue-600"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex justify-between gap-3">
                      <p className="truncate font-medium">{r.merchant || "(내용 없음)"}</p>
                      <p className={`shrink-0 font-semibold ${positive ? "text-green-700 dark:text-green-400" : ""}`}>
                        {positive ? "+" : ""}
                        {formatWon(r.amount ?? 0)}
                      </p>
                    </div>
                    <p className="text-sm text-zinc-500">
                      {r.spentOn ? formatShortDate(r.spentOn) : ""}
                      {r.time ? ` ${r.time}` : ""} · {renderSub(r)}
                    </p>
                    {warning && <p className="text-sm text-amber-700 dark:text-amber-300">{warning}</p>}
                    {r.note && <p className="text-sm text-amber-700 dark:text-amber-300">{r.note}</p>}
                  </div>
                </label>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700">{emptyText}</p>
      )}
    </section>
  );
}
