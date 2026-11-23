/**
 * 감사 자료 파일 만들기 (브라우저 전용).
 * - 엑셀: 기본 형식의 지출 내역 + 행사별 합계 + 점검 결과
 * - 증빙 PDF: 엑셀과 같은 번호 순서로 영수증 사진·사유서를 한 페이지씩
 *
 * PDF는 한글 글꼴 파일을 넣지 않으려고, 페이지를 캔버스에 그린 뒤 그림으로 붙인다.
 */
import { evidenceLabel, type AuditReport, type AuditRow } from "@/lib/audit";

export type AuditMeta = {
  schoolName: string;
  orgName: string;
  termName: string;
  from: string;
  to: string;
};

const METHOD_LABELS = { card: "학생회 카드", transfer: "계좌이체", cash: "현금" } as const;
const LEVEL_LABELS = { error: "꼭 고칠 것", warning: "확인할 것", info: "참고" } as const;

/** 파일 이름에 못 쓰는 글자 빼기 */
function safeName(s: string) {
  return s.replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, "_");
}

export function fileBaseName(meta: AuditMeta) {
  return safeName(`${meta.orgName}_${meta.termName}_${meta.from}_${meta.to}`);
}

/** 브라우저에서 파일 내려받기 */
export function downloadBytes(bytes: Uint8Array | ArrayBuffer, fileName: string, type: string) {
  const blob = new Blob([bytes as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function remark(r: AuditRow) {
  const parts = [];
  if (r.memo.trim()) parts.push(r.memo.trim());
  if (r.evidence === "excused" && r.missing_reason) parts.push(`분실 사유: ${r.missing_reason}`);
  return parts.join(" / ");
}

// ---------------------------------------------------------------------
// 엑셀: 결산내역서 (학교 양식과 같은 배치)
// ---------------------------------------------------------------------

/** "2026-05-11" → "26.05.11" (양식의 감사 대상 기간 표기) */
function shortDate(iso: string) {
  return iso.slice(2).replace(/-/g, ".");
}

type XlsxModule = typeof import("xlsx");
type Merge = { s: { r: number; c: number }; e: { r: number; c: number } };

/**
 * 학회비 결산내역서 양식(한글 파일)의 배치를 7칸 표로 옮긴다.
 *   결재란 → 제목·감사 기간 → 예산내역(수입) → 결산내역(지출) → 결산 총계
 * 지출은 행사별로 묶고, 같은 행사의 둘째 줄부터는 행사명을 비운다(양식과 같게).
 */
function buildSettlementSheet(XLSX: XlsxModule, report: AuditReport, meta: AuditMeta) {
  const rows: (string | number | null)[][] = [];
  const merges: Merge[] = [];
  const moneyCells: [number, number][] = [];
  const merge = (r1: number, c1: number, r2: number, c2: number) => merges.push({ s: { r: r1, c: c1 }, e: { r: r2, c: c2 } });
  const blank = () => [null, null, null, null, null, null, null];
  const push = (row: (string | number | null)[]) => rows.push([...row, ...blank()].slice(0, 7)) - 1;

  // 결재란
  let r = push([null, null, null, null, "결재", "총무", "학회장"]);
  merge(r, 4, r + 1, 4);
  push([]);
  push([]);

  // 제목
  r = push([`${meta.termName} 결산내역서`]);
  merge(r, 0, r, 6);
  r = push([`(감사 대상 기간 : ${shortDate(meta.from)} ~ ${shortDate(meta.to)})  학부/과 : ${meta.orgName}`]);
  merge(r, 0, r, 6);
  push([]);

  // 예산내역 (수입)
  push(["예산내역"]);
  r = push([`학부/과 : ${meta.orgName}`, null, null, null, null, null, "(단위 : 원)"]);
  merge(r, 0, r, 5);
  const sources = report.incomeSources.length > 0 ? report.incomeSources : [{ source: "(수입 없음)", count: 0, total: 0 }];
  const firstIncome = rows.length;
  for (const s of sources) {
    r = push([null, s.source, null, null, s.total]);
    merge(r, 1, r, 3);
    merge(r, 4, r, 6);
    moneyCells.push([r, 4]);
  }
  rows[firstIncome][0] = "예산액";
  if (sources.length > 1) merge(firstIncome, 0, firstIncome + sources.length - 1, 0);
  r = push(["예산 총계", report.incomeTotal]);
  merge(r, 1, r, 6);
  moneyCells.push([r, 1]);
  push([]);

  // 결산내역 (지출)
  push(["결산내역서"]);
  r = push([`학부/과 : ${meta.orgName}`, null, null, null, null, null, "(단위 : 원)"]);
  merge(r, 0, r, 5);
  r = push(["행사명", "집행액", "산출내역"]);
  merge(r, 2, r, 6);

  // 행사 순서: 첫 지출 번호 순, 미분류는 맨 뒤
  const groups = new Map<string, AuditRow[]>();
  for (const row of report.rows) {
    const key = row.category ?? "미분류";
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const ordered = [...groups.entries()].sort(
    ([a, ra], [b, rb]) => Number(a === "미분류") - Number(b === "미분류") || ra[0].no - rb[0].no,
  );
  for (const [category, items] of ordered) {
    items.forEach((item, i) => {
      r = push([i === 0 ? category : null, item.amount, `${item.merchant || "사용처 없음"} (증빙 ${item.no})`, null, null, item.amount]);
      merge(r, 2, r, 4);
      merge(r, 5, r, 6);
      moneyCells.push([r, 1], [r, 5]);
    });
  }
  if (report.rows.length === 0) {
    r = push(["(지출 없음)"]);
    merge(r, 0, r, 6);
  }
  r = push(["총 집행액", report.total]);
  merge(r, 1, r, 6);
  moneyCells.push([r, 1]);

  // 결산 총계
  r = push(["결산 총계", "예산액", null, "총 집행액", null, "잔액"]);
  merge(r, 0, r + 1, 0);
  merge(r, 1, r, 2);
  merge(r, 3, r, 4);
  merge(r, 5, r, 6);
  const t = push([null, report.incomeTotal, null, report.total, null, report.balance]);
  merge(t, 1, t, 2);
  merge(t, 3, t, 4);
  merge(t, 5, t, 6);
  moneyCells.push([t, 1], [t, 3], [t, 5]);

  const sheet = XLSX.utils.aoa_to_sheet(rows);
  for (const [mr, mc] of moneyCells) {
    const cell = sheet[XLSX.utils.encode_cell({ r: mr, c: mc })];
    if (cell && typeof cell.v === "number") cell.z = "#,##0";
  }
  sheet["!merges"] = merges;
  sheet["!cols"] = [16, 14, 12, 12, 12, 12, 12].map((wch) => ({ wch }));
  return sheet;
}

// ---------------------------------------------------------------------
// 엑셀
// ---------------------------------------------------------------------

export async function buildAuditWorkbook(report: AuditReport, meta: AuditMeta) {
  const XLSX = await import("xlsx");
  const title = `${meta.schoolName} ${meta.orgName} ${meta.termName} 지출 내역`;
  const period = `기간: ${meta.from} ~ ${meta.to}`;

  // 1) 지출 내역
  const header = ["번호", "사용일", "행사", "사용처", "품목", "결제 수단", "금액", "증빙", "비고"];
  const body = report.rows.map((r) => [
    r.no,
    r.spent_on,
    r.category ?? "미분류",
    r.merchant,
    r.items,
    METHOD_LABELS[r.payment_method],
    r.amount,
    evidenceLabel(r),
    remark(r),
  ]);
  const list = XLSX.utils.aoa_to_sheet([
    [title],
    [period],
    [],
    header,
    ...body,
    ["합계", "", "", "", "", "", report.total, `${report.rows.length}건`, ""],
  ]);
  const headerRow = 3; // 0부터 센 줄 번호
  // 금액 칸 천 단위 쉼표
  for (let i = headerRow + 1; i <= headerRow + body.length + 1; i++) {
    const cell = list[XLSX.utils.encode_cell({ r: i, c: 6 })];
    if (cell) cell.z = "#,##0";
  }
  list["!cols"] = [6, 12, 12, 24, 24, 12, 12, 12, 40].map((wch) => ({ wch }));
  list["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 8 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 8 } },
  ];
  list["!autofilter"] = {
    ref: XLSX.utils.encode_range({ s: { r: headerRow, c: 0 }, e: { r: headerRow + body.length, c: 8 } }),
  };

  // 2) 행사별 합계
  const byCategory = XLSX.utils.aoa_to_sheet([
    [title],
    [period],
    [],
    ["행사", "건수", "금액"],
    ...report.categories.map((c) => [c.category, c.count, c.total]),
    ["합계", report.rows.length, report.total],
  ]);
  for (let i = 4; i <= 4 + report.categories.length; i++) {
    const cell = byCategory[XLSX.utils.encode_cell({ r: i, c: 2 })];
    if (cell) cell.z = "#,##0";
  }
  byCategory["!cols"] = [{ wch: 20 }, { wch: 8 }, { wch: 14 }];

  // 3) 점검 결과
  const checkRows: (string | number)[][] = [["구분", "점검 항목", "번호", "지출"]];
  for (const c of report.checks) {
    for (const item of c.items) checkRows.push([LEVEL_LABELS[c.level], c.title, item.no ?? "-", item.label]);
  }
  if (report.checks.length === 0) checkRows.push(["", "문제 없음", "", ""]);
  const checks = XLSX.utils.aoa_to_sheet(checkRows);
  checks["!cols"] = [{ wch: 12 }, { wch: 28 }, { wch: 6 }, { wch: 40 }];

  // 4) 수입 내역
  const incomeSheet = XLSX.utils.aoa_to_sheet([
    [title.replace("지출 내역", "수입 내역")],
    [period],
    [],
    ["받은 날", "수입 항목", "입금자", "금액", "메모"],
    ...report.incomes.map((i) => [i.received_on, i.source, i.payer, i.amount, i.memo]),
    ["합계", "", "", report.incomeTotal, `${report.incomes.length}건`],
  ]);
  for (let i = 4; i <= 4 + report.incomes.length; i++) {
    const cell = incomeSheet[XLSX.utils.encode_cell({ r: i, c: 3 })];
    if (cell) cell.z = "#,##0";
  }
  incomeSheet["!cols"] = [{ wch: 12 }, { wch: 16 }, { wch: 20 }, { wch: 14 }, { wch: 30 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildSettlementSheet(XLSX, report, meta), "결산내역서");
  XLSX.utils.book_append_sheet(wb, list, "지출 내역");
  XLSX.utils.book_append_sheet(wb, incomeSheet, "수입 내역");
  XLSX.utils.book_append_sheet(wb, byCategory, "행사별 합계");
  XLSX.utils.book_append_sheet(wb, checks, "점검 결과");
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
}

// ---------------------------------------------------------------------
// 증빙 PDF
// ---------------------------------------------------------------------

/** A4를 약 150dpi로 그린다 */
const PAGE_W = 1240;
const PAGE_H = 1754;
const MARGIN = 80;
const FONT = `"Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", "Noto Sans CJK KR", sans-serif`;

/** 글자 단위로 줄을 나눈다 (한글은 띄어쓰기가 적어 단어 단위로는 넘친다) */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const ch of paragraph) {
      if (ctx.measureText(line + ch).width > maxWidth && line) {
        lines.push(line);
        line = ch.trimStart();
      } else {
        line += ch;
      }
    }
    lines.push(line);
  }
  return lines;
}

function newPage() {
  const canvas = document.createElement("canvas");
  canvas.width = PAGE_W;
  canvas.height = PAGE_H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  ctx.fillStyle = "#111111";
  ctx.textBaseline = "top";
  return { canvas, ctx };
}

/** 증빙 페이지 위쪽 띠: 번호·날짜·사용처·금액 (반환값: 본문이 시작할 y) */
function drawHeader(ctx: CanvasRenderingContext2D, r: AuditRow, sub: string) {
  ctx.fillStyle = "#f1f5f9";
  ctx.fillRect(0, 0, PAGE_W, 220);
  ctx.fillStyle = "#111111";
  ctx.font = `bold 64px ${FONT}`;
  ctx.fillText(`증빙 ${r.no}`, MARGIN, 50);
  ctx.font = `bold 44px ${FONT}`;
  const amount = `${r.amount.toLocaleString("ko-KR")}원`;
  ctx.textAlign = "right";
  ctx.fillText(amount, PAGE_W - MARGIN, 60);
  ctx.textAlign = "left";
  ctx.font = `32px ${FONT}`;
  const info = `${r.spent_on} · ${r.merchant || "사용처 없음"} · ${r.category ?? "미분류"} · ${METHOD_LABELS[r.payment_method]}`;
  const [line] = wrapText(ctx, info, PAGE_W - MARGIN * 2);
  ctx.fillText(line, MARGIN, 140);
  ctx.fillStyle = "#64748b";
  ctx.font = `26px ${FONT}`;
  ctx.textAlign = "right";
  ctx.fillText(sub, PAGE_W - MARGIN, 145);
  ctx.textAlign = "left";
  ctx.fillStyle = "#111111";
  return 260;
}

function drawTextBlock(ctx: CanvasRenderingContext2D, title: string, text: string, top: number) {
  ctx.font = `bold 44px ${FONT}`;
  ctx.fillText(title, MARGIN, top);
  ctx.font = `34px ${FONT}`;
  let y = top + 90;
  for (const line of wrapText(ctx, text, PAGE_W - MARGIN * 2)) {
    if (y > PAGE_H - MARGIN - 40) break;
    ctx.fillText(line, MARGIN, y);
    y += 52;
  }
}

function drawCover(report: AuditReport, meta: AuditMeta, totalPages: number) {
  const { canvas, ctx } = newPage();
  ctx.font = `34px ${FONT}`;
  ctx.fillStyle = "#475569";
  ctx.fillText(meta.schoolName, MARGIN, 200);
  ctx.fillStyle = "#111111";
  ctx.font = `bold 72px ${FONT}`;
  ctx.fillText(meta.orgName, MARGIN, 260);
  ctx.font = `bold 56px ${FONT}`;
  ctx.fillText(`${meta.termName} 지출 증빙`, MARGIN, 360);

  ctx.font = `36px ${FONT}`;
  const lines = [
    `기간  ${meta.from} ~ ${meta.to}`,
    `수입  ${report.incomes.length}건 · ${report.incomeTotal.toLocaleString("ko-KR")}원`,
    `지출  ${report.rows.length}건 · ${report.total.toLocaleString("ko-KR")}원`,
    `잔액  ${report.balance.toLocaleString("ko-KR")}원`,
    `증빙  영수증 ${report.counts.receipt}건 · 분실 사유서 ${report.counts.excused}건 · 없음 ${report.counts.missing}건`,
    `페이지  표지 포함 ${totalPages}쪽`,
  ];
  lines.forEach((l, i) => ctx.fillText(l, MARGIN, 520 + i * 70));

  ctx.font = `30px ${FONT}`;
  ctx.fillStyle = "#64748b";
  ctx.fillText("증빙 번호는 결산내역서·지출 내역 엑셀의 번호와 같아요.", MARGIN, 1000);
  return canvas;
}

async function canvasToJpeg(canvas: HTMLCanvasElement) {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) throw new Error("페이지를 그리지 못했어요.");
  return new Uint8Array(await blob.arrayBuffer());
}

/** 영수증 사진 한 장을 내려받는 함수 (Supabase Storage). 실패하면 null */
export type ReceiptLoader = (storagePath: string) => Promise<Blob | null>;

export async function buildEvidencePdf(
  report: AuditReport,
  meta: AuditMeta,
  loadReceipt: ReceiptLoader,
  onProgress: (done: number, total: number) => void,
) {
  const { PDFDocument } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${meta.orgName} ${meta.termName} 지출 증빙`);
  pdf.setCreator("학생회 회계");

  // 페이지 계획: 영수증은 장마다 1쪽, 사유서·없음은 1쪽
  const pagesOf = (r: AuditRow) => Math.max(1, r.receipts.length);
  const totalPages = 1 + report.rows.reduce((s, r) => s + pagesOf(r), 0);
  let done = 0;

  const addCanvas = async (canvas: HTMLCanvasElement) => {
    const jpg = await pdf.embedJpg(await canvasToJpeg(canvas));
    const page = pdf.addPage([595.28, 841.89]); // A4 (pt)
    page.drawImage(jpg, { x: 0, y: 0, width: 595.28, height: 841.89 });
    done += 1;
    onProgress(done, totalPages);
  };

  await addCanvas(drawCover(report, meta, totalPages));

  for (const r of report.rows) {
    if (r.evidence === "receipt") {
      for (const [i, receipt] of r.receipts.entries()) {
        const { canvas, ctx } = newPage();
        const top = drawHeader(ctx, r, r.receipts.length > 1 ? `영수증 ${i + 1}/${r.receipts.length}` : "영수증");
        let bitmap: ImageBitmap | null = null;
        try {
          const blob = await loadReceipt(receipt.storage_path);
          if (blob) bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
        } catch {
          bitmap = null;
        }
        if (bitmap) {
          const boxW = PAGE_W - MARGIN * 2;
          const boxH = PAGE_H - top - MARGIN;
          const scale = Math.min(boxW / bitmap.width, boxH / bitmap.height);
          const w = bitmap.width * scale;
          const h = bitmap.height * scale;
          ctx.drawImage(bitmap, MARGIN + (boxW - w) / 2, top, w, h);
          bitmap.close();
        } else {
          drawTextBlock(
            ctx,
            "사진을 열지 못했어요",
            "이 브라우저에서 열 수 없는 형식(HEIC 등)이거나 내려받기에 실패했어요. 앱의 지출 상세 화면에서 원본을 확인해 주세요.",
            top + 40,
          );
        }
        await addCanvas(canvas);
      }
    } else {
      const { canvas, ctx } = newPage();
      const top = drawHeader(ctx, r, r.evidence === "excused" ? "분실 사유서" : "영수증 없음");
      if (r.evidence === "excused") {
        drawTextBlock(ctx, "영수증 분실 사유서", r.missing_reason ?? "", top + 40);
      } else {
        ctx.fillStyle = "#b45309";
        drawTextBlock(ctx, "영수증 없음", "감사 전에 영수증을 붙이거나 분실 사유서를 써 주세요.", top + 40);
      }
      await addCanvas(canvas);
    }
  }

  return pdf.save();
}
