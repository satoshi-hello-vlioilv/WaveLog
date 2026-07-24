@echo off
setlocal

cd /d "%~dp0"
python -c "import flask,pyodbc" >nul 2>&1 || python -m pip install -r requirements.txt
rem 旧マスタ.accdb/測定データ.accdbが残っていればSQLiteへ一度だけ移行する。
rem migrate_to_sqlite.py自体が「移行先に既にデータがあれば中断」する安全策を
rem 持つため、再度実行しても実データを二重に書き込むことはない。
set NEED_MIGRATE=0
if exist "マスタ.accdb" set NEED_MIGRATE=1
if exist "測定データ.accdb" set NEED_MIGRATE=1
if %NEED_MIGRATE%==1 python migrate_to_sqlite.py
start "" "http://127.0.0.1:5029/?build=v29"

python app.py

pause
