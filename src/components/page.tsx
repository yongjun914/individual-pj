import Link from "next/link";

/**
 * 로그인 뒤 화면들의 공통 본문 틀.
 * width: wide(대시보드·목록), normal(상세·설정), narrow(입력 폼)
 */
const WIDTHS = {
  wide: "max-w-6xl",
  normal: "max-w-4xl",
  narrow: "max-w-2xl",
} as const;

export function Page({
  width = "wide",
  children,
}: {
  width?: keyof typeof WIDTHS;
  children: React.ReactNode;
}) {
  return (
    <main className={`mx-auto flex w-full ${WIDTHS[width]} flex-1 flex-col gap-6 px-4 py-6 md:gap-8 md:px-8 md:py-10`}>
      {children}
    </main>
  );
}

/** 화면 제목 줄: 제목·설명 왼쪽, 버튼 오른쪽 (휴대폰에서는 아래로) */
export function PageHeader({
  title,
  description,
  back,
  actions,
}: {
  title: string;
  description?: React.ReactNode;
  back?: { href: string; label: string };
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div className="space-y-1">
        {back && (
          <Link href={back.href} className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 underline decoration-blue-300 decoration-2 underline-offset-4 hover:decoration-blue-600 dark:text-blue-300">
            ← {back.label}
          </Link>
        )}
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{title}</h1>
        {description && <p className="max-w-2xl text-zinc-600 dark:text-zinc-400">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** 테두리 있는 카드 */
export function Card({
  title,
  description,
  actions,
  children,
  className = "",
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`space-y-4 rounded-3xl border border-zinc-200/80 bg-white p-5 shadow-[0_10px_30px_-18px_rgb(70_56_147/0.35)] md:p-6 dark:border-zinc-800 dark:bg-zinc-900 ${className}`}>
      {(title || actions) && (
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            {title && <h2 className="text-lg font-semibold">{title}</h2>}
            {description && <p className="text-sm text-zinc-500">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

/** 버튼처럼 보이는 링크 */
export function ButtonLink({
  href,
  children,
  variant = "primary",
}: {
  href: string;
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "green";
}) {
  const style = {
    primary: "rounded-full btn-glow bg-linear-to-r from-blue-500 to-blue-600 text-white hover:to-blue-700",
    green: "rounded-lg bg-green-300 text-green-950 hover:bg-green-400",
    secondary: "rounded-lg btn-brutal bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100",
  }[variant];
  return (
    <Link href={href} className={`inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap px-5 font-medium ${style}`}>
      {children}
    </Link>
  );
}
