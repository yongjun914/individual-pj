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

## 폴더 구조

```
src/
  app/              화면(App Router), manifest.ts(PWA)
  lib/supabase/     Supabase 클라이언트(브라우저·서버·proxy용)
  proxy.ts          요청마다 로그인 세션 갱신 (Next.js 16의 middleware)
public/             아이콘 등 정적 파일
docs/               기획 문서 (git 미포함)
```
