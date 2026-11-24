"use client";

import { useMemo, useState, useTransition } from "react";

import { parseRoster, type RosterError, type RosterRow } from "@/lib/roster-import";

import { addDuesPayers, removeDuesPayer } from "./actions";

const inputClass =
  "h-11 w-full rounded-xl border border-zinc-300 bg-white px-3 text-base outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 dark:border-zinc-700 dark:bg-zinc-900";
const primaryButton =
  "h-11 shrink-0 rounded-full btn-glow bg-blue-600 px-5 font-medium text-white hover:bg-blue-700 disabled:opacity-50";
const secondaryButton = "h-11 shrink-0 rounded-lg btn-brutal bg-white px-4 font-medium disabled:opacity-50 dark:bg-zinc-900";

function Message({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <p
      role={ok ? "status" : "alert"}
      className={`rounded-lg px-3 py-2 text-sm ${
        ok ? "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200" : "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
      }`}
    >
      {children}
    </p>
  );
}

/** 붙여 넣기 + 한 명씩 추가 */
export function DuesPaste({ termId }: { termId: string }) {
  const [isPending, startTransition] = useTransition();
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<{ rows: RosterRow[]; errors: RosterError[] } | null>(null);
  const [name, setName] = useState("");
  const [studentNo, setStudentNo] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function add(people: { name: string; student_no: string }[], onDone: () => void) {
    setMessage(null);
    startTransition(async () => {
      const result = await addDuesPayers(termId, people);
      if (!result.ok) {
        setMessage({ ok: false, text: result.error });
        return;
      }
      setMessage({
        ok: true,
        text: `${result.added}명을 넣었어요.${result.skipped > 0 ? ` (이미 있던 ${result.skipped}명은 건너뜀)` : ""} 행사 명단의 같은 사람은 납부로 바뀌었어요.`,
      });
      onDone();
    });
  }

  return (
    <div className="space-y-4">
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          add([{ name, student_no: studentNo }], () => {
            setName("");
            setStudentNo("");
          });
        }}
      >
        <p className="text-sm font-medium">한 명씩</p>
        <div className="grid grid-cols-[1fr_7rem] gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={30} placeholder="이름" aria-label="이름" className={inputClass} />
          <input
            value={studentNo}
            onChange={(e) => setStudentNo(e.target.value)}
            inputMode="numeric"
            maxLength={10}
            placeholder="학번 (24)"
            aria-label="학번"
            className={inputClass}
          />
        </div>
        <button type="submit" disabled={isPending || !name.trim() || !studentNo.trim()} className={primaryButton}>
          + 추가
        </button>
      </form>

      <div className="space-y-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <p className="text-sm font-medium">여러 명 붙여 넣기</p>
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setPreview(null);
          }}
          rows={6}
          placeholder={"이름\t학번\n홍길동\t24\n김학생\t23"}
          aria-label="붙여 넣을 납부자 명단"
          className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 font-mono text-sm outline-none focus:border-blue-600 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!text.trim()} onClick={() => setPreview(parseRoster(text, []))} className={secondaryButton}>
            미리 보기
          </button>
          {preview && preview.rows.length > 0 && (
            <button
              type="button"
              disabled={isPending}
              className={primaryButton}
              onClick={() =>
                add(
                  preview.rows.map((r) => ({ name: r.name, student_no: r.student_no })),
                  () => {
                    setText("");
                    setPreview(null);
                  },
                )
              }
            >
              {isPending ? "넣는 중…" : `${preview.rows.length}명 넣기`}
            </button>
          )}
        </div>
        {preview && (
          <div className="space-y-1 text-sm">
            <p>
              읽은 사람 <strong>{preview.rows.length}명</strong>
              {preview.errors.length > 0 && <span className="text-amber-700 dark:text-amber-300"> · 넣지 않는 줄 {preview.errors.length}개</span>}
            </p>
            {preview.errors.length > 0 && (
              <ul className="space-y-0.5 text-amber-800 dark:text-amber-200">
                {preview.errors.slice(0, 10).map((e) => (
                  <li key={e.line}>
                    {e.line}번째 줄: {e.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {message && <Message ok={message.ok}>{message.text}</Message>}
    </div>
  );
}

/** 납부자 목록: 검색 + 빼기 */
export function DuesList({ payers, canEdit }: { payers: { id: string; name: string; studentNo: string }[]; canEdit: boolean }) {
  const [query, setQuery] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(() => {
    const q = query.trim();
    return q ? payers.filter((p) => p.name.includes(q) || p.studentNo.includes(q)) : payers;
  }, [payers, query]);

  const byYear = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of payers) map.set(p.studentNo, (map.get(p.studentNo) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [payers]);

  if (payers.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-zinc-300 p-6 text-center text-zinc-500 dark:border-zinc-700">
        아직 넣은 납부자가 없어요. 오른쪽에서 이름·학번을 붙여 넣어 주세요.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 text-sm">
        {byYear.map(([no, n]) => (
          <span key={no} className="rounded-full bg-blue-50 px-3 py-1 text-blue-800 dark:bg-blue-950 dark:text-blue-200">
            {no}학번 {n}명
          </span>
        ))}
      </div>
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="이름·학번 검색" aria-label="납부자 검색" className={`${inputClass} md:max-w-xs`} />
      {error && <Message ok={false}>{error}</Message>}
      <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {rows.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <span>
              <span className="font-medium">{p.name}</span> <span className="text-zinc-500 tabular-nums">{p.studentNo}학번</span>
            </span>
            {canEdit && (
              <button
                type="button"
                disabled={isPending}
                className="text-sm text-red-600 underline-offset-4 hover:underline disabled:opacity-50"
                onClick={() => {
                  if (!confirm(`${p.name}님을 학회비 납부자에서 뺄까요? 학회비로 면제된 행사 납부도 함께 풀려요.`)) return;
                  setError(null);
                  startTransition(async () => {
                    const result = await removeDuesPayer(p.id);
                    if (result?.error) setError(result.error);
                  });
                }}
              >
                빼기
              </button>
            )}
          </li>
        ))}
      </ul>
      {rows.length === 0 && <p className="text-center text-sm text-zinc-500">찾는 사람이 없어요.</p>}
    </div>
  );
}
