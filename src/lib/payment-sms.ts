/**
 * 카드 결제 문자(SMS·앱 알림) 해석기.
 *
 * 카드사마다 형식이 조금씩 다르지만 대체로 다음 요소가 들어 있다.
 *   [Web발신]
 *   신한카드(1234)승인 홍*동
 *   12,500원(일시불)
 *   11/23 14:05 스타벅스
 *   누적1,234,567원
 *
 * 순수 함수만 두고 다른 모듈을 가져오지 않는다 (node --test로 바로 테스트하려고).
 */

export type PaymentKind = "approval" | "cancel" | "unknown";

export type ParsedPayment = {
  kind: PaymentKind;
  /** 원 단위 정수 */
  amount: number | null;
  merchant: string | null;
  /** ISO 8601 (한국 시간 +09:00) */
  approvedAt: string | null;
  /** 해석하지 못한 이유. 성공이면 null */
  error: string | null;
};

/** 발신 표시 등 앞머리 */
const HEADER = /\[(?:Web발신|웹발신|국외발신|국제발신|광고)\]/g;

/** 결제 금액이 아닌 금액 앞에 붙는 말 */
const NON_PAYMENT_AMOUNT = /(누적|잔액|한도|이용가능|가능액|포인트)\s*[:：]?\s*$/;

/** 금액 뒤에 붙는 결제 방식 표기 */
const PAY_TYPE = /^[ \t]*\(?[ \t]*(?:일시불|체크|할부[ \t]*\d*[ \t]*개?월?|\d+[ \t]*개월)[ \t]*\)?/;

const AMOUNT = /(\d{1,3}(?:,\d{3})+|\d+)\s*원/g;
const DATETIME = /(\d{1,2})[/.-](\d{1,2})\s*(\d{1,2}):(\d{2})/;

/** 해석 전에 줄바꿈·공백·앞머리를 정리한다 */
export function normalizeSms(raw: string) {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(HEADER, "")
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** 같은 문자인지 판단할 때 쓰는 형태 (공백 차이 무시) */
export function dedupeSource(raw: string) {
  return normalizeSms(raw).replace(/\s+/g, "");
}

/** 저장 전에 카드번호를 가린다 */
export function maskSms(raw: string) {
  return raw
    .replace(/\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g, "****-****-****-****")
    .replace(/\((\d{3,4})\)/g, (_, d: string) => `(${"*".repeat(d.length)})`)
    .replace(/([가-힣A-Za-z])(\d{4})(?=\s*(?:승인|취소|사용))/g, (_, p: string) => `${p}****`);
}

function detectKind(text: string): PaymentKind {
  if (/취소/.test(text)) return "cancel";
  if (/승인|사용|결제/.test(text)) return "approval";
  return "unknown";
}

function findAmount(text: string) {
  for (const m of text.matchAll(AMOUNT)) {
    const before = text.slice(Math.max(0, m.index - 8), m.index);
    if (NON_PAYMENT_AMOUNT.test(before)) continue;
    const value = Number(m[1].replace(/,/g, ""));
    if (Number.isSafeInteger(value) && value > 0) return { value, index: m.index, end: m.index + m[0].length };
  }
  return null;
}

/**
 * 월/일만 있는 날짜에 연도를 붙인다.
 * 기준 시각보다 이틀 넘게 미래면 작년 문자로 본다 (12월 말 결제를 1월에 받는 경우).
 */
function toIso(month: number, day: number, hour: number, minute: number, now: Date) {
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const seoulYear = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", year: "numeric" }).format(now));
  const pad = (n: number) => String(n).padStart(2, "0");
  for (const year of [seoulYear, seoulYear - 1]) {
    const iso = `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00+09:00`;
    const time = Date.parse(iso);
    if (Number.isNaN(time)) return null;
    // 2월 30일처럼 없는 날짜 거르기
    const check = new Date(time + 9 * 3600_000);
    if (check.getUTCMonth() + 1 !== month || check.getUTCDate() !== day) return null;
    if (time <= now.getTime() + 2 * 24 * 3600_000) return iso;
  }
  return null;
}

/** 가맹점 이름 다듬기: 뒤에 붙은 누적·잔액 안내와 기호를 뗀다 */
function cleanMerchant(value: string) {
  const cut = value.split(/\s*(?:총?누적|잔액|이용가능|한도)/)[0];
  const merchant = cut.replace(/^[\s:：\-·]+|[\s:：\-·]+$/g, "").trim();
  if (!merchant || /^\d[\d,]*원?$/.test(merchant)) return null;
  return merchant.slice(0, 100);
}

/** 가맹점이 아닌 줄 (카드명·승인 표기, 이름, 금액) */
function isNotMerchantLine(line: string) {
  return /승인|취소|카드|원|\*|님$/.test(line);
}

function findMerchant(text: string, dateStart: number, dateEnd: number) {
  const lines = text.slice(dateEnd).split("\n");
  // 1) 날짜 뒤 같은 줄
  const sameLine = cleanMerchant(lines[0] ?? "");
  if (sameLine) return sameLine;
  // 2) 날짜 다음 줄들
  for (const line of lines.slice(1)) {
    if (/^(?:총?누적|잔액|이용가능|한도)/.test(line)) continue;
    const m = cleanMerchant(line);
    if (m) return m;
  }
  // 3) 날짜 바로 앞 줄 (가맹점이 날짜보다 먼저 나오는 형식)
  const before = text.slice(0, dateStart).split("\n");
  const sameLineBefore = before[before.length - 1].trim();
  const prev = sameLineBefore || before[before.length - 2] || "";
  if (prev && !isNotMerchantLine(prev)) return cleanMerchant(prev);
  return null;
}

/** 결제 문자 한 건을 해석한다. `now`는 연도 추정 기준(테스트용). */
export function parsePaymentSms(raw: string, now: Date = new Date()): ParsedPayment {
  const text = normalizeSms(raw);
  if (!text) return { kind: "unknown", amount: null, merchant: null, approvedAt: null, error: "내용이 비어 있어요." };

  const kind = detectKind(text);
  const amount = findAmount(text);

  // 금액 뒤 결제 방식 표기(일시불 등)는 가맹점으로 오인하지 않게 지운 뒤 날짜를 찾는다.
  let scan = text;
  if (amount) {
    const after = text.slice(amount.end);
    const payType = after.match(PAY_TYPE);
    if (payType) scan = text.slice(0, amount.end) + " ".repeat(payType[0].length) + after.slice(payType[0].length);
  }

  const dt = scan.match(DATETIME);
  const approvedAt = dt ? toIso(Number(dt[1]), Number(dt[2]), Number(dt[3]), Number(dt[4]), now) : null;
  const merchant = dt && dt.index !== undefined ? findMerchant(scan, dt.index, dt.index + dt[0].length) : null;

  let error: string | null = null;
  if (kind === "unknown") error = "승인·취소 문자인지 알 수 없어요.";
  else if (!amount) error = "금액을 찾지 못했어요.";
  else if (!approvedAt) error = "승인 시각을 찾지 못했어요.";

  return { kind, amount: amount?.value ?? null, merchant, approvedAt, error };
}
