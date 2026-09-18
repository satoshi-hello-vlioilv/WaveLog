@echo off
setlocal

rem Stops only this application. It first asks the app to shut down and
rem falls back to the recorded process id, so other Python programs on the
rem same PC are never touched.
cd /d "%~dp0"

python program\process_manager.py stop

pause
