"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { extensionFor, resizeImage } from "@/lib/image";
import { createClient } from "@/lib/supabase/client";

import { attachReceipts } from "../new/actions";
import { PhotoPicker } from "../new/expense-form";
import { deleteExpense, deleteReceipt, submitMissingReason, withdrawMissingReason } from "./actions";

/**
 * 영수증 분실 사유서 (F-11).
 * - 사유서 상태: 사유를 보여 주고, 고치거나 취소할 수 있다.
 * - 영수증 필요 상태(영수증 0장): 사유서를 쓸 수 있다.
 */
export function MissingReasonPanel({
  expenseId,
  reason,
  excused,
  canEdit,
}: {
  expenseId: string;
  reason: string | null;
  excused: boolean;
  canEdit: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(reason ?? "");
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await submitMissingReason(expenseId, text);
      if (result?.error) setError(result.error);
      else setEditing(false);
    });
  }

  function withdraw() {
    if (!confirm("사유서를 취소하고 '영수증 필요'로 되돌릴까요?")) return;
    setError(null);
    startTransition(async () => {
      const result = await withdrawMissingReason(expenseId);
      if (result?.error) setError(result.error);
      else setText("");
    });
  }

  if (!excused && !editing) {
    return (
      <section className="space-y-2 rounded-2xl border border-dashed border-zinc-300 p-4 text-sm dark:border-zinc-700">
        <p className="text-zinc-600 dark:text-zinc-400">
          영수증을 잃어버렸나요? 분실 사유서를 쓰면 감사 자료에 영수증 대신 사유가 들어가요.
        </p>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="font-medium text-blue-600 underline-offset-4 hover:underline"
        >
          분실 사유서 쓰기
        </button>
      </section>
    );
  }

  return (
    <section className="space-y-3 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="text-sm font-medium">영수증 분실 사유서</h2>
      {error && <ErrorText>{error}</ErrorText>}

      {editing ? (
        <>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            maxLength={1000}
            placeholder={"예: 행사 당일 영수증을 받았으나 이동 중 분실했습니다. 카드 승인 문자와 통장 거래내역으로 결제를 확인할 수 있습니다."}
            aria-label="분실 사유"
            className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-base outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 dark:border-zinc-700 dark:bg-zinc-900"
          />
          <p className="text-xs text-zinc-500">
            언제·어떻게 잃어버렸는지, 결제를 무엇으로 확인할 수 있는지(카드 내역, 거래내역 등) 적어 주세요. ({text.trim().length}
            /1000자, 10자 이상)
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={isPending || text.trim().length < 10}
              className="h-11 flex-1 rounded-full btn-glow bg-blue-600 font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {isPending ? "저장하는 중…" : "사유서 저장"}
            </button>
            <button
              type="button"
              onClick={() => {
                setText(reason ?? "");
                setEditing(false);
                setError(null);
              }}
              className="text-sm text-zinc-500 underline-offset-4 hover:underline"
            >
              취소
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="whitespace-pre-wrap break-words text-sm">{reason}</p>
          {canEdit && (
            <div className="flex gap-4 text-sm">
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="text-blue-600 underline-offset-4 hover:underline"
              >
                고치기
              </button>
              <button
                type="button"
                onClick={withdraw}
                disabled={isPending}
                className="text-red-600 underline-offset-4 hover:underline disabled:opacity-50"
              >
                사유서 취소
              </button>
            </div>
          )}
          {canEdit && (
            <p className="text-xs text-zinc-500">영수증을 찾으면 위에서 사진을 붙이세요. 자동으로 &lsquo;완료&rsquo;가 돼요.</p>
          )}
        </>
      )}
    </section>
  );
}

function ErrorText({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
      {children}
    </p>
  );
}

/** 영수증 추가: 사진을 줄여 올리고 지출에 연결한다 */
export function ReceiptUploader({
  expenseId,
  organizationId,
  termId,
  room,
}: {
  expenseId: string;
  organizationId: string;
  termId: string;
  /** 더 붙일 수 있는 장수 */
  room: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    const picked = Array.from(files)
      .filter((f) => f.type.startsWith("image/") || f.name.toLowerCase().match(/\.(heic|heif)$/))
      .slice(0, room);
    if (picked.length === 0) return;
    setError(files.length > room ? `영수증은 ${room}장만 더 붙일 수 있어 나머지는 뺐어요.` : null);

    startTransition(async () => {
      const supabase = createClient();
      const uploaded: string[] = [];
      for (const [i, file] of picked.entries()) {
        setProgress(`올리는 중 (${i + 1}/${picked.length})…`);
        const blob = await resizeImage(file);
        const path = `${organizationId}/${termId}/${expenseId}/${crypto.randomUUID()}.${extensionFor(blob.type)}`;
        const { error: uploadError } = await supabase.storage
          .from("receipts")
          .upload(path, blob, { contentType: blob.type || "image/jpeg", upsert: false });
        if (!uploadError) uploaded.push(path);
      }

      if (uploaded.length > 0) {
        setProgress("마무리하는 중…");
        const attached = await attachReceipts(expenseId, organizationId, termId, uploaded);
        if (!attached.ok) {
          setProgress(null);
          setError(attached.error);
          return;
        }
      }

      setProgress(null);
      if (uploaded.length < picked.length) {
        setError(`영수증 ${picked.length - uploaded.length}장을 올리지 못했어요. 다시 시도해 주세요.`);
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      {error && <ErrorText>{error}</ErrorText>}
      {isPending ? (
        <p className="flex h-12 items-center justify-center rounded-xl border border-dashed border-zinc-400 text-sm text-zinc-500">
          {progress ?? "올리는 중…"}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <PhotoPicker label="촬영하기" capture onPick={upload} />
          <PhotoPicker label="앨범에서 선택" onPick={upload} />
        </div>
      )}
    </div>
  );
}

/** 영수증 한 장 삭제 버튼 (사진 위 ✕) */
export function DeleteReceiptButton({ receiptId }: { receiptId: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => {
        if (!confirm("이 영수증 사진을 지울까요? 되돌릴 수 없어요.")) return;
        startTransition(async () => {
          const result = await deleteReceipt(receiptId);
          if (result?.error) alert(result.error);
        });
      }}
      className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-sm text-white disabled:opacity-50"
      aria-label="이 영수증 지우기"
    >
      {isPending ? "…" : "✕"}
    </button>
  );
}

/** 지출 삭제 버튼 */
export function DeleteExpenseButton({ expenseId }: { expenseId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      {error && <ErrorText>{error}</ErrorText>}
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (!confirm("이 지출을 삭제할까요? 목록과 합계에서 빠지고, 변경 이력에는 남아요.")) return;
          setError(null);
          startTransition(async () => {
            const result = await deleteExpense(expenseId);
            if (result?.error) setError(result.error);
          });
        }}
        className="h-12 w-full rounded-xl border border-red-300 text-base font-medium text-red-600 hover:bg-red-50 disabled:opacity-60 dark:border-red-900 dark:hover:bg-red-950"
      >
        {isPending ? "삭제하는 중…" : "지출 삭제"}
      </button>
    </div>
  );
}
