# 조쉬

영상 편집자를 위한 스케줄 및 금전 관리 비서입니다.

## 기능

- 유료 프로그램 구독비 계산
- 영상 편집 견적가 계산
- 숏폼 편당 최소 3만원·작업시간 기준 견적 계산
- 고객 문의 텍스트 자동 견적 입력
- 공개 YouTube 대표 장면의 영상 유형·캠 수·편집 리듬 AI 추정 및 ChatGPT 수동 분석 전달
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

GitHub Pages 주소를 휴대폰 브라우저에서 연 뒤 홈 화면에 추가하면 앱처럼 사용할 수 있습니다.

- iPhone Safari: 공유 버튼 > 홈 화면에 추가
- Android Chrome: 메뉴 > 홈 화면에 추가

데이터는 브라우저 안에 저장됩니다. PC와 휴대폰 사이에 옮길 때는 조쉬 상단의 `백업 복사`와 `백업 가져오기`를 사용하세요.

## 레퍼런스 분석

- 기본 링크 분석은 제목과 공개 정보만 사용하며 API 비용이 없습니다.
- `공개 YouTube 대표 장면 AI 분석`을 선택하고 버튼을 누른 경우에만 공개 대표 이미지가 OpenAI API로 전달됩니다.
- 직접 선택한 영상 파일은 브라우저 안에서 프레임 수치만 분석하며 서버로 자동 전송하지 않습니다.
- 영상 파일의 의미 분석은 프레임 묶음과 요청문을 준비한 뒤 사용자가 ChatGPT에 직접 첨부하는 방식입니다.

## 검증

```powershell
node tests\verify-app.js
node tests\browser-smoke.js
```

브라우저 테스트는 Playwright Chromium, Sharp, FFmpeg가 필요합니다.
