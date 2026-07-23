# WaveLog 測定伝送システム

板金・コイル加工ラインの測定器（マイクロメータ・ノギス等）から送られてくる
測定データを受信し、Microsoft Access（.accdb）の仕掛データと突き合わせながら
記録・帳票化するための、Flask製の社内向けWebアプリです。

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
- **品質データ分析・生産管理ダッシュボード**: Accessの仕掛データを集計した
  グラフ表示、KPIダッシュボード。
- **更新履歴の表示**: 画面のバージョンバッジ（例: `VER1.9.2`）をクリックすると、
  アプリ内でこれまでの更新内容を一覧表示できます。

## 動作環境

- Windows（Microsoft Access ODBC ドライバーが必要なため）
- Python 3.9 以降
- 必要パッケージ: `flask`, `pyodbc`
- 参照する仕掛データ（`SIKALOTNOW.accdb` / `SIKALOTDEF.accdb`）は社内ネットワーク
  共有（`app.py` の `SIKA_DIR`）を参照します。ローカルの `マスタ.accdb` /
  `測定データ.accdb` はリポジトリ直下に配置します。

## 起動方法

```
pip install flask pyodbc
python app.py
```

起動後、ブラウザで `http://127.0.0.1:5029/` を開きます。Windows環境では
`start_app.bat` をダブルクリックすることでも起動できます（必要パッケージが
未導入の場合は自動でインストールを試みます）。

## ディレクトリ構成

```
app.py                     Flask本体・一覧/測定コンテキスト/バックアップ/品質分析API
changelog_data.py          バージョン番号(APP_VERSION)と更新履歴(CHANGELOG)
db_access.py               Access(ODBC)接続・DB定義・共通ヘルパ
masters.py                 各種マスタCRUD API(Blueprint)
templates/index.html       画面の骨格（SPA）
static/app.css             全画面共通スタイル
static/js/                 (index.htmlの記載順に読み込み)
  base.js                  共有基盤: グローバル状態S・api・共通ユーティリティ・別名定義
  list-view.js             起動処理・DB/テーブル選択・一覧グリッド
  measurement-view.js      測定画面の構成・各パネル描画・入力検証・作業時間
  measurement-input.js     測定器受信・入力位置管理・測定グリッド・公差計算
  records-store.js         端末内保存(IndexedDB)・保存/完了遷移・データ一覧・設備設定
  measurement-tolerance.js 公差判定の拡張・寸法ロック
  lot-split.js             条割(ロット分割): 検出・条割変更モーダル・条ごと公差・屑幅
  filters.js               一覧の絞り込み・フィルタプリセット・スウォーム表示
  measurement-worklog.js   マスタ管理モーダル・列表示マスタ・データ引継ぎ
  worktime-benchmark.js    作業時間の過去実績比較
  quality-analysis.js      品質データ分析グラフ
  report-dashboard.js      測定帳票・生産管理ダッシュボード
  calendar-view.js         実績カレンダー
```

各関数はいずれか1ファイルが所有し、拡張が必要な場合のみ後続ファイルが
`const base=fn; fn=function(){...base()...}` 形式でラップします（規約の詳細と
ファイル間の依存関係は `docs/ARCHITECTURE.md` を参照）。

## バージョンと更新履歴

`changelog_data.py` の `APP_VERSION` が画面右上・測定画面ヘッダーのバージョン
バッジに表示されます。意味のある変更をコミットするたびに更新し、`CHANGELOG`
（同ファイル）の先頭に更新内容を追記してください。バッジをクリックすると
`CHANGELOG` の内容がアプリ内モーダルに一覧表示されます（`/api/changelog`）。
