"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { signOut } from "@/app/auth/actions";

export type NavUser = {
  name: string;
  /** 대표 학생회 이름과 직책 (예: "전자공학과 학생회 · 총무") */
  subtitle: string | null;
  isManager: boolean;
};

type NavItem = { href: string; label: string; managerOnly?: boolean };

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "홈" },
  { href: "/expenses", label: "지출" },
  { href: "/incomes", label: "수입" },
  { href: "/audit", label: "감사 준비", managerOnly: true },
  { href: "/settings", label: "학생회 설정", managerOnly: true },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** 상단 바: 로고, PC 메뉴, 지출 등록 버튼, 사용자 메뉴 (휴대폰에서는 로고와 메뉴 버튼만) */
export function TopBar({ user }: { user: NavUser | null }) {
  const pathname = usePathname();
  const items = NAV_ITEMS.filter((i) => !i.managerOnly || user?.isManager);
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
    <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 md:px-8">
        <Link href="/" className="flex shrink-0 items-center gap-2 font-bold">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-sm text-white">회계</span>
          <span className="text-lg">학생회 회계</span>
        </Link>

        <nav aria-label="주 메뉴" className="hidden flex-1 items-center gap-1 md:flex">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(pathname, item.href) ? "page" : undefined}
              className={`rounded-lg px-3 py-2 font-medium ${
                isActive(pathname, item.href)
                  ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                  : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/expenses/new"
            className="hidden h-10 items-center rounded-xl bg-blue-600 px-4 font-medium text-white hover:bg-blue-700 md:inline-flex"
          >
            + 지출 등록
          </Link>

          {user && (
            <div ref={menuRef} className="relative hidden md:block">
              <button
                type="button"
                onClick={() => setMenuOpen(!menuOpen)}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                className="flex h-10 items-center gap-2 rounded-xl px-2 hover:bg-zinc-100 dark:hover:bg-zinc-900"
              >
                <Avatar name={user.name} />
                <span className="max-w-32 truncate font-medium">{user.name}</span>
                <span aria-hidden className="text-zinc-400">▾</span>
              </button>
              {menuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 mt-2 w-64 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-950"
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
            className="flex h-10 w-10 items-center justify-center rounded-xl text-xl hover:bg-zinc-100 md:hidden dark:hover:bg-zinc-900"
          >
            {mobileOpen ? "✕" : "☰"}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <nav aria-label="전체 메뉴" className="border-t border-zinc-200 bg-white px-4 pb-4 md:hidden dark:border-zinc-800 dark:bg-zinc-950">
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
                  className={`block rounded-lg px-3 py-3 text-lg font-medium ${
                    isActive(pathname, item.href) ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300" : ""
                  }`}
                >
                  {item.label}
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

function Avatar({ name }: { name: string }) {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-sm font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
      {name.slice(0, 1)}
    </span>
  );
}

const TABS = [
  { href: "/", label: "홈", icon: "⌂" },
  { href: "/expenses", label: "지출", icon: "↗" },
  { href: "/expenses/new", label: "등록", icon: "+", primary: true },
  { href: "/incomes", label: "수입", icon: "↙" },
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
          // '지출' 탭은 등록 화면에서는 켜지지 않게
          const active =
            tab.href === "/expenses"
              ? isActive(pathname, "/expenses") && !pathname.startsWith("/expenses/new")
              : isActive(pathname, tab.href);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className="flex h-16 flex-col items-center justify-center gap-0.5 text-xs font-medium"
              >
                {tab.primary ? (
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-2xl leading-none text-white shadow">
                    {tab.icon}
                  </span>
                ) : (
                  <>
                    <span
                      aria-hidden
                      className={`text-xl leading-none ${active ? "text-blue-600" : "text-zinc-400"}`}
                    >
                      {tab.icon}
                    </span>
                    <span className={active ? "text-blue-700 dark:text-blue-300" : "text-zinc-500"}>{tab.label}</span>
                  </>
                )}
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
    <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 md:px-8">
        <Link href="/" className="flex shrink-0 items-center gap-2 font-bold">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-sm text-white">회계</span>
          <span className="text-lg">학생회 회계</span>
        </Link>
      </div>
    </header>
  );
}
