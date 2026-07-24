@echo off
setlocal

cd /d "%~dp0"
python -c "import flask,pyodbc" >nul 2>&1 || python -m pip install -r requirements.txt
rem 旧マスタ.accdb/測定データ.accdbが残っていても、ここでは移行を自動実行しない
rem (Accessドライバの状態次第でここが止まるとアプリ自体が起動できなくなるため)。
rem 見つかった場合は案内のみ表示し、必要であれば migrate_to_sqlite.bat を
rem 別途手動で一度だけ実行してもらう。
if exist "マスタ.accdb" echo [案内] マスタ.accdbが見つかりました。データを引き継ぐ場合は migrate_to_sqlite.bat を一度実行してください。
if exist "測定データ.accdb" echo [案内] 測定データ.accdbが見つかりました。データを引き継ぐ場合は migrate_to_sqlite.bat を一度実行してください。
start "" "http://127.0.0.1:5029/?build=v29"

python app.py

pause
