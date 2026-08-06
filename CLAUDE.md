# WaveLog 開発メモ（AIアシスタント向け）

構成の詳細は `docs/ARCHITECTURE.md`、機能と起動方法は `README.md` を参照。

## 必ず守ること

- **サーバー再起動**: `app.py`/`templates`/`static` を変更したら
  `python3 process_manager.py stop` → `python3 -u start_app.py` で再起動してから
  確認する（自動リロード無効。再起動忘れは過去に誤診断の原因になった）。
  `pkill`でPythonをプロセス名だけで一括終了しないこと（他のPythonを巻き添えに
  する。停止は必ず`process_manager.py`経由）。
- **起動基盤に触るとき**: 起動・停止・監視の処理は `start_app.py` /
  `backend/launcher/guard.py` / `backend/launcher/server.py` /
  `process_manager.py` / `backend/watchdog.py` が所有する。業務APIをこれらへ足さない（逆に`app.py`へ起動制御を戻さない）。
  ポート・アプリID・表示名などのアプリ固有値は `backend/config.py` に集約
  してあるので、他ファイルへ直接書かない。`backend/launcher/server.py`の`flask_app.run(...)`から
  **`threaded=True`を外さないこと**（既定のシングルスレッドに戻すと、仕掛/
  品質データ等ネットワーク共有I/Oが不調で1件のリクエストが長時間ブロックした
  だけで、ハートビート・停止スクリプトの生存確認まで一切応答できなくなり、
  自動終了もstop.batでの停止も効かなくなる不具合が実際に発生した）。
  設計の背景と今後の再編計画は `docs/REBUILD_PLAN.md` を参照。
- **バージョン更新**: 意味のある変更をコミットするたびに
  `backend/changelog_data.py` の `APP_VERSION` を上げ、`CHANGELOG` 先頭へ
  エントリを追記する（新しい順）。
- **関数の定義は1箇所**: コア5ファイル内で同名関数を再定義しない。
  拡張ファイルからは `const base=fn; fn=function(){...base()...}` のラップのみ可、
  全置換は不可。IIFE内から公開する関数は `window.X=X` を明示。
- **`window.*`への新規公開は名前空間経由**: 既存の約70件は動いている契約
  なのでそのまま（触らない）。**新しく公開するものは`window.WL.*`か機能別の
  名前空間（`scCore`等）に入れる**こと。素の`window.X`を増やすと、
  ファイル間の暗黙の契約が増えて読み込み順への依存が見えなくなる。
  **呼び出し側も`WL.enterView(...)`のように名前空間付きで書く**（どのファイルの
  機能に依存しているかが呼び出し箇所で分かるのが目的なので、定義がグローバル
  関数宣言でも素の名前では呼ばない）。現在`WL`にあるのは
  `registerView`/`enterView`/`withInternalDbSwitch`/`isInternalDbSwitch`/`ttlCache`/
  `refreshScheduleIfOpen`。
- **新しいキャッシュは`WL.ttlCache()`を使う**（`base.js`）。期限切れの判定・件数の
  上限・取得中のPromise共有（同時呼び出しを1回にまとめ、失敗したPromiseは
  捨てて再試行できるようにする）を持つ。**既存のキャッシュは置き換えない**
  ——それぞれ無効化の条件が業務仕様と絡んでおり（例: §9.67の作業可否は
  「一度可になったら再取得しない」）、一括置換はその仕様を落とす。
- **列表示マスタ**: `/api/table` は表示設定で列を落とす。内部計算用の
  問い合わせには `include_hidden=1` を付ける。
- **フィールド名**: Accessの実カラム名は全角/半角ゆれがある。照合は
  `normalizedFieldName`/`exactFieldNumber` 系を使い、直接文字列比較しない。
  分割関連の実カラム名は「親子管理_子カード<N>」「コンマ5本分割_切断巾<N>」
  （旧VBA名 KOCARD/K05JO はエイリアスであり実カラム名ではない）。
- **接続先はすべてSQLite（Access接続は廃止）**: 仕掛(SIKALOTNOW)・品質データ
  (SIKALOTDEF)・マスタ(`db/master.sqlite3`)・測定データバックアップ
  (`db/records.sqlite3`)のいずれも`.sqlite3`で読む。以前はpyodbc経由でAccessにも
  接続できたが、実機を含め全てSQLiteで構築するため`connect()`をSQLite専用にした
  （pyodbcへの依存も外したので、実機にAccessランタイムは不要）。
  古い設定が残っていても黙って落ちないよう、`.accdb`/`.mdb`が指定されていたら
  `_reject_access_path()`が対処を添えて弾く。
  **`connect()`が登録するNow()/Nz()/CStr()/Val()は消さないこと**——
  `backend/masters.py`のSQLは今もこのAccess方言で書かれており、これらの
  ユーザー定義関数が吸収している（消すと全マスタSQLの書き換えが要る）。
  同様に、有効フラグの`-1`と項目名の全角/半角ゆれ吸収もAccess由来だが
  **データ側の資産**なので接続の統一とは無関係に残る。**UNC共有パス(`\\server\share\...`)上の`.sqlite3`を読み取り専用で
  開く際は要注意**: `connect()`はfile: URIで開くが、pathlib標準の`as_uri()`が
  返す2スラッシュ形式(`file://server/share/...`)だとサーバー名をURIの
  authorityと解釈され、`SQLITE_ALLOW_URI_AUTHORITY`無しでビルドされた標準的な
  sqlite3では`invalid uri authority`で拒否される。`connect()`内の
  `_sqlite_ro_uri()`が4スラッシュ形式(`file:////server/share/...`)へ組み立て
  直して回避しているため、この関数を経由せず独自にURIを組み立てるコードを
  追加しないこと。仕掛/品質データの読み込み先自体はパス設定マスタ(下記、マスタ管理
  画面の「パス設定」タブ)の`sikalotnow_path`/`sikalotdef_path`で上書き可能で、
  **この2項目とsikalot_source/records_backup_export_path/
  schedule_share_pathは、接続先をプロセス起動時に1回だけ確定させる設計のため、
  マスタ管理画面で保存してもサーバー再起動まで反映されない**（画面内の「保存値」
  「現在有効な値」の一覧で反映状況を確認できる）。サンドボックス検証で一時的に
  使う場合は検証後にマスタ管理 > パス設定から既定のネットワーク共有パスへ
  戻してから再起動すること（戻し忘れると以降の起動が上書き先を読み続けてしまう）。
- **マスタの保存先は`db/master.sqlite3`に集約**: 共有の`schedule.sqlite3`
  （ネットワーク共有上、`backend/schedule_sync.py`がロック＋改訂番号で排他制御）
  に置くのは**`作業予定`だけ**。設定系の4マスタ（稼働カレンダー・設備停止・
  負荷率上書き・勤務形態）は`master.sqlite3`側にある。共有DBに置くと共有が
  不調なときマスタ管理すら開けず、1件の変更にもロック→取得→適用→反映の
  サイクルが要るため。`backend/repositories/schedule_repo.py`のCRUD関数は
  接続`c`を引数に取るだけなので、**呼び出し側が渡す接続で保存先が決まる**
  （`sr.config_master_conn()`がmaster側の接続）。スケジュール系のコードを
  触るときは、その読み書きがどちらのDBに対してかを必ず意識すること
  （`plan_add`が設備停止マスタを引く箇所のように、共有接続のまま残すと
  そこだけ壊れる）。詳細は`docs/SCHEDULE_MODE_DESIGN.md`§9.27。
- **パス設定マスタ**（`db/master.sqlite3`、`backend/db_access.py`の
  `PATH_CONFIG_TABLE`）: 仕掛/品質データの読み込み先・共有パス・各種間隔設定
  （旧`config/local.json`）を保存する。キー1件=1行で、値の無い項目は行自体が
  無い＝既定値を使う（他マスタと同じ互換ポリシー）。CRUD APIは`backend/routes/
  path_config.py`の`/api/path-config-master`、UIはマスタ管理画面の「パス設定」タブ
  （`static/js/master-maint.js`のMASTER_DEFS、key:pathConfig）。
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
- **フォルダ構成**: リポジトリ直下のPythonは**直接実行されるものだけ**
  (`app.py`/`start_app.py`/`process_manager.py`/`_pycache_bootstrap.py`)。
  importされるだけの起動部品は`backend/launcher/`へ置く
  (`guard.py`=旧launch_guard.py、`server.py`)。起動スクリプト
  (`Start.vbs`/`start_app.bat`/`stop.bat`)が直接呼ぶのは残留組だけなので、
  **CP932の`start_app.bat`に触る必要はない**。
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
  `_WRITE_ALLOWED_MODES`に含まれるか必ず確認すること**。未宣言のBlueprintは
  **fail-open(素通し)** で、閲覧モードからでも書けてしまう
  （`if allowed is None: return None`。以前ここには「安全側＝書込不可へ倒れる」と
  逆の説明が書かれていたが、実際にテスト用Blueprintを登録して確かめたところ
  edit/view/scheduleの全モードで200が返る）。
  また`_ENDPOINT_EXTRA_MODES`と`_READ_ONLY_POST_ENDPOINTS`のキーは
  `Blueprint名.関数名`なので、**エンドポイントを別のBlueprintへ移すだけで
  許可が黙って変わる**。移動時は必ず両方の表を更新し、`tests/test_modeguard.py`
  （モード×エンドポイントの許可表を固定するテスト）で確認する。
  既存の許可モードを広げたい場合のみ`_ENDPOINT_EXTRA_MODES`へ個別追記し、
  ハンドラ側でも権限を二重チェックする。
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

- **回帰テストは `tests/` にある。実行は `tests/run_all.sh` だけ**（478件）。
  引数にテスト名を並べるとそれだけ実行する（`tests/run_all.sh test_sccat`）。
  ランナーがパス設定マスタの退避→検証用フィクスチャへ差し替え→復元まで
  行うので、**手でパスを戻す必要はない**（`trap`で異常終了時も戻し、退避値は
  `tests/.saved_paths.json`にも残すのでコンテナごと落ちても次回が復元する）。
  テストを書くときの約束（後始末は`finally`・**落ちてもブラウザを閉じる**・
  固定待ち禁止・識別子は実行ごとに一意）は `tests/README.md` に、
  フィクスチャの作り直しは `python3 tests/make_fixture.py` にある。以前は
  scratchpad に置いておりセッションのたびに消えていた
  （`docs/REFACTORING_PLAN.md` フェーズ0で常設化）。
- **テストがブラウザを閉じずに落ちると連鎖する**: 残ったChromiumが設備の
  編集セッションを掴んだままハートビートを打ち続け、後続のスケジュール系の
  書込が全て「編集中です」で弾かれる（実際に1本のFATALから8本が落ち、
  ロックが効かない・並べ替えが反映されないという別々の不具合に見えた）。
  各テストは終了処理で必ず閉じ、ランナーも1本ごとに掃除する。
- Playwright ヘッドレス（Chromium: `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`、
  `NODE_PATH=/opt/node22/lib/node_modules`）。環境が違う場合は
  `WAVELOG_CHROMIUM`/`WAVELOG_PLAYWRIGHT`/`WAVELOG_NODE` で上書きする。
- **接続先が全てSQLiteになったため、仕掛/品質データ系API(`/api/table`等)も
  モック無しで検証できる**。ランナーが`db/test_fixture/`の`.sqlite3`を指すので、
  実際にサーバー経由で読める（以前はAccessドライバが無く500を返すため
  `page.route`でモックしていた。その必要は無い）。
- `openMeasurement`/`resumeStoredMeasure` は内部のマスタ問い合わせ失敗で
  例外を投げ得る。後続処理を確実に実行したいラップは `finally` に置く。

## Git

- 開発は featureブランチ（現行: `claude/path-config-master-management-djha13`）で行い、
  ユーザーの明示指示があった場合のみ main へマージする。
