# 🚀 감자마켓 대시보드 배포 가이드

모바일에서도 보는 웹페이지로 올리는 전체 과정.
**CLI 설치 없이 웹 대시보드만으로** 진행합니다.

```
[폰/PC 브라우저]
   https://shopyubi81-coder.github.io/gamja-market-trend/
      ▼
[GitHub Pages] ── 화면(HTML/CSS/JS)
      ▼
[Supabase Edge Function: market-api] ── 네이버 키 숨김 + API 대리 호출
      ├─ 네이버 / 알리 API
      └─ [Supabase DB: selections] ── 선별목록 PC↔폰 동기화
```

---

## ✅ 진행 현황

| 단계 | 내용 | 상태 |
|---|---|---|
| ① | GitHub 업로드 + Pages 켜기 | ✅ **완료** |
| ② | Supabase 테이블·함수·키 | ⬜ 진행 중 |
| ③ | config.js 연결 | ⬜ 남음 |

- 저장소: https://github.com/shopyubi81-coder/gamja-market-trend
- 사이트: https://shopyubi81-coder.github.io/gamja-market-trend/ (현재 목업 데이터만 표시)

---

# ① GitHub (완료됨 — 참고용)

이미 끝난 단계입니다. 나중에 코드를 고쳐 다시 올릴 때만 쓰세요:
```powershell
cd "$HOME\Desktop\gamja-market-trend"
git add -A
git commit -m "수정 내용"
git push
```
→ push하면 GitHub Actions가 1~2분 뒤 자동 재배포.

---

# ② Supabase 설정

> ⚠️ Supabase 대시보드 UI는 자주 바뀝니다. 아래는 2025~2026 기준이며,
> 메뉴 이름이 조금 달라도 **굵은 키워드**로 찾으면 됩니다.

## 2-1. 선별목록 테이블 만들기 (SQL)
> 선별한 상품을 저장할 표. 이게 있어야 PC↔폰 동기화됨.

1. [supabase.com](https://supabase.com) 로그인 → 프로젝트 선택
2. 좌측 사이드바 **SQL Editor**
3. **+ New query**
4. 파일 `supabase/migrations/0001_selections.sql` 내용 전체 복사·붙여넣기
5. 우측 아래 **Run** (또는 Ctrl+Enter) → "Success" 확인

## 2-2. Edge Function 배포 (`market-api`)
> 네이버를 대신 호출하는 서버 코드. 키 노출·CORS 문제를 해결함.

1. 좌측 사이드바 **Edge Functions**
   (안 보이면 좌측 햄버거 ☰ 또는 ⚡ 아이콘 안에 있음)
2. **Create a function** / **Deploy a new function** 클릭
3. 작성 방식에서 **"Via Editor"**(브라우저 편집) 선택
   - CLI 방식만 보이면 "Or use the editor" 류 링크를 찾기
4. **Function name**: 정확히 `market-api`  ⚠️ 철자·하이픈 그대로
5. 코드 편집기의 **기본 예시를 전부 지우고**, 파일
   `supabase/functions/market-api/index.ts` 내용 전체 붙여넣기
6. **Deploy function** (또는 Deploy updates) 클릭 → "Deployed" 확인
7. "Verify JWT" 옵션은 **켜진 채로 둬도 됨** (화면이 인증키를 같이 보냄)

## 2-3. 네이버 키를 Secrets에 입력 ⚠️ 본인이 직접
> API 키 입력이라 보안상 직접 하셔야 하는 유일한 단계.

**Secrets 화면 찾기 (둘 중 하나):**
- A: **Edge Functions** 화면 → **Secrets** 탭
- B: **⚙️ Project Settings** → **Edge Functions** → **Add new secret**

**입력할 값** (Key / Value 두 칸):

| Key | Value |
|---|---|
| `NAVER_CLIENT_ID` | `.env`의 NAVER_CLIENT_ID 값 |
| `NAVER_CLIENT_SECRET` | `.env`의 NAVER_CLIENT_SECRET 값 |
| `ALI_APP_KEY` | (알리 있으면, 없으면 생략) |
| `ALI_APP_SECRET` | (없으면 생략) |

- 값은 PC `바탕화면\gamja-market-trend\.env` 파일에서 복사 (메모장으로 열림)
- 각각 **Add / Save** 클릭

---

# ③ 화면과 Supabase 연결

## 3-1. 연결값 2개 복사
**⚙️ Project Settings → API Keys** (예전 "API" 메뉴, 분리됨)
- **Project URL** (Settings → Data API 또는 General에 있을 수 있음)
  예: `https://abcd1234.supabase.co`
- **anon / public 키** — 최신 UI에선 **"Publishable key"**로 표기됨
  (`eyJ...` 로 시작. 이게 공개용 키 → config.js에 넣을 것)
  ⚠️ "service_role" / "Secret key"는 **절대 사용 금지**

## 3-2. config.js에 입력
파일 `public/config.js`를 메모장으로 열어 채우기:
```js
window.GAMJA_CONFIG = {
  SUPABASE_URL: "https://abcd1234.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOi...",
};
```

## 3-3. 다시 push
```powershell
cd "$HOME\Desktop\gamja-market-trend"
git add public/config.js
git commit -m "Supabase 연결값 입력"
git push
```
→ 1~2분 뒤 자동 재배포.

---

# ✅ 완료 확인
- 폰으로 https://shopyubi81-coder.github.io/gamja-market-trend/ 접속
- 우측 상단 뱃지가 **🟢 네이버 연동**이면 성공
- 상품 **+선별** → Supabase에 저장 → PC 새로고침해도 같은 목록 보임

---

# 막힐 만한 곳

| 증상 | 해결 |
|---|---|
| Edge Functions 메뉴가 없음 | 좌측 햄버거 ☰ / ⚡ 아이콘 / "Functions" 검색 |
| API 키가 안 보임 | Settings → **API Keys** (또는 Data API). 신규 UI는 "Publishable key" |
| 함수 배포했는데 데이터 없음 | 2-3 Secrets에 네이버 키 넣었는지, 함수 이름이 정확히 `market-api`인지 |
| 화면은 뜨는데 "설정 필요" | ③ config.js 값 오타 / 재배포 1~2분 대기 |
| git push 멈춤 | GitHub 로그인 팝업 확인 후 승인 |

---

# FAQ
- **anon(Publishable) 키 공개돼도 되나요?** 네, 공개용이며 RLS로 보호됨. service_role(Secret)만 절대 금지.
- **Google Sheets 저장은?** 로컬(`npm start`) 전용. 배포 환경은 Supabase DB 동기화가 대신함.
- **선별목록을 나만 보게?** 현재는 개인용(anon 접근). 로그인 필요하면 Supabase Auth 추가 가능.
