@echo off
setlocal

rem WaveLog update: run this once after install and after every update.
rem It checks Python / packages, pre-compiles bytecode into this PC's
rem local folder, and writes a readiness stamp so daily startup can skip
rem those checks. Start.vbs still works without it (just slower).
rem
rem Save this file with CRLF line endings (and CP932). With LF-only
rem endings cmd.exe resumes the batch at the wrong byte offset and runs
rem fragments of these very lines as commands.
cd /d "%~dp0"

python program\setup_app.py
set RC=%ERRORLEVEL%

echo.
echo ----------------------------------------------------------
if "%RC%"=="0" goto ok
if "%RC%"=="9009" goto nopython
echo NG: 確認できませんでした。上の内容を確認してください。
goto tail

:ok
echo OK: 次回からの起動が速くなります。
echo     次に実行するのは、アプリを新しくしたときです。
goto tail

:nopython
echo NG: Python が見つかりません（コマンド python が通っていません）。
echo     Python を入れて「Add python.exe to PATH」を有効にしてから、
echo     もう一度この update.bat を実行してください。

:tail
echo ログ: %LOCALAPPDATA%\WaveLog\logs
echo ----------------------------------------------------------
pause
