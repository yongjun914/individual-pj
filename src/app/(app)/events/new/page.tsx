import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Page, PageHeader } from "@/components/page";
import { requireUserId } from "@/lib/auth";
import { todayInSeoul } from "@/lib/format";
import { getActiveMemberships } from "@/lib/memberships";
import { can } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

import { EventForm } from "../event-form";

export const metadata: Metadata = { title: "새 행사" };

export default function NewEventPage() {
  return (
    <Page width="narrow">
      <PageHeader
        title="새 행사"
        description="종류를 고르면 알맞은 명단 칸이 준비돼요. 행사를 만들면 같은 이름의 지출 분류도 생겨서 지출을 이 행사로 묶을 수 있어요."
        back={{ href: "/events", label: "행사 목록" }}
      />
      <Suspense fallback={<p className="text-zinc-500">불러오는 중…</p>}>
        <NewEventContent />
      </Suspense>
    </Page>
  );
}

async function NewEventContent() {
  const userId = await requireUserId("/events/new");
  const supabase = await createClient();
  const memberships = await getActiveMemberships(supabase, userId);
  if (memberships.length === 0) redirect("/onboarding");

  const allowed = memberships.filter((m) => can(m, "events"));
  if (allowed.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-zinc-300 p-6 text-zinc-500 dark:border-zinc-700">
        행사 관리 권한이 없어요. 학회장·부학회장에게 권한을 요청해 주세요.
      </p>
    );
  }

  return (
    <EventForm
      terms={allowed.map((m) => ({ id: m.terms.id, label: `${m.terms.organizations.name} · ${m.terms.name}` }))}
      year={Number(todayInSeoul().slice(0, 4))}
    />
  );
}
