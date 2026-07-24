@echo off
setlocal

cd /d "%~dp0"
python -c "import flask,pyodbc" >nul 2>&1 || python -m pip install -r requirements.txt
rem ローカルDB(マスタ/測定データ)の置き場所をdbフォルダへ統一する。
rem 旧バージョンでリポジトリ直下やdataフォルダに置かれていたファイルが
rem 見つかった場合、db未作成なら一度だけそちらへ移動する(db側に同名
rem ファイルが既にあれば上書きしないため、繰り返し実行しても安全)。
if not exist "db" mkdir "db"
if exist "マスタ.sqlite3" if not exist "db\master.sqlite3" move "マスタ.sqlite3" "db\master.sqlite3" >nul
if exist "測定データ.sqlite3" if not exist "db\records.sqlite3" move "測定データ.sqlite3" "db\records.sqlite3" >nul
if exist "data\マスタ.sqlite3" if not exist "db\master.sqlite3" move "data\マスタ.sqlite3" "db\master.sqlite3" >nul
if exist "data\測定データ.sqlite3" if not exist "db\records.sqlite3" move "data\測定データ.sqlite3" "db\records.sqlite3" >nul
start "" "http://127.0.0.1:5029/?build=v29"

python app.py

pause
