@echo off
setlocal

cd /d "%~dp0"
python -c "import flask,pyodbc" >nul 2>&1 || python -m pip install -r requirements.txt
rem Consolidate local DB files into the db folder.
rem If files from an older layout (repo root or a "data" folder) are
rem found and not yet present under db, move them there once.
rem Safe to run repeatedly: an existing file under db is never overwritten.
if not exist "db" mkdir "db"
if exist "マスタ.sqlite3" if not exist "db\master.sqlite3" move "マスタ.sqlite3" "db\master.sqlite3" >nul
if exist "測定データ.sqlite3" if not exist "db\records.sqlite3" move "測定データ.sqlite3" "db\records.sqlite3" >nul
if exist "data\マスタ.sqlite3" if not exist "db\master.sqlite3" move "data\マスタ.sqlite3" "db\master.sqlite3" >nul
if exist "data\測定データ.sqlite3" if not exist "db\records.sqlite3" move "data\測定データ.sqlite3" "db\records.sqlite3" >nul

rem Open the waiting screen, not the app URL. It polls the backend and
rem moves to the app only after the server actually answers, so the
rem browser never shows a connection error when it wins the race.
start "" "%~dp0loading.html"

python app.py

pause
