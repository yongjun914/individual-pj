"use client";

import { useActionState } from "react";

import { SubmitButton } from "@/components/submit-button";

import { createOrganization, type CreateOrgState } from "./actions";

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

      <Field label="기수" name="termName" error={e.termName} hint="감사 자료와 인수인계는 기수 단위로 나뉩니다.">
        <input
          id="termName"
          name="termName"
          defaultValue={v?.termName}
          placeholder="예: 2026년 제38대"
          maxLength={50}
          className={inputClass}
          aria-invalid={Boolean(e.termName)}
        />
      </Field>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">내 역할</legend>
        <div className="grid grid-cols-3 gap-3">
          <RoleOption value="president" label="학회장" defaultChecked={(v?.role ?? "president") === "president"} />
          <RoleOption value="vice_president" label="부학회장" defaultChecked={v?.role === "vice_president"} />
          <RoleOption value="treasurer" label="총무" defaultChecked={v?.role === "treasurer"} />
        </div>
        <p className="text-sm text-zinc-500">학생회를 만든 사람은 학생회원 관리(멤버 초대·역할·권한)를 할 수 있어요.</p>
        {e.role && <p className="text-sm text-red-600">{e.role}</p>}
      </fieldset>

      <SubmitButton pendingText="만드는 중…" className="btn-glow bg-blue-600 text-white hover:bg-blue-700">
        학생회 만들기
      </SubmitButton>
    </form>
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
