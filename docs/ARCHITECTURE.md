# WaveLog アーキテクチャ

このドキュメントは、コードを読む・変更する人向けの構成説明です。
機能一覧や起動方法は `README.md` を参照してください。

## 全体像

- **バックエンド**: Flask (`app.py`)。仕掛(`SIKALOTNOW.sqlite3`)・品質データ
  (`SIKALOTDEF.sqlite3`)は工場側の別システムが所有する読み取り専用のSQLite
  ファイル(ネットワーク共有)を参照。マスタ・測定データバックアップは
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
`start_app.py`/`backend/launcher/guard.py`/`backend/launcher/server.py`/`process_manager.py`/
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
| `backend/launcher/guard.py`(旧`launch_guard.py`) | ポートの使用状況と `app_id` の照合による多重起動判定(`OURS`/`FOREIGN`/`UNRESPONSIVE`/`FREE`)、起動中インスタンスの記録。`UNRESPONSIVE`(ポート使用中だがHTTP応答が無い)は自プロセスが重い処理でブロックされている可能性を含むため、即座に別アプリ(`FOREIGN`)と決め付けず`process_manager.py`側でinstance.jsonのapp_root照合による強制終了判断へ委ねる |
| `backend/launcher/server.py`(旧`server.py`) | Webサーバーの起動のみ。起動監視とWeb処理の境界 |
| `process_manager.py` | 対象アプリだけの安全な停止（正常終了要求→記録済みPID。プロセス名では判定しない） |
| `loading.html` | 起動待機画面。サーバーより先に `file://` で開かれ、`/api/ready.js` の応答を待ってからアプリへ遷移する。段階表示は `boot_status.js` を読んで**実際の進捗**を出す。進捗バーはサーバー6段階＋ブラウザ4段階の10段階ぶんで、6/10(60%)まで進めてアプリ側の起動オーバーレイへ引き渡す |
| `backend/boot_status.py` | 起動の段階をアプリ直下の `boot_status.js` へ書き出す。サーバー側6段階(`STEPS`)とブラウザ側4段階(`BROWSER_STEPS`)の定義、合計数(`TOTAL_STEPS`)、バージョン番号の供給元。待機画面はまだサーバーが無い状態なので、`<script src>` で読み取れるJSファイルを介す。書き込みに失敗しても起動は止めない。`/api/ready.js` で削除する(`.gitignore`済み) |
| `templates/index.html` の `#appBoot` / `static/css/95-boot.css` | アプリ内の起動オーバーレイ。待機画面から意匠と段階リストを引き継ぎ、**画面が組み上がるまで本体を見せない**(下記) |
| `_pycache_bootstrap.py` | `.pyc` キャッシュをローカル領域へ逃がす。`sys.pycache_prefix` は最初のimportより前に設定する必要があるため、各エントリポイントの一番最初のimportにする |
| `config/local.json` | マスタDB自体の置き場所を決める3項目(`db_dir`/`master_db_path`/`records_db_path`)専用のブートストラップ設定(値をマスタDBの中に保存すると読みに行く先が分からなくなるため、この3つだけは唯一この方式が残る)。未配置なら既定の`db/`のまま。それ以外(`sikalotnow_path`/`sikalotdef_path`等)はパス設定マスタ(下記)へ移行済み |
| `backend/config.py` | アプリID・表示名・ポート・監視しきい値などアプリ固有値の集約先 |
| `backend/paths.py` | `%LOCALAPPDATA%` 配下の解決、共有フォルダー配置の検出、`config/local.json` の読込(`load_local_config`/`configured_path`。マスタDB自体の置き場所を決める3項目専用のブートストラップ設定。それ以外の運用設定はパス設定マスタ(`db_access.py`)へ移行済み) |
| `backend/logging_setup.py` | ログ初期化。`launcher.log`(起動・停止) と `app.log`(本体) の2系統 |
| `backend/watchdog.py` | プロセスの生存管理。ハートビート監視・明示停止(`/api/shutdown`) |

`_pycache_bootstrap.py` は `start_app.py`・`process_manager.py`・
`app.py` の3つすべてで最初にimportしている(直接実行され得るのはこの3本。
`backend/launcher/server.py` はimportされるだけになったので不要になった)。
単独で起動され得る経路が複数
あり、1箇所だけに書くと別経路で `.pyc` がアプリ側へ生成されてしまう
(`process_manager.py stop` を単体実行した際にこれが起きることを実測で確認し、
全エントリポイントへ追加した)。

起動待機画面は `file://` から開かれるため `fetch` ではCORSで応答を読めない。
生成元をまたいで読み込める script 要素で `/api/ready.js` を叩き、JSONP形式で
アプリ識別情報を受け取ってから遷移する。これによりブラウザとサーバーの
どちらが先に立ち上がっても接続エラー画面が出ない。

段階表示も同じ理由で `<script src="boot_status.js">` を介す。以前は**経過秒数
だけ**で切り替えていたため、5秒を過ぎると何をしていても「接続を確認中」に
留まり、共有の応答待ちで長引いたときにどこで待たされているのか分からなかった
(実際に「起動時の『接続を確認中』が長い」という指摘を受けた)。現在は
`backend/boot_status.py` が実際の段階を書き出す。詳細は
`docs/SCHEDULE_MODE_DESIGN.md` §9.47。

### 起動は「サーバーが応答したら終わり」ではない（起動オーバーレイ）

`/api/ready.js` が応答した時点では、まだ画面は出来ていない。ブラウザが
17本のJSを読み、権限を確かめ、一覧を取り、そこでようやく完成する。
実測すると、最初の描画(+85ms)から落ち着く(+451ms)までに**5回**の
組み替えが起きていた。

| 時刻 | 起きていたこと |
|---|---|
| +85ms | 最初の描画。ナビ項目5個・案内バーあり・バッジは「最新版」 |
| +121ms | 使用設備の案内バーが消え、一覧が **78px** 跳ね上がる |
| +201ms | タブ行が入り、一覧が 50px 下がる |
| +284ms | ナビ項目が 5→7 に増える(ダッシュボード・実績カレンダー) |
| +301ms | バージョンバッジが「最新版」→「VER1.88.0」 |
| +418ms | モードバッジが現れ、ヘッダーが組み替わる |

「起動直後だけ一瞬崩れた画面が出る」の正体はこれ。**組み上がるまで
本体を見せない**ことで解決している。

- 覆いは `templates/index.html` の `#appBoot`。`<html class="app-booting">`
  が付いている間、`static/css/95-boot.css` が
  `body>*:not(#appBoot){visibility:hidden}` で本体を伏せる。
- **`display:none` にしない。** 幅・高さが測れなくなり、初期化中に寸法を
  見て組み立てている箇所が壊れる。`visibility:hidden` ならレイアウトは
  そのまま進むので、裏側で完成させてから見せられる。
- 覆いのCSSは `<link>` で読む束(`/css/app.css`)に入っている。**この
  `<link>` は描画を止める**ので、最初の描画時点で既に適用済み。
  インラインの critical CSS は要らない。
- 解除は `WL.boot`(`base.js`)。ブラウザ側の4段階
  (`assets`=全JS読込完了 / `permission`=モード確定 / `list`=一覧取得 /
  `layout`=2フレーム待って寸法確定)が揃った時点で `app-booting` を外し、
  覆いをフェードさせて DOM から取り除く。本体が見えるのと覆いが消えるのを
  同時に始めるので、切り替わりが継ぎ目に見えない。
- **必ず解除されること**が最優先。段階が終わらなくても8秒で外す
  (画面が出ないまま固まるのは、崩れて見えるより悪い)。`base.js` 自体が
  読めなかった場合の保険も `index.html` に置いてある(12秒)。
- 段階の一覧は `boot_status.py` / `loading.html` / `index.html` の3箇所に
  同じものが要る(待機画面は `file://` で開くため共有できない)。
  `tests/test_boot.py` が3箇所の一致を固定し、`tests/test_bootui.js` が
  「覆いが外れた後に組み替えが起きていないこと」を実測する。

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
| `backend/routes/masters.py` | 各種マスタCRUDのBlueprint（設備/オペレータ/スプール/内径/機器/フィルタプリセット/列表示/アクセス権限）。URLは分離前と同一。リクエスト受付とレスポンス整形のみを行い、データアクセスは`repositories/master_repo.py`へ委譲 |
| `backend/routes/path_config.py` | パス設定マスタとパス参照ダイアログのBlueprint（`masters.py`から分離）。データアクセスは例外的に`db_access.py`（起動時に接続先を確定させる都合、`master_repo.py`はdb_accessに依存する側のため） |
| `backend/routes/rne.py` | RNE抽出の状態表示と手動実行のBlueprint（`masters.py`から分離）。手動実行は「読み直すだけのPOST」として`access_mode._READ_ONLY_POST_ENDPOINTS`に`rne.rne_extract_run`で登録 |
| `backend/repositories/master_repo.py` | 各種マスタのデータアクセス層。テーブル定義(`ensure_*_table`)・正規化(`normalize_*_name`)・読み取り(`*_master_rows`/`read_*_names`)・書き込み補助(`set_operator_equipment`/`set_hidden_columns`)。Flaskに依存しない |
| `backend/changelog_data.py` | `APP_VERSION` と `CHANGELOG`（データのみ。リリースごとにここを更新） |
| `backend/db_access.py` | `DBS`(接続先定義)・`APP_ROOT`/`DB_DIR`(パス基準)・`connect`/`cols`/`tables`/`qi`(SQLite専用。`.accdb`/`.mdb`は対処を添えて拒否)・監査列・バックアップテーブル整備・パス設定マスタ(`PATH_CONFIG_TABLE`、旧`config/local.json`。仕掛/品質データの読み込み先・共有パス・各種間隔設定を`db/master.sqlite3`側で管理し、`master_repo.py`と同じ形のCRUDヘルパを提供する) |
| `backend/records_export.py` | 測定データバックアップ(`records.sqlite3`)の閲覧用複製(定期・差分あり時のみ) |
| `backend/access_mode.py` | 編集可能モード/閲覧モードの判定・切替API・書込系APIのガード(`before_request`) |
| `backend/navigator_api.py` | SymfoNavi Navigator API(`SymNaviA.dll`)のctypesラッパー(Windows専用、SymfoNavi-Data-Hubから移植) |
| `backend/rne_extract.py` | RNEから仕掛/品質データをSQLite3として抽出する1ジョブ分のロジック(CSV解析・SQLite書き込み・アトミック公開) |
| `backend/rne_worker.py` | `rne_extract.extract_one`をサブプロセスとして実行するエントリポイント(`python -m backend.rne_worker`) |
| `backend/rne_scheduler.py` | 仕掛/品質データのローカル運用(`sikalot_source=local`)時、RNE抽出を定期的に並列実行する背景スレッド |

依存方向は `start_app.py → backend.launcher.server → app.py → backend.routes.* →
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

仕掛(SIKALOTNOW)・品質データ(SIKALOTDEF)は既定でネットワーク共有上の
SQLiteファイルを直接読む（工場側の別システムが所有・書込する読み取り専用
データ。実際の場所はパス設定マスタの`sikalotnow_path`/`sikalotdef_path`)。この既定は
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
- **リポジトリには実体が無い**。`*.RNE`と`SymNaviA.dll`は追跡解除済みで、
  クローンしただけの状態では`config/rne_extract/`にREADMEと
  `symnavim.conf.example`しか無い。実環境ではセットアップ時にPCごとへ
  配置する(配置しないと抽出は動かないが、アプリの他の機能には影響しない)。
  なお過去のコミット履歴にはこれらのファイルが残っている(追跡解除は
  以後の追跡を止めるだけで、履歴は書き換えない)。

**状態表示と手動実行**

抽出は背景で回るだけで、成否はアプリログにしか出ていなかった。マスタ管理 >
パス設定の下部に状態パネルを置き、有効/停止・直近の成否と行数・抽出先の
最終更新・資材の配置状況を表示し、「今すぐ抽出」で任意のタイミングでも
走らせられるようにしてある(`/api/rne-extract/status`・`/run`。詳細は
`docs/SCHEDULE_MODE_DESIGN.md` §9.50)。
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
| `list-view.js` | `init`・`selectDb`/`selectTable`/`load`・`fetchTableData`(取得キャッシュ。`filters.js`の`load()`と共用)・`renderGrid`・更新履歴モーダル・検索/ページャ |
| `measurement-view.js` | `ensureMeasureShape`・`collect`・`renderMeasurement`・各パネル描画（品質等級/コース/製品丈/作業時間）・入力検証（`updateValidationVisuals`）・`updateMeasurementHeading` |
| `measurement-input.js` | `deviceParse`・`processDeviceInput`・`focusCurrent`・`renderMeasureGrid(Vertical)`・`judgeInput`・公差計算（`toleranceDetail`/`toleranceDataForSource`/`compactTolerance*`）・公差数直線の値→縦位置の写像（`WL.toleranceScaleView`、下記） |
| `records-store.js` | IndexedDB/ミラー永続化・`saveLocal`/`persistAndTransition`・`openMeasurement`・`openRecords`/`renderRecordListRows`・`loadMeasurementContext`・使用設備設定/設備マスタ・Access同期の未完了キューと再送・アプリ起動呼び出し（末尾） |

### 画面ごとの操作列をヘッダーへ相乗りさせる（#headerViewBar）

各画面は「画面名＋操作」の見出しバーを自前で持っていた。画面名はヘッダーの
`#fileName`と同じ文字が二重に出るうえ、バー1本ぶん本文の高さを食う。

- **画面名はヘッダーだけが持つ**。パネル側の見出し(`.sc-title`/`#recordTitle`/
  ダッシュボードの`.rp-head`/マスタ管理の`.mm-head`の濃色バンド)は廃止。
- 操作列は `registerView({toolbar:'#scHead'})` で宣言し、`WL.enterView` の
  `mountViewToolbar()` が `#headerViewBar` へ **DOMごと移動**させる。
  移動なのでハンドラ・id参照はそのまま生きる。退出時は元の親へ戻す
  (`toolbarHome` が親と兄弟を覚えている)。
- **パネルが `enterView` の後に組み立てられる画面**(ensurePanel等)は、
  組み立て後に `WL.syncViewToolbar('key')` を呼んで載せ直す。呼ばないと
  操作列がパネル内に残る(実際に踏んだ)。
- ヘッダーの2行目として全幅で置く。1行目へ詰め込むと画面によって入りきらず
  切れる。独立した行にすると位置と高さがどの画面でも同じになる。
- 一覧専用の操作(検索・表示件数・再読込)は、一覧以外の画面では出さない
  (`body.sc-mode .global-actions .hd-search{display:none}` 等)。表示サイズは
  全画面共通なので残す。
- **画面ごとの「×(閉じる)」は置かない**。左のメニューから別の画面へ移れば
  `enterView` が閉じるので、その画面だけ閉じ方が違う状態になる
  (作業スケジュールの`#scClose`・マスタ管理の`#closeMasterMaint`を廃止)。

| 画面 | `toolbar` | 中身 |
|---|---|---|
| 作業スケジュール | `#scHead` | 設備選択・まとめ単位・表示範囲・ポップアップ・再計算 |
| ダッシュボード | `#dbHeadActions` | 稼働状況/自設備/自由集計のタブ・再読込 |
| 実績カレンダー | `#calToolbar` | 月送り・今月・作業重量/ロット数・完了のみ/すべて |
| マスタ管理 | `#mmHead` | 更新者ID |
| データ一覧 | `#recordSearchBar` | 編集中/完了・絞り込み・並び順・検索解除 |

寸法は `--ctl-h-sm`(30px)、その中へ入れ子になる2択・タブだけ `-4px`(26px)。
文字は `--fs-sm` 一本で、`‹ ›` のようなアイコンのみのボタンだけ `--fs-title`
(記号なので本文サイズだと潰れる)。

- 回帰は `tests/test_theme.js`（5画面すべてで載せ替え・寸法・文字サイズを見る）。

### 分割数（条数）とロット数は別物

条割まわりで**必ず区別する**。データ上の持ち方が違う。

| | 数える対象 | 出所 | 上限 |
|---|---|---|---|
| ロット数 | 親ロットを分けた子ロット | `親子管理_子カード*` / `コンマ5本分割_切断巾*` の**枠**（枠は10まで）/ `LTNO*` | **9** |
| 条数（分割数） | 幅方向に割った条 | 各子ロットの条数（`YK*`・`K05JO*`、無ければ横割数）の**合計** | **設備ごと**（既定40） |

- **切断巾N は「N本目の条の幅」ではなく「N番目の子ロットの製品幅」**。枠の数は
  ロット数であって条数ではない。1つの子ロットを何条にも割れるので、条数は
  枠の数以上になる。
- `analyzeRowSplit(row)` は `lotCount` と `stripCount` の**両方**を返す。
- 上限は `MAX_CHILD_LOTS=9`（ロット）と `WL.maxStripsForEquipment()`（条）。
  後者は設備マスタの`最大条数`（`/api/measurement/context`の`max_strips`）で、
  `STRIP_LIMIT=40` を超えられない——測定値の配列も条ストリップ（20行×2列）も
  40条で組んであるため、構造上の天井が40。設備ごとの設定はこれを**下げる**用途。
- `applySplit` が条数とロット数を別々に確認する。区間（連続したかたまり）の数で
  見てはいけない——同じ2ロットを交互に置くと区間だけが増える。
- 表示は「Nロット / M条」と両方を出す（`summarizeAppliedGroups`、仕掛一覧の
  分割セル、幅分割情報パネル）。
- 横割数(`#horizontalCount`)の`max`と`updateCoilOptions`の丸めも、設備の最大条数へ
  追随する（`applyMaxStripsToInputs`/`currentMaxStrips`、measurement-view.js）。
- 条の入力欄には、**分割ありのときだけ**子ロット番号の下3桁バッジを出す
  (`.strip-lot-badge`、lot-split.jsが`makeMeasureInputV29`をラップして注入)。
  色は `appliedLotColorMap()` が返す**異なるロットの並び順**の配色で、
  条割の視覚図・幅分割情報パネルのロット№の色丸(`.split-lot-dot`)と同じ。
  表・入力欄・帯グラフが同じ色でつながることが狙いなので、**色を決める場所は
  この関数1つ**にする。単一ロットでは出さない(全行に同じバッジが並んでも
  情報が増えないため)。
- 回帰は `tests/test_defect.js`(数え方) と `tests/test_theme.js`(バッジと文字の
  大きさ)。

### 現場段取りの対象設備（複数指定と「すべての設備」）

アクセス権限マスタの`現場段取り対象設備`はTEXT1列のまま、3つの書式を持つ。

| 保存値 | 意味 |
|---|---|
| `''` | 未設定（権限なし）。**空欄は全設備許可ではない** |
| `*` | すべての設備（開発・保守用） |
| `A,B,C` | 列挙した設備だけ |

- 列を増やさないのは、既存行の移行が要るうえ、判定する場所が
  **サーバー2箇所・画面2箇所**あり、全部直さないと「画面は並べ替え可と出すのに
  APIが403」という食い違いが起きるため。判定は
  `master_repo.field_reorder_equipment_allows()`（サーバー）と
  `WL.fieldReorderAllows()`（画面、access-mode.js）の**2つだけ**に集約し、
  同じ規則で書く。片方を変えたら必ずもう片方も変える。
- 入力欄はマスタ管理のタグ入力（`equipment-multi-text`）。「すべての設備」を
  選んでいるあいだは個別選択を触らせない（両方効いて見えると、どちらが
  保存されるのか分からなくなる）。
- 回帰は `tests/test_theme.js`。

### 異常位置判定（defect-locator.js）

欠陥を見つけた位置から「OSから何条目・どの子ロットか」を求める機能
（測定画面のメニュー「異常位置判定」→ `#defectModal`）。

- **追加入力は基準位置からの距離だけ**。条の幅・並び・子ロット番号は
  `settings.splitGroups`/`splitPositionGroup`（`lot-split.js`が確定させたもの）、
  元幅は `basic.originalWidth`、屑幅は「元幅 − 条幅合計」から組み立てる。
  条割が未確定なら製造板幅×横割数で等分する（その旨を画面に出す）。
- **内部は「製品座標」に一本化**する。条1のOS端を0、DS方向を正とする軸へ
  基準位置4通りをすべて落としてから条に当てる。屑は左右均等に付く前提
  （条割の視覚図 `renderScrapAndRuler` と同じ）なので、屑幅を含む基準
  （元幅）で測った値は屑幅の半分を引いて製品座標にする。
  **屑幅を含む/含まないの取り違えは屑幅の半分ぶんずれる**ため、
  基準幅は必ず選ばせる（既定は元幅）。
- 欠陥は幅を持つ（既定5mm）。その幅に少しでも掛かる条をすべて該当とする。
  幅0のときだけ「点がどの条の区間に入るか」で1条に決める。
- 帯グラフは条割の視覚図と同じ見せ方（左OS・右DS・屑帯・センターライン）に
  欠陥の帯と位置を重ねる。**別の見た目にすると同じ並びを読み替える手間が
  生まれる**ので、条の並び順・屑の振り分け方は視覚図と同じにする。
  ただしDOMは `.defect-*` で独立させる（`.split-visual-measure` は横並びの
  flexなので、位置ラベル行・帯・目盛りを縦に積む用途には使えない）。
- **器の大きさは中身で変えない**。`.defect-dialog` は幅・高さとも固定
  （`width:min(1180px,95vw);height:min(780px,92vh)`）で、内部は
  `grid-template-rows:auto minmax(0,1fr) auto`。伸び縮みしてよいのは
  内訳（`.defect-detail`）だけで、そこだけがスクロールする。
  以前は `max-height` だけだったため、該当条が増えたりエラー文が出る
  たびに窓が伸び、操作列が画面外へ押し出されていた。
- **「印刷ボタンが消える」の実体はCSSの要素セレクタ**だった。操作列が
  `<footer>` で、一覧下端のページャ用に書かれた `body.sc-mode footer{display:none}`
  等（7モード分）がモーダルの操作列まで巻き込んでいた。ページャは
  `<main>` 直下なので `main>footer` へ絞ってある。
  **モーダルの部品に素の要素セレクタを当てないこと**。
- **判定できないときも枠とボタンは消さない**。図には理由付きの
  プレースホルダを置き、押せないボタンは `disabled` のまま理由を `title`
  に出す。以前はエラー時に図のHTMLを空文字で潰していた。
- 色は**この図で唯一の高彩度が欠陥の赤**になるよう、条のパレットの彩度を
  一段落としてある。該当条は色だけでなく赤枠・条番号の白抜き・図の上の
  ▼マーカーでも示す。子ロットが2つ以上あるときは色と条番号の凡例を出す。
- 位置の数値ラベルは帯（`overflow:hidden`）の**外**の `.defect-flags` に置く。
  図の端に来たときは `at-start`/`at-end` クラスでラベルだけ内側へ寄せる
  （寄せ方はCSS側。JSは「どちら端か」だけを渡す）。
- **一時データと保存を分ける（§9.70）**。入力は従来どおり
  `settings.defectLocation` へ書き戻して途中再開に使うが、これは
  「オペレータが試算しただけ」の扱いで帳票には出さない。
  **保存ボタンを押したときだけ** その時点の判定を
  `settings.defectLocation.saved`（入力・条の並び・該当条・座標の凍結）へ
  写し、帳票の対象にする。保存後に入力を変えても `saved` は据え置き、
  操作列に「保存し直すまで帳票は保存時の内容」と出す。
  `saveInput()` が `defectLocation` を作り直す際に **`saved` を落とさない**
  こと（落とすと入力を1文字触っただけで帳票から消える）。
- 測定帳票への相乗りは `WL.defect.reportSectionHtml(record)`。
  `report-dashboard.js` は `defectSection(x)` から呼ぶだけで、描画は
  defect-locator 側に置く（モーダルと同じ計算・同じ配色を1箇所に保つ）。
  掲載位置は**板幅の実測表の直後**（条番号で突き合わせるため）。
  高さは条数によらず一定。ON/OFFは帳票左下の「表示」列
  （`#reportDefectToggle`、既定ON。保存が無ければトグルに関わらず出ない）。
- モーダル単独の帳票は `.df-print-area` を印刷時だけ本文と入れ替える方式
  （測定帳票の一括印刷 `rp-bulk-print` と同じ）。
- 距離の空欄は**未入力**として扱う（`Number('')` は0なので、素通しすると
  1文字も入れていない状態が「OS端ちょうど」と判定されていた）。
- 公開は `WL.defect`（`open`/`close`/`compute`/`lanes`/`refresh`/`save`/
  `unsave`/`reportSectionHtml`/`hasSaved`）。回帰は `tests/test_defect.js`
  （`WAVELOG_SHOT=<dir>` を付けると各状態の画面を書き出す）。

### 公差数直線（測定画面の左側）

板幅・バリ等の測定ブロックの左に出る縦の数直線。上限・下限・**基準値**の
目盛りと、測定済みの値をスウォームプロット（近い値は左右へずらす）で示す。

- 描画本体は `filters.js` が `compactToleranceScale` を上書きして持つ
  （`measurement-input.js` の素の実装 → `measurement-tolerance.js` →
  `filters.js` → `measurement-worklog.js` の順にラップされ、**読み込み順で
  最後が勝つ**。指示型のときだけ `measurement-worklog.js` が専用カードへ
  差し替える）。
- **値→縦位置(%)の写像は `WL.toleranceScaleView` に一本化する**。数直線の本体と、
  測定器から受信中（確定前）の先読みリング `#numberlinePending`
  （`updateNumberlinePending`）の2箇所が使う。以前は両者が別々に式を持ち、
  端の丸め方だけ違った（3%/97% と 5%/95%）ため、リングの高さと確定後の点の
  高さがずれていた。**新しく点を打つコードもこの関数を経由すること**。
- 中央の目盛りが指すのは**範囲の中点ではなく基準値**。公差が非対称
  （例 +3/-1）だと中点1001に対し基準値は1000で、狙うべき値は後者。
  片側公差で基準値が上限・下限と重なるときは、目盛りを2枚重ねずに
  限界値のラベルへ「(基準)」を添える。基準値の出所は公差カードと同じ
  `compactToleranceData`（分割ロットは条ごとに基準値が変わるため）。
- 表示範囲は公差幅の上下±25%を既定とし、**公差外の測定値が入るところまで
  広げる**。固定窓だと外れ値がすべて上端／下端に張り付き、1つ外れと大きく
  外れが同じ高さに見えた。広げるのは公差幅の1.5倍まで（桁違いの誤入力
  1件で公差帯が線に潰れないように）。
- 回帰は `tests/test_tolscale.js`。フィクスチャの仕掛データに公差カラムが
  無いため、非対称公差を注入してから実測する。

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
  マスタ管理画面（`master-maint.js`の`MASTER_DEFS`、key:
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
`filters.js` → `measurement-worklog.js` → `master-maint.js` →
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

**モーダルを使う基準はここに一本化する**（`master-maint.js` の
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
- モーダルの下段は `<div class="mm-editor-foot">` で組んである。以前は
  メイン画面統合型ビューの共通ルール（`body.mm-mode footer{display:none}` 等）が
  素の要素セレクタ `footer` を対象にしていたため、`<footer>` で組むと保存・
  キャンセルボタンごと消えた（実装時に踏んだ不具合）。VER1.84.0 で
  共通ルールを `main>footer`（一覧下端のページャ）へ絞ったため元の原因は
  無くなったが、**画面の骨組み用ルールを素の要素セレクタで書かない**という
  方針自体は変わらない（「CSSの優先順位は @layer だけで決める」節を参照）。

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
  `MeasurementFilterCondUsageV2`、キーは `${S.db}\u001f${S.table}`）。V1は
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

### CSSの置き場所（`static/css/` を読み込み順に並べる）

CSSは1ファイル3,900行から**16ファイル**へ分けてある（VER1.86.0）。分け方の
規則はひとつだけ：**元の並び順を変えない**。同じ `@layer` の中では今も
「後に書いたほうが勝つ」が効くので、順序を保った切り出しに限定すれば
カスケードは完全に等価になる（実測: ルール2,195件の並びが分割前後で一致、
45画面の1画素比較で差は文字の縁のアンチエイリアス±1のみ）。

| ファイル | 中身 |
|---|---|
| `00-base.css` | **レイヤの並びの宣言** + reset + トークン + 素の要素 |
| `10-roles.css` | 役割ごとの寸法・文字（**ここが唯一の決定場所**） |
| `20-shell.css` | 骨格・左ナビ・ヘッダー・一覧・タブ・ページャ |
| `30-measure.css` | 測定画面（骨格・各ペイン・エディタ・母材/製品/品質） |
| `35-split.css` | 条割変更モーダル |
| `40-records.css` | データ一覧・設備設定・保存オーバーレイ・レスポンシブ |
| `45-tolerance.css` | 公差数直線・フィルタ |
| `50-master.css` | マスタ管理 |
| `55-quality.css` | 品質データ分析 |
| `60-report.css` | 測定帳票（画面）・ダッシュボード |
| `65-calendar.css` | 実績カレンダー |
| `70-schedule.css` | 作業スケジュール・勤務体系 |
| `75-master-paths.css` | マスタ管理（パス設定・RNE抽出） |
| `80-defect.css` | 異常位置判定（画面と専用帳票） |
| `85-headerbar.css` | ヘッダーの操作列 |
| `90-state.css` | `state` / `mode` / `print` / `utility` |
| `95-boot.css` | 起動オーバーレイ（組み上がるまで本体を見せない） |

**配信は1本にまとめる。** `backend/routes/core.py` の `CSS_FILES` が並びを
持ち、`/css/app.css` が読み込み順に連結して返す（更新時刻でキャッシュ）。
分割の目的は「人が読み書きしやすいこと」なので、ブラウザまで分ける必要は
ない。**この `<link>` は描画を止める**ので、最初の描画の時点で全ファイルが
適用済みになる（起動オーバーレイがインラインCSSを必要としないのはこのため）。
実際に `<link>` を16本並べたところ、**1ページ表示ごとに16往復増え、
起動直後の一覧取得と競合してテストが13件落ちた**（仕掛の索引のページ送りが
1ページで止まる、取り込み画面が描き切らない等）。見た目の問題ではなく
タイミングの問題なので、原因が分かりにくい。

**守ること**

- **読み込み順を変えない。** 順序の唯一の定義は `backend/routes/core.py` の
  `CSS_FILES`。`tests/test_csslint.py` がそこを読み、ディスクの中身と
  食い違っていないか、テンプレートが個別ファイルを直接読んでいないかを
  固定している。
- **レイヤの並びを宣言してよいのは `00-base.css` だけ。** 他が宣言し直すと
  並びが二重定義になる（これも lint が見る）。
- 話題が2つのファイルに分かれている箇所がある（マスタ管理が
  `50-master.css` と `75-master-paths.css`、ヘッダーが `20-shell.css` と
  `85-headerbar.css`）。**まとめたくなっても動かさないこと** ——
  移動は同点勝負の勝者を入れ替え得る。まとめるなら、移動区間と移動先の
  あいだに「主語（セレクタ右端）が同じルール」が無いことを確かめてから。
- 新しい画面のCSSは、新しい番号のファイルを作って
  `templates/index.html` と `tests/test_csslint.py` の並びへ足す。

### CSSの優先順位は @layer だけで決める（`!important` 禁止）

`static/css/00-base.css` の先頭で並びを宣言している。**後ろのレイヤほど強く、
詳細度よりレイヤ順が先に効く。**

```
@layer reset, tokens, base, component, state, mode, print, utility;
```

| レイヤ | 中身 |
|---|---|
| `reset` | 箱の初期化（`box-sizing`） |
| `tokens` | `:root` のデザイントークン。値だけを置く |
| `base` | 素の要素の既定（`button` / `input` / `body`） |
| `component` | 部品。CSSの大半（1,920ルール） |
| `state` | JSが実行時に付ける状態クラス（`.validation-*` / `.is-*` / `.choice-*`） |
| `mode` | 画面モードの出し分け（`body.sc-mode` など） |
| `print` | 印刷時の上書き（`@media print`） |
| `utility` | 最後に必ず効かせたいもの（`[hidden]`） |

**なぜ必要だったか**: それまでは「ファイルの末尾に書いた方が勝つ」が事実上の
優先順位だった。実DOMで測ると1要素1プロパティに2本以上のルールが当たる箇所が
39,334件、うち**2,403件は詳細度が同点**で書いた場所だけで勝敗が決まっていた。
新機能を末尾へ足すたびに既存のどこかが静かに変わる状態で、実際に実績カレンダー
の2択で選択中が薄く見える不具合を生んでいた。

**守ること**

- **`!important` は書かない。** 165箇所あったものを0にした。効かせたいものが
  あればレイヤで解決する（`[hidden]` は `utility`、状態クラスは `state`）。
  `!important` を1つ書くとレイヤ順が逆転し、上の表が意味を失う。
- **レイヤの外にルールを書かない。** 外のルールは全レイヤに勝つので、
  1本あるだけで前提が崩れる。
- **JSから見た目のプロパティ（`background`/`color`/`transform`/`display`）を
  インラインで直書きしない。** インラインはどのレイヤより強く、CSSから
  打ち消せなくなる（`!important` が生まれる元凶）。計算した値は
  カスタムプロパティで渡し、使い方はCSSに残す:
  `page.style.setProperty('--rp-scale',s)` ＋ `transform:scale(var(--rp-scale,1))`。
  現在使っているのは `--rp-scale` / `--rp-box-w` / `--rp-box-h`（帳票の拡大率）、
  `--split-block-bg`（条の色）、`--qa-dot-color`（品質分析の色ドット）。
- **画面の骨組み用のルールを素の要素セレクタで書かない。** モードごとの
  出し分けが `body.sc-mode footer{display:none}` のように書かれており
  （一覧下端のページャを消す意図）、同じ要素名を使った**部品**——異常位置
  判定モーダルの操作列 `<footer class="defect-actions">`——まで7モード分すべてで
  消えていた。「印刷ボタンがモーダルから消えることがある」の実体はこれ。
  親を含めて `main>footer` のように**その1箇所だけ**に絞るか、クラスで書く。
  詳細度・レイヤをいくら整えても、当たる範囲が広すぎるセレクタは直せない。
- **`component` から `layout` を切り出さない。** 一度試したが
  `.right-pane.layout-mother .work-tabs{display:none}` のような「部品を器で
  絞り込んだ」ルールまで器側と見なしてしまい、部品側の `.work-tabs{display:flex}`
  に負けて隠れていたタブが出た（45画面の1画素比較で20枚が相違）。切り出すなら
  セレクタの**主語（右端）**で判定し、1件ずつ画面で確かめること。

回帰は `tests/test_csslint.py`（ブラウザ不要）と `tests/visual/`（45画面の
1画素比較）。ブラウザ要件は上がっていない——`@layer` は Chrome/Edge 99+ だが、
このアプリは既に `:has()` と `container-type` を使っており実質 105+ が下限。

### 役割 → 寸法（文字・箱の階層をここで決める）

文字サイズは早くからトークン化していたのに「画面ごとに揃って見えない」
という指摘が続いた。**実測して原因を特定した**（`tests/audit_scale.js` を
`tests/with_fixture.sh` 経由で8画面に流し、computed style を数えた）:

| 測ったもの | 実測 | あるべき数 |
|---|---|---|
| ボタンの高さ | 22/24/26/28/30/31/32/34/35/36/38/40/42/44/46px の**15種** | 4 |
| ボタンの横余白 | 0/4/7/8/9/10/12/14/16/18/22px の**11種** | 3 |
| 角丸 | **28種** | 6 |
| 「見出し」の文字 | `--fs-tiny`〜`--fs-lg` の**8種** | 1 |
| 「ラベル」の文字 | **6種** | 1 |
| 「補足」の文字 | **5種** | 1 |
| 「バッジ」の文字 | **6種** | 1〜2 |

つまり**文字の目盛りはあったが、役割→目盛りの対応が無かった**。11pxと12px、
13pxと14pxは人が目で選び分けられないので、部品ごとに違う選択になっていた。
箱の側（高さ・余白・角丸）にはそもそも目盛りが無かった。

**決め方は `static/css/10-roles.css`（`@layer component` の先頭）1箇所に置く。** 各画面のクラスはそこへ名前を連ねるだけで、個別ルールには
「その部品だけの違い」（配色・並び）しか書かない。

コントロール（ボタン・入力欄）:

| 役割 | 高さ | 横余白 | 文字 |
|---|---|---|---|
| 主要な確定操作（保存・実行） | `--ctl-h-lg` 40 | `--ctl-pad-x`+4 | `--fs` 14 |
| 標準（ヘッダー・ダイアログ） | `--ctl-h` 36 | `--ctl-pad-x` 14 | `--fs` 14 |
| 補助（ツールバー） | `--ctl-h-sm` 30 | `--ctl-pad-x-sm` 10 | `--fs-sm` 12 |
| 表の中・タグ | `--ctl-h-xs` 26 | `--ctl-pad-x-xs` 8 | `--fs-sm` 12 |
| タブ | `--ctl-h` 36 | （タブ側） | （タブ側） |

チェックボックス・ラジオは高さのスケールに乗らない（文字の横に置く四角）
ので `--ctl-box` 16px で別に揃える。

文字:

| 役割 | トークン | 重さ |
|---|---|---|
| パネル見出し | `--fs-title` 15 | 800 |
| カード見出し | `--fs-base-sm` 13 | 800 |
| 要約・補足・ヒント | `--fs-micro` 11 | 700 |
| 本文・入力値 | `--fs` 14 | 400 |
| ラベル・表ヘッダ | `--fs-sm` 12 | 700 |
| チップ | `--fs-micro` 11 | 800 |
| バッジ（件数） | `--fs-badge` 10 | 800 |

角丸は**入れ子の深さ**で決める（`--radius-xs` 4 → `-sm` 8 → `-md` 10 →
`-lg` 14 → `-pill` 999 → `-round` 50%）。外側の器ほど大きく、中に入る
小さな部品ほど小さい。既存の `--radius-tab` / `--radius-card` は
このスケールを引く別名として残してある。

器（コンテナ）の内側余白も3つの役割で決める（VER1.86.0）。実測では
112通りの組み合わせが使われており、同じ役割のダイアログでもヘッダーが
`10px 20px` / `15px 18px` / `12px 18px` / `12px 16px` と画面ごとに違っていた。

| 役割 | トークン | 値 |
|---|---|---|
| ダイアログの頭・胴・足 | `--pad-dialog` | 12px 16px |
| カード・パネル・バー | `--pad-card` | 8px 12px |
| チップ・タグ | `--pad-chip` | 2px 8px |

部品と部品の間（`gap`）は4段（VER1.87.0）。実測で31種類（1〜18px）が
使われており、「ボタンが横に並ぶ」だけで 5/6/7/8/10px が混在していた。

| 役割 | トークン | 値 |
|---|---|---|
| くっついて1つに見せたい小片の間 | `--gap-hair` | 2px |
| 密な並び（表の中・タイムライン・タグ） | `--gap-tight` | 4px |
| 通常の並び（ボタン列・ラベルと値） | `--gap-inline` | 8px |
| まとまり同士の間 | `--gap-section` | 12px |

**表のセルは対象外**。行の高さと対で決まるので `--row-pad-y/x` が持つ。
`button,select,input{padding:7px}` も残してある——役割表に載らない部品の
受け皿で、ここを動かすと未分類のコントロールが一斉に動く。

**残したリテラル**: `padding` は253件残っているが、4箇所以上で使い回されて
いる値はもう無い（すべて1〜3箇所の一点物）。ここをトークンにしても
「同じ役割が揃う」効果は無く、名前を1枚かぶせるだけになる。
**繰り返し現れるパターンが出てきた時点で役割へ足す**のが正しい順序。

### 余白を触るときは「収まるか」も測る（`tests/test_fit.js`）

余白を役割へ揃える作業は、値をそろえると同時に**画面に収まるかどうか**を
動かす。実際、タブの高さを表示サイズへ追随させただけで測定画面の左ペインが
特大で3px溢れた（VER1.85.0）。「揃っているか」の網（`test_scale.js`）とは
別に、「収まっているか」の網が要る。

`tests/test_fit.js` は**表示サイズ5段階 × 8画面**で、
- スクロールできる先祖がどこにも無いのに中身が溢れている器
- ページ全体の横スクロール

を実測する。スクロールできる器は「はみ出して当たり前」なので数えず、
`text-overflow:ellipsis` の欄（画面名・使用設備名）も設計どおりなので数えない。
`<option>` はブラウザ描画なので幅の比較に意味がなく、除外している。

この網は導入した時点で**既存の不具合を1件見つけた**: 測定画面の母材パネルで
「屑幅（両耳合計）」が `white-space:nowrap` のまま1行に押し込まれ、既定
サイズですら3px（特大では28px）枠から溢れ、しかもスクロールできる先祖が
無いので**読めないまま切れていた**。

**守ること**

- **新しいボタンを足すときは、まず役割ブロックのどれかに名前を足す。**
  個別ルールへ高さ・余白・文字サイズを書くと、また15種類に戻る。
- **例外は理由が書けるものだけ**。役割ブロックの「例外」節と
  `tests/test_scale.js` の `CTL_EXCEPT` に理由付きで列挙する
  （幅が決まっているアイコンボタンなど）。理由の書けない例外を足し始めた
  時点で、この網は意味を失う。
- 回帰は `tests/test_scale.js`（実測。高さ・角丸がトークンに収まるか、
  同じ役割の文字が1種類か、寸法を揃えた副作用で文字があふれていないか）と
  `tests/test_csslint.py`（角丸のリテラルpxは帳票だけ、トークンの存在）。
- **A4帳票（`.rp-page` / `.df-page` 配下）は対象外**。用紙の割り付けは
  表示倍率で崩れるため px 固定が正しい。ただし帳票**画面**の操作部
  （`.rp-panel` / `.rp-back-btn` など）は他画面と同じスケールに乗せる。
- 調べ直したいときは
  `tests/with_fixture.sh /opt/node22/bin/node tests/audit_scale.js <出力.json>`。
  画面のPNGも同じフォルダへ書き出す（数字だけでは「どこが揃っていないか」が
  分からないため）。

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
  `selectDb()` → `selectTable()` → `load()` のように入れ子で呼ぶ経路では、
  一番外側だけがオーバーレイを持ち、内側は `report()` で文言を更新する。
  直接 `showWaiting()` する既存経路とも、タイマー発火時にオーバーレイの
  状態を見直すことで衝突しない。
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

### 共有DBを開く手順は最短にする（`Path.exists()` を前に置かない）

読みたいのは**ファイルそのもの**で、`exists()` は別のファイルアクセス
（`os.stat`）である。ローカルディスクなら両方成功するか両方失敗するかの
どちらかだが、**ネットワーク共有では「stat だけ失敗して open は成功する」
ことがある**。実際、`\\...\SIKALOTNOW.sqlite3` に対して

- エクスプローラ／メモ帳で開ける
- `sqlite3.connect()` も成功する（`exists=True` を返す端末もある）

のに `/api/tables?db=SIKALOTNOW` だけが
`[WinError 59] 予期しないネットワーク エラーが発生しました。` で失敗する端末が
あった。原因は接続ではなく、接続の**手前に置いていた存在確認**だった。

`pathlib.Path.exists()` は `OSError` のうち
`ENOENT / ENOTDIR / EBADF / ELOOP` と `WinError 21 / 123 / 1921` だけを
「無い」と読み替え、**それ以外はそのまま送出する**
（CPython `pathlib` の `_IGNORED_ERRNOS` / `_IGNORED_WINERRORS`）。
共有が一時的に応答しないときの `WinError 59 / 64 / 1231` はここに含まれないため、
確認のつもりの1行が唯一の失敗原因になる。しかもメッセージが
「ファイルが無い」ではなく生のネットワークエラーになるので、原因の見当がつかない。

- **`connect(path, readonly=True)` は存在確認をせず、まず開く。**
  失敗したときだけ `path_exists_safe()` で理由を切り分け、
  「無い」なら `FileNotFoundError`、「確かめられなかった」なら共有の到達性を
  促す文面にする（`backend/db_access.py`）。
- **存在確認が要る場所では `path_exists_safe()` を使う。** 戻り値は
  `True` / `False` / **`None`（確かめられなかった）** の3値。`None` を「無い」と
  同じ扱いにしない——共有が不調なだけで、開けば読めることがある。
- **絶対パスに `Path.resolve()` を掛けない。** Windows の `resolve()` は
  `GetFinalPathNameByHandle` を呼ぶ実ファイルアクセスで、ここでも同じ理由で
  落ちる。加えて UNC を `\\?\UNC\...` 形式へ書き換えることがあり、
  4スラッシュ URI の組み立て前提（上記「UNC 共有」の項）が崩れる。
- **共有を触る API は必ず traceback をログへ残す。** 以前 `/api/tables` は
  `except Exception as e: return jsonify(error=str(e)),500` で、画面には
  メッセージとパスしか出ず、**どの行で落ちたのかを現地で切り分けられなかった**。
  いまは `app_logger().exception(...)` を残し、応答にも `hint`（WinError 別の
  対処）を添える。
- **現地で1段ずつ確かめる口**として `/api/db-diagnose?db=SIKALOTNOW` がある
  （`backend/routes/tables.py`）。親フォルダの存在確認 → ファイルの存在確認 →
  `stat` → `resolve` → 1バイト読む → URI 組み立て → SQLite 接続、の順に試して
  結果を JSON で返す。読むだけで設定は変えない。
- 固定は `tests/test_dbopen.py`（`Path.exists`/`stat`/`resolve` を WinError 59
  相当で失敗させても DB を開けること）。

なお **DB キーからパスへの解決は起動時に1回だけ**で、リクエストのたびの I/O は
無い（`db_access.py` の `DBS` を import 時に組み立てる）。`cfg(k)` は辞書引き
だけなので、この種の不具合の原因になり得るのは「開く直前に足したファイル
アクセス」の側である。

### 想定外の例外は「調べられる形」で返す（`backend/errors.py`）

`Internal Server Error` とだけ出る画面は、報告を受けても調べる取っかかりが
無い。実際に別端末から「起動すると Internal Server Error が出る」とだけ
報告が上がり、**`app.log` に何も残っていなかった**。

- **`app.logger` は `app_logger()` と同じロガー。** `Flask(__name__)` の
  name は `app` なので、`logging.getLogger('app')` を共有している。Flask は
  `app.logger` へ初めて触れたときハンドラが無ければ**既定の StreamHandler
  （標準エラー）を自分で付ける**。先を越されると、後から `app_logger()` を
  呼んでもファイル出力が足されず、通常起動（`Start.vbs`＝コンソール無し）
  では出力先が無いのと同じになる。`app.py` は Flask インスタンスを作る
  **前**に `app_logger()` を呼び、`get_logger()` は自分が付けたハンドラを
  目印で判定して、既存のハンドラがあっても足すようにしてある。
- 未処理の例外は `backend/errors.py` が受け、**必ず traceback を残した上で**
  画面には日本語（要求パス・例外の種類・ログの場所・WinError 別の対処）、
  API（`/api/…`）には JSON を返す。状態は 500 のまま — 成功に見せない。
- **起動直後に必ず通る経路を落とさない。** `GET /` と `/css/app.css` は
  静的ファイルの更新時刻を集めるが、アプリ本体が共有フォルダー上にあると
  この `stat()` もネットワーク越しの問い合わせになり、共有の一瞬の断で
  失敗し得る（上記 WinError 59 と同じ話が、DB ではなく静的ファイル側で
  起きる）。この値はキャッシュ破棄のためだけのものなので、取れなかった
  ファイルは飛ばして進み、**画面は必ず出す**（`_newest_mtime`）。
- 固定は `tests/test_error.py`。

### 一覧の密度と、右端に隠れる操作列

- **行の高さは `--row-h` / `--row-pad-y` の2つで決まる**（`00-base.css`）。
  仕掛一覧（`#grid`）と作業スケジュール（`.sc-row-line`）が同じトークンを
  見ているので、片方だけ詰めることはしない。28px / 4px で標準サイズ 22行、
  以前の 33px / 6px では 20行だった（実測）。**文字は変えない** — 読みやすさ
  ではなく余白で密度を稼ぐ。
- **一番右の列は `position:sticky; right:0` で貼り付ける。** 操作（開始・
  固定・帳票・削除）は右端にあるため、ウィンドウを狭めたり分割バーを
  動かすと真っ先に見えなくなり、横スクロールしないと押せなかった。列の
  並びを変えずに到達性だけを直せる。見出し側（`.sc-actions-head`）も同じ
  位置で止めないと、ラベルだけが流れていく。
- **状態を示すだけのバッジに、押せる部品の高さ（`--ctl-h-*`）を与えない。**
  区分（予定・作業中・完了）が `--ctl-h-xs`（26px）＋枠線＋丸みを持って
  いたため、行を薄くしても区分だけが厚いまま残り、1語の情報が行の高さを
  決めていた。面の淡い色と左端の色帯で足りる。
- 固定は `tests/test_density.js`（行ピッチの上限・下限、狭い幅での到達性、
  区分の高さ）。詰めすぎて文字が切れていないかは `tests/test_fit.js` が
  5段階で見るので、**この2本は対で走らせる**。

### 画面の重ね順は役割で決める（`--z-*`）

`z-index` にトークンが無く、各ファイルが個別に数値を書いていた。**同じ値
どうしは DOM の生成順で前後が決まる**ため、登録フィルタ一覧
（`.record-modal`＝1500）と確認ダイアログ（`#appConfirmModal`＝同じ1500）が
並ぶと、先に作られた側が下になった。確認ダイアログは初回の `confirmModal()`
呼び出しで生成されるので、**一度でも確認を出したあとは必ず下敷き**になり、
削除ボタンを押せなかった。

```
--z-overlay:1100   待ち表示
--z-modal:1500     通常のモーダル
--z-popover:1600   サジェスト・浮遊ウィンドウ
--z-settings:5000  設定モーダル
--z-confirm:5200   確認ダイアログ（常に一番上）
--z-toast:5300     通知
--z-boot:9000      起動オーバーレイ
--z-alert:9999     接続断の帯
```

- **画面いっぱいに出る「覆い」だけをここで扱う。** 表のヘッダーや図の点など、
  部品の内部で完結する重なりは局所的な話なので対象外（混ぜると、どちらの
  話をしているのか分からなくなる）。
- **確認ダイアログは何の上でも押せること。** 他のモーダルから呼ばれるのが
  普通なので、常に最前面に置く。

### 登録フィルタはモードで置き場を分ける

同じ仕掛一覧でも、スケジュールモードは品質データを結合して列構成が変わる。
条件を共有すると「その表に無い列の条件」が並ぶため、`フィルタプリセット
マスタ` の `対象モード` で置き場を分ける（`'schedule'` / `''`＝共通）。

- **3つに割らない。** 編集モードと閲覧モードは同じ一覧を同じ列構成で見るので、
  分ける理由が無い。増やすほど「どこで作ったか」を覚える必要が生まれる。
- 既定フィルタ・鍵・利用履歴・アクティブ条件のスコープキーにもモードを含める
  （`filters.js` の `presetMode()`）。
- **`masters` Blueprint は edit 限定なので、保存だけ 403 で弾かれていた。**
  一覧の絞り込みは「その端末のその画面の見え方」の設定で、測定データにも
  他マスタにも触れない。列表示マスタと同じ理由で `_ENDPOINT_EXTRA_MODES` から
  schedule へ開けてある。
- **マスタを読み直すとき、この端末だけの控えを消さないこと。** 以前は
  `loadMasterPresets()` がマスタの内容で丸ごと置き換えており、保存に失敗して
  ローカルへ退避した直後の再読込でそれごと消えていた。「登録したのに一覧に
  出ない」の正体はこれで、変数（`{使用設備}`）の有無は無関係だった。
- **登録名に今の値を焼き込まない。** `condLabel()` は
  「`{使用設備}`（=LS4）」のように現在値を併記するので、そのまま名前にすると
  設備を変えるたびに同じ条件が別名で増える。`presetName()` はトークンのまま。

### 作る操作は「今だけ」と「次回も」を分ける

条件ビルダーのボタンは **適用**（今の一覧へ追加）と **登録**（マスタへ保存）の
2つ。押しても入力を消さないので、片方を押したあともう片方も押せる。以前は
バーの「マスタへ保存」がアクティブな条件を全部まとめて個別登録する作りで、
用途を選べず、何が登録済みなのかも分からなかった。アクティブ条件のタグには
`☆`（未登録）/`★`（登録済み）を出し、その場で1件だけ登録できる。

### 分割ありの親ロットは子ロットをぶら下げて予定へ入る

分割あり（親子管理_子カード／コンマ5本分割_切断巾に値がある）のロットを
作業スケジュールへ入れると、**その時点で**子ロットの仕掛データも引いて
一緒に登録し、親にぶら下がるまとまりとして表示する（既定は畳んだ状態）。

```
予定  08/10 22:03〜00:03  [▾子ロット2] L9000 分割検証用 A5052 …   2.0h
   └ L90001   幅500 / 2条 / +0.5/-0.5
   └ L90002   幅480 / 1条 / +0.5/-0.5
```

- **時間を持つのは親だけ。** 親ロット1本をスリットするのは1回の作業なので、
  タイムラインの長さを決めるのは親の見積だけにする（`[見積分]` は0で固定し、
  `schedule_calc` の時刻展開ループは子でカーソルを進めない）。子に時間を
  持たせると、分割ありのロットだけ予定終了が子の数だけ後ろへ伸びる。
  子は親の `plannedStart`/`plannedEnd` を借りるので、日付・勤務でまとめる
  表示でも親と同じ束に入る。
- **`[親予定ID]` は共有DBの列。** 既に現場で動いている `作業予定` テーブルへ
  「無ければ `ALTER TABLE` で足す」方式で移行する。`plan_rows` は列名を
  明示して読むので、古い版が書いた行（この列がNULL）もそのまま読める。
  子は親と同じ `[表示順]` を持つため、同順のときは `[予定ID]` 順に並べる
  （親は必ず子より先に作られる。SQLite任せだと子が親の前に出ることがある）。
- **親と子は1回の書込サイクルで作る。** `plan_add(children=[...])`。1件ずつ
  別の書込にすると、共有DBのロック→取得→適用→反映を子の数だけ回すうえ、
  途中で失敗すると親だけが残る。
- **子ロットは投入時に固める。** あとから引き直さないのは、予定が「その時点の
  見え方のスナップショット」だから（`buildScheduleDetail` と同じ考え方）。
  子ロットは作業済みになると仕掛から外れるので、後で引くと消えている。
  引けなかった子も番号だけで載せ、`__childMissing` で赤く示す——黙って
  落とすと「9分割のはずが7件」という気づけない欠落になる。
  子ロットは親と先頭5桁を共有するので、**1回の問い合わせでまとめて**引く
  （9分割で9往復は、共有越しでは「+予定」を押してからの待ち時間になる）。
- **子行は `.sc-row-line` にしない。** 並べ替え（`commitDragOrder`/`moveCard`）は
  その class でDOMを走査するので、同じ class にすると並べ替えの対象に
  混ざり、サーバーが受け付ける「親だけ」の一覧と食い違って並べ替えが
  丸ごと通らなくなる。`plan_reorder` も子を対象から外し、親の新しい
  `[表示順]` へ子を揃え直すことでまとまりを保つ。親を消したら子も消す。
- **開閉のつまみは内容の欄（`.sc-row-title`）の中に置く。** 行はグリッドで
  列が決まっているため素の兄弟として足すと桁がずれ、印の欄（`.sc-row-flags`、
  幅固定＋`overflow:hidden`）へ入れると**切られて見えない**。最初これを
  踏んだ——幅は0ではないので「出ている」と誤判定しやすく、テスト側も
  「器からはみ出していないか」「その位置に本当にあるか」まで見る。

固定は `tests/test_scsplit.js`。フィクスチャの分割ありロット（親 L9000 と
子 L90001・L90002）は `tests/make_split_fixture.py` が作る。

### マスタ管理の汎用CRUDは4本セット（`/update` の書き忘れが3回起きた）

マスタ管理画面（`static/js/master-maint.js` の `submitMaint`）は、どのマスタでも
同じ約束でサーバーを呼ぶ。**編集のときだけURLが変わる**のがつまずきどころ。

```
一覧   GET  <endpoint>
新規   POST <endpoint>
編集   POST <endpoint>/update      ← ここだけURLが違う
削除   POST <endpoint>/delete
```

画面は `MASTER_DEFS` に1行足すだけで動くので、**サーバー側に `/update` を
書き忘れても画面は正常に見える**。壊れるのは「編集」を押したときだけで、
しかも 404 のHTMLがそのままトーストに出るため、利用者からは何が起きたのか
分からない。実際に3つのマスタで起きた。

| マスタ | 症状 |
|---|---|
| 設備停止 | `/update` が無く404 |
| 設備停止分類 | 改名の処理は登録側が `id` を見て既に持っていたのに、URLだけ無かった |
| データソース | `/update` が無く404。さらに `/delete` が `key` しか読まず、画面が送る `id` では消せなかった |

`tests/test_crudroutes.py` が `MASTER_DEFS` を読んで、汎用CRUDのマスタ
すべてについて4本が404/405でないことを確かめる。**マスタを増やしたときに
落ちる**ので、押して気づく前に分かる。

- **削除の引数は `id` に揃える。** 画面は必ず `{id: item.id}` を送る。自然キー
  （`key` など）でしか消せない実装は、画面から使えない。
- **自然キーで探す登録側は、キー自体の付け替えを表現できない。** キーを
  書き換えると「そのキーの行が無い」→新規登録になり、同じ設定の行が増える。
  ID指定の `/update` を別に用意するのがこの形の必然。

### 設備停止マスタの「対象設備」は1行で複数設備・全設備を指す

設備停止マスタの `[設備名]` は1設備のプルダウンだった。同じ停止内容
（「刃交換」等）は設備の数だけ登録し直す必要があり、**設備が1台増えるたびに
登録も増える**。1行が対象設備を持つ形に変えた。

```
'A'      … 設備Aだけ（従来の登録はすべてこの形。移行は不要）
'A,B,C'  … 列挙した設備
'*'      … すべての設備（これから増える設備にも自動で効く）
```

書式はアクセス権限マスタの `[現場段取り対象設備]`
（`master_repo.FIELD_REORDER_ALL`）と**同じ**にしてある。画面の入力欄も同じ
タグ入力（`equipment-multi-text`）を使う。列は増やさず TEXT 1列のままで、
**判定は `schedule_repo.stop_equipment_*` の5関数に集約**する。

| 関数 | 何を答えるか |
|---|---|
| `stop_equipment_list` | 保存文字列 → 設備名のリスト（`'*'` は `['*']`） |
| `stop_equipment_text` | 入力（文字列 or リスト）→ 保存用の1列。表記ゆれの重複を落とし、`'*'` が混ざれば全設備へ丸める |
| `stop_equipment_matches` | この停止内容は指定の設備で選べるか（`stop_reason_rows` / `plan_add` / 標準所要分の引き直しが使う） |
| `stop_equipment_named` | その設備を**名指し**しているか（`'*'` は数えない）。設備マスタ削除時の参照件数用 |
| `stop_equipment_label` | 人が読む形（`すべての設備` / `設備A / 設備B`） |

判定を1箇所に集めるのが要点で、散らすと「画面では対象なのにサーバーが弾く」
食い違いが出る。`stop_equipment_named` を分けているのは、設備を1台消したとき
**行き場を失う登録だけ**を数えたいため（全設備の行は1台消えても意味を失わない）。

- **同じ名称で対象設備が重なる登録は拒否する**。重なると、その設備には同じ
  停止内容が2つ並び、予定の標準所要分をどちらから引くのかも決まらない。
  `stop_reason_upsert` が登録の時点で 400 を返し、重なっている相手を文言で示す。
  標準所要分が設備ごとに違うときは、対象設備を分けて別々に登録する。
- **`POST /api/schedule/stop-reason-master/update` を新設**した。登録側は
  （対象設備, 名称）の自然キーで照合するので、**対象設備そのものを入れ替える
  操作が表現できない**（別行の新規登録になる）。ID を指定するこの経路だけが
  入れ替えられる。マスタ管理画面の編集は元からこの URL へ POST していたが
  ルート自体が無く 404 になっていたので、あわせて解消した。

### 参照データは「データソースマスタ」の1行で増やす

参照するデータは、すべて **RNEから抽出 → `.sqlite3` を作る → それを一覧として
読む** という同じ流れで作られる。以前この1本の流れは3箇所へ分かれていた。

| どこに書いてあったか | 何を決めていたか |
|---|---|
| `rne_scheduler.JOBS` | 何を抽出するか（RNEファイル・表名） |
| `JOBS[].output` | どこへ書くか |
| `db_access.DBS[].path` | どこを読むか |

増やすには両方を直す必要があり、しかも **抽出先と読込先を別々に書けた** ため
「抽出しているのに読まない」設定が作れた。いまは `データソースマスタ`
（`db/master.sqlite3`）の1行が1データソースで、**作る側と読む側が必ず同じ行に
並ぶ**。`DBS` も抽出ジョブもここから作られる。

- 定義は `backend/db_access.py`（`DATA_SOURCE_TABLE` / `data_source_rows()` /
  `seed_data_sources()`）。**パス設定マスタと同じ理由でここに自己完結させる**
  —— `master_repo.py` は `db_access` に依存する側なので、あちらへ置くと
  循環importになる。
- 抽出ジョブは `rne_scheduler.jobs()` がマスタから組み立てる。`JOBS` は
  読み込み時点のスナップショットで、**新しいコードは `jobs()` を使う**。
- 読む先の決め方（`_source_path()`）は
  ①パス設定マスタの個別上書き（`sikalotnow_path` 等）→ ②`sikalot_source`
  が `local` なら出力ファイル → ③共有パス、の順。相対パスは出力なら `db/`、
  共有なら仕掛の共有フォルダを基点にする（現場は「ファイル名だけ」を入れる
  ことが多く、絶対パスを強制すると打ち間違いが増える）。
- **接続先を決める設定なので、保存してもそのプロセスには反映されない**
  （`sikalotnow_path` 等と同じ。サーバー再起動で反映）。画面は保存値と
  「いま読んでいる場所」を並べて出し、そのずれが見えるようにする。
- 削除は無効化。既定の2件は初回に一度だけ種として入れ、目印
  （`__data_sources_seeded__`）を残すので、全部消してもよみがえらない。
- 編集画面は **抽出から表示までの流れと同じ順**に3つへ束ねる
  （① どのデータか → ② どこから作るか → ③ どこを読むか）。項目が9個
  平坦に並ぶと、どれとどれが関係するのかを毎回読み解くことになる
  （`fieldGroup`。`master-maint.js` の汎用エディタが見出しを挟む）。
- 一覧には **設定ではなく実態** も出す（RNEが置いてあるか／出力が作られて
  いるか／いまどこを読んでいるか）。値だけ眺めていてもずれには気づけない。
- RNE資材と `symnavim.conf` の置き場はパス設定マスタの `rne_assets_dir` /
  `rne_conf_path`。共有フォルダに1式だけ置いて全端末で共用できる。
  こちらは呼び出しのたびに読み直すので **再起動不要**。
- 固定は `tests/test_datasource.py`。

### 再読込は「読み直し方」を選ばせる（RNE抽出への入口）

仕掛・品質データは、共有にある元データを取り直すだけでなく、RNE
（Navigator 問い合わせ定義）から作り直すこともできる（上記「仕掛/品質データの
ローカル運用」）。以前は後者の入口がマスタ管理 > パス設定の中にしか無く、
一覧を見ている人からは辿り着けなかった。

- ヘッダーの「再読込」は、モードバッジ・表示サイズと**同じポップオーバー**を
  出す（`.access-mode-menu`。押す前に選択肢が見える形へ揃える）。
- 実行できない端末（RNE ファイルや `symnavim.conf` が未配置）では、
  **項目を隠さず無効化して理由を出す**。隠すと「あるはずの機能が無い」と
  探すことになる。
- 抽出は数十秒かかる。画面は覆わず（操作を止めない）、ヘッダー下の細い帯
  （`#rneProgress`）に進捗を出す。**終わったジョブ数で数える**ので割合が
  実態を表す —— `backend/rne_scheduler.py` の `_run_batch_inner()` が
  実行中でも `jobs[]` を更新し、`/api/rne-extract/status` がそれを返す。
  以前は全ジョブ完了時に一度差し替えるだけで、途中経過が出せなかった。
- 実行本体は `WL.rne`（`list-view.js`）が持つ。`status()` と
  `runWithProgress()` だけの薄い口で、ポーリングは1秒間隔・最後に必ず
  もう一度読み直して締める（取りこぼすと「終わったのに動いたまま」に見える）。

### 権限の判定条件は画面とサーバーで必ず揃える

画面が「できます」と見せているのにサーバーが弾く、という食い違いは
**操作した瞬間にエラーで返ってくる**ので、利用者からは不具合にしか見えない。

- 書込ボタン・ドラッグ可否を出す条件は、**サーバー側のガードと同じ式**にする。
  条件を片方だけ足したり緩めたりしない
  （`docs/SCHEDULE_MODE_DESIGN.md` §9.44 が実際に踏んだ）。
- 権限が足りずに無効化するときは、**黙って消さずに理由を出す**。マスタで
  直せる内容なら、どのマスタの何を設定すればよいかまで書く。
- 空欄の意味を勝手に広げない。「対象設備が空欄」は *未設定* であって
  *全設備許可* ではない。緩める判断はサーバー側の仕様変更としてやる。

### 共有ファイルへの書き込みは「回数」が効く

共有スケジュールDBへの書き込みは1回ごとに
「ロック取得 → 検証待ち → スナップショット取得 → 適用 → 改訂番号確認 → 反映 →
ロック解放」というサイクルを丸ごと踏む（`docs/SCHEDULE_MODE_DESIGN.md` §4.2）。
**1件あたりの固定費が大きい**（実測 約1.5秒。うち大半はロック検証の待ち時間で、
ネットワークI/Oではなくアプリが意図的に入れている待ち）。

- **連続する操作は1サイクルへまとめる。** 1件ずつ書くと固定費が件数ぶん
  積み上がる（20件で30秒 → まとめて3.7秒、§9.45）。書き込み系を新しく足す
  ときは、キューへ「操作の記述」として積めるか（＝まとめられるか）を先に考える。
- **まとめても可否判定は1件ずつ、個別エンドポイントと同じ関数を通す。**
  まとめたことで判定が緩むと権限の抜け道になる。
- **まとめ用エンドポイントを別モードへ開かない。** 複数種類の操作を運べる
  ため、モードごとの制限（「この端末は並べ替えだけ」等）を迂回できてしまう。
- 待ち時間そのものが目的の処理（結果整合ストレージ向けの検証待ち）は、
  **その間に読み取り専用の作業を挟んで重ねる**。検証を通るまで書き込まない
  限り、保証は変わらない。

### 失敗した書き込みの再試行と通知

書込キュー（`schedule-view.js` の `queueScheduleWrite`）は失敗を数回まで
再試行する。ここで守ること:

- **4xx は再試行しない。** 権限不足・入力不正は何度やっても同じ結果で、
  再試行するぶんだけ同じ通知が並ぶ。再試行に意味があるのは 423（ロック待ち）・
  409（改訂衝突）・5xx・通信エラーだけ。
- **通知は諦めたときに1回だけ。** 再試行される `run` の中で `showToast` を
  呼ばない（回数ぶん出る）。`onFailure` で出し、まとめ通知の対象からは外す。
- **`onFailure` を必ず渡す。** 楽観的更新（§9.11）で画面を先に書き換える以上、
  サーバーに拒否されたら元へ戻さないと、実際には存在しない状態を見せ続ける。
- `api()`（base.js）は `err.status` に HTTP ステータスを載せる。呼び出し側が
  4xx と 5xx を区別できるのはこれのおかげなので、外さないこと。

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
- **回帰テスト**: `tests/` に常設（実行は `tests/run_all.sh` のみ）。
  接続先が全てSQLiteになったため、仕掛/品質データ(`/api/table` 等)もマスタ
  (`/api/operator-master` 等)も**モック無しで実際にサーバー経由で検証できる**
  （ランナーが `db/test_fixture/` の `.sqlite3` を指す）。以前は仕掛/品質が
  Access接続で、ドライバの無い環境では `page.route` でモックする必要があった。
- **リリース**: 意味のある変更ごとに `backend/changelog_data.py` の
  `APP_VERSION` を上げ、`CHANGELOG` 先頭にエントリを追記する（アプリ内の
  更新履歴表示がこれを直接参照する）。
