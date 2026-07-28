-- ================================================
-- 키워드 일일 스냅샷 (매물수·가격중앙값 시계열)
-- ================================================
-- 배경: 네이버 쇼핑 검색 API는 평점·리뷰수·판매량을 주지 않는다(실측 확인).
-- 대신 매물수(total)와 가격은 실제로 주므로, 매일 저장해 시계열을 자체 생성한다.
-- "경쟁이 늘고 있나 / 가격이 무너지고 있나"는 MD에게 리뷰수보다 직접적인 신호다.
--
-- 기존엔 브라우저 localStorage에만 쌓아서 (1) PC를 끄면 안 쌓이고
-- (2) 대시보드를 안 열면 안 쌓이고 (3) 기기마다 따로 놀았다.
-- 서버(pg_cron)로 옮겨 컴퓨터·브라우저와 무관하게 매일 쌓이게 한다.

-- 1) 추적 대상 키워드
create table if not exists public.keyword_track (
  keyword    text primary key,
  source     text not null default 'search',   -- 'seed' | 'search'
  last_seen  timestamptz not null default now()
);

-- 2) 일일 스냅샷 (키워드 × 날짜 1건)
create table if not exists public.keyword_snapshot (
  keyword     text not null,
  d           date not null,
  total       integer,                          -- 네이버 매물 수
  med         integer,                          -- 가격 중앙값(원)
  created_at  timestamptz not null default now(),
  primary key (keyword, d)
);

create index if not exists keyword_snapshot_kw_d_idx
  on public.keyword_snapshot (keyword, d desc);

-- 3) RLS — 화면에서 읽기만 허용, 쓰기는 service_role(Edge Function)만
alter table public.keyword_track    enable row level security;
alter table public.keyword_snapshot enable row level security;

drop policy if exists "snapshot_anon_select" on public.keyword_snapshot;
create policy "snapshot_anon_select" on public.keyword_snapshot for select using (true);

drop policy if exists "track_anon_select" on public.keyword_track;
create policy "track_anon_select" on public.keyword_track for select using (true);

-- 4) 매일 아침 7:40 KST 수집 (일일 보고서 07:30 직후)
--    pg_cron은 UTC 기준 → 07:40 KST = 22:40 UTC(전날)
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('gamja-keyword-snapshot')
where exists (select 1 from cron.job where jobname = 'gamja-keyword-snapshot');

select cron.schedule(
  'gamja-keyword-snapshot',
  '40 22 * * *',
  $$
  select net.http_post(
    url := 'https://xjmktxwnyesxvvigypqj.supabase.co/functions/v1/dynamic-action/market-api/api/snapshot/collect',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'sb_publishable_Ow0OEYmKjVHC54phH2ib8g_wD2vY-cr',
      'Authorization', 'Bearer sb_publishable_Ow0OEYmKjVHC54phH2ib8g_wD2vY-cr'
    )
  );
  $$
);

-- 확인용:
--   select * from cron.job where jobname = 'gamja-keyword-snapshot';
--   select keyword, count(*) from public.keyword_snapshot group by 1 order by 2 desc limit 20;
--   select d, count(*) from public.keyword_snapshot group by 1 order by 1 desc limit 14;
