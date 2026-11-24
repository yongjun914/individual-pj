// 행사 관리 계산과 명단 붙여 넣기 테스트. 실행: npm run test:unit
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { eventStatus, jacketSummary, normalizeGrade, normalizeStudentNo, paidTotal } from "../../src/lib/events.ts";
import { parseRoster } from "../../src/lib/roster-import.ts";

describe("학번 정리 (앞 2자리)", () => {
  test("여러 형식", () => {
    assert.equal(normalizeStudentNo("24"), "24");
    assert.equal(normalizeStudentNo("24학번"), "24");
    assert.equal(normalizeStudentNo("2024"), "24");
    assert.equal(normalizeStudentNo("2024123456"), "24");
    assert.equal(normalizeStudentNo(23), "23");
    assert.equal(normalizeStudentNo(" 22 "), "22");
  });
  test("알아볼 수 없으면 null", () => {
    assert.equal(normalizeStudentNo(""), null);
    assert.equal(normalizeStudentNo("2"), null);
    assert.equal(normalizeStudentNo("abc"), null);
    assert.equal(normalizeStudentNo("24a"), null);
    assert.equal(normalizeStudentNo("123"), null);
  });
  test("학년", () => {
    assert.equal(normalizeGrade("3"), 3);
    assert.equal(normalizeGrade("3학년"), 3);
    assert.equal(normalizeGrade(""), null);
    assert.equal(normalizeGrade("9"), null);
  });
});

describe("행사 진행 상태", () => {
  test("예정·진행 중·끝남·미정", () => {
    assert.equal(eventStatus(null, null, "2026-03-01"), "undated");
    assert.equal(eventStatus("2026-03-05", null, "2026-03-01"), "upcoming");
    assert.equal(eventStatus("2026-03-05", null, "2026-03-05"), "ongoing");
    assert.equal(eventStatus("2026-03-05", "2026-03-06", "2026-03-06"), "ongoing");
    assert.equal(eventStatus("2026-03-05", "2026-03-06", "2026-03-07"), "done");
  });
});

describe("과잠 집계와 참가비", () => {
  const rows = [
    { fields: { 사이즈: "m", 수량: "1" }, paid: true },
    { fields: { 사이즈: "L", 수량: "2벌" }, paid: true },
    { fields: { 사이즈: "M" }, paid: false },
    { fields: { 사이즈: "" }, paid: false },
  ];
  test("사이즈별 수량, 사이즈 순서, 미정", () => {
    assert.deepEqual(jacketSummary(rows), {
      sizes: [
        { size: "M", count: 2 },
        { size: "L", count: 2 },
        { size: "미정", count: 1 },
      ],
      total: 5,
    });
  });
  test("과잠은 납부한 수량 × 가격", () => {
    assert.deepEqual(paidTotal("jacket", 40000, rows), { count: 2, amount: 120000 });
  });
  test("그 외는 납부 인원 × 참가비", () => {
    assert.deepEqual(paidTotal("opening", 15000, rows), { count: 2, amount: 30000 });
  });
});

describe("명단 붙여 넣기", () => {
  test("구글폼 응답 시트 (머리글 + 탭, 타임스탬프 무시)", () => {
    const text = [
      "타임스탬프\t이름을 적어 주세요\t학번 (예: 24)\t학년\t사이즈",
      "2026. 3. 1 오후 3:00:00\t홍길동\t2024123456\t1학년\tM",
      "2026. 3. 1 오후 3:01:00\t김학생\t23학번\t\tL",
    ].join("\n");
    const { rows, errors } = parseRoster(text, ["사이즈", "이니셜", "수량"]);
    assert.equal(errors.length, 0);
    assert.deepEqual(rows.map((r) => [r.name, r.student_no, r.grade, r.fields]), [
      ["홍길동", "24", 1, { 사이즈: "M" }],
      ["김학생", "23", null, { 사이즈: "L" }],
    ]);
  });

  test("머리글 없이 '이름, 학번, 학년' 순서", () => {
    const { rows, errors } = parseRoster("홍길동\t24\t1\n이학생\t22", []);
    assert.equal(errors.length, 0);
    assert.deepEqual(rows.map((r) => [r.name, r.student_no, r.grade]), [
      ["홍길동", "24", 1],
      ["이학생", "22", null],
    ]);
  });

  test("쉼표로 나뉜 글도 읽음 (CSV)", () => {
    const { rows } = parseRoster("이름,학번\n박학생,25", []);
    assert.deepEqual(rows.map((r) => [r.name, r.student_no]), [["박학생", "25"]]);
  });

  test("잘못된 줄은 이유와 함께 따로 모은다", () => {
    const { rows, errors } = parseRoster("이름\t학번\n\t24\n최학생\t2\n정학생\t21", []);
    assert.deepEqual(rows.map((r) => r.name), ["정학생"]);
    assert.deepEqual(errors.map((e) => [e.line, e.reason.slice(0, 6)]), [
      [2, "이름이 없어"],
      [3, "학번을 알아"],
    ]);
  });

  test("비상 연락처는 '연락처'·'전화번호' 머리글도 알아봄", () => {
    const { rows } = parseRoster("성명\t학번\t전화번호\n홍길동\t24\t010-0000-0000", ["참가 일정", "비상 연락처"]);
    assert.deepEqual(rows[0].fields, { "비상 연락처": "010-0000-0000" });
  });
});
