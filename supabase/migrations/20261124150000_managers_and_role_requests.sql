-- 학생회원 관리는 학회장·부학회장만 + 직책 변경 요청·승인
--
-- 1. 학생회원 관리(멤버 추가·역할 변경·내보내기·초대·새 연도 시작)는 학회장·부학회장만 한다.
--    총무는 지금처럼 모든 기능을 쓰지만 멤버는 관리하지 않는다.
-- 2. 학회장·부학회장은 자기 역할·직책을 직접 바꿀 수 있다. 단, 연도마다 학회장·부학회장이 한 명은 남아야 한다.
-- 3. 그 밖의 멤버는 역할·직책 변경을 요청하고, 학회장·부학회장이 승인하면 바뀐다.


-- ---------------------------------------------------------------------
-- 1. 관리자(학회장·부학회장) 확인 함수
-- ---------------------------------------------------------------------

create or replace function public.is_term_manager(p_term_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.terms t on t.id = m.term_id
    where t.id = p_term_id and t.is_active and m.user_id = (select auth.uid())
      and m.role in ('president', 'vice_president')
  );
$$;

create or replace function public.is_org_manager(p_org_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.terms t on t.id = m.term_id
    where t.organization_id = p_org_id and t.is_active and m.user_id = (select auth.uid())
      and m.role in ('president', 'vice_president')
  );
$$;


-- ---------------------------------------------------------------------
-- 2. 멤버·초대 정책: 학회장·부학회장만
-- ---------------------------------------------------------------------

drop policy if exists "memberships_insert" on public.memberships;
drop policy if exists "memberships_update" on public.memberships;
drop policy if exists "memberships_delete" on public.memberships;
create policy "memberships_insert" on public.memberships for insert to authenticated
  with check (public.is_term_manager(term_id));
create policy "memberships_update" on public.memberships for update to authenticated
  using (public.is_term_manager(term_id))
  with check (public.is_term_manager(term_id));
create policy "memberships_delete" on public.memberships for delete to authenticated
  using (public.is_term_manager(term_id) and user_id <> (select auth.uid()));

drop policy if exists "invitations_select" on public.invitations;
drop policy if exists "invitations_insert" on public.invitations;
drop policy if exists "invitations_update" on public.invitations;
create policy "invitations_select" on public.invitations for select to authenticated
  using (public.is_term_manager(term_id));
create policy "invitations_insert" on public.invitations for insert to authenticated
  with check (public.is_term_manager(term_id) and created_by = (select auth.uid()));
create policy "invitations_update" on public.invitations for update to authenticated
  using (public.is_term_manager(term_id))
  with check (public.is_term_manager(term_id));


-- ---------------------------------------------------------------------
-- 3. 학회장·부학회장이 한 명은 남게
-- ---------------------------------------------------------------------

create or replace function public.keep_term_manager()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.role in ('president', 'vice_president')
     and new.role not in ('president', 'vice_president')
     and exists (select 1 from public.terms t where t.id = old.term_id and t.is_active)
     and not exists (
       select 1 from public.memberships other
       where other.term_id = old.term_id
         and other.id <> old.id
         and other.role in ('president', 'vice_president')
     )
  then
    raise exception '학회장·부학회장이 한 명은 있어야 해요. 다른 사람을 먼저 학회장이나 부학회장으로 바꿔 주세요.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists memberships_keep_manager on public.memberships;
create trigger memberships_keep_manager
  before update of role on public.memberships
  for each row execute function public.keep_term_manager();

revoke execute on function public.keep_term_manager() from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 4. 업무 함수: 학회장·부학회장 기준으로
-- ---------------------------------------------------------------------

-- 학생회 생성: 만드는 사람은 학회장이나 부학회장 (멤버를 관리할 사람이 있어야 한다)
create or replace function public.create_organization(
  p_school_name text,
  p_name        text,
  p_term_name   text,
  p_my_role     public.member_role default 'president'
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

-- 새 연도 시작: 학회장·부학회장만. 새 연도에서 내 역할도 학회장·부학회장이어야 한다.
create or replace function public.start_new_term(
  p_org_id    uuid,
  p_term_name text,
  p_my_role   public.member_role default 'president'
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_user_id  uuid := (select auth.uid());
  v_old_term uuid;
  v_new_term uuid;
begin
  if not public.is_org_manager(p_org_id) then
    raise exception '새 연도 시작은 지금 학생회의 학회장·부학회장만 할 수 있습니다.';
  end if;
  if p_my_role not in ('president', 'vice_president') then
    raise exception '새 연도에서 내 역할은 학회장·부학회장 중 하나여야 합니다.';
  end if;

  select id into v_old_term
  from public.terms
  where organization_id = p_org_id and is_active
  for update;

  update public.terms
  set is_active = false, ends_on = coalesce(ends_on, current_date)
  where id = v_old_term;

  insert into public.terms (organization_id, name, starts_on)
  values (p_org_id, trim(p_term_name), current_date)
  returning id into v_new_term;

  insert into public.memberships (term_id, user_id, role)
  values (v_new_term, v_user_id, p_my_role);

  insert into public.categories (term_id, name, audit_code, sort_order)
  select v_new_term, name, audit_code, sort_order
  from public.categories
  where term_id = v_old_term;

  return v_new_term;
end;
$$;

-- 회원 탈퇴: 다른 멤버가 있는 학생회의 유일한 학회장·부학회장이면 막는다
create or replace function public.delete_my_account()
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_user_id  uuid := (select auth.uid());
  v_blocking text;
  v_kakao_id text;
begin
  if v_user_id is null then
    raise exception '로그인이 필요합니다.';
  end if;

  select o.name into v_blocking
  from public.memberships m
  join public.terms t on t.id = m.term_id
  join public.organizations o on o.id = t.organization_id
  where m.user_id = v_user_id
    and t.is_active
    and m.role in ('president', 'vice_president')
    and not exists (
      select 1 from public.memberships other
      where other.term_id = m.term_id
        and other.user_id <> v_user_id
        and other.role in ('president', 'vice_president')
    )
    and exists (
      select 1 from public.memberships other
      where other.term_id = m.term_id
        and other.user_id <> v_user_id
    )
  limit 1;

  if v_blocking is not null then
    raise exception '%의 유일한 학회장·부학회장이에요. 학생회원 관리에서 다른 멤버에게 학회장이나 부학회장 역할을 넘긴 뒤 탈퇴해 주세요.', v_blocking
      using errcode = 'P0001';
  end if;

  select provider_id into v_kakao_id
  from auth.identities
  where user_id = v_user_id and provider = 'kakao'
  limit 1;

  delete from auth.users where id = v_user_id;

  return v_kakao_id;
end;
$$;


-- ---------------------------------------------------------------------
-- 5. 직책 변경 요청
-- ---------------------------------------------------------------------

create table public.role_change_requests (
  id                 uuid primary key default gen_random_uuid(),
  term_id            uuid not null references public.terms (id) on delete cascade,
  membership_id      uuid not null references public.memberships (id) on delete cascade,
  requested_role     public.member_role not null,
  requested_position text not null default '' check (char_length(requested_position) <= 50),
  status             text not null default 'pending'
                     check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by       uuid references auth.users (id) on delete set null,
  decided_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  decided_at         timestamptz
);
create unique index role_change_requests_one_pending
  on public.role_change_requests (membership_id) where status = 'pending';
create index role_change_requests_term_id_idx on public.role_change_requests (term_id);

alter table public.role_change_requests enable row level security;

-- 본인 요청과, 그 연도의 학회장·부학회장만 본다. 쓰기는 아래 함수로만.
create policy "role_change_requests_select" on public.role_change_requests for select to authenticated
  using (
    public.is_term_manager(term_id)
    or exists (
      select 1 from public.memberships m
      where m.id = membership_id and m.user_id = (select auth.uid())
    )
  );

-- 요청하기: 진행 중인 내 요청이 있으면 새 요청으로 바꾼다
create or replace function public.request_role_change(
  p_term_id  uuid,
  p_role     public.member_role,
  p_position text default ''
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_user_id  uuid := (select auth.uid());
  v_member   public.memberships;
  v_position text := coalesce(trim(p_position), '');
  v_id       uuid;
begin
  select m.* into v_member
  from public.memberships m
  join public.terms t on t.id = m.term_id
  where m.term_id = p_term_id and t.is_active and m.user_id = v_user_id;

  if v_member.id is null then
    raise exception '이 학생회의 올해 멤버만 요청할 수 있어요.';
  end if;
  if v_member.role in ('president', 'vice_president') then
    raise exception '학회장·부학회장은 학생회원 관리에서 직접 바꿀 수 있어요.';
  end if;
  if char_length(v_position) > 50 then
    raise exception '부서·직책은 50자 이내로 입력해 주세요.';
  end if;
  if v_member.role = p_role and v_member.position = v_position then
    raise exception '지금과 같은 역할·직책이에요.';
  end if;

  update public.role_change_requests
  set status = 'cancelled', decided_at = now()
  where membership_id = v_member.id and status = 'pending';

  insert into public.role_change_requests (term_id, membership_id, requested_role, requested_position, requested_by)
  values (p_term_id, v_member.id, p_role, v_position, v_user_id)
  returning id into v_id;

  return v_id;
end;
$$;

-- 요청 취소: 본인의 진행 중인 요청만
create or replace function public.cancel_role_request(p_request_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.role_change_requests r
  set status = 'cancelled', decided_at = now()
  where r.id = p_request_id
    and r.status = 'pending'
    and exists (
      select 1 from public.memberships m
      where m.id = r.membership_id and m.user_id = (select auth.uid())
    );
  if not found then
    raise exception '취소할 수 있는 요청이 없어요.';
  end if;
end;
$$;

-- 승인·거절: 그 연도의 학회장·부학회장만. 승인하면 역할·직책을 바로 바꾼다.
create or replace function public.decide_role_request(p_request_id uuid, p_approve boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_req public.role_change_requests;
begin
  select * into v_req from public.role_change_requests where id = p_request_id for update;
  if v_req.id is null then
    raise exception '요청을 찾을 수 없어요.';
  end if;
  if not public.is_term_manager(v_req.term_id) then
    raise exception '직책 변경 요청은 학회장·부학회장만 처리할 수 있어요.';
  end if;
  if v_req.status <> 'pending' then
    raise exception '이미 처리된 요청이에요.';
  end if;

  if p_approve then
    update public.memberships
    set role = v_req.requested_role, position = v_req.requested_position
    where id = v_req.membership_id;
  end if;

  update public.role_change_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      decided_by = (select auth.uid()),
      decided_at = now()
  where id = p_request_id;
end;
$$;

revoke execute on function public.request_role_change(uuid, public.member_role, text) from public, anon;
revoke execute on function public.cancel_role_request(uuid) from public, anon;
revoke execute on function public.decide_role_request(uuid, boolean) from public, anon;
grant execute on function public.request_role_change(uuid, public.member_role, text) to authenticated;
grant execute on function public.cancel_role_request(uuid) to authenticated;
grant execute on function public.decide_role_request(uuid, boolean) to authenticated;
