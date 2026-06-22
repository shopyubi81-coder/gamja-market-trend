# 감자마켓 트렌드 대시보드 — 프로젝트 안내 (Claude용)

> 이 파일은 새 대화에서 Claude가 자동으로 읽습니다. 프로젝트를 처음부터 설명할 필요 없이
> 이 문서로 맥락을 파악하고 바로 이어서 작업하세요.

## 🟢 현재 상태 & 다음 할 일 (2026-06-22 기준)
**제품 비전**: 단순 검색기 → **PDT(Product Discovery Terminal)** = "상품판 블룸버그 터미널".
MD가 *실패할 상품을 빨리 버리고 검증할 상품을 빨리 고르게* 하는 의사결정 엔진.

**작동 중(실데이터)**: 네이버·쿠팡·인스타 트렌드 / 아침 브리핑 / 일일 보고서(매일 7:30 cron) /
선별목록 PC↔폰 동기화 / 🎯 기회점수(카테고리 단위) / 📝 리뷰 분석기(수동입력+코드 빈도분석, 무료).

**미완 / 다음**:
- ⏳ `0004_review_analysis.sql` 아직 미실행 → 리뷰분석 "저장/이력/선별연결"이 그것 실행해야 작동 (엣지 재배포 불필요)
- 🟡 알리·타오바오: 코드 준비됨, API 키 대기
- 🔜 리뷰 AI 요약: LLM 키(Claude/OpenAI) 정해지면 "버튼 1회+캐싱"으로 추가 (토큰 통제)
- 🆕 **다음 주제: UI/UX를 PDT 3분할 터미널 구조로 재설계** (아래 가이드 참고)

## 🆕 새 UI/UX(PDT) 재설계 시작 가이드
사용자가 원하는 새 구조 (증권 HTS 차용):
```
상단: 검색창
좌측: 상품/카테고리 목록 (평점·리뷰수·검색량·증가율)
중앙: 상품 분석 (KPI카드 성장점수/시장규모/경쟁도/평점 + 트렌드·리뷰·판매추정 차트, 일/주/월/년 전환)
우측: AI 분석 리포트 (인기요인/불만요인/추천액션)
하단: 리뷰·키워드·트렌드 차트 (긍/부정 키워드, 워드클라우드)
```
재설계 시 핵심 원칙:
- **백엔드/API/Supabase는 그대로 재사용** — `load___Data()`, `afetch()`, 기회점수, 리뷰분석 로직 유지.
- **`public/index.html`의 화면(HTML/CSS)과 `render___Panel()`만 새 레이아웃으로 교체.**
- 안전하게 하려면 기존은 두고 `public/v2.html`로 새로 만들어 비교 후 교체 권장.
- 현재 데이터 한계 인지: 상품별 평점·리뷰수는 무료 API에 없음(쿠팡/네이버 미제공). 좌측 목록의
  "평점/리뷰수"는 알리(있음) 또는 리뷰 수동입력 연결로만 채워짐. 검색량/증가율은 카테고리 단위.

## 한 줄 요약
감자마켓 MD가 **매일 아침 네이버·쿠팡·인스타 트렌드를 한 페이지에서 실시간으로 보고
상품을 선별**하는 모바일/PC 웹 대시보드. GitHub Pages + Supabase로 배포됨.

## 라이브 주소
- **사이트**: https://shopyubi81-coder.github.io/gamja-market-trend/
- **GitHub**: https://github.com/shopyubi81-coder/gamja-market-trend (main 브랜치)
- **Supabase 프로젝트**: xjmktxwnyesxvvigypqj.supabase.co

## 아키텍처
```
[브라우저(폰/PC)]
   → GitHub Pages (public/ 정적 호스팅, push 시 Actions 자동 배포)
   → Supabase Edge Function (네이버/쿠팡/알리/타오바오 프록시 + 보고서)
   → Supabase DB (선별목록·캐시·일일보고서)
```

## 파일 구조
- `public/index.html` — **프론트엔드 전체** (단일 파일, 인라인 CSS/JS). UI/UX는 여기서 수정.
- `public/config.js` — Supabase URL/anon키/Edge Function 경로
- `supabase/functions/market-api/index.ts` — **백엔드 전체** (Deno Edge Function)
- `supabase/migrations/*.sql` — DB 테이블 (0001 선별목록, 0002 캐시, 0003 일일보고서+cron)
- `server.js` — 로컬 개발용 Express (배포엔 안 씀)

## ⚠️ 배포 시 꼭 알아야 할 것 (중요)
1. **프론트엔드(public/)**: `git push`하면 GitHub Actions가 자동 배포 (1~2분). 내가 push까지 처리 가능.
2. **Edge Function**: 코드(index.ts) 바꾸면 **사용자가 직접** Supabase 대시보드에서 재배포해야 함
   (CLI 미설치). 함수 이름이 **`dynamic-action`** 임(market-api 아님). 사용자가 .ts 파일을 메모장으로
   못 열면 → 채팅에 코드 전체를 출력해주면 됨.
3. **Edge Function 경로 보정**: 함수가 `dynamic-action`으로 배포돼서, 코드 라우팅(`/market-api` strip)과
   맞추려고 config.js의 `EDGE_FUNCTION`을 **`dynamic-action/market-api`**로 둠. 프론트는
   `afetch()`로 호출(anon키 자동 첨부). 로컬은 `/api`.
4. **SQL/Secrets**: 테이블 추가나 API키는 사용자가 Supabase 대시보드에서 직접 (SQL Editor / Edge Functions Secrets).
   직접 링크: `https://supabase.com/dashboard/project/_/sql/new`, `.../settings/functions`
5. **키는 절대 채팅으로 받지 말 것** — Secrets에 사용자가 직접 입력. anon(publishable) 키만 공개 가능.

## 데이터 소스 현황
| 채널 | 상태 | API | 비고 |
|---|---|---|---|
| 네이버 | ✅ 실시간 | DataLab 쇼핑인사이트 + 검색 | **기간(일/주/월/년) 지원** |
| 쿠팡 | ✅ 실시간 | 파트너스 골드박스/베스트 | 30분 캐시. **기간 미지원**(현재 인기만), 검색 10회/시간 제한 |
| 인스타 | ✅ 실시간 | (C안) 해시태그→네이버 검색 인기도 | 60분 캐시. 인스타 공식API 아님. 기간 미적용 |
| 알리 | 🟡 코드준비 | 어필리에이트 hotproduct | 키 미설정 (ALI_APP_KEY/SECRET) |
| 타오바오 | 🟡 코드준비 | 타오바오커 material.optional | 키 미설정 (TAOBAO_APP_KEY/SECRET/ADZONE_ID) |
| 테무 | ❌ 불가 | 공식 API 없음 | 목업 |

## 주요 기능 (프론트엔드)
- 플랫폼 탭(전체/쿠팡/네이버/인스타/중국) + 카테고리 필터 + 기간(일/주/월/년)
- 🌅 아침 브리핑(상단), 📑 일일 종합 보고서(헤더 버튼, 매일 7:30 KST cron 자동생성)
- 상품 +선별 → Supabase `selections` 테이블 저장 (PC↔폰 동기화), TXT 내보내기
- `render()`가 메인 렌더, 각 채널 `render___Panel()` + `load___Data()` 패턴

## API 키 환경변수 (Supabase Edge Function Secrets)
- `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` (설정됨)
- `COUPANG_ACCESS_KEY`, `COUPANG_SECRET_KEY` (설정됨)
- `ALI_APP_KEY`, `ALI_APP_SECRET`, `ALI_TRACKING_ID` (미설정)
- `TAOBAO_APP_KEY`, `TAOBAO_APP_SECRET`, `TAOBAO_ADZONE_ID` (미설정)
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (Supabase 자동 주입)

## UI/UX를 새로 만들 때
- **데이터/API 레이어는 그대로 재사용 가능** — `load___Data()` 함수들, `afetch()`, Supabase 연동,
  Edge Function은 건드릴 필요 없음. **`public/index.html`의 HTML/CSS와 `render___Panel()` 함수만
  새 디자인으로 교체**하면 됨.
- 즉 새 UI 작업은 "백엔드 0, 프론트만" → 토큰 효율적.
- 작업 전 현재 `public/index.html`을 읽고 데이터 흐름(상태 변수 → load → render)을 파악할 것.

## 작업 규칙
- 코드 수정 후 `git push`로 배포. 커밋 메시지 한국어 OK.
- 프론트 JS 수정 시 문법 검증: `node -e`로 인라인 스크립트 vm.Script 체크 후 push.
- 사용자는 비개발자(MD). 단계는 직접 링크 + 화면 순서로 친절하게 안내.
