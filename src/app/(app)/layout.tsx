import { Suspense } from "react";

import { BottomTabBar, TopBar, TopBarPlaceholder, type NavUser } from "@/components/app-nav";
import { getCurrentUserId } from "@/lib/auth";
import { getActiveMemberships } from "@/lib/memberships";
import { canAny } from "@/lib/permissions";
import { isManagerRole, roleLabel } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

/** 로그인 뒤 화면 공통 틀: 상단 바 + 본문 + (휴대폰) 하단 탭 바 */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <Suspense fallback={<TopBarPlaceholder />}>
        <TopBarWithUser />
      </Suspense>
      {/* 휴대폰에서는 하단 탭 바에 가리지 않게 아래 여백 */}
      <div className="flex flex-1 flex-col pb-20 md:pb-0">{children}</div>
      {/* 하단 탭 바도 지금 주소를 읽으므로 Suspense 안에 둔다 */}
      <Suspense fallback={null}>
        <BottomTabBar />
      </Suspense>
    </div>
  );
}

async function TopBarWithUser() {
  const userId = await getCurrentUserId();
  if (!userId) return <TopBar user={null} />;

  const supabase = await createClient();
  const [memberships, { data: profile }] = await Promise.all([
    getActiveMemberships(supabase, userId),
    supabase.from("profiles").select("display_name").eq("id", userId).maybeSingle(),
  ]);

  // 학회장·부학회장에게는 처리할 직책 변경 요청 수를 메뉴에 보여 준다
  const managedTermIds = memberships.filter((m) => isManagerRole(m.role)).map((m) => m.terms.id);
  const { count: pendingRequests } =
    managedTermIds.length > 0
      ? await supabase
          .from("role_change_requests")
          .select("id", { count: "exact", head: true })
          .in("term_id", managedTermIds)
          .eq("status", "pending")
      : { count: 0 };

  const first = memberships[0];
  const user: NavUser = {
    name: profile?.display_name || "이름 없음",
    subtitle: first
      ? `${first.terms.organizations.name} · ${first.position || roleLabel(first.role)}`
      : null,
    isAdmin: memberships.some((m) => isManagerRole(m.role)),
    pendingRequests: pendingRequests ?? 0,
    canAudit: canAny(memberships, "audit"),
    canSettings: canAny(memberships, "settings"),
  };
  return <TopBar user={user} />;
}
