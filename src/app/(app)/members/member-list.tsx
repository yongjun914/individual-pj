"use client";

import { useState } from "react";

import { ROLE_LABELS, type MemberRole } from "@/lib/roles";

import { MemberAccessRow } from "../settings/controls";

export type MemberItem = {
  membershipId: string;
  name: string;
  role: MemberRole;
  position: string;
  revoked: string[];
  isMe: boolean;
};

const compact = (s: string) => s.replace(/\s+/g, "").toLowerCase();

/** 멤버 목록 + 검색 (이름·역할·부서/직책) */
export function MemberList({ items }: { items: MemberItem[] }) {
  const [query, setQuery] = useState("");
  const q = compact(query);
  const matches = (m: MemberItem) =>
    !q || compact(m.name).includes(q) || compact(ROLE_LABELS[m.role] ?? "").includes(q) || compact(m.position).includes(q);
  const shown = items.filter(matches).length;

  return (
    <div className="space-y-3">
      {items.length > 1 && (
        <div className="space-y-1">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="이름·역할·부서로 검색 (예: 홍길동, 부장, 기획부)"
            aria-label="멤버 검색"
            className="h-11 w-full rounded-xl border border-zinc-300 bg-white px-3 text-base outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 dark:border-zinc-700 dark:bg-zinc-900"
          />
          {q && (
            <p className="text-sm text-zinc-500">
              {shown}명 찾음{shown === 0 ? " · 검색어를 바꿔 보세요." : ""}
            </p>
          )}
        </div>
      )}
      <ul className="space-y-3">
        {items.map((m) => (
          // 검색에서 빠진 사람은 숨기기만 한다 (고치던 내용이 사라지지 않게)
          <MemberAccessRow key={m.membershipId} {...m} hidden={!matches(m)} />
        ))}
      </ul>
    </div>
  );
}
