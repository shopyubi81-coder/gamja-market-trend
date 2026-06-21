# 🚀 배포 가이드 — GitHub Pages + Supabase

모바일에서도 볼 수 있는 웹페이지로 올리는 전체 과정입니다.
**CLI 설치 없이 웹 대시보드만으로** 진행할 수 있게 정리했습니다.

```
[내 폰/PC 브라우저]
      │  https://<아이디>.github.io/gamja-market-trend/
      ▼
[GitHub Pages] ── 화면(HTML/CSS/JS)
      │  네이버/알리 데이터 요청
      ▼
[Supabase Edge Function: market-api] ── API 키 안전 보관 + 프록시
      │
      ├─ 네이버 / 알리 API 호출
      └─ [Supabase DB: selections] ── 선별목록 저장 (PC↔폰 동기화)
```

---

## 1단계 — GitHub에 올리기 (화면)

### 1-1. GitHub에서 빈 저장소 생성
1. https://github.com/new 접속
2. Repository name: `gamja-market-trend`
3. **README/.gitignore 체크하지 말 것** (이미 로컬에 있음)
4. [Create repository] 클릭

### 1-2. 내 PowerShell에서 푸시
> 아래 `<아이디>`를 본인 GitHub 아이디로 바꾸세요. 첫 푸시 때 브라우저 로그인 창이 뜨면 로그인하면 됩니다.

```powershell
cd "$HOME\Desktop\gamja-market-trend"
git remote add origin https://github.com/<아이디>/gamja-market-trend.git
git push -u origin main
```

### 1-3. GitHub Pages 켜기
1. 저장소 → **Settings** → 왼쪽 **Pages**
2. **Source**: `GitHub Actions` 선택
3. 저장소 → **Actions** 탭에서 배포가 초록불(✓)이 되면 완료
4. 주소: `https://<아이디>.github.io/gamja-market-trend/`

---

## 2단계 — Supabase 설정 (백엔드 + DB)

### 2-1. 선별목록 DB 테이블 만들기
1. Supabase 대시보드 → 내 프로젝트 → 왼쪽 **SQL Editor**
2. [New query] → `supabase/migrations/0001_selections.sql` 파일 내용 전체 복사·붙여넣기
3. **Run** 클릭 → `selections` 테이블 생성 완료

### 2-2. Edge Function 만들기 (API 프록시)
1. 대시보드 → 왼쪽 **Edge Functions** → [Create a function]
2. 함수 이름: **`market-api`** (정확히 이 이름)
3. `supabase/functions/market-api/index.ts` 내용 전체 복사·붙여넣기
4. **Deploy** 클릭
5. 함수 설정에서 **"Verify JWT" 옵션을 끄거나(off)** 둘 다 둬도 됩니다
   (프론트엔드가 anon 키를 함께 보내므로 켜져 있어도 동작합니다)

### 2-3. API 키를 Secrets에 등록
1. **Edge Functions** → **Manage secrets** (또는 Project Settings → Edge Functions)
2. 아래 항목 추가:

| 이름 | 값 |
|---|---|
| `NAVER_CLIENT_ID` | 네이버 개발자센터 Client ID |
| `NAVER_CLIENT_SECRET` | 네이버 Client Secret |
| `ALI_APP_KEY` | (선택) 알리 App Key |
| `ALI_APP_SECRET` | (선택) 알리 App Secret |
| `ALI_TRACKING_ID` | (선택) 알리 트래킹 ID |

> 로컬 `.env` 파일의 값과 동일하게 넣으면 됩니다.

---

## 3단계 — 화면과 Supabase 연결

### 3-1. config.js 값 채우기
1. Supabase 대시보드 → **Project Settings** → **API**
2. 아래 두 값을 복사:
   - **Project URL** → `SUPABASE_URL`
   - **Project API keys → `anon` `public`** → `SUPABASE_ANON_KEY`
3. `public/config.js` 파일을 열어 두 값을 붙여넣기:

```js
window.GAMJA_CONFIG = {
  SUPABASE_URL: "https://여러분프로젝트.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOi...(anon public 키)",
};
```

### 3-2. 변경사항 다시 push
```powershell
cd "$HOME\Desktop\gamja-market-trend"
git add public/config.js
git commit -m "Supabase 설정값 입력"
git push
```
→ GitHub Actions가 자동으로 재배포합니다 (1~2분).

---

## ✅ 완료 확인
- 폰 브라우저로 `https://<아이디>.github.io/gamja-market-trend/` 접속
- 우측 상단 상태뱃지가 **🟢 네이버 연동**이면 성공
- 상품을 선별하면 Supabase `selections` 테이블에 저장되고, PC에서도 같은 목록이 보입니다

---

## 자주 묻는 질문

**Q. anon 키를 깃허브에 올려도 되나요?**
네. anon(public) 키는 공개용이며 RLS 정책으로 보호됩니다. service_role 키만 절대 올리면 안 됩니다.

**Q. Google Sheets 저장이 안 돼요.**
Sheets 저장은 로컬(`npm start`) 전용입니다. 배포 환경에서는 Supabase DB 동기화가 그 역할을 대신합니다.

**Q. 데이터가 안 떠요.**
1) Edge Function이 Deploy됐는지 2) Secrets에 네이버 키가 들어갔는지 3) config.js URL/키가 맞는지 확인하세요.

**Q. 선별목록을 나만 보게 하고 싶어요.**
현재는 anon 키로 누구나 접근 가능한 구조(개인용)입니다. 로그인 기능이 필요하면 Supabase Auth를 추가해 RLS를 사용자 기준으로 좁힐 수 있습니다.
