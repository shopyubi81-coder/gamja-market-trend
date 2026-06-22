-- ================================================
-- API 응답 캐시 테이블 (쿠팡 호출 한도 보호용)
-- ================================================
-- 쿠팡 파트너스 API는 호출 제한이 엄격해서(검색 10회/시간),
-- 응답을 30분간 저장해두고 재사용합니다. 새로고침을 아무리 많이 해도
-- 실제 쿠팡 호출은 30분에 1번으로 제한됩니다.

create table if not exists public.api_cache (
  key         text primary key,
  data        jsonb,
  updated_at  timestamptz not null default now()
);

-- Edge Function은 service_role 키로 접근하므로 RLS는 켜두되 정책은 닫아둠
-- (service_role은 RLS를 우회함). 익명 직접 접근은 차단.
alter table public.api_cache enable row level security;
