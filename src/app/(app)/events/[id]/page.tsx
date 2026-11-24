import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ExpenseList, type ExpenseListItem } from "@/components/expense-list";
import { Card, Page } from "@/components/page";
import { requireUserId } from "@/lib/auth";
import { UUID } from "@/lib/expense-input";
import { countsTowardTotal } from "@/lib/expenses";
import {
  EVENT_KIND_LABELS,
  EVENT_STATUS_LABELS,
  eventStatus,
  jacketSummary,
  paidTotal,
  type EventKind,
} from "@/lib/events";
import { formatLongDate, formatWon, todayInSeoul } from "@/lib/format";
import { can } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

import { EventForm } from "../event-form";
import {
  AddParticipant,
  DeleteEventButton,
  DepositMatcher,
  ExportRoster,
  FeeIncomeButton,
  PasteImport,
  RosterTable,
  type Participant,
} from "./roster";

export const metadata: Metadata = { title: "행사" };

type EventDetail = {
  id: string;
  term_id: string;
  category_id: string | null;
  kind: EventKind;
  name: string;
  starts_on: string | null;
  ends_on: string | null;
  place: string;
  fee: number;
  capacity: number | null;
  form_url: string;
  extra_fields: string[];
  memo: string;
  income_id: string | null;
  terms: { name: string; is_active: boolean; organizations: { name: string } };
};

const TABS = [
  { key: "roster", label: "명단" },
  { key: "money", label: "돈" },
  { key: "info", label: "행사 정보" },
] as const;
type Tab = (typeof TABS)[number]["key"];

export default function EventDetailPage({ params, searchParams }: PageProps<"/events/[id]">) {
  return (
    <Page>
      <Suspense fallback={<p className="text-zinc-500">불러오는 중…</p>}>
        <EventContent params={params} searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}

async function EventContent({
  params,
  searchParams,
}: {
  params: PageProps<"/events/[id]">["params"];
  searchParams: PageProps<"/events/[id]">["searchParams"];
}) {
  const { id } = await params;
  const { tab: tabParam } = await searchParams;
  const tab: Tab = TABS.some((t) => t.key === tabParam) ? (tabParam as Tab) : "roster";
  if (!UUID.test(id)) notFound();

  const userId = await requireUserId(`/events/${id}`);
  const supabase = await createClient();

  const { data: event } = await supabase
    .from("events")
    .select(
      "id, term_id, category_id, kind, name, starts_on, ends_on, place, fee, capacity, form_url, extra_fields, memo, income_id, terms!inner(name, is_active, organizations!inner(name))",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle()
    .overrideTypes<EventDetail, { merge: false }>();
  if (!event) notFound();

  const [{ data: membership }, { data: participantRows }] = await Promise.all([
    supabase.from("memberships").select("role, revoked_permissions").eq("term_id", event.term_id).eq("user_id", userId).maybeSingle(),
    supabase
      .from("event_participants")
      .select("id, name, student_no, grade, paid, attended, fields, memo, dues_exempt, paid_income_id")
      .eq("event_id", id)
      .order("created_at")
      .overrideTypes<Participant[], { merge: false }>(),
  ]);
  const participants = participantRows ?? [];
  const canEdit = event.terms.is_active && can(membership, "events");
  const status = eventStatus(event.starts_on, event.ends_on, todayInSeoul());
  const paid = paidTotal(event.kind, Number(event.fee), participants);
  const attendedCount = participants.filter((p) => p.attended).length;

  return (
    <>
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <Link href="/events" className="text-sm text-zinc-500 underline-offset-4 hover:underline">
            ← 행사 목록
          </Link>
          <p className="text-sm text-zinc-500">
            {EVENT_KIND_LABELS[event.kind]} · {event.terms.organizations.name} · {EVENT_STATUS_LABELS[status]}
          </p>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{event.name}</h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            {event.starts_on ? formatLongDate(event.starts_on) : "날짜 미정"}
            {event.ends_on && event.ends_on !== event.starts_on ? ` ~ ${formatLongDate(event.ends_on)}` : ""}
            {event.place ? ` · ${event.place}` : ""}
            {event.fee > 0 ? ` · ${event.kind === "jacket" ? "1벌" : "참가비"} ${formatWon(event.fee)}` : ""}
          </p>
        </div>
        {event.form_url && (
          <a
            href={event.form_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-11 items-center rounded-lg btn-brutal bg-white dark:bg-zinc-900 px-4 font-medium"
          >
            구글폼 열기 ↗
          </a>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: "신청", value: `${participants.length}${event.capacity ? ` / ${event.capacity}` : ""}명` },
          { label: "납부", value: `${paid.count + paid.exemptCount}명${paid.exemptCount > 0 ? ` (면제 ${paid.exemptCount})` : ""}` },
          { label: "참석", value: `${attendedCount}명` },
          { label: "납부 금액", value: formatWon(paid.amount) },
        ].map((s) => (
          <div key={s.label} className="rounded-3xl border border-zinc-200/80 bg-white shadow-[0_10px_30px_-18px_rgb(70_56_147/0.35)] p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <dt className="text-sm text-zinc-500">{s.label}</dt>
            <dd className="mt-1 text-xl font-bold tabular-nums md:text-2xl">{s.value}</dd>
          </div>
        ))}
      </dl>

      <nav aria-label="행사 화면" className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/events/${id}${t.key === "roster" ? "" : `?tab=${t.key}`}`}
            aria-current={tab === t.key ? "page" : undefined}
            className={`-mb-px border-b-2 px-4 py-2 font-medium ${
              tab === t.key ? "border-blue-600 text-blue-700 dark:text-blue-300" : "border-transparent text-zinc-500 hover:text-zinc-800"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "roster" && (
        <RosterTab event={event} participants={participants} canEdit={canEdit} />
      )}
      {tab === "money" && <MoneyTab event={event} participants={participants} canEdit={canEdit} paid={paid} />}
      {tab === "info" && <InfoTab event={event} canEdit={canEdit} />}
    </>
  );
}

function RosterTab({ event, participants, canEdit }: { event: EventDetail; participants: Participant[]; canEdit: boolean }) {
  const jacket = event.kind === "jacket" ? jacketSummary(participants) : null;
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-6">
        {canEdit && (
          <Card title="한 명씩 추가" description="이름과 학번(22, 24처럼 2자리)은 꼭 넣어 주세요. 학년은 없어도 돼요.">
            <AddParticipant eventId={event.id} kind={event.kind} extraFields={event.extra_fields} />
          </Card>
        )}
        <Card
          title={`명단 (${participants.length}명)`}
          actions={<ExportRoster eventName={event.name} extraFields={event.extra_fields} participants={participants} />}
        >
          <RosterTable eventId={event.id} kind={event.kind} extraFields={event.extra_fields} participants={participants} canEdit={canEdit} />
        </Card>
      </div>
      <div className="space-y-6 lg:sticky lg:top-24">
        {jacket && (
          <Card title="과잠 주문 집계" description="사이즈별 수량 (수량 칸이 비면 1벌)">
            {jacket.total === 0 ? (
              <p className="text-sm text-zinc-500">아직 신청이 없어요.</p>
            ) : (
              <table className="w-full text-sm">
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {jacket.sizes.map((s) => (
                    <tr key={s.size}>
                      <td className="py-1.5 font-medium">{s.size}</td>
                      <td className="py-1.5 text-right tabular-nums">{s.count}벌</td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td className="py-1.5">합계</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {jacket.total}벌 · {formatWon(jacket.total * Number(event.fee))}
                    </td>
                  </tr>
                </tbody>
              </table>
            )}
          </Card>
        )}
        {canEdit && (
          <Card title="구글폼 응답 붙여 넣기" description="응답 시트를 복사해 붙이면 한꺼번에 명단에 들어가요.">
            <PasteImport eventId={event.id} extraFields={event.extra_fields} />
          </Card>
        )}
      </div>
    </div>
  );
}

async function MoneyTab({
  event,
  participants,
  canEdit,
  paid,
}: {
  event: EventDetail;
  participants: Participant[];
  canEdit: boolean;
  paid: ReturnType<typeof paidTotal>;
}) {
  const supabase = await createClient();
  const [{ data: expenses }, { data: income }] = await Promise.all([
    event.category_id
      ? supabase
          .from("expenses")
          .select("id, spent_on, merchant, amount, status, categories(name)")
          .eq("category_id", event.category_id)
          .is("deleted_at", null)
          .order("spent_on", { ascending: false })
          .overrideTypes<ExpenseListItem[], { merge: false }>()
      : Promise.resolve({ data: [] as ExpenseListItem[] }),
    event.income_id
      ? supabase.from("incomes").select("id, amount, received_on, deleted_at").eq("id", event.income_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const spent = (expenses ?? []).filter((e) => countsTowardTotal(e.status)).reduce((s, e) => s + e.amount, 0);
  const recordedIncome = income && !income.deleted_at ? Number(income.amount) : null;
  // 입금 문자로 확인된 납부는 이미 수입에 있고, 손으로 체크한 납부만 '별도 납입'으로 기록한다
  const incomeForBalance = paid.depositAmount + (recordedIncome ?? paid.manualAmount);

  // 자동으로 연결하지 못한 입금 (참가비와 금액이 맞는 것만)
  const { data: unmatched } = canEdit
    ? await supabase.rpc("event_unmatched_deposits", { p_event_id: event.id })
    : { data: [] };
  const deposits = ((unmatched ?? []) as { income_id: string; payer: string; amount: number; received_on: string }[]).map((d) => ({
    incomeId: d.income_id,
    payer: d.payer,
    amount: Number(d.amount),
    receivedOn: d.received_on,
  }));
  const unpaid = participants
    .filter((p) => !p.paid && !p.dues_exempt)
    .map((p) => ({ id: p.id, label: `${p.name} (${p.student_no})` }));

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <div className="space-y-6">
        <Card title="행사 결산">
          <dl className="space-y-2">
            <div className="flex justify-between">
              <dt className="text-zinc-500">참가비 납부 ({paid.count}명)</dt>
              <dd className="font-semibold tabular-nums text-green-700 dark:text-green-400">{formatWon(paid.amount)}</dd>
            </div>
            {paid.depositCount > 0 && (
              <div className="flex justify-between pl-3 text-sm">
                <dt className="text-zinc-500">└ 입금 문자로 확인 ({paid.depositCount}명, 수입에 자동 기록됨)</dt>
                <dd className="tabular-nums">{formatWon(paid.depositAmount)}</dd>
              </div>
            )}
            <div className="flex justify-between pl-3 text-sm">
              <dt className="text-zinc-500">└ 직접 체크 ({paid.manualCount}명, 현금 등)</dt>
              <dd className="tabular-nums">{formatWon(paid.manualAmount)}</dd>
            </div>
            {paid.exemptCount > 0 && (
              <div className="flex justify-between pl-3 text-sm">
                <dt className="text-zinc-500">└ 학회비 면제</dt>
                <dd className="tabular-nums">{paid.exemptCount}명</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-zinc-500">직접 체크분을 수입으로 기록</dt>
              <dd className="tabular-nums">{recordedIncome === null ? "아직 안 함" : formatWon(recordedIncome)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-500">지출 ({(expenses ?? []).length}건)</dt>
              <dd className="font-semibold tabular-nums">{formatWon(spent)}</dd>
            </div>
            <div className="flex justify-between border-t border-zinc-200 pt-2 dark:border-zinc-800">
              <dt className="font-medium">차액 (참가비 − 지출)</dt>
              <dd className={`text-xl font-bold tabular-nums ${incomeForBalance - spent < 0 ? "text-red-600" : ""}`}>
                {formatWon(incomeForBalance - spent)}
              </dd>
            </div>
          </dl>
          {recordedIncome !== null && recordedIncome !== paid.manualAmount && (
            <p className="text-sm text-amber-700 dark:text-amber-300">
              기록한 수입과 지금 직접 체크한 납부 금액이 달라요. 아래 버튼으로 맞출 수 있어요.
            </p>
          )}
          {canEdit && <FeeIncomeButton eventId={event.id} recorded={recordedIncome !== null} />}
          {participants.length === 0 && <p className="text-sm text-zinc-500">명단에서 납부를 체크하면 여기에 합계가 나와요.</p>}
        </Card>
        {canEdit && deposits.length > 0 && (
          <Card
            title={`입금 확인 필요 (${deposits.length}건)`}
            description="참가비와 금액은 맞는데 누구인지 확실하지 않은 입금이에요 (동명이인, 학번 없음, 친구 대신 입금 등). 누구의 입금인지 골라 주세요."
          >
            <DepositMatcher deposits={deposits} unpaid={unpaid} />
          </Card>
        )}
      </div>
      <Card
        title="이 행사의 지출"
        description={`지출을 등록할 때 행사(분류)를 '${event.name}'로 고르면 여기에 모여요.`}
        actions={
          <Link href="/expenses/new" className="text-sm font-medium text-blue-600 underline-offset-4 hover:underline">
            + 지출 등록
          </Link>
        }
      >
        <ExpenseList items={expenses ?? []} emptyText="아직 이 행사로 분류된 지출이 없어요." />
      </Card>
    </div>
  );
}

function InfoTab({ event, canEdit }: { event: EventDetail; canEdit: boolean }) {
  if (!canEdit) {
    return (
      <Card title="행사 정보">
        <dl className="space-y-2 text-sm">
          <div>장소: {event.place || "-"}</div>
          <div>정원: {event.capacity ?? "-"}</div>
          <div>명단 추가 칸: {event.extra_fields.join(", ") || "없음"}</div>
          <div className="whitespace-pre-wrap">메모: {event.memo || "-"}</div>
        </dl>
        {!event.terms.is_active && <p className="text-sm text-zinc-500">지난 연도의 행사라 고칠 수 없어요.</p>}
      </Card>
    );
  }
  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <EventForm
        terms={[]}
        year={Number(todayInSeoul().slice(0, 4))}
        event={{
          id: event.id,
          termId: event.term_id,
          kind: event.kind,
          name: event.name,
          startsOn: event.starts_on ?? "",
          endsOn: event.ends_on ?? "",
          place: event.place,
          fee: Number(event.fee),
          capacity: event.capacity ? String(event.capacity) : "",
          formUrl: event.form_url,
          extraFields: event.extra_fields,
          memo: event.memo,
        }}
      />
      <div className="border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <DeleteEventButton eventId={event.id} />
      </div>
    </div>
  );
}
