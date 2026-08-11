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
  ——増やすと`boot_status.py`の`BROWSER_STEPS`・`loading.html`・
  `index.html`の3箇所の一覧も合わせる必要がある（`tests/test_boot.py`が
  一致を、`tests/test_bootui.js`が「解除後に組み替えが起きないこと」を固定）。
  起動待機画面(`loading.html`)は`file://`で開くため外部ファイルを参照できず、
  意匠を共有できない。**片方だけ直すと引き継ぎで見た目が飛ぶ**ので両方直す。
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
  `refreshScheduleIfOpen`/`expandFilterVars`/`toleranceScaleView`/`optionList`/`defect`/
  `fieldReorderAllows`/`fieldReorderAllowsAll`/`fieldReorderLabel`/`boot`/`onReady`/
  `dataSource`/`columnLayout`/`cellFormat`/`displayRules`/`listColumns`/`listRules`/
  `rowGap`/`listSort`/`listSortBar`/`listQuery`/`renderDbNav`/
  `bindColumnHeaderTools`/`makeFloatingWindow`。
  **公開漏れは黙って素通しになる**ことに注意——`typeof makeFloatingWindow==='function'`の
  ように「あれば使う」書き方で呼んでいると、公開し忘れても例外が出ず、
  機能だけが静かに欠ける（列の設定パネルが位置も大きさも与えられないまま
  画面外に開いていた。実際に起きた）。「無ければ困る」ものは
  `else console.error(...)`を添えるか、テストで存在を固定すること。
- **寸法は文字サイズから作る**（§9.90）: `--ctl-h-*`は
  「文字(`--fs*`)×`--lh`＋上下余白×2」の式で、役割の違いを持つのは
  **上下余白だけ**。**pxの直値へ戻さないこと**——以前は26/30/36/40pxの直値で、
  高さ÷文字サイズが7種類に散り「同じボタンでも小さいものほど詰まって見える」
  状態だった。**1つの表の中のセル・行内ボタンは同じ大きさ**にする
  （器が`--tbl-fs`／印だけ`--tbl-fs-mark`を宣言し、中はそれを見る。一覧は
  `--fs`、15列並ぶタイムラインは`--fs-sm`）。行の高さは
  `--row-h = --fs × --lh + 行の余白×2 + 罫線`で、**下限を決めるのは行の中の
  文字**（`--ctl-h-xs`に依存させると行間を詰められなくなる。行内ボタンは
  `--row-ctl-h`で行に合わせて縮む）。**`--row-h`/`--row-ctl-h`は`#grid`側でも
  定義し直す**——カスタムプロパティは定義した場所で解決されるため、`:root`の
  ままでは行間つまみが効かない（`--row-pad-y`と同じ罠）。
  **列の見出しは折り返さない**（足りなければ余白を削り、次に省略記号）。
  固定は`tests/test_typescale.js`。
- **色と文字サイズは`:root`のトークンから選ぶ**。リテラルの16進・pxを新しく
  足さない。面/枠線/文字の中間色は`--surface`/`--surface-2`/`--surface-3`/
  `--line-soft`/`--line-mid`/`--line`/`--line-strong`/`--ink`/`--ink-2`/`--ink-3`/
  `--ink-soft`/`--muted`、文字は`--fs-*`。同じ役割の色が画面ごとに少しずつ違う
  値で書かれていたのが「揃っていない」印象の主因だった（枠線8種・補助文字10種）。
  **例外はA4帳票(`.rp-page`/`.df-page`配下)だけ**——用紙の割り付けが表示サイズ
  倍率で崩れるため、あそこはpx固定が正しい。`tests/test_theme.js`が
  「リテラルpxが印刷物以外に無いこと」を固定している。
- **新しいキャッシュは`WL.ttlCache()`を使う**（`base.js`）。期限切れの判定・件数の
  上限・取得中のPromise共有（同時呼び出しを1回にまとめ、失敗したPromiseは
  捨てて再試行できるようにする）を持つ。**既存のキャッシュは置き換えない**
  ——それぞれ無効化の条件が業務仕様と絡んでおり（例: §9.67の作業可否は
  「一度可になったら再取得しない」）、一括置換はその仕様を落とす。
- **列表示マスタ**: `/api/table` は表示設定で列を落とす。内部計算用の
  問い合わせには `include_hidden=1` を付ける。
- **一覧の見せ方（`列レイアウトマスタ`／`一覧表示設定マスタ`）は全置換**:
  対象(`list:<DB>:<表>` / `timeline:<設備>`)ごとに行を消して入れ直す。
  **触っていない設定も一緒に送らないと消える**——見出しのD&Dで並びだけを
  送っていたため、並べ替えると表示名が消える不具合が実際に出た。
  サーバー側(`set_column_layout`)も、並びに載っていない列を幅・表示名・
  書式・非表示のどれかが指定されていれば残す（片方だけ拾う実装だと、
  その設定だけが黙って消える）。値の整形は**画面側だけ**で行う
  （`WL.cellFormat`。並べ替え・絞り込みを生の値で効かせたままにするため）。
  **整形に失敗したら生の値を出す**のが原則で、空欄にしない。
  **読み替え（`表示ルールマスタ`）は書式より先**に効く（生の値を見て判断する
  ため。'00'を'0'へ整形してから読み替えると当たらない）。ルールは列に属さず
  名前で参照し、**表示順の上から見て最初に当たった行を採用**する
  （行の中の条件はAND・行同士がOR、条件が空の行は既定）。壊れた条件は
  **1件だけ**落とし、壊れた正規表現は「当たらない」で済ませ、ルールを消しても
  列側の参照は残す（無いルール名＝読み替えなし）。詳細は
  `docs/COLUMN_PRESENTATION_DESIGN.md`と`docs/SCHEDULE_MODE_DESIGN.md`§9.88。
  **一覧の問い合わせは`WL.listQuery()`で組み立てる**——`filters.js`が
  `load()`を丸ごと差し替えるため、両方に書くと片方だけ直した状態になる
  （品質データ結合とキャッシュで実際に2度起きた）。`filters.js`が足すのは
  絞り込み条件だけ。固定は`tests/test_collayout.js`・`tests/test_colformat.js`・
  `tests/test_colrule.js`・`tests/test_colsort.js`・`tests/test_displayrule.py`。
- **列の設定パネルは触った結果をそのまま一覧へ出す**（§9.90、
  `WL.columnLayout.stage()`で保存せずに当てる）。**保存せずに閉じたら開いた
  時点の形へ戻す**——戻さないと何が保存済みか分からなくなる。
  パネルの中の一覧は**1行=1列**で「名前・出す/出さない・見え方（実データ1件）」
  を同じ行に並べる（下段の横長プレビュー表は廃止）。**書式・読み替え・表示名を
  変えたらリストの例も描き直す**（`renderPreview()`が`renderList()`も呼ぶ。
  忘れると行の例が古いままで「効いていない」ように見える）。
  **チェックは`click`で受ける**——`change`は`click`の後に飛ぶため、行の
  クリックで作り直す作りだと反映されない（実際に「外しても一覧に残る」不具合に
  なった）。並べ替えは行のどこを掴んでもよく、**押しただけなら選ぶ・少しでも
  動かしたら並べ替え**としきい値で分ける。固定は`tests/test_lcpanel.js`。
- **浮きウィンドウ（`WL.makeFloatingWindow`）の端は8方向**（四辺＋四隅）。
  つまみは**JSが差し込む**——窓は4箇所で作られており、HTMLへ8個ずつ書かせると
  書き漏らした窓だけ端を掴めなくなる。
- **タイムラインの「内容」も同じ列レイアウトマスタ**（対象`timeline:<設備>`、
  1セル1値）: `.sc-row-head`と`.sc-row-line`が**同じグリッド定義**を共有し、
  内容のトラックだけを`var(--sc-content-cols)`（JSが
  `applyTimelineContentColumns()`で組み立てる）へ差し替える。**片方だけ別の
  組み立てにしないこと**——見出しとセルの左端がずれて表として読めなくなる。
  見出しの文字は**表示名→内容項目の日本語ラベル→キー**の順に落とす
  （生のキー`mfgTemper`を出さない）。**どの項目を出すか**を決める
  スケジュール内容表示マスタを読むのは**scheduleモードだけ**
  （`scState.fullControl`。編集モードは既定の4項目固定なので、ここを
  取り違えると「項目を変えても何も起きない」と誤診断する）。親子の
  折りたたみつまみは**最初の内容セルの中**へ入れる（素の兄弟にすると
  1列ぶんずれる）。**CSSのコメントに`**/`を書かないこと**——そこで
  コメントが閉じてグリッド定義が壊れ、内容が1列に潰れる（実際に起きた）。
  固定は`tests/test_sccols.js`。
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
- **マスタ管理の汎用CRUDは4本セット**: 画面(`master-maint.js`の`submitMaint`)は
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
- **ループバック(127.0.0.1)への問い合わせはプロキシを通さない**:
  `urllib`は既定でプロキシ設定を見る（Windowsでは**レジストリのIE/Edge設定まで**）。
  社内プロキシのある端末では`127.0.0.1`宛ての生存確認まで転送されて**407**が返り、
  `guard.probe()`が「別のアプリが応答した」と誤判定して**stop.batで停止できなく
  なった**（実機で発生。タスクマネージャーから落とすしかない状態）。
  `guard.urlopen_local()`（`ProxyHandler({})`）を使うこと。407/502/503/504は
  FOREIGNではなく`UNRESPONSIVE`（＝届いていない）へ倒し、記録済みPIDでの停止へ
  進めるようにしてある。
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
