# 조쉬

영상 편집자를 위한 스케줄 및 금전 관리 비서입니다.

## 기능

- 유료 프로그램 구독비 계산
- 영상 편집 견적가 계산
- 숏폼 편당 최소 3만원·작업시간 기준 견적 계산
- 고객 문의 텍스트 자동 견적 입력
- 공개 YouTube 영상·채널의 영상 유형·캠 수·편집 강도 AI 추정(Gemini) 및 ChatGPT 수동 분석 전달
- 구독 선택에 따른 월 실지출·예산 잔액·예상 세후 순수익 실시간 확인
- 컨디션에 따른 작업시간 보정
- 마감일 기준 위험도 표시
- 일정 보드 관리
- 모바일에서도 7열 월간 캘린더 유지
- 모바일 웹앱 설치 지원

## GitHub Pages 배포

이 폴더의 파일을 GitHub 저장소에 올린 뒤 Pages를 켜면 모바일에서도 접속할 수 있습니다.

1. GitHub에서 새 저장소를 만듭니다.
2. `index.html`, `manifest.webmanifest`, `sw.js`, `icon.svg`, `.nojekyll`, `README.md`를 업로드합니다.
3. 저장소의 `Settings > Pages`로 이동합니다.
4. `Build and deployment`에서 `Deploy from a branch`를 선택합니다.
5. Branch를 `main`, folder를 `/root`로 선택하고 저장합니다.
6. 표시되는 `https://...github.io/.../` 주소를 휴대폰에서 엽니다.

## 모바일 사용

### 무료 상담 견적

`조쉬에게 견적 물어보기`에 고객 문의를 붙여넣고 `무료 견적 받기`를 누르면
편당 제안가, 협의 하한선, 작업시간, 가용시간 대비 물량, 확인 질문과 고객 답장을 만듭니다.
계산은 기기 안의 `brief-quote.js` 규칙으로 처리합니다.
로그인 상태에서 문의에 YouTube 영상 또는 채널 링크가 있으면 `analyze-reference` 함수로 영상을 분석해,
문의에 적히지 않은 캠 수·영상 유형·길이·자료 화면·편집 강도를 채웁니다.
우선순위는 문의 문장 > 직접 수정값 > 영상 분석값 > 기본 가정이며, 캠 수는 분석 신뢰도 60% 이상일 때만 반영합니다.
로그인하지 않았거나 분석이 실패하면 문의 내용만으로 계산합니다. 누락된 조건은 가정으로 표시하며 직접 수정할 수 있습니다.
사진 자료·원본 검수·다큐 구성·추가 수정·급행을 구분하며 물량 예정만으로 할인하지 않습니다.
기존 상세 계산기와는 별도 산식입니다. 최근 상담과 입력 초안은 해당 브라우저에만 저장되며,
상단의 백업 복사·가져오기로 다른 기기로 옮길 수 있습니다. 계정 동기화에는 포함되지 않습니다.
작업일은 집중 가능시간 기준 추정이며 확정 납기나 공휴일을 반영한 영업일이 아닙니다.

추가 검증: `node tests/brief-quote.test.js`, `node tests/brief-mobile.js`.
배포 시 `brief-quote.js`도 반드시 함께 업로드합니다.

GitHub Pages 주소를 휴대폰 브라우저에서 연 뒤 홈 화면에 추가하면 앱처럼 사용할 수 있습니다.

- iPhone Safari: 공유 버튼 > 홈 화면에 추가
- Android Chrome: 메뉴 > 홈 화면에 추가

데이터는 브라우저 안에 저장됩니다. PC와 휴대폰 사이에 옮길 때는 조쉬 상단의 `백업 복사`와 `백업 가져오기`를 사용하세요.

## 레퍼런스 분석

- 로그인하지 않으면 제목과 공개 정보만 쓰는 빠른 추정으로 동작하며 API 비용이 없습니다.
- 로그인 상태에서 `실제 영상 AI 분석`(기본 켜짐)이면 공개 YouTube 영상을 Gemini가 서버에서 분석합니다.
  6분이 넘는 영상은 앞부분 2분 30초와 중간 2분 30초만, 길이를 모르는 영상은 앞 5분만 낮은 해상도로 분석해 무료 한도를 아낍니다.
- 채널 링크(`@핸들`, `/channel/`, `/c/`, `/user/`)는 채널 공개 페이지에서 최근 업로드의 제목·길이를 읽고(키 불필요),
  주된 형식(롱폼/숏폼)의 영상 3개를 분석해
  캠 수는 다수결, 편집 항목은 중간값으로 합칩니다.
- Gemini가 혼잡(429/503)하면 한 번 재시도한 뒤 대체 모델로 넘어갑니다.
- 같은 영상은 30일 동안 `reference_analysis_cache` 테이블의 결과를 재사용합니다.

### Supabase 설정

```bash
supabase db push                                   # reference_analysis_cache 테이블 생성
supabase secrets set GEMINI_API_KEY=...            # 필수
supabase secrets set YOUTUBE_API_KEY=...           # 선택: 없어도 채널 분석 동작, 넣으면 단일 영상 길이까지 조회
supabase secrets set GEMINI_FALLBACK_MODELS=gemini-flash-latest,gemini-2.5-flash   # 선택
supabase functions deploy analyze-reference
```

`YOUTUBE_API_KEY`는 필요 없습니다. 유튜브 공개 RSS 피드는 현재 404를 자주 반환해 쓰지 않고, 채널 공개 페이지를 읽습니다.
함수는 로그인한 사용자의 토큰만 받습니다.
- 직접 선택한 영상 파일은 브라우저 안에서 프레임 수치만 분석하며 서버로 자동 전송하지 않습니다.
- 영상 파일의 의미 분석은 프레임 묶음과 요청문을 준비한 뒤 사용자가 ChatGPT에 직접 첨부하는 방식입니다.

## 검증

```powershell
node tests\verify-app.js
node tests\browser-smoke.js
deno test supabase/functions/analyze-reference/reference.test.ts
```

브라우저 테스트는 Playwright Chromium, Sharp, FFmpeg가 필요합니다.
