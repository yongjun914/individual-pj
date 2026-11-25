"use client";

import Link, { useLinkStatus } from "next/link";

export type EventTab = { key: string; label: string; href: string };

/**
 * 행사 화면 탭 (명단·돈·행사 정보).
 * 탭을 바꾸면 서버에서 화면을 다시 받아 오는데, 그동안 아무 표시가 없으면 휴대폰에서 '안 눌린' 것처럼 보인다.
 * 그래서 누르는 즉시 밑줄과 점으로 표시하고, 탭을 화면 너비만큼 나눠 누르는 영역을 넓혔다.
 */
export function EventTabs({ tabs, current }: { tabs: EventTab[]; current: string }) {
  return (
    <nav aria-label="행사 화면" className="flex border-b border-zinc-200 md:gap-1 dark:border-zinc-800">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          scroll={false}
          aria-current={current === t.key ? "page" : undefined}
          className={`group -mb-px flex min-h-12 flex-1 touch-manipulation items-center justify-center border-b-2 px-4 font-medium select-none md:flex-none ${
            current === t.key
              ? "border-blue-600 text-blue-700 dark:text-blue-300"
              : "border-transparent text-zinc-500 hover:text-zinc-800 active:bg-zinc-100 dark:active:bg-zinc-900"
          }`}
        >
          <TabLabel label={t.label} />
        </Link>
      ))}
    </nav>
  );
}

function TabLabel({ label }: { label: string }) {
  const { pending } = useLinkStatus();
  return (
    <span className={`relative inline-flex items-center gap-1.5 ${pending ? "text-blue-700 dark:text-blue-300" : ""}`}>
      {label}
      {/* 크기는 늘 같고 보이기만 바뀐다 (글자가 밀리지 않게) */}
      <span
        aria-hidden
        className={`h-1.5 w-1.5 rounded-full bg-blue-600 transition-opacity ${pending ? "animate-pulse opacity-100" : "opacity-0"}`}
      />
    </span>
  );
}
