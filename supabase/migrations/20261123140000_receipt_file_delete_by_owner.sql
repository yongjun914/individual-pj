-- 영수증 파일 삭제 권한 확장
-- 기존: 활성 기수의 총무·회장만 삭제
-- 변경: 집행부원도 '본인이 등록한 지출'의 영수증 파일은 삭제할 수 있다.
--       (receipts 테이블 삭제 정책과 맞춘다. 경로 규칙: {학생회}/{기수}/{지출}/{파일})

drop policy if exists "receipts_bucket_delete" on storage.objects;

create policy "receipts_bucket_delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'receipts'
    and public.term_org_id(public.try_uuid((storage.foldername(name))[2])) = public.try_uuid((storage.foldername(name))[1])
    and (
      public.has_active_term_role(
        public.try_uuid((storage.foldername(name))[2]),
        array['president', 'treasurer']::public.member_role[]
      )
      or (
        public.has_active_term_role(
          public.try_uuid((storage.foldername(name))[2]),
          array['member']::public.member_role[]
        )
        and exists (
          select 1 from public.expenses e
          where e.id = public.try_uuid((storage.foldername(name))[3])
            and e.term_id = public.try_uuid((storage.foldername(name))[2])
            and e.created_by = (select auth.uid())
        )
      )
    )
  );
