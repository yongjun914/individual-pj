# individual-pj

천안 AX_개인과제

학생회 총무를 위한 회계·감사 도구(PWA). 결제 즉시 영수증을 남기고, 감사 시즌에는 학교 양식 엑셀과 증빙 PDF를 자동으로 만든다.

## 기술 스택

- Next.js 16 (App Router) · TypeScript · Tailwind CSS 4
- Supabase (Auth, PostgreSQL, Storage)
- Vercel 배포 예정

## 시작하기

1. 의존성 설치

   ```bash
   npm install
   ```

2. 환경변수 설정: `.env.example`을 복사해 `.env.local`을 만들고 Supabase 값을 채운다.

3. 개발 서버 실행 후 http://localhost:3000 접속

   ```bash
   npm run dev
   ```

## 스크립트

| 명령 | 설명 |
| --- | --- |
| `npm run dev` | 개발 서버 |
| `npm run build` | 프로덕션 빌드 |
| `npm run start` | 빌드 결과 실행 |
| `npm run lint` | ESLint 검사 |
| `npm run test:db` | DB 스키마·권한(RLS) 검증 (메모리 Postgres, Supabase 불필요) |

## 소셜 로그인 설정 (Supabase 대시보드)

1. **Authentication > URL Configuration**
   - Site URL: `http://localhost:3000` (배포 후에는 실제 주소)
   - Redirect URLs: `http://localhost:3000/auth/callback`
2. **Authentication > Providers**
   - **Kakao:** [Kakao Developers](https://developers.kakao.com)에서 앱을 만들고 REST API 키·Client Secret을 입력. 카카오 로그인 Redirect URI에 `https://<프로젝트-ref>.supabase.co/auth/v1/callback`을 등록. 이메일 동의항목은 비즈 앱이 아니면 받을 수 없으므로 Supabase에서 "Allow users without an email"을 켠다.
   - **Google:** Google Cloud Console에서 OAuth 클라이언트(웹)를 만들고, 승인된 리디렉션 URI에 위와 같은 Supabase 콜백 주소를 등록.

## DB 스키마 적용

스키마는 `supabase/migrations/`에 있다. Supabase 프로젝트를 만든 뒤 한 번만 연결하고 적용한다.

```bash
npx supabase login
npx supabase link --project-ref <프로젝트-ref>
npx supabase db push
```

## 폴더 구조

```
src/
  app/              화면(App Router), manifest.ts(PWA)
    login/          소셜 로그인 (카카오·구글)
    auth/           OAuth 콜백, 로그아웃
    onboarding/     학생회 만들기
    invite/[token]/ 초대 링크 수락
  components/       공용 UI
  lib/              인증·역할 등 공용 로직
  lib/supabase/     Supabase 클라이언트(브라우저·서버·proxy용)
  proxy.ts          요청마다 로그인 세션 갱신 (Next.js 16의 middleware)
supabase/
  migrations/       DB 스키마(SQL)
  tests/            RLS 권한 검증 스크립트
public/             아이콘 등 정적 파일
docs/               기획 문서 (git 미포함)
```
