-- ================================================
-- 일일 종합 보고서 테이블 + 매일 아침 자동 생성(cron)
-- ================================================

-- 1) 보고서 저장 테이블
create table if not exists public.daily_report (
  date        date primary key,
  data        jsonb,
  created_at  timestamptz not null default now()
);

-- 화면에서 읽을 수 있게 익명 조회 허용(쓰기는 service_role만)
alter table public.daily_report enable row level security;
drop policy if exists "report_anon_select" on public.daily_report;
create policy "report_anon_select" on public.daily_report for select using (true);

-- 2) 매일 아침 7:30(KST) 자동 생성
--    pg_cron은 UTC 기준 → 07:30 KST = 22:30 UTC(전날)
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 기존 작업이 있으면 제거 후 재등록
select cron.unschedule('gamja-daily-report')
where exists (select 1 from cron.job where jobname = 'gamja-daily-report');

select cron.schedule(
  'gamja-daily-report',
  '30 22 * * *',
  $$
  select net.http_post(
    url := 'https://xjmktxwnyesxvvigypqj.supabase.co/functions/v1/dynamic-action/market-api/api/report/generate',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'sb_publishable_Ow0OEYmKjVHC54phH2ib8g_wD2vY-cr',
      'Authorization', 'Bearer sb_publishable_Ow0OEYmKjVHC54phH2ib8g_wD2vY-cr'
    )
  );
  $$
);
