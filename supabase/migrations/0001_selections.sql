-- ================================================
-- 감자마켓 선별목록 테이블
-- ================================================
-- MD가 선별한 상품을 저장 → PC·모바일 어디서나 동기화

create table if not exists public.selections (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  item_id       text not null,                 -- 프론트의 상품 고유 id (중복 방지용)
  name          text not null,                 -- 상품명
  platform      text,                          -- coupang / naver / instagram / china
  category      text,                          -- 대분류
  sub_category  text,                          -- 상세분류
  price_text    text,                          -- 가격 표시
  trend         text,                          -- 변화 (예: +23%, NEW)
  score         text,                          -- 점수/지표
  note          text,                          -- 트렌드 비고
  md_note       text,                          -- MD 메모
  image         text,                          -- 상품 이미지 URL
  link          text,                          -- 상품 링크
  payload       jsonb,                         -- 원본 데이터 전체 보관
  device_label  text                           -- 어느 기기에서 선별했는지
);

-- 같은 상품 중복 선별 방지
create unique index if not exists selections_item_id_key on public.selections (item_id);

-- 최신순 조회 인덱스
create index if not exists selections_created_at_idx on public.selections (created_at desc);

-- ================================================
-- RLS (Row Level Security)
-- ================================================
-- 개인용 MD 도구라 익명(anon) 키로 읽기/쓰기를 허용합니다.
-- 추후 로그인 기능을 붙이면 정책을 사용자 기준으로 좁힐 수 있습니다.
alter table public.selections enable row level security;

drop policy if exists "anon_all_select" on public.selections;
drop policy if exists "anon_all_insert" on public.selections;
drop policy if exists "anon_all_delete" on public.selections;
drop policy if exists "anon_all_update" on public.selections;

create policy "anon_all_select" on public.selections for select using (true);
create policy "anon_all_insert" on public.selections for insert with check (true);
create policy "anon_all_delete" on public.selections for delete using (true);
create policy "anon_all_update" on public.selections for update using (true);
