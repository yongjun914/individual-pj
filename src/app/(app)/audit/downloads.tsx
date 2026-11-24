"use client";

import { useState, useTransition } from "react";

import type { AuditReport } from "@/lib/audit";
import { buildSettlementData, fillSettlementHwpx, HwpxError } from "@/lib/hwpx-settlement";
import { createClient } from "@/lib/supabase/client";

import { buildAuditWorkbook, buildEvidencePdf, downloadBytes, fileBaseName, type AuditMeta } from "./exporters";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const HWPX_TYPE = "application/hwp+zip";

type Format = "hwpx" | "xlsx";

/** 결산내역서(한글 양식 채우기 / 엑셀)·증빙 PDF 내려받기 */
export function AuditDownloads({ report, meta, errorCount }: { report: AuditReport; meta: AuditMeta; errorCount: number }) {
  const [isPending, startTransition] = useTransition();
  const [format, setFormat] = useState<Format>("hwpx");
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const empty = report.rows.length === 0 && report.incomes.length === 0;
  const noExpenses = report.rows.length === 0;

  function run(label: string, task: () => Promise<void>, failMessage: string) {
    setError(null);
    setWarnings([]);
    startTransition(async () => {
      try {
        setProgress(label);
        await task();
      } catch (e) {
        console.error(e);
        setError(e instanceof HwpxError ? e.message : failMessage);
      } finally {
        setProgress(null);
      }
    });
  }

  function hwpx(file: File) {
    run(
      "양식에 채우는 중…",
      async () => {
        const template = new Uint8Array(await file.arrayBuffer());
        const { bytes, warnings: notFound } = fillSettlementHwpx(template, buildSettlementData(report, meta), {
          DOMParser: window.DOMParser,
          XMLSerializer: window.XMLSerializer,
        });
        setWarnings(notFound);
        downloadBytes(bytes, `${fileBaseName(meta)}_결산내역서.hwpx`, HWPX_TYPE);
      },
      "양식을 채우지 못했어요. 한글에서 HWPX로 저장한 결산내역서 양식인지 확인해 주세요.",
    );
  }

  function excel() {
    run(
      "엑셀 만드는 중…",
      async () => {
        const bytes = await buildAuditWorkbook(report, meta);
        downloadBytes(bytes, `${fileBaseName(meta)}_결산내역서.xlsx`, XLSX_TYPE);
      },
      "엑셀을 만들지 못했어요. 다시 시도해 주세요.",
    );
  }

  function pdf() {
    run(
      "증빙 PDF 준비 중…",
      async () => {
        const supabase = createClient();
        const bytes = await buildEvidencePdf(
          report,
          meta,
          async (path) => {
            const { data, error: downloadError } = await supabase.storage.from("receipts").download(path);
            return downloadError ? null : data;
          },
          (done, total) => setProgress(`증빙 PDF 만드는 중… ${done}/${total}쪽`),
        );
        downloadBytes(bytes, `${fileBaseName(meta)}_증빙.pdf`, "application/pdf");
      },
      "증빙 PDF를 만들지 못했어요. 영수증이 많으면 기간을 나눠서 받아 주세요.",
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
      {warnings.length > 0 && (
        <div className="space-y-1 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <p className="font-medium">파일은 받았지만 일부 칸을 채우지 못했어요.</p>
          <ul className="list-disc pl-5">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      {errorCount > 0 && (
        <p className="text-sm text-amber-700 dark:text-amber-300">
          꼭 고칠 것이 {errorCount}건 남아 있어요. 지금 받아도 되지만, 고친 뒤 다시 받는 게 좋아요.
        </p>
      )}

      <div className="space-y-3 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
        <p className="font-medium">결산내역서</p>
        <div role="radiogroup" aria-label="결산내역서 형식" className="grid grid-cols-2 gap-2">
          {(
            [
              ["hwpx", "한글 (양식 채우기)"],
              ["xlsx", "엑셀"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={format === value}
              onClick={() => setFormat(value)}
              className={`h-10 rounded-xl border text-sm ${
                format === value
                  ? "border-blue-600 bg-blue-50 font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                  : "border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {format === "hwpx" ? (
          <>
            <label
              className={`flex h-12 cursor-pointer items-center justify-center rounded-full btn-glow bg-blue-600 font-medium text-white hover:bg-blue-700 ${
                isPending || empty ? "pointer-events-none opacity-60" : ""
              }`}
            >
              양식 파일(.hwpx) 골라서 채우기
              <input
                type="file"
                accept=".hwpx,application/hwp+zip"
                className="sr-only"
                disabled={isPending || empty}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) hwpx(file);
                  e.target.value = "";
                }}
              />
            </label>
            <p className="text-xs text-zinc-500">
              학교 결산내역서 양식에 기간, 학부/과, 예산내역(수입), 결산내역(지출), 결산 총계를 채워요. 결재란·제목·표
              모양은 그대로 둬요. 양식이 .hwp면 한글에서 &lsquo;다른 이름으로 저장 → 한글 표준 문서(*.hwpx)&rsquo;로 저장해
              주세요.
            </p>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={excel}
              disabled={isPending || empty}
              className="h-12 w-full rounded-lg bg-green-300 font-medium text-green-950 hover:bg-green-400 disabled:opacity-60"
            >
              결산내역서 엑셀 받기
            </button>
            <p className="text-xs text-zinc-500">
              첫 시트 &lsquo;결산내역서&rsquo;는 양식과 같은 순서로 새로 만든 표예요. 지출 내역·수입 내역·행사별 합계·점검
              결과 시트도 함께 들어 있어요.
            </p>
          </>
        )}
      </div>

      <button
        type="button"
        onClick={pdf}
        disabled={isPending || noExpenses}
        className="h-12 w-full rounded-lg btn-brutal bg-white dark:bg-zinc-900 font-medium disabled:opacity-60"
      >
        증빙 PDF 받기
      </button>

      {progress && <p className="text-center text-sm text-zinc-500">{progress}</p>}
      <p className="text-xs text-zinc-500">
        파일은 이 기기에서 만들어지고, 양식 파일은 서버에 올리지 않아요. 증빙 PDF는 영수증 사진을 내려받아 묶기 때문에
        건수가 많으면 시간이 걸려요. 화면을 닫지 말고 기다려 주세요.
      </p>
    </div>
  );
}
