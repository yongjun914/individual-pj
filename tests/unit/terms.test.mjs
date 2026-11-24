// 학생회 연도 표시 테스트. 실행: npm run test:unit
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { termLabel, termOrgLabel } from "../../src/lib/terms.ts";

describe("termLabel", () => {
  test("숫자 네 자리는 '년'을 붙인다", () => {
    assert.equal(termLabel("2026"), "2026년");
    assert.equal(termLabel(" 2027 "), "2027년");
  });
  test("그 밖의 이름은 그대로", () => {
    assert.equal(termLabel("2026년 제38대"), "2026년 제38대");
    assert.equal(termLabel("1"), "1");
  });
});

describe("termOrgLabel", () => {
  test("연도 + 학생회 이름", () => {
    assert.equal(termOrgLabel("2026", "전자공학과 학생회"), "2026년 전자공학과 학생회");
  });
});
