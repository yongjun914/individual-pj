-- 행사 명단에서 납부·참석 칸 숨기기
--
-- 과잠 신청처럼 참석이 필요 없는 행사에서 기본 칸을 숨긴다.
-- 체크해 둔 값(paid, attended)은 지우지 않고 그대로 두며, 다시 보이게 하면 돌아온다.
-- 수정 권한은 기존 events 수정 정책(행사 관리 권한)을 따른다.

alter table public.events
  add column hidden_checks text[] not null default '{}'
    check (hidden_checks <@ array['paid', 'attended']::text[]);
