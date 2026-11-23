import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { requireUserId } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { getActiveMemberships } from "@/lib/memberships";
import { roleLabel, type MemberRole } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

import {
  CategoryManager,
  DeleteAccount,
  InviteCreator,
  InviteRow,
  MemberRow,
  MyNameForm,
  OrgInfoForm,
  StartTermForm,
} from "./controls";

export const metadata: Metadata = { title: "학생회 설정" };

export default function SettingsPage({ searchParams }: PageProps<"/settings">) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-6 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">학생회 설정</h1>
        <Link href="/" className="text-sm text-zinc-500 underline-offset-4 hover:underline">
          홈
        </Link>
      </div>
      <Suspense fallback={<p className="text-zinc-500">불러오는 중…</p>}>
        <SettingsContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

type Member = { id: string; user_id: string; role: MemberRole; created_at: string };
type Invitation = { id: string; token: string; role: MemberRole; expires_at: string };
type Category = { id: string; name: string; sort_order: number };
type Term = { id: string; name: string; is_active: boolean; starts_on: string | null; ends_on: string | null };

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="space-y-1">
        <h2 className="font-semibold">{title}</h2>
        {description && <p className="text-sm text-zinc-500">{description}</p>}
      </div>
      {children}
    </section>
  );
}

async function SettingsContent({ searchParams }: { searchParams: PageProps<"/settings">["searchParams"] }) {
  const { org: orgParam } = await searchParams;
  const userId = await requireUserId("/settings");
  const supabase = await createClient();
  const [memberships, { data: me }] = await Promise.all([
    getActiveMemberships(supabase, userId),
    supabase.from("profiles").select("display_name").eq("id", userId).maybeSingle(),
  ]);
  if (memberships.length === 0) redirect("/onboarding");

  const current =
    memberships.find((m) => m.terms.organizations.id === orgParam) ??
    memberships.find((m) => m.role === "treasurer" || m.role === "president") ??
    memberships[0];
  const org = current.terms.organizations;
  const term = current.terms;
  const myRole = current.role as MemberRole;
  const isManager = myRole === "treasurer" || myRole === "president";

  const myName = (
    <Section title="내 정보">
      <MyNameForm name={me?.display_name ?? ""} />
      <div className="border-t border-zinc-200 pt-3 dark:border-zinc-800">
        <DeleteAccount />
      </div>
    </Section>
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
        <p className="rounded-xl border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700">
          {org.name}에서 나는 {roleLabel(myRole)}이에요. 학생회 설정은 총무·회장만 바꿀 수 있어요.
        </p>
        {myName}
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

      <Section title="결제 연동">
        <Link href="/settings/payments" className="text-sm text-blue-600 underline-offset-4 hover:underline">
          결제 문자 연동 설정 →
        </Link>
      </Section>

      {myName}
    </>
  );
}
