-- ================================================
-- 발굴 후보 풀 (쿠팡 실시간 인기 → 네이버 분류로 정제)
-- ================================================
-- 배경: 자동 발굴이 하드코딩 시드 56개만 순회해서, 그 밖의 상품은
-- 영원히 후보로 나올 수 없었다(발굴 도구인데 발굴 범위가 고정).
--
-- 방식: 쿠팡 골드박스+카테고리베스트(지금 실제로 팔리는 것)에서 거친 토큰을 뽑고,
-- 네이버 검색의 subCategory(네이버가 관리하는 분류명)로 정규화한다.
-- 한국어 형태소 분석이나 불용어 목록 없이도 브랜드명·속성어가 걸러진다.
--   햇반 → 일반즉석밥 / 제주삼다수 → 생수 / 탐사 → 응고형모래 / 고려은단 → 비타민C
--
-- keyword_track에 컬럼을 더해 풀을 저장한다. 여기 들어온 키워드는
-- 기존 스냅샷 크론(07:40)이 자동으로 매일 적립하기 시작한다.

alter table public.keyword_track add column if not exists naver_cat text;
alter table public.keyword_track add column if not exists total     integer;
alter table public.keyword_track add column if not exists med       integer;
alter table public.keyword_track add column if not exists added_at   timestamptz not null default now();

create index if not exists keyword_track_source_idx on public.keyword_track (source, last_seen desc);

-- 매일 아침 7:20 KST 후보 풀 갱신 (스냅샷 수집 07:40 보다 먼저)
--   07:20 KST = 22:20 UTC(전날)
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('gamja-discovery-pool')
where exists (select 1 from cron.job where jobname = 'gamja-discovery-pool');

select cron.schedule(
  'gamja-discovery-pool',
  '20 22 * * *',
  $$
  select net.http_post(
    url := 'https://xjmktxwnyesxvvigypqj.supabase.co/functions/v1/dynamic-action/market-api/api/discovery/pool/refresh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'sb_publishable_Ow0OEYmKjVHC54phH2ib8g_wD2vY-cr',
      'Authorization', 'Bearer sb_publishable_Ow0OEYmKjVHC54phH2ib8g_wD2vY-cr'
    )
  );
  $$
);

-- 확인용:
--   select source, count(*) from public.keyword_track group by 1;
--   select keyword, naver_cat, total, med from public.keyword_track
--     where source = 'coupang' order by added_at desc limit 30;
