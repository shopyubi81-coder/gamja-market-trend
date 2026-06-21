@echo off
chcp 65001 > nul
echo.
echo  ===================================
echo   Windows 작업 스케줄러 등록
echo   매일 오전 7:30 자동 시작
echo  ===================================
echo.

SET TASK_NAME=GamjaMarketTrend
SET TASK_PATH=%~dp0start.bat

schtasks /create /tn "%TASK_NAME%" /tr "\"%TASK_PATH%\"" /sc daily /st 07:30 /f /rl highest

if %errorlevel% == 0 (
  echo.
  echo  ✅ 등록 완료! 매일 오전 7:30에 자동 실행됩니다.
  echo.
  echo  확인: 작업 스케줄러 앱 열기 → GamjaMarketTrend
  echo  삭제: schtasks /delete /tn "GamjaMarketTrend" /f
) else (
  echo.
  echo  ❌ 등록 실패. 관리자 권한으로 실행해주세요.
  echo  (마우스 우클릭 → 관리자 권한으로 실행)
)
echo.
pause
