"use client";

import { useState, useTransition } from "react";

import { cancelJoinRequest, requestJoin, searchOrganizations, type FoundOrganization } from "./join-actions";

const inputClass =
  "h-12 w-full rounded-xl border border-zinc-300 bg-white px-4 text-base outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 dark:border-zinc-700 dark:bg-zinc-900";
const primaryButton =
  "h-11 shrink-0 rounded-full btn-glow bg-blue-600 px-5 font-medium text-white hover:bg-blue-700 disabled:opacity-50";

function Alert({ ok, children }: { ok: boolean; children: React.ReactNode }) {
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

/** 이미 있는 학생회를 찾아 참여 요청 보내기 */
export function JoinRequestFinder() {
  const [isSearching, startSearch] = useTransition();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FoundOrganization[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          startSearch(async () => {
            const r = await searchOrganizations(query);
            if (!r.ok) {
              setError(r.error);
              setResults(null);
            } else setResults(r.items);
          });
        }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="예: 상명대 전자공학과"
          aria-label="학교·학생회 이름"
          maxLength={50}
          className={inputClass}
        />
        <button type="submit" disabled={isSearching || query.trim().length < 2} className={`${primaryButton} h-12`}>
          {isSearching ? "찾는 중…" : "찾기"}
        </button>
      </form>
      {error && <Alert ok={false}>{error}</Alert>}
      {results && results.length === 0 && (
        <p className="text-sm text-zinc-500">찾는 학생회가 없어요. 이름을 다르게 써 보거나, 아래에서 새로 만들어 주세요.</p>
      )}
      {results && results.length > 0 && (
        <ul className="space-y-2">
          {results.map((org) => (
            <FoundRow key={org.id} org={org} />
          ))}
        </ul>
      )}
    </div>
  );
}

function FoundRow({ org }: { org: FoundOrganization }) {
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(org.requested);
  const [error, setError] = useState<string | null>(null);

  return (
    <li className="space-y-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-zinc-500">{org.schoolName}</p>
          <p className="truncate font-semibold">{org.name}</p>
        </div>
        {sent ? (
          <span className="shrink-0 rounded-full bg-amber-50 px-3 py-1 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            승인 기다리는 중
          </span>
        ) : (
          !open && (
            <button type="button" onClick={() => setOpen(true)} className="h-10 shrink-0 rounded-lg btn-brutal bg-white px-3 text-sm font-medium dark:bg-zinc-900">
              참여 요청 보내기
            </button>
          )
        )}
      </div>
      {open && !sent && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            startTransition(async () => {
              const r = await requestJoin(org.id, message);
              if (r?.error) setError(r.error);
              else setSent(true);
            });
          }}
        >
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={200}
            placeholder="남길 말 (선택) 예: 24학번 홍길동, 기획부예요"
            aria-label="학회장·부학회장에게 남길 말"
            className={inputClass}
          />
          <div className="flex gap-2">
            <button type="submit" disabled={isPending} className={primaryButton}>
              {isPending ? "보내는 중…" : "요청 보내기"}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="px-2 text-sm text-zinc-500">
              닫기
            </button>
          </div>
        </form>
      )}
      {error && <Alert ok={false}>{error}</Alert>}
    </li>
  );
}

/** 내가 보낸 요청 목록 (진행 중이면 취소할 수 있다) */
export function MyJoinRequests({
  requests,
}: {
  requests: { id: string; label: string; status: "pending" | "approved" | "rejected" | "cancelled"; createdAt: string }[];
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const STATUS: Record<string, { text: string; style: string }> = {
    pending: { text: "승인 기다리는 중", style: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200" },
    approved: { text: "승인됨", style: "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200" },
    rejected: { text: "거절됨", style: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300" },
    cancelled: { text: "취소함", style: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" },
  };

  return (
    <div className="space-y-2">
      <ul className="space-y-2">
        {requests.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
            <div className="min-w-0">
              <p className="truncate font-medium">{r.label}</p>
              <p className="text-sm text-zinc-500">{r.createdAt}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className={`rounded-full px-3 py-1 text-sm ${STATUS[r.status].style}`}>{STATUS[r.status].text}</span>
              {r.status === "pending" && (
                <button
                  type="button"
                  disabled={isPending}
                  className="text-sm text-red-600 underline-offset-4 hover:underline disabled:opacity-50"
                  onClick={() => {
                    setError(null);
                    startTransition(async () => {
                      const result = await cancelJoinRequest(r.id);
                      if (result?.error) setError(result.error);
                    });
                  }}
                >
                  취소
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {error && <Alert ok={false}>{error}</Alert>}
    </div>
  );
}
