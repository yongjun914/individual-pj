@AGENTS.md

# 프로젝트 메모

학생회 회계·감사 도구(PWA). 기획서는 `docs/PRD.md`(git 미포함, 로컬 전용).

## 스택

- Next.js 16 (App Router, `src/`), TypeScript, Tailwind CSS 4
- Supabase (`@supabase/ssr`): 브라우저 `src/lib/supabase/client.ts`, 서버 `src/lib/supabase/server.ts`
- Next.js 16에서는 middleware 대신 `src/proxy.ts`를 쓴다. 세션 갱신은 `src/lib/supabase/proxy.ts`.

## 규칙

- 사용자에게 보이는 문구는 한국어.
- 금액은 원 단위 정수로 다룬다.
- 기획·설계 문서는 `docs/`에 최신본만 보관한다.
- 작업 후 `npm run lint`와 `npm run build`가 통과해야 한다.
