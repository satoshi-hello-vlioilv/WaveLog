# WaveLog 開発メモ（AIアシスタント向け）

構成の詳細は `docs/ARCHITECTURE.md`、機能と起動方法は `README.md` を参照。

## 必ず守ること

- **サーバー再起動**: `app.py`/`templates`/`static` を変更したら
  `python3 process_manager.py stop` → `python3 -u start_app.py` で再起動してから
  確認する（自動リロード無効。再起動忘れは過去に誤診断の原因になった）。
  `pkill`でPythonをプロセス名だけで一括終了しないこと（他のPythonを巻き添えに
  する。停止は必ず`process_manager.py`経由）。
- **起動基盤に触るとき**: 起動・停止・監視の処理は `start_app.py` /
  `launch_guard.py` / `server.py` / `process_manager.py` / `backend/watchdog.py`
  が所有する。業務APIをこれらへ足さない（逆に`app.py`へ起動制御を戻さない）。
  ポート・アプリID・表示名などのアプリ固有値は `backend/config.py` に集約
  してあるので、他ファイルへ直接書かない。
  設計の背景と今後の再編計画は `docs/REBUILD_PLAN.md` を参照。
- **バージョン更新**: 意味のある変更をコミットするたびに
  `backend/changelog_data.py` の `APP_VERSION` を上げ、`CHANGELOG` 先頭へ
  エントリを追記する（新しい順）。
- **関数の定義は1箇所**: コア5ファイル内で同名関数を再定義しない。
  拡張ファイルからは `const base=fn; fn=function(){...base()...}` のラップのみ可、
  全置換は不可。IIFE内から公開する関数は `window.X=X` を明示。
- **列表示マスタ**: `/api/table` は表示設定で列を落とす。内部計算用の
  問い合わせには `include_hidden=1` を付ける。
- **フィールド名**: Accessの実カラム名は全角/半角ゆれがある。照合は
  `normalizedFieldName`/`exactFieldNumber` 系を使い、直接文字列比較しない。
  分割関連の実カラム名は「親子管理_子カード<N>」「コンマ5本分割_切断巾<N>」
  （旧VBA名 KOCARD/K05JO はエイリアスであり実カラム名ではない）。
- **DBエンジンの使い分け**: 仕掛(SIKALOTNOW)・品質データ(SIKALOTDEF)は工場側の
  別システムが所有するネットワーク共有上の読み取り専用Accessファイルのため、
  既定は今後もpyodbc経由でAccessのまま読む。マスタ(`db/master.sqlite3`)・測定
  データバックアップ(`db/records.sqlite3`)は本アプリ自身が読み書きするローカルの
  SQLiteで、`backend/db_access.py`の`connect()`がパス拡張子でAccess/SQLiteを
  自動判別する。`backend/masters.py`のSQLはNow()/Nz()等のAccess関数をそのまま
  使っているが、`connect()`がSQLite接続へユーザー定義関数として登録して吸収
  している。**UNC共有パス(`\\server\share\...`)上の`.sqlite3`を読み取り専用で
  開く際は要注意**: `connect()`はfile: URIで開くが、pathlib標準の`as_uri()`が
  返す2スラッシュ形式(`file://server/share/...`)だとサーバー名をURIの
  authorityと解釈され、`SQLITE_ALLOW_URI_AUTHORITY`無しでビルドされた標準的な
  sqlite3では`invalid uri authority`で拒否される。`connect()`内の
  `_sqlite_ro_uri()`が4スラッシュ形式(`file:////server/share/...`)へ組み立て
  直して回避しているため、この関数を経由せず独自にURIを組み立てるコードを
  追加しないこと。仕掛/品質データの読み込み先自体はパス設定マスタ(下記、マスタ管理
  画面の「パス設定」タブ)の`sikalotnow_path`/`sikalotdef_path`で上書き可能で、
  拡張子が`.sqlite3`等なら自動的にSQLiteとして読む（`db_access.py`の
  `_engine_for`）。**この2項目とsikalot_source/records_backup_export_path/
  schedule_share_pathは、接続先をプロセス起動時に1回だけ確定させる設計のため、
  マスタ管理画面で保存してもサーバー再起動まで反映されない**（画面内の「保存値」
  「現在有効な値」の一覧で反映状況を確認できる）。サンドボックス検証で一時的に
  使う場合は検証後にマスタ管理 > パス設定から既定のAccdb/ネットワーク共有パスへ
  戻してから再起動すること（戻し忘れると以降の起動が上書き先を読み続けてしまう）。
- **パス設定マスタ**（`db/master.sqlite3`、`backend/db_access.py`の
  `PATH_CONFIG_TABLE`）: 仕掛/品質データの読み込み先・共有パス・各種間隔設定
  （旧`config/local.json`）を保存する。キー1件=1行で、値の無い項目は行自体が
  無い＝既定値を使う（他マスタと同じ互換ポリシー）。CRUD APIは`backend/routes/
  masters.py`の`/api/path-config-master`、UIはマスタ管理画面の「パス設定」タブ
  （`static/js/measurement-worklog.js`のMASTER_DEFS、key:pathConfig）。
  本来なら`backend/repositories/master_repo.py`が持つべき層だが、
  `db_access.py`自身が起動時に接続先を1回だけ確定させる必要があり
  `master_repo.py`はdb_accessに依存する側のため、循環importを避けて
  `db_access.py`内に自己完結させてある。`db_dir`/`master_db_path`/
  `records_db_path`（マスタDB自体の置き場所を決める3項目）だけは、値をマスタDBの
  中に保存すると読みに行く先が分からなくなる（鶏と卵）ため、引き続き
  `config/local.json`（唯一残るブートストラップ専用設定）でのみ上書きできる。
  `config/local.json`に残っていた他の値（旧`sikalotnow_path`等）は初回起動時に
  一度だけパス設定マスタへ自動移行される（`_migrate_legacy_path_config`。以後は
  移行済みの目印を残し、`config/local.json`の内容は二度と見ない。マスタ管理画面
  で空欄に戻して既定へ戻す操作が復活しないようにするため）。
- **仕掛/品質データのローカル運用**: パス設定マスタの`sikalot_source`を`local`に
  すると、ネットワーク共有ではなく`backend/rne_scheduler.py`が定期的にRNE
  (Navigator問い合わせ定義)から抽出・更新する`db/sikalotnow.sqlite3`/
  `db/sikalotdef.sqlite3`を読む運用に切り替わる（2DBまとめて1スイッチ、
  切替は再起動が必要）。抽出間隔は`rne_extract_interval_sec`（既定900秒、
  下限60秒、こちらは再起動不要で次回の周回から反映）。実処理はWindows専用
  （`backend/navigator_api.py`が`SymNaviA.dll`をctypesで直接呼ぶ）で、
  ジョブごとに独立サブプロセス（`backend/rne_worker.py`）として並列実行する。
  RNEファイル・`SymNaviA.dll`・`symnavim.conf`は機密/サイト固有のためコミットせず
  `config/rne_extract/`へPCごとに手動配置する（`config/rne_extract/README.md`
  参照、`.gitignore`済み）。検証後は`sikalot_source`を戻し忘れないこと
  （上記と同じ理由）。詳細は`docs/ARCHITECTURE.md`の「仕掛/品質データの
  ローカル運用」節を参照。
- **フォルダ構成**: `app.py`(エントリポイント)と`start_app.bat`はルート直下。
  それ以外のバックエンドPythonは`backend/`パッケージへ、ローカルDB
  (`master.sqlite3`/`records.sqlite3`、無ければ初回書き込み時に自動生成)は
  `db/`フォルダへまとめている。旧Access資産(`マスタ.accdb`等)は移行完了済みの
  ため撤去済み。
- **編集可能モード/閲覧モード/スケジュールモード**: `backend/access_mode.py`が起動時に
  ログインID+PC名をアクセス権限マスタ(`backend/repositories/master_repo.py`の
  ACCESS_PERMISSION_TABLE、`permission_flags()`が判定)と照合し、モードを決める
  (該当行が無ければ既定で編集可能)。書込ガードは`_WRITE_ALLOWED_MODES`
  (Blueprint名→書込を許可するモード集合)と`_ENDPOINT_EXTRA_MODES`(個別
  エンドポイント→追加で許可するモード。現場段取りの並べ替えAPI等)の2段で
  `before_request`が判定する。**新しい書込系APIを追加する場合、そのBlueprintが
  `_WRITE_ALLOWED_MODES`に含まれるか確認すること**(未宣言のBlueprintは安全側
  ＝どのモードでも書込不可の側へ倒れる。既存の許可モードを広げたい場合のみ
  `_ENDPOINT_EXTRA_MODES`へ個別追記し、ハンドラ側でも権限を二重チェックする)。
  詳細は`docs/SCHEDULE_MODE_DESIGN.md`§3を参照。フロント側の入口ガード・
  閲覧データの読み込みは`static/js/access-mode.js`(最後に読み込むファイル)が持つ。
- **start_app.batの文字コード**: このファイルは**CP932(Shift-JIS)で保存する**
  こと(UTF-8で日本語を含めるとWindowsのcmd.exeが誤読しコマンドが壊れる。
  実際に発生した不具合)。編集時はUTF-8で書いてから
  `iconv -f UTF-8 -t CP932//TRANSLIT start_app.bat -o start_app.bat` で変換する。
  `file start_app.bat` が `Non-ISO extended-ASCII text` になっていればCP932。
  可能な限り非ASCII文字(REMコメント等)は使わず、`マスタ.sqlite3`等の
  実ファイル名の一致に必要な箇所のみ日本語を使う。

## 検証

- Playwright ヘッドレス（Chromium: `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`、
  `NODE_PATH=/opt/node22/lib/node_modules`）。テストは scratchpad の `test_*.js`。
- サンドボックスにAccessドライバは無く、仕掛/品質データ系API(`/api/table`等、
  SIKALOTNOW/SIKALOTDEF)は接続先がAccessのままのため500を返す。実データ依存の
  検証は`page.route`でモックして行う。一方マスタ系API(`/api/operator-master`等)
  はSQLite化済みのため、サンドボックスでもモック無しで実際にサーバー経由の
  読み書きを検証できる。
- `openMeasurement`/`resumeStoredMeasure` は内部のマスタ問い合わせ失敗で
  例外を投げ得る。後続処理を確実に実行したいラップは `finally` に置く。

## Git

- 開発は featureブランチ（現行: `claude/quality-data-graph-layout-ban528`）で行い、
  ユーザーの明示指示があった場合のみ main へマージする。
