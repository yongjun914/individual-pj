import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { OrgPicker } from "@/components/org-picker";
import { Card, Page, PageHeader } from "@/components/page";
import { requireUserId } from "@/lib/auth";
import { getActiveMemberships } from "@/lib/memberships";
import { can } from "@/lib/permissions";
import { isManagerRole } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { termLabel } from "@/lib/terms";

import { CategoryManager, OrgInfoForm, TermNameForm } from "./controls";

export const metadata: Metadata = { title: "학생회 설정" };

export default function SettingsPage({ searchParams }: PageProps<"/settings">) {
  return (
    <Page>
      <PageHeader
        title="학생회 설정"
        description="학생회 정보, 지출을 나누는 행사 분류, 연도, 결제 문자 연동을 관리해요."
      />
      <Suspense fallback={<p className="text-zinc-500">불러오는 중…</p>}>
        <SettingsContent searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}

type Category = { id: string; name: string; sort_order: number };
type Term = { id: string; name: string; is_active: boolean; starts_on: string | null; ends_on: string | null };

async function SettingsContent({ searchParams }: { searchParams: PageProps<"/settings">["searchParams"] }) {
  const { org: orgParam } = await searchParams;
  const userId = await requireUserId("/settings");
  const supabase = await createClient();
  const memberships = await getActiveMemberships(supabase, userId);
  if (memberships.length === 0) redirect("/onboarding");

  const current =
    memberships.find((m) => m.terms.organizations.id === orgParam) ??
    memberships.find((m) => can(m, "settings")) ??
    memberships[0];
  const org = current.terms.organizations;
  const term = current.terms;

  const myPageNote = (
    <p className="text-sm text-zinc-500">
      내 이름 바꾸기·로그아웃·회원 탈퇴는{" "}
      <Link href="/me" className="font-medium text-blue-600 underline-offset-4 hover:underline">
        마이페이지
      </Link>
      에 있어요.
      {isManagerRole(current.role) && (
        <>
          {" "}멤버 초대·역할·권한·연도 전환은{" "}
          <Link href={`/members?org=${org.id}`} className="font-medium text-blue-600 underline-offset-4 hover:underline">
            학생회원 관리
          </Link>
          에 있어요.
        </>
      )}
    </p>
  );

  if (!can(current, "settings")) {
    return (
      <>
        <OrgPicker memberships={memberships} currentOrgId={org.id} basePath="/settings" />
        <p className="rounded-xl border border-dashed border-zinc-300 p-6 text-zinc-500 dark:border-zinc-700">
          {org.name}의 학생회 설정 권한이 없어요. 학회장·부학회장에게 권한을 요청해 주세요.
        </p>
        {myPageNote}
      </>
    );
  }

  const [{ data: categories }, { data: categorized }, { data: terms }] = await Promise.all([
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

  const countByCategory = new Map<string, number>();
  for (const e of categorized ?? []) {
    const id = e.category_id as string;
    countByCategory.set(id, (countByCategory.get(id) ?? 0) + 1);
  }

  return (
    <>
      <OrgPicker memberships={memberships} currentOrgId={org.id} basePath="/settings" />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="학생회 정보">
          <OrgInfoForm orgId={org.id} schoolName={org.school_name} name={org.name} />
        </Card>

        <Card
          title="행사 분류"
          description="지출을 나누는 항목이에요. 행사 관리에서 행사를 만들면 같은 이름의 분류가 자동으로 생겨요."
        >
          <CategoryManager
            termId={term.id}
            categories={(categories ?? []).map((c) => ({
              id: c.id,
              name: c.name,
              expenseCount: countByCategory.get(c.id) ?? 0,
            }))}
          />
        </Card>

        <Card title="연도" description={`지금 연도: ${termLabel(term.name)}`}>
          <TermNameForm termId={term.id} name={term.name} />
          <ul className="space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
            {(terms ?? []).map((t) => (
              <li key={t.id}>
                {termLabel(t.name)}
                {t.is_active ? " (지금)" : ""}
                {t.starts_on ? ` · ${t.starts_on}` : ""}
                {t.ends_on ? ` ~ ${t.ends_on}` : ""}
              </li>
            ))}
          </ul>
          <p className="text-sm text-zinc-500">새 연도 시작은 학회장·부학회장이 학생회원 관리에서 할 수 있어요.</p>
        </Card>

        <Card title="결제 연동" description="학생회 카드·통장 알림 문자를 받아 지출·수입을 자동으로 기록해요.">
          <Link href="/settings/payments" className="font-medium text-blue-600 underline-offset-4 hover:underline">
            결제 문자 연동 설정 →
          </Link>
        </Card>
      </div>

      {myPageNote}
    </>
  );
}
