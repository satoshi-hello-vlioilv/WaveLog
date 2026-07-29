# WaveLog アーキテクチャ

このドキュメントは、コードを読む・変更する人向けの構成説明です。
機能一覧や起動方法は `README.md` を参照してください。

## 全体像

- **バックエンド**: Flask (`app.py`)。仕掛(`SIKALOTNOW.accdb`)・品質データ
  (`SIKALOTDEF.accdb`)は工場側の別システムが所有する読み取り専用のAccess
  ファイル(ネットワーク共有)を pyodbc で参照。マスタ・測定データバックアップは
  本アプリ自身が読み書きするローカルの SQLite(`sqlite3`標準ライブラリ)で、
  `db/` フォルダ配下に置く。ビルド工程なし。
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
| `launch_guard.py` | ポートの使用状況と `app_id` の照合による多重起動判定、起動中インスタンスの記録 |
| `server.py` | Webサーバーの起動のみ。起動監視とWeb処理の境界 |
| `process_manager.py` | 対象アプリだけの安全な停止（正常終了要求→記録済みPID。プロセス名では判定しない） |
| `loading.html` | 起動待機画面。サーバーより先に `file://` で開かれ、`/api/ready.js` の応答を待ってからアプリへ遷移する |
| `_pycache_bootstrap.py` | `.pyc` キャッシュをローカル領域へ逃がす。`sys.pycache_prefix` は最初のimportより前に設定する必要があるため、各エントリポイントの一番最初のimportにする |
| `config/local.example.json` | DBパス上書き設定の雛形。コピーして `config/local.json` にすると有効化される(未配置なら既定の`db/`のまま) |
| `backend/config.py` | アプリID・表示名・ポート・監視しきい値などアプリ固有値の集約先 |
| `backend/paths.py` | `%LOCALAPPDATA%` 配下の解決、共有フォルダー配置の検出、`config/local.json` の読込(`load_local_config`/`configured_path`) |
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
| `backend/masters.py` | 各種マスタCRUDのBlueprint（設備/オペレータ/スプール/内径/機器/フィルタプリセット/列表示）。URLは分離前と同一 |
| `backend/changelog_data.py` | `APP_VERSION` と `CHANGELOG`（データのみ。リリースごとにここを更新） |
| `backend/db_access.py` | `DBS`(接続先定義)・`APP_ROOT`/`DB_DIR`(パス基準)・`connect`/`cols`/`tables`/`qi`(Access/SQLite両対応)・監査列・バックアップテーブル整備 |

依存方向は `start_app.py → server.py → app.py → backend.routes.* →
backend.masters/backend.db_access`（逆参照なし）。`backend.config` は他へ
依存せず、`backend.paths`/`logging_setup`/`watchdog` がこれを参照する。
`backend.changelog_data` は独立。`app.py`・`backend.routes.*` からは絶対
import(`from backend.xxx import ...`)、`backend` 内のモジュール同士は
相対import(`from .db_access import ...`、`backend.routes.*` からは
`from ..db_access import ...`)で参照する。

> **`backend/` を `app/` へリネームしない**: Pythonは同名のパッケージを
> モジュールより優先するため、`app/` パッケージを作ると `app.py` が
> importできなくなる(直接実行`python app.py`は可能でも、他モジュールから
> の`import app`は`app/`パッケージに解決されてしまう)。この衝突を解消する
> 唯一の方法はFlaskインスタンス生成ファイルの名前自体を変えることだが、
> それは配布・ドキュメント上の実利が薄いため見送り、`backend/`という
> 名前を恒久的に採用している。routes/masters(将来的にはrepositories)と
> いう内部構成の分離自体は、パッケージ名を`app`にせずとも達成できる。

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
| `records-store.js` | IndexedDB/ミラー永続化・`saveLocal`/`persistAndTransition`・`openMeasurement`・`openRecords`/`renderRecordListRows`・`loadMeasurementContext`・使用設備設定/設備マスタ・アプリ起動呼び出し（末尾） |

**各関数の定義はコア内で1箇所のみ**（旧 core.js にあった同名関数の多層
再定義・到達不能な旧実装は 2026-07 のリファクタリングで撤去済み）。

### 2. 機能拡張ファイル（コアの後に読み込み）

`measurement-tolerance.js` → `lot-split.js` → `filters.js` →
`measurement-worklog.js` → `worktime-benchmark.js` → `quality-analysis.js` →
`report-dashboard.js` → `calendar-view.js`

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
