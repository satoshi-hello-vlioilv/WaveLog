# 画面の土台（40件）

索引: [規則の置き場](README.md)｜入口: [CLAUDE.md](../../CLAUDE.md)

`WL` 名前空間・窓（モーダル）・メニュー・拡張の登録表

行は**守ることだけ**を書いてある。なぜそうなのか・実測値・撤回した案・踏んだ罠は
「くわしく」の先（[`docs/decisions/`](../../docs/decisions/README.md)）にある。
**直す前にその先を開くこと。**「固定する網」は `tests/run_all.sh <名前>` で回す。

| 守ること | 固定する網 | くわしく |
| --- | --- | --- |
| 操作列の相乗り（`compactToolbar`）は**入るときだけ**。載せるかは`fitViewToolbar()`が測って決め、見張りは`ResizeObserver`の1つ | `test_headbar.js` | [§9.509](../../docs/decisions/9.509.md) |
| 古い版の知らせは**左メニューの版のバッジの隣に字1つ**（面なし・場所を動かさない）。`null`で消さない・再起動待ちとレールでは出さない | `test_presenceui.js` | [§9.515](../../docs/decisions/9.515.md) |
| 「この端末の見え方」の3つは同じ形で読める（`WL.uiSize`／`WL.duration`／`WL.loader`） | `test_uisize.js` | [§9.433](../../docs/decisions/9.433.md) |
| **「表示」という名のボタンは1つだけ**（ヘッダー）。画面は`WL.lookSettings.register()`で節を名乗る | `test_uisize.js`・`test_scbar.js` | [§9.444](../../docs/decisions/9.444.md) |
| デスクトップの起動アイコンの盤は「表示」の節（`when`を持たない＝どのモードでも）。共通設定に残すのは状態と行き先だけ | `test_uisize.js`・`test_setpage.js` | [§9.445](../../docs/decisions/9.445.md) |
| 開けない行き先は押す形にしない。開けるかは名乗り手が答える（`WL.openLookSettings.available()`） | `test_uisize.js` | [§9.445](../../docs/decisions/9.445.md) |
| 押すと何が起きるか（作る／作り直す／上書き／付け替え）は`shortcutPlan()`の1箇所。ボタンの字も注意の1行も同じ答えから出す | `test_uisize.js` | [§9.446](../../docs/decisions/9.446.md) |
| 土台は画面の作りを知らない。器だけ渡し、出すのは`when()`が真のときだけ。同じ`key`は差し替わる | `test_uisize.js` | [§9.444](../../docs/decisions/9.444.md) |
| 節へ渡す器は**文書に付けてから**`render(host)`を呼ぶ。メニューの上に重ねた窓（`.record-modal`）の中は「外」と数えない | `test_uisize.js` | [§9.486](../../docs/decisions/9.486.md) |
| **この端末の見え方を「予定を動かせる権限」で塞がない**（別の軸。§9.207が列で踏んだのと同じ取り違え） | `test_scinsert.js` | [§9.444](../../docs/decisions/9.444.md) |
| **節の見出しを本文より小さくしない**（`--fs-tiny`＝9.5pxは付随情報の寸法）。窓は320px以上 | `test_uisize.js` | [§9.444](../../docs/decisions/9.444.md) |
| 見え方が変わったら`wl:look-change`で知らせる（いまの値を出す画面が塗り直す） | `test_uisize.js` | [§9.433](../../docs/decisions/9.433.md) |
| 入口は増やさず**行き先**を置く。畳んだ入口の説明には節を全部書く | `test_uisize.js` | [§9.433](../../docs/decisions/9.433.md) |
| 読み込み中の並びは`WL.loader.html()`の1箇所（`<i>`は`WL.loader.SLOTS`＝9つ）。呼ぶ側が自前の形を書かない | `test_uisize.js` | [§9.436](../../docs/decisions/9.436.md) |
| 見た目の型は**器そのもの**が名乗る（`.wl-ld[data-ld]`）。祖先に付けると、見本を並べた盤で取り違える | `test_uisize.js` | [§9.436](../../docs/decisions/9.436.md) |
| 顔ぶれが器に入らなくなったら**広い場所へ移し、狭い入口には行き先といまの値だけ**を残す | `test_uisize.js` | [§9.436](../../docs/decisions/9.436.md) |
| 選ぶ面が2つ以上あるとき、**印を付ける役も1箇所**（`WL.loader.mark()`）。描いた直後に呼ぶ | `test_uisize.js` | [§9.436](../../docs/decisions/9.436.md) |
| 「この端末の見え方」の入口は「表示」バッジの1つ。節を足す（入口は増やさない） | `test_uisize.js` | [§9.421](../../docs/decisions/9.421.md) |
| 第三者のCSS/JSは**同梱**し、許諾は`static/vendor/<名前>/LICENSE`へ置く | `test_uisize.js` | [§9.421](../../docs/decisions/9.421.md) |
| 終了したらタブも閉じる。断られたときだけ案内を出す（「閉じました」と言わない） | `test_appquit.js` | [§9.409](../../docs/decisions/9.409.md) |
| 拡張は登録表へ: あとに足す`on`／前で断る`gate`／丸ごと持つ`own`（`WL.measureHooks`・`WL.listHooks`）。被せも全置換も作らない | `test_patchlint.py`・`test_tolscale.js` | [§9.352](../../docs/decisions/9.352.md) |
| 押す形をやめたら`cursor:pointer`も消す。押しても何も起きない物に指のカーソルを出さない | — | [§9.385](../../docs/decisions/9.385.md) |
| マウスを乗せたら**押せることを動きで**言い（1px持ち上げ）、**仲間は群ごと薄く光らせる**（9%）。濃くすると選択中と誤読される | `test_msteps.js` | [§9.396](../../docs/decisions/9.396.md) |
| 初回の案内は帯の1箇所。空の器は「ここに何が出るか」だけを言う | `test_uiux.js` | [§9.343](../../docs/decisions/9.343.md) |
| **浮いて出る面は`.wl-menu`の1つ**を名乗る（器を新しく作らない）。違いは修飾子だけが持つ | `test_popmenu.js` | [§9.448](../../docs/decisions/9.448.md) |
| 置き場所・外クリック・Esc・矢印キー・`role`は`WL.popMenu`の1箇所。呼ぶ側へ書き写さない | `test_popmenu.js` | [§9.448](../../docs/decisions/9.448.md) |
| 浮きメニューの寸法は**面ごとに違ってよい**。揃えるのは値ではなく**値の置き場** | `test_popmenu.js` | [§9.449](../../docs/decisions/9.449.md) |
| 面の値は`.wl-menu`のトークンを**その面のブロックで宣言し直す**（既定は列見出し） | `test_popmenu.js` | [§9.449](../../docs/decisions/9.449.md) |
| `role=menu`を名乗るのは**項目を選ぶ面**だけ。読ませる浮きパネルに名乗らせない | `test_popmenu.js` | [§9.448](../../docs/decisions/9.448.md) |
| 窓は`confirmModal`／`alertModal`／`promptModal`の3つだけ。素の`alert`/`confirm`/`prompt`は呼ばない | `test_patchlint.py`・`test_modalkeep.js` | [§9.342](../../docs/decisions/9.342.md) |
| 窓は1枚しかない。窓の中から窓を開かない（名前を直すのはその場、消すのは行の中で2手） | `test_lotcopy.js` | [§9.368](../../docs/decisions/9.368.md) |
| メニューの入れ子は本体へ足す。1項目のHTMLと配線は`rowMenuItemsHtml`/`bindRowMenuItems`の1箇所 | `test_lotcopy.js` | [§9.368](../../docs/decisions/9.368.md) |
| 入れ子のメニューを閉じるのは「別の項目に留まったとき」だけ。子の中では閉じない | `test_lotcopy.js` | [§9.398](../../docs/decisions/9.398.md) |
| メニューの群の見出しは`button`にしない（`.col-head-menu button`が行き先の寸法を配る）。鍵盤でできることは`kbd`でその場に書く | `test_scstop.js` | [§9.399](../../docs/decisions/9.399.md) |
| 画面の`bodyClass`は自分の`exit`で外す（`enterView`は付けるだけ） | `test_bladeui.js` | [§9.377](../../docs/decisions/9.377.md) |
| `window.*`への新規公開は名前空間経由 | `test_globallint.py` | [決まり](../../docs/decisions/rules-misc.md) |
| 画面のJSは領域フォルダ。綴りは1つ | `test_loadorder.py` | [§9.334](../../docs/decisions/9.334.md) |
| 設定の窓は「決める順の番号付きの節」で、同じ値を2箇所に出さない | `test_eqsetup.js` | [§9.257](../../docs/decisions/9.257.md) |
| モーダルは背景クリックで閉じない | `test_modalkeep.js` | [§9.221](../../docs/decisions/9.221.md) |
| マスタの1行を直す窓は汎用モーダル1枚 | — | [§9.222](../../docs/decisions/9.222.md) |
