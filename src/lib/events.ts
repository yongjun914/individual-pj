/**
 * 행사 관리 공용 정의: 종류, 종류별 기본 명단 칸, 학번 정리, 진행 상태, 과잠 집계.
 * 순수 함수만 두고 다른 모듈을 가져오지 않는다 (node --test로 바로 테스트하려고).
 */

export const EVENT_KINDS = ["opening", "closing", "freshmen", "mt", "lt", "jacket", "other"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const EVENT_KIND_LABELS: Record<EventKind, string> = {
  opening: "개강총회",
  closing: "종강총회",
  freshmen: "신환회",
  mt: "MT",
  lt: "LT",
  jacket: "과잠 신청",
  other: "기타",
};

/** 종류별 기본 추가 칸 (이름·학번·학년·납부·참석은 모든 행사에 있다) */
export const KIND_EXTRA_FIELDS: Record<EventKind, string[]> = {
  opening: [],
  closing: [],
  freshmen: [],
  mt: ["참가 일정", "차량", "비상 연락처"],
  lt: ["참가 일정", "비상 연락처"],
  jacket: ["사이즈", "이니셜", "수량"],
  other: [],
};

export const JACKET_SIZES = ["XS", "S", "M", "L", "XL", "2XL", "3XL"] as const;

/** 새 행사 이름 제안: "2026 개강총회" */
export function suggestEventName(kind: EventKind, year: number) {
  return kind === "other" ? "" : `${year} ${EVENT_KIND_LABELS[kind]}`;
}

/**
 * 학번 입력을 앞 2자리로 정리한다.
 * "24" → "24", "24학번" → "24", "2024" → "24", "2024123456" → "24", "20241234" → "24"
 * 알아볼 수 없으면 null.
 */
export function normalizeStudentNo(input: string | number | null | undefined): string | null {
  const s = String(input ?? "").trim().replace(/학번$/, "").trim();
  const digits = s.replace(/\D/g, "");
  if (digits !== s.replace(/[\s-]/g, "")) return null; // 숫자 외 글자가 섞임
  if (/^\d{2}$/.test(digits)) return digits;
  // 20으로 시작하는 4자리 이상 → 연도 뒤 2자리 (2024…)
  if (/^20\d{2}\d*$/.test(digits) && digits.length >= 4) return digits.slice(2, 4);
  return null;
}

/** "3", "3학년", 3 → 3 (1~6). 없거나 이상하면 null */
export function normalizeGrade(input: string | number | null | undefined): number | null {
  const m = String(input ?? "").trim().match(/^(\d)\s*(학년)?$/);
  if (!m) return null;
  const g = Number(m[1]);
  return g >= 1 && g <= 6 ? g : null;
}

export type EventStatus = "undated" | "upcoming" | "ongoing" | "done";

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  undated: "날짜 미정",
  upcoming: "예정",
  ongoing: "진행 중",
  done: "끝남",
};

/** 행사 날짜와 오늘(YYYY-MM-DD)로 진행 상태를 정한다 */
export function eventStatus(startsOn: string | null, endsOn: string | null, today: string): EventStatus {
  if (!startsOn) return "undated";
  const end = endsOn ?? startsOn;
  if (today < startsOn) return "upcoming";
  if (today > end) return "done";
  return "ongoing";
}

type JacketRow = { fields: Record<string, unknown>; paid?: boolean };

/** 과잠 사이즈별 수량 합계 (수량 칸이 비면 1벌) */
export function jacketSummary(rows: JacketRow[]) {
  const bySize = new Map<string, number>();
  let total = 0;
  for (const r of rows) {
    const size = String(r.fields["사이즈"] ?? "").trim().toUpperCase() || "미정";
    const qtyRaw = Number(String(r.fields["수량"] ?? "").replace(/\D/g, ""));
    const qty = Number.isInteger(qtyRaw) && qtyRaw > 0 ? qtyRaw : 1;
    bySize.set(size, (bySize.get(size) ?? 0) + qty);
    total += qty;
  }
  const order = (s: string) => {
    const i = (JACKET_SIZES as readonly string[]).indexOf(s);
    return i < 0 ? 99 : i;
  };
  const sizes = [...bySize.entries()].sort((a, b) => order(a[0]) - order(b[0])).map(([size, count]) => ({ size, count }));
  return { sizes, total };
}

/** 참가비 납부 합계: 과잠은 수량 × 참가비, 그 외는 납부 인원 × 참가비 */
export function paidTotal(kind: EventKind, fee: number, rows: JacketRow[]) {
  const paid = rows.filter((r) => r.paid);
  if (kind !== "jacket") return { count: paid.length, amount: paid.length * fee };
  const { total } = jacketSummary(paid);
  return { count: paid.length, amount: total * fee };
}
