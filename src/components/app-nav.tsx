"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { signOut } from "@/app/auth/actions";

export type NavUser = {
  name: string;
  /** 대표 학생회 이름과 직책 (예: "전자공학과 학생회 · 총무") */
  subtitle: string | null;
  /** 학회장·부학회장: 학생회원 관리 메뉴가 보인다 */
  isAdmin: boolean;
  /** 처리할 직책 변경 요청 수 (학회장·부학회장) */
  pendingRequests: number;
  canAudit: boolean;
  canSettings: boolean;
};

type NavItem = { href: string; label: string; need?: "audit" | "settings" | "admin" };

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "홈" },
  { href: "/expenses", label: "지출" },
  { href: "/incomes", label: "수입" },
  { href: "/events", label: "행사 관리" },
  { href: "/audit", label: "감사 준비", need: "audit" },
  { href: "/settings", label: "학생회 설정", need: "settings" },
  { href: "/members", label: "학생회원 관리", need: "admin" },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** 상단 바: 로고, PC 메뉴, 사용자 메뉴 (휴대폰에서는 로고와 메뉴 버튼만) */
export function TopBar({ user }: { user: NavUser | null }) {
  const pathname = usePathname();
  const items = NAV_ITEMS.filter(
    (i) =>
      !i.need ||
      (i.need === "audit" && user?.canAudit) ||
      (i.need === "settings" && user?.canSettings) ||
      (i.need === "admin" && user?.isAdmin),
  );
  // 메뉴를 연 화면 주소를 기억한다. 다른 화면으로 이동하면 주소가 달라져 자동으로 닫힌다.
  const [menuOpenAt, setMenuOpenAt] = useState<string | null>(null);
  const [mobileOpenAt, setMobileOpenAt] = useState<string | null>(null);
  const menuOpen = menuOpenAt === pathname;
  const mobileOpen = mobileOpenAt === pathname;
  const setMenuOpen = (open: boolean) => setMenuOpenAt(open ? pathname : null);
  const menuRef = useRef<HTMLDivElement>(null);

  // 메뉴 바깥을 누르면 닫는다
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpenAt(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  return (
    <header className="sticky top-0 z-30 border-b border-zinc-200/70 bg-white/80 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/80">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 md:px-8 xl:gap-6">
        <Link href="/" className="flex shrink-0 items-center gap-2 font-bold">
          <Image src="/icons/icon-192.png" alt="" width={36} height={36} priority className="h-9 w-9 rounded-lg" />
          <span className="text-lg">학생회 회계</span>
        </Link>

        <nav aria-label="주 메뉴" className="hidden flex-1 items-center gap-0.5 lg:flex">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(pathname, item.href) ? "page" : undefined}
              className={`whitespace-nowrap rounded-full px-2.5 py-1.5 font-medium xl:px-3 transition-colors ${
                isActive(pathname, item.href)
                  ? "bg-linear-to-r from-blue-100 to-blue-200 text-blue-800 dark:from-blue-950 dark:to-blue-900 dark:text-blue-200"
                  : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
              }`}
            >
              {item.label}
              {item.need === "admin" && user && user.pendingRequests > 0 && <RequestBadge count={user.pendingRequests} />}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {user && (
            <div ref={menuRef} className="relative hidden lg:block">
              <button
                type="button"
                onClick={() => setMenuOpen(!menuOpen)}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                className="flex h-10 items-center gap-2 rounded-full py-1 pl-1 pr-3 hover:bg-zinc-100 dark:hover:bg-zinc-900"
              >
                <Avatar name={user.name} />
                <span className="hidden max-w-32 truncate font-medium xl:inline">{user.name}</span>
                <span aria-hidden className="text-zinc-400">▾</span>
              </button>
              {menuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 mt-3 w-64 overflow-hidden rounded-2xl btn-brutal bg-white dark:bg-zinc-900"
                >
                  <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
                    <p className="font-medium">{user.name}</p>
                    {user.subtitle && <p className="text-sm text-zinc-500">{user.subtitle}</p>}
                  </div>
                  <Link role="menuitem" href="/me" className="block px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900">
                    마이페이지
                  </Link>
                  <form action={signOut}>
                    <button
                      role="menuitem"
                      type="submit"
                      className="block w-full px-4 py-3 text-left text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-900"
                    >
                      로그아웃
                    </button>
                  </form>
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => setMobileOpenAt(mobileOpen ? null : pathname)}
            aria-expanded={mobileOpen}
            aria-label="전체 메뉴"
            className="flex h-10 w-10 items-center justify-center rounded-xl text-xl hover:bg-zinc-100 lg:hidden dark:hover:bg-zinc-900"
          >
            {mobileOpen ? "✕" : "☰"}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <nav aria-label="전체 메뉴" className="border-t border-zinc-200 bg-white px-4 pb-4 lg:hidden dark:border-zinc-800 dark:bg-zinc-950">
          {user && (
            <div className="flex items-center gap-3 py-4">
              <Avatar name={user.name} />
              <div className="min-w-0">
                <p className="truncate font-medium">{user.name}</p>
                {user.subtitle && <p className="truncate text-sm text-zinc-500">{user.subtitle}</p>}
              </div>
            </div>
          )}
          <ul className="space-y-1">
            {[...items, { href: "/me", label: "마이페이지" }].map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`block rounded-full px-4 py-3 text-lg font-medium ${
                    isActive(pathname, item.href) ? "bg-linear-to-r from-blue-100 to-blue-200 text-blue-800 dark:from-blue-950 dark:to-blue-900 dark:text-blue-200" : ""
                  }`}
                >
                  {item.label}
                  {"need" in item && item.need === "admin" && user && user.pendingRequests > 0 && (
                    <RequestBadge count={user.pendingRequests} />
                  )}
                </Link>
              </li>
            ))}
          </ul>
          <form action={signOut} className="pt-2">
            <button type="submit" className="w-full rounded-lg px-3 py-3 text-left text-zinc-500">
              로그아웃
            </button>
          </form>
        </nav>
      )}
    </header>
  );
}

function RequestBadge({ count }: { count: number }) {
  return (
    <span
      aria-label={`처리할 요청 ${count}건`}
      className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 align-middle text-xs font-bold text-white"
    >
      {count}
    </span>
  );
}

function Avatar({ name }: { name: string }) {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-semibold text-blue-800 ring-2 ring-white dark:bg-blue-900 dark:text-blue-100 dark:ring-zinc-900">
      {name.slice(0, 1)}
    </span>
  );
}

const TABS = [
  { href: "/", label: "홈", icon: "⌂" },
  { href: "/expenses", label: "지출", icon: "↗" },
  { href: "/incomes", label: "수입", icon: "↙" },
  { href: "/events", label: "행사", icon: "✓" },
  { href: "/me", label: "마이", icon: "☺" },
];

/** 휴대폰 하단 탭 바 (PC에서는 숨김) */
export function BottomTabBar() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="하단 메뉴"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden dark:border-zinc-800 dark:bg-zinc-950/95"
    >
      <ul className="grid grid-cols-5">
        {TABS.map((tab) => {
          const active = isActive(pathname, tab.href);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className="flex h-16 flex-col items-center justify-center gap-0.5 text-xs font-medium"
              >
                <span
                  aria-hidden
                  className={`flex h-7 w-12 items-center justify-center rounded-full text-xl leading-none ${active ? "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300" : "text-zinc-400"}`}
                >
                  {tab.icon}
                </span>
                <span className={active ? "text-blue-700 dark:text-blue-300" : "text-zinc-500"}>{tab.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** 사용자 정보를 불러오는 동안 보여 줄 상단 바 (주소를 읽지 않아 미리 렌더링할 수 있다) */
export function TopBarPlaceholder() {
  return (
    <header className="sticky top-0 z-30 border-b border-zinc-200/70 bg-white/80 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/80">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 md:px-8 xl:gap-6">
        <Link href="/" className="flex shrink-0 items-center gap-2 font-bold">
          <Image src="/icons/icon-192.png" alt="" width={36} height={36} priority className="h-9 w-9 rounded-lg" />
          <span className="text-lg">학생회 회계</span>
        </Link>
      </div>
    </header>
  );
}
