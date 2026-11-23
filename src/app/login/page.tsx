import type { Metadata } from "next";
import { Suspense } from "react";

import { SubmitButton } from "@/components/submit-button";
import { safeNextPath } from "@/lib/auth";

import { signInWithProvider } from "./actions";

export const metadata: Metadata = { title: "로그인" };

const ERROR_MESSAGES: Record<string, string> = {
  oauth: "로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  callback: "로그인을 마무리하지 못했습니다. 다시 시도해 주세요.",
  provider: "지원하지 않는 로그인 방식입니다.",
};

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8 px-6 py-16">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold">학생회 회계</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          영수증 정리부터 감사 자료까지 한 곳에서
        </p>
      </div>

      <Suspense fallback={<LoginButtons next="/" />}>
        <LoginForm searchParams={searchParams} />
      </Suspense>

      <p className="text-center text-xs text-zinc-500">
        로그인하면 학생회 회계 기록을 위해 카카오 닉네임(과 동의한 경우 이메일)을 저장합니다.
      </p>
    </main>
  );
}

async function LoginForm({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  const errorKey = typeof params.error === "string" ? params.error : undefined;
  const errorMessage = errorKey ? (ERROR_MESSAGES[errorKey] ?? ERROR_MESSAGES.callback) : null;

  return (
    <div className="space-y-4">
      {errorMessage && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {errorMessage}
        </p>
      )}
      <LoginButtons next={next} />
    </div>
  );
}

function LoginButtons({ next }: { next: string }) {
  return (
    <form action={signInWithProvider} className="space-y-3">
      <input type="hidden" name="next" value={next} />
      <SubmitButton
        name="provider"
        value="kakao"
        pendingText="카카오로 이동 중…"
        className="bg-[#FEE500] text-[#191919] hover:brightness-95"
      >
        카카오로 시작하기
      </SubmitButton>
    </form>
  );
}
