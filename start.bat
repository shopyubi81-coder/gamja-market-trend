@echo off
chcp 65001 > nul
echo.
echo  ===================================
echo   감자마켓 트렌드 대시보드 시작
echo  ===================================
echo.
cd /d "%~dp0"
node server.js
pause
