@echo off
setlocal

rem WaveLog update: run this once after install and after every update.
rem It checks Python / packages, pre-compiles bytecode into this PC's
rem local folder, and writes a readiness stamp so daily startup can skip
rem those checks. Start.vbs still works without it (just slower).
rem
rem The wording the user reads lives in program/setup_app.py - one place
rem only (this file cannot know whether each step passed). The only case
rem this file has to explain by itself is 'python' not being on PATH,
rem because then setup_app.py never runs.
rem
rem Save this file with CRLF line endings (and CP932). With LF-only
rem endings cmd.exe resumes the batch at the wrong byte offset and runs
rem fragments of these very lines as commands.
cd /d "%~dp0.."

python program\setup_app.py
set RC=%ERRORLEVEL%

if "%RC%"=="9009" goto nopython
goto tail

:nopython
echo.
echo ============================================================
echo   WaveLog  起動の準備
echo ============================================================
echo   [NG] Python が見つかりません（コマンド python が通っていません）
echo.
echo   次にすること
echo     Python を入れて「Add python.exe to PATH」を有効にしてから、
echo     もう一度この update.bat を実行してください。
echo ============================================================

:tail
pause
