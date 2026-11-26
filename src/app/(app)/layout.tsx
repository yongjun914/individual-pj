import type { Metadata } from "next";
import { Suspense } from "react";

import { BottomTabBar, TopBar, TopBarPlaceholder, type NavUser } from "@/components/app-nav";
import { getCurrentUserId } from "@/lib/auth";
import { getActiveMemberships } from "@/lib/memberships";
import { canAny } from "@/lib/permissions";
import { isManagerRole, roleLabel } from "@/lib/roles";
import { schoolIcons } from "@/lib/school-brand";
import { getMySchoolBrand } from "@/lib/school-brand-server";
import { createClient } from "@/lib/supabase/server";

/** 사이트 아이콘을 내 학교에 맞춘다 (상명대: 학교 로고, 그 밖: 학사모) */
export async function generateMetadata(): Promise<Metadata> {
  return { icons: schoolIcons(await getMySchoolBrand()) };
}

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

  // 학회장·부학회장에게는 처리할 요청 수(직책 변경 + 참여 요청)를 메뉴에 보여 준다
  const managedTermIds = memberships.filter((m) => isManagerRole(m.role)).map((m) => m.terms.id);
  const [{ count: roleRequests }, { count: joinRequests }] =
    managedTermIds.length > 0
      ? await Promise.all([
          supabase
            .from("role_change_requests")
            .select("id", { count: "exact", head: true })
            .in("term_id", managedTermIds)
            .eq("status", "pending"),
          supabase
            .from("join_requests")
            .select("id", { count: "exact", head: true })
            .in("term_id", managedTermIds)
            .eq("status", "pending"),
        ])
      : [{ count: 0 }, { count: 0 }];
  const pendingRequests = (roleRequests ?? 0) + (joinRequests ?? 0);

  const first = memberships[0];
  const user: NavUser = {
    name: profile?.display_name || "이름 없음",
    subtitle: first
      ? `${first.terms.organizations.name} · ${first.position || roleLabel(first.role)}`
      : null,
    isAdmin: memberships.some((m) => isManagerRole(m.role)),
    pendingRequests,
    canAudit: canAny(memberships, "audit"),
    canSettings: canAny(memberships, "settings"),
  };
  return <TopBar user={user} />;
}
