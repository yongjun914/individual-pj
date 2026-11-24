import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { Page } from "@/components/page";
import { can } from "@/lib/permissions";
import { requireUserId } from "@/lib/auth";
import { UUID } from "@/lib/expense-input";
import { formatDateTime, formatLongDate, formatWon, todayInSeoul } from "@/lib/format";
import { INCOME_METHOD_LABELS, type IncomeMethod } from "@/lib/income-input";
import { createClient } from "@/lib/supabase/server";

import { DeleteIncomeButton, IncomeForm } from "../income-form";

export const metadata: Metadata = { title: "수입 상세" };

type IncomeDetail = {
  id: string;
  term_id: string;
  received_on: string;
  source: string;
  payer: string;
  amount: number;
  payment_method: IncomeMethod;
  memo: string;
  payment_event_id: string | null;
  created_by: string | null;
  created_at: string;
  deleted_at: string | null;
  terms: { name: string; is_active: boolean; organizations: { name: string } };
};

export default function IncomeDetailPage({ params }: PageProps<"/incomes/[id]">) {
  return (
    <Page width="narrow">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">수입 상세</h1>
        <Link href="/incomes" className="text-sm text-zinc-500 underline-offset-4 hover:underline">
          목록
        </Link>
      </div>
      <Suspense fallback={<p className="text-zinc-500">불러오는 중…</p>}>
        <IncomeContent params={params} />
      </Suspense>
    </Page>
  );
}

async function IncomeContent({ params }: { params: PageProps<"/incomes/[id]">["params"] }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const userId = await requireUserId(`/incomes/${id}`);
  const supabase = await createClient();

  const { data: income } = await supabase
    .from("incomes")
    .select(
      "id, term_id, received_on, source, payer, amount, payment_method, memo, payment_event_id, created_by, created_at, deleted_at, terms!inner(name, is_active, organizations!inner(name))",
    )
    .eq("id", id)
    .maybeSingle()
    .overrideTypes<IncomeDetail, { merge: false }>();
  if (!income) notFound();

  const [{ data: membership }, { data: creator }] = await Promise.all([
    supabase.from("memberships").select("role, revoked_permissions").eq("term_id", income.term_id).eq("user_id", userId).maybeSingle(),
    income.created_by
      ? supabase.from("profiles").select("display_name").eq("id", income.created_by).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const canEdit =
    income.terms.is_active && !income.deleted_at && can(membership, "incomes");

  const info = (
    <dl className="divide-y divide-zinc-200 rounded-2xl border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
      <Row label="학생회">
        {income.terms.organizations.name} · {income.terms.name}
      </Row>
      <Row label="등록">
        {income.created_by
          ? creator?.display_name || "이름 없음"
          : income.payment_event_id
            ? "입금 알림 문자"
            : "탈퇴한 사용자"}{" "}
        · {formatDateTime(income.created_at)}
      </Row>
    </dl>
  );

  if (!canEdit) {
    return (
      <>
        {income.deleted_at && (
          <p className="rounded-xl bg-zinc-100 px-4 py-3 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
            삭제된 수입이에요. 목록과 합계에는 나오지 않아요.
          </p>
        )}
        <section className="space-y-1 rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
          <p className="text-sm text-zinc-500">{income.source}</p>
          <p className="text-3xl font-semibold">{formatWon(income.amount)}</p>
          <p className="text-lg">{income.payer || "입금자 없음"}</p>
        </section>
        <dl className="divide-y divide-zinc-200 rounded-2xl border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
          <Row label="받은 날">{formatLongDate(income.received_on)}</Row>
          <Row label="받은 방식">{INCOME_METHOD_LABELS[income.payment_method] ?? income.payment_method}</Row>
          <Row label="메모">{income.memo || "-"}</Row>
        </dl>
        {info}
        {!income.terms.is_active && <p className="text-sm text-zinc-500">지난 기수의 수입이라 고칠 수 없어요.</p>}
      </>
    );
  }

  return (
    <>
      {income.payment_event_id && income.source === "기타" && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          입금 알림 문자로 자동 기록된 수입이에요. 수입 항목을 맞게 골라 주세요.
        </p>
      )}
      <IncomeForm
        terms={[]}
        today={todayInSeoul()}
        income={{
          id: income.id,
          termId: income.term_id,
          receivedOn: income.received_on,
          source: income.source,
          payer: income.payer,
          amount: income.amount,
          paymentMethod: income.payment_method,
          memo: income.memo,
        }}
      />
      {info}
      <DeleteIncomeButton incomeId={income.id} />
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
