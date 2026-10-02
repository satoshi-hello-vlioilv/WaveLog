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

Windows環境では **`Start.vbs`（またはデスクトップのショートカット）をダブルクリック**します。
アプリの窓（デスクトップ版・`program/WaveLog.exe`）が開きます。exe はこの PC の
`%LOCALAPPDATA%\WaveLog\desktop\` へ写してから動くので、共有フォルダの exe を掴みません（更新が詰まらない）。
画面のポートを開かず、窓を閉じるとアプリも片付けてから終わります（§9.544〜§9.548）。
**ブラウザ版の起動の道は§9.548で外しました**（起動するのは exe だけ）。

| ファイル | 用途 |
|---|---|
| `Start.vbs` | **毎日の入口**。exe を手元へ写して起動します。起動できないときは理由と次にすることを出します |
| `program/update.bat` | **アプリを新しくしたあとの1回**。導入したときも1回だけ実行します（次回からの起動が速くなります）。押さなくても起動はします |
| `program/WaveLog.exe` | デスクトップ版の本体。**main へ取り込まれると CI が自動で作って置きます**（自己診断を通った物だけ）。main の ZIP を落として上書きすれば一緒に届きます |

`program/update.bat` は Python・必要な部品の確認と、**バイトコードの事前用意**を
この端末の中で行い、済んだ印を残します。毎日の起動はその印を見て確認を
飛ばすので速くなります。**実行を忘れても起動はします**——そのときだけ確認を
やり直すので少し遅くなるだけです。アプリを共有フォルダーに置いている場合でも、
印・バイトコード・作業用のファイルは**その端末の中**（`%LOCALAPPDATA%\WaveLog`）に置かれます。
設計は `docs/DESKTOP_MIGRATION_DESIGN.md`。

開発と網（テスト）のために、同じアプリを HTTP でも立てられます（利用者の起動の道ではありません）。

```
pip install flask
python program/app.py         # 開発と網の入口（127.0.0.1:5029）。止めるのは POST /api/shutdown
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
一切使われず、従来どおりの場所を使います。ここに書けるのはこの3つと
`master_share_mode` の4つだけです（マスタDB自身の置き場を決める設定なので
マスタの中には置けません。他の設定はすべてマスタ管理の画面から直せます）。

**この4つはどれも「この端末のファイルをどこに置くか」**です。`db_dir` は
2つのDBファイルを置くフォルダで、**作業用のコピー置き場ではありません**
（写し・作業コピーの置き場はアプリが自動で決めます）。`records_db_path` は
**この端末の `records.sqlite3` 1ファイル**を指すもので、みんなで見る測定
データの大元ではありません（そちらは共通設定 > 段「置き場」）。
優先順位・意味・よくある取り違えは `docs/SHARE_MIGRATION.md` に表でまとめて
あります。パスには `%LOCALAPPDATA%` のような環境変数も使えます。

### 共有フォルダーへ移す場合

測定データ・作業予定・マスタの3つを社内共有へ置く手順は
`docs/SHARE_MIGRATION.md` にまとめてあります（それぞれ直す場所も効く
タイミングも違うため）。移したあとの状態は画面でも確認できます
（マスタ管理 > 共通設定 > 段「共有の置き場」）。

## ディレクトリ構成

```
Start.vbs                  毎日の入口(デスクトップ版の exe を手元へ写して起動)。**入口はこれ1つ**
program/                   実行するものと、その道具だけを置く
  update.bat                 アプリを新しくしたあとに1回(導入時も1回。次回からの起動が速くなる)
  setup_app.py               update.batの中身(確認・部品導入・バイトコードの事前用意・刻印)
  sidecar.py                 デスクトップ版の窓口(標準入出力・ポートを開かない)
  WaveLog.exe                デスクトップ版の本体(main へは CI が置く)。WaveLog.build.json が作った元
  app.py                     Flask本体。直接実行すると開発と網の HTTP の入口
  requirements.txt           必要パッケージ
  requirements-dev.txt       開発用の道具(pyflakes等。現場の端末には要らない)
  _pycache_bootstrap.py      .pycキャッシュをローカル領域へ逃がす(3本のいちばん最初のimport)
  _approot.py                その次に通す1行(リポジトリ直下をsys.pathへ足す)
desktop/                   デスクトップ版の窓(Rust・Tauri)。cargo build で WaveLog.exe を作る(§9.546)
.gitignore                 直下から動かせない(gitはそのフォルダ以下にしか当てない)
eslint.config.mjs          直下から動かせない(program/へ移すと規則が1件も当たらない)
backend/launcher/server.py 開発と網（テスト）の HTTP の入口（利用者の起動の道ではない・§9.548）
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
  measure-view.js      測定画面の構成・各パネル描画・入力検証・作業時間
  measure-input.js     測定器受信・入力位置管理・測定グリッド・公差計算
  records-store.js         端末内保存(IndexedDB)・保存/完了遷移・データ一覧・設備設定
  measure-tolerance.js 公差判定の拡張・寸法ロック
  lot-split.js             条割(ロット分割): 検出・条割変更モーダル・条ごと公差・屑幅
  filters.js               一覧の絞り込み・フィルタプリセット・スウォーム表示
  measure-worklog.js   指示値表示・作業時間UI・作業時間の過去実績比較
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
