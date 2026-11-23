-- =====================================================================
-- 학생회 회계·감사 도구: 초기 스키마
--
-- 구조: 학생회(organizations) → 기수(terms) → 멤버십·카테고리·지출
-- 권한: 모든 테이블에 RLS. 소속 학생회 데이터만 보이고,
--       지난 기수(is_active = false)는 읽기 전용.
-- 금액: 원 단위 정수(bigint).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 열거형
-- ---------------------------------------------------------------------

create type public.member_role as enum ('treasurer', 'president', 'member');

create type public.payment_method as enum ('card', 'transfer', 'cash');

-- needs_receipt: 영수증 미첨부 / complete: 완료 / excused: 사유서로 대체 / cancelled: 결제 취소
create type public.expense_status as enum ('needs_receipt', 'complete', 'excused', 'cancelled');

create type public.payment_event_kind as enum ('approval', 'cancel', 'unknown');


-- ---------------------------------------------------------------------
-- 2. 테이블
-- ---------------------------------------------------------------------

-- 사용자 프로필 (auth.users와 1:1)
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 50),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- 학생회
create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  school_name text not null check (char_length(school_name) between 1 and 100),
  name        text not null check (char_length(name) between 1 and 100),
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 기수 (예: 2026년 제38대). 학생회당 활성 기수는 하나.
create table public.terms (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name            text not null check (char_length(name) between 1 and 50),
  starts_on       date,
  ends_on         date,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
create unique index terms_one_active_per_org on public.terms (organization_id) where is_active;
create index terms_organization_id_idx on public.terms (organization_id);

-- 기수별 멤버와 역할
create table public.memberships (
  id         uuid primary key default gen_random_uuid(),
  term_id    uuid not null references public.terms (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       public.member_role not null default 'member',
  created_at timestamptz not null default now(),
  unique (term_id, user_id)
);
create index memberships_user_id_idx on public.memberships (user_id);

-- 초대 링크 (만료 전까지 여러 명이 사용 가능)
create table public.invitations (
  id         uuid primary key default gen_random_uuid(),
  term_id    uuid not null references public.terms (id) on delete cascade,
  -- 확장 없이 쓰려고 UUID 두 개(암호학적 난수)를 이어 붙인 64자리 토큰
  token      text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  role       public.member_role not null default 'member',
  expires_at timestamptz not null default now() + interval '7 days',
  revoked_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index invitations_term_id_idx on public.invitations (term_id);

-- 행사/항목 카테고리 (감사 양식 항목과 매핑)
create table public.categories (
  id         uuid primary key default gen_random_uuid(),
  term_id    uuid not null references public.terms (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 50),
  audit_code text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (term_id, name)
);

-- 결제 문자 수신 기록 (웹훅으로만 기록, 서비스 키 사용)
create table public.payment_events (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  raw_text        text not null,              -- 카드번호·이름은 저장 전 마스킹
  kind            public.payment_event_kind not null default 'unknown',
  amount          bigint check (amount is null or amount >= 0),
  merchant        text,
  approved_at     timestamptz,
  parsed          jsonb,
  parse_error     text,
  dedupe_key      text not null,
  received_at     timestamptz not null default now(),
  unique (organization_id, dedupe_key)
);
create index payment_events_org_received_idx on public.payment_events (organization_id, received_at desc);

-- 지출
create table public.expenses (
  id               uuid primary key default gen_random_uuid(),
  term_id          uuid not null references public.terms (id) on delete cascade,
  category_id      uuid references public.categories (id) on delete set null,
  spent_on         date not null,
  merchant         text not null default '' check (char_length(merchant) <= 100),
  amount           bigint not null check (amount >= 0),
  items            text not null default '' check (char_length(items) <= 500),
  payment_method   public.payment_method not null default 'card',
  status           public.expense_status not null default 'needs_receipt',
  memo             text not null default '' check (char_length(memo) <= 1000),
  missing_reason   text check (missing_reason is null or char_length(missing_reason) <= 1000), -- 영수증 분실 사유서
  payment_event_id uuid unique references public.payment_events (id) on delete set null,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,                -- 소프트 삭제
  check (status <> 'excused' or missing_reason is not null)
);
create index expenses_term_spent_idx on public.expenses (term_id, spent_on);
create index expenses_category_id_idx on public.expenses (category_id);
create index expenses_status_idx on public.expenses (term_id, status) where deleted_at is null;

-- 영수증 이미지 (Storage 'receipts' 버킷의 경로)
create table public.receipts (
  id             uuid primary key default gen_random_uuid(),
  expense_id     uuid not null references public.expenses (id) on delete cascade,
  storage_path   text not null unique,
  ocr_raw        jsonb,
  ocr_confidence numeric(4, 3) check (ocr_confidence is null or ocr_confidence between 0 and 1),
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now()
);
create index receipts_expense_id_idx on public.receipts (expense_id);

-- 결제 문자 웹훅 토큰 (해시만 저장)
create table public.webhook_tokens (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  token_hash      text not null unique,
  label           text not null default '' check (char_length(label) <= 50),
  last_used_at    timestamptz,
  revoked_at      timestamptz,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now()
);
create index webhook_tokens_organization_id_idx on public.webhook_tokens (organization_id);

-- 웹 푸시 구독
create table public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_id_idx on public.push_subscriptions (user_id);

-- 지출 변경 이력 (트리거로만 기록)
create table public.audit_logs (
  id         bigint generated always as identity primary key,
  expense_id uuid not null references public.expenses (id) on delete cascade,
  term_id    uuid not null references public.terms (id) on delete cascade,
  actor_id   uuid references auth.users (id) on delete set null,
  action     text not null check (action in ('insert', 'update')),
  old_data   jsonb,
  new_data   jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_expense_id_idx on public.audit_logs (expense_id, created_at desc);


-- ---------------------------------------------------------------------
-- 3. 권한 확인 함수 (RLS 재귀를 피하려고 security definer)
-- ---------------------------------------------------------------------

-- 이 학생회의 어느 기수에든 속해 있는지
create or replace function public.is_org_member(org_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.terms t on t.id = m.term_id
    where t.organization_id = org_id
      and m.user_id = (select auth.uid())
  );
$$;

-- 이 학생회의 '활성 기수'에서 주어진 역할 중 하나인지
create or replace function public.has_active_org_role(org_id uuid, roles public.member_role[])
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.terms t on t.id = m.term_id
    where t.organization_id = org_id
      and t.is_active
      and m.user_id = (select auth.uid())
      and m.role = any (roles)
  );
$$;

-- 기수가 속한 학생회 id
create or replace function public.term_org_id(p_term_id uuid)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select organization_id from public.terms where id = p_term_id;
$$;

-- 이 기수가 활성 상태이고, 내가 그 기수에서 주어진 역할 중 하나인지 (쓰기 권한 확인용)
create or replace function public.has_active_term_role(p_term_id uuid, roles public.member_role[])
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.terms t on t.id = m.term_id
    where t.id = p_term_id
      and t.is_active
      and m.user_id = (select auth.uid())
      and m.role = any (roles)
  );
$$;

-- 문자열을 uuid로 바꾼다. 형식이 틀리면 null (스토리지 경로 검사용)
create or replace function public.try_uuid(p_text text)
returns uuid
language plpgsql immutable set search_path = ''
as $$
begin
  return p_text::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

-- 같은 학생회에 속한 사용자인지 (프로필 조회용)
create or replace function public.shares_org_with(other_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships mine
    join public.terms t1 on t1.id = mine.term_id
    join public.terms t2 on t2.organization_id = t1.organization_id
    join public.memberships theirs on theirs.term_id = t2.id
    where mine.user_id = (select auth.uid())
      and theirs.user_id = other_user
  );
$$;


-- ---------------------------------------------------------------------
-- 4. 트리거
-- ---------------------------------------------------------------------

-- updated_at 자동 갱신
create or replace function public.set_updated_at()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at      before update on public.profiles      for each row execute function public.set_updated_at();
create trigger organizations_set_updated_at before update on public.organizations for each row execute function public.set_updated_at();
create trigger terms_set_updated_at         before update on public.terms         for each row execute function public.set_updated_at();
create trigger expenses_set_updated_at      before update on public.expenses      for each row execute function public.set_updated_at();

-- 회원가입 시 프로필 생성
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''), 50)
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 지출 변경 이력 기록
create or replace function public.log_expense_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.audit_logs (expense_id, term_id, actor_id, action, old_data, new_data)
  values (
    new.id,
    new.term_id,
    (select auth.uid()),
    lower(tg_op),
    case when tg_op = 'UPDATE' then to_jsonb(old) end,
    to_jsonb(new)
  );
  return new;
end;
$$;

create trigger expenses_audit_log
  after insert or update on public.expenses
  for each row execute function public.log_expense_change();

-- 지출의 기수·작성자는 바꿀 수 없다
create or replace function public.protect_expense_columns()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.term_id is distinct from old.term_id then
    raise exception '지출의 기수는 바꿀 수 없습니다.';
  end if;
  if new.created_by is distinct from old.created_by then
    raise exception '지출의 작성자는 바꿀 수 없습니다.';
  end if;
  return new;
end;
$$;

create trigger expenses_protect_columns
  before update on public.expenses
  for each row execute function public.protect_expense_columns();


-- ---------------------------------------------------------------------
-- 5. 업무 함수 (RPC)
-- ---------------------------------------------------------------------

-- 학생회 생성: 학생회 + 첫 기수 + 내 멤버십 + 기본 카테고리
create or replace function public.create_organization(
  p_school_name text,
  p_name        text,
  p_term_name   text,
  p_my_role     public.member_role default 'treasurer'
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
  if p_my_role = 'member' then
    raise exception '학생회를 만드는 사람은 총무 또는 회장이어야 합니다.';
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

-- 초대 수락: 토큰이 유효하면 해당 기수의 멤버가 된다
create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_inv     public.invitations%rowtype;
begin
  if v_user_id is null then
    raise exception '로그인이 필요합니다.';
  end if;

  select * into v_inv
  from public.invitations
  where token = p_token
    and revoked_at is null
    and expires_at > now();

  if not found then
    raise exception '초대 링크가 만료되었거나 올바르지 않습니다.';
  end if;

  if not exists (select 1 from public.terms where id = v_inv.term_id and is_active) then
    raise exception '이미 끝난 기수의 초대 링크입니다.';
  end if;

  insert into public.memberships (term_id, user_id, role)
  values (v_inv.term_id, v_user_id, v_inv.role)
  on conflict (term_id, user_id) do nothing;

  return public.term_org_id(v_inv.term_id);
end;
$$;

-- 기수 전환: 현재 기수를 닫고 새 기수를 연다. 호출한 사람과 카테고리는 새 기수로 옮긴다.
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
  if not public.has_active_org_role(p_org_id, array['president', 'treasurer']::public.member_role[]) then
    raise exception '기수 전환은 현재 기수의 회장 또는 총무만 할 수 있습니다.';
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


-- ---------------------------------------------------------------------
-- 6. RLS 정책
-- ---------------------------------------------------------------------

alter table public.profiles           enable row level security;
alter table public.organizations      enable row level security;
alter table public.terms              enable row level security;
alter table public.memberships        enable row level security;
alter table public.invitations        enable row level security;
alter table public.categories         enable row level security;
alter table public.payment_events     enable row level security;
alter table public.expenses           enable row level security;
alter table public.receipts           enable row level security;
alter table public.webhook_tokens     enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.audit_logs         enable row level security;

-- profiles: 나와 같은 학생회 사람만 조회, 수정은 본인만
create policy "profiles_select" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.shares_org_with(id));
create policy "profiles_update_own" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- organizations: 소속 학생회만 조회, 활성 기수의 회장·총무만 수정 (생성은 create_organization)
create policy "organizations_select" on public.organizations for select to authenticated
  using (public.is_org_member(id));
create policy "organizations_update" on public.organizations for update to authenticated
  using (public.has_active_org_role(id, array['president', 'treasurer']::public.member_role[]))
  with check (public.has_active_org_role(id, array['president', 'treasurer']::public.member_role[]));

-- terms: 소속 학생회의 모든 기수 조회, 활성 기수의 회장·총무만 수정 (생성·전환은 함수)
create policy "terms_select" on public.terms for select to authenticated
  using (public.is_org_member(organization_id));
create policy "terms_update" on public.terms for update to authenticated
  using (public.has_active_org_role(organization_id, array['president', 'treasurer']::public.member_role[]))
  with check (public.has_active_org_role(organization_id, array['president', 'treasurer']::public.member_role[]));

-- memberships: 소속 학생회 멤버 목록 조회, 활성 기수의 회장·총무가 관리
create policy "memberships_select" on public.memberships for select to authenticated
  using (public.is_org_member(public.term_org_id(term_id)));
create policy "memberships_insert" on public.memberships for insert to authenticated
  with check (public.has_active_term_role(term_id, array['president', 'treasurer']::public.member_role[]));
create policy "memberships_update" on public.memberships for update to authenticated
  using (public.has_active_term_role(term_id, array['president', 'treasurer']::public.member_role[]))
  with check (public.has_active_term_role(term_id, array['president', 'treasurer']::public.member_role[]));
create policy "memberships_delete" on public.memberships for delete to authenticated
  using (
    public.has_active_term_role(term_id, array['president', 'treasurer']::public.member_role[])
    and user_id <> (select auth.uid())   -- 자기 자신은 내보낼 수 없음
  );

-- invitations: 활성 기수의 회장·총무만 조회·생성·폐기 (수락은 accept_invitation)
create policy "invitations_select" on public.invitations for select to authenticated
  using (public.has_active_term_role(term_id, array['president', 'treasurer']::public.member_role[]));
create policy "invitations_insert" on public.invitations for insert to authenticated
  with check (
    public.has_active_term_role(term_id, array['president', 'treasurer']::public.member_role[])
    and created_by = (select auth.uid())
  );
create policy "invitations_update" on public.invitations for update to authenticated
  using (public.has_active_term_role(term_id, array['president', 'treasurer']::public.member_role[]))
  with check (public.has_active_term_role(term_id, array['president', 'treasurer']::public.member_role[]));

-- categories: 소속 학생회는 조회, 활성 기수의 회장·총무가 관리
create policy "categories_select" on public.categories for select to authenticated
  using (public.is_org_member(public.term_org_id(term_id)));
create policy "categories_insert" on public.categories for insert to authenticated
  with check (public.has_active_term_role(term_id, array['president', 'treasurer']::public.member_role[]));
create policy "categories_update" on public.categories for update to authenticated
  using (public.has_active_term_role(term_id, array['president', 'treasurer']::public.member_role[]))
  with check (public.has_active_term_role(term_id, array['president', 'treasurer']::public.member_role[]));
create policy "categories_delete" on public.categories for delete to authenticated
  using (public.has_active_term_role(term_id, array['president', 'treasurer']::public.member_role[]));

-- payment_events: 활성 기수의 총무·회장만 조회 (기록은 서비스 키로만)
create policy "payment_events_select" on public.payment_events for select to authenticated
  using (public.has_active_org_role(organization_id, array['president', 'treasurer']::public.member_role[]));

-- expenses: 소속 학생회는 조회.
--   등록: 활성 기수의 멤버 누구나(본인 이름으로)
--   수정: 총무·회장은 전부, 집행부원은 본인 건만. 삭제는 deleted_at으로만(물리 삭제 정책 없음)
create policy "expenses_select" on public.expenses for select to authenticated
  using (public.is_org_member(public.term_org_id(term_id)));
create policy "expenses_insert" on public.expenses for insert to authenticated
  with check (
    public.has_active_term_role(term_id, array['treasurer', 'president', 'member']::public.member_role[])
    and created_by = (select auth.uid())
    and payment_event_id is null
  );
create policy "expenses_update" on public.expenses for update to authenticated
  using (
    public.has_active_term_role(term_id, array['president', 'treasurer']::public.member_role[])
    or (
      public.has_active_term_role(term_id, array['member']::public.member_role[])
      and created_by = (select auth.uid())
    )
  )
  with check (
    public.has_active_term_role(term_id, array['president', 'treasurer']::public.member_role[])
    or (
      public.has_active_term_role(term_id, array['member']::public.member_role[])
      and created_by = (select auth.uid())
    )
  );

-- receipts: 지출을 볼 수 있으면 조회, 지출을 고칠 수 있으면 추가·삭제
create policy "receipts_select" on public.receipts for select to authenticated
  using (exists (
    select 1 from public.expenses e
    where e.id = expense_id
      and public.is_org_member(public.term_org_id(e.term_id))
  ));
create policy "receipts_insert" on public.receipts for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and exists (
      select 1 from public.expenses e
      where e.id = expense_id
        and (
          public.has_active_term_role(e.term_id, array['president', 'treasurer']::public.member_role[])
          or (public.has_active_term_role(e.term_id, array['member']::public.member_role[]) and e.created_by = (select auth.uid()))
        )
    )
  );
create policy "receipts_delete" on public.receipts for delete to authenticated
  using (exists (
    select 1 from public.expenses e
    where e.id = expense_id
      and (
        public.has_active_term_role(e.term_id, array['president', 'treasurer']::public.member_role[])
        or (public.has_active_term_role(e.term_id, array['member']::public.member_role[]) and e.created_by = (select auth.uid()))
      )
  ));

-- webhook_tokens: 활성 기수의 총무만 관리
create policy "webhook_tokens_select" on public.webhook_tokens for select to authenticated
  using (public.has_active_org_role(organization_id, array['treasurer']::public.member_role[]));
create policy "webhook_tokens_insert" on public.webhook_tokens for insert to authenticated
  with check (
    public.has_active_org_role(organization_id, array['treasurer']::public.member_role[])
    and created_by = (select auth.uid())
  );
create policy "webhook_tokens_update" on public.webhook_tokens for update to authenticated
  using (public.has_active_org_role(organization_id, array['treasurer']::public.member_role[]))
  with check (public.has_active_org_role(organization_id, array['treasurer']::public.member_role[]));

-- push_subscriptions: 본인 것만
create policy "push_subscriptions_all_own" on public.push_subscriptions for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- audit_logs: 총무·회장만 조회 (기록은 트리거로만)
create policy "audit_logs_select" on public.audit_logs for select to authenticated
  using (public.has_active_org_role(public.term_org_id(term_id), array['president', 'treasurer']::public.member_role[]));


-- ---------------------------------------------------------------------
-- 7. 함수 실행 권한
-- ---------------------------------------------------------------------

revoke execute on function public.create_organization(text, text, text, public.member_role) from public, anon;
revoke execute on function public.accept_invitation(text)                               from public, anon;
revoke execute on function public.start_new_term(uuid, text, public.member_role)         from public, anon;
grant  execute on function public.create_organization(text, text, text, public.member_role) to authenticated;
grant  execute on function public.accept_invitation(text)                               to authenticated;
grant  execute on function public.start_new_term(uuid, text, public.member_role)         to authenticated;

-- 트리거 전용 함수는 직접 호출할 수 없게
revoke execute on function public.handle_new_user()    from public, anon, authenticated;
revoke execute on function public.log_expense_change() from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 8. Storage: 영수증 이미지 버킷 (비공개)
--    경로 규칙: {organization_id}/{term_id}/{expense_id}/{파일명}
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do nothing;

create policy "receipts_bucket_select" on storage.objects for select to authenticated
  using (
    bucket_id = 'receipts'
    and public.is_org_member(public.try_uuid((storage.foldername(name))[1]))
  );

create policy "receipts_bucket_insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'receipts'
    and public.has_active_term_role(
      public.try_uuid((storage.foldername(name))[2]),
      array['treasurer', 'president', 'member']::public.member_role[]
    )
    and public.term_org_id(public.try_uuid((storage.foldername(name))[2])) = public.try_uuid((storage.foldername(name))[1])
  );

create policy "receipts_bucket_delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'receipts'
    and public.has_active_term_role(
      public.try_uuid((storage.foldername(name))[2]),
      array['president', 'treasurer']::public.member_role[]
    )
  );
