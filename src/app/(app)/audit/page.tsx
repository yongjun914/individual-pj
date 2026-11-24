import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Page, PageHeader } from "@/components/page";
import { can } from "@/lib/permissions";
import { buildAuditReport, type AuditCheck, type AuditExpenseInput, type AuditIncomeInput } from "@/lib/audit";
import { requireUserId } from "@/lib/auth";
import { UUID } from "@/lib/expense-input";
import { formatWon, todayInSeoul } from "@/lib/format";
import { getActiveMemberships } from "@/lib/memberships";
import { createClient } from "@/lib/supabase/server";

import { AuditDownloads } from "./downloads";

export const metadata: Metadata = { title: "감사 준비" };

/** 한 번에 다루는 최대 지출 건수 */
const MAX_ROWS = 2000;

const fieldClass =
  "h-11 w-full rounded-xl border border-zinc-300 bg-white px-3 text-base outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 dark:border-zinc-700 dark:bg-zinc-900";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (v: unknown): v is string => typeof v === "string" && ISO_DATE.test(v) && !Number.isNaN(Date.parse(v));

type Term = { id: string; name: string; is_active: boolean; starts_on: string | null; ends_on: string | null };
type ExpenseRow = Omit<AuditExpenseInput, "category"> & { categories: { name: string } | null };

export default function AuditPage({ searchParams }: PageProps<"/audit">) {
  return (
    <Page width="wide">
      <PageHeader
        title="감사 준비"
        description="감사 기간을 고르고, 점검 결과를 고친 뒤 결산내역서와 증빙 PDF를 내려받아요."
      />
      <Suspense fallback={<p className="text-zinc-500">불러오는 중…</p>}>
        <AuditContent searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}

const LEVEL_STYLE: Record<AuditCheck["level"], { badge: string; label: string }> = {
  error: { badge: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200", label: "꼭 고칠 것" },
  warning: { badge: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200", label: "확인할 것" },
  info: { badge: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300", label: "참고" },
};

async function AuditContent({ searchParams }: { searchParams: PageProps<"/audit">["searchParams"] }) {
  const params = await searchParams;
  const userId = await requireUserId("/audit");
  const supabase = await createClient();
  const memberships = await getActiveMemberships(supabase, userId);
  if (memberships.length === 0) redirect("/onboarding");

  const managed = memberships.filter((m) => can(m, "audit"));
  if (managed.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700">
        감사 자료 권한이 없어요. 학회장·부학회장에게 권한을 요청해 주세요.
      </p>
    );
  }

  const org = (managed.find((m) => m.terms.organizations.id === params.org) ?? managed[0]).terms.organizations;
  const { data: terms } = await supabase
    .from("terms")
    .select("id, name, is_active, starts_on, ends_on")
    .eq("organization_id", org.id)
    .order("created_at", { ascending: false })
    .overrideTypes<Term[], { merge: false }>();

  const termParam = typeof params.term === "string" && UUID.test(params.term) ? params.term : null;
  const term = (terms ?? []).find((t) => t.id === termParam) ?? (terms ?? []).find((t) => t.is_active);
  if (!term) return <p className="text-sm text-zinc-500">기수를 찾을 수 없어요.</p>;

  const today = todayInSeoul();
  let from = isDate(params.from) ? params.from : (term.starts_on ?? `${today.slice(0, 4)}-01-01`);
  let to = isDate(params.to) ? params.to : (term.ends_on ?? today);
  if (from > to) [from, to] = [to, from];

  const [{ data: expenses, error }, { count: unparsed }, { data: incomes, error: incomeError }] = await Promise.all([
    supabase
      .from("expenses")
      .select(
        "id, spent_on, created_at, merchant, amount, items, payment_method, status, memo, missing_reason, categories(name), receipts(id, storage_path, created_at)",
      )
      .eq("term_id", term.id)
      .is("deleted_at", null)
      .gte("spent_on", from)
      .lte("spent_on", to)
      .order("spent_on")
      .limit(MAX_ROWS)
      .overrideTypes<ExpenseRow[], { merge: false }>(),
    supabase
      .from("payment_events")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", org.id)
      .not("parse_error", "is", null)
      .gte("received_at", `${from}T00:00:00+09:00`)
      .lte("received_at", `${to}T23:59:59+09:00`),
    supabase
      .from("incomes")
      .select("id, received_on, created_at, source, payer, amount, memo")
      .eq("term_id", term.id)
      .is("deleted_at", null)
      .gte("received_on", from)
      .lte("received_on", to)
      .limit(MAX_ROWS)
      .overrideTypes<AuditIncomeInput[], { merge: false }>(),
  ]);
  if (error) throw error;
  if (incomeError) throw incomeError;

  const report = buildAuditReport(
    (expenses ?? []).map(({ categories, ...e }) => ({ ...e, category: categories?.name ?? null })),
    incomes ?? [],
  );
  const errorCount = report.checks.filter((c) => c.level === "error").reduce((s, c) => s + c.items.length, 0);

  return (
    <>
      {managed.length > 1 && (
        <nav className="flex flex-wrap gap-2" aria-label="학생회 고르기">
          {managed.map((m) => {
            const active = m.terms.organizations.id === org.id;
            return (
              <Link
                key={m.terms.organizations.id}
                href={`/audit?org=${m.terms.organizations.id}`}
                aria-current={active ? "page" : undefined}
                className={`rounded-full border px-4 py-2 text-sm ${
                  active
                    ? "border-blue-600 bg-blue-50 font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                    : "border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
                }`}
              >
                {m.terms.organizations.name}
              </Link>
            );
          })}
        </nav>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <div className="space-y-6 lg:sticky lg:top-24">
      <Form action="/audit" className="space-y-3 rounded-3xl border border-zinc-200/80 bg-white shadow-[0_10px_30px_-18px_rgb(70_56_147/0.35)] p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <p className="font-semibold">1. 감사 기간 고르기</p>
        <input type="hidden" name="org" value={org.id} />
        <label className="block space-y-1">
          <span className="text-sm text-zinc-500">기수</span>
          <select name="term" defaultValue={term.id} className={fieldClass}>
            {(terms ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.is_active ? " (지금)" : ""}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block space-y-1">
            <span className="text-sm text-zinc-500">감사 시작일</span>
            <input type="date" name="from" defaultValue={from} className={fieldClass} />
          </label>
          <label className="block space-y-1">
            <span className="text-sm text-zinc-500">감사 종료일</span>
            <input type="date" name="to" defaultValue={to} className={fieldClass} />
          </label>
        </div>
        <button
          type="submit"
          className="h-11 w-full rounded-xl bg-zinc-900 font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          이 기간으로 점검
        </button>
      </Form>

      <section className="space-y-2 rounded-2xl bg-zinc-100 px-5 py-4 dark:bg-zinc-900">
        <dl className="space-y-1 text-sm">
          <div className="flex items-baseline justify-between">
            <dt className="text-zinc-500">예산액 (수입 {report.incomes.length}건)</dt>
            <dd className="font-semibold text-green-700 dark:text-green-400">{formatWon(report.incomeTotal)}</dd>
          </div>
          <div className="flex items-baseline justify-between">
            <dt className="text-zinc-500">총 집행액 (지출 {report.rows.length}건)</dt>
            <dd className="font-semibold">{formatWon(report.total)}</dd>
          </div>
          <div className="flex items-baseline justify-between border-t border-zinc-200 pt-1 dark:border-zinc-800">
            <dt className="font-medium">잔액</dt>
            <dd className={`text-2xl font-semibold ${report.balance < 0 ? "text-red-600" : ""}`}>{formatWon(report.balance)}</dd>
          </div>
        </dl>
        <p className="text-sm text-zinc-500">
          영수증 {report.counts.receipt} · 사유서 {report.counts.excused} · 영수증 없음 {report.counts.missing}
          {report.counts.cancelled > 0 ? ` · 취소 제외 ${report.counts.cancelled}` : ""}
        </p>
      </section>

      {(expenses ?? []).length >= MAX_ROWS && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          지출이 너무 많아 앞의 {MAX_ROWS}건만 다뤘어요. 기간을 나눠 주세요.
        </p>
      )}

      <section className="space-y-3 rounded-3xl border border-zinc-200/80 bg-white shadow-[0_10px_30px_-18px_rgb(70_56_147/0.35)] p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="font-semibold">3. 감사 자료 내려받기</h2>
        <AuditDownloads
          report={report}
          errorCount={errorCount}
          meta={{ schoolName: org.school_name, orgName: org.name, termName: term.name, from, to }}
        />
      </section>
      </div>

      <div className="min-w-0 space-y-6">
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">2. 출력 전 점검</h2>
        {report.checks.length === 0 && !unparsed ? (
          <p className="rounded-xl bg-green-50 px-4 py-3 text-sm text-green-800 dark:bg-green-950 dark:text-green-200">
            문제가 없어요. 바로 내려받아도 돼요.
          </p>
        ) : (
          <ul className="space-y-2">
            {report.checks.map((c) => (
              <li key={c.key}>
                <details
                  className="rounded-2xl border border-zinc-200 p-4 text-sm dark:border-zinc-800"
                  open={c.level === "error"}
                >
                  <summary className="cursor-pointer">
                    <span className={`mr-2 rounded-full px-2 py-0.5 text-xs font-medium ${LEVEL_STYLE[c.level].badge}`}>
                      {LEVEL_STYLE[c.level].label}
                    </span>
                    <span className="font-medium">{c.title}</span>{" "}
                    {c.items.length > 0 && <span className="text-zinc-500">{c.items.length}건</span>}
                  </summary>
                  <p className="mt-2 text-zinc-500">{c.description}</p>
                  {c.key === "no-income" && (
                    <Link href="/incomes/new" className="mt-2 inline-block text-blue-600 underline-offset-4 hover:underline">
                      수입 등록하기 →
                    </Link>
                  )}
                  <ul className="mt-2 space-y-1">
                    {c.items.map((item) => (
                      <li key={item.id}>
                        <Link
                          href={item.id.startsWith("income:") ? `/incomes/${item.id.slice(7)}` : `/expenses/${item.id}`}
                          className="text-blue-600 underline-offset-4 hover:underline"
                        >
                          {item.no ? `${item.no}번 · ` : ""}
                          {item.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
            {(unparsed ?? 0) > 0 && (
              <li className="rounded-2xl border border-zinc-200 p-4 text-sm dark:border-zinc-800">
                <span className={`mr-2 rounded-full px-2 py-0.5 text-xs font-medium ${LEVEL_STYLE.warning.badge}`}>
                  확인할 것
                </span>
                <span className="font-medium">해석하지 못한 결제 문자</span>{" "}
                <span className="text-zinc-500">{unparsed}건</span>
                <p className="mt-2 text-zinc-500">
                  이 기간에 받았지만 지출로 만들지 못한 문자가 있어요.{" "}
                  <Link href="/settings/payments" className="text-blue-600 underline-offset-4 hover:underline">
                    수신 기록 보기
                  </Link>
                </p>
              </li>
            )}
          </ul>
        )}
      </section>

      {report.categories.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">행사별 합계</h2>
          <table className="w-full overflow-hidden rounded-2xl border border-zinc-200 text-sm dark:border-zinc-800">
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {report.categories.map((c) => (
                <tr key={c.category}>
                  <td className="px-4 py-2">{c.category}</td>
                  <td className="px-2 py-2 text-right text-zinc-500">{c.count}건</td>
                  <td className="px-4 py-2 text-right font-medium">{formatWon(c.total)}</td>
                </tr>
              ))}
              <tr className="bg-zinc-50 font-semibold dark:bg-zinc-900">
                <td className="px-4 py-2">합계</td>
                <td className="px-2 py-2 text-right">{report.rows.length}건</td>
                <td className="px-4 py-2 text-right">{formatWon(report.total)}</td>
              </tr>
            </tbody>
          </table>
        </section>
      )}
      </div>
      </div>
    </>
  );
}
