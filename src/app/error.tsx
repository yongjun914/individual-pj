"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-4 px-6 py-16 text-center">
      <h1 className="text-xl font-semibold">문제가 생겼어요</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        잠시 후 다시 시도해 주세요. 계속되면 총무에게 알려 주세요.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mx-auto h-11 rounded-full btn-glow bg-blue-600 px-6 font-medium text-white hover:bg-blue-700"
      >
        다시 시도
      </button>
    </main>
  );
}
