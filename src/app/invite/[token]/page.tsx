import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { SubmitButton } from "@/components/submit-button";
import { roleLabel } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

import { acceptInvitation } from "./actions";

export const metadata: Metadata = { title: "학생회 초대" };

type Preview = {
  organization_name: string;
  school_name: string;
  term_name: string;
  role: string;
  already_member: boolean;
};

export default function InvitePage(props: PageProps<"/invite/[token]">) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-6 py-16">
      <Suspense fallback={<p className="text-center text-zinc-500">초대 정보를 확인하는 중…</p>}>
        <InviteContent {...props} />
      </Suspense>
    </main>
  );
}

async function InviteContent({ params, searchParams }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const { error } = await searchParams;

  const supabase = await createClient();
  const { data } = await supabase.rpc("get_invitation_preview", { p_token: token });
  const invite = (data as Preview[] | null)?.[0];

  if (!invite) {
    return (
      <div className="space-y-4 text-center">
        <h1 className="text-xl font-semibold">초대 링크를 쓸 수 없어요</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          링크가 만료되었거나 폐기되었어요. 총무나 회장에게 새 링크를 요청해 주세요.
        </p>
        <Link href="/" className="inline-block text-sm text-blue-600 underline-offset-4 hover:underline">
          홈으로
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <p className="text-sm text-zinc-500">{invite.school_name}</p>
        <h1 className="text-2xl font-semibold">{invite.organization_name}</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          {invite.term_name}에 <strong className="font-semibold">{roleLabel(invite.role)}</strong>
          (으)로 초대받았어요.
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          참여하지 못했습니다. 잠시 후 다시 시도해 주세요.
        </p>
      )}

      {invite.already_member ? (
        <Link
          href="/"
          className="flex h-12 items-center justify-center rounded-xl bg-blue-600 font-medium text-white hover:bg-blue-700"
        >
          이미 참여 중이에요 · 홈으로
        </Link>
      ) : (
        <form action={acceptInvitation}>
          <input type="hidden" name="token" value={token} />
          <SubmitButton pendingText="참여하는 중…" className="bg-blue-600 text-white hover:bg-blue-700">
            참여하기
          </SubmitButton>
        </form>
      )}
    </div>
  );
}
