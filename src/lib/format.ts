/** 152000 → "152,000원" */
export function formatWon(amount: number) {
  return `${amount.toLocaleString("ko-KR")}원`;
}

/** 오늘 날짜(한국 시간) "YYYY-MM-DD" */
export function todayInSeoul(now = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(now);
}

/** "2026-11-20" → "2026년 11월 20일" */
export function formatLongDate(isoDate: string) {
  const [y, m, d] = isoDate.split("-").map(Number);
  return `${y}년 ${m}월 ${d}일`;
}

/** 시각(타임스탬프) → "11월 20일 14:05" (한국 시간) */
export function formatDateTime(timestamp: string) {
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(timestamp));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("month")}월 ${get("day")}일 ${get("hour")}:${get("minute")}`;
}

/** "2026-11-20" → "11월 20일" */
export function formatShortDate(isoDate: string) {
  const [, m, d] = isoDate.split("-").map(Number);
  return `${m}월 ${d}일`;
}
