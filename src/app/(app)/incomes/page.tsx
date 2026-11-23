import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Page, PageHeader } from "@/components/page";
import { requireUserId } from "@/lib/auth";
import { formatShortDate, formatWon } from "@/lib/format";
import { INCOME_METHOD_LABELS, type IncomeMethod } from "@/lib/income-input";
import { getActiveMemberships } from "@/lib/memberships";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "수입 목록" };

const MAX_ROWS = 1000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const fieldClass =
  "h-11 w-full rounded-xl border border-zinc-300 bg-white px-3 text-base outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 dark:border-zinc-700 dark:bg-zinc-900";

type IncomeRow = {
  id: string;
  term_id: string;
  received_on: string;
  source: string;
  payer: string;
  amount: number;
  payment_method: IncomeMethod;
  payment_event_id: string | null;
};

export default function IncomesPage({ searchParams }: PageProps<"/incomes">) {
  return (
    <Page width="wide">
      <PageHeader
        title="수입 목록"
        description="이월액·학회비·지원금처럼 들어온 돈이에요. 결산내역서의 '예산내역'이 돼요."
      />
      <Suspense fallback={<p className="text-zinc-500">불러오는 중…</p>}>
        <IncomesContent searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}

async function IncomesContent({ searchParams }: { searchParams: PageProps<"/incomes">["searchParams"] }) {
  const params = await searchParams;
  const userId = await requireUserId("/incomes");
  const supabase = await createClient();
  const memberships = await getActiveMemberships(supabase, userId);
  if (memberships.length === 0) redirect("/onboarding");

  const termIds = memberships.map((m) => m.terms.id);
  const from = typeof params.from === "string" && ISO_DATE.test(params.from) ? params.from : null;
  const to = typeof params.to === "string" && ISO_DATE.test(params.to) ? params.to : null;
  const source = typeof params.source === "string" && params.source.length <= 50 ? params.source : null;

  let query = supabase
    .from("incomes")
    .select("id, term_id, received_on, source, payer, amount, payment_method, payment_event_id")
    .in("term_id", termIds)
    .is("deleted_at", null);
  if (from) query = query.gte("received_on", from);
  if (to) query = query.lte("received_on", to);
  if (source) query = query.eq("source", source);

  const [{ data, error }, { data: allSources }] = await Promise.all([
    query
      .order("received_on", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(MAX_ROWS)
      .overrideTypes<IncomeRow[], { merge: false }>(),
    supabase.from("incomes").select("source").in("term_id", termIds).is("deleted_at", null),
  ]);
  if (error) throw error;

  const incomes = data ?? [];
  const total = incomes.reduce((s, i) => s + i.amount, 0);
  const sources = [...new Set((allSources ?? []).map((s) => s.source as string))].sort();
  const canWrite = memberships.some((m) => m.role === "treasurer" || m.role === "president");
  const filtered = Boolean(from || to || source);

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="space-y-4 lg:sticky lg:top-24">
      {canWrite && (
        <Link
          href="/incomes/new"
          className="flex h-12 items-center justify-center rounded-xl bg-green-700 font-semibold text-white hover:bg-green-800"
        >
          + 수입 등록
        </Link>
      )}
      <Form action="/incomes" className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <p className="font-semibold">걸러 보기</p>
        <div className="grid grid-cols-2 gap-2">
          <label className="block space-y-1">
            <span className="text-sm text-zinc-500">시작일</span>
            <input type="date" name="from" defaultValue={from ?? ""} className={fieldClass} />
          </label>
          <label className="block space-y-1">
            <span className="text-sm text-zinc-500">종료일</span>
            <input type="date" name="to" defaultValue={to ?? ""} className={fieldClass} />
          </label>
        </div>
        <label className="block space-y-1">
          <span className="text-sm text-zinc-500">수입 항목</span>
          <select name="source" defaultValue={source ?? ""} className={fieldClass}>
            <option value="">전체</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="h-11 flex-1 rounded-xl bg-zinc-900 font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            조회
          </button>
          {filtered && (
            <Link href="/incomes" className="text-sm text-zinc-500 underline-offset-4 hover:underline">
              초기화
            </Link>
          )}
        </div>
      </Form>
      </aside>

      <div className="min-w-0 space-y-4">
        <section className="flex items-baseline justify-between rounded-2xl bg-zinc-100 px-5 py-4 dark:bg-zinc-900">
          <p className="text-zinc-500">수입 합계 {incomes.length}건</p>
          <p className="text-2xl font-bold text-green-700 tabular-nums dark:text-green-400">{formatWon(total)}</p>
        </section>

        {incomes.length > 0 ? (
          <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
            <div className="hidden bg-zinc-50 px-4 py-2 text-sm font-medium text-zinc-500 md:grid md:grid-cols-[6.5rem_10rem_minmax(0,1fr)_8rem_9rem] md:gap-4 dark:bg-zinc-900">
              <span>받은 날</span>
              <span>수입 항목</span>
              <span>입금자</span>
              <span>받은 방식</span>
              <span className="text-right">금액</span>
            </div>
            <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {incomes.map((i) => (
                <li key={i.id}>
                  <Link
                    href={`/incomes/${i.id}`}
                    className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-zinc-50 md:grid md:grid-cols-[6.5rem_10rem_minmax(0,1fr)_8rem_9rem] md:gap-4 dark:hover:bg-zinc-900"
                  >
                    <span className="hidden text-zinc-500 tabular-nums md:block">{formatShortDate(i.received_on)}</span>
                    <span className="hidden truncate font-medium md:block">{i.source}</span>
                    <span className="hidden truncate text-zinc-600 md:block dark:text-zinc-400">{i.payer || "-"}</span>
                    <span className="hidden text-sm text-zinc-500 md:block">
                      {INCOME_METHOD_LABELS[i.payment_method] ?? i.payment_method}
                      {i.payment_event_id ? " · 문자" : ""}
                    </span>
                    <div className="min-w-0 md:hidden">
                      <p className="truncate font-medium">
                        {i.source}
                        {i.payer ? <span className="font-normal text-zinc-500"> · {i.payer}</span> : null}
                      </p>
                      <p className="text-sm text-zinc-500">
                        {formatShortDate(i.received_on)} · {INCOME_METHOD_LABELS[i.payment_method] ?? i.payment_method}
                        {i.payment_event_id ? " · 입금 문자" : ""}
                      </p>
                    </div>
                    <p className="shrink-0 text-right font-semibold text-green-700 tabular-nums dark:text-green-400">
                      +{formatWon(i.amount)}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-zinc-300 p-6 text-center text-zinc-500 dark:border-zinc-700">
            {filtered ? "조건에 맞는 수입이 없어요." : "아직 기록한 수입이 없어요. 지난 기수에서 넘어온 돈은 '이월액'으로 넣어 주세요."}
          </p>
        )}
      </div>
    </div>
  );
}
