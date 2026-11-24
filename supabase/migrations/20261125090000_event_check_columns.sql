-- 행사 명단의 체크 항목 추가 (납부·참석 말고도 '티셔츠 수령', '서약서 제출' 같은 칸)
--
-- events.check_columns: 행사마다 추가한 체크 항목 이름 (최대 10개)
-- event_participants.checks: 사람마다 그 항목의 체크 여부 {"티셔츠 수령": true}
-- 체크·항목 삭제는 아래 함수로 한다. 함수는 호출한 사람 권한(RLS)으로 실행돼서
-- 행사 관리 권한이 없으면 아무것도 바뀌지 않는다.

alter table public.events
  add column check_columns text[] not null default '{}'
    check (cardinality(check_columns) <= 10);

alter table public.event_participants
  add column checks jsonb not null default '{}'::jsonb
    check (jsonb_typeof(checks) = 'object');


-- 고른 사람들의 추가 항목을 한꺼번에 체크·해제. 바뀐 사람 수를 돌려준다.
create or replace function public.set_participants_check(
  p_event_id uuid,
  p_ids      uuid[],
  p_key      text,
  p_value    boolean
)
returns integer
language plpgsql security invoker set search_path = ''
as $$
declare
  v_count integer;
begin
  if not exists (select 1 from public.events e where e.id = p_event_id and p_key = any (e.check_columns)) then
    raise exception '없는 체크 항목이에요.';
  end if;

  update public.event_participants
  set checks = checks || jsonb_build_object(p_key, p_value)
  where event_id = p_event_id and id = any (p_ids);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- 항목 지우기: 항목 이름과 사람마다 저장된 체크 값을 함께 지운다.
create or replace function public.remove_check_column(p_event_id uuid, p_key text)
returns boolean
language plpgsql security invoker set search_path = ''
as $$
begin
  update public.events
  set check_columns = array_remove(check_columns, p_key)
  where id = p_event_id and p_key = any (check_columns);
  if not found then
    return false;
  end if;

  update public.event_participants
  set checks = checks - p_key
  where event_id = p_event_id and checks ? p_key;
  return true;
end;
$$;

revoke execute on function public.set_participants_check(uuid, uuid[], text, boolean) from public, anon;
revoke execute on function public.remove_check_column(uuid, text) from public, anon;
grant execute on function public.set_participants_check(uuid, uuid[], text, boolean) to authenticated;
grant execute on function public.remove_check_column(uuid, text) to authenticated;
