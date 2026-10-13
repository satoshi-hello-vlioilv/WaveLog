# マスタ管理の画面（58件）

索引: [規則の置き場](README.md)｜入口: [CLAUDE.md](../../CLAUDE.md)

マスタ管理のタブ・盤・編集モーダル

行は**守ることだけ**を書いてある。なぜそうなのか・実測値・撤回した案・踏んだ罠は
「くわしく」の先（[`docs/decisions/`](../../docs/decisions/README.md)）にある。
**直す前にその先を開くこと。**「固定する網」は `tests/run_all.sh <名前>` で回す。

| 守ること | 固定する網 | くわしく |
| --- | --- | --- |
| 専用の画面の欄も打った値は足元の「保存」で書く（欄を離れて保存しない）。追加・既定・消すのボタンは1押し、その前に保存していない変更を聞く（`afterLeave()`） | `test_stopsubui.js` | [§9.598](../../docs/decisions/9.598.md) |
| 塗りの主ボタンはいつも1つ: 変更が無いあいだは頭の「＋ 〜を追加」、変更が出たら足元の「保存」（頭を縁取りにするのは`paintFootState()`の1箇所） | `test_mmpane.js` | [§9.598](../../docs/decisions/9.598.md) |
| 選ぶ札の印は2つの形（1つ選ぶ＝丸・`.mm-card-row.is-one`／いくつでも＝四角）。札の一言は選んでも薄い字 | `test_mmpane.js` | [§9.598](../../docs/decisions/9.598.md) |
| 一覧の列と詳細の欄は同じ呼び名。空欄の言い方も1つ（選択欄の空の札は定義の`blank`・空欄で起きることは`blankWhy`の ⓘ） | `test_mmpane.js`・`test_oplimit.js` | [§9.598](../../docs/decisions/9.598.md) |
| 共通設定の段は左の一覧（`pageTabsHtml(…,{rail:true})`）。札は絵・名前・副題・状態の札（`data-tab-state`・正常は中立） | `test_setpage.js` | [§9.598](../../docs/decisions/9.598.md) |
| 共通設定の名乗りはPC名だけ（IDとモードはヘッダー）。足元は状態と記録者＋キャンセル＋保存。作れない端末の事実は灰の字 | `test_setpage.js` | [§9.598](../../docs/decisions/9.598.md) |
| 専用の画面で定義の欄をその場で直すのは`WL.mm.inlineFields()`（組み立て・保存は窓と同じ）。足元の字は`paintFootState()` | `test_stopsubui.js`・`test_shift.js` | [§9.598](../../docs/decisions/9.598.md) |
| 設備停止の基本はその場で直し、新しい停止内容も右の基本で作る（分類を連れて行く）。消すは ⋯、分の棒は同じ目盛り | `test_stopsubui.js`・`test_master.js` | [§9.598](../../docs/decisions/9.598.md) |
| 前のタブの読み込みが後から届いたら、汎用の表は控えの行から**その場で**描き直す（`redrawAfterStale()`） | `test_mmswitch.js` | [§9.598](../../docs/decisions/9.598.md) |
| 専用の画面も「変更あり」を名乗る（`registerSpecial(key,{dirty})`）。離れる道は右の詳細と同じ`afterLeave()` | `test_shift.js` | [§9.598](../../docs/decisions/9.598.md) |
| ⋯・▾ のメニューは`openActMenu()`の1つ。主の操作の作り方（空から・テンプレートから）は ▾ で選ぶ | `test_shift.js`・`test_mmpane.js` | [§9.598](../../docs/decisions/9.598.md) |
| 欄の説明の続きと空欄の理由は見出しの ⓘ の1つ（`fieldLabelHtml()`）。欄の下の説明は`fieldHintHtml()`の1つ | `test_mmpane.js`・`test_rbmodal.js` | [§9.598](../../docs/decisions/9.598.md) |
| 数の欄の空欄の値は欄の中の薄い字（定義の`blank`）。欄が1つの節は欄の名前を出さず見出しが持つ（必須・キーは除く） | `test_mmpane.js` | [§9.598](../../docs/decisions/9.598.md) |
| 一覧のセルは字（`cellText`）から作った印（`cellHtml()`）。既定は薄い字、未設定は字のまま薄く、段は ●◐○— と凡例 | `test_mmpane.js`・`test_eqfeature.js` | [§9.598](../../docs/decisions/9.598.md) |
| 一覧の列の幅は中身を測った比（`fitMaintColumns()`）。詳細の欄に入ると同じ列が光り、打った値はその場でセルへ | `test_mmpane.js` | [§9.598](../../docs/decisions/9.598.md) |
| マスタの頭は画面名＋ⓘ＋用途の1行／右端に主の操作1つ（`setHeadActs()`）。Excel・まとめて削除は「⋯」の帯 | `test_headbar.js`・`test_rollwipe.js` | [§9.598](../../docs/decisions/9.598.md) |
| 汎用の表のマスタは「一覧＋右の詳細」。窓に残すのは組み立て・紙の見本・専用の画面の窓だけ（答えは`editorDocks()`の1箇所）。閉じるのは×だけ | `test_mmpane.js` | [§9.598](../../docs/decisions/9.598.md) |
| 右の詳細の「変更あり」は保存と同じ値の集め方（`collectMaintBody()`）。開いただけでは変更なしで、保存・キャンセルは押せない | `test_mmpane.js` | [§9.598](../../docs/decisions/9.598.md) |
| 右の詳細を離れる道（行・左の一覧・追加・×・再読込・戻る）は`afterLeave()`を通る。変更があれば聞く・無ければその場で | `test_mmpane.js`・`test_modalkeep.js` | [§9.598](../../docs/decisions/9.598.md) |
| マスタ管理は全幅（左のメニュー・使用設備の案内・現場段取り／使用設備の札を伏せる・モードの札は残す）。出る道はヘッダーの「◯◯へ戻る」 | `test_mmshell.js` | [§9.593](../../docs/decisions/9.593.md) |
| マスタの一覧は平らな行（30px・1文字の印なし）。「マスタを探す」は畳んだ群の中まで・Esc は字だけ消す | `test_mmshell.js` | [§9.593](../../docs/decisions/9.593.md) |
| 設備停止マスタは左＝分類 → 停止内容の木／右＝選んだ停止内容の段（基本・内訳・挿入の条件）。段の札がいまの値を言う（`SSB_TABS`の1箇所） | `test_stopsubui.js`・`test_stoprulemaster.js` | [§9.590](../../docs/decisions/9.590.md) |
| 挿入の条件は決まりの札（文で読む）＋押した札の中で「組み立てる｜式を書く」＋右に「いまの予定の境目で試す」（`WL.stopRuleBoard`）。使えない式は保存の前に止める | `test_stoprulemaster.js` | [§9.590](../../docs/decisions/9.590.md) |
| 操業データ項目の設定窓は決める順の3列。行の置き場所は`OP_SECS`の1箇所（`main`／`more`／`danger`）、行は`data-op-row`で名乗る | `test_opui.js` | [§9.587](../../docs/decisions/9.587.md) |
| 細部は「細かい設定」に畳む（見出しはいまの値・開け閉めは`opState.more`）。長い説明は ⓘ、選ばせ方の盤は開かずに並べる | `test_opui.js` | [§9.587](../../docs/decisions/9.587.md) |
| 【§9.598で左の一覧に改めた】共通設定は5段。札は絵・名前・要対応の数・いまの一言で、段が`data-tab-sum`／`data-tab-badge`で名乗る | `test_setpage.js` | [§9.583](../../docs/decisions/9.583.md) |
| 共通設定の段の中は「1行＝名前｜欄｜状態」（`pcKit().row`）。説明は ⓘ、置き場の行の補足は ⋯ | `test_setpage.js`・`test_storageui.js` | [§9.583](../../docs/decisions/9.583.md) |
| 置き場は群ごとに畳める表（みんなで使う→この端末の中→読むだけ）。見出しが件数と状態を言う | `test_storageui.js`・`test_setpage.js` | [§9.583](../../docs/decisions/9.583.md) |
| 共通設定の保存の帯は保存する欄（`[data-pc-field]`）がある段だけ。段の切り替えは`mm-tab`で器へ知らせる | `test_setpage.js` | [§9.557](../../docs/decisions/9.557.md) |
| 換算係数は上＝要約／左＝散布図と積み上げ／右＝係数の図と上書き。打つと保存前に効くロットと見積の変わり方 | `test_lfui.js` | [§9.543](../../docs/decisions/9.543.md) |
| 設備の使い分けは2枚目のタブ（主役は一覧）。多数派・違い・効かないセルは`WL.equipUse.useMatrix()`の1箇所（同数は使う側・どこにも出ない設備は数えない） | `test_equse.js` | [§9.542](../../docs/decisions/9.542.md) |
| 効き先の図は選んだ設備の機能ごとの1レーン。表のセルに乗せると図の同じ所が光る。セルを押すと1回で保存（読むだけの端末では押す形にしない） | `test_equse.js` | [§9.542](../../docs/decisions/9.542.md) |
| タブの面の配線は`registerListView`の`wire(section,ctx)`（描いた直後に1回・盤は中身を知らない） | `test_equse.js` | [§9.542](../../docs/decisions/9.542.md) |
| マスタの1欄は`MM_FIELD_BUILDERS`（型→組み立て関数）の表。型を足すときは表へ1行。鍵は`Object.hasOwn`で引く | `test_maint.js` | [§9.522](../../docs/decisions/9.522.md) |
| 汎用の表の計算の列は`WL.mm.registerCell()`の登録表（`cols`の1列が`cell:'種類'`を名乗る）。盤は種類を知らない | `test_roll.js` | [§9.537](../../docs/decisions/9.537.md) |
| 汎用の表のタブと行を開く節は登録表（`registerListView`／`registerRowDetail`）。主役は最初のタブの一覧 | `test_roleui.js` | [§9.538](../../docs/decisions/9.538.md) |
| 器`#masterMaintForm`へは名前のある関数1つで受け手を付け、その回の値は器から読む（印の下で描画を閉じ込めない） | `test_setpage.js` | [§9.522](../../docs/decisions/9.522.md) |
| 【§9.531で盤へ移した】刃組基準値は専用の盤（節ごと・既定値の薄字・離れたら保存）。汎用の窓の`formLayout`等は持たない | `test_partboards.js` | [§9.463](../../docs/decisions/9.463.md)・[§9.531](../../docs/decisions/9.531.md) |
| 段の札の一言は**見えている欄だけ**から作る（伏せた欄を数えない。判定は`[hidden]`） | `test_setpage.js` | [§9.433](../../docs/decisions/9.433.md) |
| 設備停止の内訳は「左＝停止内容（分類ごと）／右＝内訳」の2ペイン。時間は札＋スライダーの見本 | `test_stopsubui.js` | [§9.389](../../docs/decisions/9.389.md) |
| 【§9.590で木＋段に改めた】設備停止マスタは**1枚の3ペイン**（左＝分類／中＝停止内容／右＝内訳）。タブを分けない | `test_stopsubui.js`・`test_master.js` | [§9.397](../../docs/decisions/9.397.md) |
| 他へ統合した定義は消さずに`navHidden`で伏せる（APIとCRUDの見張りは残す） | `test_crudroutes.py`・`test_master.js` | [§9.397](../../docs/decisions/9.397.md) |
| `COVERED_BY`の行き先は**実在するタブ**を指す（伏せたタブを指さない） | `test_rawmaster.py` | [§9.397](../../docs/decisions/9.397.md) |
| 2段目を作る道は1段目の行の「＋ 下へ」。**足す先を先に言う**（押してから気づかせない） | `test_stopsubui.js` | [§9.390](../../docs/decisions/9.390.md) |
| 入切の札（`check-set`）の器は横いっぱい。`mmFieldSize()`の並びに載せないと1列に縦積みになる | `test_measitems.js` | [§9.392](../../docs/decisions/9.392.md) |
| マスタ管理のJSは「定義／盤／専用画面」の5本。受け渡しは`WL.mm`の1つ | `test_loadorder.py` | [§9.324](../../docs/decisions/9.324-1.md) |
| 盤を入れた段は縦積みにする。折り返す横並びのままだと高さが決まらない | `test_rbmodal.js` | [§9.291](../../docs/decisions/9.291.md) |
| 器の高さを与えないと窓は中身なりで止まる | `test_rbmodal.js` | [§9.254](../../docs/decisions/9.254.md) |
| 操業データ項目のレイアウトは設備ごとに重ねる。行は複製しない | `test_opdata.py` | [§9.239](../../docs/decisions/9.239.md) |
| `esc()`は「属性にも使う」ので引用符まで逃がす | `test_rbcells.js` | [§9.276](../../docs/decisions/9.276.md) |
| 落とす場所の印で盤を動かさない | `test_opui.js` | [§9.218](../../docs/decisions/9.218.md) |
| 浮きパネルの中に絶対配置のポップアップを作らない | — | [§9.201](../../docs/decisions/9.201.md) |
| 設定ページは段（タブ）＋畳み（アコーディオン） | `test_measstore.js`・`test_setpage.js` | [§9.261](../../docs/decisions/9.261.md) |
| 操作が少ない画面の操作列は1行目へ相乗りさせる | — | [§9.266](../../docs/decisions/9.266.md) |
| 盤の落とし先は「カーソルの真下の物」で決める | `test_oppad.js` | [§9.230](../../docs/decisions/9.230.md) |
| マスタ管理の汎用CRUDは4本セット | `test_crudroutes.py` | [決まり](../../docs/decisions/rules-misc.md) |
| 「記録した値」の並べ方は専用の盤が持つ | — | [§9.243](../../docs/decisions/9.243.md) |
| 「既定へ戻す」は本当に空へ帰す | — | [§9.243](../../docs/decisions/9.243.md) |
