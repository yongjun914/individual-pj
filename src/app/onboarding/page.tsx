import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { requireUserId } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { getActiveMemberships } from "@/lib/memberships";
import { createClient } from "@/lib/supabase/server";

import { CreateOrgForm } from "./create-org-form";
import { JoinRequestFinder, MyJoinRequests } from "./join-request";

export const metadata: Metadata = { title: "학생회 참여·만들기" };

export default function OnboardingPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-8 px-6 py-12">
      <Suspense fallback={<p className="text-zinc-500">불러오는 중…</p>}>
        <MyRequestsSection />
      </Suspense>

      <section className="space-y-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">이미 학생회가 만들어져 있나요?</h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            우리 학생회를 찾아 참여 요청을 보내세요. 학회장·부학회장이 승인하면 바로 함께 쓸 수 있어요.
          </p>
        </div>
        <JoinRequestFinder />
        <p className="text-sm text-zinc-500">초대 링크를 받았다면 그 링크를 열면 승인 없이 바로 참여해요.</p>
      </section>

      <div className="flex items-center gap-3 text-sm text-zinc-400" aria-hidden>
        <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
        또는
        <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
      </div>

      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">새 학생회 만들기</h2>
          <p className="text-zinc-600 dark:text-zinc-400">
            우리 학생회가 아직 없을 때만 만들어 주세요. 만들면 다른 집행부원을 초대할 수 있어요.
          </p>
        </div>
        <CreateOrgForm />
      </section>

      <Link href="/" className="text-center text-sm text-zinc-500 underline-offset-4 hover:underline">
        홈으로
      </Link>
    </main>
  );
}

/** 내가 보낸 참여 요청 (있을 때만) */
async function MyRequestsSection() {
  const userId = await requireUserId("/onboarding");
  const supabase = await createClient();
  const [{ data }, memberships] = await Promise.all([supabase.rpc("my_join_requests"), getActiveMemberships(supabase, userId)]);
  const requests = (
    (data ?? []) as { id: string; school_name: string; name: string; status: "pending" | "approved" | "rejected" | "cancelled"; created_at: string }[]
  ).filter((r) => r.status !== "cancelled");
  if (requests.length === 0) return null;
  const approved = requests.some((r) => r.status === "approved") && memberships.length > 0;

  return (
    <section className="space-y-3 rounded-2xl border border-blue-200 bg-blue-50/60 p-4 dark:border-blue-900 dark:bg-blue-950/40">
      <h2 className="font-semibold">보낸 참여 요청</h2>
      <MyJoinRequests
        requests={requests.map((r) => ({
          id: r.id,
          label: `${r.school_name} ${r.name}`,
          status: r.status,
          createdAt: formatDateTime(r.created_at),
        }))}
      />
      {approved ? (
        <Link href="/" className="inline-flex h-11 items-center rounded-full btn-glow bg-blue-600 px-5 font-medium text-white hover:bg-blue-700">
          학생회로 들어가기
        </Link>
      ) : (
        <p className="text-sm text-zinc-500">승인되면 이 화면을 새로고침하거나 홈으로 가면 바로 들어가져요.</p>
      )}
    </section>
  );
}
