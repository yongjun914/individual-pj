import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "학생회 업무포털",
    short_name: "학생회 업무포털",
    description: "학생회 영수증 관리와 감사 자료 자동 생성",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#084d98",
    lang: "ko",
    // 상명대 로고 (public/logos/sangmyung.jpg로 만든 정사각형 아이콘)
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
