"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { EVENT_KIND_LABELS, EVENT_KINDS, KIND_EXTRA_FIELDS, suggestEventName, type EventKind } from "@/lib/events";

import { createEvent, updateEvent, type EventFieldErrors, type EventInput } from "./actions";

export type EventTermOption = { id: string; label: string };
export type EditingEvent = EventInput & { id: string };

/** 구글폼을 새로 만드는 주소 (로그인한 구글 계정으로 빈 폼이 열린다) */
export const GOOGLE_FORM_NEW_URL = "https://docs.google.com/forms/create";

const inputClass =
  "h-12 w-full rounded-xl border border-zinc-300 bg-white px-4 text-base outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 dark:border-zinc-700 dark:bg-zinc-900";

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">
        {label} {hint && <span className="font-normal text-zinc-500">{hint}</span>}
      </p>
      {children}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

/** 행사 만들기·수정 폼. `event`를 넘기면 수정 모드 */
export function EventForm({ terms, year, event }: { terms: EventTermOption[]; year: number; event?: EditingEvent }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<EventFieldErrors>({});

  const [termId, setTermId] = useState(event?.termId ?? terms[0]?.id ?? "");
  const [kind, setKind] = useState<EventKind>((event?.kind as EventKind) ?? "opening");
  const [name, setName] = useState(event?.name ?? suggestEventName("opening", year));
  const [nameTouched, setNameTouched] = useState(Boolean(event));
  const [feeText, setFeeText] = useState(event ? event.fee.toLocaleString("ko-KR") : "");
  const [extraFields, setExtraFields] = useState<string[]>(event?.extraFields ?? KIND_EXTRA_FIELDS.opening);
  const [newField, setNewField] = useState("");

  function pickKind(k: EventKind) {
    setKind(k);
    if (!nameTouched) setName(suggestEventName(k, year));
    if (!event) setExtraFields(KIND_EXTRA_FIELDS[k]);
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const input: EventInput = {
      termId,
      kind,
      name,
      startsOn: String(form.get("startsOn") ?? ""),
      endsOn: String(form.get("endsOn") ?? ""),
      place: String(form.get("place") ?? ""),
      fee: Number(feeText.replace(/\D/g, "") || 0),
      capacity: String(form.get("capacity") ?? "").trim(),
      formUrl: String(form.get("formUrl") ?? ""),
      extraFields,
      memo: String(form.get("memo") ?? ""),
    };
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = event ? await updateEvent(event.id, input) : await createEvent(input);
      if (!result.ok) {
        setFieldErrors(result.fieldErrors ?? {});
        setError(result.error ?? (result.fieldErrors ? "입력한 내용을 확인해 주세요." : null));
        return;
      }
      router.push(`/events/${result.id}`);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {!event && terms.length > 1 && (
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

      <Field label="행사 종류" error={fieldErrors.kind}>
        <div className="flex flex-wrap gap-2">
          {EVENT_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => pickKind(k)}
              aria-pressed={kind === k}
              className={`h-10 rounded-full border px-4 text-sm ${
                kind === k
                  ? "border-blue-600 bg-blue-50 font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                  : "border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
              }`}
            >
              {EVENT_KIND_LABELS[k]}
            </button>
          ))}
        </div>
      </Field>

      <Field label="행사 이름" hint="(지출 분류 이름으로도 쓰여요)" error={fieldErrors.name}>
        <input
          value={name}
          onChange={(e) => {
            setNameTouched(true);
            setName(e.target.value);
          }}
          maxLength={50}
          placeholder="예: 2026 개강총회"
          className={inputClass}
          aria-label="행사 이름"
        />
      </Field>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="시작일" hint="(선택)" error={fieldErrors.startsOn}>
          <input name="startsOn" type="date" defaultValue={event?.startsOn} className={inputClass} aria-label="시작일" />
        </Field>
        <Field label="끝나는 날" hint="(MT처럼 여러 날일 때)" error={fieldErrors.endsOn}>
          <input name="endsOn" type="date" defaultValue={event?.endsOn} className={inputClass} aria-label="끝나는 날" />
        </Field>
        <Field label="장소" hint="(선택)" error={fieldErrors.place}>
          <input name="place" defaultValue={event?.place} maxLength={100} placeholder="예: 삼구포차" className={inputClass} aria-label="장소" />
        </Field>
        <Field label={kind === "jacket" ? "1벌 가격" : "참가비"} hint="(없으면 비워 두세요)" error={fieldErrors.fee}>
          <div className="relative">
            <input
              inputMode="numeric"
              value={feeText}
              onChange={(e) => {
                const n = Number(e.target.value.replace(/\D/g, "") || 0);
                setFeeText(n ? n.toLocaleString("ko-KR") : "");
              }}
              placeholder="0"
              className={`${inputClass} pr-10 text-right`}
              aria-label="참가비"
            />
            <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500">원</span>
          </div>
        </Field>
        <Field label="정원" hint="(선택)" error={fieldErrors.capacity}>
          <input name="capacity" inputMode="numeric" defaultValue={event?.capacity} placeholder="예: 80" className={inputClass} aria-label="정원" />
        </Field>
      </div>

      <Field label="명단 추가 칸" hint="(이름·학번·학년·납부·참석은 기본으로 있어요)" error={fieldErrors.extraFields}>
        <div className="flex flex-wrap gap-2">
          {extraFields.length === 0 && <span className="text-sm text-zinc-500">추가 칸 없음</span>}
          {extraFields.map((f) => (
            <span key={f} className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-3 py-1 text-sm dark:bg-zinc-800">
              {f}
              <button
                type="button"
                onClick={() => setExtraFields(extraFields.filter((x) => x !== f))}
                aria-label={`${f} 칸 빼기`}
                className="text-zinc-500 hover:text-red-600"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={newField}
            onChange={(e) => setNewField(e.target.value)}
            maxLength={20}
            placeholder="칸 이름 (예: 식사 여부)"
            className={inputClass}
            aria-label="추가할 칸 이름"
          />
          <button
            type="button"
            disabled={!newField.trim() || extraFields.length >= 10 || extraFields.includes(newField.trim())}
            onClick={() => {
              setExtraFields([...extraFields, newField.trim()]);
              setNewField("");
            }}
            className="h-12 shrink-0 rounded-lg btn-brutal bg-white dark:bg-zinc-900 px-4 font-medium disabled:opacity-50"
          >
            칸 추가
          </button>
        </div>
      </Field>

      <Field label="구글폼 신청 링크" hint="(신청을 링크로 받을 때만)" error={fieldErrors.formUrl}>
        <div className="space-y-2 rounded-xl bg-zinc-50 p-4 text-sm dark:bg-zinc-900">
          <p className="text-zinc-600 dark:text-zinc-400">
            구글폼에 &lsquo;이름&rsquo;, &lsquo;학번(예: 24)&rsquo; 질문을 꼭 넣어 주세요. 응답은 행사 화면에서 시트를 복사해 붙여 넣으면
            명단으로 들어와요.
          </p>
          <a
            href={GOOGLE_FORM_NEW_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-10 items-center rounded-lg bg-white px-3 font-medium text-blue-700 shadow-sm hover:bg-blue-50 dark:bg-zinc-800 dark:text-blue-300"
          >
            구글폼 만들러 가기 ↗
          </a>
        </div>
        <input
          name="formUrl"
          type="url"
          defaultValue={event?.formUrl}
          placeholder="만든 구글폼 주소를 붙여 넣으세요 (https://forms.gle/…)"
          className={inputClass}
          aria-label="구글폼 주소"
        />
      </Field>

      <Field label="메모" hint="(선택)" error={fieldErrors.memo}>
        <textarea name="memo" defaultValue={event?.memo} rows={3} maxLength={1000} className={`${inputClass} h-auto py-3`} aria-label="메모" />
      </Field>

      <button
        type="submit"
        disabled={isPending}
        className="h-12 w-full rounded-full btn-glow bg-blue-600 text-base font-medium text-white hover:bg-blue-700 disabled:opacity-60"
      >
        {isPending ? "저장하는 중…" : event ? "행사 정보 저장" : "행사 만들기"}
      </button>
    </form>
  );
}
