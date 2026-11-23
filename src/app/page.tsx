import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { signOut } from "@/app/auth/actions";
import { requireUserId } from "@/lib/auth";
import { roleLabel } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

type ActiveMembership = {
  role: string;
  terms: {
    id: string;
    name: string;
    organizations: { id: string; name: string; school_name: string };
  };
};

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-6 py-10">
      <Suspense fallback={<p className="text-zinc-500">불러오는 중…</p>}>
        <HomeContent />
      </Suspense>
    </main>
  );
}

async function HomeContent() {
  const userId = await requireUserId("/");
  const supabase = await createClient();

  const [{ data: memberships }, { data: profile }] = await Promise.all([
    supabase
      .from("memberships")
      .select("role, terms!inner(id, name, organizations!inner(id, name, school_name))")
      .eq("user_id", userId)
      .eq("terms.is_active", true)
      .returns<ActiveMembership[]>(),
    supabase.from("profiles").select("display_name").eq("id", userId).maybeSingle(),
  ]);

  // 속한 학생회가 없으면 학생회 만들기로
  if (!memberships || memberships.length === 0) redirect("/onboarding");

  return (
    <>
      <header className="flex items-center justify-between">
        <p className="text-sm text-zinc-500">
          {profile?.display_name ? `${profile.display_name}님` : "안녕하세요"}
        </p>
        <form action={signOut}>
          <button type="submit" className="text-sm text-zinc-500 underline-offset-4 hover:underline">
            로그아웃
          </button>
        </form>
      </header>

      <section className="space-y-3">
        {memberships.map((m) => (
          <div
            key={m.terms.id}
            className="space-y-1 rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800"
          >
            <p className="text-sm text-zinc-500">{m.terms.organizations.school_name}</p>
            <h1 className="text-xl font-semibold">{m.terms.organizations.name}</h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {m.terms.name} · {roleLabel(m.role)}
            </p>
          </div>
        ))}
      </section>

      <p className="rounded-xl border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700">
        지출 등록과 감사 자료 출력은 다음 단계에서 만들어요.
      </p>

      <Link href="/onboarding" className="text-center text-sm text-zinc-500 underline-offset-4 hover:underline">
        다른 학생회 만들기
      </Link>
    </>
  );
}
