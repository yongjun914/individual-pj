-- =====================================================================
-- 회원 탈퇴
--
-- 탈퇴하면 auth.users 행을 지운다. 그러면 외래 키 설정에 따라
--   - 프로필·멤버십·푸시 구독은 함께 지워지고 (cascade)
--   - 지출·수입·영수증·변경 이력의 작성자는 비워진다 (set null)
-- 학생회 회계 기록은 감사 때문에 남기고, 개인정보(이름·이메일·카카오 계정 연결)만 없앤다.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 작성자 보호 트리거: 탈퇴로 작성자가 비워지는 것은 허용
-- (탈퇴한 사용자는 auth.users에서 이미 지워진 상태)
-- ---------------------------------------------------------------------

create or replace function public.protect_expense_columns()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.term_id is distinct from old.term_id then
    raise exception '지출의 기수는 바꿀 수 없습니다.';
  end if;
  if new.created_by is distinct from old.created_by
     and not (new.created_by is null and not exists (select 1 from auth.users where id = old.created_by)) then
    raise exception '지출의 작성자는 바꿀 수 없습니다.';
  end if;
  return new;
end;
$$;

create or replace function public.protect_income_columns()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.term_id is distinct from old.term_id then
    raise exception '수입의 기수는 바꿀 수 없습니다.';
  end if;
  if new.created_by is distinct from old.created_by
     and not (new.created_by is null and not exists (select 1 from auth.users where id = old.created_by)) then
    raise exception '수입의 작성자는 바꿀 수 없습니다.';
  end if;
  return new;
end;
$$;


-- ---------------------------------------------------------------------
-- 변경 이력 트리거: 탈퇴 처리 중에는 작성자(auth.uid())가 이미 지워져 있으므로
-- 존재하는 사용자일 때만 actor_id를 남긴다.
-- ---------------------------------------------------------------------

create or replace function public.log_expense_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.audit_logs (expense_id, term_id, actor_id, action, old_data, new_data)
  values (
    new.id,
    new.term_id,
    (select u.id from auth.users u where u.id = (select auth.uid())),
    lower(tg_op),
    case when tg_op = 'UPDATE' then to_jsonb(old) end,
    to_jsonb(new)
  );
  return new;
end;
$$;

create or replace function public.log_income_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.audit_logs (income_id, term_id, actor_id, action, old_data, new_data)
  values (
    new.id,
    new.term_id,
    (select u.id from auth.users u where u.id = (select auth.uid())),
    lower(tg_op),
    case when tg_op = 'UPDATE' then to_jsonb(old) end,
    to_jsonb(new)
  );
  return new;
end;
$$;


-- ---------------------------------------------------------------------
-- 내 계정 탈퇴
-- 다른 멤버가 있는 활성 기수에서 내가 유일한 총무·회장이면 막는다
-- (그대로 지우면 그 학생회를 관리할 사람이 없어진다).
-- 반환값: 연결된 카카오 회원번호 (서버가 카카오 '연결 끊기'를 부를 때 쓴다). 없으면 null
-- ---------------------------------------------------------------------

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
    and m.role in ('treasurer', 'president')
    and not exists (
      select 1 from public.memberships other
      where other.term_id = m.term_id
        and other.user_id <> v_user_id
        and other.role in ('treasurer', 'president')
    )
    and exists (
      select 1 from public.memberships other
      where other.term_id = m.term_id
        and other.user_id <> v_user_id
    )
  limit 1;

  if v_blocking is not null then
    raise exception '%의 유일한 총무·회장이에요. 학생회 설정에서 다른 멤버에게 총무나 회장 역할을 넘긴 뒤 탈퇴해 주세요.', v_blocking
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

revoke execute on function public.delete_my_account() from public, anon;
grant  execute on function public.delete_my_account() to authenticated;


-- ---------------------------------------------------------------------
-- 카카오 '연결 해제' 웹훅용: 카카오 회원번호로 계정 삭제
-- 사용자가 카카오 쪽(카카오톡 설정 등)에서 이 앱과의 연결을 끊으면 카카오가 서버에 알려 준다.
-- 서비스 키(service_role)로만 부를 수 있다. 서버가 카카오의 요청인지 먼저 확인한다.
-- ---------------------------------------------------------------------

create or replace function public.delete_user_by_kakao_id(p_kakao_id text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  select user_id into v_user_id
  from auth.identities
  where provider = 'kakao' and provider_id = p_kakao_id
  limit 1;

  if v_user_id is null then
    return false;
  end if;

  delete from auth.users where id = v_user_id;
  return true;
end;
$$;

revoke execute on function public.delete_user_by_kakao_id(text) from public, anon, authenticated;
grant  execute on function public.delete_user_by_kakao_id(text) to service_role;
