import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { OrgPicker } from "@/components/org-picker";
import { Card, Page, PageHeader } from "@/components/page";
import { requireUserId } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { getActiveMemberships } from "@/lib/memberships";
import { isManagerRole, type MemberRole } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { termLabel, termOrgLabel } from "@/lib/terms";

import { InviteCreator, InviteRow, MemberAccessRow, StartTermForm } from "../settings/controls";

import { RoleRequestRow, type PendingRequest } from "./role-requests";

export const metadata: Metadata = { title: "학생회원 관리" };

type Member = {
  id: string;
  user_id: string;
  role: MemberRole;
  position: string;
  revoked_permissions: string[];
  created_at: string;
};
type Invitation = { id: string; token: string; role: MemberRole; expires_at: string };
type RoleRequest = { id: string; membership_id: string; requested_role: MemberRole; requested_position: string; created_at: string };

/** 역할 순서 (목록 정렬용) */
const ROLE_ORDER: Record<MemberRole, number> = { president: 0, vice_president: 1, treasurer: 2, officer: 3, member: 4 };

export default function MembersPage({ searchParams }: PageProps<"/members">) {
  return (
    <Page>
      <PageHeader
        title="학생회원 관리"
        description="앱을 쓰는 집행부(학회장·부학회장·부장·차장·부원)를 초대하고, 역할·부서/직책과 기능 권한을 정해요. 모든 멤버는 기본으로 모든 기능을 쓸 수 있고, 여기서 기능별로 해제할 수 있어요."
      />
      <Suspense fallback={<p className="text-zinc-500">불러오는 중…</p>}>
        <MembersContent searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}

async function MembersContent({ searchParams }: { searchParams: PageProps<"/members">["searchParams"] }) {
  const { org: orgParam } = await searchParams;
  const userId = await requireUserId("/members");
  const supabase = await createClient();
  const memberships = await getActiveMemberships(supabase, userId);
  if (memberships.length === 0) redirect("/onboarding");

  const admins = memberships.filter((m) => isManagerRole(m.role));
  if (admins.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-zinc-300 p-6 text-zinc-500 dark:border-zinc-700">
        학생회원 관리는 학회장·부학회장만 할 수 있어요.
      </p>
    );
  }

  const current = admins.find((m) => m.terms.organizations.id === orgParam) ?? admins[0];
  const org = current.terms.organizations;
  const term = current.terms;

  // 만료되지 않은 초대만 본다 (createClient가 요청 시점 실행을 보장해 현재 시각을 써도 된다)
  const now = new Date().toISOString();
  const [{ data: members }, { data: invitations }, { data: requests }] = await Promise.all([
    supabase
      .from("memberships")
      .select("id, user_id, role, position, revoked_permissions, created_at")
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
      .from("role_change_requests")
      .select("id, membership_id, requested_role, requested_position, created_at")
      .eq("term_id", term.id)
      .eq("status", "pending")
      .order("created_at")
      .overrideTypes<RoleRequest[], { merge: false }>(),
  ]);

  const memberIds = (members ?? []).map((m) => m.user_id);
  const { data: profiles } =
    memberIds.length > 0 ? await supabase.from("profiles").select("id, display_name").in("id", memberIds) : { data: [] };
  const nameOf = (uid: string) => (profiles ?? []).find((p) => p.id === uid)?.display_name || "이름 없음";

  const items = (members ?? [])
    .map((m) => ({
      membershipId: m.id,
      name: nameOf(m.user_id),
      role: m.role,
      position: m.position,
      revoked: m.revoked_permissions ?? [],
      isMe: m.user_id === userId,
    }))
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.name.localeCompare(b.name, "ko"));

  const pending: PendingRequest[] = (requests ?? []).flatMap((r) => {
    const member = items.find((m) => m.membershipId === r.membership_id);
    if (!member) return [];
    return [
      {
        id: r.id,
        name: member.name,
        currentRole: member.role,
        currentPosition: member.position,
        requestedRole: r.requested_role,
        requestedPosition: r.requested_position,
        requestedAt: formatDateTime(r.created_at),
      },
    ];
  });

  return (
    <>
      <OrgPicker memberships={admins} currentOrgId={org.id} basePath="/members" />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          {pending.length > 0 && (
            <Card title={`직책 변경 요청 (${pending.length}건)`} description="승인하면 역할·직책이 바로 바뀌어요.">
              <ul className="space-y-3">
                {pending.map((r) => (
                  <RoleRequestRow key={r.id} request={r} />
                ))}
              </ul>
            </Card>
          )}
          <Card title={`멤버 (${items.length}명)`} description={termOrgLabel(term.name, org.name)}>
            <ul className="space-y-3">
              {items.map((m) => (
                <MemberAccessRow key={m.membershipId} {...m} />
              ))}
            </ul>
          </Card>
        </div>

        <div className="space-y-6 lg:sticky lg:top-24">
          <Card title="멤버 초대" description="역할을 골라 링크를 만들고 카톡 등으로 보내 주세요. 받은 사람이 카카오로 로그인하면 멤버가 돼요.">
            <InviteCreator termId={term.id} />
            {(invitations ?? []).length > 0 && (
              <div className="space-y-1">
                <p className="text-sm text-zinc-500">쓸 수 있는 초대 링크</p>
                <ul className="divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
                  {(invitations ?? []).map((inv) => (
                    <InviteRow key={inv.id} id={inv.id} role={inv.role} token={inv.token} expiresLabel={formatDateTime(inv.expires_at)} />
                  ))}
                </ul>
              </div>
            )}
          </Card>

          <Card title="새 연도 시작" description={`지금 연도: ${termLabel(term.name)}`}>
            <StartTermForm
              orgId={org.id}
              currentTermName={termLabel(term.name)}
              myRole={current.role as MemberRole}
              members={items.map((m) => ({ membershipId: m.membershipId, name: m.name, role: m.role, isMe: m.isMe }))}
            />
          </Card>
        </div>
      </div>
    </>
  );
}
