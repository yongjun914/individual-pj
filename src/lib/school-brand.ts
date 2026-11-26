import type { Metadata, MetadataRoute } from "next";

/**
 * 학교별 표시(로고·사이트 아이콘).
 *   상명대: 학교 로고와 상명대 아이콘
 *   그 밖의 학교: 홈에는 학교 이름을 글자로, 사이트 아이콘은 공통 학사모 아이콘
 */
export type SchoolBrand = "sangmyung" | "default";

export function schoolBrand(schoolName: string | null | undefined): SchoolBrand {
  return schoolName?.includes("상명") ? "sangmyung" : "default";
}

/** 홈 화면 학교 로고 (없으면 null → 학교 이름을 글자로 보여 준다) */
export function schoolLogo(schoolName: string) {
  if (schoolBrand(schoolName) === "sangmyung") {
    return { src: "/logos/sangmyung.jpg", alt: "상명대학교 로고", width: 1488, height: 2000 };
  }
  return null;
}

/** 브라우저 탭·iOS 홈 화면 아이콘 */
export function schoolIcons(brand: SchoolBrand): NonNullable<Metadata["icons"]> {
  return {
    icon: [{ url: `/icons/${brand}/favicon.png`, type: "image/png", sizes: "64x64" }],
    apple: [{ url: `/icons/${brand}/apple-icon.png`, sizes: "180x180" }],
  };
}

/** 앱 설치(PWA) 아이콘 */
export function schoolManifestIcons(brand: SchoolBrand): MetadataRoute.Manifest["icons"] {
  return [
    { src: `/icons/${brand}/icon-192.png`, sizes: "192x192", type: "image/png" },
    { src: `/icons/${brand}/icon-512.png`, sizes: "512x512", type: "image/png" },
    { src: `/icons/${brand}/icon-maskable-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
  ];
}
