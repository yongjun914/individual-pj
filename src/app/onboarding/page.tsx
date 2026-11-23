import type { Metadata } from "next";
import Link from "next/link";

import { CreateOrgForm } from "./create-org-form";

export const metadata: Metadata = { title: "학생회 만들기" };

export default function OnboardingPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-8 px-6 py-12">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">학생회 만들기</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          학생회를 만들면 다른 집행부원을 초대할 수 있어요.
        </p>
      </div>

      <CreateOrgForm />

      <div className="space-y-1 rounded-xl bg-zinc-100 px-4 py-3 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
        <p className="font-medium text-zinc-800 dark:text-zinc-200">초대를 받으셨나요?</p>
        <p>총무나 회장에게 받은 초대 링크를 열면 바로 참여할 수 있어요.</p>
      </div>

      <Link href="/" className="text-center text-sm text-zinc-500 underline-offset-4 hover:underline">
        홈으로
      </Link>
    </main>
  );
}
