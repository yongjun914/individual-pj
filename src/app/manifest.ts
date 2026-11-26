import type { MetadataRoute } from "next";

import { schoolManifestIcons } from "@/lib/school-brand";
import { getMySchoolBrand } from "@/lib/school-brand-server";

/** 앱 설치 정보. 아이콘은 로그인한 사용자의 학교에 맞춘다(상명대: 학교 로고, 그 밖: 학사모). */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const brand = await getMySchoolBrand();
  return {
    name: "학생회 업무포털",
    short_name: "학생회 업무포털",
    description: "학생회 영수증 관리와 감사 자료 자동 생성",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#084d98",
    lang: "ko",
    icons: schoolManifestIcons(brand),
  };
}
