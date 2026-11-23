import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { requireUserId } from "@/lib/auth";
import { formatDateTime, formatWon } from "@/lib/format";
import { getActiveMemberships, type ActiveMembership } from "@/lib/memberships";
import { createClient } from "@/lib/supabase/server";

import { IssueTokenForm, RevokeTokenButton } from "./token-controls";

export const metadata: Metadata = { title: "결제 문자 연동" };

type TokenRow = {
  id: string;
  organization_id: string;
  label: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

type EventRow = {
  id: string;
  organization_id: string;
  raw_text: string;
  kind: "approval" | "deposit" | "cancel" | "unknown";
  amount: number | null;
  merchant: string | null;
  parse_error: string | null;
  parsed: { expense_id?: string; cancelled_expense_id?: string; income_id?: string } | null;
  received_at: string;
};

const KIND_LABELS: Record<EventRow["kind"], string> = { approval: "지출", deposit: "입금", cancel: "취소", unknown: "알 수 없음" };

export default function PaymentSettingsPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-6 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">결제 문자 연동</h1>
        <Link href="/" className="text-sm text-zinc-500 underline-offset-4 hover:underline">
          홈
        </Link>
      </div>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        학생회 카드 결제 문자나 통장 입출금 알림 문자를 폰에서 자동으로 보내면, 출금·결제는 &lsquo;영수증 필요&rsquo;
        지출로, 입금은 수입으로 바로 기록돼요. 결제가 취소되면 그 지출도 취소로 바뀌어요. 카드 결제 문자와 통장 출금
        문자를 둘 다 보내면 같은 지출이 두 번 생기니, 지출은 한쪽만 보내 주세요.
      </p>
      <Suspense fallback={<p className="text-zinc-500">불러오는 중…</p>}>
        <SettingsContent />
      </Suspense>
    </main>
  );
}

async function SettingsContent() {
  const userId = await requireUserId("/settings/payments");
  const supabase = await createClient();
  const memberships = await getActiveMemberships(supabase, userId);
  if (memberships.length === 0) redirect("/onboarding");

  const managed = memberships.filter((m) => m.role === "treasurer" || m.role === "president");
  if (managed.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700">
        결제 연동은 총무·회장만 볼 수 있어요.
      </p>
    );
  }

  const orgIds = managed.map((m) => m.terms.organizations.id);
  const [{ data: tokens }, { data: events }] = await Promise.all([
    // 총무만 결과가 나온다 (RLS)
    supabase
      .from("webhook_tokens")
      .select("id, organization_id, label, last_used_at, revoked_at, created_at")
      .in("organization_id", orgIds)
      .order("created_at", { ascending: false })
      .overrideTypes<TokenRow[], { merge: false }>(),
    supabase
      .from("payment_events")
      .select("id, organization_id, raw_text, kind, amount, merchant, parse_error, parsed, received_at")
      .in("organization_id", orgIds)
      .order("received_at", { ascending: false })
      .limit(20)
      .overrideTypes<EventRow[], { merge: false }>(),
  ]);

  return (
    <>
      {managed.map((m) => (
        <OrgSection
          key={m.terms.organizations.id}
          membership={m}
          showOrgName={managed.length > 1}
          tokens={(tokens ?? []).filter((t) => t.organization_id === m.terms.organizations.id)}
          events={(events ?? []).filter((e) => e.organization_id === m.terms.organizations.id)}
        />
      ))}
      <SetupGuide />
    </>
  );
}

function OrgSection({
  membership,
  showOrgName,
  tokens,
  events,
}: {
  membership: ActiveMembership;
  showOrgName: boolean;
  tokens: TokenRow[];
  events: EventRow[];
}) {
  const org = membership.terms.organizations;
  const isTreasurer = membership.role === "treasurer";
  const activeTokens = tokens.filter((t) => !t.revoked_at);

  return (
    <section className="space-y-5">
      {showOrgName && <h2 className="text-lg font-semibold">{org.name}</h2>}

      <div className="space-y-3 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
        <h3 className="font-medium">연결된 폰</h3>
        {isTreasurer ? (
          <>
            {activeTokens.length > 0 ? (
              <ul className="divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
                {activeTokens.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{t.label || "이름 없음"}</p>
                      <p className="text-zinc-500">
                        {t.last_used_at ? `마지막 수신 ${formatDateTime(t.last_used_at)}` : "아직 받은 문자 없음"}
                      </p>
                    </div>
                    <RevokeTokenButton tokenId={t.id} label={t.label || "이름 없음"} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-zinc-500">아직 연결된 폰이 없어요. 토큰을 발급해 폰에 설정해 주세요.</p>
            )}
            <IssueTokenForm organizationId={org.id} />
          </>
        ) : (
          <p className="text-sm text-zinc-500">토큰 발급·폐기는 총무만 할 수 있어요.</p>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="font-medium">최근 받은 문자</h3>
        {events.length > 0 ? (
          <ul className="divide-y divide-zinc-200 rounded-2xl border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
            {events.map((e) => (
              <EventItem key={e.id} event={e} />
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700">
            아직 받은 문자가 없어요. 폰 설정 후 카드를 한 번 써 보면 여기에 나와요.
          </p>
        )}
      </div>
    </section>
  );
}

function EventItem({ event: e }: { event: EventRow }) {
  const expenseId = e.parsed?.expense_id ?? e.parsed?.cancelled_expense_id;
  const failed = Boolean(e.parse_error) || e.kind === "unknown";

  return (
    <li className="space-y-1 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">
            <span className={failed ? "text-amber-600" : "text-zinc-500"}>[{KIND_LABELS[e.kind]}]</span>{" "}
            {e.merchant || (e.kind === "deposit" ? "입금자 모름" : "가맹점 모름")}
          </p>
          <p className="text-zinc-500">{formatDateTime(e.received_at)}</p>
        </div>
        <p className="shrink-0 font-semibold">{e.amount !== null ? formatWon(e.amount) : "-"}</p>
      </div>
      {e.parse_error && <p className="text-amber-700 dark:text-amber-300">{e.parse_error}</p>}
      {!failed && e.kind === "cancel" && !expenseId && (
        <p className="text-amber-700 dark:text-amber-300">맞는 지출을 찾지 못했어요. 직접 확인해 주세요.</p>
      )}
      <div className="flex items-center gap-3">
        {expenseId && (
          <Link href={`/expenses/${expenseId}`} className="text-blue-600 underline-offset-4 hover:underline">
            지출 보기
          </Link>
        )}
        {e.parsed?.income_id && (
          <Link href={`/incomes/${e.parsed.income_id}`} className="text-blue-600 underline-offset-4 hover:underline">
            수입 보기
          </Link>
        )}
        <details className="min-w-0 flex-1">
          <summary className="cursor-pointer text-zinc-500">원문</summary>
          <pre className="mt-1 whitespace-pre-wrap break-all rounded-lg bg-zinc-100 p-2 text-xs dark:bg-zinc-900">
            {e.raw_text}
          </pre>
        </details>
      </div>
    </li>
  );
}

function SetupGuide() {
  return (
    <section className="space-y-3 rounded-2xl bg-zinc-100 p-4 text-sm dark:bg-zinc-900">
      <h2 className="font-medium">폰 설정 방법</h2>
      <div className="space-y-1">
        <h3 className="font-medium">아이폰 (단축어 앱)</h3>
        <ol className="list-decimal space-y-1 pl-5 text-zinc-700 dark:text-zinc-300">
          <li>단축어 앱 → 자동화 → 새로운 자동화 → &lsquo;메시지&rsquo;를 골라요.</li>
          <li>보낸 사람에 카드사 번호를 넣거나, &lsquo;메시지에 포함&rsquo;에 &lsquo;승인&rsquo;을 넣어요. &lsquo;즉시 실행&rsquo;을 켜요.</li>
          <li>동작 &lsquo;URL의 콘텐츠 가져오기&rsquo;를 추가하고 URL에 웹훅 주소를 넣어요.</li>
          <li>방법은 POST, 헤더에 Authorization과 발급받은 값을 넣어요.</li>
          <li>요청 본문은 JSON, 키 text의 값으로 &lsquo;단축어 입력(메시지 내용)&rsquo;을 골라요.</li>
        </ol>
        <p className="text-zinc-500">
          아이폰은 카드사 앱 알림은 읽을 수 없어요. 카드사에서 결제 문자(SMS) 알림을 켜 두세요.
        </p>
      </div>
      <div className="space-y-1">
        <h3 className="font-medium">안드로이드 (MacroDroid 앱)</h3>
        <ol className="list-decimal space-y-1 pl-5 text-zinc-700 dark:text-zinc-300">
          <li>새 매크로 → 트리거 &lsquo;SMS 수신&rsquo;(카드사 앱 알림이면 &lsquo;알림&rsquo;)을 골라요.</li>
          <li>동작 &lsquo;HTTP 요청&rsquo;을 추가하고 방법 POST, URL에 웹훅 주소를 넣어요.</li>
          <li>헤더에 Authorization과 발급받은 값을 넣어요.</li>
          <li>본문은 {"{\"text\": \"…\"}"} 형식으로, … 자리에 문자(알림) 내용 변수를 넣어요.</li>
        </ol>
      </div>
      <p className="text-zinc-500">
        설정 후 카드를 한 번 써 보고, 위 &lsquo;최근 받은 문자&rsquo;에 나오는지 확인해 주세요. 해석하지 못한 문자도
        여기에 남아요.
      </p>
    </section>
  );
}
