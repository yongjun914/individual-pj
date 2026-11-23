// supabase/migrations의 SQL을 PGlite(메모리 Postgres)에 순서대로 적용하고 RLS 시나리오를 검증한다.
// 실행: npm run test:db
// Supabase 전용 객체(auth, storage, 역할)는 최소한으로 흉내 낸다.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const migrationsDir = join(import.meta.dirname, "..", "migrations");
const db = new PGlite();

const A = "00000000-0000-0000-0000-00000000000a"; // 총무 (학생회 생성자)
const B = "00000000-0000-0000-0000-00000000000b"; // 집행부원 (초대로 합류)
const C = "00000000-0000-0000-0000-00000000000c"; // 외부인

await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, raw_user_meta_data jsonb default '{}');
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
  () => as(C, `select public.create_organization('a', 'b', 'c', 'member')`), /총무 또는 회장/);
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
check("B도 초대 목록은 못 봄(집행부원)", (await as(B, `select * from public.invitations`)).rows.length === 0);
await expectError("잘못된 토큰 거부", () => as(C, `select public.accept_invitation('nope')`), /만료/);
check("같은 학생회 프로필 조회(B→A)", (await as(B, `select * from public.profiles where id = $1`, [A])).rows.length === 1);
check("외부인 프로필은 못 봄(C→A)", (await as(C, `select * from public.profiles where id = $1`, [A])).rows.length === 0);

// --- 카테고리 권한
await expectError("집행부원은 카테고리 추가 불가",
  () => as(B, `insert into public.categories (term_id, name) values ($1, '축제')`, [term1]), /row-level security/);
await as(A, `insert into public.categories (term_id, name) values ($1, '축제')`, [term1]);
check("총무는 카테고리 추가", true);

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
  () => as(B, `select public.start_new_term($1, '2027년 제39대')`, [orgId]), /회장 또는 총무/);
const term2 = (await as(A, `select public.start_new_term($1, '2027년 제39대', 'treasurer') as id`, [orgId])).rows[0].id;
const terms = await as(A, `select id, is_active from public.terms where organization_id = $1`, [orgId]);
check("새 기수 활성, 이전 기수 비활성", terms.rows.filter((t) => t.is_active).length === 1 && terms.rows.find((t) => t.id === term1).is_active === false);
check("카테고리가 새 기수로 복사(6개)", (await as(A, `select count(*)::int as n from public.categories where term_id = $1`, [term2])).rows[0].n === 6);
check("지난 기수 지출 수정 불가(총무도)", (await as(A, `update public.expenses set memo = 'z' where id = $1 returning id`, [expA])).rows.length === 0);
await expectError("지난 기수에 지출 등록 불가",
  () => as(A, `insert into public.expenses (term_id, spent_on, amount, created_by) values ($1, '2026-12-01', 1000, $2)`, [term1, A]), /row-level security/);
check("B는 지난 기수 지출을 여전히 조회", (await as(B, `select * from public.expenses`)).rows.length === 2);
await expectError("지난 기수 초대 링크 사용 불가",
  () => as(C, `select public.accept_invitation($1)`, [token]), /끝난 기수/);
await expectError("한 학생회에 활성 기수 2개 불가",
  () => as(A, `update public.terms set is_active = true where id = $1`, [term1]), /duplicate|unique/);

console.log(results.join("\n"));
console.log(`\n${results.length - failures}/${results.length} 통과`);
process.exit(failures ? 1 : 0);
