# WaveLog アーキテクチャ

このドキュメントは、コードを読む・変更する人向けの構成説明です。
機能一覧や起動方法は `README.md` を参照してください。

## 全体像

- **バックエンド**: Flask (`app.py`)。仕掛(`SIKALOTNOW.accdb`)・品質データ
  (`SIKALOTDEF.accdb`)は工場側の別システムが所有する読み取り専用のAccess
  ファイル(ネットワーク共有)を pyodbc で参照。マスタ・測定データバックアップは
  本アプリ自身が読み書きするローカルの SQLite(`sqlite3`標準ライブラリ)で、
  `db/` フォルダ配下に置く。ビルド工程なし。
  仕掛/品質データの読み込み先ファイル自体もパス設定マスタ(`db/master.sqlite3`、
  マスタ管理画面の「パス設定」タブから編集)の`sikalotnow_path`/`sikalotdef_path`
  で上書きでき、拡張子が`.sqlite3`等なら自動的にSQLiteとして読む
  （`db_access.py`の`_engine_for`）。工場側が将来SQLiteへ移行した場合や、
  検証用に手元へ複製したファイルを指す用途を想定。保存内容は次回のサーバー
  起動から反映される(接続先を決める値のためプロセス起動時に1回だけ解決する)。
- **フロントエンド**: `templates/index.html` 1枚 + プレーンな `<script>` タグで読み込む
  vanilla JS 群。バンドラ・フレームワークなし（現場PCへのコピー配布を想定）。
- **データ保存**: 測定データは端末の IndexedDB（+ localStorage ミラー）が主。
  完了時に `db/records.sqlite3` の `Web測定バックアップ` テーブルへJSONで退避。

## ディレクトリ構成

起動・停止に関わるファイル(`Start.vbs`/`start_app.bat`/`stop.bat`/
`start_app.py`/`launch_guard.py`/`server.py`/`process_manager.py`/
`loading.html`)と `app.py` をルート直下に置く。それ以外のバックエンド
ロジックは `backend/` パッケージへ、ローカルDBファイルは `db/` フォルダへ
まとめている(全体の一覧は `README.md` を参照)。

## 起動基盤

「起動しない」と「業務機能が動かない」を切り分けて調査できるよう、起動制御と
業務ロジックを分けている。設計の背景と今後の再編計画は
`docs/REBUILD_PLAN.md` を参照。

| ファイル | 役割 |
|---|---|
| `Start.vbs` | 通常起動。コンソールを表示せず `start_app.py` を実行する |
| `start_app.bat` | 診断起動。コンソールを表示したまま同じ `start_app.py` を実行する |
| `stop.bat` | 明示停止。`process_manager.py stop` を呼ぶ |
| `start_app.py` | Python側の起動開始点。ログ初期化→待機画面を開く→多重起動判定→パッケージ確認→サーバー起動 |
| `launch_guard.py` | ポートの使用状況と `app_id` の照合による多重起動判定(`OURS`/`FOREIGN`/`UNRESPONSIVE`/`FREE`)、起動中インスタンスの記録。`UNRESPONSIVE`(ポート使用中だがHTTP応答が無い)は自プロセスが重い処理でブロックされている可能性を含むため、即座に別アプリ(`FOREIGN`)と決め付けず`process_manager.py`側でinstance.jsonのapp_root照合による強制終了判断へ委ねる |
| `server.py` | Webサーバーの起動のみ。起動監視とWeb処理の境界 |
| `process_manager.py` | 対象アプリだけの安全な停止（正常終了要求→記録済みPID。プロセス名では判定しない） |
| `loading.html` | 起動待機画面。サーバーより先に `file://` で開かれ、`/api/ready.js` の応答を待ってからアプリへ遷移する |
| `_pycache_bootstrap.py` | `.pyc` キャッシュをローカル領域へ逃がす。`sys.pycache_prefix` は最初のimportより前に設定する必要があるため、各エントリポイントの一番最初のimportにする |
| `config/local.json` | マスタDB自体の置き場所を決める3項目(`db_dir`/`master_db_path`/`records_db_path`)専用のブートストラップ設定(値をマスタDBの中に保存すると読みに行く先が分からなくなるため、この3つだけは唯一この方式が残る)。未配置なら既定の`db/`のまま。それ以外(`sikalotnow_path`/`sikalotdef_path`等)はパス設定マスタ(下記)へ移行済み |
| `backend/config.py` | アプリID・表示名・ポート・監視しきい値などアプリ固有値の集約先 |
| `backend/paths.py` | `%LOCALAPPDATA%` 配下の解決、共有フォルダー配置の検出、`config/local.json` の読込(`load_local_config`/`configured_path`。マスタDB自体の置き場所を決める3項目専用のブートストラップ設定。それ以外の運用設定はパス設定マスタ(`db_access.py`)へ移行済み) |
| `backend/logging_setup.py` | ログ初期化。`launcher.log`(起動・停止) と `app.log`(本体) の2系統 |
| `backend/watchdog.py` | プロセスの生存管理。ハートビート監視・明示停止(`/api/shutdown`) |

`_pycache_bootstrap.py` は `start_app.py`・`process_manager.py`・`server.py`・
`app.py` の4つすべてで最初にimportしている。単独で起動され得る経路が複数
あり、1箇所だけに書くと別経路で `.pyc` がアプリ側へ生成されてしまう
(`process_manager.py stop` を単体実行した際にこれが起きることを実測で確認し、
全エントリポイントへ追加した)。

起動待機画面は `file://` から開かれるため `fetch` ではCORSで応答を読めない。
生成元をまたいで読み込める script 要素で `/api/ready.js` を叩き、JSONP形式で
アプリ識別情報を受け取ってから遷移する。これによりブラウザとサーバーの
どちらが先に立ち上がっても接続エラー画面が出ない。

## バックエンド構成

`app.py` はFlaskインスタンスの生成とBlueprint登録のみを行う薄いエントリ
ポイント(405行→43行)。業務APIは目的別に `backend/routes/` へ分離してある。

| ファイル | 役割 |
|---|---|
| `app.py` | Flask本体の組み立て。Blueprint登録・キャッシュ無効化ヘッダ・ウォッチドッグ組み込みのみ |
| `backend/routes/core.py` | トップページ・`/api/build`・`/api/ready.js`・`/api/whoami`・`/api/changelog` |
| `backend/routes/tables.py` | 汎用DB一覧API(`/api/catalog`・`/api/tables`・`/api/table`) |
| `backend/routes/measurement.py` | 測定コンテキスト・マスタ診断・バックアップAPI |
| `backend/routes/quality.py` | 品質データ分析API(`/api/quality/analysis`) |
| `backend/routes/masters.py` | 各種マスタCRUDのBlueprint（設備/オペレータ/スプール/内径/機器/フィルタプリセット/列表示/アクセス権限/パス設定）。URLは分離前と同一。リクエスト受付とレスポンス整形のみを行い、データアクセスは`repositories/master_repo.py`(パス設定マスタのみ例外的に`db_access.py`)へ委譲 |
| `backend/repositories/master_repo.py` | 各種マスタのデータアクセス層。テーブル定義(`ensure_*_table`)・正規化(`normalize_*_name`)・読み取り(`*_master_rows`/`read_*_names`)・書き込み補助(`set_operator_equipment`/`set_hidden_columns`)。Flaskに依存しない |
| `backend/changelog_data.py` | `APP_VERSION` と `CHANGELOG`（データのみ。リリースごとにここを更新） |
| `backend/db_access.py` | `DBS`(接続先定義)・`APP_ROOT`/`DB_DIR`(パス基準)・`connect`/`cols`/`tables`/`qi`(Access/SQLite両対応)・監査列・バックアップテーブル整備・パス設定マスタ(`PATH_CONFIG_TABLE`、旧`config/local.json`。仕掛/品質データの読み込み先・共有パス・各種間隔設定を`db/master.sqlite3`側で管理し、`master_repo.py`と同じ形のCRUDヘルパを提供する) |
| `backend/records_export.py` | 測定データバックアップ(`records.sqlite3`)の閲覧用複製(定期・差分あり時のみ) |
| `backend/access_mode.py` | 編集可能モード/閲覧モードの判定・切替API・書込系APIのガード(`before_request`) |
| `backend/navigator_api.py` | SymfoNavi Navigator API(`SymNaviA.dll`)のctypesラッパー(Windows専用、SymfoNavi-Data-Hubから移植) |
| `backend/rne_extract.py` | RNEから仕掛/品質データをSQLite3として抽出する1ジョブ分のロジック(CSV解析・SQLite書き込み・アトミック公開) |
| `backend/rne_worker.py` | `rne_extract.extract_one`をサブプロセスとして実行するエントリポイント(`python -m backend.rne_worker`) |
| `backend/rne_scheduler.py` | 仕掛/品質データのローカル運用(`sikalot_source=local`)時、RNE抽出を定期的に並列実行する背景スレッド |

依存方向は `start_app.py → server.py → app.py → backend.routes.* →
backend.repositories.master_repo → backend.db_access`（逆参照なし）。
`backend.routes.tables`/`backend.routes.measurement` は
`backend.repositories.master_repo` の読み取り関数(`hidden_columns_for_db`/
`read_*_names`/`ensure_*_master`)に依存する。`backend.config` は他へ
依存せず、`backend.paths`/`logging_setup`/`watchdog` がこれを参照する。
`backend.changelog_data` は独立。`app.py`・`backend.routes.*` からは絶対
import(`from backend.xxx import ...`)、`backend` 内のモジュール同士は
相対import(`from .db_access import ...`、`backend.routes.*` からは
`from ..db_access import ...`、`from ..repositories.master_repo import ...`)
で参照する。

> **`backend/` を `app/` へリネームしない**: Pythonは同名のパッケージを
> モジュールより優先するため、`app/` パッケージを作ると `app.py` が
> importできなくなる(直接実行`python app.py`は可能でも、他モジュールから
> の`import app`は`app/`パッケージに解決されてしまう)。この衝突を解消する
> 唯一の方法はFlaskインスタンス生成ファイルの名前自体を変えることだが、
> それは配布・ドキュメント上の実利が薄いため見送り、`backend/`という
> 名前を恒久的に採用している。routes/masters(将来的にはrepositories)と
> いう内部構成の分離自体は、パッケージ名を`app`にせずとも達成できる。

### 仕掛/品質データのローカル運用(RNE定期抽出)

仕掛(SIKALOTNOW)・品質データ(SIKALOTDEF)は既定でネットワーク共有
(`\\Nlmsrvngy03\Read\【New】仕掛\台帳`)上のAccessファイルを直接読む
（工場側の別システムが所有・書込する読み取り専用データ)。この既定は
変えず、共有への到達性が無い/不安定な環境向けに、WaveLog自身がNavigator
API経由でRNE(Navigator問い合わせ定義)を実行し、ローカルSQLite3として
定期更新する運用へ切り替えられるようにしてある(SymfoNavi-Data-Hubの
抽出パイプラインの移植)。

**切替スイッチ(`db_access.py`)**

- パス設定マスタ(`db/master.sqlite3`、マスタ管理画面の「パス設定」タブから
  編集)の`sikalot_source`(既定`"network"`)を`"local"`にすると、
  `DBS['SIKALOTNOW']`/`DBS['SIKALOTDEF']`の読み込み先が
  `db/sikalotnow.sqlite3`/`db/sikalotdef.sqlite3`(`SIKALOTNOW_LOCAL_PATH`/
  `SIKALOTDEF_LOCAL_PATH`)へ切り替わる。2つのDBをまとめて1つのスイッチで
  切り替える(個別切替は用途が無いため)。接続先を決める値のため、保存後は
  サーバー再起動まで反映されない。
- `sikalotnow_path`/`sikalotdef_path`による明示上書き(検証用)は
  `sikalot_source`の切替より常に優先する(従来の開発/検証用の挙動を
  変えないため)。

**抽出パイプライン(`navigator_api.py` → `rne_extract.py`)**

- `navigator_api.py`は`SymNaviA.dll`をctypesで直接呼ぶWindows専用の薄い
  ラッパー(`NaviOpenSession`→`NaviOpenCatalog`→`NaviExecuteCatalog`→
  `NaviSaveData`(CSV)→`NaviCloseCatalog`→`NaviCloseSession`)。DLLは
  `C:\NAVIAP`を最優先で探し、無ければ`config/rne_extract/NAVIAP`配下
  (`dllVC14`/`dllVC14x64`/`debugdllVC14`/`debugdllVC14x64`のいずれか)を
  Pythonのビット幅に合わせてフォールバック選択する。
- `rne_extract.extract_one(job, conf, work_dir)`が1ジョブ分の抽出を担う。
  Navigator APIが書き出した中間CSVを解析し(`read_extract_csv`、
  cp932→utf-8-sig→utf-8の順でエンコーディングを試す)、全列TEXTの
  SQLite3として書き込み(`write_sqlite`、`_更新情報`メタデータテーブル
  付き、`PRAGMA integrity_check`で検証)、ローカルで完成させてから
  公開先(`db/`配下)へアトミック置換する(`publish`)。
- 公開先が他プロセス/他PCに開かれ使用中(Windowsのファイル共有違反)の
  場合は、最大3秒リトライしたのち`{stem}.pending_{timestamp}{suffix}`
  として保存し、次回の抽出開始時に`apply_pending()`で適用する(強制
  上書きしない)。公開の都度、直前ファイルを世代管理付きでバックアップ
  する。
- 接続情報は`config/rne_extract/symnavim.conf`の`[Connect_*]`セクション
  から読む(`creds`)。追加データソース(`[ApiOracle]`等)があれば
  `connect_data_source`で個別接続し、`[ApiOracle]`が無い場合はNavigator
  接続情報をOracle接続として1回だけ流用する(SymfoNavi-Data-Hub側の実運用
  を踏襲)。

**並列実行と定期スケジューリング(`rne_worker.py` / `rne_scheduler.py`)**

- Navigator API/COMセッションはプロセス間で安全に共有できないため、
  ジョブ(SIKALOTNOW・SIKALOTDEF)ごとに独立したサブプロセス
  (`python -m backend.rne_worker <payload.json> <result.json>`)として
  実行する。ジョブ数が2件と少ないため、キュー/スロット管理は行わず、
  ジョブ数と同じ数のスレッド(`rne_scheduler.run_batch`)がそれぞれ
  サブプロセスの完了をブロック待ちする単純な形にしてある。
- `sikalot_source=local`のときだけ、`rne_scheduler.start()`が
  `records_export.py`/`watchdog.py`と同じ`daemon=True`スレッドパターンで
  背景スレッドを起動し、起動直後に1回、以降は`rne_extract_interval_sec`
  (パス設定マスタ、既定900秒=15分、下限60秒にクランプ)ごとに
  抽出を繰り返す。間隔はループの毎周回で読み直すため、変更の反映に
  アプリの再起動は不要。
- **ワーカーの自己タイムアウト**: Navigator APIの呼び出しはネットワーク
  不調時などに無期限にブロックし得る。`rne_scheduler`側の
  `subprocess.run(timeout=600)`だけでなく、`rne_worker.py`自身も同じ長さの
  `threading.Timer`を持ち、時間内に終わらなければ`os._exit()`で自己終了
  する(環境変数`NAVI_WORKER_TIMEOUT_SEC`で親から同じ値を渡す)。これは
  親(WaveLog本体)がワーカーの実行中に終了した場合の保険——Windowsの子
  プロセスは親が消えても自動的には終了しないため、外側のタイムアウトが
  効かなくなり、Navigatorセッションを握ったまま無期限に居座る孤児プロセスに
  なり得る。自己タイムアウトにより、その場合でも最悪`NAVI_WORKER_TIMEOUT_SEC`
  秒で自滅する。強制終了されたワーカー自身の後片付け(作業フォルダ削除)は
  実行されないため、`rne_scheduler._run_job`側でも呼び出し後に念のため
  作業フォルダを削除する(タイムアウトが繰り返し発生してもディスクを
  圧迫しないため)。

**資材の配置(`config/rne_extract/`)**

- RNEファイル・`SymNaviA.dll`・`symnavim.conf`は機密情報/サイト固有資産
  のためリポジトリへ含めず、PCごとに`config/rne_extract/`配下へ手動配置
  する(配置形態の詳細は`config/rne_extract/README.md`、テンプレートは
  `symnavim.conf.example`)。`.gitignore`で実体(`rne/`・`NAVIAP/`・
  `symnavim.conf`)を除外し、README/exampleのみ追跡する。
- サンドボックス等の非Windows環境では`navigator_api.py`がインスタンス化
  時点で`RuntimeError`を返すため、抽出は毎回失敗ログを残すだけでサーバー
  自体は問題なく動作する(周辺のロジック——設定切替・スケジューラの間隔
  制御・SQLite書き込み/アトミック公開/pending適用——はこの環境でも
  検証済み)。

### 列表示マスタと include_hidden

`/api/table` は列表示マスタ（表示マスタテーブル）の非表示設定を反映して
列・値を落とした結果を返す。これは**一覧の見た目専用**の仕様であり、
内部計算（条割の分割データ検出など）が使う問い合わせは
`include_hidden=1` を付けて生データを取得すること（lot-split.js が実施）。

## フロントエンド構成

読み込み順（`templates/index.html` の記載順）に意味がある。

### 1. コア5ファイル（旧 core.js を機能別に分割）

| ファイル | 所有する主な関数 |
|---|---|
| `base.js` | `S`(状態)・`api`・`esc`・`aliases`/`pick`・`fmtDim`・`showToast`・`normalizedFieldName`・`sourceField`・使用設備/ユーザーIDの取得・`durationMs` |
| `list-view.js` | `init`・`selectDb`/`selectTable`/`load`・`renderGrid`・更新履歴モーダル・検索/ページャ |
| `measurement-view.js` | `ensureMeasureShape`・`collect`・`renderMeasurement`・各パネル描画（品質等級/コース/製品丈/作業時間）・入力検証（`updateValidationVisuals`）・`updateMeasurementHeading` |
| `measurement-input.js` | `deviceParse`・`processDeviceInput`・`focusCurrent`・`renderMeasureGrid(Vertical)`・`judgeInput`・公差計算（`toleranceDetail`/`toleranceDataForSource`/`compactTolerance*`） |
| `records-store.js` | IndexedDB/ミラー永続化・`saveLocal`/`persistAndTransition`・`openMeasurement`・`openRecords`/`renderRecordListRows`・`loadMeasurementContext`・使用設備設定/設備マスタ・Access同期の未完了キューと再送・アプリ起動呼び出し（末尾） |

### Access同期の未完了キューと再送（records-store.js）

`backupRecord(m)`（`/api/measurement/backup`へのPOST、`DELETE→INSERT`の
冪等upsertなので再送しても重複しない）の成否をレコードへ持たせず捨てて
いたため、工場の共有フォルダが不安定だと端末内にはあるがAccess側には
無いデータが静かに溜まっていた。これを可視化・再送可能にする。

- `m.syncState={status:'pending'|'synced'|'failed',lastAttempt,lastError,attempts}`。
  `ensureMeasureShape`が新規/既存レコード双方へ初期値を補う。
- `backupAndTrackSync(m)`が`backupRecord`→`syncState`更新→`reliablePut`保存を
  一括で行う（呼び出し側は個別に組み立てない）。
- `syncPendingRecords({silent})`が`syncState.status!=='synced'`のレコードを
  まとめて再送する。呼び出し元: 起動直後（`queueMicrotask`）・
  `online`イベント・15分間隔の`setInterval`（すべて`silent:true`）、および
  データ一覧の「今すぐ再送」ボタン（`#recordSyncNowBtn`、`silent:false`で
  進捗オーバーレイ表示）。
- `refreshSyncStatusUI()`がサイドバー（`#homeDraftSyncWarn`）とデータ一覧
  （`#recordSyncBar`/`#recordSyncCount`）の未同期件数表示を更新する。
  **`syncPendingRecords`や`backupAndTrackSync`を新しい経路から呼ぶときは
  必ずセットで呼ぶこと**（呼び忘れると表示が更新されない）。
- データ一覧の行を再描画するときは`renderRecordListRows()`ではなく
  `refreshRecordList()`を使うこと。`renderRecordListRows()`は
  `recordListState.items`という開いた時点のキャッシュを読むだけで
  ストレージを再取得しないため、`syncPendingRecords`のように裏で
  レコードが更新された直後に呼ぶと古い`syncState`のバッジが残る
  （実際に一覧を開いたまま再送すると同期済みになってもバッジが消えない
  不具合があった。`refreshRecordList()`は`reliableAll()`から読み直して
  から描画するため取り違えない）。

### 測定データバックアップの閲覧用複製と編集可能/閲覧モード

複数の設備でこのアプリをローカル運用しており、運用上は書き込みが1台に
閉じている（設定を誤らない限り）想定。その1台の`records.sqlite3`を
Box等のクラウド同期フォルダへ複製し、他端末はそれを閲覧専用で見る、という
使い方をサポートする。

**バックアップの追加出力先（`records_export.py`）**

- パス設定マスタの`records_backup_export_path`（既定未設定＝複製しない、
  保存後はサーバー再起動で反映）へ、`/api/measurement/backup`が成功する
  たびに変化フラグを立て
  （`mark_dirty()`）、`RECORDS_BACKUP_EXPORT_INTERVAL_SEC`（既定600秒、
  `backend/config.py`）ごとに変化があれば複製する（`_loop`のバックグラウンド
  スレッド、`watchdog.py`と同じ`daemon=True`スレッドパターン）。変化が無い
  間隔は何もしない（負荷軽減）。
- 複製は`sqlite3.Connection.backup()`（オンラインバックアップAPI）を使う。
  単純なファイルコピーだと書き込み中のファイルを複製したときに壊れた
  コピーになり得るため、書き込み中でも整合性の取れたコピーを作れる
  このAPIを使う。
- 複製先の書き込みが遅い/失敗しても、測定データのローカル保存自体は
  絶対にブロックしない（`mark_dirty()`は成否を待たないfire-and-forget）。
  失敗時は次回また複製を試みる。

**アクセス権限マスタ（`master_repo.py`のACCESS_PERMISSION_TABLE）**

- `ログインID`×`PC名`の組み合わせ（完全一致、表記ゆれはNFKC正規化+大文字化で
  吸収）で編集可否を管理する。他マスタと同じソフトデリート方式のテーブルで、
  マスタ管理画面（`measurement-worklog.js`の`MASTER_DEFS`、key:
  `accessPermission`）から登録・編集できる。
- **該当行が無い組み合わせは既定で「編集可能」**（`has_edit_permission`）。
  複数PCでの単一書き込み運用を壊さないための互換ポリシーで、閲覧専用に
  したい端末だけ明示的に「閲覧のみ」で登録する（ホワイトリストではなく、
  制限したい端末だけを個別に落とす方式）。

**モードの判定・切替・書込ガード（`access_mode.py`）**

- Flaskプロセス起動時に、この端末のログインID（`os.getlogin()`、失敗時は
  `USERNAME`/`USER`/`LOGNAME`にフォールバック）とPC名（`socket.gethostname()`）
  でアクセス権限マスタを照合し、初期モード（`edit`/`view`）を決める。
  モードはプロセス内メモリの状態（同一端末の複数タブで共有）。
- `GET /api/access-mode`で現在のモード・切替可否・ログインID・PC名を取得、
  `POST /api/access-mode`で切替える。切替時も毎回マスタを読み直して判定する
  ため、マスタ側の変更（権限の追加・剥奪）は次の切替から即座に反映される
  （再起動不要）。編集権限を持たない端末は`view`から`edit`へ自分では
  切り替えられない（403）。
- `before_request`フックが、閲覧モード中は`measurement`/`masters`
  Blueprintへの非GETリクエストをすべて403にする（新しいBlueprintを
  Guardの対象に加える場合は`_GUARDED_BLUEPRINTS`へ追加すること）。
  モード切替API自体はどちらのBlueprintにも属さない（`app`へ直接登録）ため、
  このガードの対象外＝閲覧モード中でも呼べる。

**フロント側の入口ガードと閲覧データ（`access-mode.js`、最後に読み込む）**

- 起動時に`GET /api/access-mode`を取得し、ヘッダーの`#accessModeBadge`へ
  反映する。`body.view-mode`クラスで閲覧モード中のCSS出し分け
  （データ一覧の「続きから再開」「削除」ボタン・同期バーを隠す等）を行う。
- サーバー側の403だけに頼ると、モーダルを開いて入力した後に弾かれるなど
  手戻りが大きいため、フロント側でも先回りしてブロックする。
  `openMeasurement`（新規開始・再開の共通入口）と`resumeRecordFromList`
  （データ一覧の「続きから再開」）をラップし、閲覧モード中はトースト表示
  のみで処理を進めない。
- 閲覧モードの**データ一覧はこの端末のIndexedDBではなく閲覧用バックアップ
  （`GET /api/measurement/backup/list-view`、`records_backup_export_path`を
  読む）から取得する**。`openRecords`をラップし、閲覧モード中は
  `recordListState.items`を`window.loadViewModeRecords()`（ペイロードを
  `ensureMeasureShape(JSON.parse(...))`で復元した配列）で差し替えてから
  `renderRecordListRows()`を呼ぶ（`recordListState`/`openRecords`/
  `renderRecordListRows`はrecords-store.js側がIIFEを持たないため、
  他ファイルから直接参照・再代入できる）。
- 帳票（report-dashboard.js）も同様に、`openReportView()`内で
  `window.accessMode.mode==='view'`なら`reliableAll()`の代わりに
  `window.loadViewModeRecords()`を呼ぶよう直接編集してある（IIFEで閉じた
  `rpState`は外からラップできないため、所有ファイル側を直接直す方針を
  採った）。一括印刷等の他機能は`rpState.items`を読むだけなので、
  データソースが差し替わっても変更不要で動く。

**各関数の定義はコア内で1箇所のみ**（旧 core.js にあった同名関数の多層
再定義・到達不能な旧実装は 2026-07 のリファクタリングで撤去済み）。

### 2. 機能拡張ファイル（コアの後に読み込み）

`measurement-tolerance.js` → `lot-split.js` → `measure-progress.js` →
`filters.js` → `measurement-worklog.js` → `worktime-benchmark.js` →
`quality-analysis.js` → `report-dashboard.js` → `calendar-view.js`

各ファイルはIIFE（即時関数）で自身のヘルパを閉じ込め、コアの関数を
拡張する場合のみ次の規約でラップする:

```js
const baseFn=typeof fn==='function'?fn:null;   // 読み込み時点の実装を捕捉
fn=function(...){ /* 前処理 */ const r=baseFn(...); /* 後処理 */ return r };
```

- **全置換は禁止**（ラップで済まない変更はコア側の所有ファイルを直接直す）。
- IIFE内の関数を他ファイル・テストへ公開する場合は `window.X=X` を明示する
  （例: `lot-split.js` の `openSplit`/`applySplit`/`splitSourceRows`/`analyzeRowSplit`）。
- 条割（分割）関連は検出・モーダル・判定配線・屑幅計算まで含めて
  `lot-split.js` が全所有する。

### 分割子ロットデータの保存と更新確認

子ロットデータ（分割元ロットの一覧: ロット番号・本数・幅・厚み・公差）は
`S.measure.settings` 配下に置く。`encodePayload(m)=JSON.stringify(m)` の
ため、`settings` に入れた値は測定データと同じ経路で自動的に永続化され、
再開時にそのまま復元される（保存経路の追加実装は不要）。

| キー | 内容 |
|---|---|
| `splitSourcesCache` | 保存済みの子ロット一覧（判定・表示の基準） |
| `splitSourcesSavedAt` | 上記の取得時刻。再開時の「いつ時点か」表示と、直後の二重取得の抑止に使う |
| `splitSourcesCheckedAt` | 最後に更新確認を行った時刻 |
| `splitSourcesPending` | 差異が見つかった未処理の提案 `{at,sources,diffs}` |
| `splitSourcesHistory` | 適用・拒否で置き換わった過去の内容（新しい順、最大10件） |
| `splitSourcesRejected` | 拒否した内容（破棄せず保持し、後から適用できる） |
| `splitNeedsReconfigure` | 本数変更により条の割り当て再設定が必要な旨の警告 |

更新確認は `checkSplitSourcesUpdate()` がバックグラウンドで行う
（測定画面を開いた直後 + 10分間隔。測定画面が閉じている間は動かさない）。
差異検出は `diffSplitSources(prev,next)`、適用可否の判定は
`splitUpdateBlockers(diffs)` が所有する。

**適用可否の条件**: 差異の出た項目に対して測定データが1つも入力されて
いないこと。`splitGroups` が未設定（＝まだ判定に使われていない）なら常に
許可する。本数変更・ロットの追加/削除は条の割り当て自体が変わるため、
判定対象を全条へ広げる。厚み公差の差異は厚み入力、それ以外の位置依存
項目（幅・横ズレ・バリ・テレスコープ・オフセット・平坦度）は該当ロットの
条位置の入力で判定する（`thickness` は条ごとではなく長さごとに3枠のため、
判定経路が分かれている）。

`applySplit()` は取得結果を `splitGroups` 側へ複製し、判定
（`groupRangeFor`）はその複製を読む。したがって更新の適用時は
`splitSourcesCache` だけでなく `syncSplitGroupsFromSources()` で
`splitGroups[].base/tol/missing` も更新する必要がある。

公開している関数（`window.X=X`）: `diffSplitSources`・
`splitUpdateBlockers`・`checkSplitSourcesUpdate`・
`applySplitSourcesUpdate`・`rejectSplitSourcesUpdate`・
`revertSplitSources`・`refreshSplitStatusPanel`。

### 測定進捗と完了ゲート（measure-progress.js）

**完了可否は2層**に分かれている。混ぜないこと。

| 層 | 所有 | 対象 | 挙動 |
|---|---|---|---|
| ハード | `records-store.js` の `persistAndTransition` | 公差外(`ng`)、オペレータ/検査員の未選択 | 登録させない |
| 確認 | `measure-progress.js`（`persistAndTransition` をラップ） | 8つの入力内容の未測定、丈位置の未測定、作業時間の未記録 | 一覧を提示して**確認のうえ続行可** |

`measurement-view.js` の `activeRequiredControls()` は**表示中のグリッドしか
見ない**（現在の入力内容 × 現在の丈位置）。これは枠色表示のための仕様として
残してあり、完了可否の判断には使わない。全体の集計は
`measure-progress.js` が `S.measure` から**DOM非依存**で行うため、入力内容や
丈位置を切り替えなくても全16面（8項目 × 丈位置）を評価できる。

必要な測定項目は**製品の材質・用途コード・規格で変わる**ため機械判定はしない。
測定しない項目はチップの**右クリック**で「対象外」に指定する（マウス運用）。
指定時のみ、同じ用途コードの完了データから実測の割合を示して確認する
（品質等級 QCD1〜15 は用途コードに対応して登録されているため、条件軸として
用途コードを使えば等級と同じ情報が得られる。加えて実績集計なら QCD に対応の
無い母材・バリ・テレスコープ・巻ずれもカバーできる）。

| `settings` キー | 内容 |
|---|---|
| `measureScope.excluded` | 対象外に指定した入力内容の名前（測定データと同じ経路で永続化・再開時に復元） |
| `measureScope.decidedAt` / `decidedBy` | 指定した時刻と手段 |

データの持ち方が項目で違う点に注意（`ITEM_DEFS` の `scope`）:
`lot`=ロットに1つ（母材 → `m.mother`）/ `piece`=縦割りした丈ごと
（揃い/肉厚/長さ → `m.product.rows`）/ `length`=丈位置 × 条
（`m.measurements[key][丈位置][条]`。ただし `thickness` は条ごとではなく
長さごとに3枠）。丈位置の数は `updateLengthOptions` と同じく**縦割数+1**。

UI は「入力内容」セレクトをチップへ置換する（面積は増やさない）。**元の
`<select#measureType>` は `display:none` にせず `.visually-hidden-control` で
1pxに縮めて操作可能なまま残す** —— キーボード操作・支援技術に加え、
`#measureType` を `selectOption` で駆動している既存テストを壊さないため
（`hidden` にすると Playwright が不可視と判断して操作できなくなる。実際に
4件のテストが落ちた）。

公開している関数: `measureProgress`・`refreshMeasureProgress`・
`measureCompletionReview`・`toggleMeasureExcluded`・`measureItemNames`。

### サイドバー（アプリ全体のナビゲーション）

目的別に4グループ。**どのグループへ入るかはコードで決め、読み込み順に
依存させない**（以前は3ファイルが揃って `.view-nav` へ後入れしていたため、
性質の違う項目が混ざり、並びもスクリプトの読み込み順次第だった）。

| グループ | 中身 | 誰が入れるか |
|---|---|---|
| 測定データ | データ一覧 | `index.html`（静的） |
| 一覧を見る | 仕掛（現在）・品質データ | `list-view.js`（`role!=='master'`） |
| 分析 | ダッシュボード・実績カレンダー | `report-dashboard.js` / `calendar-view.js` → **`#analysisNav`** |
| 管理 | マスタ管理 | `index.html`（静的、`#openMasterMaint`） |

- DB一覧の置き場所は `/api/catalog` の **`role`** で決まる。DBを増やすときは
  `db_access.py` の `DBS` に `role` を付ければ自動で正しいグループに入る。
- ただし **`role==='master'` のDBはサイドバーへ項目を作らない**。以前は
  「マスタ一覧」（生テーブルの汎用グリッド）と「マスタ管理」（編集画面）が
  別々の入口に並んでいて紛らわしかったため、生テーブル閲覧はマスタ管理画面の
  中の「テーブル生データ」タブへ統合し、入口を1つに絞った（下記）。
- **表示名の正はカタログ（`DBS[...]['label']`）**。`index.html` の静的ラベルは
  カタログ取得までの繋ぎなので、**両者を一致させておく**こと（以前は静的側が
  「仕掛一覧」、実表示が「仕掛（現在）」でコードを読むと混乱した）。

### 画面の開き方・閉じ方の約束

| 種類 | 例 | 閉じ方 |
|---|---|---|
| トップレベル（サイドバーの行き先） | データ一覧・仕掛・品質データ・マスタ管理・ダッシュボード・実績カレンダー | **閉じるボタンを持たない**。サイドバーで切り替える |

**後始末は「開く側」が行う。** 各ビューの `openXxx()` の冒頭で
`window.exitCalendarView?.()` / `exitScheduleView?.()` / `exitMasterMaint?.()` の
ように他ビューを閉じる。**サイドバーのクリックを capture で横取りして閉じる
方式は使わないこと** — `records-store.js` が `[data-open-records]` /
`#homeDrafts` を capture 段で `stopImmediatePropagation()` しており、後から
読み込まれたファイルのリスナーは呼ばれない。実際に、マスタ管理からデータ一覧へ
移動したときだけ後始末が走らず、画面下部にマスタ管理のパネルが残る不具合が出た。
念のため CSS 側にも `body.rec-mode #masterMaintPanel{display:none!important}` 等の
保険を置いてある。
| ロットに紐づく下位画面 | 測定画面 | `×` |
| 同上（戻り先がある） | 帳票 | `戻る`（起点により行き先が変わる） |

現在地は **`setActiveNav(key)`（`base.js`）** が一元管理する。`key` はボタンの
`id` か `data-db-key`。**新しいトップレベル画面を足したらここを呼ぶこと**
（呼ばないと選択状態が残ったままになる）。`.active` の見た目は
`nav-item--view` / `--admin` / `--primary` のどれでも同じになるよう揃えてある。

### マスタ管理の画面形態（モーダル化の基準）

マスタ管理は **メイン画面統合型**（`body.mm-mode` + `#masterMaintPanel`）。
帳票（`rp-mode`）・実績カレンダー（`cal-mode`）・作業スケジュール（`sc-mode`）
と同じ枠組みで、`main` の中へ `#grid` の兄弟として差し込む。以前は全画面
シェード付きのモーダル（`.record-modal.mm-modal`）だったが、開きっぱなしで
一覧を見る使い方が中心で **モーダルにする理由が無かった** ため作り直した。
内側の構造（`.mm-dialog` 以下）と id は変えていないので、列表示・データ引継ぎ・
換算係数・パス設定といった特殊タブの描画コードはそのまま動く
（`.mm-panel .mm-dialog` で寸法だけ上書きする。`.rec-panel .record-dialog` と同じ手法）。

**モーダルを使う基準はここに一本化する**（`measurement-worklog.js` の
`defUsesEditorModal()`）。

| 形態 | 使う場面 | 理由 |
|---|---|---|
| メイン画面（統合パネル） | 一覧・検索・項目数の少ないマスタの追加/編集 | 画面を覆う理由が無い。覆うと背後の一覧と見比べられなくなる |
| 編集専用モーダル（`#maintEditorModal`） | **入力項目が4つ以上**、または**専用コントロールを含む**（設備の複数選択タグ入力）、または `editorModal:true` を明示 | 上部インラインフォームのままだと縦幅を取って一覧の表示領域を圧迫する。編集中は一覧を操作させない方が安全でもある |

- 現状の割り振り: モーダル＝オペレータ（タグ入力）・アクセス権限（6項目）・
  設備停止（4項目）・勤務形態（4項目）／インライン＝機器・スプール種別・
  内径種別・設備。
- モーダルは **どのマスタでも同じ枠**を使い、入力欄は `buildFieldControls()` が
  `MASTER_DEFS` の `fields` 定義から組み立てる。**マスタを増やしてもモーダル
  自体には手を入れなくてよい**。
- 開く導線は「一覧の行クリック」「行のダブルクリック」「行の`編集`ボタン」
  「上部の`＋ 追加`ボタン」。保存は `submitMaint(rootSel)` が
  インライン/モーダルどちらの入力欄からでも同じ処理で行う。
- **モーダルの下段は `<footer>` ではなく `<div class="mm-editor-foot">` で組むこと。**
  メイン画面統合型ビューの共通ルール（`body.mm-mode footer{display:none!important}` 等）は
  要素セレクタの `footer` を対象にしているため、`<footer>` で組むと保存・
  キャンセルボタンごと消える（実装時に踏んだ不具合）。

マスタ種別のナビは **3グループ**（`MASTER_GROUPS`）に束ねる。13種を平坦に
並べると毎回読んで探すことになるため、利用者の頭の中の分類で分ける。

| グループ | 中身 |
|---|---|
| 設備・人 | 設備・オペレータ・機器・スプール種別・内径種別 |
| 作業スケジュール | 設備停止・勤務形態・換算係数 |
| 表示・システム | アクセス権限・列表示・データ引継ぎ・パス設定・テーブル生データ |

一覧は**横スクロールを出さない**。データ列は `minmax(0,Nfr)` で入るだけ縮め、
あふれた文字は省略記号にする（以前は `minmax(120px,…)` が効いて、6列の
アクセス権限マスタでは常に1100px超を要求していた）。更新者・更新日時は監査用の
副次情報なので、**列数が4以上のマスタでは列として持たず**行のツールチップへ
退避する（`maintShowsAudit()`）。`.mm-list-wrap` は `overflow-x:hidden`。

「テーブル生データ」タブ（`special:'raw-table'`、`readOnly:true`）は旧
「マスタ一覧」の統合先。`master.sqlite3` のテーブルを読み取り専用で表示し、
専用タブが無いテーブル（表示マスタ・スケジュール列表示マスタ等）も確認できる。
`readOnly:true` のタブは書込権限と無関係なので `maintDefVisible()` が
**どのモードでも表示する**（旧「マスタ一覧」ナビが全モードで見られた挙動を保つため）。

### フィルタのよく使う条件

`filters.js` の「よく使う条件」は **保存フィルタ（プリセット）+ 条件の利用履歴**
から頻度×新しさで並べたもの。

- **利用履歴は DB+テーブルごとのバケットで保存する**（`localStorage` の
  `MeasurementFilterCondUsageV2`、キーは `${S.db}${S.table}`）。V1は
  列名+演算子+値だけの単一フラットマップで、どのテーブルで使った条件かを
  持っていなかったため、仕掛一覧で使った条件がマスタや品質データにも提案され、
  その表に存在しない列ばかりが並んでいた。V1のデータは復元しようが無いので
  引き継がない（利用回数の統計のみで、数回の操作で貯まり直す）。
- あわせて **現在の `S.columns` に無い列の条件は提案しない**。同じテーブルでも
  列構成は変わり得る（表示マスタでの非表示指定、スケジュールモードの品質データ
  結合で増える列など）ため、プリセット由来の条件も含めてこの段階で落とす。
- 表示は **既定で折りたたみ**。`#filterQuickToggle`（該当条件が0件ならボタン
  自体を出さない）で開閉し、状態は `MeasurementFilterQuickOpenV1` に覚える。
  常時1行を占有すると、特にスケジュールの分割表示で一覧の縦幅を圧迫するため。

### 表示サイズ（アプリ全体・5段階）

文字サイズ・コントロールの高さ・一覧の行の高さは、すべて `:root` のトークンが
**`--ui-scale` を掛けた値**で決まる。`base.js` が `localStorage`
(`MeasurementUiSizeV1`) の値を `html[data-ui-size]` へ適用し、CSS 側の
`:root[data-ui-size="xs|sm|md|lg|xl"]` が倍率（.84 / .92 / 1 / 1.1 / 1.22）を差し替える。

| 段階 | 倍率 | 用途 |
|---|---|---|
| 極小 `xs` | .84 | 一度に見える情報量を最優先 |
| 小 `sm` | .92 | 情報量を少し優先 |
| 中 `md` | 1 | 標準（既定） |
| 大 `lg` | 1.1 | 読みやすさを少し優先 |
| 特大 `xl` | 1.22 | 読みやすさを最優先 |

- 切替はヘッダーの `#uiSizeBadge`（モードバッジと同じポップオーバーの言語で揃える）。
- `base.js` は読み込み順の先頭なので、**後から描かれる画面も最初から正しい
  サイズで組み上がる**（既定サイズで描いてから切り替わるちらつきが無い）。
- 以前は作業スケジュール画面だけに「高密度」トグル（`#grid.sc-dense`）があり、
  他の画面の文字サイズは調整できなかった。**この機能に統合して廃止した**ため、
  画面ごとの密度トグルを新しく足さないこと。
- **新しい寸法はリテラルpx値ではなくトークンで書く**こと。トークンを使わずに
  px直書きすると、その箇所だけ表示サイズに追従せず不揃いになる。
- トークンに寄せられない一点物の寸法（カレンダーの日セル高、明細ペイン幅など）
  は、`calc(74px * var(--ui-scale))` のように**倍率だけは掛ける**。
- **取りこぼしは目視で探さない。** `html[data-ui-size]` を `md`→`xl` へ切り替え、
  全要素の算出 `font-size` を index 固定で 2 回スナップショットして
  **値が変わらなかった要素だけ**を抜き出す（scratchpad の `probe_scale3/4.js`）。
  この測り方で、実績カレンダー（`.cal-*`）と分析ダッシュボード（`.db-*`）が
  丸ごと追従していなかったのを見つけた。SVG の `text` にも calc() 入りの
  カスタムプロパティは効くので、グラフのラベルも同じように扱う。
  なお `.db-card-*` はダッシュボードとカレンダーが**共有している**ため、
  片方の画面だけ直すと必ず取りこぼす。

### コントロールサイズの統一

文字サイズ（`--fs-*`）と同じ考え方で、**コントロールの高さも `:root` の
トークンへ集約する**（値はすべて `--ui-scale` 込み）。

| トークン | 既定 | 用途 |
|---|---|---|
| `--ctl-h-xs` | 26px | タグ・チップなど文中に混ざる小片 |
| `--ctl-h-sm` | 30px | 補助ボタン（フィルタバー・ツールバー内） |
| `--ctl-h` | 36px | 標準のボタン・入力欄・**ナビ項目**・タブ |
| `--ctl-h-lg` | 40px | 主要動作（保存・登録）のボタン |

以前は同じ役割でも26/28/30/34/36/38/40pxが場当たり的に指定されており、
特にヘッダー（使用設備ボタン38px・検索34px前後・現場段取りバッジ26px）と
左ナビ（高さ指定なし）の並びが揃っていなかった。**新しいコントロールを足す
ときはリテラルpx値を書かず、このトークンから選ぶこと。**

### 読み込み中の待ち表示（`withWaiting`）

マスタ管理・作業スケジュールはネットワーク共有上の DB を読むため数秒かかる
ことがある。パネル内の「読み込んでいます…」だけだと画面全体としては無反応に
見え、タブを連打される。**時間のかかる読み込みは `records-store.js` の
`withWaiting(opts, fn)`（`window.withWaiting`）で包む。**

```js
return withWaiting({title:'…を読み込んでいます', detail:'…', progress:'…', step:1},
                   report => loadXxxInner(report));
```

- **速い処理では出さない。** `delayMs`（既定 350ms）を超えたときだけ表示する。
  ローカルのマスタは大半が一瞬で返るので、毎回スピナーが瞬く方が不安を与える。
- **二重に出さない。** 外側が表示中なら内側は何もしない（内側が勝手に閉じない）。
  `list-view.js` の `load()` のように直接 `showWaiting()` する既存経路とも、
  タイマー発火時にオーバーレイの状態を見直すことで衝突しない。
- **必ず閉じる。** `fn` が投げても `finally` で片付ける。
- 進捗更新は `fn(report)` の `report({detail, progress, step})`。
- **中身は別関数へ切り出してラッパーから呼ぶ**（`loadMaint()` →
  `loadMaintInner()`）。ラップで包むだけだと、内側の関数を直接呼んでいる
  既存の呼び出し元を取りこぼす。
- **書込系には被せない。** 作業スケジュールの書込は操作直後に画面を止めない
  一方通行の設計（`docs/SCHEDULE_MODE_DESIGN.md` §9.22）で、待ち表示はその
  狙いを打ち消す。

### ネットワーク共有を読む処理は「回数」で見る

仕掛/品質データ・共有スケジュールDB・測定バックアップの閲覧用複製は、いずれも
**ネットワーク共有の上**にある。ローカルSSDのサンドボックスでは秒数に差が出ない
ため、遅さを疑うときは秒数ではなく **共有を触る回数** を数える
（scratchpad の `count_io.py` のように該当関数をラップして数える）。
実際にこの測り方で、作業スケジュールの俯瞰ボードが測定バックアップを
**設備の台数ぶん全件読み直していた**（設備10台で60回）のを見つけた。

- **設備ごとにループする処理で、ループの外で1回作れるものを中で作らない。**
  `schedule_calc.expand_plan()` の `actual_index` がその代表例
  （`docs/SCHEDULE_MODE_DESIGN.md` §9.41）。
- 共有を読む共通関数には、**ファイルの署名（更新時刻+サイズ）+ TTL** の
  キャッシュを入れる（`db_access.merged_backup_rows()`）。TTL 内は `stat` すら
  省く（共有越しでは `stat` も往復する）。書き込んだ側が明示的に捨てられる口
  （`invalidate_backup_rows_cache()`）も用意する。
- **画面を開き直しただけで読み直さない。** 読み直すのは「データを変える操作を
  したとき」「利用者が明示的に更新を求めたとき」「まだ一度も読んでいないとき」
  の3つ。そのかわり **いつ時点の内容かを必ず画面に出す**
  （§9.42。読み直さない設計で古い情報を黙って見せない）。

### 印刷の導線は画面ごとに1つ

ヘッダーの「画面を印刷」（`#printCurrentView`、`quality-analysis.js` が全画面へ
追加）は今の画面をそのまま出す汎用操作。**専用の印刷を持つ画面では CSS で隠す**
（`body.rp-mode` / `body.qa-mode`）。印刷の導線を増やすときはこの原則を守る。

### 操作レール（測定画面の左端）

目的別に5グループ。**上から使用頻度順、破壊的操作は最下段**（`rail-bottom`）。

| グループ | 中身 |
|---|---|
| 測定進捗 | 状態表示のみ（`measure-progress.js` が描画） |
| 保存 | 保存して一覧へ / 測定を完了 |
| 帳票 | 帳票を表示 / 印刷する |
| データ | データ一覧を開く / DBへ同期 |
| 異常・削除 | NGとして記録 / このデータを削除 |

幅は**最長ラベル（「このデータを削除」＝実測128px）が切り詰められない値**にする
（`.action-rail` 160px / ≤1450pxで152px。`.measure-shell` の
`grid-template-columns` と必ず揃えること）。過去に136pxだったときは主要導線の
「保存して一覧へ」まで省略されていた。

### 測定画面から帳票を開く

帳票（`report-dashboard.js`）は**端末に保存済みのレコードを読んで描画する**
（`reliableAll()`）。したがって測定画面から開くときは、画面上の入力内容を
先に `saveLocal()` してから開く。このとき `saveLocal()` の既定値は `'編集中'`
なので、**完了済みデータの状態を巻き戻さないよう現在の状態を明示して渡す**。

`window.openReportForRecord(id, {returnTo, print})` で起点を指定する。
`returnTo:'measure'` なら「戻る」の表示が「測定へ戻る」に変わり、測定モーダルを
開き直したうえで `updateValidationVisuals()` を呼んで進捗・検証表示を作り直す
（帳票を見ている間は測定画面の描画が止まるため、古い件数が残るのを防ぐ）。
`print:true` は描画完了を待つため `requestAnimationFrame` を2回挟んでから
印刷ダイアログを開く（同期的に呼ぶと白紙になる）。

### 帳票の一括印刷

一覧から複数ロットを選び、1回の印刷操作でロットごと1ページずつまとめて
出力する機能。既存の単一プレビュー（`#reportContent`/`#rpPageBox`、ズーム・
スクロール状態を持つ）の状態を一切崩さないよう、印刷専用の別経路で組む。

- `renderReport(x)`のHTML生成部分は`reportHtml(x)`という純関数へ抽出済み
  （`renderReport`は`$id('reportContent').innerHTML=reportHtml(x)`のみ）。
  単一プレビューと一括印刷の両方がこの1つの関数からページ内容を作るため、
  帳票のレイアウトを直すときはここ1箇所を直せば両方に反映される。
- 選択状態は`rpSelectedIds`（`Set`）。検索・並び替え・プレビュー切り替えを
  跨いでも保持する。一覧の各行（`.rp-lot-row`）はチェックボックス
  （`.rp-lot-check`）と選択・再開用の本体ボタン（`.rp-lot-main-btn`）を
  横並びに持つ2要素構成。
- `printSelectedReports()`が選択済みロットぶん`reportHtml(x)`を呼び、
  `<div class="rp-report rp-page">`でロットごとに包んで印刷専用領域
  （`#reportBulkPrintArea`、`ensureBulkPrintArea()`が生成し`document.body`
  直下へ追加）へ流し込み、`body.rp-bulk-print`を付けてから`window.print()`
  を呼ぶ（`requestAnimationFrame`を2回挟んでから呼ぶのは単一印刷と同じ理由
  ＝同期的に呼ぶと描画前で白紙になるため）。`afterprint`で後片付け
  （クラス除去・領域を空に・タイトルを戻す）する。
- 印刷CSS（`app.css`）は`body.rp-mode`のブロックとは別に
  `@media print{ body.rp-bulk-print ... }`を追加で持つ。`#reportPanel`
  （単一プレビュー側）を丸ごと隠し、`#reportBulkPrintArea`だけを表示、
  中の`.rp-page`は`page-break-after:always`（最後の1件だけ`auto`）で
  1ロット1ページに改ページする。用紙向き（`@page`のsize）は
  `updatePageSizeStyle()`が書き換える`#rpPageSizeStyle`が単一印刷と共通で
  効くため、一括印刷側で別途向きを指定する必要はない。

### 帳票ビューの縦方向（A4縦を大きく見せる）

A4縦は `fit` 倍率が**高さで決まる**（210×297mm を横長の画面に収めるため、
横幅には常に余りがある）。したがって**表示を大きくする＝縦のchromeを削る**
であり、左パネルを畳んだり横幅を広げても倍率は上がらない。

| 削ったもの | 効果 |
|---|---|
| `body.rp-mode` で一覧用のアプリヘッダ＋設備バナーを非表示 | 122px |
| 3段（見出し帯66 + ツールバー57 + PDF注意書き26）→ `.rp-bar` 1本 44px | 105px |
| `.rp-scroll` の余白 20px→8px / パネル余白 9px→4px | 34px |

結果、A4の倍率は 1400×900 で 49%→71%、1920×1080 で 67%→87%。

- 操作類は **`.rp-bar` 1層に集約**する。ここに段を足すと直接倍率が下がる。
- 印刷・PDFは**アイコン + `title`**。PDFの「印刷ダイアログが開く」旨の注意書きは
  常時表示をやめて `title` に入れてある。
- 使用頻度の低い表示設定（ラベルの出し方）は左パネル最下段 `.rp-nav-foot` へ。
- 印刷CSS（`@media print`）は `.rp-bar` と `.rp-nav` を隠す。**バーのクラス名を
  変えたらこの行も直す**こと。

### A4縦 / A4横

用紙寸法は `.rp-page` / `.rp-page.rp-landscape` で入れ替える。倍率計算
（`fitPage`/`applyScale`）は実寸を読むので自動で追従する。印刷側の用紙向きは
**`@page` をクラスで切り替えられない**ため、`updatePageSizeStyle()` が
`<style id="rpPageSizeStyle">` を書き換える（`app.css` の既定 `@page` より後に
挿入されるので、こちらが勝つ）。

**倍率を決める辺が向きで変わる**:

| 向き | 律速 | 一覧を畳むと |
|---|---|---|
| 縦 210×297 | 高さ | 倍率は変わらない（余白が減るだけ） |
| 横 297×210 | 幅 | 77% → 98%（1400×900 実測） |

横向きは高さが210mmしかなく、測定データ表（40行）を1本で積むと**59mmはみ出して
2ページに割れる**。そのため `widthMeasurementSection()` は横向きのとき
`1〜20条 / 21〜40条` の2ブロックへ左右分割する（`.rp-wide-split`）。向きを変えたら
表の組み方が変わるので、`applyOrientation()` は `renderReport()` を呼び直す。

一覧を畳む `.rp-body.rp-nav-hidden` は **`grid-template-columns` を1列にする**こと。
`0 minmax(0,1fr)` の2列指定のままだと、`display:none` でグリッドから外れた
`.rp-nav` の代わりに `.rp-main` が幅0の第1列へ自動配置され、表示領域が潰れる
（実測で内容幅16px・倍率が下限25%へ落ちた）。

向きと一覧の表示状態は端末ごとの設定として `localStorage`
（`WaveLogReportOrientationV1` / `WaveLogReportNavHiddenV1`）に保持する。

### ハンドラ結線の注意

- `measurement-view.js` の `.selectors` 一括 `onchange=markDirty` は、
  `#measureType` などの個別ハンドラ割当より**先**に実行される必要がある
  （後にすると個別ハンドラを潰す。過去に実不具合化）。
- イベントハンドラへ関数を渡すときは、後からラップされうる関数は
  `()=>fn()` 形式で遅延参照する（`#reload`・`#reloadMaster` はこの形式。
  直接参照 `el.onclick=fn` は捕捉時点の実装で固定されてしまう）。

## 開発・検証の約束事

- **サーバー再起動が必須**: テンプレート/静的ファイルの自動リロードは無効。
  `app.py`・`templates`・`static` を変更したら Flask を再起動して確認する
  (`python3 process_manager.py stop` → `python3 -u start_app.py`)。プロセス名で
  一括終了する `pkill` は、同じPCの他のPythonを巻き添えにするため使わない。
- **回帰テスト**: Playwright のヘッドレステスト群（開発環境のscratchpadに
  `test_*.js`）を変更のたびに実行する。仕掛/品質データ(`/api/table` 等)は
  引き続きAccess接続のため、Accessドライバの無い環境では `page.route` で
  モックして検証する。一方マスタ(`/api/operator-master` 等)はSQLite化に
  伴いAccessドライバ無しの環境でも実際にサーバー経由で読み書きして検証できる
  （マスタ系のテストはモック不要）。
- **リリース**: 意味のある変更ごとに `backend/changelog_data.py` の
  `APP_VERSION` を上げ、`CHANGELOG` 先頭にエントリを追記する（アプリ内の
  更新履歴表示がこれを直接参照する）。
