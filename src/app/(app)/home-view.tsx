import Link from "next/link";

import { ExpenseList, type ExpenseListItem } from "@/components/expense-list";
import { ButtonLink, Card } from "@/components/page";
import type { TermSummary } from "@/lib/expenses";
import { formatWon } from "@/lib/format";
import type { ActiveMembership } from "@/lib/memberships";
import { roleLabel } from "@/lib/roles";

export type RecentExpense = ExpenseListItem;

/** 시작 가이드에 쓰는 진행 상태 (대표 학생회 기준) */
export type GuideState = {
  isManager: boolean;
  isTreasurer: boolean;
  hasIncome: boolean;
  hasExpense: boolean;
  receiptsDone: boolean;
  hasMembers: boolean;
  hasPaymentLink: boolean;
};

function Stat({
  label,
  value,
  hint,
  href,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  href?: string;
  tone?: "default" | "green" | "red" | "amber";
}) {
  const color = {
    default: "",
    green: "text-green-700 dark:text-green-400",
    red: "text-red-600",
    amber: "text-amber-600",
  }[tone];
  const body = (
    <>
      <p className="text-sm text-zinc-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums md:text-3xl ${color}`}>{value}</p>
      {hint && <p className="mt-1 text-sm text-zinc-500">{hint}</p>}
    </>
  );
  const cls =
    "block rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950";
  return href ? (
    <Link href={href} className={`${cls} hover:border-blue-300 hover:shadow-sm`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** 처음 쓰는 사람이 무엇부터 할지 알려 주는 체크리스트 */
function StartGuide({ guide }: { guide: GuideState }) {
  const steps = [
    {
      done: guide.hasIncome,
      title: "이월액·학회비 같은 수입 넣기",
      detail: "지난 기수에서 넘어온 돈은 '이월액'으로 넣어요. 그래야 잔액이 맞아요.",
      href: "/incomes/new",
      action: "수입 등록",
      show: guide.isManager,
    },
    {
      done: guide.hasExpense,
      title: "첫 지출 등록하기",
      detail: "쓴 돈과 영수증 사진을 올려요. 통장 거래내역 엑셀로 한꺼번에 넣을 수도 있어요.",
      href: "/expenses/new",
      action: "지출 등록",
      show: true,
    },
    {
      done: guide.receiptsDone,
      title: "영수증 모두 붙이기",
      detail: "영수증이 없는 지출에 사진을 붙이거나, 잃어버렸으면 분실 사유서를 써요.",
      href: "/expenses?receipt=missing",
      action: "확인하기",
      show: true,
    },
    {
      done: guide.hasMembers,
      title: "집행부원 초대하기",
      detail: "초대 링크를 보내면 다른 사람도 지출을 등록할 수 있어요.",
      href: "/settings",
      action: "초대하기",
      show: guide.isManager,
    },
    {
      done: guide.hasPaymentLink,
      title: "결제 문자 연동하기 (선택)",
      detail: "학생회 카드 결제 문자가 오면 지출이 자동으로 생겨요.",
      href: "/settings/payments",
      action: "설정하기",
      show: guide.isTreasurer,
    },
  ].filter((s) => s.show);

  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) {
    return (
      <Card title="감사 준비" description="기본 설정을 모두 마쳤어요. 감사 기간이 되면 자료를 내려받으세요.">
        {guide.isManager ? (
          <ButtonLink href="/audit" variant="secondary">
            감사 준비로 가기
          </ButtonLink>
        ) : (
          <p className="text-sm text-zinc-500">감사 자료는 총무·회장이 내려받아요.</p>
        )}
      </Card>
    );
  }

  return (
    <Card
      title="시작 가이드"
      description={`${steps.length}단계 중 ${doneCount}단계 완료`}
      actions={
        <span className="rounded-full bg-blue-50 px-3 py-1 text-sm font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300">
          {Math.round((doneCount / steps.length) * 100)}%
        </span>
      }
    >
      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li key={s.title} className="flex gap-3">
            <span
              className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                s.done ? "bg-green-600 text-white" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
              }`}
            >
              {s.done ? "✓" : i + 1}
            </span>
            <div className="min-w-0 flex-1 space-y-1">
              <p className={`font-medium ${s.done ? "text-zinc-400 line-through" : ""}`}>{s.title}</p>
              {!s.done && (
                <>
                  <p className="text-sm text-zinc-500">{s.detail}</p>
                  <Link href={s.href} className="inline-block text-sm font-medium text-blue-600 underline-offset-4 hover:underline">
                    {s.action} →
                  </Link>
                </>
              )}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

/** 홈 대시보드 (데이터는 page.tsx가 불러와 넘긴다) */
export function HomeView({
  displayName,
  memberships,
  summary,
  incomeTotals,
  recent,
  needsReceipt,
  guide,
}: {
  displayName: string | null;
  memberships: ActiveMembership[];
  summary: Record<string, TermSummary>;
  incomeTotals: Record<string, number>;
  recent: RecentExpense[];
  needsReceipt: number;
  guide: GuideState;
}) {
  return (
    <>
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <p className="text-zinc-500">{displayName ? `${displayName}님, 안녕하세요` : "안녕하세요"}</p>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">이번 기수 한눈에 보기</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href="/expenses/new">+ 지출 등록</ButtonLink>
          {guide.isManager && (
            <ButtonLink href="/incomes/new" variant="green">
              + 수입 등록
            </ButtonLink>
          )}
          <ButtonLink href="/expenses/import" variant="secondary">
            거래내역 가져오기
          </ButtonLink>
        </div>
      </div>

      {memberships.map((m) => {
        const income = incomeTotals[m.terms.id] ?? 0;
        const expense = summary[m.terms.id]?.total ?? 0;
        const balance = income - expense;
        return (
          <section key={m.terms.id} className="space-y-3">
            <p className="text-sm text-zinc-500">
              {m.terms.organizations.school_name} · <span className="font-semibold text-zinc-800 dark:text-zinc-200">{m.terms.organizations.name}</span> ·{" "}
              {m.terms.name} · 내 직책 {roleLabel(m.role)}
            </p>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="수입 (예산액)" value={formatWon(income)} href="/incomes" tone="green" />
              <Stat
                label="지출 (총 집행액)"
                value={formatWon(expense)}
                hint={`${summary[m.terms.id]?.count ?? 0}건`}
                href="/expenses"
              />
              <Stat label="잔액" value={formatWon(balance)} tone={balance < 0 ? "red" : "default"} />
              {memberships.length === 1 && (
                <Stat
                  label="영수증 필요"
                  value={`${needsReceipt}건`}
                  hint={needsReceipt > 0 ? "눌러서 영수증 붙이기" : "모두 붙였어요"}
                  href="/expenses?receipt=missing"
                  tone={needsReceipt > 0 ? "amber" : "default"}
                />
              )}
            </div>
          </section>
        );
      })}

      {memberships.length > 1 && needsReceipt > 0 && (
        <Link
          href="/expenses?receipt=missing"
          className="block rounded-xl bg-amber-50 px-4 py-3 text-amber-800 hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-200 dark:hover:bg-amber-900"
        >
          영수증이 필요한 지출이 <strong>{needsReceipt}건</strong> 있어요. →
        </Link>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card
          className="lg:col-span-2"
          title="최근 지출"
          actions={
            <Link href="/expenses" className="text-sm font-medium text-blue-600 underline-offset-4 hover:underline">
              전체 보기 →
            </Link>
          }
        >
          <ExpenseList items={recent} emptyText="아직 등록한 지출이 없어요. 위의 '+ 지출 등록'으로 시작해 보세요." />
        </Card>
        <div className="space-y-6">
          <StartGuide guide={guide} />
          <Card title="바로가기">
            <ul className="grid grid-cols-2 gap-2 text-sm font-medium">
              {[
                { href: "/expenses", label: "지출 목록" },
                { href: "/incomes", label: "수입 목록" },
                ...(guide.isManager
                  ? [
                      { href: "/audit", label: "감사 준비" },
                      { href: "/settings", label: "학생회 설정" },
                    ]
                  : []),
                { href: "/me", label: "마이페이지" },
                { href: "/onboarding", label: "다른 학생회 만들기" },
              ].map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="block rounded-xl border border-zinc-200 px-3 py-3 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
