# 학생회 업무포털

천안 AX_개인과제

12월부터 과 학생회를 부학회장으로 임명받아 활동할 예정입니다. 

이번 개인과제를 통해 학생회를 운영할 때 더욱 편리하게 운영하기 위해 학생회 엄무포털을 만들게 되었습니다.
학생회를 위한 회계·감사·행사 관리 웹앱(PWA)입니다. 결제 알림(SMS)과 통장 거래내역(거래내역서)으로 지출·수입을 자동으로 기록하고, 감사 시즌에는 학교 **결산내역서(한글 양식)**와 **증빙 PDF**를 바로 만듭니다.

실제로 맴버들을 초대하여 방학때 기능 최종점검과 업그레이드 후 사용할 예정이기 때문에 테스트용 학생회를 새로 개설해 초대링크를 함께 제공합니다. 
(아래 테스트 방법 참고)
- 배포: https://individual-pj.vercel.app
- 테스트용 초대 링크 (데모 학생회, 학회장 권한): https://individual-pj.vercel.app/invite/27f0a2a65d814d74b39cbc0281de9f09029af5fd79fd40b9ba39dc531c700c58
- 로그인: 카카오 간편로그인

### 테스트 방법

1. 위 **테스트용 초대 링크**를 열고 카카오로 로그인한 뒤 **참여하기**를 누르면 "데모 학생회 (채점용)"에 학회장으로 들어가요. 모든 메뉴를 써 볼 수 있어요.
2. 데모 학생회에는 더미 데이터가 들어 있어요.
   - 통장 거래내역 30건 → 지출 16건, 수입 12건 (이월액 1,000만 원 포함)
   - 행사 "2026 종강총회" → 구글폼 응답 80명, 납부 68명
3. 볼 만한 화면: 홈(수입·지출·잔액), 지출·수입 목록, 행사 관리(명단·돈 탭), 감사 준비(점검 목록, 결산내역서 엑셀·증빙 PDF), 학생회원 관리(학회장, 부학회장만 이용가능)

> 초대 링크는 **2026년 12월 4일 19:56까지** 쓸 수 있어요. 만료되면 학생회원 관리에서 새 링크를 만들어 이 README를 바꿔요. 데모 학생회의 자료는 모두 가짜 데이터예요.

## 왜 만들었나

학생회 총무는 영수증을 모으고, 감사 때 학교 양식에 지출을 한 줄씩 옮겨 적고, 영수증을 번호 순서로 정리하는 데 많은 인원이 모여 많은 시간을 씁니다. 이 앱은 그 과정을 다음처럼 줄입니다.
또한, 각종행사(MT,LT, 개강총회, 과잠신청 등등)를 운영할 때 인원들을 직접 한 명씩 넣고, 수정하고, 확인하며 파일을 만듭니다. 이 과정은 학생회 업무 중 귀찮은 업무 중에 하나입니다. 학회비를 입금한 인원과 입금하지 않은 인원을 앱이 자동으로 판단하고 행사참여비를 입금해야하는 사람을 자동으로 판별해줍니다.

1. 체크카드 결제·통장 입출금 알림 문자(SMS)가 오면 지출·수입이 자동으로 기록된다.
2. 총무는 영수증 사진만 찍어 붙인다. (영수증은 필수로 따로 보관해야함)
3. 감사 때 기간을 고르면 점검 목록을 보고, 학교 결산내역서 양식과 증빙 PDF를 내려받는다.
4. 행사 운영시 자동으로 인원파악, 납부 현황 파악가능

## 주요 기능

| 영역 | 기능 |
| --- | --- |
| 지출 | 등록·수정·삭제, 영수증 사진(최대 5장, 자동 축소), 분실 사유서, 변경 이력, 기간·행사·영수증 필터 |
| 수입 | 이월액·학회비·행사 별도 납입 등 기록, 홈에서 수입·지출·잔액 |
| 결제 문자 연동 | iOS 단축어·MacroDroid가 보낸 카드 승인·취소, 통장 입출금 문자를 해석해 자동 기록 (`/api/payments`, 학생회별 토큰) |
| 거래내역 가져오기 | 은행·카드사 엑셀/CSV(EUC-KR 포함)를 올리면 출금은 지출로, 입금은 수입으로. 이미 있는 내역과 겹치면 표시 |
| 감사 준비 | 출력 전 점검(영수증 없음·미분류·중복 의심 등), 결산내역서 **한글(HWPX) 양식 채우기** 또는 엑셀, 증빙 PDF |
| 행사 | 행사별 명단(구글폼 응답 붙여 넣기), 납부·참석 체크, 참가비 입금 자동 연결, 학회비 납부자 명단 |
| 학생회원 관리 | 초대 링크, 역할·직책, 기능별 권한, 참여·직책 변경 요청, 연도(기수) 전환 |

모든 데이터는 Supabase의 행 단위 보안(RLS)으로 소속 학생회 사람만 볼 수 있고, 지난 연도 자료는 읽기 전용입니다.

## 기술 스택

- Next.js 16 (App Router, Cache Components) · React 19 · TypeScript · Tailwind CSS 4
- Supabase (Auth, PostgreSQL, Storage, RLS)
- Vercel 배포
- 파일 처리(브라우저): SheetJS(엑셀), pdf-lib(PDF), fflate(HWPX)

## 시작하기

1. 의존성 설치

   ```bash
   npm install
   ```

2. 환경변수: `.env.example`을 복사해 `.env.local`을 만들고 Supabase URL과 Publishable key를 채운다.

3. DB 스키마 적용 (`supabase/migrations/`)

   ```bash
   npx supabase login
   npx supabase link --project-ref <프로젝트-ref>
   npx supabase db push
   ```

4. 개발 서버 실행 후 http://localhost:3000 접속

   ```bash
   npm run dev
   ```

### 카카오 로그인 설정 (Supabase 대시보드)

1. **Authentication > URL Configuration**: Site URL과 Redirect URLs에 `http://localhost:3000/auth/callback`(배포 후에는 실제 주소)을 넣는다.
2. **Authentication > Providers > Kakao**: [Kakao Developers](https://developers.kakao.com)에서 앱을 만들고 REST API 키·Client Secret을 입력한다. 카카오 로그인 Redirect URI에는 `https://<프로젝트-ref>.supabase.co/auth/v1/callback`을 등록한다. 비즈 앱이 아니면 이메일을 받을 수 없으므로 "Allow users without an email"을 켠다.

## 스크립트

| 명령 | 설명 |
| --- | --- |
| `npm run dev` | 개발 서버 |
| `npm run build` | 프로덕션 빌드 |
| `npm run start` | 빌드 결과 실행 |
| `npm run lint` | ESLint 검사 |
| `npm run test:unit` | 해석기·계산 단위 테스트 (결제 문자, 거래내역, 감사 자료, HWPX 채우기, 행사 명단 등) |
| `npm run test:db` | DB 스키마·권한(RLS) 시나리오 검증 (메모리 Postgres, Supabase 불필요) |

## 폴더 구조

```
src/
  app/
    (app)/          로그인 후 화면: 홈, 지출, 수입, 행사, 감사 준비, 학생회원 관리, 설정, 마이
    api/payments/   결제·입출금 문자 수신 웹훅
    api/kakao/      카카오 연결 해제 웹훅
    login/ auth/    카카오 로그인, OAuth 콜백
    onboarding/     학생회 만들기·참여 요청
    invite/[token]/ 초대 링크 수락
    manifest.ts     PWA
  components/       공용 UI (상단·하단 메뉴, 목록 등)
  lib/              순수 로직 (결제 문자·거래내역 해석, 감사 계산, HWPX 채우기, 권한 등)
  lib/supabase/     Supabase 클라이언트 (브라우저·서버·proxy·익명)
  proxy.ts          요청마다 로그인 세션 갱신 (Next.js 16의 middleware)
supabase/
  migrations/       DB 스키마(SQL)
  tests/            RLS 권한 검증 스크립트
tests/unit/         단위 테스트
public/             아이콘 등 정적 파일
docs/               기획 문서·양식 샘플 (git 미포함)
```
