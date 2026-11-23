// 감사 자료 계산 테스트. 실행: npm run test:unit
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { buildAuditReport, evidenceLabel } from "../../src/lib/audit.ts";

let seq = 0;
function exp(over) {
  seq += 1;
  return {
    id: `e${seq}`,
    spent_on: "2026-11-20",
    created_at: `2026-11-20T10:00:0${seq % 10}Z`,
    merchant: "가게",
    amount: 1000,
    items: "",
    payment_method: "card",
    status: "complete",
    memo: "",
    missing_reason: null,
    category: "회식",
    receipts: [{ id: `r${seq}`, storage_path: `p/${seq}.jpg`, created_at: "2026-11-20T10:00:00Z" }],
    ...over,
  };
}

describe("번호와 합계", () => {
  const report = buildAuditReport([
    exp({ id: "late", spent_on: "2026-11-22", amount: 3000 }),
    exp({ id: "early", spent_on: "2026-11-01", amount: 2000 }),
    exp({ id: "cancel", spent_on: "2026-11-10", status: "cancelled", amount: 9999 }),
    exp({ id: "mid", spent_on: "2026-11-15", amount: 5000, category: null }),
  ]);

  test("날짜 순으로 1번부터, 취소는 빼고", () => {
    assert.deepEqual(report.rows.map((r) => [r.id, r.no]), [["early", 1], ["mid", 2], ["late", 3]]);
  });

  test("합계는 취소 제외", () => {
    assert.equal(report.total, 10000);
    assert.equal(report.counts.cancelled, 1);
  });

  test("행사별 합계, 미분류는 맨 뒤", () => {
    assert.deepEqual(report.categories, [
      { category: "회식", count: 2, total: 5000 },
      { category: "미분류", count: 1, total: 5000 },
    ]);
  });
});

describe("증빙 종류", () => {
  const report = buildAuditReport([
    exp({ id: "a" }),
    exp({ id: "b", status: "excused", missing_reason: "분실", receipts: [] }),
    exp({ id: "c", status: "needs_receipt", receipts: [] }),
  ]);

  test("영수증·사유서·없음", () => {
    assert.deepEqual(report.rows.map((r) => r.evidence), ["receipt", "excused", "missing"]);
    assert.deepEqual(report.rows.map(evidenceLabel), ["영수증 1장", "분실 사유서", "없음"]);
    assert.deepEqual(report.counts, { receipt: 1, excused: 1, missing: 1, cancelled: 0 });
  });
});

describe("출력 전 점검", () => {
  const report = buildAuditReport([
    exp({ id: "ok", amount: 1100 }),
    exp({ id: "noreceipt", status: "needs_receipt", receipts: [], amount: 1200 }),
    exp({ id: "zero", amount: 0 }),
    exp({ id: "nocat", category: null, amount: 1300 }),
    exp({ id: "nomerchant", merchant: "(내용 없음)", amount: 1400 }),
    exp({ id: "dup1", spent_on: "2026-11-25", amount: 7700 }),
    exp({ id: "dup2", spent_on: "2026-11-25", amount: 7700 }),
  ]);
  const byKey = Object.fromEntries(report.checks.map((c) => [c.key, c.items.map((i) => i.id)]));

  test("문제별로 해당 지출을 모은다", () => {
    assert.deepEqual(byKey.missing, ["noreceipt"]);
    assert.deepEqual(byKey.zero, ["zero"]);
    assert.deepEqual(byKey.uncategorized, ["nocat"]);
    assert.deepEqual(byKey["no-merchant"], ["nomerchant"]);
    assert.deepEqual(byKey.duplicate, ["dup1", "dup2"]);
  });

  test("해당 없는 점검은 빠진다", () => {
    assert.equal(byKey.excused, undefined);
    assert.equal(byKey.cancelled, undefined);
  });

  test("심각한 것부터", () => {
    assert.deepEqual(report.checks.map((c) => c.level), ["error", "error", "warning", "warning", "warning"]);
  });

  test("빈 기간", () => {
    const empty = buildAuditReport([]);
    assert.equal(empty.rows.length, 0);
    assert.equal(empty.checks.length, 0);
    assert.equal(empty.total, 0);
  });
});
