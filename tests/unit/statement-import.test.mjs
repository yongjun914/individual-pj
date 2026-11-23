// 거래내역 파일 해석기 테스트. 실행: npm run test:unit
// 실제 은행·카드사 파일을 받으면 그 머리글과 줄 형식을 케이스로 더한다.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { parseAmountCell, parseDateCell, parseStatement, parseWorkbookSheets } from "../../src/lib/statement-import.ts";

const pick = (r) => ({ kind: r.kind, spentOn: r.spentOn, time: r.time, merchant: r.merchant, amount: r.amount, method: r.method });

describe("통장 거래내역 (출금·입금 칸)", () => {
  const rows = [
    ["거래내역 조회"],
    ["계좌번호", "123-****-5678"],
    ["조회기간", "2026.11.01 ~ 2026.11.30"],
    [],
    ["거래일시", "적요", "출금액(원)", "입금액(원)", "잔액(원)", "내용", "거래점"],
    ["2026.11.20 14:05:33", "체크카드", "12,500", "0", "987,500", "스타벅스 천안점", "본점"],
    ["2026.11.21 09:00:00", "타행이체", "50,000", "0", "937,500", "홍길동", "인터넷"],
    ["2026.11.22 18:00:00", "입금", "0", "300,000", "1,237,500", "학생회비", ""],
    ["2026.11.23 10:10:00", "체크카드취소", "0", "12,500", "1,250,000", "스타벅스 천안점", ""],
    ["2026.11.23 11:00:00", "ATM출금", "20,000", "", "1,230,000", "", ""],
    ["", "합계", "82,500", "312,500", "", "", ""],
  ];

  const result = parseStatement(rows);

  test("머리글과 형식을 찾는다", () => {
    assert.equal(result.ok, true);
    assert.equal(result.format, "bank");
    assert.equal(result.headerLine, 5);
    assert.equal(result.columns.merchant, "내용");
    assert.equal(result.columns.type, "적요");
  });

  test("출금은 지출, 결제 수단을 적요로 판단", () => {
    assert.deepEqual(pick(result.rows[0]), {
      kind: "expense", spentOn: "2026-11-20", time: "14:05", merchant: "스타벅스 천안점", amount: 12500, method: "card",
    });
    assert.deepEqual(pick(result.rows[1]), {
      kind: "expense", spentOn: "2026-11-21", time: "09:00", merchant: "홍길동", amount: 50000, method: "transfer",
    });
  });

  test("입금은 가져오지 않음", () => {
    assert.equal(result.rows[2].kind, "deposit");
  });

  test("카드 취소는 취소로, 같은 파일의 원래 결제는 기본 제외", () => {
    assert.equal(result.rows[3].kind, "cancel");
    assert.equal(result.rows[0].cancelledInFile, true);
    assert.match(result.rows[0].note, /9번째 줄/);
    assert.equal(result.rows[1].cancelledInFile, false);
  });

  test("가맹점이 비면 적요로 채우고, ATM은 현금", () => {
    assert.deepEqual(pick(result.rows[4]), {
      kind: "expense", spentOn: "2026-11-23", time: "11:00", merchant: "ATM출금", amount: 20000, method: "cash",
    });
  });

  test("합계 줄은 건너뜀", () => {
    assert.equal(result.rows.length, 5);
  });
});

describe("카드 이용내역 (이용금액 칸)", () => {
  const rows = [
    ["이용일자", "이용시간", "카드구분", "가맹점명", "이용금액", "승인번호", "취소여부"],
    ["2026-11-20", "12:30", "본인", "GS25 천안대점", 8900, "12345678", ""],
    ["2026-11-21", "19:00", "본인", "△△식당", "152,000", "12345679", ""],
    ["2026-11-21", "19:05", "본인", "△△식당", "152,000", "12345679", "취소"],
    ["2026-11-22", "10:00", "본인", "다이소", "-3,000", "12345680", ""],
  ];
  const result = parseStatement(rows);

  test("카드 형식으로 판단", () => {
    assert.equal(result.ok, true);
    assert.equal(result.format, "card");
  });

  test("이용 시각은 따로 있는 시간 칸에서", () => {
    assert.deepEqual(pick(result.rows[0]), {
      kind: "expense", spentOn: "2026-11-20", time: "12:30", merchant: "GS25 천안대점", amount: 8900, method: "card",
    });
  });

  test("취소여부 칸과 음수 금액은 취소", () => {
    assert.equal(result.rows[2].kind, "cancel");
    assert.equal(result.rows[3].kind, "cancel");
    assert.equal(result.rows[3].amount, 3000);
    assert.equal(result.rows[1].cancelledInFile, true);
  });
});

describe("셀 값 읽기", () => {
  test("날짜 형식들", () => {
    assert.deepEqual(parseDateCell("2026-11-23"), { date: "2026-11-23", time: null });
    assert.deepEqual(parseDateCell("2026.11.23 09:05"), { date: "2026-11-23", time: "09:05" });
    assert.deepEqual(parseDateCell("2026/1/5"), { date: "2026-01-05", time: null });
    assert.deepEqual(parseDateCell("20261123"), { date: "2026-11-23", time: null });
    assert.deepEqual(parseDateCell("26.11.23"), { date: "2026-11-23", time: null });
    assert.deepEqual(parseDateCell("2026년 11월 23일"), { date: "2026-11-23", time: null });
    assert.deepEqual(parseDateCell(46349), { date: "2026-11-23", time: null }); // 엑셀 일련번호
    assert.equal(parseDateCell("2026-02-30"), null);
    assert.equal(parseDateCell("합계"), null);
  });

  test("금액 형식들", () => {
    assert.equal(parseAmountCell("12,500"), 12500);
    assert.equal(parseAmountCell("12,500원"), 12500);
    assert.equal(parseAmountCell("-3,000"), -3000);
    assert.equal(parseAmountCell(""), 0);
    assert.equal(parseAmountCell(8900), 8900);
    assert.equal(parseAmountCell("abc"), null);
  });
});

describe("해석 실패", () => {
  test("머리글이 없는 파일", () => {
    const r = parseStatement([["이름", "학번"], ["홍길동", "2026001"]]);
    assert.equal(r.ok, false);
  });

  test("날짜를 못 읽은 줄은 표시", () => {
    const r = parseStatement([["거래일자", "출금액", "내용"], ["어제", "1,000", "편의점"]]);
    assert.equal(r.rows[0].kind, "invalid");
  });

  test("여러 시트 중 해석되는 시트를 고른다", () => {
    const r = parseWorkbookSheets([
      { name: "안내", rows: [["이 파일은 …"]] },
      { name: "거래내역", rows: [["거래일자", "출금액", "내용"], ["2026-11-23", "1,000", "편의점"]] },
    ]);
    assert.equal(r.ok, true);
    assert.equal(r.sheetName, "거래내역");
  });
});
