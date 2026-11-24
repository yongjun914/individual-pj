"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  INCOME_METHOD_LABELS,
  INCOME_METHODS,
  INCOME_SOURCES,
  type IncomeFieldErrors,
  type IncomeInput,
} from "@/lib/income-input";

import { createIncome, deleteIncome, updateIncome } from "./actions";

export type IncomeTermOption = { id: string; label: string };
export type EditingIncome = IncomeInput & { id: string };

const inputClass =
  "h-12 w-full rounded-xl border border-zinc-300 bg-white px-4 text-base outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 dark:border-zinc-700 dark:bg-zinc-900";

function parseAmount(text: string) {
  const digits = text.replace(/[^\d]/g, "");
  return digits ? Number(digits) : 0;
}

function Chip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`h-10 rounded-full border px-4 text-sm ${
        selected
          ? "border-blue-600 bg-blue-50 font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300"
          : "border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
      }`}
    >
      {children}
    </button>
  );
}

function Field({ label, error, optional, children }: { label: string; error?: string; optional?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">
        {label} {optional && <span className="font-normal text-zinc-500">(선택)</span>}
      </p>
      {children}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

/** 수입 등록·수정 폼. `income`을 넘기면 수정 모드 */
export function IncomeForm({
  terms,
  today,
  income,
}: {
  terms: IncomeTermOption[];
  today: string;
  income?: EditingIncome;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<IncomeFieldErrors>({});

  const [termId, setTermId] = useState(income?.termId ?? terms[0]?.id ?? "");
  const [amountText, setAmountText] = useState(income ? income.amount.toLocaleString("ko-KR") : "");
  const [source, setSource] = useState(income?.source ?? "");
  const [paymentMethod, setPaymentMethod] = useState(income?.paymentMethod ?? "transfer");
  const isPreset = (INCOME_SOURCES as readonly string[]).includes(source);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const input: IncomeInput = {
      termId,
      receivedOn: String(form.get("receivedOn") ?? ""),
      source,
      payer: String(form.get("payer") ?? ""),
      amount: parseAmount(amountText),
      paymentMethod,
      memo: String(form.get("memo") ?? ""),
    };
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = income ? await updateIncome(income.id, input) : await createIncome(input);
      if (!result.ok) {
        setFieldErrors(result.fieldErrors ?? {});
        setError(result.error ?? (result.fieldErrors ? "입력한 내용을 확인해 주세요." : null));
        return;
      }
      router.push("/incomes");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {!income && terms.length > 1 && (
        <Field label="학생회" error={fieldErrors.termId}>
          <select value={termId} onChange={(e) => setTermId(e.target.value)} className={inputClass} aria-label="학생회">
            {terms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field label="금액" error={fieldErrors.amount}>
        <div className="relative">
          <input
            inputMode="numeric"
            autoComplete="off"
            placeholder="0"
            aria-label="금액"
            value={amountText}
            onChange={(e) => {
              const n = parseAmount(e.target.value);
              setAmountText(n ? n.toLocaleString("ko-KR") : "");
            }}
            className={`${inputClass} pr-10 text-right text-lg font-semibold`}
          />
          <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500">원</span>
        </div>
      </Field>

      <Field label="수입 항목" error={fieldErrors.source}>
        <div className="flex flex-wrap gap-2">
          {INCOME_SOURCES.map((s) => (
            <Chip key={s} selected={source === s} onClick={() => setSource(s)}>
              {s}
            </Chip>
          ))}
        </div>
        <input
          value={isPreset ? "" : source}
          onChange={(e) => setSource(e.target.value)}
          maxLength={50}
          placeholder="직접 입력 (예: 체육대회 참가비)"
          aria-label="수입 항목 직접 입력"
          className={inputClass}
        />
      </Field>

      <Field label="입금자" error={fieldErrors.payer} optional>
        <input name="payer" defaultValue={income?.payer} maxLength={100} placeholder="예: 학생지원팀, 홍길동" className={inputClass} />
      </Field>

      <Field label="받은 날" error={fieldErrors.receivedOn}>
        <input name="receivedOn" type="date" defaultValue={income?.receivedOn ?? today} max={today} className={inputClass} aria-label="받은 날" />
      </Field>

      <Field label="받은 방식" error={fieldErrors.paymentMethod}>
        <div className="flex gap-2">
          {INCOME_METHODS.map((m) => (
            <Chip key={m} selected={paymentMethod === m} onClick={() => setPaymentMethod(m)}>
              {INCOME_METHOD_LABELS[m]}
            </Chip>
          ))}
        </div>
      </Field>

      <Field label="메모" error={fieldErrors.memo} optional>
        <textarea name="memo" defaultValue={income?.memo} rows={2} maxLength={1000} className={`${inputClass} h-auto py-3`} aria-label="메모" />
      </Field>

      <button
        type="submit"
        disabled={isPending}
        className="h-12 w-full rounded-full btn-glow bg-blue-600 text-base font-medium text-white hover:bg-blue-700 disabled:opacity-60"
      >
        {isPending ? "저장하는 중…" : "저장"}
      </button>
    </form>
  );
}

export function DeleteIncomeButton({ incomeId }: { incomeId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (!confirm("이 수입을 삭제할까요? 목록과 합계에서 빠지고, 변경 이력에는 남아요.")) return;
          startTransition(async () => {
            const result = await deleteIncome(incomeId);
            if (result?.error) setError(result.error);
          });
        }}
        className="h-12 w-full rounded-xl border border-red-300 font-medium text-red-600 hover:bg-red-50 disabled:opacity-60 dark:border-red-900 dark:hover:bg-red-950"
      >
        {isPending ? "삭제하는 중…" : "수입 삭제"}
      </button>
    </div>
  );
}
