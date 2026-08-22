@echo off
setlocal

rem WaveLog setup: run this once after install and after every update.
rem It checks Python / packages, pre-compiles bytecode into this PC's
rem local folder, and writes a readiness stamp so daily startup can skip
rem those checks. Start.vbs still works without it (just slower).
cd /d "%~dp0"

python setup_app.py
set RC=%ERRORLEVEL%

echo.
echo ----------------------------------------------------------
if "%RC%"=="0" (
  echo OK: 次回からの起動が速くなります。
) else (
  echo NG: 確認できませんでした。上の内容を確認してください。
)
echo ログ: %LOCALAPPDATA%\WaveLog\logs
echo ----------------------------------------------------------
pause
