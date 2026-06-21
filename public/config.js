// ================================================
// 감자마켓 대시보드 설정
// ================================================
// Supabase 대시보드 → Project Settings → API Keys 에서 값 복사.
//   - Project URL                → SUPABASE_URL
//   - Publishable key (anon 공개키) → SUPABASE_ANON_KEY
// publishable 키는 공개돼도 안전합니다(RLS 보호). GitHub에 올라가도 OK.
//
// EDGE_FUNCTION: 배포한 Edge Function 경로.
//   함수 이름이 'dynamic-action'으로 배포돼서, 내부 라우팅 보정을 위해
//   'dynamic-action/market-api' 형태로 둡니다. (함수 코드는 그대로 사용)

window.GAMJA_CONFIG = {
  SUPABASE_URL: "https://xjmktxwnyesxvvigypqj.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_Ow0OEYmKjVHC54phH2ib8g_wD2vY-cr",
  EDGE_FUNCTION: "dynamic-action/market-api",
};
