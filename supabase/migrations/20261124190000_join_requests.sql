-- 학생회 참여 요청
--
-- 초대 링크 없이 사이트 주소로 들어온 사람이 이미 있는 학생회를 찾아 참여를 요청하고,
-- 그 학생회의 학회장·부학회장이 승인하면 멤버가 된다. 같은 학생회를 또 만드는 일을 줄인다.


-- ---------------------------------------------------------------------
-- 1. 참여 요청
-- ---------------------------------------------------------------------

create table public.join_requests (
  id         uuid primary key default gen_random_uuid(),
  term_id    uuid not null references public.terms (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  message    text not null default '' check (char_length(message) <= 200),
  status     text not null default 'pending'
             check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create unique index join_requests_one_pending
  on public.join_requests (term_id, user_id) where status = 'pending';
create index join_requests_term_id_idx on public.join_requests (term_id);

alter table public.join_requests enable row level security;

-- 본인 요청과, 그 연도의 학회장·부학회장만 본다. 쓰기는 아래 함수로만.
create policy "join_requests_select" on public.join_requests for select to authenticated
  using (user_id = (select auth.uid()) or public.is_term_manager(term_id));


-- ---------------------------------------------------------------------
-- 2. 학생회 찾기 (로그인한 사람 누구나, 이름·학교만 보인다)
-- ---------------------------------------------------------------------

create or replace function public.search_organizations(p_query text)
returns table (organization_id uuid, school_name text, name text, term_name text, requested boolean)
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
         )
  from public.organizations o
  join public.terms t on t.organization_id = o.id and t.is_active
  where (o.school_name || ' ' || o.name) ilike v_pattern
    and not exists (
      select 1 from public.memberships m where m.term_id = t.id and m.user_id = v_user_id
    )
  order by o.school_name, o.name
  limit 20;
end;
$$;


-- ---------------------------------------------------------------------
-- 3. 요청 보내기·취소
-- ---------------------------------------------------------------------

-- 진행 중인 요청이 있으면 메시지만 고친다
create or replace function public.request_join(p_org_id uuid, p_message text default '')
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_term_id uuid;
  v_message text := left(btrim(coalesce(p_message, '')), 200);
  v_id      uuid;
begin
  if v_user_id is null then
    raise exception '로그인이 필요합니다.';
  end if;

  select id into v_term_id from public.terms where organization_id = p_org_id and is_active;
  if v_term_id is null then
    raise exception '참여할 수 있는 학생회를 찾지 못했어요.';
  end if;
  if exists (select 1 from public.memberships where term_id = v_term_id and user_id = v_user_id) then
    raise exception '이미 이 학생회의 멤버예요.';
  end if;

  update public.join_requests
  set message = v_message
  where term_id = v_term_id and user_id = v_user_id and status = 'pending'
  returning id into v_id;

  if v_id is null then
    insert into public.join_requests (term_id, user_id, message)
    values (v_term_id, v_user_id, v_message)
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

create or replace function public.cancel_join_request(p_request_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.join_requests
  set status = 'cancelled', decided_at = now()
  where id = p_request_id and status = 'pending' and user_id = (select auth.uid());
  if not found then
    raise exception '취소할 수 있는 요청이 없어요.';
  end if;
end;
$$;

-- 내가 보낸 요청 (학생회 이름과 함께. 멤버가 아니면 학생회를 직접 조회할 수 없어서 함수로 준다)
create or replace function public.my_join_requests()
returns table (id uuid, school_name text, name text, status text, created_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select r.id, o.school_name, o.name, r.status, r.created_at
  from public.join_requests r
  join public.terms t on t.id = r.term_id
  join public.organizations o on o.id = t.organization_id
  where r.user_id = (select auth.uid())
    and (r.status = 'pending' or r.decided_at > now() - interval '30 days')
  order by r.created_at desc
  limit 20;
$$;


-- ---------------------------------------------------------------------
-- 4. 학회장·부학회장: 받은 요청 보기·승인·거절
-- ---------------------------------------------------------------------

-- 요청한 사람 이름은 아직 같은 학생회가 아니라 프로필을 직접 볼 수 없어서 함수로 준다
create or replace function public.term_join_requests(p_term_id uuid)
returns table (id uuid, display_name text, message text, created_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_term_manager(p_term_id) then
    return;
  end if;
  return query
  select r.id, coalesce(nullif(p.display_name, ''), '이름 없음'), r.message, r.created_at
  from public.join_requests r
  left join public.profiles p on p.id = r.user_id
  where r.term_id = p_term_id and r.status = 'pending'
  order by r.created_at;
end;
$$;

-- 승인하면 고른 역할로 멤버가 된다 (기능 권한은 기본으로 모두 켜짐)
create or replace function public.decide_join_request(
  p_request_id uuid,
  p_approve    boolean,
  p_role       public.member_role default 'member'
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_req public.join_requests;
begin
  select * into v_req from public.join_requests where id = p_request_id for update;
  if v_req.id is null then
    raise exception '요청을 찾을 수 없어요.';
  end if;
  if not public.is_term_manager(v_req.term_id) then
    raise exception '참여 요청은 학회장·부학회장만 처리할 수 있어요.';
  end if;
  if v_req.status <> 'pending' then
    raise exception '이미 처리된 요청이에요.';
  end if;

  if p_approve then
    insert into public.memberships (term_id, user_id, role)
    values (v_req.term_id, v_req.user_id, p_role)
    on conflict (term_id, user_id) do nothing;
  end if;

  update public.join_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      decided_by = (select auth.uid()),
      decided_at = now()
  where id = p_request_id;
end;
$$;

revoke execute on function public.search_organizations(text) from public, anon;
revoke execute on function public.request_join(uuid, text) from public, anon;
revoke execute on function public.cancel_join_request(uuid) from public, anon;
revoke execute on function public.my_join_requests() from public, anon;
revoke execute on function public.term_join_requests(uuid) from public, anon;
revoke execute on function public.decide_join_request(uuid, boolean, public.member_role) from public, anon;
grant execute on function public.search_organizations(text) to authenticated;
grant execute on function public.request_join(uuid, text) to authenticated;
grant execute on function public.cancel_join_request(uuid) to authenticated;
grant execute on function public.my_join_requests() to authenticated;
grant execute on function public.term_join_requests(uuid) to authenticated;
grant execute on function public.decide_join_request(uuid, boolean, public.member_role) to authenticated;
