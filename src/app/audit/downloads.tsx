"use client";

import { useState, useTransition } from "react";

import type { AuditReport } from "@/lib/audit";
import { createClient } from "@/lib/supabase/client";

import { buildAuditWorkbook, buildEvidencePdf, downloadBytes, fileBaseName, type AuditMeta } from "./exporters";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** 엑셀·증빙 PDF 내려받기 버튼 */
export function AuditDownloads({ report, meta, errorCount }: { report: AuditReport; meta: AuditMeta; errorCount: number }) {
  const [isPending, startTransition] = useTransition();
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const empty = report.rows.length === 0;

  function excel() {
    setError(null);
    startTransition(async () => {
      try {
        setProgress("엑셀 만드는 중…");
        const bytes = await buildAuditWorkbook(report, meta);
        downloadBytes(bytes, `${fileBaseName(meta)}_지출내역.xlsx`, XLSX_TYPE);
      } catch (e) {
        console.error(e);
        setError("엑셀을 만들지 못했어요. 다시 시도해 주세요.");
      } finally {
        setProgress(null);
      }
    });
  }

  function pdf() {
    setError(null);
    startTransition(async () => {
      try {
        const supabase = createClient();
        setProgress("증빙 PDF 준비 중…");
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
      } catch (e) {
        console.error(e);
        setError("증빙 PDF를 만들지 못했어요. 영수증이 많으면 기간을 나눠서 받아 주세요.");
      } finally {
        setProgress(null);
      }
    });
  }

  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
      {errorCount > 0 && (
        <p className="text-sm text-amber-700 dark:text-amber-300">
          꼭 고칠 것이 {errorCount}건 남아 있어요. 지금 받아도 되지만, 고친 뒤 다시 받는 게 좋아요.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={excel}
          disabled={isPending || empty}
          className="h-12 rounded-xl bg-green-700 font-medium text-white hover:bg-green-800 disabled:opacity-60"
        >
          지출 내역 엑셀
        </button>
        <button
          type="button"
          onClick={pdf}
          disabled={isPending || empty}
          className="h-12 rounded-xl bg-blue-600 font-medium text-white hover:bg-blue-700 disabled:opacity-60"
        >
          증빙 PDF
        </button>
      </div>
      {progress && <p className="text-center text-sm text-zinc-500">{progress}</p>}
      <p className="text-xs text-zinc-500">
        파일은 이 기기에서 만들어져요. 증빙 PDF는 영수증 사진을 내려받아 묶기 때문에 건수가 많으면 시간이 걸려요.
        화면을 닫지 말고 기다려 주세요.
      </p>
    </div>
  );
}
