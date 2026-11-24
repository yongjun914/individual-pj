import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ButtonLink, Page, PageHeader } from "@/components/page";
import { requireUserId } from "@/lib/auth";
import { EVENT_KIND_LABELS, EVENT_STATUS_LABELS, eventStatus, type EventKind, type EventStatus } from "@/lib/events";
import { formatShortDate, formatWon, todayInSeoul } from "@/lib/format";
import { getActiveMemberships } from "@/lib/memberships";
import { canAny } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "행사 관리" };

type EventRow = {
  id: string;
  term_id: string;
  kind: EventKind;
  name: string;
  starts_on: string | null;
  ends_on: string | null;
  place: string;
  fee: number;
  capacity: number | null;
  form_url: string;
};

const STATUS_STYLE: Record<EventStatus, string> = {
  undated: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  upcoming: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  ongoing: "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300",
  done: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

export default function EventsPage() {
  return (
    <Page>
      <PageHeader
        title="행사 관리"
        description="개강총회·MT·과잠 신청처럼 명단이 필요한 행사를 만들고, 참석·납부를 체크해요. 지출 분류와 연결돼서 행사별 돈도 한눈에 보여요."
      />
      <Suspense fallback={<p className="text-zinc-500">불러오는 중…</p>}>
        <EventsContent />
      </Suspense>
    </Page>
  );
}

async function EventsContent() {
  const userId = await requireUserId("/events");
  const supabase = await createClient();
  const memberships = await getActiveMemberships(supabase, userId);
  if (memberships.length === 0) redirect("/onboarding");

  const termIds = memberships.map((m) => m.terms.id);
  const { data: events } = await supabase
    .from("events")
    .select("id, term_id, kind, name, starts_on, ends_on, place, fee, capacity, form_url")
    .in("term_id", termIds)
    .is("deleted_at", null)
    .order("starts_on", { ascending: false, nullsFirst: true })
    .order("created_at", { ascending: false })
    .overrideTypes<EventRow[], { merge: false }>();

  const ids = (events ?? []).map((e) => e.id);
  const { data: participants } =
    ids.length > 0
      ? await supabase.from("event_participants").select("event_id, paid, attended").in("event_id", ids)
      : { data: [] };
  const stats = new Map<string, { total: number; paid: number; attended: number }>();
  for (const p of participants ?? []) {
    const s = stats.get(p.event_id as string) ?? { total: 0, paid: 0, attended: 0 };
    s.total += 1;
    if (p.paid) s.paid += 1;
    if (p.attended) s.attended += 1;
    stats.set(p.event_id as string, s);
  }

  const canCreate = canAny(memberships, "events");
  const today = todayInSeoul();
  const multi = memberships.length > 1;
  const orgName = (termId: string) => memberships.find((m) => m.terms.id === termId)?.terms.organizations.name ?? "";

  return (
    <>
      {canCreate && (
        <div className="-mt-2 flex flex-wrap gap-2">
          <ButtonLink href="/events/new">+ 새 행사</ButtonLink>
        </div>
      )}

      {(events ?? []).length === 0 ? (
        <div className="space-y-3 rounded-2xl border border-dashed border-zinc-300 p-8 text-center dark:border-zinc-700">
          <p className="text-lg font-medium">아직 만든 행사가 없어요.</p>
          <p className="text-zinc-500">개강총회, MT, LT, 신환회, 종강총회, 과잠 신청 같은 행사를 만들어 명단을 관리해 보세요.</p>
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(events ?? []).map((e) => {
            const s = stats.get(e.id) ?? { total: 0, paid: 0, attended: 0 };
            const status = eventStatus(e.starts_on, e.ends_on, today);
            return (
              <li key={e.id}>
                <Link
                  href={`/events/${e.id}`}
                  className="flex h-full flex-col gap-3 rounded-3xl border border-zinc-200/80 bg-white shadow-[0_10px_30px_-18px_rgb(70_56_147/0.35)] p-5 hover:border-blue-300 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm text-zinc-500">
                        {EVENT_KIND_LABELS[e.kind]}
                        {multi ? ` · ${orgName(e.term_id)}` : ""}
                      </p>
                      <p className="truncate text-lg font-semibold">{e.name}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[status]}`}>
                      {EVENT_STATUS_LABELS[status]}
                    </span>
                  </div>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    {e.starts_on ? formatShortDate(e.starts_on) : "날짜 미정"}
                    {e.ends_on && e.ends_on !== e.starts_on ? ` ~ ${formatShortDate(e.ends_on)}` : ""}
                    {e.place ? ` · ${e.place}` : ""}
                    {e.fee > 0 ? ` · ${formatWon(e.fee)}` : ""}
                  </p>
                  <dl className="mt-auto grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-zinc-50 py-2 dark:bg-zinc-900">
                      <dt className="text-xs text-zinc-500">신청</dt>
                      <dd className="font-semibold tabular-nums">
                        {s.total}
                        {e.capacity ? <span className="text-xs font-normal text-zinc-500">/{e.capacity}</span> : null}
                      </dd>
                    </div>
                    <div className="rounded-lg bg-zinc-50 py-2 dark:bg-zinc-900">
                      <dt className="text-xs text-zinc-500">납부</dt>
                      <dd className="font-semibold tabular-nums">{s.paid}</dd>
                    </div>
                    <div className="rounded-lg bg-zinc-50 py-2 dark:bg-zinc-900">
                      <dt className="text-xs text-zinc-500">참석</dt>
                      <dd className="font-semibold tabular-nums">{s.attended}</dd>
                    </div>
                  </dl>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
