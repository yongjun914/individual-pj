"use client";

import { useState, useTransition } from "react";

import { ROLE_LABELS, ROLE_OPTIONS, roleLabel, type MemberRole } from "@/lib/roles";

import { cancelRoleRequest, decideRoleRequest, requestRoleChange, type RequestActionError } from "./actions";

const inputClass =
  "h-11 w-full rounded-xl border border-zinc-300 bg-white px-3 text-base outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 dark:border-zinc-700 dark:bg-zinc-900";
const primaryButton =
  "h-11 shrink-0 rounded-full btn-glow bg-blue-600 px-5 font-medium text-white hover:bg-blue-700 disabled:opacity-60";
const secondaryButton = "h-11 shrink-0 rounded-lg btn-brutal bg-white px-4 font-medium disabled:opacity-60 dark:bg-zinc-900";

function useRun() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function run(action: () => Promise<RequestActionError>, onDone?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result?.error) setError(result.error);
      else onDone?.();
    });
  }
  return { isPending, error, run };
}

function ErrorText({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
      {children}
    </p>
  );
}

function describe(role: string, position: string) {
  return position ? `${roleLabel(role)} · ${position}` : roleLabel(role);
}

// ---------------------------------------------------------------------
// 학생회원 관리: 받은 요청 승인·거절
// ---------------------------------------------------------------------

export type PendingRequest = {
  id: string;
  name: string;
  currentRole: MemberRole;
  currentPosition: string;
  requestedRole: MemberRole;
  requestedPosition: string;
  requestedAt: string;
};

export function RoleRequestRow({ request }: { request: PendingRequest }) {
  const { isPending, error, run } = useRun();
  return (
    <li className="space-y-3 rounded-2xl border border-blue-200 bg-blue-50/60 p-4 dark:border-blue-900 dark:bg-blue-950/40">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-lg font-semibold">{request.name}</p>
        <p className="text-sm text-zinc-500">{request.requestedAt}</p>
      </div>
      <p className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-white px-3 py-1 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
          {describe(request.currentRole, request.currentPosition)}
        </span>
        <span aria-hidden className="text-zinc-400">
          →
        </span>
        <span className="sr-only">에서</span>
        <span className="rounded-full bg-blue-600 px-3 py-1 text-sm font-semibold text-white">
          {describe(request.requestedRole, request.requestedPosition)}
        </span>
        <span className="sr-only">(으)로 바꿔 달라는 요청</span>
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={isPending}
          className={primaryButton}
          onClick={() => run(() => decideRoleRequest(request.id, true))}
        >
          {isPending ? "처리하는 중…" : "승인"}
        </button>
        <button
          type="button"
          disabled={isPending}
          className={secondaryButton}
          onClick={() => {
            if (confirm(`${request.name}님의 요청을 거절할까요?`)) run(() => decideRoleRequest(request.id, false));
          }}
        >
          거절
        </button>
      </div>
      {error && <ErrorText>{error}</ErrorText>}
    </li>
  );
}

// ---------------------------------------------------------------------
// 마이페이지: 내 직책 변경 요청
// ---------------------------------------------------------------------

export function MyRoleRequest({
  termId,
  role,
  position,
  pending,
}: {
  termId: string;
  role: MemberRole;
  position: string;
  pending: { id: string; requestedRole: MemberRole; requestedPosition: string; requestedAt: string } | null;
}) {
  const { isPending, error, run } = useRun();
  const [open, setOpen] = useState(false);
  const [nextRole, setNextRole] = useState<MemberRole>(pending?.requestedRole ?? role);
  const [nextPosition, setNextPosition] = useState(pending?.requestedPosition ?? position);
  const same = nextRole === role && nextPosition.trim() === position;

  if (pending && !open) {
    return (
      <div className="space-y-2 rounded-xl bg-amber-50 p-3 text-sm dark:bg-amber-950">
        <p className="text-amber-800 dark:text-amber-200">
          <strong>{describe(pending.requestedRole, pending.requestedPosition)}</strong>(으)로 바꿔 달라고 요청했어요. 학회장·부학회장이
          승인하면 바뀌어요. ({pending.requestedAt})
        </p>
        <div className="flex flex-wrap gap-4">
          <button type="button" className="font-medium text-blue-700 underline-offset-4 hover:underline dark:text-blue-300" onClick={() => setOpen(true)}>
            요청 내용 바꾸기
          </button>
          <button
            type="button"
            disabled={isPending}
            className="font-medium text-red-600 underline-offset-4 hover:underline disabled:opacity-50"
            onClick={() => run(() => cancelRoleRequest(pending.id))}
          >
            {isPending ? "취소하는 중…" : "요청 취소"}
          </button>
        </div>
        {error && <ErrorText>{error}</ErrorText>}
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        className="text-sm font-medium text-blue-700 underline decoration-blue-300 decoration-2 underline-offset-4 hover:decoration-blue-600 dark:text-blue-300"
        onClick={() => setOpen(true)}
      >
        역할·직책 변경 요청하기
      </button>
    );
  }

  return (
    <form
      className="space-y-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => requestRoleChange(termId, nextRole, nextPosition), () => setOpen(false));
      }}
    >
      <p className="text-sm text-zinc-500">학회장·부학회장이 승인하면 바뀌어요.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-sm text-zinc-500">바꿀 역할</span>
          <select value={nextRole} onChange={(e) => setNextRole(e.target.value as MemberRole)} className={inputClass}>
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-sm text-zinc-500">부서·직책 (선택)</span>
          <input
            value={nextPosition}
            onChange={(e) => setNextPosition(e.target.value)}
            maxLength={50}
            placeholder="예: 기획부 부장"
            className={inputClass}
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={isPending || same} className={primaryButton}>
          {isPending ? "보내는 중…" : "요청 보내기"}
        </button>
        <button type="button" className={secondaryButton} onClick={() => setOpen(false)}>
          닫기
        </button>
      </div>
      {error && <ErrorText>{error}</ErrorText>}
    </form>
  );
}
