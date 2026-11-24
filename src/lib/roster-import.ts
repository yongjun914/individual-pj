/**
 * 구글폼 응답 시트(또는 엑셀) 붙여 넣기 → 참가자 명단.
 *
 * 구글 시트에서 칸을 복사하면 탭으로 나뉜 글자가 된다. 첫 줄이 머리글(이름·학번…)이면
 * 그 이름으로 칸을 맞추고, 머리글이 없으면 '이름, 학번, 학년' 순서로 본다.
 * 순수 함수만 두고 다른 모듈을 가져오지 않는다 (node --test로 바로 테스트하려고).
 */
import { normalizeGrade, normalizeStudentNo } from "./events.ts";

export type RosterRow = {
  line: number;
  name: string;
  student_no: string;
  grade: number | null;
  fields: Record<string, string>;
};

export type RosterError = { line: number; text: string; reason: string };

/** 머리글 이름 → 칸 역할 (구글폼 질문 제목은 사람마다 달라 흔한 표현을 모았다) */
const NAME_HEADERS = /^(이름|성명|성함|name)$/i;
const STUDENT_HEADERS = /^(학번|입학년도|입학\s*연도|student\s*(no|id))$/i;
const GRADE_HEADERS = /^(학년|grade)$/i;
const IGNORE_HEADERS = /^(타임스탬프|timestamp|이메일 주소|email address)$/i;

/** 추가 칸 이름과 비슷한 머리글 */
const FIELD_SYNONYMS: Record<string, RegExp> = {
  사이즈: /^(사이즈|size|과잠\s*사이즈)$/i,
  이니셜: /^(이니셜|initial|각인)$/i,
  수량: /^(수량|개수|벌\s*수)$/,
  "참가 일정": /^(참가\s*일정|참여\s*일정|일정|참가\s*형태)$/,
  차량: /^(차량|교통|이동\s*수단)$/,
  "비상 연락처": /^(비상\s*연락처|연락처|전화\s*번호|휴대폰|핸드폰)$/,
};

/** 머리글을 질문 제목 앞부분으로 줄인다: "이름을 적어 주세요" → "이름" 처럼 */
function cleanHeader(h: string) {
  return h
    .replace(/\s*\(.*?\)\s*/g, "")
    .replace(/[?:：*]/g, "")
    .replace(/(을|를)?\s*(적어|입력해|알려)\s*주세요\.?$/, "")
    .trim();
}

function splitLine(line: string) {
  return line.includes("\t") ? line.split("\t") : line.split(",");
}

export function parseRoster(text: string, extraFields: string[]): { rows: RosterRow[]; errors: RosterError[] } {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const rows: RosterRow[] = [];
  const errors: RosterError[] = [];

  const firstIndex = lines.findIndex((l) => l.trim() !== "");
  if (firstIndex < 0) return { rows, errors };

  // 머리글 찾기
  const firstCells = splitLine(lines[firstIndex]).map((c) => cleanHeader(c.trim()));
  const hasHeader = firstCells.some((c) => NAME_HEADERS.test(c));
  let col = { name: 0, student: 1, grade: 2 as number | null };
  const fieldCols = new Map<string, number>();

  if (hasHeader) {
    const find = (re: RegExp) => firstCells.findIndex((c) => re.test(c));
    const gradeIdx = find(GRADE_HEADERS);
    col = { name: find(NAME_HEADERS), student: find(STUDENT_HEADERS), grade: gradeIdx >= 0 ? gradeIdx : null };
    for (const field of extraFields) {
      const re = FIELD_SYNONYMS[field];
      const idx = firstCells.findIndex((c, i) => !IGNORE_HEADERS.test(c) && (c === field || (re ? re.test(c) : false)) && i !== col.name);
      if (idx >= 0) fieldCols.set(field, idx);
    }
  }

  for (let i = hasHeader ? firstIndex + 1 : firstIndex; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === "") continue;
    const cells = splitLine(raw).map((c) => c.trim());
    const line = i + 1;

    const name = (cells[col.name] ?? "").replace(/\s+/g, " ").trim();
    if (!name) {
      errors.push({ line, text: raw, reason: "이름이 없어요." });
      continue;
    }
    if (name.length > 30) {
      errors.push({ line, text: raw, reason: "이름이 너무 길어요." });
      continue;
    }
    if (col.student < 0) {
      errors.push({ line, text: raw, reason: "학번 칸을 찾지 못했어요. 머리글에 '학번'이 있는지 확인해 주세요." });
      continue;
    }
    const studentNo = normalizeStudentNo(cells[col.student]);
    if (!studentNo) {
      errors.push({ line, text: raw, reason: `학번을 알아볼 수 없어요 (${cells[col.student] || "비어 있음"}). 22, 24처럼 2자리로 적어 주세요.` });
      continue;
    }

    const fields: Record<string, string> = {};
    for (const [field, idx] of fieldCols) {
      const v = (cells[idx] ?? "").trim();
      if (v) fields[field] = v.slice(0, 100);
    }

    rows.push({
      line,
      name,
      student_no: studentNo,
      grade: col.grade === null ? null : normalizeGrade(cells[col.grade]),
      fields,
    });
  }

  return { rows, errors };
}
