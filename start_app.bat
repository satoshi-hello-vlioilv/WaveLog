@echo off
setlocal

cd /d "%~dp0"

echo ==========================================
echo Measurement Data Transfer System
echo ==========================================
echo.

echo [1/5] Stop existing server on port 5029...

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5029" ^| findstr "LISTENING"') do (
    echo Stop PID %%a
    taskkill /F /PID %%a >nul 2>&1
)

echo.
echo [2/5] Check Python...

python --version >nul 2>&1
if errorlevel 1 (
    echo Python is not installed or PATH is not set.
    pause
    exit /b 1
)

echo OK

echo.
echo [3/5] Check Flask...

python -c "import flask" >nul 2>&1
if errorlevel 1 (
    echo Flask is not installed.
    echo Installing Flask...
    python -m pip install Flask

    if errorlevel 1 (
        echo Failed to install Flask.
        pause
        exit /b 1
    )
)

echo OK

echo.
echo [4/5] Install required packages...

if exist requirements.txt (
    python -m pip install -r requirements.txt

    if errorlevel 1 (
        echo Failed to install requirements.
        pause
        exit /b 1
    )
) else (
    echo requirements.txt was not found.
)

echo OK

echo.
echo [5/5] Start server...

start "" "http://127.0.0.1:5029/?build=v29"

python app.py

pause
