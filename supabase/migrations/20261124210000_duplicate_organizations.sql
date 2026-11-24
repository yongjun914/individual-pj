-- 같은 이름의 학생회 막기 + 검색 결과에 구분 정보
--
-- 1. 학교·학생회 이름이 같은(띄어쓰기·대소문자 무시) 학생회가 이미 있으면 새로 만들지 않는다.
--    정말 다른 학생회라고 확인(p_allow_duplicate)했을 때만 만든다.
-- 2. 찾기 결과에 학회장 이름 일부(정○준), 만든 날짜, 멤버 수를 함께 보여 줘 같은 이름도 구분한다.


-- ---------------------------------------------------------------------
-- 1. 도우미
-- ---------------------------------------------------------------------

-- 비교용 이름: 공백 제거 + 소문자
create or replace function public.org_name_key(p text)
returns text
language sql immutable set search_path = ''
as $$
  select lower(regexp_replace(coalesce(p, ''), '\s', '', 'g'));
$$;

-- 이름 가운데를 가린다: 정용준 → 정○준, 홍길 → 홍○
create or replace function public.mask_name(p text)
returns text
language sql immutable set search_path = ''
as $$
  select case
    when p is null or btrim(p) = '' then ''
    when char_length(btrim(p)) = 1 then btrim(p)
    when char_length(btrim(p)) = 2 then left(btrim(p), 1) || '○'
    else left(btrim(p), 1) || repeat('○', char_length(btrim(p)) - 2) || right(btrim(p), 1)
  end;
$$;

-- 학생회 대표(학회장, 없으면 부학회장)의 가린 이름
create or replace function public.org_leader_masked(p_term_id uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select public.mask_name(p.display_name)
  from public.memberships m
  join public.profiles p on p.id = m.user_id
  where m.term_id = p_term_id and m.role in ('president', 'vice_president')
  order by case m.role when 'president' then 0 else 1 end, m.created_at
  limit 1;
$$;

revoke execute on function public.org_leader_masked(uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 2. 찾기: 구분 정보 추가 (반환 칸이 바뀌어 다시 만든다)
-- ---------------------------------------------------------------------

drop function if exists public.search_organizations(text);

create function public.search_organizations(p_query text)
returns table (
  organization_id uuid,
  school_name     text,
  name            text,
  term_name       text,
  requested       boolean,
  leader          text,
  created_on      date,
  member_count    integer
)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_query   text := btrim(coalesce(p_query, ''));
  v_pattern text;
begin
  if v_user_id is null or char_length(v_query) < 2 or char_length(v_query) > 50 then
    return;
  end if;
  v_pattern := '%' || replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
  select o.id, o.school_name, o.name, t.name,
         exists (
           select 1 from public.join_requests r
           where r.term_id = t.id and r.user_id = v_user_id and r.status = 'pending'
         ),
         coalesce(public.org_leader_masked(t.id), ''),
         (o.created_at at time zone 'Asia/Seoul')::date,
         (select count(*)::int from public.memberships m2 where m2.term_id = t.id)
  from public.organizations o
  join public.terms t on t.organization_id = o.id and t.is_active
  where (o.school_name || ' ' || o.name) ilike v_pattern
    and not exists (
      select 1 from public.memberships m where m.term_id = t.id and m.user_id = v_user_id
    )
  order by o.school_name, o.name, o.created_at
  limit 20;
end;
$$;

revoke execute on function public.search_organizations(text) from public, anon;
grant execute on function public.search_organizations(text) to authenticated;


-- ---------------------------------------------------------------------
-- 3. 같은 이름 학생회 찾기 (만들기 화면에서 안내용)
-- ---------------------------------------------------------------------

create or replace function public.find_same_organizations(p_school_name text, p_name text)
returns table (
  organization_id uuid,
  school_name     text,
  name            text,
  leader          text,
  created_on      date,
  member_count    integer,
  is_member       boolean,
  requested       boolean
)
language sql stable security definer set search_path = ''
as $$
  select o.id, o.school_name, o.name,
         coalesce(public.org_leader_masked(t.id), ''),
         (o.created_at at time zone 'Asia/Seoul')::date,
         (select count(*)::int from public.memberships m2 where m2.term_id = t.id),
         exists (select 1 from public.memberships m where m.term_id = t.id and m.user_id = (select auth.uid())),
         exists (
           select 1 from public.join_requests r
           where r.term_id = t.id and r.user_id = (select auth.uid()) and r.status = 'pending'
         )
  from public.organizations o
  join public.terms t on t.organization_id = o.id and t.is_active
  where (select auth.uid()) is not null
    and public.org_name_key(o.school_name) = public.org_name_key(p_school_name)
    and public.org_name_key(o.name) = public.org_name_key(p_name)
  order by o.created_at
  limit 10;
$$;

revoke execute on function public.find_same_organizations(text, text) from public, anon;
grant execute on function public.find_same_organizations(text, text) to authenticated;


-- ---------------------------------------------------------------------
-- 4. 학생회 만들기: 같은 이름이 있으면 확인 없이는 만들지 않는다
-- ---------------------------------------------------------------------

drop function if exists public.create_organization(text, text, text, public.member_role);

create function public.create_organization(
  p_school_name     text,
  p_name            text,
  p_term_name       text,
  p_my_role         public.member_role default 'president',
  p_allow_duplicate boolean default false
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_org_id  uuid;
  v_term_id uuid;
begin
  if v_user_id is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if p_my_role not in ('president', 'vice_president') then
    raise exception '학생회를 만드는 사람은 학회장·부학회장 중 하나여야 합니다.';
  end if;
  if not p_allow_duplicate and exists (
    select 1 from public.organizations o
    where public.org_name_key(o.school_name) = public.org_name_key(p_school_name)
      and public.org_name_key(o.name) = public.org_name_key(p_name)
  ) then
    raise exception '같은 이름의 학생회가 이미 있어요.' using errcode = 'P0002';
  end if;

  insert into public.organizations (school_name, name, created_by)
  values (trim(p_school_name), trim(p_name), v_user_id)
  returning id into v_org_id;

  insert into public.terms (organization_id, name, starts_on)
  values (v_org_id, trim(p_term_name), current_date)
  returning id into v_term_id;

  insert into public.memberships (term_id, user_id, role)
  values (v_term_id, v_user_id, p_my_role);

  insert into public.categories (term_id, name, sort_order)
  values
    (v_term_id, '회식', 10),
    (v_term_id, 'MT', 20),
    (v_term_id, '행사', 30),
    (v_term_id, '비품', 40),
    (v_term_id, '기타', 90);

  return v_org_id;
end;
$$;

revoke execute on function public.create_organization(text, text, text, public.member_role, boolean) from public, anon;
grant execute on function public.create_organization(text, text, text, public.member_role, boolean) to authenticated;
