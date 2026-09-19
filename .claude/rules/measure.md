# 測定画面（97件）

索引: [規則の置き場](README.md)｜入口: [CLAUDE.md](../../CLAUDE.md)

準備→測定→確認の3段・操業データ項目・公差・条の設計

行は**守ることだけ**を書いてある。なぜそうなのか・実測値・撤回した案・踏んだ罠は
「くわしく」の先（[`docs/decisions/`](../../docs/decisions/README.md)）にある。
**直す前にその先を開くこと。**「固定する網」は `tests/run_all.sh <名前>` で回す。

| 守ること | 固定する網 | くわしく |
| --- | --- | --- |
| 公差の答えは`WL.tolerance`の登録表。描いたあとに足すのは`WL.measureHooks`へ登録し、被せない | `test_patchlint.py`・`test_tolscale.js` | [§9.348](../../docs/decisions/9.348.md) |
| 備考は**列ではなく行**（実測58px→693px）。既定は畳む。畳みは3値（`prtFoldDefault()`） | `test_msteps.js` | [§9.397](../../docs/decisions/9.397.md) |
| 書くことが増えたら（異常のエッジ形状）**手で畳んだ状態を手放す** | `test_msteps.js` | [§9.397](../../docs/decisions/9.397.md) |
| 基準が引けないラテラルボー・バリは、札をボタンにして**そのロットだけ**手で入れられる（出どころは「手入力」） | `test_tolscale.js` | [§9.394](../../docs/decisions/9.394.md) |
| `WL.tolerance.register()`は`facts`／`scale`だけの提供者も受ける。捨てるなら理由を1行残す | `test_tolscale.js` | [§9.394](../../docs/decisions/9.394.md) |
| 札を伏せてよいのは**代わりに出す物があるとき**だけ（指示値が読めないなら札を残す） | `test_tolscale.js` | [§9.394](../../docs/decisions/9.394.md) |
| テストの待ちは`tests/lib/wait.js`の道具で「条件」で置く | — | [§9.324](../../docs/decisions/9.324-1.md) |
| 紙の「混入位置」の何条目かは赤太字。赤は1つ | — | [§9.323](../../docs/decisions/9.323-1.md) |
| 異常位置の条混入位置は3か所まで。1か所ぶんの計算は`spotOf()`の1箇所 | `test_rpdefect.js` | [§9.323](../../docs/decisions/9.323-1.md) |
| 紙の「合うロール径」に式を書かない | — | [§9.323](../../docs/decisions/9.323-1.md) |
| 測定の桁は「測定器が保証できるところまで」 | `test_devdigits.js` | [§9.320](../../docs/decisions/9.320.md) |
| 公差の桁は測定値と同じにそろえる | — | [§9.320](../../docs/decisions/9.320.md) |
| 測定画面のレールは「通常使うボタン」だけにする | `test_devdigits.js` | [§9.320](../../docs/decisions/9.320.md) |
| 公差外は完了を止めない。止めるのは「誰が測ったか」だけ | `test_ngdone.js` | [§9.319](../../docs/decisions/9.319.md) |
| データソースを開く前に存在を確かめない（`cfg()`が答える。§data も見る） | `test_ctxfail.js`・`test_srcread.py` | [§9.198](../../docs/decisions/9.198.md) |
| 見本（デモ）は「いまの入力の決まり」に乗せる | `test_rbcells.py`・`test_rbsample.js` | [§9.321](../../docs/decisions/9.321.md) |
| 見本のロットは器の上限まで埋める | `test_rbsample.js` | [§9.254](../../docs/decisions/9.254.md) |
| 操業データの「自動」項目は式で作れる。評価器は増やさない | `test_opauto.js`・`test_opformula.js` | [§9.256](../../docs/decisions/9.256.md) |
| 設定窓の見本は`WL.opData.buildPreviewField()`の1本で作る | — | [§9.276](../../docs/decisions/9.276.md) |
| フィルタの「組み合わせ（プリセット）」は行そのもの。条件は何回でも使える | `test_filtergroup.js` | [§9.288](../../docs/decisions/9.288.md) |
| 選ばせ方の顔ぶれを網へ直に書かない | `test_oppad.js`・`test_opui.js` | [§9.288](../../docs/decisions/9.288.md) |
| 操業データ項目の設定モーダルは「見本＝上の帯（高さ固定）／設定＝多段組み」 | — | [§9.288](../../docs/decisions/9.288.md) |
| ロールを見分けるのは6つ（設備名＋ロール名＋接触面＋径MAX＋径MIN＋備考）で1本 | `test_roll.js`・`test_rollio.py` | [§9.246](../../docs/decisions/9.246.md)・[§9.257](../../docs/decisions/9.257.md) |
| ロールはまとめて消せる／ファイルの内容そのものに入れ替えられる | `test_rollio.py`・`test_rollwipe.js` | [§9.251](../../docs/decisions/9.251.md) |
| 手打ちの席が無い形では、設定を押せなくして理由を書く | — | [§9.247](../../docs/decisions/9.247.md) |
| ロールマスタは1ロール1設備。判定は`WL.defect.rollMatches`の1箇所 | `test_roll.js` | [§9.239](../../docs/decisions/9.239.md) |
| フィルタは「条件 → その組み合わせ」の2層。バーに出すのは組み合わせだけ | — | [§9.287](../../docs/decisions/9.287.md) |
| 効いている条件は「アイコン＋件数」の1バッジ。中身はポップオーバー | — | [§9.287](../../docs/decisions/9.287.md) |
| 「選ばない」の札の字は`WL.optionBlankLabel`の1箇所 | — | [§9.287](../../docs/decisions/9.287.md) |
| 操業データ項目の保存は`opSaveItem()`の`body`に全部載せる | — | [§9.287](../../docs/decisions/9.287.md) |
| 「誰が・どの端末で」は登録と更新を分けて持つ | `test_audittrail.js` | [§9.180](../../docs/decisions/9.180.md) |
| 測定画面は「準備→測定→確認」の3段 | `test_msteps.js` | [§9.123](../../docs/decisions/9.123.md) |
| 入力内容は3層。**左＝群（母材／製品）・右の小見出し＝単位・その下が量**。顔ぶれは`WL.measureItem.GROUPS`の1箇所 | `test_msteps.js` | [§9.396](../../docs/decisions/9.396.md) |
| 葉の呼び名は**量**でそろえる（`母材`→`全長`／`丈毎`→`寸法・外観`）。`丈毎`は語として消え、「毎」は見出しの「丈ごと」が持つ | `test_msteps.js`・`test_measitems.js` | [§9.396](../../docs/decisions/9.396.md) |
| 中身の説明（2行目）を持つのは`DETAIL`の2つだけ。9項目すべてに付けると器から溢れる（実測 md 11px・lg 40px） | `test_msteps.js` | [§9.396](../../docs/decisions/9.396.md) |
| 旧綴りは**画面とサーバーの両方**で読み替える（`LEGACY_*`と`MEASURE_ITEM_ALIASES`）。片方だけだと外した項目が復活する | `test_measitems.js` | [§9.396](../../docs/decisions/9.396.md) |
| 入力内容の「母材」と「丈毎」は**別々の項目**。出すのは選んだ側のカード1枚だけ（§9.160を撤回。呼び名は§9.396で改めた） | `test_msteps.js` | [§9.391](../../docs/decisions/9.391.md) |
| **値が入っている項目は、設備で外してあっても伏せない**。答えは`hiddenItems()`の1箇所（選択肢もチップも同じ） | `test_measitems.js` | [§9.392](../../docs/decisions/9.392.md) |
| 「寸法・外観」（旧 丈毎）は「外観（〇/△/×）」と「巻ズレ OS/DS」を持つ。条ごとの入力内容「巻ずれ」とは**別物**（単位が違う） | `test_msteps.js` | [§9.393](../../docs/decisions/9.393.md) |
| 集合を「〜以外」で作らない（内訳の顔ぶれは`PRODUCT_DETAIL_KEYS`。主役の列へ足した欄が裏へ漏れる） | `test_msteps.js` | [§9.393](../../docs/decisions/9.393.md) |
| 入力内容の語彙は`WL.measureItem.ALL`の1箇所。画面の`#measureType`とは別に持つ | `test_msteps.js` | [§9.391](../../docs/decisions/9.391.md) |
| 測定値の器を持たない鍵は**名前で避けず、器の有無で見る**（`m.measurements[key]`） | `test_msteps.js` | [§9.391](../../docs/decisions/9.391.md) |
| 必須に数えるのは**いま出している面の欄だけ**（取りこぼしは完了前の確認が見る） | `test_msteps.js`・`test_opmother.js` | [§9.391](../../docs/decisions/9.391.md) |
| ②測定は「項目リスト＋測定表」で、表は使う条数ぶんだけ描く | — | [§9.124](../../docs/decisions/9.124.md) |
| 測定中の巡回キーは持たない | `test_msteps.js` | [§9.160](../../docs/decisions/9.160.md) |
| 入力内容の「母材」と「揃い/肉厚/長さ」は1つの項目 | `test_mcore.js`・`test_msteps.js`・`test_opmother.js` | [§9.160](../../docs/decisions/9.160.md) |
| 母材の「計算全長（参考）」は元データがそろったときだけ出す | — | [§9.160](../../docs/decisions/9.160.md) |
| 屑幅の割り付けは`WL.split.scrapInfo()`の1箇所が答える | `test_splitlive.js` | [§9.160](../../docs/decisions/9.160.md) |
| 操業データは「何を記録するか」をマスタが決める | `test_msteps.js`・`test_opdata.py` | [§9.215](../../docs/decisions/9.215.md) |
| 選ばせ方（プルダウン/ラジオ/タブ/一覧）は`<select>`を残したまま被せる | — | [§9.218](../../docs/decisions/9.218.md) |
| 操業データ項目の設定はモーダルで開く | — | [§9.218](../../docs/decisions/9.218.md) |
| 設定窓の未保存の変更は、遅れて届いた再読み込みで捨てない（`opState.dirty`の1件だけ残す） | `test_opunit.js` | [§9.361](../../docs/decisions/9.361.md) |
| ③測定データ分析は「板厚・板幅のMIN/MAX」が主役 | `test_msteps.js` | [§9.214](../../docs/decisions/9.214.md) |
| 条の図のロット番号は幅で桁数を変える | `test_splitlive.js` | [§9.213](../../docs/decisions/9.213.md) |
| 屑幅の片寄せは図の縁を掴んで直せる | — | [§9.167](../../docs/decisions/9.167.md) |
| ②の「丈位置くらべ」は出ていない丈のためにある | — | [§9.128](../../docs/decisions/9.128.md) |
| 中身を減らしたら器も減らす | `test_msteps.js` | [§9.126](../../docs/decisions/9.126.md) |
| 入れ物の大きさは中身の長さから決める | `test_msteps.js` | [§9.130](../../docs/decisions/9.130.md) |
| ①準備は役割でまとめ、③確認は完了前の確認表を持つ | `test_msteps.js` | [§9.125](../../docs/decisions/9.125.md) |
| 測定中は受信欄(`#deviceInput`)のDOMを作り直さない・動かさない | `test_mcore.js` | [§9.122](../../docs/decisions/9.122.md) |
| 測定データの置き場は3段 | `test_measstore.js` | [§9.202](../../docs/decisions/9.202.md) |
| 揃いは「選んで記録」。4桁の揃いコードは廃止した | — | [§9.203](../../docs/decisions/9.203.md) |
| 揃いの合否は切断面等級から出す | — | [§9.204](../../docs/decisions/9.204.md) |
| 測定の手で打つ数値欄は`WL.numericInput`に乗せる | — | [§9.208](../../docs/decisions/9.208.md) |
| 手動入力ではカーソルを印に追従させる。自動転送では絶対に触らない | — | [§9.208](../../docs/decisions/9.208.md) |
| 母材の欄は打った時点でレコードへ入れる | — | [§9.208](../../docs/decisions/9.208.md) |
| 測定表は器に入るぶんだけ縮める | — | [§9.209](../../docs/decisions/9.209.md) |
| 測定の見出しの塊は2つ・塊の中は折り返さない（窓幅で行数を動かさない） | — | [§9.210](../../docs/decisions/9.210.md) |
| 条の図のラベルは幅ごとにまとめて決める | — | [§9.210](../../docs/decisions/9.210.md) |
| 屑幅がマイナスになる条数は受け付けない | — | [§9.210](../../docs/decisions/9.210.md) |
| 分割の無いロットでも条の図を出す | — | [§9.209](../../docs/decisions/9.209.md) |
| 現場が触る選択肢は「操業データ選択肢マスタ」の1枚 | `test_opchoice.js` | [§9.221](../../docs/decisions/9.221.md) |
| 器の高さを中まで届ける鎖は1段でも抜かない | — | [§9.222](../../docs/decisions/9.222.md) |
| 組み込みの欄も型以外はすべて設定できる | — | [§9.229](../../docs/decisions/9.229.md) |
| 測定の控えは「ロットの事実」と「マスタの設定」を分ける | — | [§9.229](../../docs/decisions/9.229.md) |
| 上下限はマスタから引ける。引けなかった値を0にしない | `test_oplimit.js` | [§9.231](../../docs/decisions/9.231.md) |
| 母材の欄も操業データの項目 | `test_opmother.js` | [§9.232](../../docs/decisions/9.232.md) |
| `valueEl()`は「書ける欄」。画面に出ている欄は`outputEl()`／`displayEl()` | — | [§9.233](../../docs/decisions/9.233.md) |
| マスタが差配している欄の印は`opf-host`の1つ | — | [§9.233](../../docs/decisions/9.233.md) |
| 進捗の分母はマスタが届いてから塗り直す | `test_opmother.js` | [§9.234](../../docs/decisions/9.234.md) |
| 条の設計カードは1画面に収める。減らすのは冗長な文だけ | `test_defectlink.js`・`test_splitlive.js` | [§9.234](../../docs/decisions/9.234.md) |
| 測定の見出しは1行に収める。公差は1箇所でだけ言う | `test_msteps.js` | [§9.209](../../docs/decisions/9.209.md)・[§9.234](../../docs/decisions/9.234.md) |
| 自動で入る値・計算値も操業データの1行にする | `test_opauto.js`・`test_opdata.py` | [§9.234](../../docs/decisions/9.234.md) |
| 条の設計の印は流れの中へ置き、操作の行は縮ませない | `test_splitlive.js` | [§9.233](../../docs/decisions/9.233.md) |
| 手入力の案内は入れる場所のすぐ上に置く | `test_msteps.js` | [§9.233](../../docs/decisions/9.233.md) |
| 設定窓は「選んでも1pxも動かない」 | — | [§9.227](../../docs/decisions/9.227.md) |
| 空き（ダミー）の群は「印を持つ1行」で作る | `test_oppad.js` | [§9.227](../../docs/decisions/9.227.md) |
| 異常位置判定は`WL.defect.markers()`が1箇所で答える | `test_defectlink.js` | [§9.226](../../docs/decisions/9.226.md) |
| 必須はカードではなく「構成」が持つ | `test_opdata.py`・`test_opui.js` | [§9.223](../../docs/decisions/9.223.md) |
| 操業データの単位は9マスの盤で置く | — | [§9.221](../../docs/decisions/9.221.md) |
| 測定値の桁は`measurementDigits()`の1箇所が決める | `test_mcore.js` | [§9.242](../../docs/decisions/9.242.md) |
| バリの2段は測定の見出しのバッジが出す | `test_burr.js` | [§9.242](../../docs/decisions/9.242.md) |
| 「公差」と「基準」は`WL.measureItem.limitWord()`の1箇所が言い分ける | — | [§9.242](../../docs/decisions/9.242.md) |
| 測定値の統計は`stat.<項目>.<集計>`。語彙はサーバーが持つ | `test_rpprint.js` | [§9.242](../../docs/decisions/9.242.md) |
| 「選択肢を持つか」はサーバーでも族で見る | `test_opdata.py` | [§9.244](../../docs/decisions/9.244.md) |
| 統計は「条に紐づくか」で2種類に分かれる | `test_rpprint.js` | [§9.244](../../docs/decisions/9.244.md) |
| 「選ばない」の札は空文字だけではない | `test_opblank.js` | [§9.246](../../docs/decisions/9.246.md) |
