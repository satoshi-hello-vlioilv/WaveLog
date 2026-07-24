@echo off
setlocal

cd /d "%~dp0"
python -c "import flask,pyodbc" >nul 2>&1 || python -m pip install -r requirements.txt
start "" "http://127.0.0.1:5029/?build=v29"

python app.py

pause
