# §を持たない決まり

CLAUDE.md の規則のうち、決定記録（§9.x）に対応する節を持たないもの。
古くからある約束（フォルダ構成・モード・接続先・起動基盤など）が多い。

## 守ること（`CLAUDE.md` から移した規則の本文）

CLAUDE.md には見出しの1行だけを残してある。ここが本文。

- **サーバー再起動**: `program/app.py`/`templates`/`static` を変更したら、開発と網の入口を
  `curl -X POST http://127.0.0.1:5029/api/shutdown`（片付けを通る）で止めて`python3 -u program/app.py`で
  起こし直してから確認する（自動リロード無効。再起動忘れは過去に誤診断の原因になった）。
  網のランナー（`tests/run_all.sh`の`restart_server`）も同じ手順。
  `pkill`でPythonをプロセス名だけで一括終了しないこと（他のPythonを巻き添えにする。
  名前で止めるのは`program/app.py`に絞った最後の手段だけ）。
  利用者の起動はデスクトップ版だけ（Start.vbs → `program/WaveLog.exe` → `program/sidecar.py`・§9.548）。
- **起動基盤に触るとき**: 起動・停止の処理は `program/sidecar.py`（デスクトップ版の窓口）/
  `backend/launcher/services.py`（背景処理）/ `backend/launcher/server.py`（開発と網の入口）/
  `backend/watchdog.py`（片付けて終わる）と、窓の`desktop/`（Rust）が所有する。業務APIをこれらへ足さない（逆に`program/app.py`へ起動制御を戻さない）。
  ブラウザ版の起動の道（`start_app.py`・`guard.py`・`process_manager.py`）は§9.548で外した。
  ポート・アプリID・表示名などのアプリ固有値は `backend/config.py` に集約
  してあるので、他ファイルへ直接書かない。`backend/launcher/server.py`の`flask_app.run(...)`から
  **`threaded=True`を外さないこと**（既定のシングルスレッドに戻すと、仕掛/
  品質データ等ネットワーク共有I/Oが不調で1件のリクエストが長時間ブロックした
  だけで、ハートビート・停止の口まで一切応答できなくなる不具合が実際に発生した）。
  設計の背景と今後の再編計画は `docs/REBUILD_PLAN.md` を参照。
- **起動オーバーレイ（`#appBoot`）**: 画面が組み上がるまで本体を見せない
  仕掛け。`<html class="app-booting">`の間`static/css/95-boot.css`が
  `body>*:not(#appBoot){visibility:hidden}`で伏せ、`base.js`の`WL.boot`が
  ブラウザ側4段階（`assets`/`permission`/`list`/`layout`）の完了で解除する。
  **`display:none`にしないこと**（寸法を測って組み立てている箇所が壊れる）。
  **解除は必ず起きること**が最優先で、段階が終わらなくても8秒で外す
  （画面が出ないまま固まるのは、崩れて見えるより悪い。`base.js`自体が
  読めなかった場合の保険が`index.html`に12秒で入っている）。
  **アプリのJSは`index.html`の起動ローダーが後から読み込む**（覆いを先に
  描かせるため。`</body>`直前に`<script>`を並べるとパーサーがそこで止まり、
  全部の実行が終わるまで1度も描画されず、引き渡し直後に白い画面が出る）。
  そのため**`DOMContentLoaded`を直接待たないこと**——JSが動く時点では
  既に終わっている。`WL.onReady()`を使う（済んでいればすぐ呼ぶ）。
  CSSも2本立てで、描画をブロックするのは`/css/boot.css`
  （`BOOT_CSS_FILES`=`00-base.css`+`95-boot.css`）だけ。ここへ画面のCSSを
  足すと白い時間が戻るので増やさない。詳細は`docs/ARCHITECTURE.md`。
  **新しく
  「起動時に必ず終わらせたい処理」を足すときだけ`WL.boot.step()`を増やす**
  ——増やすと`boot_status.py`の`BROWSER_STEPS`・`index.html`・base.js の分母も
  合わせる必要がある（`tests/test_boot.py`が一致を、`tests/test_bootui.js`が
  「解除後に組み替えが起きないこと」を固定）。デスクトップ版の起動画面（`desktop/splash`）は
  exe に入るので外部ファイルを参照できず、トークンと地を写してある。**片方だけ直すと
  引き継ぎで見た目が飛ぶ**ので両方直す（以前は待機画面 loading.html が同じ立場だった・§9.548で外した）。
- **バージョン更新**: 意味のある変更をコミットするたびに
  `backend/changelog_data.py` の `APP_VERSION` を上げ、`CHANGELOG` 先頭へ
  エントリを追記する（新しい順）。
- **`window.*`への新規公開は名前空間経由**: 既存の約70件は動いている契約
  なのでそのまま（触らない）。**新しく公開するものは`window.WL.*`か機能別の
  名前空間（`scCore`等）に入れる**こと。素の`window.X`を増やすと、
  ファイル間の暗黙の契約が増えて読み込み順への依存が見えなくなる。
  **呼び出し側も`WL.enterView(...)`のように名前空間付きで書く**（どのファイルの
  機能に依存しているかが呼び出し箇所で分かるのが目的なので、定義がグローバル
  関数宣言でも素の名前では呼ばない）。現在`WL`にあるのは
  `registerView`/`enterView`/`withInternalDbSwitch`/`isInternalDbSwitch`/`ttlCache`/
  `refreshScheduleIfOpen`/`expandFilterVars`/`toleranceScaleView`/`optionList`/`defect`/
  `fieldReorderAllows`/`fieldReorderAllowsAll`/`fieldReorderLabel`/`boot`/`onReady`/
  `dataSource`/`columnLayout`/`cellFormat`/`displayRules`/`listColumns`/`listRules`/
  `rowGap`/`listSort`/`listSortBar`/`listQuery`/`listHooks`/`renderDbNav`/`columnResize`/
  `bindColumnHeaderTools`/`makeFloatingWindow`/`loadBreakdown`/`equipment`。
  **見張りは`tests/test_globallint.py`**——`window.*`は現在値63件を上限に
  固定し、増えたら落ちる（`WL.*`は数えない。増えてよい側なので上限をかけると
  方針と逆向きの圧力になる）。**新しく足したJSファイルは素のグローバル関数を
  作らない**ことも見る（既存19本は対象外＝触らない方針）。
  **公開漏れは黙って素通しになる**ことに注意——`typeof makeFloatingWindow==='function'`の
  ように「あれば使う」書き方で呼んでいると、公開し忘れても例外が出ず、
  機能だけが静かに欠ける（列の設定パネルが位置も大きさも与えられないまま
  画面外に開いていた。実際に起きた）。「無ければ困る」ものは
  `else console.error(...)`を添えるか、テストで存在を固定すること。
- **色と文字サイズは`:root`のトークンから選ぶ**。リテラルの16進・pxを新しく
  足さない。面/枠線/文字の中間色は`--surface`/`--surface-2`/`--surface-3`/
  `--line-soft`/`--line-mid`/`--line`/`--line-strong`/`--ink`/`--ink-2`/`--ink-3`/
  `--ink-soft`/`--muted`、文字は`--fs-*`。同じ役割の色が画面ごとに少しずつ違う
  値で書かれていたのが「揃っていない」印象の主因だった（枠線8種・補助文字10種）。
  **例外はA4帳票(`.rp-page`/`.df-page`配下)だけ**——用紙の割り付けが表示サイズ
  倍率で崩れるため、あそこはpx固定が正しい。`tests/test_theme.js`が
  「リテラルpxが印刷物以外に無いこと」を固定している。
- **浮きウィンドウ（`WL.makeFloatingWindow`）の端は8方向**（四辺＋四隅）。
  つまみは**JSが差し込む**——窓は4箇所で作られており、HTMLへ8個ずつ書かせると
  書き漏らした窓だけ端を掴めなくなる。
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
  追加しないこと。**共有DBを開く前に`Path.exists()`/`stat()`/`resolve()`を
  置かないこと**——読みたいのはファイル本体で、これらは別のファイルアクセス
  (`os.stat`)になる。共有越しでは「statだけ失敗してopenは成功する」ことがあり、
  `Path.exists()`は`ENOENT/ENOTDIR/EBADF/ELOOP`と`WinError 21/123/1921`しか
  「無い」と読み替えず**それ以外は送出する**ため、確認のつもりの1行が唯一の
  失敗原因になる（実際に`[WinError 59] 予期しないネットワークエラー`で
  仕掛一覧だけが開けない端末があった）。`connect(readonly=True)`は**まず開き、
  失敗したときだけ**`path_exists_safe()`(True/False/**None=確かめられなかった**)
  で理由を切り分ける。存在確認が要る箇所ではこの関数を使い、`None`を「無い」と
  同じに扱わないこと。現地での切り分けには`/api/db-diagnose?db=SIKALOTNOW`
  （存在確認→stat→resolve→1バイト読む→URI→接続を1段ずつ試す。読むだけ）。
  固定は`tests/test_dbopen.py`。仕掛/品質データの読み込み先自体はパス設定マスタ(下記、マスタ管理
  画面の「パス設定」タブ)の`sikalotnow_path`/`sikalotdef_path`で上書き可能で、
  **この2項目とsikalot_source/records_backup_export_path/
  schedule_share_pathは、接続先をプロセス起動時に1回だけ確定させる設計のため、
  マスタ管理画面で保存してもサーバー再起動まで反映されない**（画面内の「保存値」
  「現在有効な値」の一覧で反映状況を確認できる）。サンドボックス検証で一時的に
  使う場合は検証後にマスタ管理 > パス設定から既定のネットワーク共有パスへ
  戻してから再起動すること（戻し忘れると以降の起動が上書き先を読み続けてしまう）。
- **マスタ管理の汎用CRUDは4本セット**: 画面(`master-maint.js`の`submitMaint`、定義は`master-defs.js`)は
  `GET <endpoint>` / `POST <endpoint>` / **`POST <endpoint>/update`（編集）** /
  `POST <endpoint>/delete` を決め打ちで呼ぶ。`MASTER_DEFS`に1行足すだけで
  画面は動くので、**サーバー側の`/update`を書き忘れても押すまで気づけない**
  （404のHTMLがそのままトーストに出る。実際に設備停止・設備停止分類・
  データソースの3つで起きた）。削除は必ず`{id}`で来るので、自然キー
  （`key`等）でしか消せない実装にしないこと。自然キーで既存を探す登録側は
  **キー自体の付け替えを表現できない**ため（別行の新規登録になる）、
  ID指定の`/update`を別に用意する。固定は`tests/test_crudroutes.py`
  （`MASTER_DEFS`を読んで4本が404/405でないことを確認。マスタを増やすと
  自動で対象になる）。
- **分割ありの親ロットは子ロットをぶら下げて予定へ入る**（`作業予定`の
  `[親予定ID]`）: 予定へ入れた時点で子ロットの仕掛データも引き、
  `plan_add(children=[...])`で**1回の書込サイクル**にまとめて作る。
  **時間を持つのは親だけ**（子の`[見積分]`は0固定、`schedule_calc`の展開
  ループは子でカーソルを進めない）。親1本をスリットするのは1回の作業なので、
  子に時間を持たせるとタイムラインが子の数だけ伸びる。画面では親の下に
  畳んで出す。**子行を`.sc-row-line`にしないこと**——並べ替えはその
  クラスでDOMを走査するので、混ぜると並べ替えが丸ごと通らなくなる
  （サーバーの`plan_reorder`も対象は親だけ）。親を消すと子も消える。
  固定は`tests/test_scsplit.js`、フィクスチャは`tests/make_split_fixture.py`。
- **設備停止マスタの`[設備名]`は「対象設備」**（1設備とは限らない）:
  `'A'`／`'A,B,C'`／`'*'`（すべての設備）の3通りを取る。書式はアクセス権限
  マスタの`[現場段取り対象設備]`（`master_repo.FIELD_REORDER_ALL`）と同じ。
  **判定は`schedule_repo.stop_equipment_*`の5関数に集約**してあるので、
  `normalize_equipment_name()`での直接比較を新しく書かないこと（判定が散ると
  画面とサーバーで「効いている設備」が食い違う）。設備を名指ししている行だけを
  数えたい場面（設備マスタ削除の参照件数）は`stop_equipment_named()`を使う
  ——`'*'`を「その設備の登録」と数えると、消しても行き場を失わない行まで
  削除の警告に並ぶ。同じ名称で対象設備が重なる登録は`stop_reason_upsert`が
  拒否する（どちらの標準所要分が効くのか決まらないため）。対象設備そのものを
  入れ替えられるのは`POST /api/schedule/stop-reason-master/update`（ID指定）
  だけで、登録側は自然キー照合のため別行の新規登録になる。固定は
  `tests/test_stopeq.js`。
- **「どれが仕掛でどれが品質か」はキーでなく`データソースマスタ`の`[役割]`**
  （`作業`／`品質`／空欄、各1件）: 以前は`'SIKALOTNOW'`という文字列を十数箇所で
  直接比較しており、マスタでキーを変えた端末で**左メニューに古いキーのボタンが
  残って「データベース指定が不正です」になり、同じ名前が2つ並び、測定・予定の列や
  品質結合が黙って消えた**（実機で発生）。判定は
  `db_access.WORK_DB_KEY`/`QUALITY_DB_KEY`（サーバー）と
  `WL.dataSource.isWork()`/`.isQuality()`/`.workKey()`（画面）に集約してある。
  **キーの文字列で比較するコードを新しく書かないこと。**
  **左メニューは`/api/catalog`が唯一の正**で、`list-view.js`の`renderDbNav()`が
  毎回作り直し、カタログに無いボタンを**消す**。`templates/index.html`へ
  `data-db-key`のボタンを直接書かないこと（消えないボタンが復活する）。
  列（項目）は決め打ちしない——一覧は取得した列名をそのまま並べ、ロット番号等を
  使う機能は`aliases`で探して見つからなければその機能だけ静かに出さない。
  固定は`tests/test_dsnav.js`・`tests/test_datasource.py`と、実行コードに
  キーが直接書かれていないかを見る`tests/test_dskeylint.py`（`!==`形・
  `selectDb('...')`形・`[data-db-key="..."]`セレクタ形を人手のgrepで
  取りこぼし、スケジュールモードの仕掛一覧だけ直っていない状態で出した
  ことがあるため、機械的に見る）。
- **共有上の読み取り専用DBは`db_mirror`が手元へ写し、画面は写しを読む**:
  仕掛/品質の`.sqlite3`は別PCの別アプリが更新しており、直接読むと更新と
  重なって正しく読めない（SQLiteのロックは共有では当てにならず、書き手が
  ファイルごと置き換える運用ならロック以前の問題）。`backend/db_mirror.py`が
  バックアップAPI→検査→`os.replace()`で`db/cache/`へ写し、`cfg()`が読む場所を
  差し替える。**写す対象は`role=='readonly'`だけ**（マスタ・共有スケジュールは
  自分が書くので写すと反映されない事故になる）。**共有へ触るのは背景スレッド
  だけ**にすること。固定は`tests/test_dbmirror.py`。詳細は`docs/ARCHITECTURE.md`。
- **参照データを増やすときは`データソースマスタ`の1行**（`db/master.sqlite3`、
  定義は`backend/db_access.py`）: 「RNEから抽出→`.sqlite3`を作る→それを一覧
  として読む」という1本の流れを1行で持つ。**`db_access.DBS`も
  `rne_scheduler.jobs()`もここから作られる**ので、コードへ直接データソースを
  足さないこと（以前は3箇所に分かれており、抽出先と読込先を別々に書けたため
  「抽出しているのに読まない」設定が作れた）。パス設定マスタと同じ理由で
  `db_access.py`に自己完結させてある（`master_repo.py`は`db_access`に依存する
  側なので循環importになる）。接続先を決めるためサーバー再起動で反映。
  RNE資材と`symnavim.conf`の置き場は`rne_assets_dir`/`rne_conf_path`
  （こちらは都度読み直すので再起動不要）。固定は`tests/test_datasource.py`。
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
- **フォルダ構成**: 直接実行されるPythonと、その道連れの資材は
  **`program/`**へまとめる(`app.py`/`setup_app.py`/`sidecar.py`/`requirements.txt`/
  `requirements-dev.txt`、デスクトップ版の本体`WaveLog.exe`〈main へは CI が置く〉。§9.404・§9.548)。
  リポジトリ直下に残すPythonは**1本も無い**(§9.406で`_pycache_bootstrap.py`も移した)。
  `.bat`は`update.bat`の1本で`program/`。
  ロット問い合わせの自動ログインの拡張(§9.485)は、§9.521 で別のアプリ LotData-Link へ移した（`program/`には無い）。
  直下に残るのは毎日の入口`Start.vbs`と、**移すと黙って効かなくなる**
  `.gitignore`(gitはそのフォルダ以下にしか当てない)・`eslint.config.mjs`
  (`program/`へ移すと規則が1件も当たらないのに**エラーにならない**。
  実測306件→0件・§9.406)の2つだけ。
  `program/`の3本は`import _pycache_bootstrap`→`import _approot`の順で
  通す(前者が`.pyc`の置き場、後者がリポジトリ直下を`sys.path`へ足す1箇所)。
  importされるだけの起動部品は`backend/launcher/`へ置く
  (`services.py`・`server.py`・`setup_check.py`・`ready.py`)。起動スクリプト
  (直下の`Start.vbs`と`program/`の`update.bat`)は`program\…`を呼ぶ
  ——**CRLF・CP932のまま**触ること(§9.229)。
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
  edit/view/scheduleの全モードで200が返る）。**宣言漏れは`tests/test_modeguard.py`が
  機械で見る**——非GETを持つBlueprintを実際のURLマップから拾い、全部が
  `_WRITE_ALLOWED_MODES`に載っているかを確かめる。**読み取り専用のPOSTしか
  持たないBlueprintも宣言する**こと（除外すると、後から本物の書込を1本足した
  ときに、その人がテストを回すまで無防備なままになる。実際に`tables`が
  その状態だった）。
  また`_ENDPOINT_EXTRA_MODES`と`_READ_ONLY_POST_ENDPOINTS`のキーは
  `Blueprint名.関数名`なので、**エンドポイントを別のBlueprintへ移すだけで
  許可が黙って変わる**。移動時は必ず両方の表を更新し、`tests/test_modeguard.py`
  （モード×エンドポイントの許可表を固定するテスト）で確認する。
  既存の許可モードを広げたい場合のみ`_ENDPOINT_EXTRA_MODES`へ個別追記し、
  ハンドラ側でも権限を二重チェックする。
  詳細は`docs/SCHEDULE_MODE_DESIGN.md`§3を参照。フロント側の入口ガード・
  閲覧データの読み込みは`static/js/core/access-mode.js`(最後に読み込むファイル)が持つ。
- **update.batの文字コード**: `program/`の`.bat`は**CP932(Shift-JIS)で保存する**
  こと(UTF-8で日本語を含めるとWindowsのcmd.exeが誤読しコマンドが壊れる。
  実際に発生した不具合)。編集時はUTF-8で書いてから
  `iconv -f UTF-8 -t CP932//TRANSLIT program/update.bat -o program/update.bat` で変換する。
  `file program/update.bat` が `Non-ISO extended-ASCII text` になっていればCP932。
  可能な限り非ASCII文字(REMコメント等)は使わず、`マスタ.sqlite3`等の
  実ファイル名の一致に必要な箇所のみ日本語を使う。


---
索引: [決定記録](README.md) ／ 設計: [スケジュールモード 詳細設計](../SCHEDULE_MODE_DESIGN.md) ／ 規則: [CLAUDE.md](../../CLAUDE.md)
