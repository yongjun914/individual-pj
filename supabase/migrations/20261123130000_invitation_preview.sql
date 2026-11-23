-- 초대 링크 미리보기: 아직 멤버가 아닌 사람도 토큰으로 어느 학생회의 초대인지 확인한다.
-- 토큰이 유효(폐기·만료 안 됨, 기수 활성)할 때만 한 행을 돌려준다.

create or replace function public.get_invitation_preview(p_token text)
returns table (
  organization_name text,
  school_name       text,
  term_name         text,
  role              public.member_role,
  already_member    boolean
)
language sql stable security definer set search_path = ''
as $$
  select
    o.name,
    o.school_name,
    t.name,
    i.role,
    exists (
      select 1 from public.memberships m
      where m.term_id = t.id and m.user_id = (select auth.uid())
    )
  from public.invitations i
  join public.terms t on t.id = i.term_id
  join public.organizations o on o.id = t.organization_id
  where i.token = p_token
    and i.revoked_at is null
    and i.expires_at > now()
    and t.is_active;
$$;

revoke execute on function public.get_invitation_preview(text) from public, anon;
grant  execute on function public.get_invitation_preview(text) to authenticated;
