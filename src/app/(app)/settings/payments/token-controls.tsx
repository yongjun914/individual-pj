"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { issueWebhookToken, revokeWebhookToken } from "./actions";

const inputClass =
  "h-11 w-full rounded-xl border border-zinc-300 bg-white px-3 text-base outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 dark:border-zinc-700 dark:bg-zinc-900";

/** 토큰 발급 폼. 발급 직후 토큰과 웹훅 주소를 한 번만 보여 준다. */
export function IssueTokenForm({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ token: string; endpoint: string } | null>(null);

  function issue() {
    setError(null);
    startTransition(async () => {
      const result = await issueWebhookToken(organizationId, label || "내 폰");
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setIssued({ token: result.token, endpoint: `${window.location.origin}/api/payments` });
      setLabel("");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {issued && (
        <div className="space-y-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm dark:border-blue-900 dark:bg-blue-950">
          <p className="font-medium text-blue-900 dark:text-blue-100">
            토큰은 지금 한 번만 보여요. 폰 설정에 바로 넣어 주세요.
          </p>
          <CopyField label="웹훅 주소" value={issued.endpoint} />
          <CopyField label="헤더 Authorization 값" value={`Bearer ${issued.token}`} />
          <button
            type="button"
            onClick={() => setIssued(null)}
            className="text-sm text-blue-700 underline-offset-4 hover:underline dark:text-blue-300"
          >
            설정을 마쳤어요 (닫기)
          </button>
        </div>
      )}

      <div className="flex gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={50}
          placeholder="이름 (예: 총무 아이폰)"
          aria-label="토큰 이름"
          className={inputClass}
        />
        <button
          type="button"
          onClick={issue}
          disabled={isPending}
          className="h-11 shrink-0 rounded-full btn-glow bg-blue-600 px-4 font-medium text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {isPending ? "만드는 중…" : "토큰 발급"}
        </button>
      </div>
    </div>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1">
      <p className="text-zinc-600 dark:text-zinc-400">{label}</p>
      <div className="flex gap-2">
        <code className="min-w-0 flex-1 break-all rounded-lg bg-white px-3 py-2 text-xs dark:bg-zinc-900">{value}</code>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              setCopied(false);
            }
          }}
          className="shrink-0 rounded-lg border border-zinc-300 px-3 text-xs dark:border-zinc-700"
        >
          {copied ? "복사됨" : "복사"}
        </button>
      </div>
    </div>
  );
}

/** 토큰 폐기 버튼 */
export function RevokeTokenButton({ tokenId, label }: { tokenId: string; label: string }) {
  const [isPending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => {
        if (!confirm(`'${label}' 토큰을 폐기할까요? 이 토큰을 쓰는 폰은 더 이상 문자를 보낼 수 없어요.`)) return;
        startTransition(async () => {
          const result = await revokeWebhookToken(tokenId);
          if (result?.error) alert(result.error);
        });
      }}
      className="text-sm text-red-600 underline-offset-4 hover:underline disabled:opacity-50"
    >
      {isPending ? "폐기 중…" : "폐기"}
    </button>
  );
}
