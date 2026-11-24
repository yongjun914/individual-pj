import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { OrgPicker } from "@/components/org-picker";
import { Card, Page, PageHeader } from "@/components/page";
import { requireUserId } from "@/lib/auth";
import { getActiveMemberships } from "@/lib/memberships";
import { can } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { termOrgLabel } from "@/lib/terms";

import { DuesList, DuesPaste } from "./dues-manager";

export const metadata: Metadata = { title: "학회비 납부자 명단" };

export default function DuesPage({ searchParams }: PageProps<"/events/dues">) {
  return (
    <Page>
      <PageHeader
        title="학회비 납부자 명단"
        description="학회비를 낸 사람을 넣어 두면, 행사 명단에 같은 이름·학번이 들어올 때 자동으로 '납부'에 체크되고 '학회비 면제'로 표시돼요. 이 사람들은 참가비를 따로 내지 않아도 돼요."
        back={{ href: "/events", label: "행사 목록" }}
      />
      <Suspense fallback={<p className="text-zinc-500">불러오는 중…</p>}>
        <DuesContent searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}

async function DuesContent({ searchParams }: { searchParams: PageProps<"/events/dues">["searchParams"] }) {
  const { org: orgParam } = await searchParams;
  const userId = await requireUserId("/events/dues");
  const supabase = await createClient();
  const memberships = await getActiveMemberships(supabase, userId);
  if (memberships.length === 0) redirect("/onboarding");

  const current = memberships.find((m) => m.terms.organizations.id === orgParam) ?? memberships[0];
  const term = current.terms;
  const canEdit = can(current, "events");

  const { data: payers } = await supabase
    .from("dues_payers")
    .select("id, name, student_no, created_at")
    .eq("term_id", term.id)
    .order("student_no")
    .order("name");

  const list = (payers ?? []).map((p) => ({ id: p.id as string, name: p.name as string, studentNo: p.student_no as string }));

  return (
    <>
      <OrgPicker memberships={memberships} currentOrgId={term.organizations.id} basePath="/events/dues" />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <Card title={`납부자 ${list.length}명`} description={termOrgLabel(term.name, term.organizations.name)}>
          <DuesList payers={list} canEdit={canEdit} />
        </Card>
        {canEdit ? (
          <Card
            className="lg:sticky lg:top-24"
            title="납부자 추가"
            description="학회비 입금 내역이나 납부자 시트에서 이름·학번 칸을 복사해 붙여 넣으세요. 이미 있는 사람은 건너뛰어요."
          >
            <DuesPaste termId={term.id} />
          </Card>
        ) : (
          <p className="rounded-xl border border-dashed border-zinc-300 p-6 text-zinc-500 dark:border-zinc-700">
            행사 관리 권한이 있어야 납부자를 추가하거나 뺄 수 있어요.
          </p>
        )}
      </div>
    </>
  );
}
