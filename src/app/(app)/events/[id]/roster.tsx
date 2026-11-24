"use client";

import { useMemo, useState, useTransition } from "react";

import { JACKET_SIZES, type EventKind } from "@/lib/events";
import { parseRoster, type RosterError, type RosterRow } from "@/lib/roster-import";

import {
  addParticipant,
  deleteEvent,
  deleteParticipant,
  importParticipants,
  recordFeeIncome,
  setParticipantFlag,
  updateParticipant,
  type ParticipantInput,
} from "../actions";

export type Participant = {
  id: string;
  name: string;
  student_no: string;
  grade: number | null;
  paid: boolean;
  attended: boolean;
  fields: Record<string, string>;
  memo: string;
};

const inputClass =
  "h-11 w-full rounded-xl border border-zinc-300 bg-white px-3 text-base outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 dark:border-zinc-700 dark:bg-zinc-900";

function ErrorText({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
      {children}
    </p>
  );
}

/** 이름·학번·학년·추가 칸 입력 (추가·수정 공용) */
function ParticipantFields({
  kind,
  extraFields,
  value,
  onChange,
}: {
  kind: EventKind;
  extraFields: string[];
  value: ParticipantInput;
  onChange: (v: ParticipantInput) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <input
        value={value.name}
        onChange={(e) => onChange({ ...value, name: e.target.value })}
        maxLength={30}
        placeholder="이름 (필수)"
        aria-label="이름"
        className={inputClass}
      />
      <input
        value={value.studentNo}
        onChange={(e) => onChange({ ...value, studentNo: e.target.value })}
        inputMode="numeric"
        maxLength={10}
        placeholder="학번 2자리 (예: 24)"
        aria-label="학번"
        className={inputClass}
      />
      <input
        value={value.grade}
        onChange={(e) => onChange({ ...value, grade: e.target.value })}
        inputMode="numeric"
        maxLength={1}
        placeholder="학년 (선택)"
        aria-label="학년"
        className={inputClass}
      />
      {extraFields.map((f) =>
        kind === "jacket" && f === "사이즈" ? (
          <select
            key={f}
            value={value.fields[f] ?? ""}
            onChange={(e) => onChange({ ...value, fields: { ...value.fields, [f]: e.target.value } })}
            aria-label={f}
            className={inputClass}
          >
            <option value="">사이즈 선택</option>
            {JACKET_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        ) : (
          <input
            key={f}
            value={value.fields[f] ?? ""}
            onChange={(e) => onChange({ ...value, fields: { ...value.fields, [f]: e.target.value } })}
            maxLength={100}
            placeholder={f}
            aria-label={f}
            className={inputClass}
          />
        ),
      )}
    </div>
  );
}

const emptyInput = (): ParticipantInput => ({ name: "", studentNo: "", grade: "", fields: {}, memo: "" });

export function AddParticipant({ eventId, kind, extraFields }: { eventId: string; kind: EventKind; extraFields: string[] }) {
  const [isPending, startTransition] = useTransition();
  const [value, setValue] = useState<ParticipantInput>(emptyInput);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await addParticipant(eventId, value);
          if (result?.error) setError(result.error);
          else setValue(emptyInput());
        });
      }}
    >
      {error && <ErrorText>{error}</ErrorText>}
      <ParticipantFields kind={kind} extraFields={extraFields} value={value} onChange={setValue} />
      <button
        type="submit"
        disabled={isPending || !value.name.trim() || !value.studentNo.trim()}
        className="h-11 rounded-full btn-glow bg-blue-600 px-5 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {isPending ? "추가하는 중…" : "+ 명단에 추가"}
      </button>
    </form>
  );
}

type Filter = "all" | "unpaid" | "absent";

export function RosterTable({
  kind,
  extraFields,
  participants,
  canEdit,
}: {
  kind: EventKind;
  extraFields: string[];
  participants: Participant[];
  canEdit: boolean;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<"added" | "name" | "student">("added");

  const rows = useMemo(() => {
    const q = query.trim();
    const list = participants.filter((p) => {
      if (filter === "unpaid" && p.paid) return false;
      if (filter === "absent" && p.attended) return false;
      if (!q) return true;
      return p.name.includes(q) || p.student_no.includes(q) || Object.values(p.fields).some((v) => v.includes(q));
    });
    if (sort === "name") return [...list].sort((a, b) => a.name.localeCompare(b.name, "ko"));
    if (sort === "student") return [...list].sort((a, b) => a.student_no.localeCompare(b.student_no) || a.name.localeCompare(b.name, "ko"));
    return list;
  }, [participants, query, filter, sort]);

  if (participants.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-zinc-300 p-6 text-center text-zinc-500 dark:border-zinc-700">
        아직 명단이 없어요. 위에서 한 명씩 추가하거나, 구글폼 응답 시트를 붙여 넣어 한꺼번에 가져오세요.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="이름·학번 검색"
          aria-label="명단 검색"
          className={`${inputClass} md:max-w-xs`}
        />
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["all", `전체 ${participants.length}`],
              ["unpaid", `미납 ${participants.filter((p) => !p.paid).length}`],
              ["absent", `미참석 ${participants.filter((p) => !p.attended).length}`],
            ] as [Filter, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setFilter(k)}
              aria-pressed={filter === k}
              className={`h-10 rounded-full border px-4 text-sm ${
                filter === k
                  ? "border-blue-600 bg-blue-50 font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                  : "border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
              }`}
            >
              {label}
            </button>
          ))}
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            aria-label="정렬"
            className="h-10 rounded-full border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="added">추가한 순</option>
            <option value="name">이름순</option>
            <option value="student">학번순</option>
          </select>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
        <table className="w-full min-w-[36rem] text-left">
          <thead className="bg-zinc-50 text-sm text-zinc-500 dark:bg-zinc-900">
            <tr>
              <th className="px-3 py-2 font-medium">이름</th>
              <th className="px-3 py-2 font-medium">학번</th>
              <th className="px-3 py-2 font-medium">학년</th>
              {extraFields.map((f) => (
                <th key={f} className="px-3 py-2 font-medium">
                  {f}
                </th>
              ))}
              <th className="px-3 py-2 text-center font-medium">납부</th>
              <th className="px-3 py-2 text-center font-medium">참석</th>
              {canEdit && <th className="px-3 py-2" aria-label="수정" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {rows.map((p) => (
              <RosterRowView key={p.id} p={p} kind={kind} extraFields={extraFields} canEdit={canEdit} />
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <p className="text-center text-sm text-zinc-500">조건에 맞는 사람이 없어요.</p>}
    </div>
  );
}

function FlagBox({ id, flag, value, label, disabled }: { id: string; flag: "paid" | "attended"; value: boolean; label: string; disabled: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useState(value);
  // 서버에서 새 값이 오면 따라간다
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setOptimistic(value);
  }
  return (
    <input
      type="checkbox"
      checked={optimistic}
      disabled={disabled || isPending}
      aria-label={label}
      className="h-6 w-6 accent-blue-600"
      onChange={(e) => {
        const next = e.target.checked;
        setOptimistic(next);
        startTransition(async () => {
          const result = await setParticipantFlag(id, flag, next);
          if (result?.error) {
            setOptimistic(!next);
            alert(result.error);
          }
        });
      }}
    />
  );
}

function RosterRowView({ p, kind, extraFields, canEdit }: { p: Participant; kind: EventKind; extraFields: string[]; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<ParticipantInput>({
    name: p.name,
    studentNo: p.student_no,
    grade: p.grade ? String(p.grade) : "",
    fields: p.fields,
    memo: p.memo,
  });
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (editing) {
    return (
      <tr className="bg-blue-50/40 dark:bg-blue-950/20">
        <td colSpan={extraFields.length + 6} className="space-y-2 px-3 py-3">
          {error && <ErrorText>{error}</ErrorText>}
          <ParticipantFields kind={kind} extraFields={extraFields} value={value} onChange={setValue} />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  const result = await updateParticipant(p.id, value);
                  if (result?.error) setError(result.error);
                  else setEditing(false);
                });
              }}
              className="h-10 rounded-full btn-glow bg-blue-600 px-4 font-medium text-white disabled:opacity-50"
            >
              저장
            </button>
            <button type="button" onClick={() => setEditing(false)} className="text-sm text-zinc-500">
              취소
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                if (!confirm(`${p.name}님을 명단에서 지울까요?`)) return;
                startTransition(async () => {
                  const result = await deleteParticipant(p.id);
                  if (result?.error) setError(result.error);
                });
              }}
              className="ml-auto text-sm text-red-600"
            >
              명단에서 지우기
            </button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="hover:bg-zinc-50 dark:hover:bg-zinc-900">
      <td className="px-3 py-2 font-medium">{p.name}</td>
      <td className="px-3 py-2 tabular-nums">{p.student_no}</td>
      <td className="px-3 py-2 text-zinc-500">{p.grade ?? "-"}</td>
      {extraFields.map((f) => (
        <td key={f} className="max-w-48 truncate px-3 py-2 text-zinc-600 dark:text-zinc-400">
          {p.fields[f] || "-"}
        </td>
      ))}
      <td className="px-3 py-2 text-center">
        <FlagBox id={p.id} flag="paid" value={p.paid} label={`${p.name} 납부`} disabled={!canEdit} />
      </td>
      <td className="px-3 py-2 text-center">
        <FlagBox id={p.id} flag="attended" value={p.attended} label={`${p.name} 참석`} disabled={!canEdit} />
      </td>
      {canEdit && (
        <td className="px-3 py-2 text-right">
          <button type="button" onClick={() => setEditing(true)} className="text-sm text-blue-600 underline-offset-4 hover:underline">
            수정
          </button>
        </td>
      )}
    </tr>
  );
}

/** 구글폼 응답 시트(또는 엑셀)를 붙여 넣어 한꺼번에 가져오기 */
export function PasteImport({ eventId, extraFields }: { eventId: string; extraFields: string[] }) {
  const [isPending, startTransition] = useTransition();
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<{ rows: RosterRow[]; errors: RosterError[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  return (
    <div className="space-y-3">
      <ol className="list-decimal space-y-1 pl-5 text-sm text-zinc-600 dark:text-zinc-400">
        <li>구글폼 → 응답 → 스프레드시트(시트)에서 보기를 눌러요.</li>
        <li>머리글 줄(이름·학번…)부터 마지막 응답까지 칸을 선택해 복사(Ctrl+C)해요.</li>
        <li>아래 칸에 붙여 넣고(Ctrl+V) &lsquo;미리 보기&rsquo;를 눌러요.</li>
      </ol>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setPreview(null);
          setDone(null);
        }}
        rows={6}
        placeholder={"이름\t학번\t학년\n홍길동\t24\t1"}
        aria-label="붙여 넣을 명단"
        className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 font-mono text-sm outline-none focus:border-blue-600 dark:border-zinc-700 dark:bg-zinc-900"
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!text.trim()}
          onClick={() => setPreview(parseRoster(text, extraFields))}
          className="h-11 rounded-lg btn-brutal bg-white dark:bg-zinc-900 px-4 font-medium disabled:opacity-50"
        >
          미리 보기
        </button>
        {preview && preview.rows.length > 0 && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result = await importParticipants(
                  eventId,
                  preview.rows.map(({ name, student_no, grade, fields }) => ({ name, student_no, grade, fields })),
                );
                if (!result.ok) {
                  setError(result.error);
                  return;
                }
                setDone(result.added);
                setText("");
                setPreview(null);
              });
            }}
            className="h-11 rounded-full btn-glow bg-blue-600 px-4 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isPending ? "가져오는 중…" : `${preview.rows.length}명 가져오기`}
          </button>
        )}
      </div>
      {error && <ErrorText>{error}</ErrorText>}
      {done !== null && (
        <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800 dark:bg-green-950 dark:text-green-200">
          {done}명을 명단에 넣었어요.
        </p>
      )}
      {preview && (
        <div className="space-y-2 text-sm">
          <p>
            읽은 사람 <strong>{preview.rows.length}명</strong>
            {preview.errors.length > 0 && (
              <span className="text-amber-700 dark:text-amber-300"> · 가져오지 않는 줄 {preview.errors.length}개</span>
            )}
          </p>
          {preview.rows.length > 0 && (
            <ul className="max-h-48 space-y-0.5 overflow-y-auto rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
              {preview.rows.map((r) => (
                <li key={r.line}>
                  {r.name} · {r.student_no}학번{r.grade ? ` · ${r.grade}학년` : ""}
                  {Object.entries(r.fields).length > 0 &&
                    ` · ${Object.entries(r.fields)
                      .map(([k, v]) => `${k} ${v}`)
                      .join(", ")}`}
                </li>
              ))}
            </ul>
          )}
          {preview.errors.length > 0 && (
            <ul className="space-y-0.5 text-amber-800 dark:text-amber-200">
              {preview.errors.map((e) => (
                <li key={e.line}>
                  {e.line}번째 줄: {e.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** 명단을 엑셀로 내려받기 (출석부 인쇄, 과잠 업체 주문용) */
export function ExportRoster({ eventName, extraFields, participants }: { eventName: string; extraFields: string[]; participants: Participant[] }) {
  const [isPending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={isPending || participants.length === 0}
      onClick={() =>
        startTransition(async () => {
          const XLSX = await import("xlsx");
          const header = ["번호", "이름", "학번", "학년", ...extraFields, "납부", "참석", "메모"];
          const body = participants.map((p, i) => [
            i + 1,
            p.name,
            p.student_no,
            p.grade ?? "",
            ...extraFields.map((f) => p.fields[f] ?? ""),
            p.paid ? "O" : "",
            p.attended ? "O" : "",
            p.memo,
          ]);
          const sheet = XLSX.utils.aoa_to_sheet([[`${eventName} 명단`], [], header, ...body]);
          sheet["!cols"] = header.map((h) => ({ wch: h === "이름" ? 10 : h === "메모" ? 24 : Math.max(6, h.length * 2 + 2) }));
          const wb = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(wb, sheet, "명단");
          const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
          const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
          const a = document.createElement("a");
          a.href = url;
          a.download = `${eventName.replace(/[\\/:*?"<>|]+/g, "")}_명단.xlsx`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 10_000);
        })
      }
      className="h-11 rounded-lg btn-brutal bg-white dark:bg-zinc-900 px-4 font-medium disabled:opacity-50"
    >
      엑셀로 내려받기
    </button>
  );
}

export function FeeIncomeButton({ eventId, recorded }: { eventId: string; recorded: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await recordFeeIncome(eventId);
            setMessage(
              result.ok
                ? { ok: true, text: `수입 ${result.amount.toLocaleString("ko-KR")}원으로 기록했어요. 결산내역서 '별도 납입'에 들어가요.` }
                : { ok: false, text: result.error },
            );
          })
        }
        className="h-11 rounded-lg bg-green-300 px-4 font-medium text-green-950 hover:bg-green-400 disabled:opacity-50"
      >
        {isPending ? "기록하는 중…" : recorded ? "납부 현황으로 수입 금액 고치기" : "납부한 참가비를 수입으로 기록"}
      </button>
      {message && (
        <p className={`text-sm ${message.ok ? "text-green-700 dark:text-green-400" : "text-red-600"}`}>{message.text}</p>
      )}
    </div>
  );
}

export function DeleteEventButton({ eventId }: { eventId: string }) {
  const [isPending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => {
        if (!confirm("이 행사를 지울까요? 명단도 함께 보이지 않게 돼요. 연결된 지출 분류와 지출은 그대로 남아요.")) return;
        startTransition(async () => {
          const result = await deleteEvent(eventId);
          if (result?.error) alert(result.error);
        });
      }}
      className="h-11 rounded-xl border border-red-300 px-4 font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:hover:bg-red-950"
    >
      {isPending ? "지우는 중…" : "행사 지우기"}
    </button>
  );
}
