-- 학회비 납부자 명단 + 입금 문자로 행사 참가비 납부 자동 체크
--
-- 1. dues_payers: 연도별 학회비 납부자(이름+학번). 행사 명단에 같은 사람이 들어오면
--    '납부'로 체크하고 '학회비 면제'로 표시한다 (참가비를 따로 내지 않아도 된다).
-- 2. 통장 입금 문자로 수입이 기록되면, 입금자명·금액이 맞는 행사 참가자를 찾아
--    딱 한 명이면 자동으로 '납부' 체크한다. 애매하면 그대로 두고 행사 화면에서 직접 고른다.


-- ---------------------------------------------------------------------
-- 1. 참가자에 면제·입금 연결 칸
-- ---------------------------------------------------------------------

alter table public.event_participants
  add column dues_exempt    boolean not null default false,
  add column paid_income_id uuid references public.incomes (id) on delete set null;

-- 입금 한 건은 한 사람에게만 연결한다
create unique index event_participants_paid_income_id_key
  on public.event_participants (paid_income_id) where paid_income_id is not null;


-- ---------------------------------------------------------------------
-- 2. 학회비 납부자 명단
-- ---------------------------------------------------------------------

create table public.dues_payers (
  id         uuid primary key default gen_random_uuid(),
  term_id    uuid not null references public.terms (id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 1 and 30),
  student_no text not null check (student_no ~ '^[0-9]{2}$'),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (term_id, name, student_no)
);
create index dues_payers_term_id_idx on public.dues_payers (term_id);

alter table public.dues_payers enable row level security;

create policy "dues_payers_select" on public.dues_payers for select to authenticated
  using (public.is_org_member(public.term_org_id(term_id)));
create policy "dues_payers_insert" on public.dues_payers for insert to authenticated
  with check (public.has_term_permission(term_id, 'events'));
create policy "dues_payers_update" on public.dues_payers for update to authenticated
  using (public.has_term_permission(term_id, 'events'))
  with check (public.has_term_permission(term_id, 'events'));
create policy "dues_payers_delete" on public.dues_payers for delete to authenticated
  using (public.has_term_permission(term_id, 'events'));

-- 이름 비교용: 공백 제거
create or replace function public.compact_name(p text)
returns text
language sql immutable set search_path = ''
as $$
  select regexp_replace(coalesce(p, ''), '\s', '', 'g');
$$;

-- 참가자를 넣을 때: 학회비 납부자면 납부 + 면제
create or replace function public.apply_dues_exempt()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.dues_payers d
    join public.events e on e.term_id = d.term_id
    where e.id = new.event_id
      and public.compact_name(d.name) = public.compact_name(new.name)
      and d.student_no = new.student_no
  ) then
    new.dues_exempt := true;
    new.paid := true;
  end if;
  return new;
end;
$$;

create trigger event_participants_dues_exempt
  before insert on public.event_participants
  for each row execute function public.apply_dues_exempt();

-- 납부자를 나중에 추가하면: 이미 명단에 있는 (아직 안 낸) 사람도 납부 + 면제
create or replace function public.dues_payer_added()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.event_participants p
  set paid = true, dues_exempt = true
  from public.events e
  where e.id = p.event_id
    and e.term_id = new.term_id
    and not p.paid
    and public.compact_name(p.name) = public.compact_name(new.name)
    and p.student_no = new.student_no;
  return null;
end;
$$;

-- 납부자에서 빼면: 면제로 체크됐던 것만 되돌린다
create or replace function public.dues_payer_removed()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.event_participants p
  set paid = false, dues_exempt = false
  from public.events e
  where e.id = p.event_id
    and e.term_id = old.term_id
    and p.dues_exempt
    and public.compact_name(p.name) = public.compact_name(old.name)
    and p.student_no = old.student_no;
  return null;
end;
$$;

create trigger dues_payers_added
  after insert on public.dues_payers
  for each row execute function public.dues_payer_added();
create trigger dues_payers_removed
  after delete on public.dues_payers
  for each row execute function public.dues_payer_removed();


-- ---------------------------------------------------------------------
-- 3. 입금 → 참가비 납부 자동 체크
-- ---------------------------------------------------------------------

-- 이 참가자가 내야 할 금액 (과잠은 참가비 × 수량)
create or replace function public.participant_due(p_kind text, p_fee bigint, p_fields jsonb)
returns bigint
language sql immutable set search_path = ''
as $$
  select case
    when p_kind = 'jacket'
      then p_fee * greatest(coalesce(nullif(regexp_replace(coalesce(p_fields ->> '수량', ''), '\D', '', 'g'), '')::int, 1), 1)
    else p_fee
  end;
$$;

-- 입금 수입을 참가자에게 연결: 납부 체크 + 수입 항목을 '행사 별도 납입'으로
create or replace function public.link_deposit(p_income_id uuid, p_participant_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_event_name text;
begin
  update public.event_participants
  set paid = true, paid_income_id = p_income_id
  where id = p_participant_id;

  select e.name into v_event_name
  from public.events e
  join public.event_participants p on p.event_id = e.id
  where p.id = p_participant_id;

  update public.incomes
  set source = '행사 별도 납입',
      memo = left(v_event_name || ' 참가비', 1000)
  where id = p_income_id;
end;
$$;

-- 입금 문자로 만들어진 수입: 입금자명(학번이 붙어 있으면 학번도)과 금액이 맞는 사람이 딱 한 명이면 연결
create or replace function public.match_deposit_income()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_name   text := regexp_replace(coalesce(new.payer, ''), '[^가-힣A-Za-z]', '', 'g');
  v_digits text := substring(coalesce(new.payer, '') from '[0-9]{2,4}');
  v_no     text := case when v_digits is null then null else right(v_digits, 2) end;
  v_ids    uuid[];
begin
  if new.payment_event_id is null or new.payment_method <> 'transfer' or v_name = '' then
    return null;
  end if;

  select array_agg(p.id) into v_ids
  from public.event_participants p
  join public.events e on e.id = p.event_id
  where e.term_id = new.term_id
    and e.deleted_at is null
    and e.fee > 0
    and not p.paid
    and not p.dues_exempt
    and public.compact_name(p.name) = v_name
    and (v_no is null or p.student_no = v_no)
    and public.participant_due(e.kind::text, e.fee, p.fields) = new.amount;

  if cardinality(v_ids) = 1 then
    perform public.link_deposit(new.id, v_ids[1]);
  end if;
  return null;
end;
$$;

create trigger incomes_match_deposit
  after insert on public.incomes
  for each row execute function public.match_deposit_income();

-- 행사 화면 '입금 확인 필요': 이 행사 참가비와 금액이 같은데 아직 아무에게도 연결되지 않은 입금
create or replace function public.event_unmatched_deposits(p_event_id uuid)
returns table (income_id uuid, payer text, amount bigint, received_on date)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_event public.events;
begin
  select * into v_event from public.events where id = p_event_id and deleted_at is null;
  if v_event.id is null or not public.has_term_permission(v_event.term_id, 'events') then
    return;
  end if;

  return query
  select i.id, i.payer, i.amount, i.received_on
  from public.incomes i
  where i.term_id = v_event.term_id
    and i.deleted_at is null
    and i.payment_event_id is not null
    and i.payment_method = 'transfer'
    and i.source = '기타'
    and v_event.fee > 0
    and i.amount % v_event.fee = 0
    and i.amount <= v_event.fee * 20
    and not exists (select 1 from public.event_participants p where p.paid_income_id = i.id)
  order by i.received_on desc, i.created_at desc
  limit 50;
end;
$$;

-- 행사 화면에서 입금을 직접 연결
create or replace function public.assign_deposit(p_income_id uuid, p_participant_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_term_id uuid;
begin
  select e.term_id into v_term_id
  from public.event_participants p
  join public.events e on e.id = p.event_id
  where p.id = p_participant_id and e.deleted_at is null;

  if v_term_id is null or not public.has_term_permission(v_term_id, 'events') then
    raise exception '행사 관리 권한이 없어요.';
  end if;
  if not exists (
    select 1 from public.incomes i
    where i.id = p_income_id and i.term_id = v_term_id and i.deleted_at is null and i.payment_event_id is not null
  ) then
    raise exception '이 학생회의 입금 기록이 아니에요.';
  end if;
  if exists (select 1 from public.event_participants where paid_income_id = p_income_id) then
    raise exception '이미 다른 사람에게 연결된 입금이에요.';
  end if;

  perform public.link_deposit(p_income_id, p_participant_id);
end;
$$;

revoke execute on function public.apply_dues_exempt() from public, anon, authenticated;
revoke execute on function public.dues_payer_added() from public, anon, authenticated;
revoke execute on function public.dues_payer_removed() from public, anon, authenticated;
revoke execute on function public.match_deposit_income() from public, anon, authenticated;
revoke execute on function public.link_deposit(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.event_unmatched_deposits(uuid) from public, anon;
revoke execute on function public.assign_deposit(uuid, uuid) from public, anon;
grant execute on function public.event_unmatched_deposits(uuid) to authenticated;
grant execute on function public.assign_deposit(uuid, uuid) to authenticated;
