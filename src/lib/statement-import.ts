/**
 * 통장 거래내역·카드 이용내역 파일 해석기.
 *
 * 은행·카드사마다 칸 순서와 이름이 달라서, 위쪽 줄에서 머리글(거래일자, 출금액, 가맹점명 …)을
 * 찾아 칸의 역할을 정한다. 엑셀 파일 읽기는 화면 쪽에서 하고, 여기서는 셀 값의 2차원 배열만 다룬다.
 *
 * 순수 함수만 두고 다른 모듈을 가져오지 않는다 (node --test로 바로 테스트하려고).
 */

export type Cell = string | number | boolean | null | undefined;

export type ImportMethod = "card" | "transfer" | "cash";

export type StatementKind =
  | "expense" // 지출로 가져올 수 있음
  | "deposit" // 입금 (가져오지 않음)
  | "cancel" // 취소·환불 (가져오지 않음)
  | "invalid"; // 읽지 못한 줄

export type StatementRow = {
  /** 파일에서의 줄 번호 (1부터) */
  line: number;
  kind: StatementKind;
  spentOn: string | null;
  time: string | null;
  merchant: string;
  amount: number | null;
  method: ImportMethod;
  /** 같은 파일 안에 짝이 되는 취소 건이 있음 (기본으로 빼 둔다) */
  cancelledInFile: boolean;
  /** 화면에 보일 안내 */
  note: string | null;
};

export type StatementFormat = "bank" | "card";

export type ParsedStatement =
  | { ok: true; format: StatementFormat; headerLine: number; columns: Partial<Record<Role, string>>; rows: StatementRow[] }
  | { ok: false; error: string };

type Role = "date" | "time" | "withdrawal" | "deposit" | "amount" | "merchant" | "type" | "status";

/** 역할별 머리글 이름 (정리한 뒤 정확히 같아야 한다). 앞쪽이 우선. */
const HEADERS: Record<Role, string[]> = {
  date: ["거래일시", "거래일자", "거래일", "거래날짜", "이용일시", "이용일자", "이용일", "승인일시", "승인일자", "승인일", "사용일자", "사용일", "일자", "날짜", "일시"],
  time: ["거래시간", "거래시각", "이용시간", "승인시간", "승인시각", "시간", "시각"],
  withdrawal: ["출금액", "출금금액", "출금", "찾으신금액", "지급금액", "지급액", "출금(원)"],
  deposit: ["입금액", "입금금액", "입금", "맡기신금액"],
  amount: ["이용금액", "승인금액", "결제금액", "거래금액", "사용금액", "금액"],
  merchant: ["가맹점명", "가맹점", "이용가맹점", "이용하신곳", "이용처", "사용처", "거래처", "기재내용", "거래내용", "내용", "받는분", "받는분/보낸분", "보낸분/받는분", "상대방", "거래점"],
  type: ["적요", "거래구분", "구분", "거래종류", "거래유형", "이용구분", "승인구분", "카드구분"],
  status: ["취소여부", "취소구분", "승인상태", "처리상태", "상태", "결과"],
};

/** 정해진 순서대로 역할을 배정한다 (앞에서 가져간 칸은 뒤에서 못 쓴다) */
const ROLE_ORDER: Role[] = ["date", "time", "withdrawal", "deposit", "amount", "merchant", "type", "status"];

/** 머리글을 찾을 때 볼 최대 줄 수 (위에 계좌 정보 등이 몇 줄 있다) */
const HEADER_SEARCH_ROWS = 40;

/** 머리글 비교용: 공백·괄호 속 단위·기호를 지운다 */
function normalizeHeader(value: Cell) {
  return String(value ?? "")
    .replace(/\s+/g, "")
    .replace(/\((?:원|KRW|₩)\)/gi, "")
    .replace(/[*:：]/g, "")
    .trim();
}

function detectColumns(row: Cell[]) {
  const names = row.map(normalizeHeader);
  const used = new Set<number>();
  const columns: Partial<Record<Role, number>> = {};
  for (const role of ROLE_ORDER) {
    for (const keyword of HEADERS[role]) {
      const idx = names.findIndex((n, i) => !used.has(i) && n === keyword);
      if (idx >= 0) {
        columns[role] = idx;
        used.add(idx);
        break;
      }
    }
  }
  // 내용 칸이 없으면 적요를 가맹점으로 쓴다
  if (columns.merchant === undefined && columns.type !== undefined) {
    columns.merchant = columns.type;
    delete columns.type;
  }
  return columns;
}

function findHeader(rows: Cell[][]) {
  const limit = Math.min(rows.length, HEADER_SEARCH_ROWS);
  for (let i = 0; i < limit; i++) {
    const columns = detectColumns(rows[i] ?? []);
    const hasMoney = columns.withdrawal !== undefined || columns.amount !== undefined;
    if (columns.date !== undefined && hasMoney) return { index: i, columns };
  }
  return null;
}

function text(value: Cell) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

/** "12,500", "12,500원", "-12,500", 12500 → 정수. 비었으면 0, 숫자가 아니면 null */
export function parseAmountCell(value: Cell): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value) : null;
  const s = text(value).replace(/[,원₩\s]/g, "");
  if (s === "" || s === "-") return 0;
  const negative = /^\(.*\)$/.test(s) || s.startsWith("-");
  const digits = s.replace(/[()+-]/g, "");
  if (!/^\d+(\.\d+)?$/.test(digits)) return null;
  const n = Math.round(Number(digits));
  return negative ? -n : n;
}

const pad = (n: number) => String(n).padStart(2, "0");

function validDate(y: number, m: number, d: number) {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * 날짜 셀 → { date: "YYYY-MM-DD", time: "HH:MM" | null }
 * 지원: 2026-11-23, 2026.11.23, 2026/11/23, 20261123, 26.11.23, 시각이 붙은 형태, 엑셀 날짜 일련번호
 */
export function parseDateCell(value: Cell): { date: string; time: string | null } | null {
  if (typeof value === "number") {
    // 엑셀 일련번호 (1900 날짜 체계): 1899-12-30 기준 일수
    if (value < 30000 || value > 80000) return null;
    const ms = Math.round((value - 25569) * 86400_000);
    const dt = new Date(ms);
    const date = validDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
    if (!date) return null;
    const hasTime = value % 1 !== 0;
    return { date, time: hasTime ? `${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}` : null };
  }

  const s = text(value);
  const m =
    s.match(/^(\d{4})[-./년\s]*(\d{1,2})[-./월\s]*(\d{1,2})일?(?:[\sT]+(\d{1,2}):(\d{2})(?::\d{2})?)?/) ??
    s.match(/^(\d{2})[-./](\d{1,2})[-./](\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::\d{2})?)?$/);
  if (m) {
    const year = m[1].length === 2 ? 2000 + Number(m[1]) : Number(m[1]);
    const date = validDate(year, Number(m[2]), Number(m[3]));
    if (!date) return null;
    const time = m[4] !== undefined ? `${pad(Number(m[4]))}:${m[5]}` : null;
    return { date, time };
  }
  const compact = s.match(/^(\d{4})(\d{2})(\d{2})(?:\s*(\d{2}):?(\d{2}))?/);
  if (compact) {
    const date = validDate(Number(compact[1]), Number(compact[2]), Number(compact[3]));
    if (!date) return null;
    return { date, time: compact[4] !== undefined ? `${compact[4]}:${compact[5]}` : null };
  }
  return null;
}

function parseTimeCell(value: Cell) {
  if (typeof value === "number" && value >= 0 && value < 1) {
    const minutes = Math.round(value * 24 * 60);
    return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
  }
  const m = text(value).match(/(\d{1,2}):(\d{2})/);
  return m ? `${pad(Number(m[1]))}:${m[2]}` : null;
}

function detectMethod(hint: string, format: StatementFormat): ImportMethod {
  if (/카드|체크|신용|페이|pay/i.test(hint)) return "card";
  if (/현금|ATM|CD출금|자동화기기/i.test(hint)) return "cash";
  if (/이체|송금|대체|타행|당행|CMS|자동납부|오픈뱅킹|인터넷|모바일|폰뱅킹/i.test(hint)) return "transfer";
  return format === "card" ? "card" : "transfer";
}

/** 합계·소계 같은 요약 줄 */
function isSummaryRow(cells: string[]) {
  return cells.some((c) => /^(합계|소계|총계|총\s*\d+\s*건|계)$/.test(c.replace(/\s/g, "")));
}

const merchantKey = (s: string) => s.replace(/\s+/g, "").toLowerCase();

/** 파일 한 장(시트)의 셀 배열을 해석한다 */
export function parseStatement(rows: Cell[][]): ParsedStatement {
  const header = findHeader(rows);
  if (!header) {
    return {
      ok: false,
      error: "거래일자와 금액 칸을 찾지 못했어요. 은행·카드사에서 받은 거래내역 엑셀 파일인지 확인해 주세요.",
    };
  }

  const { index, columns } = header;
  const format: StatementFormat = columns.withdrawal !== undefined ? "bank" : "card";
  const headerRow = rows[index] ?? [];
  const columnNames: Partial<Record<Role, string>> = {};
  for (const [role, i] of Object.entries(columns) as [Role, number][]) columnNames[role] = text(headerRow[i]);

  const get = (row: Cell[], role: Role) => (columns[role] === undefined ? undefined : row[columns[role]!]);

  const parsed: StatementRow[] = [];
  for (let r = index + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const cells = row.map(text);
    if (cells.every((c) => c === "")) continue;
    if (isSummaryRow(cells)) continue;

    const line = r + 1;
    const dateInfo = parseDateCell(get(row, "date"));
    const typeText = text(get(row, "type"));
    const statusText = text(get(row, "status"));
    const merchant = text(get(row, "merchant")).slice(0, 100) || typeText.slice(0, 100);
    const time = dateInfo?.time ?? (columns.time !== undefined ? parseTimeCell(get(row, "time")) : null);
    const method = detectMethod(`${typeText} ${merchant}`, format);
    const base = { line, spentOn: dateInfo?.date ?? null, time, merchant, method, cancelledInFile: false };

    if (!dateInfo) {
      parsed.push({ ...base, kind: "invalid", amount: null, note: "날짜를 읽지 못했어요." });
      continue;
    }

    const isCancel = /취소|환불|반품/.test(`${statusText} ${typeText}`);
    let kind: StatementKind;
    let amount: number | null;

    if (format === "bank") {
      const out = parseAmountCell(get(row, "withdrawal"));
      const inn = columns.deposit !== undefined ? parseAmountCell(get(row, "deposit")) : 0;
      if (out === null || inn === null) {
        parsed.push({ ...base, kind: "invalid", amount: null, note: "금액을 읽지 못했어요." });
        continue;
      }
      if (out > 0) {
        kind = isCancel ? "cancel" : "expense";
        amount = out;
      } else if (inn > 0) {
        kind = isCancel ? "cancel" : "deposit";
        amount = inn;
      } else {
        continue; // 금액 없는 줄 (잔액 이월 등)
      }
    } else {
      const value = parseAmountCell(get(row, "amount"));
      if (value === null || value === 0) {
        parsed.push({ ...base, kind: "invalid", amount: null, note: "금액을 읽지 못했어요." });
        continue;
      }
      kind = isCancel || value < 0 ? "cancel" : "expense";
      amount = Math.abs(value);
    }

    parsed.push({ ...base, kind, amount, note: null });
  }

  // 같은 파일 안의 결제·취소 짝 맞추기: 금액과 가맹점이 같으면 결제 건을 기본 제외
  for (const cancel of parsed.filter((r) => r.kind === "cancel")) {
    const match = parsed.find(
      (r) =>
        r.kind === "expense" &&
        !r.cancelledInFile &&
        r.amount === cancel.amount &&
        merchantKey(r.merchant) === merchantKey(cancel.merchant),
    );
    if (match) {
      match.cancelledInFile = true;
      match.note = `${cancel.line}번째 줄에 취소 건이 있어요.`;
    }
  }

  return { ok: true, format, headerLine: index + 1, columns: columnNames, rows: parsed };
}

/** 여러 시트 중 해석되는 첫 시트를 고른다 */
export function parseWorkbookSheets(sheets: { name: string; rows: Cell[][] }[]) {
  let firstError: string | null = null;
  for (const sheet of sheets) {
    const result = parseStatement(sheet.rows);
    if (result.ok) return { ...result, sheetName: sheet.name };
    firstError ??= result.error;
  }
  return { ok: false as const, error: firstError ?? "빈 파일이에요." };
}
