@echo off
setlocal
cd /d "%~dp0"
rem 旧マスタ.accdb/測定データ.accdbからマスタ.sqlite3/測定データ.sqlite3への
rem 一度限りの移行を手動で実行するためのバッチ。start_app.batからは呼ばれない
rem (通常のアプリ起動をこの処理の成否に依存させないため)。
rem migrate_to_sqlite.py自体が「移行先に既にデータがあれば中断」する安全策を
rem 持つため、誤って複数回実行しても実データを二重に書き込むことはない。
python -c "import flask,pyodbc" >nul 2>&1 || python -m pip install -r requirements.txt
python migrate_to_sqlite.py
pause
