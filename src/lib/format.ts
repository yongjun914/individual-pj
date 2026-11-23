/** 152000 → "152,000원" */
export function formatWon(amount: number) {
  return `${amount.toLocaleString("ko-KR")}원`;
}

/** 오늘 날짜(한국 시간) "YYYY-MM-DD" */
export function todayInSeoul(now = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(now);
}

/** "2026-11-20" → "11월 20일" */
export function formatShortDate(isoDate: string) {
  const [, m, d] = isoDate.split("-").map(Number);
  return `${m}월 ${d}일`;
}
