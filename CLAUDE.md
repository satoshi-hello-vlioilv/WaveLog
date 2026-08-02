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
  している。仕掛/品質データの読み込み先自体は`config/local.json`の
  `sikalotnow_path`/`sikalotdef_path`で上書き可能で、拡張子が`.sqlite3`等なら
  自動的にSQLiteとして読む（`db_access.py`の`_engine_for`）。サンドボックス検証で
  一時的に使う場合は検証後に`config/local.json`を削除し、既定のAccdb/ネットワーク
  共有パスへ戻してから再起動すること（削除せず放置すると以降の起動が上書き先を
  読み続けてしまう）。
- **仕掛/品質データのローカル運用**: `config/local.json`の`sikalot_source`を
  `local`にすると、ネットワーク共有ではなく`backend/rne_scheduler.py`が
  定期的にRNE(Navigator問い合わせ定義)から抽出・更新する
  `db/sikalotnow.sqlite3`/`db/sikalotdef.sqlite3`を読む運用に切り替わる
  （2DBまとめて1スイッチ）。抽出間隔は`rne_extract_interval_sec`（既定900秒、
  下限60秒）。実処理はWindows専用（`backend/navigator_api.py`が`SymNaviA.dll`を
  ctypesで直接呼ぶ）で、ジョブごとに独立サブプロセス（`backend/rne_worker.py`）
  として並列実行する。RNEファイル・`SymNaviA.dll`・`symnavim.conf`は機密/
  サイト固有のためコミットせず`config/rne_extract/`へPCごとに手動配置する
  （`config/rne_extract/README.md`参照、`.gitignore`済み）。検証後は
  `sikalot_source`を戻し忘れないこと（上記と同じ理由）。詳細は
  `docs/ARCHITECTURE.md`の「仕掛/品質データのローカル運用」節を参照。
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
