import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { signOut } from "@/app/auth/actions";
import { ButtonLink, Card, Page, PageHeader } from "@/components/page";
import { requireUserId } from "@/lib/auth";
import { formatDateTime, formatWon } from "@/lib/format";
import { can, PERMISSION_LABELS, PERMISSIONS } from "@/lib/permissions";
import { isManagerRole, roleLabel, type MemberRole } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { termLabel, termOrgLabel } from "@/lib/terms";

import { DeleteAccount, MyNameForm } from "../settings/controls";
import { MyRoleRequest } from "../members/role-requests";

export const metadata: Metadata = { title: "마이페이지" };

type MyMembership = {
  id: string;
  role: MemberRole;
  position: string;
  revoked_permissions: string[];
  created_at: string;
  terms: {
    id: string;
    name: string;
    is_active: boolean;
    starts_on: string | null;
    ends_on: string | null;
    organizations: { id: string; name: string; school_name: string };
  };
};

const ROLE_DESCRIPTIONS: Record<MemberRole, string> = {
  president: "모든 기능을 쓰고, 학생회원 관리에서 멤버의 역할·직책·기능 권한을 정할 수 있어요.",
  vice_president: "모든 기능을 쓰고, 학생회원 관리에서 멤버의 역할·직책·기능 권한을 정할 수 있어요.",
  treasurer: "모든 기능을 써요. 학생회원 관리는 학회장·부학회장이 해요.",
  officer: "기본으로 모든 기능을 쓸 수 있어요. 학회장·부학회장이 일부 기능 권한을 해제할 수 있어요.",
  member: "기본으로 모든 기능을 쓸 수 있어요. 학회장·부학회장이 일부 기능 권한을 해제할 수 있어요.",
};

export default function MyPage() {
  return (
    <Page width="normal">
      <PageHeader title="마이페이지" description="내 정보와 학생회에서의 직책, 내가 등록한 기록을 확인해요." />
      <Suspense fallback={<p className="text-zinc-500">불러오는 중…</p>}>
        <MyContent />
      </Suspense>
    </Page>
  );
}

async function MyContent() {
  const userId = await requireUserId("/me");
  const supabase = await createClient();

  const [{ data: profile }, { data: userData }, { data: memberships }, { data: myExpenses }] = await Promise.all([
    supabase.from("profiles").select("display_name, created_at").eq("id", userId).maybeSingle(),
    supabase.auth.getUser(),
    supabase
      .from("memberships")
      .select("id, role, position, revoked_permissions, created_at, terms!inner(id, name, is_active, starts_on, ends_on, organizations!inner(id, name, school_name))")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .overrideTypes<MyMembership[], { merge: false }>(),
    supabase
      .from("expenses")
      .select("amount, status, term_id")
      .eq("created_by", userId)
      .is("deleted_at", null),
  ]);

  const email = userData.user?.email || null;
  const kakaoLinked = (userData.user?.identities ?? []).some((i) => i.provider === "kakao");
  const active = (memberships ?? []).filter((m) => m.terms.is_active);
  const past = (memberships ?? []).filter((m) => !m.terms.is_active);
  const activeTermIds = new Set(active.map((m) => m.terms.id));

  // 내가 보낸, 아직 처리되지 않은 직책 변경 요청
  const { data: myRequests } =
    active.length > 0
      ? await supabase
          .from("role_change_requests")
          .select("id, membership_id, requested_role, requested_position, created_at")
          .in("membership_id", active.map((m) => m.id))
          .eq("status", "pending")
      : { data: [] };
  const pendingFor = (membershipId: string) => {
    const r = (myRequests ?? []).find((x) => x.membership_id === membershipId);
    return r
      ? {
          id: r.id as string,
          requestedRole: r.requested_role as MemberRole,
          requestedPosition: r.requested_position as string,
          requestedAt: formatDateTime(r.created_at as string),
        }
      : null;
  };

  const mine = (myExpenses ?? []).filter((e) => e.status !== "cancelled");
  const mineThisTerm = mine.filter((e) => activeTermIds.has(e.term_id as string));
  const myNeedsReceipt = mine.filter((e) => e.status === "needs_receipt").length;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="내 정보">
        <dl className="space-y-3">
          <div className="flex gap-4">
            <dt className="w-24 shrink-0 text-zinc-500">로그인</dt>
            <dd>{kakaoLinked ? "카카오 계정" : "연결된 계정"}</dd>
          </div>
          <div className="flex gap-4">
            <dt className="w-24 shrink-0 text-zinc-500">이메일</dt>
            <dd className="min-w-0 break-all">{email ?? "카카오에서 이메일을 받지 않았어요"}</dd>
          </div>
          {profile?.created_at && (
            <div className="flex gap-4">
              <dt className="w-24 shrink-0 text-zinc-500">가입일</dt>
              <dd>{formatDateTime(profile.created_at)}</dd>
            </div>
          )}
        </dl>
        <div className="border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <p className="mb-2 font-medium">표시 이름</p>
          <MyNameForm name={profile?.display_name ?? ""} />
        </div>
      </Card>

      <Card title="내 활동" description="내가 직접 등록한 지출 (결제 취소 건 제외)">
        <dl className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-zinc-50 p-4 dark:bg-zinc-900">
            <dt className="text-sm text-zinc-500">올해 등록</dt>
            <dd className="mt-1 text-2xl font-bold tabular-nums">{mineThisTerm.length}건</dd>
            <dd className="text-sm text-zinc-500 tabular-nums">{formatWon(mineThisTerm.reduce((s, e) => s + Number(e.amount), 0))}</dd>
          </div>
          <div className="rounded-xl bg-zinc-50 p-4 dark:bg-zinc-900">
            <dt className="text-sm text-zinc-500">영수증 필요</dt>
            <dd className={`mt-1 text-2xl font-bold tabular-nums ${myNeedsReceipt > 0 ? "text-amber-600" : ""}`}>{myNeedsReceipt}건</dd>
            <dd className="text-sm text-zinc-500">전체 {mine.length}건 중</dd>
          </div>
        </dl>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href="/expenses" variant="secondary">
            지출 목록 보기
          </ButtonLink>
          {myNeedsReceipt > 0 && <ButtonLink href="/expenses?receipt=missing">영수증 붙이러 가기</ButtonLink>}
        </div>
      </Card>

      <Card className="lg:col-span-2" title="내 직책" description="지금 활동 중인 학생회와 연도별 역할이에요.">
        {active.length > 0 ? (
          <ul className="grid gap-3 md:grid-cols-2">
            {active.map((m) => (
              <li key={m.id} className="space-y-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
                <p className="text-sm text-zinc-500">
                  {m.terms.organizations.school_name} · {termLabel(m.terms.name)}
                </p>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-lg font-semibold">{m.terms.organizations.name}</p>
                  <span className="rounded-full bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                    {roleLabel(m.role)}
                  </span>
                </div>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">{ROLE_DESCRIPTIONS[m.role]}</p>
                {m.position && <p className="text-sm font-medium">{m.position}</p>}
                {isManagerRole(m.role) ? (
                  <p className="text-sm text-zinc-500">내 역할·직책은 학생회원 관리에서 바로 바꿀 수 있어요.</p>
                ) : (
                  <MyRoleRequest termId={m.terms.id} role={m.role} position={m.position} pending={pendingFor(m.id)} />
                )}
                <p className="text-sm text-zinc-500">
                  쓸 수 있는 기능:{" "}
                  {PERMISSIONS.filter((p) => can(m, p)).map((p) => PERMISSION_LABELS[p].label).join(", ") || "지출 등록만"}
                </p>
                <div className="flex flex-wrap gap-4">
                  {can(m, "settings") && (
                    <Link
                      href={`/settings?org=${m.terms.organizations.id}`}
                      className="inline-block text-sm font-medium text-blue-600 underline-offset-4 hover:underline"
                    >
                      학생회 설정 →
                    </Link>
                  )}
                  {isManagerRole(m.role) && (
                    <Link
                      href={`/members?org=${m.terms.organizations.id}`}
                      className="inline-block text-sm font-medium text-blue-600 underline-offset-4 hover:underline"
                    >
                      학생회원 관리 (내 직책 바꾸기) →
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-zinc-500">지금 활동 중인 학생회가 없어요.</p>
        )}
        {past.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer font-medium text-zinc-600 dark:text-zinc-400">지난 연도 {past.length}개</summary>
            <ul className="mt-2 space-y-1 text-zinc-600 dark:text-zinc-400">
              {past.map((m) => (
                <li key={m.id}>
                  {termOrgLabel(m.terms.name, m.terms.organizations.name)} · {roleLabel(m.role)}
                  {m.terms.ends_on ? ` (~${m.terms.ends_on})` : ""}
                </li>
              ))}
            </ul>
          </details>
        )}
        <div className="flex flex-wrap gap-2">
          <ButtonLink href="/onboarding" variant="secondary">
            다른 학생회 만들기
          </ButtonLink>
        </div>
      </Card>

      <Card className="lg:col-span-2" title="계정">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <form action={signOut}>
            <button
              type="submit"
              className="h-11 rounded-lg btn-brutal bg-white dark:bg-zinc-900 px-4 font-medium"
            >
              로그아웃
            </button>
          </form>
          <div className="md:max-w-md">
            <DeleteAccount />
          </div>
        </div>
      </Card>
    </div>
  );
}
