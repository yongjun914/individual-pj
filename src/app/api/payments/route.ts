import { createHash } from "node:crypto";

import { dedupeSource, maskSms, parsePaymentSms } from "@/lib/payment-sms";
import { createAnonClient } from "@/lib/supabase/anon";

/**
 * 결제 문자 수신 웹훅 (F-16).
 *
 * 폰의 자동화(iOS 단축어·MacroDroid)가 결제 문자를 받으면 이 주소로 보낸다.
 *   POST /api/payments
 *   Authorization: Bearer <학생회 웹훅 토큰>
 *   본문: {"text": "문자 원문"}  또는 문자 원문 그대로(text/plain)
 */

/** 문자 한 건 최대 길이 (그보다 길면 결제 문자가 아니다) */
const MAX_TEXT = 2000;

type IngestResult = {
  result:
    | "created"
    | "cancelled"
    | "duplicate"
    | "unparsed"
    | "cancel_unmatched"
    | "no_active_term"
    | "invalid_token"
    | "bad_request";
  expense_id?: string;
};

const MESSAGES: Record<IngestResult["result"], string> = {
  created: "지출을 만들었어요. 영수증을 첨부해 주세요.",
  cancelled: "결제 취소를 반영했어요.",
  duplicate: "이미 받은 문자예요.",
  unparsed: "문자를 받았지만 해석하지 못했어요. 결제 연동 화면의 수신 기록을 확인해 주세요.",
  cancel_unmatched: "취소 문자를 받았지만 맞는 지출을 찾지 못했어요.",
  no_active_term: "현재 기수가 없어 지출을 만들지 못했어요.",
  invalid_token: "토큰이 올바르지 않거나 폐기되었어요.",
  bad_request: "요청 내용을 확인해 주세요.",
};

function reply(result: IngestResult["result"], status: number, extra: Record<string, unknown> = {}) {
  return Response.json({ ok: status < 400, result, message: MESSAGES[result], ...extra }, { status });
}

async function readText(request: Request) {
  const body = await request.text();
  if (body.length > MAX_TEXT * 4) return null;
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    try {
      const json = JSON.parse(body) as { text?: unknown };
      return typeof json.text === "string" ? json.text : null;
    } catch {
      return null;
    }
  }
  return body;
}

export async function POST(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) return reply("invalid_token", 401);

  const text = (await readText(request))?.trim();
  if (!text || text.length > MAX_TEXT) return reply("bad_request", 400);

  const parsed = parsePaymentSms(text);
  const dedupeKey = createHash("sha256").update(dedupeSource(text), "utf8").digest("hex");

  const supabase = createAnonClient();
  const { data, error } = await supabase.rpc("ingest_payment_event", {
    p_token: token,
    p_raw_text: maskSms(text),
    p_kind: parsed.kind,
    p_amount: parsed.amount,
    p_merchant: parsed.merchant,
    p_approved_at: parsed.approvedAt,
    p_parse_error: parsed.error,
    p_dedupe_key: dedupeKey,
  });

  if (error || !data) {
    console.error("결제 문자 저장 실패", error);
    return Response.json({ ok: false, message: "잠시 후 다시 시도해 주세요." }, { status: 500 });
  }

  const { result, expense_id } = data as IngestResult;
  if (result === "invalid_token") return reply(result, 401);
  if (result === "bad_request") return reply(result, 400);
  return reply(result, 200, expense_id ? { expenseId: expense_id } : {});
}
