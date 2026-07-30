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
| `backend/routes/masters.py` | 各種マスタCRUDのBlueprint（設備/オペレータ/スプール/内径/機器/フィルタプリセット/列表示）。URLは分離前と同一。リクエスト受付とレスポンス整形のみを行い、データアクセスは`repositories/master_repo.py`へ委譲 |
| `backend/repositories/master_repo.py` | 各種マスタのデータアクセス層。テーブル定義(`ensure_*_table`)・正規化(`normalize_*_name`)・読み取り(`*_master_rows`/`read_*_names`)・書き込み補助(`set_operator_equipment`/`set_hidden_columns`)。Flaskに依存しない |
| `backend/changelog_data.py` | `APP_VERSION` と `CHANGELOG`（データのみ。リリースごとにここを更新） |
| `backend/db_access.py` | `DBS`(接続先定義)・`APP_ROOT`/`DB_DIR`(パス基準)・`connect`/`cols`/`tables`/`qi`(Access/SQLite両対応)・監査列・バックアップテーブル整備 |

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
| 管理 | マスタ一覧・マスタ管理 | `list-view.js`（`role==='master'`）→ **`#adminNav`** |

- DB一覧の置き場所は `/api/catalog` の **`role`** で決まる。DBを増やすときは
  `db_access.py` の `DBS` に `role` を付ければ自動で正しいグループに入る。
- **表示名の正はカタログ（`DBS[...]['label']`）**。`index.html` の静的ラベルは
  カタログ取得までの繋ぎなので、**両者を一致させておく**こと（以前は静的側が
  「仕掛一覧」、実表示が「仕掛（現在）」でコードを読むと混乱した）。

### 画面の開き方・閉じ方の約束

| 種類 | 例 | 閉じ方 |
|---|---|---|
| トップレベル（サイドバーの行き先） | データ一覧・仕掛・品質データ・マスタ一覧・ダッシュボード・実績カレンダー | **閉じるボタンを持たない**。サイドバーで切り替える |
| ロットに紐づく下位画面 | 測定画面 | `×` |
| 同上（戻り先がある） | 帳票 | `戻る`（起点により行き先が変わる） |

現在地は **`setActiveNav(key)`（`base.js`）** が一元管理する。`key` はボタンの
`id` か `data-db-key`。**新しいトップレベル画面を足したらここを呼ぶこと**
（呼ばないと選択状態が残ったままになる）。`.active` の見た目は
`nav-item--view` / `--admin` / `--primary` のどれでも同じになるよう揃えてある。

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
