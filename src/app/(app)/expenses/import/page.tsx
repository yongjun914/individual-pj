import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Page } from "@/components/page";
import { requireUserId } from "@/lib/auth";
import { getActiveMemberships } from "@/lib/memberships";
import { createClient } from "@/lib/supabase/server";

import { ImportFlow } from "./import-flow";

export const metadata: Metadata = { title: "거래내역 가져오기" };

export default function ImportPage() {
  return (
    <Page width="normal">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">거래내역 가져오기</h1>
        <Link href="/expenses" className="text-sm text-zinc-500 underline-offset-4 hover:underline">
          목록
        </Link>
      </div>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        은행 통장 거래내역이나 카드 이용내역을 엑셀로 받아 올리면, 출금·결제 건은 &lsquo;영수증 필요&rsquo; 지출로,
        입금 건은 수입으로
        한꺼번에 기록해요. 이미 등록된 내역과 겹치는 건은 미리 빼 둬요.
      </p>
      <Suspense fallback={<p className="text-zinc-500">불러오는 중…</p>}>
        <ImportContent />
      </Suspense>
    </Page>
  );
}

async function ImportContent() {
  const userId = await requireUserId("/expenses/import");
  const supabase = await createClient();
  const memberships = await getActiveMemberships(supabase, userId);
  if (memberships.length === 0) redirect("/onboarding");

  const terms = memberships.map((m) => ({
    id: m.terms.id,
    label: `${m.terms.organizations.name} · ${m.terms.name}`,
    // 수입 기록은 총무·회장만 (DB 권한과 같게)
    canIncome: m.role === "treasurer" || m.role === "president",
  }));

  return <ImportFlow terms={terms} />;
}
