-- =====================================================================
-- 기능별 권한 + 행사 관리
--
-- 1) 권한
--    - 관리자(학회장·부학회장·총무): 모든 기능 + 학생회원 관리(역할·직책·권한·초대·내보내기·기수 전환)
--    - 그 외(임원·부원): 기본으로 모든 기능을 쓰고, 관리자가 기능별로 권한을 해제할 수 있다.
--      해제한 기능은 memberships.revoked_permissions 에 담는다.
--    - 기능: expenses_all(모든 지출 수정), incomes(수입), audit(감사 자료·변경 이력),
--            events(행사 관리), payments(결제 연동), settings(학생회 설정·행사 분류)
--    - 지출 등록과 본인 지출 수정은 활성 기수 멤버면 누구나 할 수 있다.
-- 2) 행사(events)와 참가자 명단(event_participants)
--    - 행사는 같은 이름의 지출 분류(categories)와 연결된다.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 멤버십: 부서·직책, 해제한 기능 권한
-- ---------------------------------------------------------------------

alter table public.memberships
  add column position text not null default '' check (char_length(position) <= 50),
  add column revoked_permissions text[] not null default '{}'
    check (revoked_permissions <@ array['expenses_all', 'incomes', 'audit', 'events', 'payments', 'settings']::text[]);


-- ---------------------------------------------------------------------
-- 2. 권한 확인 함수
-- ---------------------------------------------------------------------

-- 이 기수가 활성 상태이고 내가 멤버인지 (역할 무관)
create or replace function public.is_active_term_member(p_term_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.terms t on t.id = m.term_id
    where t.id = p_term_id and t.is_active and m.user_id = (select auth.uid())
  );
$$;

-- 활성 기수의 관리자(학회장·부학회장·총무)인지
create or replace function public.is_term_admin(p_term_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.terms t on t.id = m.term_id
    where t.id = p_term_id and t.is_active and m.user_id = (select auth.uid())
      and m.role in ('president', 'vice_president', 'treasurer')
  );
$$;

-- 활성 기수에서 이 기능을 쓸 수 있는지 (관리자는 항상, 그 외는 해제되지 않았으면)
create or replace function public.has_term_permission(p_term_id uuid, p_permission text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.terms t on t.id = m.term_id
    where t.id = p_term_id and t.is_active and m.user_id = (select auth.uid())
      and (m.role in ('president', 'vice_president', 'treasurer') or not (p_permission = any (m.revoked_permissions)))
  );
$$;

-- 학생회 기준 (그 학생회의 활성 기수에서)
create or replace function public.has_org_permission(p_org_id uuid, p_permission text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.terms t on t.id = m.term_id
    where t.organization_id = p_org_id and t.is_active and m.user_id = (select auth.uid())
      and (m.role in ('president', 'vice_president', 'treasurer') or not (p_permission = any (m.revoked_permissions)))
  );
$$;

create or replace function public.is_org_admin(p_org_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.terms t on t.id = m.term_id
    where t.organization_id = p_org_id and t.is_active and m.user_id = (select auth.uid())
      and m.role in ('president', 'vice_president', 'treasurer')
  );
$$;


-- ---------------------------------------------------------------------
-- 3. RLS 정책 다시 만들기
-- ---------------------------------------------------------------------

drop policy if exists "organizations_update" on public.organizations;
create policy "organizations_update" on public.organizations for update to authenticated
  using (public.has_org_permission(id, 'settings'))
  with check (public.has_org_permission(id, 'settings'));

drop policy if exists "terms_update" on public.terms;
create policy "terms_update" on public.terms for update to authenticated
  using (public.has_org_permission(organization_id, 'settings'))
  with check (public.has_org_permission(organization_id, 'settings'));

-- 학생회원 관리: 관리자만
drop policy if exists "memberships_insert" on public.memberships;
drop policy if exists "memberships_update" on public.memberships;
drop policy if exists "memberships_delete" on public.memberships;
create policy "memberships_insert" on public.memberships for insert to authenticated
  with check (public.is_term_admin(term_id));
create policy "memberships_update" on public.memberships for update to authenticated
  using (public.is_term_admin(term_id))
  with check (public.is_term_admin(term_id));
create policy "memberships_delete" on public.memberships for delete to authenticated
  using (public.is_term_admin(term_id) and user_id <> (select auth.uid()));

drop policy if exists "invitations_select" on public.invitations;
drop policy if exists "invitations_insert" on public.invitations;
drop policy if exists "invitations_update" on public.invitations;
create policy "invitations_select" on public.invitations for select to authenticated
  using (public.is_term_admin(term_id));
create policy "invitations_insert" on public.invitations for insert to authenticated
  with check (public.is_term_admin(term_id) and created_by = (select auth.uid()));
create policy "invitations_update" on public.invitations for update to authenticated
  using (public.is_term_admin(term_id))
  with check (public.is_term_admin(term_id));

-- 행사 분류: 학생회 설정 또는 행사 관리 권한
drop policy if exists "categories_insert" on public.categories;
drop policy if exists "categories_update" on public.categories;
drop policy if exists "categories_delete" on public.categories;
create policy "categories_insert" on public.categories for insert to authenticated
  with check (public.has_term_permission(term_id, 'settings') or public.has_term_permission(term_id, 'events'));
create policy "categories_update" on public.categories for update to authenticated
  using (public.has_term_permission(term_id, 'settings') or public.has_term_permission(term_id, 'events'))
  with check (public.has_term_permission(term_id, 'settings') or public.has_term_permission(term_id, 'events'));
create policy "categories_delete" on public.categories for delete to authenticated
  using (public.has_term_permission(term_id, 'settings'));

drop policy if exists "payment_events_select" on public.payment_events;
create policy "payment_events_select" on public.payment_events for select to authenticated
  using (public.has_org_permission(organization_id, 'payments'));

drop policy if exists "expenses_insert" on public.expenses;
drop policy if exists "expenses_update" on public.expenses;
create policy "expenses_insert" on public.expenses for insert to authenticated
  with check (
    public.is_active_term_member(term_id)
    and created_by = (select auth.uid())
    and payment_event_id is null
  );
create policy "expenses_update" on public.expenses for update to authenticated
  using (
    public.has_term_permission(term_id, 'expenses_all')
    or (public.is_active_term_member(term_id) and created_by = (select auth.uid()))
  )
  with check (
    public.has_term_permission(term_id, 'expenses_all')
    or (public.is_active_term_member(term_id) and created_by = (select auth.uid()))
  );

drop policy if exists "receipts_insert" on public.receipts;
drop policy if exists "receipts_delete" on public.receipts;
create policy "receipts_insert" on public.receipts for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and exists (
      select 1 from public.expenses e
      where e.id = expense_id
        and (
          public.has_term_permission(e.term_id, 'expenses_all')
          or (public.is_active_term_member(e.term_id) and e.created_by = (select auth.uid()))
        )
    )
  );
create policy "receipts_delete" on public.receipts for delete to authenticated
  using (exists (
    select 1 from public.expenses e
    where e.id = expense_id
      and (
        public.has_term_permission(e.term_id, 'expenses_all')
        or (public.is_active_term_member(e.term_id) and e.created_by = (select auth.uid()))
      )
  ));

drop policy if exists "webhook_tokens_select" on public.webhook_tokens;
drop policy if exists "webhook_tokens_insert" on public.webhook_tokens;
drop policy if exists "webhook_tokens_update" on public.webhook_tokens;
create policy "webhook_tokens_select" on public.webhook_tokens for select to authenticated
  using (public.has_org_permission(organization_id, 'payments'));
create policy "webhook_tokens_insert" on public.webhook_tokens for insert to authenticated
  with check (public.has_org_permission(organization_id, 'payments') and created_by = (select auth.uid()));
create policy "webhook_tokens_update" on public.webhook_tokens for update to authenticated
  using (public.has_org_permission(organization_id, 'payments'))
  with check (public.has_org_permission(organization_id, 'payments'));

drop policy if exists "audit_logs_select" on public.audit_logs;
create policy "audit_logs_select" on public.audit_logs for select to authenticated
  using (public.has_org_permission(public.term_org_id(term_id), 'audit'));

drop policy if exists "incomes_insert" on public.incomes;
drop policy if exists "incomes_update" on public.incomes;
create policy "incomes_insert" on public.incomes for insert to authenticated
  with check (
    public.has_term_permission(term_id, 'incomes')
    and created_by = (select auth.uid())
    and payment_event_id is null
  );
create policy "incomes_update" on public.incomes for update to authenticated
  using (public.has_term_permission(term_id, 'incomes'))
  with check (public.has_term_permission(term_id, 'incomes'));

-- 영수증 파일 (경로: {학생회}/{기수}/{지출}/{파일})
drop policy if exists "receipts_bucket_insert" on storage.objects;
drop policy if exists "receipts_bucket_delete" on storage.objects;
create policy "receipts_bucket_insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'receipts'
    and public.is_active_term_member(public.try_uuid((storage.foldername(name))[2]))
    and public.term_org_id(public.try_uuid((storage.foldername(name))[2])) = public.try_uuid((storage.foldername(name))[1])
  );
create policy "receipts_bucket_delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'receipts'
    and public.term_org_id(public.try_uuid((storage.foldername(name))[2])) = public.try_uuid((storage.foldername(name))[1])
    and (
      public.has_term_permission(public.try_uuid((storage.foldername(name))[2]), 'expenses_all')
      or (
        public.is_active_term_member(public.try_uuid((storage.foldername(name))[2]))
        and exists (
          select 1 from public.expenses e
          where e.id = public.try_uuid((storage.foldername(name))[3])
            and e.term_id = public.try_uuid((storage.foldername(name))[2])
            and e.created_by = (select auth.uid())
        )
      )
    )
  );


-- ---------------------------------------------------------------------
-- 4. 업무 함수: 새 역할 반영
-- ---------------------------------------------------------------------

-- 학생회 생성: 만드는 사람은 학회장·부학회장·총무 중 하나
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
  if p_my_role not in ('president', 'vice_president', 'treasurer') then
    raise exception '학생회를 만드는 사람은 학회장·부학회장·총무 중 하나여야 합니다.';
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

-- 기수 전환: 관리자만. 새 기수에서 내 역할도 관리자 역할이어야 한다.
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
  if not public.is_org_admin(p_org_id) then
    raise exception '기수 전환은 현재 기수의 학회장·부학회장·총무만 할 수 있습니다.';
  end if;
  if p_my_role not in ('president', 'vice_president', 'treasurer') then
    raise exception '새 기수에서 내 역할은 학회장·부학회장·총무 중 하나여야 합니다.';
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

-- 회원 탈퇴: 다른 멤버가 있는 활성 기수의 유일한 관리자면 막는다
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
    and m.role in ('president', 'vice_president', 'treasurer')
    and not exists (
      select 1 from public.memberships other
      where other.term_id = m.term_id
        and other.user_id <> v_user_id
        and other.role in ('president', 'vice_president', 'treasurer')
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
-- 5. 행사와 참가자 명단
-- ---------------------------------------------------------------------

create table public.events (
  id           uuid primary key default gen_random_uuid(),
  term_id      uuid not null references public.terms (id) on delete cascade,
  category_id  uuid references public.categories (id) on delete set null,
  -- opening 개강총회 / closing 종강총회 / freshmen 신환회 / mt / lt / jacket 과잠 / other 기타
  kind         text not null default 'other'
               check (kind in ('opening', 'closing', 'freshmen', 'mt', 'lt', 'jacket', 'other')),
  name         text not null check (char_length(name) between 1 and 50),
  starts_on    date,
  ends_on      date,
  place        text not null default '' check (char_length(place) <= 100),
  fee          bigint not null default 0 check (fee between 0 and 100000000),
  capacity     integer check (capacity is null or capacity between 1 and 10000),
  form_url     text not null default '' check (char_length(form_url) <= 500),
  extra_fields text[] not null default '{}' check (cardinality(extra_fields) <= 10),
  memo         text not null default '' check (char_length(memo) <= 1000),
  income_id    uuid references public.incomes (id) on delete set null,  -- 참가비를 수입으로 기록한 결과
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
create index events_term_idx on public.events (term_id, starts_on);

create table public.event_participants (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events (id) on delete cascade,
  name       text not null check (char_length(trim(name)) between 1 and 30),
  student_no text not null check (student_no ~ '^[0-9]{2}$'),     -- 학번 앞 2자리 (예: 24)
  grade      smallint check (grade is null or grade between 1 and 6),
  paid       boolean not null default false,
  attended   boolean not null default false,
  fields     jsonb not null default '{}'::jsonb,                   -- 행사별 추가 칸 (사이즈, 차량 등)
  memo       text not null default '' check (char_length(memo) <= 300),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index event_participants_event_idx on public.event_participants (event_id, created_at);

create trigger events_set_updated_at before update on public.events
  for each row execute function public.set_updated_at();
create trigger event_participants_set_updated_at before update on public.event_participants
  for each row execute function public.set_updated_at();

-- 행사가 속한 기수 (명단 RLS용)
create or replace function public.event_term_id(p_event_id uuid)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select term_id from public.events where id = p_event_id;
$$;

alter table public.events enable row level security;
alter table public.event_participants enable row level security;

create policy "events_select" on public.events for select to authenticated
  using (public.is_org_member(public.term_org_id(term_id)));
create policy "events_insert" on public.events for insert to authenticated
  with check (public.has_term_permission(term_id, 'events') and created_by = (select auth.uid()));
create policy "events_update" on public.events for update to authenticated
  using (public.has_term_permission(term_id, 'events'))
  with check (public.has_term_permission(term_id, 'events'));

create policy "event_participants_select" on public.event_participants for select to authenticated
  using (public.is_org_member(public.term_org_id(public.event_term_id(event_id))));
create policy "event_participants_insert" on public.event_participants for insert to authenticated
  with check (public.has_term_permission(public.event_term_id(event_id), 'events'));
create policy "event_participants_update" on public.event_participants for update to authenticated
  using (public.has_term_permission(public.event_term_id(event_id), 'events'))
  with check (public.has_term_permission(public.event_term_id(event_id), 'events'));
create policy "event_participants_delete" on public.event_participants for delete to authenticated
  using (public.has_term_permission(public.event_term_id(event_id), 'events'));
