// 한글(HWPX) 결산내역서 채우기 테스트. 실행: npm run test:unit
// 저장소에는 학교 양식을 넣지 않으므로 같은 구조의 작은 양식을 만들어 쓴다.
// docs/samples에 실제 양식(.hwpx)이 있으면 그것으로도 한 번 더 확인한다.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { unzipSync, zipSync } from "fflate";

import { fillSettlementHwpx, fillSettlementXml, HwpxError } from "../../src/lib/hwpx-settlement.ts";

const tools = { DOMParser, XMLSerializer };
const NS = 'xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section"';

const p = (text, charPr = 24) =>
  `<hp:p id="0" paraPrIDRef="11"><hp:run charPrIDRef="${charPr}">${text ? `<hp:t>${text}</hp:t>` : ""}</hp:run><hp:linesegarray><hp:lineseg textpos="0"/></hp:linesegarray></hp:p>`;
const tc = (row, col, texts, colSpan = 1, rowSpan = 1) =>
  `<hp:tc><hp:subList>${(Array.isArray(texts) ? texts : [texts]).map((t) => p(t)).join("")}</hp:subList><hp:cellAddr colAddr="${col}" rowAddr="${row}"/><hp:cellSpan colSpan="${colSpan}" rowSpan="${rowSpan}"/><hp:cellSz width="1000" height="3000"/></hp:tc>`;
const tr = (...cells) => `<hp:tr>${cells.join("")}</hp:tr>`;

/** 결산내역서와 같은 구조: 제목 문단 + 예산 표 + 결산 표(빈 줄 2개) */
function sampleSection() {
  const budget = `<hp:tbl rowCnt="3" colCnt="4"><hp:sz width="1" height="9000"/>${[
    tr(tc(0, 0, "학부/과 : 전자공학과"), tc(0, 1, "", 2), tc(0, 3, "(단위 : 원)")),
    tr(tc(1, 0, "26-1 예산액"), tc(1, 1, ["26-1 이월액", "이자"]), tc(1, 2, ["12,270,465", "549"], 2)),
    tr(tc(2, 0, "예산 총계"), tc(2, 1, "13,821,077", 3)),
  ].join("")}</hp:tbl>`;
  const settle = `<hp:tbl rowCnt="7" colCnt="7"><hp:sz width="1" height="21000"/>${[
    tr(tc(0, 0, "학부/과 : 전자공학과"), tc(0, 1, "", 5), tc(0, 6, "(단위 : 원)")),
    tr(tc(1, 0, "행사명"), tc(1, 1, "집행액"), tc(1, 2, "산출내역", 5)),
    tr(tc(2, 0, "상명대 복사"), tc(2, 1, "2,450"), tc(2, 2, "상명대 복사", 2), tc(2, 4, "2,450", 3)),
    tr(tc(3, 0, ""), tc(3, 1, ""), tc(3, 2, "", 2), tc(3, 4, "", 3)),
    tr(tc(4, 0, "총 집행액"), tc(4, 1, "12,270,465", 6)),
    tr(tc(5, 0, "결산 총계", 1, 2), tc(5, 1, "26-1 예산액", 2), tc(5, 3, "총 집행액", 2), tc(5, 5, "잔액", 2)),
    tr(tc(6, 1, "13,821,077", 2), tc(6, 3, "12,270,465", 2), tc(6, 5, "9,746,957", 2)),
  ].join("")}</hp:tbl>`;
  return `<?xml version="1.0" encoding="UTF-8"?><hs:sec ${NS}>${p("(감사 대상 기간 : 26.05.11 ~ 26.11.??)")}${p("학부/과 : 전자공학과")}${budget}${settle}</hs:sec>`;
}

const data = {
  from: "26.05.11",
  to: "26.11.30",
  dept: "컴퓨터공학과",
  incomeLines: [
    { label: "이월액", amount: 100000 },
    { label: "학회비", amount: 50000 },
    { label: "이자", amount: 549 },
  ],
  incomeTotal: 150549,
  expenseLines: [
    { category: "종강총회", amount: 30000, description: "삼구포차 (증빙 1)" },
    { category: "", amount: 20000, description: "정종환 (증빙 2)" },
    { category: "회식", amount: 10000, description: "쿠우쿠우 (증빙 3)" },
  ],
  expenseTotal: 60000,
  balance: 90549,
};

/** 결과 XML에서 표별 칸 글자 읽기: [표][줄][칸] */
function readTables(xml) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return Array.from(doc.getElementsByTagName("hp:tbl")).map((tbl) =>
    Array.from(tbl.getElementsByTagName("hp:tr")).map((row) =>
      Array.from(row.getElementsByTagName("hp:tc")).map((cell) =>
        Array.from(cell.getElementsByTagName("hp:p"))
          .map((para) => Array.from(para.getElementsByTagName("hp:t")).map((t) => t.textContent).join(""))
          .join("|"),
      ),
    ),
  );
}

describe("결산내역서 XML 채우기", () => {
  const { xml, found } = fillSettlementXml(sampleSection(), data, tools);
  const [budget, settle] = readTables(xml);

  test("모든 칸을 찾았다", () => {
    assert.deepEqual(found, { period: true, income: true, expense: true, summary: true });
  });

  test("감사 대상 기간과 학부/과", () => {
    assert.match(xml, /\(감사 대상 기간 : 26\.05\.11 ~ 26\.11\.30\)/);
    assert.match(xml, /학부\/과 : 컴퓨터공학과/);
    assert.doesNotMatch(xml, /전자공학과/);
  });

  test("예산내역: 항목·금액은 줄마다, 예산 총계", () => {
    assert.deepEqual(budget[1], ["26-1 예산액", "이월액|학회비|이자", "100,000|50,000|549"]);
    assert.deepEqual(budget[2], ["예산 총계", "150,549"]);
  });

  test("결산내역: 줄이 모자라면 늘리고, 행사명은 첫 줄에만", () => {
    assert.deepEqual(settle[2], ["종강총회", "30,000", "삼구포차 (증빙 1)", "30,000"]);
    assert.deepEqual(settle[3], ["", "20,000", "정종환 (증빙 2)", "20,000"]);
    assert.deepEqual(settle[4], ["회식", "10,000", "쿠우쿠우 (증빙 3)", "10,000"]);
    assert.deepEqual(settle[5], ["총 집행액", "60,000"]);
  });

  test("결산 총계: 예산액 - 총 집행액 = 잔액", () => {
    assert.deepEqual(settle[7], ["150,549", "60,000", "90,549"]);
  });

  test("늘린 뒤 줄 번호·줄 수·표 높이를 다시 맞춘다", () => {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const tbl = doc.getElementsByTagName("hp:tbl")[1];
    assert.equal(tbl.getAttribute("rowCnt"), "8");
    assert.equal(tbl.getElementsByTagName("hp:sz")[0].getAttribute("height"), "24000");
    const rowAddrs = Array.from(tbl.getElementsByTagName("hp:tr")).map((row) =>
      row.getElementsByTagName("hp:cellAddr")[0].getAttribute("rowAddr"),
    );
    assert.deepEqual(rowAddrs, ["0", "1", "2", "3", "4", "5", "6", "7"]);
  });

  test("바꾼 문단의 줄 배치 정보는 지운다 (한글이 다시 계산)", () => {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const cell = doc.getElementsByTagName("hp:tbl")[1].getElementsByTagName("hp:tr")[2].getElementsByTagName("hp:tc")[0];
    assert.equal(cell.getElementsByTagName("hp:linesegarray").length, 0);
  });

  test("지출이 빈 줄보다 적으면 남는 줄은 비운다", () => {
    const one = fillSettlementXml(sampleSection(), { ...data, expenseLines: [data.expenseLines[2]] }, tools);
    const [, s] = readTables(one.xml);
    assert.deepEqual(s[2], ["회식", "10,000", "쿠우쿠우 (증빙 3)", "10,000"]);
    assert.deepEqual(s[3], ["", "", "", ""]);
  });
});

describe("HWPX 파일", () => {
  const enc = new TextEncoder();
  const zip = () =>
    zipSync({
      mimetype: [enc.encode("application/hwp+zip"), { level: 0 }],
      "Contents/section0.xml": enc.encode(sampleSection()),
      "Contents/header.xml": enc.encode("<head/>"),
    });

  test("mimetype을 맨 앞에 두고 다시 묶는다", () => {
    const { bytes, warnings } = fillSettlementHwpx(zip(), data, tools);
    assert.deepEqual(warnings, []);
    const files = unzipSync(bytes);
    assert.equal(Object.keys(files)[0], "mimetype");
    assert.match(new TextDecoder().decode(files["Contents/section0.xml"]), /쿠우쿠우/);
    assert.equal(new TextDecoder().decode(files["Contents/header.xml"]), "<head/>");
  });

  test("예전 HWP 파일은 안내와 함께 거부", () => {
    const hwp = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]);
    assert.throws(() => fillSettlementHwpx(hwp, data, tools), (e) => e instanceof HwpxError && /hwpx/.test(e.message));
  });

  test("양식 칸이 없으면 경고", () => {
    const plain = zipSync({
      mimetype: [enc.encode("application/hwp+zip"), { level: 0 }],
      "Contents/section0.xml": enc.encode(`<hs:sec ${NS}>${p("빈 문서")}</hs:sec>`),
    });
    const { warnings } = fillSettlementHwpx(plain, data, tools);
    assert.equal(warnings.length, 4);
  });
});

// 실제 양식이 로컬에 있으면 (docs/는 git에 올라가지 않는다)
const samplesDir = join(import.meta.dirname, "..", "..", "docs", "samples");
const realForm = existsSync(samplesDir) ? readdirSync(samplesDir).find((f) => f.endsWith(".hwpx")) : null;
describe("실제 결산내역서 양식", { skip: !realForm && "docs/samples에 .hwpx 양식이 없어 건너뜀" }, () => {
  test("모든 칸을 찾아 채운다", () => {
    const { bytes, warnings } = fillSettlementHwpx(new Uint8Array(readFileSync(join(samplesDir, realForm))), data, tools);
    assert.deepEqual(warnings, []);
    const xml = new TextDecoder().decode(unzipSync(bytes)["Contents/section0.xml"]);
    assert.match(xml, /26\.05\.11 ~ 26\.11\.30/);
    assert.match(xml, /쿠우쿠우 \(증빙 3\)/);
    assert.match(xml, /90,549/);
  });
});
