"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";

import { SubmitButton } from "@/components/submit-button";

import { createOrganization, type CreateOrgState, type SameOrganization } from "./actions";
import { requestJoin } from "./join-actions";

const inputClass =
  "h-12 w-full rounded-xl border border-zinc-300 bg-white px-4 text-base outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 dark:border-zinc-700 dark:bg-zinc-900";

export function CreateOrgForm() {
  const [state, formAction] = useActionState<CreateOrgState, FormData>(createOrganization, {});
  const v = state.values;
  const e = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {state.error && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {state.error}
        </p>
      )}

      <Field label="학교" name="schoolName" error={e.schoolName}>
        <input
          id="schoolName"
          name="schoolName"
          defaultValue={v?.schoolName}
          placeholder="예: 천안대학교"
          maxLength={100}
          autoComplete="organization"
          className={inputClass}
          aria-invalid={Boolean(e.schoolName)}
        />
      </Field>

      <Field label="학생회 이름" name="name" error={e.name}>
        <input
          id="name"
          name="name"
          defaultValue={v?.name}
          placeholder="예: 컴퓨터공학과 학생회"
          maxLength={100}
          className={inputClass}
          aria-invalid={Boolean(e.name)}
        />
      </Field>

      <Field label="연도" name="termName" error={e.termName} hint="숫자만 쓰면 '2026년 ○○ 학생회'처럼 보여요. 감사 자료와 인수인계는 연도 단위로 나뉘어요.">
        <input
          id="termName"
          name="termName"
          defaultValue={v?.termName}
          placeholder="예: 2026"
          maxLength={50}
          className={inputClass}
          aria-invalid={Boolean(e.termName)}
        />
      </Field>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">내 역할</legend>
        <div className="grid grid-cols-2 gap-3">
          <RoleOption value="president" label="학회장" defaultChecked={(v?.role ?? "president") === "president"} />
          <RoleOption value="vice_president" label="부학회장" defaultChecked={v?.role === "vice_president"} />
        </div>
        <p className="text-sm text-zinc-500">총무는 학생회를 만든 뒤 초대 링크로 들어오면 돼요. 학회장·부학회장은 학생회원 관리(멤버 초대·역할·권한)를 할 수 있어요.</p>
        {e.role && <p className="text-sm text-red-600">{e.role}</p>}
      </fieldset>

      {state.duplicates && state.duplicates.length > 0 ? (
        <div className="space-y-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/40">
          <p role="alert" className="font-semibold text-amber-900 dark:text-amber-100">
            같은 이름의 학생회가 이미 있어요.
          </p>
          <p className="text-sm text-amber-900/80 dark:text-amber-100/80">
            우리 학생회라면 새로 만들지 말고 참여 요청을 보내 주세요. 학회장·부학회장이 승인하면 바로 함께 쓸 수 있어요.
          </p>
          <ul className="space-y-2">
            {state.duplicates.map((d) => (
              <DuplicateRow key={d.id} org={d} />
            ))}
          </ul>
          <SubmitButton
            name="allowDuplicate"
            value="1"
            pendingText="만드는 중…"
            className="btn-brutal rounded-lg! bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100"
          >
            다른 학생회예요, 그래도 만들기
          </SubmitButton>
        </div>
      ) : (
        <SubmitButton pendingText="만드는 중…" className="btn-glow bg-blue-600 text-white hover:bg-blue-700">
          학생회 만들기
        </SubmitButton>
      )}
    </form>
  );
}

/** 같은 이름 학생회 한 곳: 구분 정보 + 참여 요청 */
function DuplicateRow({ org }: { org: SameOrganization }) {
  const [isPending, startTransition] = useTransition();
  const [sent, setSent] = useState(org.requested);
  const [error, setError] = useState<string | null>(null);
  return (
    <li className="space-y-2 rounded-xl bg-white p-3 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">
            {org.schoolName} {org.name}
          </p>
          <p className="text-sm text-zinc-500">
            {[org.leader && `학회장 ${org.leader}`, `멤버 ${org.memberCount}명`, `${org.createdOn} 만듦`].filter(Boolean).join(" · ")}
          </p>
        </div>
        {org.isMember ? (
          <Link href="/" className="text-sm font-medium text-blue-700 underline-offset-4 hover:underline dark:text-blue-300">
            이미 참여 중 · 홈으로
          </Link>
        ) : sent ? (
          <span className="rounded-full bg-amber-100 px-3 py-1 text-sm text-amber-800 dark:bg-amber-900 dark:text-amber-100">
            승인 기다리는 중
          </span>
        ) : (
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const r = await requestJoin(org.id, "");
                if (r?.error) setError(r.error);
                else setSent(true);
              });
            }}
            className="h-10 rounded-full btn-glow bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isPending ? "보내는 중…" : "참여 요청 보내기"}
          </button>
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </li>
  );
}

function Field({
  label,
  name,
  error,
  hint,
  children,
}: {
  label: string;
  name: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={name} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : (
        hint && <p className="text-sm text-zinc-500">{hint}</p>
      )}
    </div>
  );
}

function RoleOption({ value, label, defaultChecked }: { value: string; label: string; defaultChecked: boolean }) {
  return (
    <label className="flex h-12 cursor-pointer items-center justify-center rounded-full border border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900 text-base has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50 has-[:checked]:font-medium has-[:checked]:text-blue-700 dark:has-[:checked]:bg-blue-950 dark:has-[:checked]:text-blue-300">
      <input type="radio" name="role" value={value} defaultChecked={defaultChecked} className="sr-only" />
      {label}
    </label>
  );
}
