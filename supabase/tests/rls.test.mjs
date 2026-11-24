// supabase/migrations의 SQL을 PGlite(메모리 Postgres)에 순서대로 적용하고 RLS 시나리오를 검증한다.
// 실행: npm run test:db
// Supabase 전용 객체(auth, storage, 역할)는 최소한으로 흉내 낸다.
import { PGlite } from "@electric-sql/pglite";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const migrationsDir = join(import.meta.dirname, "..", "migrations");
const db = new PGlite();

const A = "00000000-0000-0000-0000-00000000000a"; // 학회장 (학생회 생성자)
const B = "00000000-0000-0000-0000-00000000000b"; // 집행부원 (초대로 합류)
const C = "00000000-0000-0000-0000-00000000000c"; // 외부인

await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, raw_user_meta_data jsonb default '{}');
  create table auth.identities (user_id uuid references auth.users (id) on delete cascade,
    provider text, provider_id text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean,
    file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(),
    bucket_id text, name text);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as $$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
`);

for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
  await db.exec(readFileSync(join(migrationsDir, file), "utf8"));
}

// Supabase 기본 권한과 비슷하게
await db.exec(`
  grant usage on schema public, auth, storage to anon, authenticated, service_role;
  grant all on all tables in schema public to authenticated, service_role;
  grant all on all sequences in schema public to authenticated, service_role;
  grant all on storage.objects to authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  insert into auth.users (id, raw_user_meta_data) values
    ('${A}', '{"full_name":"김총무"}'), ('${B}', '{"name":"이부원"}'), ('${C}', '{}');
`);

let failures = 0;
const results = [];
function check(name, ok, detail = "") {
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

// 특정 사용자로 쿼리 실행 (트랜잭션 안에서 역할·JWT 설정)
async function as(user, sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role authenticated;`);
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user]);
    return tx.query(sql, params);
  });
}
async function expectError(name, fn, pattern) {
  try {
    await fn();
    check(name, false, "에러가 나야 하는데 성공함");
  } catch (e) {
    const ok = pattern ? pattern.test(e.message) : true;
    check(name, ok, e.message.slice(0, 80));
  }
}

// --- 프로필 자동 생성
const profiles = await db.query(`select display_name from public.profiles order by id`);
check("회원가입 시 프로필 생성", profiles.rows.length === 3 && profiles.rows[0].display_name === "김총무");

// --- 학생회 생성
const orgId = (await as(A, `select public.create_organization('천안대', '컴퓨터공학과 학생회', '2026년 제38대') as id`)).rows[0].id;
check("A가 학생회 생성", !!orgId);
const term1 = (await as(A, `select id from public.terms where organization_id = $1`, [orgId])).rows[0].id;
const cats = await as(A, `select count(*)::int as n from public.categories where term_id = $1`, [term1]);
check("기본 카테고리 5개 생성", cats.rows[0].n === 5);
check("외부인 C는 학생회를 못 봄", (await as(C, `select * from public.organizations`)).rows.length === 0);
await expectError("집행부원 역할로는 학생회 생성 불가",
  () => as(C, `select public.create_organization('a', 'b', 'c', 'member')`), /학회장·부학회장/);
await expectError("비로그인은 학생회 생성 불가", () => db.transaction(async (tx) => {
  await tx.exec(`set local role anon;`);
  return tx.query(`select public.create_organization('a', 'b', 'c')`);
}));
await expectError("organizations 직접 insert 불가",
  () => as(C, `insert into public.organizations (school_name, name) values ('x', 'y')`));

// --- 초대
const token = (await as(A, `insert into public.invitations (term_id, role, created_by) values ($1, 'member', $2) returning token`, [term1, A])).rows[0].token;
check("초대 토큰 64자", token.length === 64);
check("집행부원 전 B는 초대 목록 못 봄", (await as(B, `select * from public.invitations`)).rows.length === 0);
await as(B, `select public.accept_invitation($1)`, [token]);
check("B가 초대 수락 후 학생회 조회", (await as(B, `select * from public.organizations`)).rows.length === 1);
// 기본으로는 모든 기능 권한이 있다. 아래 "부원은 못 한다" 확인을 위해 관리자(A)가 B의 기능 권한을 모두 해제한다.
await as(A, `update public.memberships set revoked_permissions = array['expenses_all','incomes','audit','events','payments','settings'] where term_id = $1 and user_id = $2`, [term1, B]);
check("관리자는 부원의 기능 권한을 해제", (await as(A, `select cardinality(revoked_permissions) as n from public.memberships where term_id = $1 and user_id = $2`, [term1, B])).rows[0].n === 6);
check("부원은 자기 권한을 되돌릴 수 없음", (await as(B, `update public.memberships set revoked_permissions = '{}' where term_id = $1 and user_id = $2 returning id`, [term1, B])).rows.length === 0);
check("B도 초대 목록은 못 봄(집행부원)", (await as(B, `select * from public.invitations`)).rows.length === 0);
await expectError("잘못된 토큰 거부", () => as(C, `select public.accept_invitation('nope')`), /만료/);
check("같은 학생회 프로필 조회(B→A)", (await as(B, `select * from public.profiles where id = $1`, [A])).rows.length === 1);
check("외부인 프로필은 못 봄(C→A)", (await as(C, `select * from public.profiles where id = $1`, [A])).rows.length === 0);

// --- 초대 미리보기
const preview = await as(C, `select * from public.get_invitation_preview($1)`, [token]);
check("외부인도 토큰으로 초대 미리보기", preview.rows.length === 1 && preview.rows[0].organization_name === "컴퓨터공학과 학생회" && preview.rows[0].already_member === false);
check("이미 멤버면 already_member", (await as(B, `select already_member from public.get_invitation_preview($1)`, [token])).rows[0]?.already_member === true);
check("잘못된 토큰 미리보기는 빈 결과", (await as(C, `select * from public.get_invitation_preview('nope')`)).rows.length === 0);
await expectError("비로그인은 미리보기 불가", () => db.transaction(async (tx) => {
  await tx.exec(`set local role anon;`);
  return tx.query(`select * from public.get_invitation_preview('nope')`);
}), /permission denied/);

// --- 카테고리 권한
await expectError("집행부원은 카테고리 추가 불가",
  () => as(B, `insert into public.categories (term_id, name) values ($1, '축제')`, [term1]), /row-level security/);
await as(A, `insert into public.categories (term_id, name) values ($1, '축제')`, [term1]);
check("총무는 카테고리 추가", true);
await expectError("같은 이름 카테고리 거부",
  () => as(A, `insert into public.categories (term_id, name) values ($1, '축제')`, [term1]), /duplicate|unique/);
check("집행부원은 카테고리 이름 변경 불가",
  (await as(B, `update public.categories set name = 'x' where term_id = $1 and name = '축제' returning id`, [term1])).rows.length === 0);
check("집행부원은 카테고리 삭제 불가",
  (await as(B, `delete from public.categories where term_id = $1 and name = '축제' returning id`, [term1])).rows.length === 0);
check("집행부원은 학생회 정보 수정 불가",
  (await as(B, `update public.organizations set name = 'x' where id = $1 returning id`, [orgId])).rows.length === 0);
check("총무는 학생회 정보 수정",
  (await as(A, `update public.organizations set name = '컴퓨터공학과 학생회' where id = $1 returning id`, [orgId])).rows.length === 1);
const tmpCat = (await as(A, `insert into public.categories (term_id, name) values ($1, '임시') returning id`, [term1])).rows[0].id;
check("총무는 카테고리 삭제", (await as(A, `delete from public.categories where id = $1 returning id`, [tmpCat])).rows.length === 1);
const tmpInv = (await as(A, `insert into public.invitations (term_id, created_by) values ($1, $2) returning id`, [term1, A])).rows[0].id;
check("집행부원은 초대 폐기 불가",
  (await as(B, `update public.invitations set revoked_at = now() where id = $1 returning id`, [tmpInv])).rows.length === 0);
check("총무는 초대 폐기",
  (await as(A, `update public.invitations set revoked_at = now() where id = $1 returning id`, [tmpInv])).rows.length === 1);

// --- 지출
const expA = (await as(A, `insert into public.expenses (term_id, spent_on, merchant, amount, created_by) values ($1, '2026-11-20', '○○마트', 152000, $2) returning id`, [term1, A])).rows[0].id;
const expB = (await as(B, `insert into public.expenses (term_id, spent_on, merchant, amount, created_by) values ($1, '2026-11-21', '△△식당', 52000, $2) returning id`, [term1, B])).rows[0].id;
check("A·B 지출 등록", !!expA && !!expB);
await expectError("남의 이름으로 지출 등록 불가",
  () => as(B, `insert into public.expenses (term_id, spent_on, amount, created_by) values ($1, '2026-11-21', 1000, $2)`, [term1, A]), /row-level security/);
await expectError("외부인 지출 등록 불가",
  () => as(C, `insert into public.expenses (term_id, spent_on, amount, created_by) values ($1, '2026-11-21', 1000, $2)`, [term1, C]), /row-level security/);
await expectError("음수 금액 거부",
  () => as(A, `insert into public.expenses (term_id, spent_on, amount, created_by) values ($1, '2026-11-21', -1, $2)`, [term1, A]), /check/);
check("B는 본인 지출 수정", (await as(B, `update public.expenses set memo = '회식' where id = $1 returning id`, [expB])).rows.length === 1);
check("B는 A의 지출 수정 불가", (await as(B, `update public.expenses set memo = 'x' where id = $1 returning id`, [expA])).rows.length === 0);
check("A(총무)는 B의 지출 수정", (await as(A, `update public.expenses set memo = '확인' where id = $1 returning id`, [expB])).rows.length === 1);
check("물리 삭제는 막힘", (await as(A, `delete from public.expenses where id = $1 returning id`, [expA])).rows.length === 0);
await expectError("사유서 없이 excused 불가",
  () => as(A, `update public.expenses set status = 'excused' where id = $1`, [expA]), /check/);
await expectError("작성자 변경 불가",
  () => as(A, `update public.expenses set created_by = $2 where id = $1`, [expB, A]), /작성자/);
check("외부인은 지출 못 봄", (await as(C, `select * from public.expenses`)).rows.length === 0);

// --- 변경 이력
const logs = await as(A, `select action from public.audit_logs where expense_id = $1 order by id`, [expB]);
check("변경 이력 기록(등록 1회 + 수정 2회)", logs.rows.map((r) => r.action).join(",") === "insert,update,update");
check("집행부원은 이력 못 봄", (await as(B, `select * from public.audit_logs`)).rows.length === 0);
await expectError("이력 직접 기록 불가",
  () => as(A, `insert into public.audit_logs (expense_id, term_id, action) values ($1, $2, 'insert')`, [expA, term1]), /row-level security/);

// --- 영수증 분실 사유서 (F-11)
check("총무는 사유서 작성(excused)",
  (await as(A, `update public.expenses set status = 'excused', missing_reason = '행사 중 영수증 분실' where id = $1 returning id`, [expA])).rows.length === 1);
check("집행부원은 남의 지출 사유서 취소 불가",
  (await as(B, `update public.expenses set status = 'needs_receipt', missing_reason = null where id = $1 returning id`, [expA])).rows.length === 0);
await expectError("사유서 상태에서 사유만 지우기 불가",
  () => as(A, `update public.expenses set missing_reason = null where id = $1`, [expA]), /check/);
check("영수증을 붙이면 사유서에서 완료로",
  (await as(A, `update public.expenses set status = 'complete', missing_reason = null where id = $1 and status in ('needs_receipt', 'excused') returning id`, [expA])).rows.length === 1);
check("사유서 취소하면 영수증 필요로",
  (await as(A, `update public.expenses set status = 'needs_receipt' where id = $1 returning id`, [expA])).rows.length === 1);
check("집행부원은 본인 지출 사유서 작성",
  (await as(B, `update public.expenses set status = 'excused', missing_reason = '분실했습니다 (본인)' where id = $1 returning id`, [expB])).rows.length === 1);
await as(B, `update public.expenses set status = 'needs_receipt', missing_reason = null where id = $1`, [expB]);

// --- 영수증
await as(B, `insert into public.receipts (expense_id, storage_path, created_by) values ($1, 'p/1.jpg', $2)`, [expB, B]);
check("B는 본인 지출에 영수증 추가", true);
await expectError("B는 남의 지출에 영수증 추가 불가",
  () => as(B, `insert into public.receipts (expense_id, storage_path, created_by) values ($1, 'p/2.jpg', $2)`, [expA, B]), /row-level security/);

// --- 결제 문자(서비스 키로만 기록)
await expectError("일반 사용자는 결제 이벤트 기록 불가",
  () => as(A, `insert into public.payment_events (organization_id, raw_text, dedupe_key) values ($1, 'x', 'k')`, [orgId]), /row-level security/);
await db.query(`insert into public.payment_events (organization_id, raw_text, dedupe_key, amount) values ($1, '[카드] 승인 10,000원', 'k1', 10000)`, [orgId]);
await expectError("같은 결제 중복 수신 거부",
  () => db.query(`insert into public.payment_events (organization_id, raw_text, dedupe_key) values ($1, 'x', 'k1')`, [orgId]), /duplicate/);
check("총무는 결제 이벤트 조회", (await as(A, `select * from public.payment_events`)).rows.length === 1);
check("집행부원은 결제 이벤트 못 봄", (await as(B, `select * from public.payment_events`)).rows.length === 0);

// --- 웹훅 토큰
await as(A, `insert into public.webhook_tokens (organization_id, token_hash, created_by) values ($1, 'hash1', $2)`, [orgId, A]);
check("총무는 웹훅 토큰 발급", true);
await expectError("집행부원은 웹훅 토큰 발급 불가",
  () => as(B, `insert into public.webhook_tokens (organization_id, token_hash, created_by) values ($1, 'hash2', $2)`, [orgId, B]), /row-level security/);

// --- 푸시 구독
await as(B, `insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://push/b', 'k', 'a')`, [B]);
check("A는 B의 푸시 구독 못 봄", (await as(A, `select * from public.push_subscriptions`)).rows.length === 0);

// --- 스토리지
const goodPath = `${orgId}/${term1}/${expB}/r.jpg`;
await as(B, `insert into storage.objects (bucket_id, name) values ('receipts', $1)`, [goodPath]);
check("멤버는 자기 학생회 경로에 업로드", true);
await expectError("다른 학생회 경로 업로드 불가",
  () => as(C, `insert into storage.objects (bucket_id, name) values ('receipts', $1)`, [goodPath]), /row-level security/);
await expectError("형식이 틀린 경로 업로드 불가(에러 없이 거부)",
  () => as(B, `insert into storage.objects (bucket_id, name) values ('receipts', 'abc/def/x.jpg')`), /row-level security/);
check("외부인은 영수증 파일 못 봄", (await as(C, `select * from storage.objects`)).rows.length === 0);
check("멤버는 영수증 파일 조회", (await as(B, `select * from storage.objects`)).rows.length === 1);
const pathA = `${orgId}/${term1}/${expA}/a.jpg`;
await as(A, `insert into storage.objects (bucket_id, name) values ('receipts', $1)`, [pathA]);
check("집행부원은 남의 지출 영수증 파일 삭제 불가",
  (await as(B, `delete from storage.objects where name = $1 returning id`, [pathA])).rows.length === 0);
check("외부인은 영수증 파일 삭제 불가",
  (await as(C, `delete from storage.objects where name = $1 returning id`, [goodPath])).rows.length === 0);
check("집행부원은 본인 지출 영수증 파일 삭제",
  (await as(B, `delete from storage.objects where name = $1 returning id`, [goodPath])).rows.length === 1);
check("총무는 남의 지출 영수증 파일도 삭제",
  (await as(A, `delete from storage.objects where name = $1 returning id`, [pathA])).rows.length === 1);
check("B는 본인 지출 영수증 기록 삭제",
  (await as(B, `delete from public.receipts where expense_id = $1 returning id`, [expB])).rows.length === 1);
check("B는 본인 지출 삭제(소프트)",
  (await as(B, `update public.expenses set deleted_at = now() where id = $1 returning id`, [expB])).rows.length === 1);
await as(B, `update public.expenses set deleted_at = null where id = $1`, [expB]);

// --- 멤버 관리
await expectError("자기 자신 내보내기 불가(조용히 0건)", async () => {
  const r = await as(A, `delete from public.memberships where user_id = $1 returning id`, [A]);
  if (r.rows.length === 0) throw new Error("0 rows");
});
await expectError("집행부원이 자기 역할을 총무로 올리기 불가", async () => {
  const r = await as(B, `update public.memberships set role = 'treasurer' where user_id = $1 returning id`, [B]);
  if (r.rows.length === 0) throw new Error("0 rows");
});

// --- 기수 전환
await expectError("집행부원은 기수 전환 불가",
  () => as(B, `select public.start_new_term($1, '2027년 제39대')`, [orgId]), /학회장·부학회장만/);
const term2 = (await as(A, `select public.start_new_term($1, '2027년 제39대', 'president') as id`, [orgId])).rows[0].id;
const terms = await as(A, `select id, is_active from public.terms where organization_id = $1`, [orgId]);
check("새 기수 활성, 이전 기수 비활성", terms.rows.filter((t) => t.is_active).length === 1 && terms.rows.find((t) => t.id === term1).is_active === false);
check("카테고리가 새 기수로 복사(6개)", (await as(A, `select count(*)::int as n from public.categories where term_id = $1`, [term2])).rows[0].n === 6);
check("지난 기수 지출 수정 불가(총무도)", (await as(A, `update public.expenses set memo = 'z' where id = $1 returning id`, [expA])).rows.length === 0);
await expectError("지난 기수에 지출 등록 불가",
  () => as(A, `insert into public.expenses (term_id, spent_on, amount, created_by) values ($1, '2026-12-01', 1000, $2)`, [term1, A]), /row-level security/);
check("B는 지난 기수 지출을 여전히 조회", (await as(B, `select * from public.expenses`)).rows.length === 2);
check("지난 기수 초대는 미리보기도 빈 결과", (await as(C, `select * from public.get_invitation_preview($1)`, [token])).rows.length === 0);
await expectError("지난 기수 초대 링크 사용 불가",
  () => as(C, `select public.accept_invitation($1)`, [token]), /끝난 기수/);
await expectError("한 학생회에 활성 기수 2개 불가",
  () => as(A, `update public.terms set is_active = true where id = $1`, [term1]), /duplicate|unique/);

// --- 결제 문자 수신 (ingest_payment_event). 이 시점의 활성 기수는 term2
const rawToken = "t".repeat(43);
const tokenHash = createHash("sha256").update(rawToken, "utf8").digest("hex");
const tokenId = (await as(A, `insert into public.webhook_tokens (organization_id, token_hash, label, created_by) values ($1, $2, '총무 아이폰', $3) returning id`, [orgId, tokenHash, A])).rows[0].id;

async function ingest(params) {
  const p = { token: rawToken, raw: "문자", kind: "approval", amount: 12500, merchant: "스타벅스", at: "2026-11-23T14:05:00+09:00", error: null, key: "d1", ...params };
  return db.transaction(async (tx) => {
    await tx.exec(`set local role anon;`);
    const r = await tx.query(
      `select public.ingest_payment_event($1, $2, $3, $4, $5, $6, $7, $8) as r`,
      [p.token, p.raw, p.kind, p.amount, p.merchant, p.at, p.error, p.key],
    );
    return r.rows[0].r;
  });
}

check("잘못된 토큰은 거부", (await ingest({ token: "x".repeat(43) })).result === "invalid_token");
const created = await ingest({});
check("승인 문자로 지출 자동 생성", created.result === "created" && !!created.expense_id);
const auto = (await as(A, `select term_id, spent_on::text, merchant, amount, status, payment_method, created_by, payment_event_id from public.expenses where id = $1`, [created.expense_id])).rows[0];
check("자동 지출은 현재 기수·영수증 필요·카드",
  auto.term_id === term2 && auto.status === "needs_receipt" && auto.payment_method === "card" && auto.created_by === null && Number(auto.amount) === 12500);
check("자동 지출 날짜는 승인 날짜(한국 시간)", auto.spent_on === "2026-11-23");
check("B(지난 기수 멤버)도 자동 지출 조회", (await as(B, `select id from public.expenses where id = $1`, [created.expense_id])).rows.length === 1);
check("같은 문자 다시 받으면 중복", (await ingest({})).result === "duplicate");
check("중복이면 지출이 더 생기지 않음",
  (await as(A, `select count(*)::int as n from public.expenses where payment_event_id is not null`)).rows[0].n === 1);
check("토큰 사용 시각 기록", (await as(A, `select last_used_at from public.webhook_tokens where id = $1`, [tokenId])).rows[0].last_used_at !== null);

const unparsed = await ingest({ key: "d2", kind: "unknown", amount: null, merchant: null, at: null, error: "금액을 찾지 못했어요." });
check("해석 실패 문자는 기록만", unparsed.result === "unparsed" && !!unparsed.event_id);
check("해석 실패 기록은 총무가 조회",
  (await as(A, `select parse_error from public.payment_events where id = $1`, [unparsed.event_id])).rows[0]?.parse_error === "금액을 찾지 못했어요.");

check("금액 범위 밖은 거부", (await ingest({ key: "d3", amount: 0 })).result === "bad_request");
check("짝 없는 취소", (await ingest({ key: "d4", kind: "cancel", amount: 99999 })).result === "cancel_unmatched");
const cancelled = await ingest({ key: "d5", kind: "cancel", at: "2026-11-23T14:30:00+09:00" });
check("취소 문자로 원래 지출을 취소", cancelled.result === "cancelled" && cancelled.expense_id === created.expense_id);
check("취소된 지출 상태",
  (await as(A, `select status from public.expenses where id = $1`, [created.expense_id])).rows[0].status === "cancelled");
check("이미 취소된 지출은 다시 취소 안 됨", (await ingest({ key: "d6", kind: "cancel" })).result === "cancel_unmatched");
const autoLog = await as(A, `select actor_id from public.audit_logs where expense_id = $1 and action = 'insert'`, [created.expense_id]);
check("자동 지출도 변경 이력 기록(작성자 없음)", autoLog.rows.length === 1 && autoLog.rows[0].actor_id === null);

await as(A, `update public.webhook_tokens set revoked_at = now() where id = $1`, [tokenId]);
check("폐기한 토큰은 거부", (await ingest({ key: "d7" })).result === "invalid_token");
await expectError("익명은 결제 이벤트 직접 기록 불가", () => db.transaction(async (tx) => {
  await tx.exec(`set local role anon;`);
  return tx.query(`insert into public.payment_events (organization_id, raw_text, dedupe_key) values ($1, 'x', 'k9')`, [orgId]);
}));

// --- 수입 (이 시점의 활성 기수는 term2, B는 아직 term2 멤버가 아님)
const incA = (await as(A, `insert into public.incomes (term_id, received_on, source, payer, amount, created_by) values ($1, '2026-12-01', '학생회비', '홍길동', 300000, $2) returning id`, [term2, A])).rows[0].id;
check("총무는 수입 등록", !!incA);
await expectError("남의 이름으로 수입 등록 불가",
  () => as(A, `insert into public.incomes (term_id, received_on, source, amount, created_by) values ($1, '2026-12-01', '기타', 1000, $2)`, [term2, B]), /row-level security/);
await expectError("지난 기수에 수입 등록 불가",
  () => as(A, `insert into public.incomes (term_id, received_on, source, amount, created_by) values ($1, '2026-11-01', '기타', 1000, $2)`, [term1, A]), /row-level security/);
await expectError("0원 수입 거부",
  () => as(A, `insert into public.incomes (term_id, received_on, source, amount, created_by) values ($1, '2026-12-01', '기타', 0, $2)`, [term2, A]), /check/);
await expectError("외부인 수입 등록 불가",
  () => as(C, `insert into public.incomes (term_id, received_on, source, amount, created_by) values ($1, '2026-12-01', '기타', 1000, $2)`, [term2, C]), /row-level security/);
check("B(지난 기수 멤버)는 수입 조회", (await as(B, `select id from public.incomes where id = $1`, [incA])).rows.length === 1);
check("외부인은 수입 못 봄", (await as(C, `select id from public.incomes`)).rows.length === 0);
check("B는 수입 수정 불가", (await as(B, `update public.incomes set amount = 1 where id = $1 returning id`, [incA])).rows.length === 0);
check("총무는 수입 수정", (await as(A, `update public.incomes set amount = 310000 where id = $1 returning id`, [incA])).rows.length === 1);
check("물리 삭제는 막힘(수입)", (await as(A, `delete from public.incomes where id = $1 returning id`, [incA])).rows.length === 0);
check("총무는 수입 삭제(소프트)", (await as(A, `update public.incomes set deleted_at = now() where id = $1 returning id`, [incA])).rows.length === 1);
await expectError("수입 작성자 변경 불가",
  () => as(A, `update public.incomes set created_by = $2 where id = $1`, [incA, B]), /작성자/);
const incLogs = await as(A, `select action from public.audit_logs where income_id = $1 order by id`, [incA]);
check("수입 변경 이력 기록(등록 + 수정 2회)", incLogs.rows.map((r) => r.action).join(",") === "insert,update,update");
await expectError("이력은 지출·수입 중 하나만",
  () => db.query(`insert into public.audit_logs (term_id, action) values ($1, 'insert')`, [term2]), /audit_logs_one_target/);

// 결제 문자: 은행 입금 알림 → 수입
const tokenRaw2 = "u".repeat(43);
await as(A, `insert into public.webhook_tokens (organization_id, token_hash, created_by) values ($1, $2, $3)`,
  [orgId, createHash("sha256").update(tokenRaw2, "utf8").digest("hex"), A]);
const dep = await db.transaction(async (tx) => {
  await tx.exec(`set local role anon;`);
  return (await tx.query(`select public.ingest_payment_event($1, '입금 문자', 'deposit', 50000, '김학생', '2026-12-02T10:00:00+09:00', null, 'dep1') as r`, [tokenRaw2])).rows[0].r;
});
check("입금 문자로 수입 자동 기록", dep.result === "income_created" && !!dep.income_id);
const autoInc = (await as(A, `select term_id, source, payer, amount, created_by, received_on::text from public.incomes where id = $1`, [dep.income_id])).rows[0];
check("자동 수입: 현재 기수·기타·입금자", autoInc.term_id === term2 && autoInc.source === "기타" && autoInc.payer === "김학생" && Number(autoInc.amount) === 50000 && autoInc.created_by === null && autoInc.received_on === "2026-12-02");

// --- 기수 전환 후 멤버 옮기기 (설정 화면)
await expectError("집행부원은 새 기수에 자기를 넣을 수 없음",
  () => as(B, `insert into public.memberships (term_id, user_id, role) values ($1, $2, 'member')`, [term2, B]), /row-level security/);
await as(A, `insert into public.memberships (term_id, user_id, role) values ($1, $2, 'member')`, [term2, B]);
check("총무는 지난 기수 멤버를 새 기수로 옮김",
  (await as(B, `select public.has_active_term_role($1, array['member']::public.member_role[]) as ok`, [term2])).rows[0].ok === true);
check("옮겨진 멤버는 새 기수에 지출 등록",
  (await as(B, `insert into public.expenses (term_id, spent_on, amount, created_by) values ($1, '2026-12-02', 1000, $2) returning id`, [term2, B])).rows.length === 1);
const bTerm2 = (await as(A, `select id from public.memberships where term_id = $1 and user_id = $2`, [term2, B])).rows[0].id;
check("총무는 멤버 역할 변경",
  (await as(A, `update public.memberships set role = 'president' where id = $1 returning id`, [bTerm2])).rows.length === 1);
check("총무는 멤버 내보내기",
  (await as(A, `delete from public.memberships where id = $1 returning id`, [bTerm2])).rows.length === 1);

// --- 기능 권한 (기본 허용 + 관리자가 해제) · 부학회장 · 행사 명단
await as(A, `insert into public.memberships (term_id, user_id, role, position) values ($1, $2, 'officer', '기획부 부장')`, [term2, B]);
check("임원은 기본으로 행사 분류 추가 가능",
  (await as(B, `insert into public.categories (term_id, name) values ($1, '개강총회') returning id`, [term2])).rows.length === 1);
check("임원은 기본으로 수입 등록 가능",
  (await as(B, `insert into public.incomes (term_id, received_on, source, amount, created_by) values ($1, '2026-12-05', '학회비', 1000, $2) returning id`, [term2, B])).rows.length === 1);
const ev = (await as(B, `insert into public.events (term_id, kind, name, fee, created_by) values ($1, 'opening', '2026 개강총회', 15000, $2) returning id`, [term2, B])).rows[0].id;
check("임원은 기본으로 행사 만들기 가능", !!ev);
check("임원은 참가자 추가 가능",
  (await as(B, `insert into public.event_participants (event_id, name, student_no, grade) values ($1, '홍길동', '24', 1) returning id`, [ev])).rows.length === 1);
await expectError("학번은 2자리만", () => as(B, `insert into public.event_participants (event_id, name, student_no) values ($1, '김학생', '2024')`, [ev]), /check/);
await expectError("이름은 필수", () => as(B, `insert into public.event_participants (event_id, name, student_no) values ($1, '  ', '24')`, [ev]), /check/);
check("학년은 없어도 됨",
  (await as(B, `insert into public.event_participants (event_id, name, student_no) values ($1, '이학생', '23') returning id`, [ev])).rows.length === 1);
check("외부인은 행사·명단 못 봄",
  (await as(C, `select (select count(*) from public.events)::int + (select count(*) from public.event_participants)::int as n`)).rows[0].n === 0);
check("임원도 학생회원 관리(역할 변경)는 불가",
  (await as(B, `update public.memberships set role = 'president' where term_id = $1 and user_id = $2 returning id`, [term2, B])).rows.length === 0);
check("임원은 초대 링크 못 봄", (await as(B, `select * from public.invitations where term_id = $1`, [term2])).rows.length === 0);

await as(A, `update public.memberships set revoked_permissions = array['events'] where term_id = $1 and user_id = $2`, [term2, B]);
await expectError("행사 권한을 해제하면 참가자 추가 불가",
  () => as(B, `insert into public.event_participants (event_id, name, student_no) values ($1, '박학생', '22')`, [ev]), /row-level security/);
check("행사 권한을 해제하면 명단 수정 불가",
  (await as(B, `update public.event_participants set paid = true where event_id = $1 returning id`, [ev])).rows.length === 0);
check("해제하지 않은 권한(수입)은 그대로",
  (await as(B, `insert into public.incomes (term_id, received_on, source, amount, created_by) values ($1, '2026-12-05', '기타', 500, $2) returning id`, [term2, B])).rows.length === 1);
check("권한이 없어도 명단은 볼 수 있음", (await as(B, `select id from public.event_participants where event_id = $1`, [ev])).rows.length === 2);

await as(A, `insert into public.memberships (term_id, user_id, role) values ($1, $2, 'vice_president')`, [term2, C]);
check("부학회장은 학생회원 관리 가능(권한 되돌리기)",
  (await as(C, `update public.memberships set revoked_permissions = '{}' where term_id = $1 and user_id = $2 returning id`, [term2, B])).rows.length === 1);
check("부학회장은 초대 링크 만들기 가능",
  (await as(C, `insert into public.invitations (term_id, role, created_by) values ($1, 'officer', $2) returning id`, [term2, C])).rows.length === 1);
check("부학회장은 해제 목록이 있어도 모든 기능 사용",
  (await as(A, `update public.memberships set revoked_permissions = array['events'] where term_id = $1 and user_id = $2 returning id`, [term2, C])).rows.length === 1
  && (await as(C, `insert into public.event_participants (event_id, name, student_no) values ($1, '최학생', '22') returning id`, [ev])).rows.length === 1);
await expectError("부원으로는 기수 전환 불가(역할 확인)",
  () => as(A, `select public.start_new_term($1, 'x', 'member')`, [orgId]), /학회장·부학회장/);

// 정리: 다음 회원 탈퇴 시나리오를 위해 term2에서 B·C를 내보낸다
await as(A, `delete from public.memberships where term_id = $1 and user_id in ($2, $3)`, [term2, B, C]);

// --- 학생회원 관리는 학회장·부학회장만 · 직책 변경 요청과 승인
const D0 = "00000000-0000-0000-0000-0000000000ee"; // 어느 학생회에도 없는 사용자
await as(A, `insert into public.memberships (term_id, user_id, role) values ($1, $2, 'officer'), ($1, $3, 'treasurer')`, [term2, B, C]);
check("총무는 모든 기능 사용(수입 등록)",
  (await as(C, `insert into public.incomes (term_id, received_on, source, amount, created_by) values ($1, '2026-12-06', '기타', 100, $2) returning id`, [term2, C])).rows.length === 1);
check("총무는 멤버 역할 변경 불가",
  (await as(C, `update public.memberships set position = 'x' where term_id = $1 and user_id = $2 returning id`, [term2, B])).rows.length === 0);
check("총무는 초대 링크 못 봄", (await as(C, `select * from public.invitations where term_id = $1`, [term2])).rows.length === 0);
await expectError("총무는 초대 링크 못 만듦",
  () => as(C, `insert into public.invitations (term_id, role, created_by) values ($1, 'member', $2)`, [term2, C]), /row-level security/);
await expectError("총무는 새 연도 시작 불가",
  () => as(C, `select public.start_new_term($1, '2028', 'president')`, [orgId]), /학회장·부학회장만/);
await expectError("유일한 학회장은 스스로 임원으로 못 내려감",
  () => as(A, `update public.memberships set role = 'officer' where term_id = $1 and user_id = $2`, [term2, A]), /한 명은 있어야/);
check("학회장은 자기 역할을 부학회장으로 직접 변경",
  (await as(A, `update public.memberships set role = 'vice_president', position = '부학회장' where term_id = $1 and user_id = $2 returning id`, [term2, A])).rows.length === 1);
await expectError("학회장·부학회장은 요청 대신 직접 변경",
  () => as(A, `select public.request_role_change($1, 'president', '')`, [term2]), /직접 바꿀/);
await expectError("외부인은 요청 불가",
  () => as(D0, `select public.request_role_change($1, 'officer', '')`, [term2]), /멤버만/);

const req1 = (await as(B, `select public.request_role_change($1, 'officer', '홍보부 차장') as id`, [term2])).rows[0].id;
const req2 = (await as(B, `select public.request_role_change($1, 'vice_president', '기획부') as id`, [term2])).rows[0].id;
check("다시 요청하면 이전 요청은 취소되고 하나만 남음",
  (await db.query(`select status from public.role_change_requests where id = $1`, [req1])).rows[0].status === "cancelled"
  && (await db.query(`select count(*)::int as n from public.role_change_requests where status = 'pending'`)).rows[0].n === 1);
await expectError("같은 역할·직책으로는 요청 불가",
  () => as(B, `select public.request_role_change($1, 'officer', '')`, [term2]), /같은 역할/);
check("요청은 본인과 학회장·부학회장만 봄",
  (await as(B, `select id from public.role_change_requests`)).rows.length === 2
  && (await as(A, `select id from public.role_change_requests`)).rows.length === 2
  && (await as(C, `select id from public.role_change_requests`)).rows.length === 0);
await expectError("요청 직접 수정 불가",
  async () => { const r = await as(B, `update public.role_change_requests set status = 'approved' where id = $1 returning id`, [req2]); if (r.rows.length === 0) throw new Error("0 rows"); });
await expectError("본인은 자기 요청 승인 불가",
  () => as(B, `select public.decide_role_request($1, true)`, [req2]), /학회장·부학회장만/);
await expectError("총무는 요청 승인 불가",
  () => as(C, `select public.decide_role_request($1, true)`, [req2]), /학회장·부학회장만/);
check("요청만으로는 역할이 바뀌지 않음",
  (await db.query(`select role from public.memberships where term_id = $1 and user_id = $2`, [term2, B])).rows[0].role === "officer");
await as(A, `select public.decide_role_request($1, true)`, [req2]);
const bAfter = (await db.query(`select role, position from public.memberships where term_id = $1 and user_id = $2`, [term2, B])).rows[0];
check("부학회장이 승인하면 역할·직책이 바뀜", bAfter.role === "vice_president" && bAfter.position === "기획부");
await expectError("처리된 요청은 다시 처리 불가",
  () => as(A, `select public.decide_role_request($1, false)`, [req2]), /이미 처리/);

const req3 = (await as(C, `select public.request_role_change($1, 'member', '') as id`, [term2])).rows[0].id;
await as(B, `select public.decide_role_request($1, false)`, [req3]);
check("거절하면 역할은 그대로",
  (await db.query(`select role from public.memberships where term_id = $1 and user_id = $2`, [term2, C])).rows[0].role === "treasurer"
  && (await db.query(`select status from public.role_change_requests where id = $1`, [req3])).rows[0].status === "rejected");
const req4 = (await as(C, `select public.request_role_change($1, 'officer', '') as id`, [term2])).rows[0].id;
await as(C, `select public.cancel_role_request($1)`, [req4]);
check("본인은 자기 요청 취소", (await db.query(`select status from public.role_change_requests where id = $1`, [req4])).rows[0].status === "cancelled");
await expectError("남의 요청은 취소 불가", async () => {
  const id = (await as(C, `select public.request_role_change($1, 'officer', '') as id`, [term2])).rows[0].id;
  await as(A, `select public.cancel_role_request($1)`, [id]);
}, /취소할 수 있는/);

// 정리: A는 다시 학회장, B·C는 term2에서 내보낸다
await as(A, `update public.memberships set role = 'president', position = '' where term_id = $1 and user_id = $2`, [term2, A]);
await as(A, `delete from public.memberships where term_id = $1 and user_id in ($2, $3)`, [term2, B, C]);

// --- 학회비 납부자 명단 · 입금 문자로 참가비 납부 자동 체크 (이 시점: term2에는 A만)
const evC = (await as(A, `insert into public.events (term_id, kind, name, fee, created_by) values ($1, 'closing', '종강총회', 20000, $2) returning id`, [term2, A])).rows[0].id;
await as(A, `insert into public.event_participants (event_id, name, student_no) values
  ($1, '김납부', '24'), ($1, '이미납', '23'), ($1, '박동명', '22'), ($1, '박동명', '25'), ($1, '한현금', '24')`, [evC]);
const pOf = async (name, no) => (await db.query(
  `select paid, dues_exempt, paid_income_id from public.event_participants where event_id = $1 and name = $2 and student_no = $3`, [evC, name, no])).rows[0];

await as(A, `insert into public.dues_payers (term_id, name, student_no) values ($1, '김납부', '24'), ($1, '최나중', '22')`, [term2]);
check("명단에 있던 학회비 납부자는 납부·면제로 바뀜", (await pOf("김납부", "24")).paid === true && (await pOf("김납부", "24")).dues_exempt === true);
check("학회비 납부자가 아니면 그대로", (await pOf("이미납", "23")).paid === false);
await as(A, `insert into public.event_participants (event_id, name, student_no) values ($1, '최 나중', '22')`, [evC]);
check("나중에 명단에 넣어도 학회비 납부자면 납부·면제(이름 띄어쓰기 무시)", (await pOf("최 나중", "22")).dues_exempt === true);
check("학번이 다르면 다른 사람", (await as(A, `insert into public.event_participants (event_id, name, student_no) values ($1, '김납부', '23') returning dues_exempt`, [evC])).rows[0].dues_exempt === false);
await expectError("학회비 납부자 학번은 2자리만",
  () => as(A, `insert into public.dues_payers (term_id, name, student_no) values ($1, '오학생', '2024')`, [term2]), /check/);
check("외부인은 납부자 명단 못 봄", (await as(C, `select id from public.dues_payers`)).rows.length === 0);
await expectError("외부인은 납부자 추가 불가",
  () => as(C, `insert into public.dues_payers (term_id, name, student_no) values ($1, '가짜', '24')`, [term2]), /row-level security/);
await as(A, `delete from public.dues_payers where term_id = $1 and name = '김납부'`, [term2]);
check("납부자에서 빼면 면제로 체크된 것만 되돌림", (await pOf("김납부", "24")).paid === false && (await pOf("김납부", "24")).dues_exempt === false);
await as(A, `insert into public.dues_payers (term_id, name, student_no) values ($1, '김납부', '24')`, [term2]);

// 입금 문자로 만들어진 수입 (서비스가 기록하는 것처럼)
let dk = 0;
const deposit = async (payer, amount) => {
  const pe = (await db.query(`insert into public.payment_events (organization_id, raw_text, kind, amount, merchant, dedupe_key)
    values ($1, '입금', 'deposit', $2, $3, $4) returning id`, [orgId, amount, payer, `dep-${++dk}`])).rows[0].id;
  return (await db.query(`insert into public.incomes (term_id, received_on, source, payer, amount, payment_method, payment_event_id)
    values ($1, '2026-12-10', '기타', $2, $3, 'transfer', $4) returning id`, [term2, payer, amount, pe])).rows[0].id;
};
const inc1 = await deposit("이미납", 20000);
check("입금자명·금액이 맞으면 자동으로 납부 체크", (await pOf("이미납", "23")).paid === true && (await pOf("이미납", "23")).paid_income_id === inc1);
check("연결된 입금은 수입 항목이 '행사 별도 납입'으로",
  (await db.query(`select source, memo from public.incomes where id = $1`, [inc1])).rows[0].source === "행사 별도 납입");
const incAmb = await deposit("박동명", 20000);
check("동명이인이면 자동으로 체크하지 않음", (await pOf("박동명", "22")).paid === false && (await pOf("박동명", "25")).paid === false);
const inc25 = await deposit("25박동명", 20000);
check("입금자명에 학번이 붙어 있으면 그 사람으로", (await pOf("박동명", "25")).paid_income_id === inc25 && (await pOf("박동명", "22")).paid === false);
await deposit("한현금", 15000);
check("금액이 다르면 자동으로 체크하지 않음", (await pOf("한현금", "24")).paid === false);
const unmatched = (await as(A, `select * from public.event_unmatched_deposits($1)`, [evC])).rows;
check("입금 확인 필요 목록에는 참가비 배수인 미연결 입금만", unmatched.length === 1 && unmatched[0].income_id === incAmb);
check("행사 권한이 없으면 확인 필요 목록이 빈 결과", (await as(C, `select * from public.event_unmatched_deposits($1)`, [evC])).rows.length === 0);
const pAmb = (await db.query(`select id from public.event_participants where event_id = $1 and name = '박동명' and student_no = '22'`, [evC])).rows[0].id;
await expectError("외부인은 입금 연결 불가", () => as(C, `select public.assign_deposit($1, $2)`, [incAmb, pAmb]), /권한/);
await as(A, `select public.assign_deposit($1, $2)`, [incAmb, pAmb]);
check("직접 연결하면 납부 체크", (await pOf("박동명", "22")).paid_income_id === incAmb);
await expectError("이미 연결된 입금은 다시 연결 불가",
  () => as(A, `select public.assign_deposit($1, $2)`, [incAmb, pAmb]), /이미 다른 사람/);
check("연결하고 나면 확인 필요 목록에서 빠짐", (await as(A, `select * from public.event_unmatched_deposits($1)`, [evC])).rows.length === 0);
const incExempt = await deposit("24김납부", 20000);
check("학회비 면제자에게는 입금을 연결하지 않음",
  (await db.query(`select count(*)::int as n from public.event_participants where paid_income_id = $1`, [incExempt])).rows[0].n === 0);

const evJ = (await as(A, `insert into public.events (term_id, kind, name, fee, created_by) values ($1, 'jacket', '과잠', 30000, $2) returning id`, [term2, A])).rows[0].id;
await as(A, `insert into public.event_participants (event_id, name, student_no, fields) values ($1, '정과잠', '23', '{"수량":"2벌"}')`, [evJ]);
const incJ = await deposit("정과잠", 60000);
check("과잠은 참가비×수량과 맞으면 납부 체크",
  (await db.query(`select paid_income_id from public.event_participants where event_id = $1`, [evJ])).rows[0].paid_income_id === incJ);

// --- 학생회 찾기 · 참여 요청 (이 시점: term2에는 A만, B·C는 멤버 아님)
const found = (await as(C, `select * from public.search_organizations('컴퓨터공학')`)).rows;
check("외부인도 이름으로 학생회를 찾음", found.length === 1 && found[0].organization_id === orgId && found[0].requested === false);
check("학교 이름으로도 찾음", (await as(C, `select * from public.search_organizations('천안대')`)).rows.length >= 1);
check("검색어가 너무 짧으면 빈 결과", (await as(C, `select * from public.search_organizations('컴')`)).rows.length === 0);
check("이미 멤버인 학생회는 검색에 안 나옴",
  (await as(A, `select * from public.search_organizations('컴퓨터공학')`)).rows.length === 0);
check("%·_ 같은 기호는 글자 그대로 찾음", (await as(C, `select * from public.search_organizations('%%')`)).rows.length === 0);
check("외부인은 여전히 학생회 표를 직접 못 봄", (await as(C, `select * from public.organizations`)).rows.length === 0);

const jrC = (await as(C, `select public.request_join($1, '전자공 25학번 홍길동입니다') as id`, [orgId])).rows[0].id;
const jrC2 = (await as(C, `select public.request_join($1, '다시 보냅니다') as id`, [orgId])).rows[0].id;
check("다시 요청하면 같은 요청의 메시지만 바뀜", jrC === jrC2
  && (await db.query(`select count(*)::int as n from public.join_requests where user_id = $1 and status = 'pending'`, [C])).rows[0].n === 1);
check("요청하면 검색 결과에 '요청함'으로 표시", (await as(C, `select requested from public.search_organizations('컴퓨터공학')`)).rows[0].requested === true);
const mine = (await as(C, `select * from public.my_join_requests()`)).rows;
check("내 요청은 학생회 이름과 함께 보임", mine.length === 1 && mine[0].name === "컴퓨터공학과 학생회" && mine[0].status === "pending");
const jrB = (await as(B, `select public.request_join($1) as id`, [orgId])).rows[0].id;
const incoming = (await as(A, `select * from public.term_join_requests($1)`, [term2])).rows;
check("학회장은 받은 요청을 이름과 함께 봄", incoming.length === 2 && incoming.some((r) => r.display_name === "이부원"));
check("요청한 사람은 학회장용 요청 목록을 못 봄", (await as(C, `select * from public.term_join_requests($1)`, [term2])).rows.length === 0);
check("남의 요청은 못 봄", (await as(B, `select id from public.join_requests`)).rows.length === 1);
await expectError("요청한 사람이 스스로 승인 불가",
  () => as(C, `select public.decide_join_request($1, true)`, [jrC]), /학회장·부학회장만/);
await expectError("요청 직접 수정 불가", async () => {
  const r = await as(C, `update public.join_requests set status = 'approved' where id = $1 returning id`, [jrC]);
  if (r.rows.length === 0) throw new Error("0 rows");
});
await as(A, `select public.decide_join_request($1, true, 'officer')`, [jrC]);
check("승인하면 고른 역할로 멤버가 됨",
  (await db.query(`select role from public.memberships where term_id = $1 and user_id = $2`, [term2, C])).rows[0]?.role === "officer");
check("멤버가 되면 학생회를 볼 수 있음", (await as(C, `select * from public.organizations where id = $1`, [orgId])).rows.length === 1);
await expectError("처리된 요청은 다시 처리 불가", () => as(A, `select public.decide_join_request($1, false)`, [jrC]), /이미 처리/);
await expectError("이미 멤버면 요청 불가", () => as(C, `select public.request_join($1)`, [orgId]), /이미 이 학생회/);
await as(A, `select public.decide_join_request($1, false)`, [jrB]);
check("거절하면 멤버가 아님",
  (await db.query(`select count(*)::int as n from public.memberships where term_id = $1 and user_id = $2`, [term2, B])).rows[0].n === 0
  && (await db.query(`select status from public.join_requests where id = $1`, [jrB])).rows[0].status === "rejected");
const jrB2 = (await as(B, `select public.request_join($1) as id`, [orgId])).rows[0].id;
check("거절된 뒤 다시 요청할 수 있음", jrB2 !== jrB);
await expectError("남의 요청은 취소 불가", () => as(C, `select public.cancel_join_request($1)`, [jrB2]), /취소할 수 있는/);
await as(B, `select public.cancel_join_request($1)`, [jrB2]);
check("본인은 요청 취소", (await db.query(`select status from public.join_requests where id = $1`, [jrB2])).rows[0].status === "cancelled");

// 정리: C는 term2에서 내보낸다
await as(A, `delete from public.memberships where term_id = $1 and user_id = $2`, [term2, C]);

// --- 회원 탈퇴 (이 시점: A는 term2의 유일한 총무, B는 term2에서 나간 상태)
const D = "00000000-0000-0000-0000-00000000000d";
await db.query(`insert into auth.users (id, raw_user_meta_data) values ($1, '{"name":"박혼자"}')`, [D]);
await db.query(`insert into auth.identities (user_id, provider, provider_id) values ($1, 'kakao', 'k-d'), ($2, 'kakao', 'k-a')`, [D, A]);
const orgD = (await as(D, `select public.create_organization('천안대', '혼자 학생회', '1기') as id`)).rows[0].id;
const termD = (await as(D, `select id from public.terms where organization_id = $1`, [orgD])).rows[0].id;
const expD = (await as(D, `insert into public.expenses (term_id, spent_on, merchant, amount, created_by) values ($1, '2026-12-03', '문구점', 3000, $2) returning id`, [termD, D])).rows[0].id;
const incD = (await as(D, `insert into public.incomes (term_id, received_on, source, amount, created_by) values ($1, '2026-12-03', '학회비', 5000, $2) returning id`, [termD, D])).rows[0].id;

const deletedKakao = (await as(D, `select public.delete_my_account() as k`)).rows[0].k;
check("혼자인 학생회의 총무는 탈퇴 가능, 카카오 회원번호 반환", deletedKakao === "k-d");
check("탈퇴하면 계정·프로필·멤버십·카카오 연결이 지워짐",
  (await db.query(`select (select count(*) from auth.users where id = $1)::int + (select count(*) from public.profiles where id = $1)::int
    + (select count(*) from public.memberships where user_id = $1)::int + (select count(*) from auth.identities where user_id = $1)::int as n`, [D])).rows[0].n === 0);
const keptD = (await db.query(`select (select created_by from public.expenses where id = $1) as e, (select created_by from public.incomes where id = $2) as i,
  (select count(*) from public.audit_logs where expense_id = $1)::int as logs`, [expD, incD])).rows[0];
check("탈퇴해도 회계 기록은 남고 작성자만 비워짐", keptD.e === null && keptD.i === null && keptD.logs >= 1);
check("탈퇴 후 이력의 작성자도 비워짐",
  (await db.query(`select count(*)::int as n from public.audit_logs where actor_id = $1`, [D])).rows[0].n === 0);

await as(A, `insert into public.memberships (term_id, user_id, role) values ($1, $2, 'member')`, [term2, B]);
await expectError("다른 멤버가 있는데 유일한 총무면 탈퇴 불가",
  () => as(A, `select public.delete_my_account()`), /유일한 학회장·부학회장/);
await expectError("비로그인은 탈퇴 함수 실행 불가", () => db.transaction(async (tx) => {
  await tx.exec(`set local role anon;`);
  return tx.query(`select public.delete_my_account()`);
}), /permission denied/);
await expectError("로그인 사용자도 카카오 번호로 남의 계정 삭제 불가",
  () => as(B, `select public.delete_user_by_kakao_id('k-a')`), /permission denied/);

const svc = async (sql, params = []) => db.transaction(async (tx) => {
  await tx.exec(`set local role service_role;`);
  return tx.query(sql, params);
});
check("없는 카카오 번호는 false", (await svc(`select public.delete_user_by_kakao_id('nope') as ok`)).rows[0].ok === false);
check("서비스 키로 카카오 연결 해제 처리(A 삭제)", (await svc(`select public.delete_user_by_kakao_id('k-a') as ok`)).rows[0].ok === true);
check("A가 만든 지출·수입·토큰은 남고 작성자만 비워짐",
  (await db.query(`select (select count(*) from public.expenses where created_by = $1)::int + (select count(*) from public.incomes where created_by = $1)::int as n,
    (select count(*) from public.expenses)::int as total`, [A])).rows[0].n === 0);
check("A의 학생회는 남아 있음", (await db.query(`select count(*)::int as n from public.organizations where id = $1`, [orgId])).rows[0].n === 1);

console.log(results.join("\n"));
console.log(`\n${results.length - failures}/${results.length} 통과`);
process.exit(failures ? 1 : 0);
