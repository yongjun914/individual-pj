-- =====================================================================
-- 결제 문자 수신 (F-16 ~ F-18)
--
-- 웹훅(/api/payments)이 문자를 해석한 뒤 이 함수를 부른다. 한 트랜잭션에서
--   1) 웹훅 토큰 확인 (DB에는 해시만 있다)
--   2) 결제 이벤트 기록 (같은 문자는 dedupe_key로 한 번만)
--   3) 승인이면 '영수증 필요' 지출 생성, 취소면 짝이 되는 지출을 '취소'로
-- 를 처리한다.
--
-- 토큰을 모르는 사람은 아무것도 할 수 없으므로 anon에게도 실행을 허용한다.
-- (서버에 서비스 키를 두지 않으려고). 토큰은 32바이트 난수라 추측할 수 없다.
-- =====================================================================

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

  -- 해석 실패: 기록만 남기고 총무가 수신 기록에서 확인
  if p_parse_error is not null or p_amount is null or p_kind = 'unknown' then
    return jsonb_build_object('result', 'unparsed', 'event_id', v_event_id);
  end if;

  select id into v_term_id
  from public.terms
  where organization_id = v_token.organization_id and is_active;

  if v_term_id is null then
    return jsonb_build_object('result', 'no_active_term', 'event_id', v_event_id);
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

revoke execute on function public.ingest_payment_event(text, text, public.payment_event_kind, bigint, text, timestamptz, text, text) from public;
grant  execute on function public.ingest_payment_event(text, text, public.payment_event_kind, bigint, text, timestamptz, text, text) to anon, authenticated;
