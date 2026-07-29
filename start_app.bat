@echo off
setlocal

rem Diagnostic launcher. Keeps the console open so startup errors stay visible.
rem Start.vbs is the entry point for daily use; both run start_app.py.
cd /d "%~dp0"

python start_app.py

echo.
echo ----------------------------------------------------------
echo Log folder: %LOCALAPPDATA%\WaveLog\logs
echo ----------------------------------------------------------
pause
