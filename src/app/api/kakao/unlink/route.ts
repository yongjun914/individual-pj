import { isKakaoWebhookAuthorized } from "@/lib/kakao";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * 카카오 '연결 해제' 웹훅.
 *
 * 사용자가 카카오 쪽(카카오톡 설정 > 연결된 서비스 관리 등)에서 이 앱과의 연결을 끊으면
 * 카카오가 이 주소로 알려 준다. 받은 회원번호의 계정을 지운다(회원 탈퇴와 같은 처리).
 *   GET 또는 POST /api/kakao/unlink?app_id=...&user_id=...&referrer_type=...
 *   Authorization: KakaoAK {어드민 키}
 *
 * 카카오디벨로퍼스 > 앱 > 웹훅 에 배포 주소로 등록해야 동작한다 (localhost는 카카오가 부를 수 없음).
 * 카카오는 몇 초 안에 응답받기를 기대하므로 처리 결과와 관계없이 빠르게 200을 돌려준다.
 */

async function readParams(request: Request) {
  const url = new URL(request.url);
  const params = new URLSearchParams(url.search);
  if (request.method === "POST") {
    const type = request.headers.get("content-type") ?? "";
    const body = await request.text();
    if (type.includes("application/json")) {
      try {
        for (const [k, v] of Object.entries(JSON.parse(body) as Record<string, unknown>)) params.set(k, String(v));
      } catch {
        // 잘못된 본문은 무시
      }
    } else {
      for (const [k, v] of new URLSearchParams(body)) params.set(k, v);
    }
  }
  return params;
}

async function handle(request: Request) {
  if (!isKakaoWebhookAuthorized(request.headers.get("authorization"))) {
    return new Response("unauthorized", { status: 401 });
  }

  const params = await readParams(request);
  const userId = params.get("user_id");
  if (!userId || !/^\d+$/.test(userId)) return new Response("bad request", { status: 400 });

  const supabase = createServiceClient();
  if (!supabase) {
    console.error("카카오 연결 해제 웹훅: SUPABASE_SECRET_KEY가 없어 처리하지 못했어요.", { userId });
    return new Response("not configured", { status: 503 });
  }

  const { data, error } = await supabase.rpc("delete_user_by_kakao_id", { p_kakao_id: userId });
  if (error) {
    console.error("카카오 연결 해제 웹훅 처리 실패", error);
    return new Response("error", { status: 500 });
  }

  // 이미 탈퇴한 사용자(data === false)여도 정상 응답
  return new Response(data ? "deleted" : "ok", { status: 200 });
}

export const GET = handle;
export const POST = handle;
