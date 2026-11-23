import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Card, Page, PageHeader } from "@/components/page";
import { requireUserId } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { getActiveMemberships } from "@/lib/memberships";
import { roleLabel, type MemberRole } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

import {
  CategoryManager,
  InviteCreator,
  InviteRow,
  MemberRow,
  OrgInfoForm,
  StartTermForm,
} from "./controls";

export const metadata: Metadata = { title: "학생회 설정" };

export default function SettingsPage({ searchParams }: PageProps<"/settings">) {
  return (
    <Page>
      <PageHeader
        title="학생회 설정"
        description="학생회 정보, 멤버 초대와 역할, 행사 항목, 기수 전환을 관리해요. 총무·회장만 바꿀 수 있어요."
      />
      <Suspense fallback={<p className="text-zinc-500">불러오는 중…</p>}>
        <SettingsContent searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}

type Member = { id: string; user_id: string; role: MemberRole; created_at: string };
type Invitation = { id: string; token: string; role: MemberRole; expires_at: string };
type Category = { id: string; name: string; sort_order: number };
type Term = { id: string; name: string; is_active: boolean; starts_on: string | null; ends_on: string | null };

function Section({
  title,
  description,
  children,
  wide,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  /** PC 2단 배치에서 두 칸을 다 쓰는지 */
  wide?: boolean;
}) {
  return (
    <Card title={title} description={description} className={wide ? "lg:col-span-2" : ""}>
      {children}
    </Card>
  );
}

async function SettingsContent({ searchParams }: { searchParams: PageProps<"/settings">["searchParams"] }) {
  const { org: orgParam } = await searchParams;
  const userId = await requireUserId("/settings");
  const supabase = await createClient();
  const memberships = await getActiveMemberships(supabase, userId);
  if (memberships.length === 0) redirect("/onboarding");

  const current =
    memberships.find((m) => m.terms.organizations.id === orgParam) ??
    memberships.find((m) => m.role === "treasurer" || m.role === "president") ??
    memberships[0];
  const org = current.terms.organizations;
  const term = current.terms;
  const myRole = current.role as MemberRole;
  const isManager = myRole === "treasurer" || myRole === "president";

  const myPageNote = (
    <p className="text-sm text-zinc-500">
      내 이름 바꾸기·로그아웃·회원 탈퇴는{" "}
      <Link href="/me" className="font-medium text-blue-600 underline-offset-4 hover:underline">
        마이페이지
      </Link>
      에 있어요.
    </p>
  );

  const orgPicker =
    memberships.length > 1 ? (
      <nav className="flex flex-wrap gap-2" aria-label="학생회 고르기">
        {memberships.map((m) => {
          const active = m.terms.organizations.id === org.id;
          return (
            <Link
              key={m.terms.organizations.id}
              href={`/settings?org=${m.terms.organizations.id}`}
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
    ) : null;

  if (!isManager) {
    return (
      <>
        {orgPicker}
        <p className="rounded-xl border border-dashed border-zinc-300 p-6 text-zinc-500 dark:border-zinc-700">
          {org.name}에서 나는 {roleLabel(myRole)}이에요. 학생회 설정은 총무·회장만 바꿀 수 있어요.
        </p>
        {myPageNote}
      </>
    );
  }

  // 만료되지 않은 초대만 본다 (createClient가 요청 시점 실행을 보장해 현재 시각을 써도 된다)
  const now = new Date().toISOString();

  const [{ data: members }, { data: invitations }, { data: categories }, { data: categorized }, { data: terms }] =
    await Promise.all([
      supabase
        .from("memberships")
        .select("id, user_id, role, created_at")
        .eq("term_id", term.id)
        .order("created_at")
        .overrideTypes<Member[], { merge: false }>(),
      supabase
        .from("invitations")
        .select("id, token, role, expires_at")
        .eq("term_id", term.id)
        .is("revoked_at", null)
        .gt("expires_at", now)
        .order("created_at", { ascending: false })
        .overrideTypes<Invitation[], { merge: false }>(),
      supabase
        .from("categories")
        .select("id, name, sort_order")
        .eq("term_id", term.id)
        .order("sort_order")
        .order("name")
        .overrideTypes<Category[], { merge: false }>(),
      supabase.from("expenses").select("category_id").eq("term_id", term.id).is("deleted_at", null).not("category_id", "is", null),
      supabase
        .from("terms")
        .select("id, name, is_active, starts_on, ends_on")
        .eq("organization_id", org.id)
        .order("created_at", { ascending: false })
        .overrideTypes<Term[], { merge: false }>(),
    ]);

  const memberIds = (members ?? []).map((m) => m.user_id);
  const { data: profiles } =
    memberIds.length > 0 ? await supabase.from("profiles").select("id, display_name").in("id", memberIds) : { data: [] };
  const nameOf = (uid: string) => (profiles ?? []).find((p) => p.id === uid)?.display_name || "이름 없음";

  const countByCategory = new Map<string, number>();
  for (const e of categorized ?? []) {
    const id = e.category_id as string;
    countByCategory.set(id, (countByCategory.get(id) ?? 0) + 1);
  }

  const memberItems = (members ?? []).map((m) => ({
    membershipId: m.id,
    name: nameOf(m.user_id),
    role: m.role,
    isMe: m.user_id === userId,
  }));

  return (
    <>
      {orgPicker}

      <div className="grid gap-6 lg:grid-cols-2">
      <Section title="학생회 정보">
        <OrgInfoForm orgId={org.id} schoolName={org.school_name} name={org.name} />
      </Section>

      <Section title="멤버 초대" description={`초대 링크를 받은 사람은 로그인 후 ${term.name}의 멤버가 돼요.`}>
        <InviteCreator termId={term.id} />
        {(invitations ?? []).length > 0 && (
          <div className="space-y-1">
            <p className="text-sm text-zinc-500">쓸 수 있는 초대 링크</p>
            <ul className="divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
              {(invitations ?? []).map((inv) => (
                <InviteRow
                  key={inv.id}
                  id={inv.id}
                  role={inv.role}
                  token={inv.token}
                  expiresLabel={formatDateTime(inv.expires_at)}
                />
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section
        title={`멤버 (${memberItems.length}명)`}
        description="총무·회장은 모든 지출을 고칠 수 있고, 집행부원은 본인이 등록한 지출만 고칠 수 있어요."
      >
        <ul className="divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
          {memberItems.map((m) => (
            <MemberRow key={m.membershipId} {...m} />
          ))}
        </ul>
      </Section>

      <Section title="행사" description="지출을 분류하는 항목이에요. 감사 양식의 항목과 맞춰 두면 좋아요.">
        <CategoryManager
          termId={term.id}
          categories={(categories ?? []).map((c) => ({
            id: c.id,
            name: c.name,
            expenseCount: countByCategory.get(c.id) ?? 0,
          }))}
        />
      </Section>

      <Section title="기수" description={`지금 기수: ${term.name}`}>
        {(terms ?? []).length > 1 && (
          <ul className="space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
            {(terms ?? []).map((t) => (
              <li key={t.id}>
                {t.name}
                {t.is_active ? " (지금)" : ""}
                {t.starts_on ? ` · ${t.starts_on}` : ""}
                {t.ends_on ? ` ~ ${t.ends_on}` : ""}
              </li>
            ))}
          </ul>
        )}
        <StartTermForm orgId={org.id} currentTermName={term.name} myRole={myRole} members={memberItems} />
      </Section>

      <Section title="결제 연동" description="학생회 카드·통장 알림 문자를 받아 지출·수입을 자동으로 기록해요.">
        <Link href="/settings/payments" className="font-medium text-blue-600 underline-offset-4 hover:underline">
          결제 문자 연동 설정 →
        </Link>
      </Section>
      </div>

      {myPageNote}
    </>
  );
}
