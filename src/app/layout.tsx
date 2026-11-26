import type { Metadata, Viewport } from "next";
import { Geist_Mono, Noto_Sans_KR } from "next/font/google";
import { schoolIcons } from "@/lib/school-brand";

import "./globals.css";

/** 한글 본문 글꼴 (가독성 개선: 예전에는 Arial로 지정돼 한글이 시스템 기본 글꼴로 떨어졌다) */
const notoSansKr = Noto_Sans_KR({
  variable: "--font-noto-sans-kr",
  weight: ["400", "500", "600", "700"],
  display: "swap",
  preload: false,
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "학생회 업무포털",
    template: "%s | 학생회 업무포털",
  },
  description: "학생회 영수증 관리와 감사 자료 자동 생성",
  // 기본 아이콘(학사모). 로그인 뒤 화면은 (app)/layout.tsx에서 학교에 맞게 바꾼다.
  icons: schoolIcons("default"),
  appleWebApp: {
    capable: true,
    title: "학생회 업무포털",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#2563eb",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ko"
      className={`${notoSansKr.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
