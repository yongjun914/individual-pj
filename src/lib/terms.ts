/**
 * 학생회 '연도' 표시.
 * DB의 terms(연도)는 이름을 자유롭게 쓸 수 있지만, 보통 "2026"처럼 연도 숫자만 넣는다.
 * 숫자 네 자리면 "2026년"으로 보여 준다.
 */
export function termLabel(name: string) {
  const trimmed = name.trim();
  return /^\d{4}$/.test(trimmed) ? `${trimmed}년` : trimmed;
}

/** "2026년 전자공학과 학생회" */
export function termOrgLabel(termName: string, orgName: string) {
  return `${termLabel(termName)} ${orgName}`;
}
