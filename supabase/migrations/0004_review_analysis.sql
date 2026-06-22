-- ================================================
-- 리뷰 분석 이력 테이블
-- ================================================
-- 리뷰 분석 결과를 저장 → 상품별 누적, PC↔폰 동기화

create table if not exists public.review_analysis (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  product_name  text,
  item_id       text,            -- 연결된 선별 상품 id (있으면)
  pos_pct       int,
  neg_pct       int,
  total         int,
  pos_keywords  jsonb,           -- [[라벨, 횟수], ...]
  neg_keywords  jsonb,
  word_cloud    jsonb,
  insight       text
);

create index if not exists review_analysis_created_idx on public.review_analysis (created_at desc);
create index if not exists review_analysis_item_idx on public.review_analysis (item_id);

-- 개인용 도구 → anon 읽기/쓰기 허용 (selections와 동일 정책)
alter table public.review_analysis enable row level security;
drop policy if exists "ra_anon_all" on public.review_analysis;
create policy "ra_anon_all" on public.review_analysis for all using (true) with check (true);
