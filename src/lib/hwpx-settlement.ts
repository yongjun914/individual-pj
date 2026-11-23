/**
 * 한글(HWPX) 결산내역서 양식 채우기.
 *
 * 학교에서 쓰는 '학회비 결산내역서' 양식 파일을 그대로 두고, 아래 칸만 채운다.
 *   - 감사 대상 기간, 학부/과
 *   - 예산내역: '예산액' 옆 칸(항목·금액), '예산 총계'
 *   - 결산내역: '행사명' 아래 줄들(행사명·집행액·산출내역), '총 집행액'
 *   - 결산 총계: 예산액·총 집행액·잔액
 * 칸은 위치가 아니라 머리 글자('행사명', '예산 총계' 등)로 찾아서, 양식이 조금 바뀌어도 동작한다.
 * 지출이 양식의 빈 줄보다 많으면 같은 모양의 줄을 늘린다.
 *
 * HWPX는 ZIP 안에 XML(Contents/section0.xml 등)이 든 형식이다.
 * 브라우저·테스트 양쪽에서 쓰려고 DOMParser·XMLSerializer를 밖에서 받는다.
 */
import { unzipSync, zipSync, type Zippable } from "fflate";

import type { AuditReport } from "./audit";

const HP_NS = "http://www.hancom.co.kr/hwpml/2011/paragraph";

export type SettlementData = {
  /** "26.05.11" 형식 */
  from: string;
  to: string;
  /** 학부/과 이름. 비우면 양식에 적힌 그대로 둔다 */
  dept: string;
  incomeLines: { label: string; amount: number }[];
  incomeTotal: number;
  expenseLines: { category: string; amount: number; description: string }[];
  expenseTotal: number;
  balance: number;
};

export type XmlTools = {
  DOMParser: { new (): { parseFromString(xml: string, type: string): Document } };
  XMLSerializer: { new (): { serializeToString(node: Node): string } };
};

const won = (n: number) => n.toLocaleString("ko-KR");
const shortDate = (iso: string) => iso.slice(2).replace(/-/g, ".");

/** 감사 자료 → 양식에 넣을 값 */
export function buildSettlementData(
  report: AuditReport,
  meta: { orgName: string; from: string; to: string },
): SettlementData {
  // 행사 순서: 첫 지출 번호 순, 미분류는 맨 뒤 (엑셀 결산내역서와 같게)
  const groups = new Map<string, AuditReport["rows"]>();
  for (const row of report.rows) {
    const key = row.category ?? "미분류";
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const ordered = [...groups.entries()].sort(
    ([a, ra], [b, rb]) => Number(a === "미분류") - Number(b === "미분류") || ra[0].no - rb[0].no,
  );

  return {
    from: shortDate(meta.from),
    to: shortDate(meta.to),
    dept: meta.orgName.replace(/\s*(학생회|학회)$/, "").trim(),
    incomeLines: report.incomeSources.map((s) => ({ label: s.source, amount: s.total })),
    incomeTotal: report.incomeTotal,
    expenseLines: ordered.flatMap(([category, rows]) =>
      rows.map((r, i) => ({
        category: i === 0 ? category : "",
        amount: r.amount,
        description: `${r.merchant || "사용처 없음"} (증빙 ${r.no})`,
      })),
    ),
    expenseTotal: report.total,
    balance: report.balance,
  };
}

// ---------------------------------------------------------------------
// XML 도우미
// ---------------------------------------------------------------------

type Cell = { tc: Element; row: number; col: number; colSpan: number; rowSpan: number; text: string };

function elementChildren(node: Element, name: string) {
  const out: Element[] = [];
  for (let n = node.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (n as Element).nodeName === name) out.push(n as Element);
  }
  return out;
}

function all(node: Document | Element, name: string) {
  return Array.from(node.getElementsByTagName(name));
}

function cellText(tc: Element) {
  return all(tc, "hp:p")
    .map((p) => all(p, "hp:t").map((t) => t.textContent ?? "").join(""))
    .join("\n")
    .trim();
}

/** 표의 칸 목록. 중첩된 표의 칸은 빼고, 이 표에 직접 속한 칸만 */
function cellsOf(tbl: Element): Cell[] {
  const cells: Cell[] = [];
  for (const tr of elementChildren(tbl, "hp:tr")) {
    for (const tc of elementChildren(tr, "hp:tc")) {
      const addr = elementChildren(tc, "hp:cellAddr")[0];
      const span = elementChildren(tc, "hp:cellSpan")[0];
      cells.push({
        tc,
        row: Number(addr?.getAttribute("rowAddr") ?? 0),
        col: Number(addr?.getAttribute("colAddr") ?? 0),
        colSpan: Number(span?.getAttribute("colSpan") ?? 1),
        rowSpan: Number(span?.getAttribute("rowSpan") ?? 1),
        text: cellText(tc),
      });
    }
  }
  return cells;
}

const norm = (s: string) => s.replace(/\s+/g, "");

function findCell(cells: Cell[], pred: (text: string) => boolean) {
  return cells.find((c) => pred(norm(c.text)));
}

/** 같은 줄에서 이 칸 바로 오른쪽 칸 */
function rightOf(cells: Cell[], cell: Cell) {
  return cells
    .filter((c) => c.row === cell.row && c.col >= cell.col + cell.colSpan)
    .sort((a, b) => a.col - b.col)[0];
}

/** 칸의 글자를 바꾼다. 줄마다 문단 하나. 첫 문단의 글자 모양을 그대로 쓴다. */
function setCellLines(doc: Document, tc: Element, lines: string[]) {
  const subList = elementChildren(tc, "hp:subList")[0];
  if (!subList) return;
  const paragraphs = elementChildren(subList, "hp:p");
  if (paragraphs.length === 0) return;
  // 글자가 들어 있던 문단을 본보기로 (빈 문단은 글자 모양이 다를 수 있다)
  const template = paragraphs.find((p) => all(p, "hp:t").length > 0) ?? paragraphs[0];
  const firstId = paragraphs[0].getAttribute("id");
  for (const p of paragraphs) subList.removeChild(p);

  (lines.length > 0 ? lines : [""]).forEach((line, i) => {
    const p = template.cloneNode(true) as Element;
    p.setAttribute("id", i === 0 && firstId ? firstId : "0");
    // 줄 배치 정보는 한글이 열 때 다시 계산한다
    for (const seg of elementChildren(p, "hp:linesegarray")) p.removeChild(seg);
    const runs = elementChildren(p, "hp:run");
    runs.slice(1).forEach((r) => p.removeChild(r));
    const run = runs[0] ?? p.appendChild(doc.createElementNS(HP_NS, "hp:run"));
    while (run.firstChild) run.removeChild(run.firstChild);
    if (line) {
      const t = doc.createElementNS(HP_NS, "hp:t");
      t.appendChild(doc.createTextNode(line));
      run.appendChild(t);
    }
    subList.appendChild(p);
  });
}

/** 문단 안의 글자 하나를 바꾸고, 그 문단의 줄 배치 정보를 지운다 */
function replaceText(t: Element, value: string) {
  t.textContent = value;
  const p = t.parentNode?.parentNode as Element | null;
  if (p?.nodeName === "hp:p") for (const seg of elementChildren(p, "hp:linesegarray")) p.removeChild(seg);
}

// ---------------------------------------------------------------------
// 채우기
// ---------------------------------------------------------------------

/** section XML 하나를 채운다. 찾지 못한 칸은 warnings에 남긴다. */
export function fillSettlementXml(xml: string, data: SettlementData, tools: XmlTools) {
  const doc = new tools.DOMParser().parseFromString(xml, "application/xml");
  const found = { period: false, income: false, expense: false, summary: false };

  // 1) 감사 대상 기간, 학부/과
  for (const t of all(doc, "hp:t")) {
    const text = t.textContent ?? "";
    if (/감사\s*대상\s*기간\s*:/.test(text)) {
      replaceText(t, text.replace(/(감사\s*대상\s*기간\s*:\s*)[^)]*/, `$1${data.from} ~ ${data.to}`));
      found.period = true;
    } else if (data.dept && /^\s*학부\s*\/\s*과\s*:/.test(text)) {
      replaceText(t, text.replace(/(학부\s*\/\s*과\s*:\s*).*/, `$1${data.dept}`));
    }
  }

  for (const tbl of all(doc, "hp:tbl")) {
    const cells = cellsOf(tbl);

    // 2) 예산내역
    const budgetTotal = findCell(cells, (t) => t === "예산총계");
    const budgetLabel = findCell(cells, (t) => /예산액$/.test(t) && !/총/.test(t));
    if (budgetTotal && budgetLabel && !findCell(cells, (t) => t === "행사명")) {
      const names = rightOf(cells, budgetLabel);
      const amounts = names && rightOf(cells, names);
      const total = rightOf(cells, budgetTotal);
      if (names && amounts && total) {
        setCellLines(doc, names.tc, data.incomeLines.map((l) => l.label));
        setCellLines(doc, amounts.tc, data.incomeLines.map((l) => won(l.amount)));
        setCellLines(doc, total.tc, [won(data.incomeTotal)]);
        found.income = true;
      }
    }

    // 3) 결산내역
    const header = findCell(cells, (t) => t === "행사명");
    // '총 집행액' 줄의 이름 칸 (맨 왼쪽). '결산 총계' 줄에도 같은 글자가 있어 왼쪽 칸만 본다
    const totalLabel = cells.find((c) => norm(c.text) === "총집행액" && c.col === 0 && header && c.row > header.row);
    if (header && totalLabel) {
      fillExpenseRows(doc, tbl, header.row, data);
      found.expense = true;
    }

    // 4) 결산 총계 (같은 표 안, 위 작업으로 줄 번호가 바뀌었으니 다시 읽는다)
    const after = cellsOf(tbl);
    const summaryLabel = findCell(after, (t) => t === "결산총계");
    if (summaryLabel) {
      const labels = after.filter((c) => c.row === summaryLabel.row && c !== summaryLabel);
      const values = after.filter((c) => c.row === summaryLabel.row + 1);
      const valueAt = (label: Cell) => values.find((v) => v.col === label.col);
      for (const label of labels) {
        const key = norm(label.text);
        const target = valueAt(label);
        if (!target) continue;
        if (/예산액/.test(key)) setCellLines(doc, target.tc, [won(data.incomeTotal)]);
        else if (/집행액/.test(key)) setCellLines(doc, target.tc, [won(data.expenseTotal)]);
        else if (/잔액/.test(key)) setCellLines(doc, target.tc, [won(data.balance)]);
      }
      found.summary = true;
    }
  }

  return { xml: new tools.XMLSerializer().serializeToString(doc), found };
}

/** '행사명' 머리 줄 아래부터 '총 집행액' 줄 전까지를 지출로 채운다 */
function fillExpenseRows(doc: Document, tbl: Element, headerRow: number, data: SettlementData) {
  const trs = elementChildren(tbl, "hp:tr");
  const rowIndexOf = (tr: Element) => Number(elementChildren(elementChildren(tr, "hp:tc")[0], "hp:cellAddr")[0]?.getAttribute("rowAddr"));
  const totalTr = trs.find((tr) => {
    const first = elementChildren(tr, "hp:tc")[0];
    return rowIndexOf(tr) > headerRow && first && norm(cellText(first)) === "총집행액";
  });
  if (!totalTr) return;

  let dataTrs = trs.filter((tr) => rowIndexOf(tr) > headerRow && rowIndexOf(tr) < rowIndexOf(totalTr));
  if (dataTrs.length === 0) return;

  // 줄이 모자라면 마지막 줄 모양을 복사해 늘린다
  const extra = data.expenseLines.length - dataTrs.length;
  if (extra > 0) {
    const model = dataTrs[dataTrs.length - 1];
    const rowHeight = Math.max(
      ...elementChildren(model, "hp:tc").map((tc) => Number(elementChildren(tc, "hp:cellSz")[0]?.getAttribute("height") ?? 0)),
    );
    for (let i = 0; i < extra; i++) tbl.insertBefore(model.cloneNode(true), totalTr);
    // 줄 번호·줄 수·표 높이 다시 맞추기
    elementChildren(tbl, "hp:tr").forEach((tr, r) => {
      for (const tc of elementChildren(tr, "hp:tc")) elementChildren(tc, "hp:cellAddr")[0]?.setAttribute("rowAddr", String(r));
    });
    tbl.setAttribute("rowCnt", String(elementChildren(tbl, "hp:tr").length));
    const sz = elementChildren(tbl, "hp:sz")[0];
    if (sz && rowHeight > 0) sz.setAttribute("height", String(Number(sz.getAttribute("height") ?? 0) + rowHeight * extra));
    dataTrs = elementChildren(tbl, "hp:tr").filter((tr) => {
      const r = rowIndexOf(tr);
      return r > headerRow && r < rowIndexOf(totalTr);
    });
  }

  dataTrs.forEach((tr, i) => {
    const line = data.expenseLines[i];
    const tcs = elementChildren(tr, "hp:tc").sort(
      (a, b) =>
        Number(elementChildren(a, "hp:cellAddr")[0]?.getAttribute("colAddr")) -
        Number(elementChildren(b, "hp:cellAddr")[0]?.getAttribute("colAddr")),
    );
    const values = line ? [line.category, won(line.amount), line.description, won(line.amount)] : ["", "", "", ""];
    tcs.forEach((tc, c) => setCellLines(doc, tc, [values[c] ?? ""]));
  });

  // 총 집행액 값
  const totalTcs = elementChildren(totalTr, "hp:tc");
  const labelIdx = totalTcs.findIndex((tc) => norm(cellText(tc)) === "총집행액");
  const valueTc = totalTcs[labelIdx + 1];
  if (valueTc) setCellLines(doc, valueTc, [won(data.expenseTotal)]);
}

// ---------------------------------------------------------------------
// HWPX 파일
// ---------------------------------------------------------------------

export class HwpxError extends Error {}

/** 한글 양식 파일(HWPX)을 채운 새 파일 바이트를 돌려준다 */
export function fillSettlementHwpx(bytes: Uint8Array, data: SettlementData, tools: XmlTools) {
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf) {
    throw new HwpxError("예전 한글 형식(.hwp) 파일이에요. 한글에서 '다른 이름으로 저장 → 한글 표준 문서(*.hwpx)'로 저장한 파일을 골라 주세요.");
  }
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new HwpxError("HWPX 파일을 열지 못했어요. 한글에서 HWPX로 저장한 파일인지 확인해 주세요.");
  }
  const sections = Object.keys(files).filter((name) => /^Contents\/section\d+\.xml$/.test(name));
  if (!files["mimetype"] || sections.length === 0) {
    throw new HwpxError("한글 문서(HWPX) 파일이 아니에요.");
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const warnings = new Set<string>();
  const found = { period: false, income: false, expense: false, summary: false };
  for (const name of sections) {
    const result = fillSettlementXml(decoder.decode(files[name]), data, tools);
    files[name] = encoder.encode(result.xml);
    for (const k of Object.keys(found) as (keyof typeof found)[]) found[k] ||= result.found[k];
  }
  if (!found.period) warnings.add("'감사 대상 기간' 글자를 찾지 못해 기간을 넣지 못했어요.");
  if (!found.income) warnings.add("'예산액'·'예산 총계' 칸을 찾지 못해 수입을 넣지 못했어요.");
  if (!found.expense) warnings.add("'행사명'·'총 집행액' 칸을 찾지 못해 지출을 넣지 못했어요.");
  if (!found.summary) warnings.add("'결산 총계' 칸을 찾지 못했어요.");

  // mimetype은 맨 앞에, 압축하지 않고 (HWPX·OCF 규칙)
  const zippable: Zippable = { mimetype: [files["mimetype"], { level: 0 }] };
  for (const [name, content] of Object.entries(files)) {
    if (name === "mimetype") continue;
    zippable[name] = [content, { level: 6 }];
  }
  return { bytes: zipSync(zippable), warnings: [...warnings] };
}
