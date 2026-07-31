@echo off
chcp 65001 >nul
setlocal
rem === 엔티렉스(디바이스마트) 가격 크롤러 실행기 (Windows) ===
rem  이 파일이 있는 폴더에 ntrex-price.mjs / ntrex-list.json / .env 가 함께 있어야 합니다.
pushd "%~dp0"
set "LOGDIR=%~dp0logs"
if not exist "%LOGDIR%" mkdir "%LOGDIR%"
set "LAST=%LOGDIR%\ntrex-last.log"
set "HIST=%LOGDIR%\ntrex-history.log"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 가 설치되어 있지 않습니다. https://nodejs.org 에서 LTS 를 설치한 뒤 다시 실행하세요.
  echo [%date% %time%] ERROR node-missing>> "%HIST%"
  popd & endlocal & exit /b 1
)
if not exist "%~dp0.env" (
  echo .env 파일이 없습니다.  .env.example 을 .env 로 복사한 뒤 STORE_URL 을 확인하세요.
  echo [%date% %time%] ERROR env-missing>> "%HIST%"
  popd & endlocal & exit /b 1
)

echo [%date% %time%] NTREX 크롤러 시작 ...
echo [%date% %time%] start>> "%HIST%"
node "%~dp0ntrex-price.mjs" > "%LAST%" 2>&1
set "RC=%errorlevel%"
echo [%date% %time%] end rc=%RC%>> "%HIST%"
echo [%date% %time%] 종료(코드 %RC%). 상세 로그: %LAST%
popd & endlocal & exit /b %RC%
