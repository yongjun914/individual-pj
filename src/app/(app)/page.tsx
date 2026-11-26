import Image from "next/image";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { requireUserId } from "@/lib/auth";
import { getActiveMemberships } from "@/lib/memberships";
import { roleLabel } from "@/lib/roles";
import { schoolLogo } from "@/lib/school-brand";
import { createClient } from "@/lib/supabase/server";

/** 홈: 학교 로고와 학생회 이름, 내 이름·직책만 깔끔하게 보여 준다. 기능은 상단 메뉴에서. */
export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <Suspense fallback={<p className="text-zinc-500">불러오는 중…</p>}>
        <HomeContent />
      </Suspense>
    </main>
  );
}

async function HomeContent() {
  const userId = await requireUserId("/");
  const supabase = await createClient();

  const [memberships, { data: profile }] = await Promise.all([
    getActiveMemberships(supabase, userId),
    supabase.from("profiles").select("display_name").eq("id", userId).maybeSingle(),
  ]);

  // 속한 학생회가 없으면 학생회 만들기·참여 요청으로
  if (memberships.length === 0) redirect("/onboarding");

  const primary = memberships[0];
  const org = primary.terms.organizations;
  const logo = schoolLogo(org.school_name);
  const position = primary.position || roleLabel(primary.role);

  return (
    <div className="flex flex-col items-center gap-8 text-center">
      {logo ? (
        <Image
          src={logo.src}
          alt={logo.alt}
          width={logo.width}
          height={logo.height}
          priority
          className="h-auto w-28 rounded-xl shadow-[0_18px_40px_-20px_rgb(11_77_151/0.6)] md:w-36"
        />
      ) : (
        // 로고가 없는 학교는 로고 자리에 학교 이름을 크게
        <p className="text-4xl font-bold tracking-tight text-[#084d98] md:text-6xl dark:text-blue-300">
          {org.school_name}
        </p>
      )}
      <h1 className="text-2xl font-bold tracking-tight md:text-4xl">
        {logo ? `${org.school_name} ${org.name}` : org.name}
      </h1>
      <div className="space-y-1">
        <p className="text-xl font-semibold md:text-2xl">{profile?.display_name || "이름 없음"}</p>
        <p className="text-lg text-zinc-500">{position}</p>
      </div>
    </div>
  );
}
