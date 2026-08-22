# WaveLog 測定伝送システム

板金・コイル加工ラインの測定器（マイクロメータ・ノギス等）から送られてくる
測定データを受信し、SQLite（.sqlite3）の仕掛データと突き合わせながら
記録・帳票化するための、Flask製の社内向けWebアプリです。仕掛・品質データは
工場側の別システムが所有するデータベースを読み取り専用で参照し、本アプリ
自身が読み書きするマスタ・測定データバックアップはSQLite（.sqlite3）に
保存します。

## 主な機能

- **測定データの自動受信**: 測定器からのキーボードエミュレーション入力を
  受信欄で捕捉し、板厚/板幅・バリなど自動転送専用の測定種を判別して
  該当セルへ自動入力します。
- **測定ワークスペース**: 母材・板厚/板幅・ラテラルボー・バリ・
  テレスコープ・巻ずれ・フラットネス・揃い/肉厚/長さの各測定種に対応した
  入力画面と、公差判定の可視化（数直線・スウォームプロット）。
- **ローカル保存と再開**: 入力中のデータは端末のIndexedDBへ自動保存され、
  編集中データ一覧・完了データ一覧からいつでも続きから再開できます。
- **ロット問い合わせ**: 仕掛一覧・品質データ・編集中/完了データ一覧の
  ロット番号から、LotDsp（社内システム）の該当ロットを直接開けます。
- **測定帳票**: 編集中/完了データ一覧の各行から、そのロットのA4帳票
  プレビューを開き、印刷・PDF保存ができます。
- **品質データ分析・生産管理ダッシュボード**: 仕掛データを集計した
  グラフ表示、KPIダッシュボード。
- **更新履歴の表示**: 画面のバージョンバッジ（例: `VER1.9.2`）をクリックすると、
  アプリ内でこれまでの更新内容を一覧表示できます。

## 動作環境

- Windows（起動スクリプト・RNE抽出がWindows前提のため。Accessドライバーは不要）
- Python 3.9 以降
- 必要パッケージ: `flask`（`sqlite3` は標準ライブラリのため追加インストール不要）
- 参照する仕掛データ（`SIKALOTNOW.sqlite3` / `SIKALOTDEF.sqlite3`）は、工場側の
  別システムが所有・書込する社内ネットワーク共有（`backend/db_access.py` の
  `SIKA_DIR`）を読み取り専用で参照します。ローカルのマスタ（`db/master.sqlite3`）・
  測定データバックアップ（`db/records.sqlite3`）は本アプリ自身が読み書きする
  ローカルストアで、`db/` フォルダ配下に自動生成されます（無ければ初回書き込み
  時に自動作成、事前準備は不要）。

## 起動方法

Windows環境では **`Start.vbs` をダブルクリック**します（通常起動）。
黒いコンソール画面は出ず、ブラウザに起動待機画面が表示され、サーバーの
準備ができ次第そのままアプリ画面へ切り替わります。必要パッケージが未導入の
場合は自動でインストールを試みます。

| ファイル | 用途 |
|---|---|
| `setup.bat` | **起動前の確認**。導入時と、アプリを更新したあとに1回だけ実行します（次回からの起動が速くなります） |
| `Start.vbs` | **通常起動**。コンソールを表示せず起動します |
| `start_app.bat` | **診断起動**。起動しない原因を調べたいときに使います（コンソールにエラーがそのまま出ます） |
| `stop.bat` | **明示停止**。このアプリだけを安全に停止します |

`setup.bat` は Python・必要な部品の確認と、**バイトコードの事前用意**を
この端末の中で行い、済んだ印を残します。毎日の起動はその印を見て確認を
飛ばすので速くなります（実測 1.18秒 → 0.23秒）。**実行を忘れても起動は
します**——そのときだけ確認をやり直すので少し遅くなるだけです。
アプリを共有フォルダーに置いている場合でも、印・バイトコード・作業用の
ファイルは**その端末の中**（`%LOCALAPPDATA%\WaveLog`）に置かれます。

ブラウザのタブを閉じると、しばらく後にバックエンドも自動的に終了します
（閉じ忘れによるプロセスの残存を防ぐため）。すぐ止めたい場合は `stop.bat`
を使ってください。

開発時は次でも起動できます。

```
pip install flask
python start_app.py       # 通常の起動経路(推奨)
python app.py             # 同じ経路へ委譲されます
```

### ログの場所

起動できない・途中で止まるといった場合は、次のログを確認してください。

```
%LOCALAPPDATA%\WaveLog\logs\launcher.log   起動・停止の記録(Python環境・多重起動判定・終了理由)
%LOCALAPPDATA%\WaveLog\logs\app.log        アプリ本体の記録
```

ログ・キャッシュ・実行時ファイルはアプリ本体のフォルダではなくユーザー別の
ローカル領域へ出力されます。アプリ本体を共有フォルダーへ置いた場合でも、
端末ごとの実行状態が衝突せず、共有側を汚さないようにするためです
（Pythonの`.pyc`キャッシュも同様にローカル領域へ出力します）。

### DBファイルの置き場所を変更したい場合

既定では `db/master.sqlite3`・`db/records.sqlite3` を使います。配置場所を
変えたい場合は `config/local.example.json` を `config/local.json` として
コピーし、`db_dir`（両方まとめて）または `master_db_path`/`records_db_path`
（個別に）を指定してください。`config/local.json` が無ければこの設定は
一切使われず、従来どおりの場所を使います。

## ディレクトリ構成

```
setup.bat                  起動前の確認(導入時・更新後に1回。次回からの起動が速くなる)
Start.vbs                  通常起動(コンソール非表示)
start_app.bat              診断起動(コンソール表示)
stop.bat                   明示停止
setup_app.py               setup.batの中身(確認・部品導入・バイトコードの事前用意・刻印)
start_app.py               Python側の起動開始点(刻印を見て確認を飛ばす→多重起動判定→サーバー起動)
process_manager.py         対象アプリだけを安全に停止する
_pycache_bootstrap.py      .pycキャッシュをローカル領域へ逃がす(各エントリポイントの最初のimport)
backend/launcher/guard.py  多重起動の防止・起動中インスタンスの記録(旧launch_guard.py)
backend/launcher/server.py Webサーバーの起動のみ(起動監視とWeb処理の境界。旧server.py)
loading.html               起動待機画面(サーバーより先に開かれる)
app.py                     Flask本体・一覧/測定コンテキスト/バックアップ/品質分析API
requirements.txt           必要パッケージ
config/
  local.example.json         DBパス上書き設定の雛形(コピーしてlocal.jsonに)
backend/                   Flask本体以外のバックエンドロジック(Pythonパッケージ)
  config.py                  アプリID・表示名・ポート等のアプリ固有値(集約先)
  paths.py                   ローカル領域(%LOCALAPPDATA%)の解決・共有配置の検出・config/local.jsonの読込
  logging_setup.py           ログ初期化(launcher / app の2系統)
  watchdog.py                プロセスの生存管理(ハートビート監視・明示停止)
  changelog_data.py          バージョン番号(APP_VERSION)と更新履歴(CHANGELOG)
  db_access.py                SQLite接続・DB定義・共通ヘルパ
  masters.py                   各種マスタCRUD API(Blueprint、db/master.sqlite3)
db/                         ローカルDBの既定の置き場所(config/local.jsonで変更可)
  master.sqlite3               本アプリが読み書きするマスタ(無ければ初回書き込み時に自動生成)
  records.sqlite3              測定データバックアップ(無ければ初回書き込み時に自動生成)
templates/index.html       画面の骨格（SPA）
static/css/*.css           全画面共通スタイル(読み込み順で16分割。docs/ARCHITECTURE.md参照)
static/js/                 (index.htmlの記載順に読み込み)
  base.js                  共有基盤: グローバル状態S・api・共通ユーティリティ・別名定義
  list-view.js             起動処理・DB/テーブル選択・一覧グリッド
  measurement-view.js      測定画面の構成・各パネル描画・入力検証・作業時間
  measurement-input.js     測定器受信・入力位置管理・測定グリッド・公差計算
  records-store.js         端末内保存(IndexedDB)・保存/完了遷移・データ一覧・設備設定
  measurement-tolerance.js 公差判定の拡張・寸法ロック
  lot-split.js             条割(ロット分割): 検出・条割変更モーダル・条ごと公差・屑幅
  filters.js               一覧の絞り込み・フィルタプリセット・スウォーム表示
  measurement-worklog.js   指示値表示・作業時間UI・作業時間の過去実績比較
  master-maint.js          マスタ管理画面・列表示マスタ・データ引継ぎ・パス設定
  quality-analysis.js      品質データ分析グラフ
  report-dashboard.js      測定帳票・生産管理ダッシュボード
  calendar-view.js         実績カレンダー
```

各関数はいずれか1ファイルが所有し、拡張が必要な場合のみ後続ファイルが
`const base=fn; fn=function(){...base()...}` 形式でラップします（規約の詳細と
ファイル間の依存関係は `docs/ARCHITECTURE.md` を参照）。

## バージョンと更新履歴

`backend/changelog_data.py` の `APP_VERSION` が画面右上・測定画面ヘッダーの
バージョンバッジに表示されます。意味のある変更をコミットするたびに更新し、
`CHANGELOG`（同ファイル）の先頭に更新内容を追記してください。バッジをクリック
すると `CHANGELOG` の内容がアプリ内モーダルに一覧表示されます（`/api/changelog`）。
