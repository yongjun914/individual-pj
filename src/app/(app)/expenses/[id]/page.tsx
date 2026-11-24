import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { Page } from "@/components/page";
import { requireUserId } from "@/lib/auth";
import { describeChanges, type AuditLogRow } from "@/lib/expense-history";
import { MAX_RECEIPTS, PAYMENT_METHOD_LABELS, STATUS_LABELS } from "@/lib/expenses";
import { formatDateTime, formatLongDate, formatWon } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

import { DeleteExpenseButton, DeleteReceiptButton, MissingReasonPanel, ReceiptUploader } from "./controls";
import { getExpenseDetail } from "./data";

export const metadata: Metadata = { title: "지출 상세" };

/** 영수증 사진 주소 유효 시간 (초) */
const SIGNED_URL_TTL = 60 * 60;

export default function ExpenseDetailPage({ params, searchParams }: PageProps<"/expenses/[id]">) {
  return (
    <Page width="normal">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">지출 상세</h1>
        <Link href="/expenses" className="text-sm text-zinc-500 underline-offset-4 hover:underline">
          목록
        </Link>
      </div>
      <Suspense fallback={<p className="text-zinc-500">불러오는 중…</p>}>
        <DetailContent params={params} searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}

type Receipt = { id: string; storage_path: string };

async function DetailContent({
  params,
  searchParams,
}: {
  params: PageProps<"/expenses/[id]">["params"];
  searchParams: PageProps<"/expenses/[id]">["searchParams"];
}) {
  const { id } = await params;
  const { upload_failed } = await searchParams;
  // 등록 중 영수증 업로드에 실패하고 넘어온 경우 (몇 장 실패했는지)
  const uploadFailed = Number(typeof upload_failed === "string" ? upload_failed : 0) || 0;
  const userId = await requireUserId(`/expenses/${id}`);
  const supabase = await createClient();

  const detail = await getExpenseDetail(supabase, userId, id);
  if (!detail) notFound();
  const { expense, canEdit } = detail;

  const [{ data: receiptRows }, { data: logs }, { data: categories }] = await Promise.all([
    supabase
      .from("receipts")
      .select("id, storage_path")
      .eq("expense_id", id)
      .order("created_at")
      .overrideTypes<Receipt[], { merge: false }>(),
    // 총무·회장만 결과가 나온다 (RLS)
    supabase
      .from("audit_logs")
      .select("id, actor_id, action, old_data, new_data, created_at")
      .eq("expense_id", id)
      .order("created_at", { ascending: false })
      .limit(50)
      .overrideTypes<AuditLogRow[], { merge: false }>(),
    supabase.from("categories").select("id, name").eq("term_id", expense.term_id),
  ]);

  const receipts = receiptRows ?? [];
  const { data: signed } =
    receipts.length > 0
      ? await supabase.storage.from("receipts").createSignedUrls(
          receipts.map((r) => r.storage_path),
          SIGNED_URL_TTL,
        )
      : { data: [] };
  const urlByPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));

  // 작성자·이력 작성자 이름
  const peopleIds = [...new Set([expense.created_by, ...(logs ?? []).map((l) => l.actor_id)].filter(Boolean))] as string[];
  const { data: people } =
    peopleIds.length > 0
      ? await supabase.from("profiles").select("id, display_name").in("id", peopleIds)
      : { data: [] };
  const nameOf = (uid: string | null) => {
    // 작성자가 비어 있으면 탈퇴한 사용자 (결제 문자 자동 처리는 아래에서 따로 표시)
    if (!uid) return "탈퇴한 사용자";
    const name = (people ?? []).find((p) => p.id === uid)?.display_name;
    return name || "이름 없음";
  };
  const categoryNames = new Map((categories ?? []).map((c) => [c.id as string, c.name as string]));

  const cancelled = expense.status === "cancelled";

  return (
    <>
      {uploadFailed > 0 && (
        <p
          role="alert"
          className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200"
        >
          지출은 저장했지만 영수증 {uploadFailed}장을 올리지 못했어요. 아래 &lsquo;영수증&rsquo;에서 다시 붙여 주세요.
          (등록 화면에서 다시 저장하면 같은 지출이 하나 더 생겨요.)
        </p>
      )}
      {expense.deleted_at && (
        <p className="rounded-xl bg-zinc-100 px-4 py-3 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          삭제된 지출이에요 ({formatDateTime(expense.deleted_at)}). 목록과 합계에는 나오지 않아요.
        </p>
      )}
      {!expense.terms.is_active && (
        <p className="rounded-xl bg-zinc-100 px-4 py-3 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          지난 기수({expense.terms.name})의 지출이라 고칠 수 없어요.
        </p>
      )}

      <section className="space-y-1 rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
        <p className="text-sm text-zinc-500">
          {expense.terms.organizations.name} · {expense.terms.name}
        </p>
        <p className={`text-3xl font-semibold ${cancelled ? "text-zinc-400 line-through" : ""}`}>
          {formatWon(expense.amount)}
        </p>
        <p className="text-lg">{expense.merchant || "사용처 없음"}</p>
        <p className="pt-1">
          <span
            className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${
              expense.status === "needs_receipt"
                ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
                : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
            }`}
          >
            {STATUS_LABELS[expense.status]}
          </span>
        </p>
      </section>

      <dl className="divide-y divide-zinc-200 rounded-2xl border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
        <Row label="사용일">{formatLongDate(expense.spent_on)}</Row>
        <Row label="행사">{expense.categories?.name ?? "미분류"}</Row>
        <Row label="결제 수단">{PAYMENT_METHOD_LABELS[expense.payment_method]}</Row>
        <Row label="품목">{expense.items || "-"}</Row>
        <Row label="메모">{expense.memo || "-"}</Row>
        <Row label="등록">
          {!expense.created_by && expense.payment_event_id ? "결제 문자로 자동 등록" : nameOf(expense.created_by)} ·{" "}
          {formatDateTime(expense.created_at)}
        </Row>
      </dl>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">
          영수증 <span className="font-normal text-zinc-500">({receipts.length}/{MAX_RECEIPTS})</span>
        </h2>
        {receipts.length > 0 ? (
          <ul className="grid grid-cols-3 gap-3 md:grid-cols-4">
            {receipts.map((r) => {
              const url = urlByPath.get(r.storage_path);
              return (
                <li
                  key={r.id}
                  className="relative aspect-[3/4] overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900"
                >
                  {url ? (
                    <a href={url} target="_blank" rel="noreferrer" aria-label="영수증 크게 보기">
                      {/* eslint-disable-next-line @next/next/no-img-element -- 만료되는 서명 주소라 next/image 최적화를 쓰지 않는다 */}
                      <img src={url} alt="영수증" className="h-full w-full object-cover" />
                    </a>
                  ) : (
                    <p className="flex h-full items-center justify-center p-2 text-center text-xs text-zinc-500">
                      사진을 불러오지 못했어요
                    </p>
                  )}
                  {canEdit && <DeleteReceiptButton receiptId={r.id} />}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700">
            아직 붙인 영수증이 없어요.
          </p>
        )}
        {canEdit && receipts.length < MAX_RECEIPTS && (
          <ReceiptUploader
            expenseId={expense.id}
            organizationId={expense.terms.organization_id}
            termId={expense.term_id}
            room={MAX_RECEIPTS - receipts.length}
          />
        )}
      </section>

      {(expense.status === "excused" || (canEdit && expense.status === "needs_receipt" && receipts.length === 0)) && (
        <MissingReasonPanel
          expenseId={expense.id}
          reason={expense.missing_reason}
          excused={expense.status === "excused"}
          canEdit={canEdit}
        />
      )}

      {canEdit && (
        <div className="space-y-3">
          <Link
            href={`/expenses/${expense.id}/edit`}
            className="flex h-12 items-center justify-center rounded-full btn-glow bg-blue-600 text-base font-medium text-white hover:bg-blue-700"
          >
            내용 수정
          </Link>
          <DeleteExpenseButton expenseId={expense.id} />
        </div>
      )}

      {logs && logs.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">변경 이력</h2>
          <ol className="space-y-3 rounded-2xl border border-zinc-200 p-4 text-sm dark:border-zinc-800">
            {logs.map((log) => {
              const changes = describeChanges(log, categoryNames);
              if (log.action === "update" && changes.length === 0) return null;
              return (
                <li key={log.id} className="space-y-1">
                  <p className="text-zinc-500">
                    {formatDateTime(log.created_at)} ·{" "}
                    {log.actor_id ? nameOf(log.actor_id) : expense.payment_event_id ? "자동 처리 또는 탈퇴한 사용자" : "탈퇴한 사용자"}
                  </p>
                  {log.action === "insert" ? (
                    <p>지출 등록</p>
                  ) : (
                    <ul className="space-y-0.5">
                      {changes.map((c) => (
                        <li key={c.label}>
                          <span className="font-medium">{c.label}</span>: {c.before} → {c.after}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4 px-4 py-3">
      <dt className="w-20 shrink-0 text-zinc-500">{label}</dt>
      <dd className="min-w-0 flex-1 whitespace-pre-wrap break-words">{children}</dd>
    </div>
  );
}
