import { timingSafeEqual } from "node:crypto";

/**
 * 카카오 어드민 키 (서버 전용, 브라우저에 노출하지 않는다).
 * 카카오디벨로퍼스 > 앱 > 어드민 키 에서 확인한다. 없으면 카카오 연동 기능(연결 끊기·웹훅)을 건너뛴다.
 */
function adminKey() {
  return process.env.KAKAO_ADMIN_KEY || null;
}

export function hasKakaoAdminKey() {
  return Boolean(adminKey());
}

/**
 * 탈퇴한 사용자와 이 앱의 카카오 연결을 끊는다 (카카오 '연결 끊기' API).
 * 끊지 못해도 탈퇴는 이미 끝난 상태라 에러를 던지지 않고 결과만 돌려준다.
 */
export async function unlinkKakaoUser(kakaoUserId: string): Promise<"unlinked" | "skipped" | "failed"> {
  const key = adminKey();
  if (!key || !/^\d+$/.test(kakaoUserId)) return "skipped";
  try {
    const res = await fetch("https://kapi.kakao.com/v1/user/unlink", {
      method: "POST",
      headers: {
        Authorization: `KakaoAK ${key}`,
        "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
      },
      body: new URLSearchParams({ target_id_type: "user_id", target_id: kakaoUserId }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.error("카카오 연결 끊기 실패", res.status, await res.text().catch(() => ""));
      return "failed";
    }
    return "unlinked";
  } catch (e) {
    console.error("카카오 연결 끊기 요청 실패", e);
    return "failed";
  }
}

/** 카카오 웹훅 요청인지 확인한다: Authorization 헤더가 "KakaoAK {어드민 키}" */
export function isKakaoWebhookAuthorized(authorization: string | null) {
  const key = adminKey();
  if (!key || !authorization) return false;
  const expected = Buffer.from(`KakaoAK ${key}`);
  const actual = Buffer.from(authorization.trim());
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
