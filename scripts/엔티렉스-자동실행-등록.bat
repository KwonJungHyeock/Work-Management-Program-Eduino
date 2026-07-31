@echo off
chcp 65001 >nul
setlocal
rem === 매일 오전 10:00 자동 실행 등록 (Windows 작업 스케줄러) ===
rem  이 파일을 [마우스 우클릭 > 관리자 권한으로 실행] 하세요.
set "TN=Eduino-NTREX-크롤러"

schtasks /Create /SC DAILY /ST 10:00 /TN "%TN%" /TR "cmd /c \"%~dp0run-ntrex.bat\"" /F
if errorlevel 1 (
  echo.
  echo 등록에 실패했습니다.  이 파일을 [관리자 권한으로 실행] 했는지 확인하세요.
  echo.
  pause
  endlocal & exit /b 1
)
echo.
echo 등록 완료 — 매일 오전 10:00 에 자동으로 크롤링합니다.  (작업 이름: %TN%)
echo   - 지금 즉시 한번 테스트:  schtasks /Run /TN "%TN%"
echo   - 등록 취소:              schtasks /Delete /TN "%TN%" /F
echo   * 주의: 실행 시각에 PC 가 켜져 있고 로그인되어 있어야 합니다.
echo     (자리 비움/로그오프 상태에서도 돌리려면 작업 스케줄러 GUI 에서
echo      해당 작업 > 속성 > '사용자가 로그온하지 않아도 실행' 체크 후 비밀번호 입력)
echo.
pause
endlocal
