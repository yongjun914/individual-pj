"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { MAX_RECEIPTS, PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from "@/lib/expenses";
import { extensionFor, resizeImage } from "@/lib/image";
import { createClient } from "@/lib/supabase/client";

import { attachReceipts, createExpense, type ExpenseInput } from "./actions";

export type TermOption = { id: string; label: string };
export type CategoryOption = { id: string; term_id: string; name: string };

type Photo = { id: string; file: File; url: string };
type FieldErrors = Partial<Record<keyof ExpenseInput, string>>;

const inputClass =
  "h-12 w-full rounded-xl border border-zinc-300 bg-white px-4 text-base outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 dark:border-zinc-700 dark:bg-zinc-900";

/** "152,000" → 152000 */
function parseAmount(text: string) {
  const digits = text.replace(/[^\d]/g, "");
  return digits ? Number(digits) : 0;
}

export function ExpenseForm({
  terms,
  categories,
  today,
}: {
  terms: TermOption[];
  categories: CategoryOption[];
  today: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const [termId, setTermId] = useState(terms[0]?.id ?? "");
  const [amountText, setAmountText] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<string>("card");
  const [categoryId, setCategoryId] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);

  const termCategories = categories.filter((c) => c.term_id === termId);

  // 미리보기 URL은 화면을 떠날 때 정리
  const previewUrls = useRef(new Set<string>());
  useEffect(() => {
    const urls = previewUrls.current;
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  function addPhotos(files: FileList | null) {
    if (!files) return;
    const room = MAX_RECEIPTS - photos.length;
    const added = Array.from(files)
      .filter((f) => f.type.startsWith("image/") || f.name.toLowerCase().match(/\.(heic|heif)$/))
      .slice(0, room)
      .map((file) => ({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file) }));
    added.forEach((p) => previewUrls.current.add(p.url));
    if (files.length > room) setError(`영수증은 ${MAX_RECEIPTS}장까지 올릴 수 있어요.`);
    setPhotos((prev) => [...prev, ...added]);
  }

  function removePhoto(id: string) {
    const target = photos.find((p) => p.id === id);
    if (target) {
      URL.revokeObjectURL(target.url);
      previewUrls.current.delete(target.url);
    }
    setPhotos((prev) => prev.filter((p) => p.id !== id));
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const input: ExpenseInput = {
      termId,
      spentOn: String(form.get("spentOn") ?? ""),
      merchant: String(form.get("merchant") ?? ""),
      amount: parseAmount(amountText),
      items: String(form.get("items") ?? ""),
      paymentMethod,
      categoryId,
      memo: String(form.get("memo") ?? ""),
    };

    setError(null);
    setFieldErrors({});

    startTransition(async () => {
      setProgress("저장하는 중…");
      const created = await createExpense(input);
      if (!created.ok) {
        setProgress(null);
        setFieldErrors(created.fieldErrors ?? {});
        setError(created.error ?? (created.fieldErrors ? "입력한 내용을 확인해 주세요." : null));
        return;
      }

      // 영수증 업로드: {학생회}/{기수}/{지출}/{파일}
      const supabase = createClient();
      const uploaded: string[] = [];
      for (const [i, photo] of photos.entries()) {
        setProgress(`영수증 올리는 중 (${i + 1}/${photos.length})…`);
        const blob = await resizeImage(photo.file);
        const path = `${created.organizationId}/${created.termId}/${created.expenseId}/${crypto.randomUUID()}.${extensionFor(blob.type)}`;
        const { error: uploadError } = await supabase.storage
          .from("receipts")
          .upload(path, blob, { contentType: blob.type || "image/jpeg", upsert: false });
        if (!uploadError) uploaded.push(path);
      }

      if (uploaded.length > 0) {
        setProgress("마무리하는 중…");
        const attached = await attachReceipts(created.expenseId, created.organizationId, created.termId, uploaded);
        if (!attached.ok) {
          setProgress(null);
          setError(`지출은 저장했지만 ${attached.error} 홈에서 다시 시도해 주세요.`);
          return;
        }
      }

      if (uploaded.length < photos.length) {
        setProgress(null);
        setError(
          `지출은 저장했지만 영수증 ${photos.length - uploaded.length}장을 올리지 못했어요. 홈에서 '영수증 필요' 건으로 다시 첨부해 주세요.`,
        );
        return;
      }

      router.push("/");
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {/* 영수증 사진 */}
      <section className="space-y-2">
        <p className="text-sm font-medium">
          영수증 <span className="font-normal text-zinc-500">({photos.length}/{MAX_RECEIPTS})</span>
        </p>
        {photos.length > 0 && (
          <ul className="grid grid-cols-3 gap-2">
            {photos.map((p) => (
              <li key={p.id} className="relative aspect-[3/4] overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
                {/* eslint-disable-next-line @next/next/no-img-element -- 로컬 미리보기(blob URL) */}
                <img src={p.url} alt="영수증 미리보기" className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => removePhoto(p.id)}
                  disabled={isPending}
                  className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-sm text-white"
                  aria-label="이 영수증 빼기"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        {photos.length < MAX_RECEIPTS && (
          <div className="grid grid-cols-2 gap-3">
            <PhotoPicker label="촬영하기" capture onPick={addPhotos} disabled={isPending} />
            <PhotoPicker label="앨범에서 선택" onPick={addPhotos} disabled={isPending} />
          </div>
        )}
        <p className="text-sm text-zinc-500">영수증이 없으면 비워 두고 나중에 첨부해도 돼요.</p>
      </section>

      {terms.length > 1 && (
        <Field label="학생회" htmlFor="termId" error={fieldErrors.termId}>
          <select
            id="termId"
            value={termId}
            onChange={(e) => {
              setTermId(e.target.value);
              setCategoryId("");
            }}
            className={inputClass}
          >
            {terms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field label="금액" htmlFor="amount" error={fieldErrors.amount}>
        <div className="relative">
          <input
            id="amount"
            inputMode="numeric"
            autoComplete="off"
            placeholder="0"
            value={amountText}
            onChange={(e) => {
              const n = parseAmount(e.target.value);
              setAmountText(n ? n.toLocaleString("ko-KR") : "");
            }}
            className={`${inputClass} pr-10 text-right text-lg font-semibold`}
            aria-invalid={Boolean(fieldErrors.amount)}
          />
          <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500">원</span>
        </div>
      </Field>

      <Field label="사용처" htmlFor="merchant" error={fieldErrors.merchant}>
        <input
          id="merchant"
          name="merchant"
          placeholder="예: ○○마트"
          maxLength={100}
          className={inputClass}
          aria-invalid={Boolean(fieldErrors.merchant)}
        />
      </Field>

      <Field label="사용일" htmlFor="spentOn" error={fieldErrors.spentOn}>
        <input id="spentOn" name="spentOn" type="date" defaultValue={today} max={today} className={inputClass} />
      </Field>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">행사</legend>
        <div className="flex flex-wrap gap-2">
          <Chip selected={categoryId === ""} onClick={() => setCategoryId("")}>
            미분류
          </Chip>
          {termCategories.map((c) => (
            <Chip key={c.id} selected={categoryId === c.id} onClick={() => setCategoryId(c.id)}>
              {c.name}
            </Chip>
          ))}
        </div>
        {fieldErrors.categoryId && <p className="text-sm text-red-600">{fieldErrors.categoryId}</p>}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">결제 수단</legend>
        <div className="grid grid-cols-3 gap-2">
          {PAYMENT_METHODS.map((m) => (
            <Chip key={m} selected={paymentMethod === m} onClick={() => setPaymentMethod(m)} wide>
              {PAYMENT_METHOD_LABELS[m]}
            </Chip>
          ))}
        </div>
      </fieldset>

      <Field label="품목" htmlFor="items" error={fieldErrors.items} optional>
        <input id="items" name="items" placeholder="예: 음료, 과자" maxLength={500} className={inputClass} />
      </Field>

      <Field label="메모" htmlFor="memo" error={fieldErrors.memo} optional>
        <textarea
          id="memo"
          name="memo"
          rows={2}
          maxLength={1000}
          className={`${inputClass} h-auto py-3`}
        />
      </Field>

      <button
        type="submit"
        disabled={isPending}
        className="h-12 w-full rounded-xl bg-blue-600 text-base font-medium text-white hover:bg-blue-700 disabled:opacity-60"
      >
        {isPending ? (progress ?? "저장하는 중…") : "저장"}
      </button>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  error,
  optional,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={htmlFor} className="block text-sm font-medium">
        {label} {optional && <span className="font-normal text-zinc-500">(선택)</span>}
      </label>
      {children}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

function Chip({
  selected,
  onClick,
  wide,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`h-10 rounded-full border px-4 text-sm transition ${wide ? "w-full" : ""} ${
        selected
          ? "border-blue-600 bg-blue-50 font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300"
          : "border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
      }`}
    >
      {children}
    </button>
  );
}

function PhotoPicker({
  label,
  capture,
  onPick,
  disabled,
}: {
  label: string;
  capture?: boolean;
  onPick: (files: FileList | null) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex h-12 cursor-pointer items-center justify-center rounded-xl border border-dashed border-zinc-400 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-900 ${
        disabled ? "pointer-events-none opacity-60" : ""
      }`}
    >
      {label}
      <input
        type="file"
        accept="image/*"
        multiple={!capture}
        capture={capture ? "environment" : undefined}
        className="sr-only"
        disabled={disabled}
        onChange={(e) => {
          onPick(e.target.files);
          e.target.value = "";
        }}
      />
    </label>
  );
}
