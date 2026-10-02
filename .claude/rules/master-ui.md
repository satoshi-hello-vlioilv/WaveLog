# マスタ管理の画面（29件）

索引: [規則の置き場](README.md)｜入口: [CLAUDE.md](../../CLAUDE.md)

マスタ管理のタブ・盤・編集モーダル

行は**守ることだけ**を書いてある。なぜそうなのか・実測値・撤回した案・踏んだ罠は
「くわしく」の先（[`docs/decisions/`](../../docs/decisions/README.md)）にある。
**直す前にその先を開くこと。**「固定する網」は `tests/run_all.sh <名前>` で回す。

| 守ること | 固定する網 | くわしく |
| --- | --- | --- |
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
| 設備停止マスタは**1枚の3ペイン**（左＝分類／中＝停止内容／右＝内訳）。タブを分けない | `test_stopsubui.js`・`test_master.js` | [§9.397](../../docs/decisions/9.397.md) |
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
