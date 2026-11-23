// 결제 문자 해석기 테스트. 실행: npm run test:unit
// 실제 문자 예시를 받으면 여기에 케이스를 더한다. (카드번호·이름은 가린 채로)
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { dedupeSource, maskSms, parsePaymentSms } from "../../src/lib/payment-sms.ts";

const NOW = new Date("2026-11-23T15:00:00+09:00");

function expectParsed(raw, expected) {
  const r = parsePaymentSms(raw, NOW);
  assert.deepEqual(
    { kind: r.kind, amount: r.amount, merchant: r.merchant, approvedAt: r.approvedAt, error: r.error },
    { error: null, ...expected },
  );
}

describe("카드사별 승인 문자", () => {
  test("한 줄 형식 (신한 계열)", () => {
    expectParsed("[Web발신]\n신한카드(1234)승인 홍*동 12,500원(일시불)11/23 14:05 스타벅스 누적1,234,567원", {
      kind: "approval",
      amount: 12500,
      merchant: "스타벅스",
      approvedAt: "2026-11-23T14:05:00+09:00",
    });
  });

  test("여러 줄 형식 (KB 계열)", () => {
    expectParsed("[Web발신]\nKB국민카드1*2*승인\n홍*동님\n12,500원 일시불\n11/23 14:05\n○○마트 천안점\n누적1,234,567원", {
      kind: "approval",
      amount: 12500,
      merchant: "○○마트 천안점",
      approvedAt: "2026-11-23T14:05:00+09:00",
    });
  });

  test("날짜와 가맹점이 한 줄 (삼성 계열)", () => {
    expectParsed("[Web발신]\n삼성1234승인 홍*동\n52,000원 일시불\n11/22 19:30 △△식당\n누적152,000원", {
      kind: "approval",
      amount: 52000,
      merchant: "△△식당",
      approvedAt: "2026-11-22T19:30:00+09:00",
    });
  });

  test("체크카드, 총누적 (NH 계열)", () => {
    expectParsed("[Web발신]\nNH카드3*0*승인\n홍*동\n8,900원 체크\n11/21 12:01\nGS25 천안대점\n총누적98,900원", {
      kind: "approval",
      amount: 8900,
      merchant: "GS25 천안대점",
      approvedAt: "2026-11-21T12:01:00+09:00",
    });
  });

  test("할부", () => {
    expectParsed("현대카드 승인\n홍*동\n360,000원 3개월\n11/20 10:00\n하이마트", {
      kind: "approval",
      amount: 360000,
      merchant: "하이마트",
      approvedAt: "2026-11-20T10:00:00+09:00",
    });
  });

  test("가맹점이 날짜보다 먼저 나오는 형식", () => {
    expectParsed("우리카드 승인\n홍*동\n15,000원 일시불\n다이소\n11/23 09:10", {
      kind: "approval",
      amount: 15000,
      merchant: "다이소",
      approvedAt: "2026-11-23T09:10:00+09:00",
    });
  });

  test("누적 금액이 결제 금액보다 먼저 나와도 결제 금액을 고른다", () => {
    const r = parsePaymentSms("카드 승인 누적 1,000,000원\n3,000원 일시불\n11/23 10:00 편의점", NOW);
    assert.equal(r.amount, 3000);
  });
});

describe("은행 입출금 알림", () => {
  test("입금, 한 줄에 계좌번호와 입금자 (농협 계열)", () => {
    expectParsed("[Web발신]\n농협 입금50,000원\n12/02 10:00 352-****-1234 김학생 잔액1,234,567원", {
      kind: "deposit",
      amount: 50000,
      merchant: "김학생",
      approvedAt: "2025-12-02T10:00:00+09:00",
    });
  });

  test("입금, 금액에 '원'이 없는 여러 줄 (KB 계열)", () => {
    expectParsed("[KB]11/23 14:05\n801302**123\n김학생\n전자금융입금\n50,000\n잔액1,050,000", {
      kind: "deposit",
      amount: 50000,
      merchant: "김학생",
      approvedAt: "2026-11-23T14:05:00+09:00",
    });
  });

  test("입금, 입금자가 맨 끝 (신한 계열)", () => {
    expectParsed("[Web발신]\n신한 11/22 10:00\n110-***-123456\n입금 300,000\n잔액 1,234,567\n학생회비", {
      kind: "deposit",
      amount: 300000,
      merchant: "학생회비",
      approvedAt: "2026-11-22T10:00:00+09:00",
    });
  });

  test("출금은 지출로", () => {
    expectParsed("[Web발신]\n농협 출금12,500원\n11/23 12:00 352-****-1234 스타벅스 잔액987,500원", {
      kind: "approval",
      amount: 12500,
      merchant: "스타벅스",
      approvedAt: "2026-11-23T12:00:00+09:00",
    });
  });
});

describe("취소 문자", () => {
  test("승인취소", () => {
    expectParsed("[Web발신]\n신한카드(1234)승인취소 홍*동 12,500원 11/23 14:30 스타벅스", {
      kind: "cancel",
      amount: 12500,
      merchant: "스타벅스",
      approvedAt: "2026-11-23T14:30:00+09:00",
    });
  });
});

describe("연도 추정", () => {
  test("1월에 받은 12월 말 문자는 작년", () => {
    const r = parsePaymentSms("카드 승인 1,000원 12/31 23:50 편의점", new Date("2027-01-01T00:10:00+09:00"));
    assert.equal(r.approvedAt, "2026-12-31T23:50:00+09:00");
  });

  test("없는 날짜는 시각을 못 찾은 것으로", () => {
    const r = parsePaymentSms("카드 승인 1,000원 02/30 10:00 편의점", NOW);
    assert.equal(r.approvedAt, null);
    assert.match(r.error, /시각/);
  });
});

describe("해석 실패", () => {
  test("빈 문자", () => {
    assert.match(parsePaymentSms("  \n ", NOW).error, /비어/);
  });

  test("결제 문자가 아님", () => {
    const r = parsePaymentSms("[Web발신]\n인증번호 [123456]을 입력해 주세요.", NOW);
    assert.equal(r.kind, "unknown");
    assert.notEqual(r.error, null);
  });

  test("금액 없음", () => {
    assert.match(parsePaymentSms("카드 승인 11/23 10:00 편의점", NOW).error, /금액/);
  });
});

describe("가리기·중복 판단", () => {
  test("카드번호를 가린다", () => {
    assert.equal(maskSms("신한카드(1234)승인"), "신한카드(****)승인");
    assert.equal(maskSms("삼성1234승인"), "삼성****승인");
    assert.equal(maskSms("1234-5678-9012-3456"), "****-****-****-****");
    assert.equal(maskSms("12,500원"), "12,500원");
  });

  test("공백·줄바꿈만 다른 문자는 같은 문자", () => {
    assert.equal(dedupeSource("[Web발신]\r\n카드 승인  1,000원"), dedupeSource("카드 승인 1,000원"));
  });
});
