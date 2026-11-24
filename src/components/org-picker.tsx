import Link from "next/link";

import type { ActiveMembership } from "@/lib/memberships";

/** 여러 학생회에 속했을 때 고르는 버튼 */
export function OrgPicker({
  memberships,
  currentOrgId,
  basePath,
}: {
  memberships: ActiveMembership[];
  currentOrgId: string;
  basePath: string;
}) {
  if (memberships.length < 2) return null;
  return (
    <nav className="flex flex-wrap gap-2" aria-label="학생회 고르기">
      {memberships.map((m) => {
        const active = m.terms.organizations.id === currentOrgId;
        return (
          <Link
            key={m.terms.organizations.id}
            href={`${basePath}?org=${m.terms.organizations.id}`}
            aria-current={active ? "page" : undefined}
            className={`rounded-full border px-4 py-2 text-sm ${
              active
                ? "border-blue-600 bg-blue-50 font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                : "border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
            }`}
          >
            {m.terms.organizations.name}
          </Link>
        );
      })}
    </nav>
  );
}
