-- 역할 추가: 부학회장, 임원(부장·차장)
-- 새 enum 값은 같은 트랜잭션에서 쓸 수 없어서, 이 값을 쓰는 권한 규칙은 다음 마이그레이션에 둔다.
--   president      학회장
--   vice_president 부학회장
--   treasurer      총무 (기존 값, 학회장·부학회장과 같은 관리자로 취급)
--   officer        임원 (부장·차장)
--   member         부원

alter type public.member_role add value if not exists 'vice_president';
alter type public.member_role add value if not exists 'officer';
