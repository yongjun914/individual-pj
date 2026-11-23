-- =====================================================================
-- 수입(입금) 기록
--
-- 학생회비, 학교 지원금, 협찬, 전기 이월금 등 들어온 돈을 기수별로 기록한다.
-- 감사 자료의 '수입 - 지출 = 잔액'을 만들기 위해 쓴다.
-- 권한: 소속 학생회는 조회, 활성 기수의 총무·회장만 등록·수정 (삭제는 deleted_at)
-- =====================================================================

create table public.incomes (
  id               uuid primary key default gen_random_uuid(),
  term_id          uuid not null references public.terms (id) on delete cascade,
  received_on      date not null,
  source           text not null check (char_length(source) between 1 and 50),   -- 수입 항목 (학생회비 등)
  payer            text not null default '' check (char_length(payer) <= 100),    -- 입금자
  amount           bigint not null check (amount > 0),
  payment_method   public.payment_method not null default 'transfer',
  memo             text not null default '' check (char_length(memo) <= 1000),
  payment_event_id uuid unique references public.payment_events (id) on delete set null,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);
create index incomes_term_received_idx on public.incomes (term_id, received_on);

create trigger incomes_set_updated_at before update on public.incomes
  for each row execute function public.set_updated_at();

-- 수입의 기수·작성자는 바꿀 수 없다
create or replace function public.protect_income_columns()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.term_id is distinct from old.term_id then
    raise exception '수입의 기수는 바꿀 수 없습니다.';
  end if;
  if new.created_by is distinct from old.created_by then
    raise exception '수입의 작성자는 바꿀 수 없습니다.';
  end if;
  return new;
end;
$$;

create trigger incomes_protect_columns before update on public.incomes
  for each row execute function public.protect_income_columns();


-- ---------------------------------------------------------------------
-- 변경 이력: audit_logs가 지출·수입을 함께 담도록 넓힌다
-- ---------------------------------------------------------------------

alter table public.audit_logs alter column expense_id drop not null;
alter table public.audit_logs add column income_id uuid references public.incomes (id) on delete cascade;
alter table public.audit_logs add constraint audit_logs_one_target check (num_nonnulls(expense_id, income_id) = 1);
create index audit_logs_income_id_idx on public.audit_logs (income_id, created_at desc);

create or replace function public.log_income_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.audit_logs (income_id, term_id, actor_id, action, old_data, new_data)
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

create trigger incomes_audit_log after insert or update on public.incomes
  for each row execute function public.log_income_change();

revoke execute on function public.log_income_change() from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------

alter table public.incomes enable row level security;

create policy "incomes_select" on public.incomes for select to authenticated
  using (public.is_org_member(public.term_org_id(term_id)));

create policy "incomes_insert" on public.incomes for insert to authenticated
  with check (
    public.has_active_term_role(term_id, array['treasurer', 'president']::public.member_role[])
    and created_by = (select auth.uid())
    and payment_event_id is null
  );

create policy "incomes_update" on public.incomes for update to authenticated
  using (public.has_active_term_role(term_id, array['treasurer', 'president']::public.member_role[]))
  with check (public.has_active_term_role(term_id, array['treasurer', 'president']::public.member_role[]));


-- ---------------------------------------------------------------------
-- 결제 문자: 은행 입금 알림으로 수입 자동 기록
-- ---------------------------------------------------------------------

alter type public.payment_event_kind add value if not exists 'deposit';

create or replace function public.ingest_payment_event(
  p_token       text,
  p_raw_text    text,
  p_kind        public.payment_event_kind,
  p_amount      bigint,
  p_merchant    text,
  p_approved_at timestamptz,
  p_parse_error text,
  p_dedupe_key  text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_token      public.webhook_tokens%rowtype;
  v_event_id   uuid;
  v_term_id    uuid;
  v_expense_id uuid;
  v_income_id  uuid;
  v_merchant   text := left(nullif(trim(coalesce(p_merchant, '')), ''), 100);
  v_spent_on   date := coalesce((p_approved_at at time zone 'Asia/Seoul')::date, (now() at time zone 'Asia/Seoul')::date);
begin
  if p_token is null or length(p_token) < 32 then
    return jsonb_build_object('result', 'invalid_token');
  end if;

  select * into v_token
  from public.webhook_tokens
  where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
    and revoked_at is null;

  if not found then
    return jsonb_build_object('result', 'invalid_token');
  end if;

  update public.webhook_tokens set last_used_at = now() where id = v_token.id;

  if p_raw_text is null or length(p_raw_text) = 0 or length(p_raw_text) > 2000
     or p_dedupe_key is null or length(p_dedupe_key) = 0 then
    return jsonb_build_object('result', 'bad_request');
  end if;
  if p_amount is not null and (p_amount <= 0 or p_amount > 100000000) then
    return jsonb_build_object('result', 'bad_request');
  end if;

  insert into public.payment_events (
    organization_id, raw_text, kind, amount, merchant, approved_at, parse_error, dedupe_key
  )
  values (
    v_token.organization_id, p_raw_text, p_kind, p_amount, v_merchant, p_approved_at, p_parse_error, p_dedupe_key
  )
  on conflict (organization_id, dedupe_key) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    return jsonb_build_object('result', 'duplicate');
  end if;

  if p_parse_error is not null or p_amount is null or p_kind = 'unknown' then
    return jsonb_build_object('result', 'unparsed', 'event_id', v_event_id);
  end if;

  select id into v_term_id
  from public.terms
  where organization_id = v_token.organization_id and is_active;

  if v_term_id is null then
    return jsonb_build_object('result', 'no_active_term', 'event_id', v_event_id);
  end if;

  -- 입금: 수입 기록 (항목은 '기타', 총무가 나중에 고친다)
  if p_kind = 'deposit' then
    insert into public.incomes (
      term_id, received_on, source, payer, amount, payment_method, payment_event_id, created_by
    )
    values (
      v_term_id, v_spent_on, '기타', coalesce(v_merchant, ''), p_amount, 'transfer', v_event_id, null
    )
    returning id into v_income_id;

    update public.payment_events
    set parsed = jsonb_build_object('income_id', v_income_id)
    where id = v_event_id;

    return jsonb_build_object('result', 'income_created', 'event_id', v_event_id, 'income_id', v_income_id);
  end if;

  if p_kind = 'approval' then
    insert into public.expenses (
      term_id, spent_on, merchant, amount, payment_method, status, payment_event_id, created_by
    )
    values (
      v_term_id, v_spent_on, coalesce(v_merchant, ''), p_amount, 'card', 'needs_receipt', v_event_id, null
    )
    returning id into v_expense_id;

    update public.payment_events
    set parsed = jsonb_build_object('expense_id', v_expense_id)
    where id = v_event_id;

    return jsonb_build_object('result', 'created', 'event_id', v_event_id, 'expense_id', v_expense_id);
  end if;

  -- 취소: 같은 금액·가맹점으로 문자에서 만들어진 최근 지출 중 가장 최근 것
  select e.id into v_expense_id
  from public.expenses e
  where e.term_id = v_term_id
    and e.payment_event_id is not null
    and e.deleted_at is null
    and e.status <> 'cancelled'
    and e.amount = p_amount
    and (v_merchant is null or e.merchant = v_merchant)
    and e.spent_on >= v_spent_on - 90
  order by e.spent_on desc, e.created_at desc
  limit 1
  for update;

  if v_expense_id is null then
    return jsonb_build_object('result', 'cancel_unmatched', 'event_id', v_event_id);
  end if;

  update public.expenses set status = 'cancelled' where id = v_expense_id;

  update public.payment_events
  set parsed = jsonb_build_object('cancelled_expense_id', v_expense_id)
  where id = v_event_id;

  return jsonb_build_object('result', 'cancelled', 'event_id', v_event_id, 'expense_id', v_expense_id);
end;
$$;
