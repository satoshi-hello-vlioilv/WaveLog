# 刃組ガイダンス（125件）

索引: [規則の置き場](README.md)｜入口: [CLAUDE.md](../../CLAUDE.md)

`blade-core.js`／`blade-view.js`／`blade-3d.js`・部材・刃選択

行は**守ることだけ**を書いてある。なぜそうなのか・実測値・撤回した案・踏んだ罠は
「くわしく」の先（[`docs/decisions/`](../../docs/decisions/README.md)）にある。
**直す前にその先を開くこと。**「固定する網」は `tests/run_all.sh <名前>` で回す。

| 守ること | 固定する網 | くわしく |
| --- | --- | --- |
| 模型は**何から組んだか**を名乗る（図の種類＋割付）。描く前に食い違っていたら組み直す | `test_bladeui.js` | [§9.433](../../docs/decisions/9.433.md) |
| 組めなかったら「今の物ではない」と名乗り、**器を空にする**（前の図の絵を残さない） | `test_bladeui.js` | [§9.433](../../docs/decisions/9.433.md) |
| 板と刃は同じ割付から出る。1条目の左端＝1本目の切断位置（`view().matOff`は0） | `test_bladeui.js` | [§9.433](../../docs/decisions/9.433.md) |
| 断面図は必ずライン位置で見る（立体図の引き出しを引きずらない） | `test_bladeui.js` | [§9.433](../../docs/decisions/9.433.md) |
| 拡大図は**選んだ軸の半断面**（縦＝半径・中心線から外へ）。軸を描き、スペーサーは厚さ20mmの輪として出す | `test_bladeui.js` | [§9.432](../../docs/decisions/9.432.md) |
| 半断面の網は**帯の高さの比**で見る（軸:スペーサー＝5.00／刃の張り出し:スペーサー＝2.95）。期待値は基準値から起こす | `test_bladeui.js` | [§9.432](../../docs/decisions/9.432.md) |
| 拡大図のラベルは**対象へ直に貼る**（横→縦→引き出しの順）。引き出すのは「貼る相手が無い寸法」と「字が入らないほど細い部材」だけ | `test_bladeui.js` | [§9.430](../../docs/decisions/9.430.md) |
| 引き出す字は**値だけ**（層の名前は左の余白に1回）。名前を添えるのは部材でないもの（隙間・上下刃の中心間）だけ | `test_bladeui.js` | [§9.432](../../docs/decisions/9.432.md) |
| 断面図の寸法は**1つも落とさない**（中＋引き出し＝出すべき数）。字どうしも重ねない | `test_bladeui.js` | [§9.429](../../docs/decisions/9.429.md) |
| 引き出しは**軸の中に3段**（ゴムリングは輪の外に2段）。段は`x`順に振り分け、段の中は`spread()`で押し広げる | `test_bladeui.js` | [§9.429](../../docs/decisions/9.429.md) |
| 席を配るのは`blade-core.js`の`spread()`の1箇所（拡大図と断面図が共有）。入りきらない数は図の読み方が言う | `test_bladeui.js` | [§9.429](../../docs/decisions/9.429.md) |
| 図の切り替えを受けるのは`setMode(on,kind,割付)`の1箇所。**組むのは1回**（先に`sync()`を呼ぶと前の図のまま1枚描く） | `test_bladeui.js` | [§9.428](../../docs/decisions/9.428.md) |
| 描くのは**いま選ばれている図**の模型。`builtCut`と食い違ったら`render()`が描く前に組み直す | `test_bladeui.js` | [§9.428](../../docs/decisions/9.428.md) |
| 差分の基準は**4段**（記録 → 前回流した材料 → いまの材料 → 無し）。②③は計算値だと断り、②は出どころを言う | `test_bladeui.js` | [§9.425](../../docs/decisions/9.425.md) |
| 記録には**元板巾**（`cond.W`）も残す。無い記録からは材料を組み直さない（0で埋めない） | `test_bladeui.js` | [§9.425](../../docs/decisions/9.425.md) |
| どの段と比べているかは**器が名乗る**（`data-base`）。網は字で見分けない（稼働中の断りに当たる） | `test_bladeui.js` | [§9.425](../../docs/decisions/9.425.md) |
| 「材料が違えば答えも違う」は**同じ節の中の2枚**で見る。離れた節の数字と比べない | `test_bladeui.js` | [§9.425](../../docs/decisions/9.425.md) |
| 台車は**台車マスタ**（設備ごと1台1行）。札の顔ぶれも台数もここが決める——画面へ`A`/`B`を書かない | `test_bladeui.js`・`test_bladeset.py` | [§9.424](../../docs/decisions/9.424.md) |
| 台車が入るのは**初期セット**（`A台車`・`B台車`）。`replace`でも消さない（記録が名前で結び付く） | `test_bladeset.py` | [§9.424](../../docs/decisions/9.424.md) |
| 「台車なし」は**自動で入れない**。綴りは`CARRIAGE_NONE`の1箇所で、1行足せば選べる | `test_bladeset.py` | [§9.424](../../docs/decisions/9.424.md) |
| 台車が1つなら**直前の刃組が組み替える相手**（飛ばさない）。「稼働中で外せない」は別の台車のときだけ | `test_bladeui.js` | [§9.424](../../docs/decisions/9.424.md) |
| 「表示」で消した部材の見せ方は3つ（薄く／線だけ／出さない）。答えは`skin()`の1箇所——材質を返し、無ければ描かない | `test_bladeui.js` | [§9.422](../../docs/decisions/9.422.md) |
| 隠し方の札は**「表示」と同じ群の中**（別の群に離すと何に効くか読めない）。並びは残る量の多い順 | `test_bladeui.js` | [§9.422](../../docs/decisions/9.422.md) |
| 薄く残しても**字は増やさない**（寸法・札は`D3.show`で落としたまま）。色も変えない | `test_bladeui.js` | [§9.422](../../docs/decisions/9.422.md) |
| 消したときの知らせは**いまの隠し方まで**言う。呼び名は`HIDE_WORD`の1箇所 | `test_bladeui.js` | [§9.422](../../docs/decisions/9.422.md) |
| 同じ寸法が続くぶんは**「×枚数」で1つ**（隣り合って・同じ軸で・同じ寸法のときだけ） | `test_bladeui.js` | [§9.420](../../docs/decisions/9.420.md) |
| 部材の字は記号（A・B…）の席を避ける（記号は軸の中心・字は軸の外寄り） | `test_bladeui.js` | [§9.420](../../docs/decisions/9.420.md) |
| 有効長は**寸法線**で言う（端の立て線2本＋あいだの線＋値）。足元の帯へ重ねない | `test_bladeui.js` | [§9.420](../../docs/decisions/9.420.md) |
| 同じ切断の上下の刃は**刃厚＋クリアランス**だけ中心がずれる（重なると円周でぶつかる） | `test_bladeui.js` | [§9.419](../../docs/decisions/9.419.md) |
| 直すのは刃の載る位置＝スペーサー寸法だけ。**条幅の出方は変わらない**（面はクリアランスの半分ずつ） | `test_bladeui.js` | [§9.419](../../docs/decisions/9.419.md) |
| 端から端は**有効長ちょうど**。設定有効長と上下それぞれの合計長を差つきで出す | `test_bladeui.js` | [§9.418](../../docs/decisions/9.418.md) |
| 断面図の板のずれは**板厚1枚ぶん**（模式図と同じ量）。2倍ずらさない | `test_bladeui.js` | [§9.418](../../docs/decisions/9.418.md) |
| スペーサーの字は**軸の上・そのスペーサーの側**、ゴムリングの字は**輪の帯の中**（混ぜない） | `test_bladeui.js` | [§9.418](../../docs/decisions/9.418.md) |
| 引き出し線は**対象の縁から**引く（宙に浮かせない）。段は部材の種類ごとに分ける | `test_bladeui.js` | [§9.418](../../docs/decisions/9.418.md) |
| 網が打つ材料は**現場でよくある形**（50mm×22条・元板巾1130＝片耳15mm）。元板巾を先に打つ | `test_bladeui.js` | [§9.423](../../docs/decisions/9.423.md) |
| 図は**両の端で**確かめる（混んだ50mm×22条と、幅の広い279.8mm×4条）。片方だけで決めない | `test_bladeui.js` | [§9.418](../../docs/decisions/9.418.md)・[§9.423](../../docs/decisions/9.423.md) |
| 区間より長い積みを作らない（`fillWith`は切り下げ）。超えれば刃の位置が動く | `test_bladeui.js` | [§9.418](../../docs/decisions/9.418.md) |
| 図は丸めのせいで部材を落とさない（`PACK_EPS`）。端数は空けずに端数の色で置く | `test_bladeui.js` | [§9.418](../../docs/decisions/9.418.md) |
| 断面図に出てよいのは有効長と青い印まで。機械まわりの既定の行き先は`rig` | `test_bladeui.js` | [§9.418](../../docs/decisions/9.418.md) |
| 板の札は材料の帯の**条が寄っていない側**へ1行で。外へ出すとゴムリングに乗る | `test_bladeui.js` | [§9.418](../../docs/decisions/9.418.md) |
| 部材の幅はその部材の帯の中へ（輪の切り口は軸の上下2本の帯）。入る判定は横と縦の両方 | `test_bladeui.js` | [§9.418](../../docs/decisions/9.418.md) |
| 切断の破線は断面図だけ・1本（模式図は刃そのものが上下に並ぶ） | `test_bladeui.js` | [§9.418](../../docs/decisions/9.418.md) |
| 断面図の区間も`data-badge`と`.bs-bhit`を名乗る。連動も拡大図も**模式図の配線のまま** | `test_bladeui.js` | [§9.417](../../docs/decisions/9.417.md) |
| 断面図の的は2枚——区間ぜんたいは光るだけ、押せるのは記号の札だけ（回す道をふさがない） | `test_bladeui.js` | [§9.417](../../docs/decisions/9.417.md) |
| 図の札は枠を持たない（読み取り専用の値を押せる物に見せない）。部材の外へ置く | `test_bladeui.js` | [§9.417](../../docs/decisions/9.417.md) |
| 記号の印の塗り直しは「顔ぶれが変わったとき」だけ（回すたびに器を走査しない） | `test_bladeui.js` | [§9.417](../../docs/decisions/9.417.md) |
| 軸はスペーサーより暗い（刃→軸→スペーサーの3段）。隣り合う差は**2:1以上**——輝度で測る | `test_bladeui.js` | [§9.416](../../docs/decisions/9.416.md) |
| 断面図が模式図の色を借りるのは`cutColor()`の1箇所。立体図は機械の見た目のまま | `test_bladeui.js` | [§9.416](../../docs/decisions/9.416.md) |
| 光の配分は図ごとに別（断面図＝地明かり主役）。艶も落とす——正対した面は材質の色でなく光の色を返す | `test_bladeui.js` | [§9.415](../../docs/decisions/9.415.md) |
| 断面図の板・耳屑は**模式図と同じ色**（`--bs-fig-strip`／`--bs-fig-trim`）。明るい鋼色だと地に溶ける | `test_bladeui.js` | [§9.415](../../docs/decisions/9.415.md) |
| 器の大きさは`ResizeObserver`で見張る（`resize`は窓しか見ない）。図を離れるときも`applyCut()`を通す | `test_bladeui.js` | [§9.415](../../docs/decisions/9.415.md) |
| 模式図に描く「物」は**直角**。角丸を残すのは文字の器（`bs-bdgr`・`bs-chip-band`）だけ | `test_bladeui.js` | [§9.415](../../docs/decisions/9.415.md) |
| 図の札（DS/OS・上軸/下軸/材料）は**読み取る値（条番号・条幅）より大きくしない** | `test_bladeui.js` | [§9.415](../../docs/decisions/9.415.md) |
| 【§9.425で4段にした】台車差分の基準は「記録 → 標準構成 → 無し」の3段 | `test_bladeui.js` | [§9.415](../../docs/decisions/9.415.md) |
| 刃組の計算は`blade-core.js`（画面を知らない）、画面は`blade-view.js`の2本 | `test_bladeui.js` | [§9.377](../../docs/decisions/9.377.md) |
| 部材は設備ごと。「すべての設備」は受け付けない | `test_bladeset.py` | [§9.377](../../docs/decisions/9.377.md) |
| ゴムリングは色（＝外径）×幅で1本。同じ色をそろえるのは`ring_upsert()`の1箇所 | `test_bladeset.py` | [§9.377](../../docs/decisions/9.377.md) |
| 色名を外径から起こさない。周期は「名前の無い径」の言い換え | `test_bladeset.py` | [§9.377](../../docs/decisions/9.377.md) |
| 刃組基準値は「既定はコード・上書きだけがDB」。登録が無くても画面は開く | `test_bladeset.py` | [§9.377](../../docs/decisions/9.377.md) |
| 初期セットは足し算にならない（2度押しても増えない） | `test_bladeset.py` | [§9.377](../../docs/decisions/9.377.md) |
| 軸の寸法はスペーサーが作る。保持層（ゴムリング／フィンガー）は寸法に効かない | `test_bladeui.js` | [§9.377](../../docs/decisions/9.377.md) |
| フィンガー方式では押上げ・ニップの判定を出さない（0を出さない） | `test_bladeui.js` | [§9.377](../../docs/decisions/9.377.md) |
| 予定から運ぶのは「その行より後ろに並ぶ作業」。読めない項目は渡さない | `test_bladeui.js` | [§9.377](../../docs/decisions/9.377.md) |
| 立体図は模式図と**同じ`res`**から組む。両方が使う小道具は`blade-core.js`へ置く | `test_bladeui.js` | [§9.377](../../docs/decisions/9.377.md) |
| three.jsは同梱しない。読む先と版は`THREE_SRC`の1箇所、取りに行くのは**押したときだけ** | `test_bladeui.js` | [§9.377](../../docs/decisions/9.377.md) |
| 部品を読めない端末では**字で断る**。模式図はそのまま使える | `test_bladeui.js` | [§9.377](../../docs/decisions/9.377.md) |
| 段取りの順は`blockReason()`の1箇所。**進める手順が必ず1つ残る** | `test_bladeui.js` | [§9.377](../../docs/decisions/9.377.md) |
| 耳屑の幅は「耳」の字の真下へ積む。図の端で止める（はみ出さない） | `test_bladeui.js` | [§9.413](../../docs/decisions/9.413.md) |
| 区間を押すと拡大図。的は重ねるときと同じ区間ぜんたい、閉じる道は3つ | `test_bladeui.js` | [§9.413](../../docs/decisions/9.413.md) |
| 拡大図の字は部材の中に入れず、等間隔のスロットへ引き出してそろえる | `test_bladeui.js` | [§9.413](../../docs/decisions/9.413.md) |
| 部材の寸法は**丸めない**（`10.025`→`10.03` は在庫に無い別の部材の名前） | `test_bladeui.js` | [§9.413](../../docs/decisions/9.413.md) |
| 拡大図は押した区間の反対側の半分へ出す（押した区間を覆わない） | `test_bladeui.js` | [§9.413](../../docs/decisions/9.413.md) |
| 有効幅の境目の青い印は断面図にも出す（色も径も模式図と同じ）。立体図には出さない | `test_bladeui.js` | [§9.413](../../docs/decisions/9.413.md) |
| 視点を動かせるようにしたら**光も一緒に動かす**（止めると回した先が黒く、穴に見える） | `test_bladeui.js` | [§9.413](../../docs/decisions/9.413.md) |
| 拡大図の字は**器の幅で置き分ける**。入るものは中へ、入らないものだけ引き出す | `test_bladeui.js` | [§9.413](../../docs/decisions/9.413.md) |
| スロットは**外へ出すぶんだけ**で配る。1段に収まらないときは2段へ | `test_bladeui.js` | [§9.413](../../docs/decisions/9.413.md) |
| 順序で交差を防ぐなら、**渡す並びを x 順にしてから**配る | `test_bladeui.js` | [§9.413](../../docs/decisions/9.413.md) |
| 落としていないことは**足し算で見る**（中に書いた数＋引き出した数＝出すべき数） | `test_bladeui.js` | [§9.413](../../docs/decisions/9.413.md) |
| 誇張は**片側だけ入れない**。板を太らせたら上下軸も離す（でないと刃へめり込む） | `test_bladeui.js` | [§9.413](../../docs/decisions/9.413.md) |
| 刃先の隙間は見かけの板厚の5倍（`CUT_OPEN`）。板が占めるのは3倍ぶん | `test_bladeui.js` | [§9.413](../../docs/decisions/9.413.md) |
| 「めり込まない」は絵ではなく**組み立てている値**で見る（`cutGap`と`matSpan`） | `test_bladeui.js` | [§9.413](../../docs/decisions/9.413.md) |
| 拡大図のクリアランスは反対側の軸の刃を破線で添える。値は真の値 | `test_bladeui.js` | [§9.413](../../docs/decisions/9.413.md) |
| 断面図の板は**厚みを誇張する**（実寸では1pxも出ない）。倍率は字で言う | `test_bladeui.js` | [§9.413](../../docs/decisions/9.413.md) |
| `matShift()`は模式図の座標で答える。立体へ写すときは**Yの符号を返す** | `test_bladeui.js` | [§9.413](../../docs/decisions/9.413.md) |
| 板の札は軸の外へ出す（板と軸のあいだは実寸60mm弱しかない） | `test_bladeui.js` | [§9.413](../../docs/decisions/9.413.md) |
| 断面図は板幅の中心を起点に回せる。±1.15radで止め、寄る・引くは持たない | `test_bladeui.js` | [§9.413](../../docs/decisions/9.413.md) |
| 「視点を戻す」は段取りの群の外（断面図では段取りごと伏せる） | `test_bladeui.js` | [§9.413](../../docs/decisions/9.413.md) |
| `setPointerCapture`は掴めないと投げる。回すこと自体には要らない | `test_bladeui.js` | [§9.413](../../docs/decisions/9.413.md) |
| 刃組スケジュール一覧の行からも入れる（的は題名の横・道は`openRowLink()`の1本） | `test_bladeui.js` | [§9.408](../../docs/decisions/9.408.md) |
| 標準の条件（既定値・基準値・刃の選び方）は`blade-core.js`の1箇所。刃は**材料を当ててから選ぶ** | `test_bladeui.js` | [§9.408](../../docs/decisions/9.408.md) |
| 記録が無い段取りは標準の計算値を出し、**記録と見込みを字で書き分ける**（読めなければ計算しない） | `test_bladeui.js` | [§9.408](../../docs/decisions/9.408.md) |
| 断面図は台車を回さない（裏返すのはカメラ側だけ）。切り口は面を置いて塞ぐ | `test_bladeui.js` | [§9.412](../../docs/decisions/9.412.md) |
| 入口は段取りの行だけ。左メニューには置かない（文脈の無いまま開かせない） | `test_bladeui.js` | [§9.379](../../docs/decisions/9.379.md) |
| 刃の状態は3つ。既定は「一般」、「専用」は`刃選択マスタ`に当たったときだけ | `test_bladeset.py`・`test_bladeui.js` | [§9.379](../../docs/decisions/9.379.md) |
| 刃選択の条件は行ごとAND・最初に当たった1行。**条件が空の行は当たらない** | `test_bladeset.py`・`test_bladeui.js` | [§9.379](../../docs/decisions/9.379.md) |
| 選べる刃かの判定は`selectable()`の1箇所（外れるのは「メンテナンス中」だけ） | `test_bladeui.js` | [§9.379](../../docs/decisions/9.379.md) |
| フィンガーは板押さえ。上下軸と板のあいだ・板の両側へ描く（軸に被せない） | `test_bladeui.js` | [§9.379](../../docs/decisions/9.379.md) |
| 軸方向から見たフィンガーは幅×厚みの四角。研削は奥行きの面なので見えない | — | [§9.379](../../docs/decisions/9.379.md) |
| 端部（OS/DS）の表は右レール。図の段へ戻すと模式図が7割まで痩せる | `test_bladeui.js` | [§9.379](../../docs/decisions/9.379.md) |
| 模式図は器の横幅を使い切っている。`grow`では1pxも広がらない（器の側を削る） | `test_bladeui.js` | [§9.378](../../docs/decisions/9.378.md) |
| 板の場所を答えるのは`matBands()`の1箇所。押さえは**真下の条の面**へ当てる（外枠だと隙間が残る） | `test_bladeui.js` | [§9.385](../../docs/decisions/9.385.md) |
| 押さえの網は「外枠」で見ない。軸と**その条**のあいだに在るか・どの条にも食い込まないかで見る | `test_bladeui.js` | [§9.385](../../docs/decisions/9.385.md) |
| 刃組表の区分（ロット番号・条幅）は本文（`--tbl-fs`）より小さくしない | — | [§9.385](../../docs/decisions/9.385.md) |
| 図と表の連携の的は**区間ぜんたい**。記号の札だけにしない（実測27×29px→67×136px） | `test_bladeui.js` | [§9.386](../../docs/decisions/9.386.md) |
| SVGの図形の強調は`fill`／`stroke`／`fill-opacity`で書く。`background`／`border-color`は描かれない | `test_bladeui.js` | [§9.386](../../docs/decisions/9.386.md) |
| 透明な的には`pointer-events:all`を付ける（無いと素通りする） | `test_bladeui.js` | [§9.386](../../docs/decisions/9.386.md) |
| 刃組表の行の印は全行が持つ`.bs-bd`へ。`td:first-child`は`rowspan`で行ごとに変わる | — | [§9.386](../../docs/decisions/9.386.md) |
| 刃組は**1本目に切るコイル1本**で組む（`bladeSeedLots`）。次の刃組までの全ロットを同じ元板に混ぜない | `test_bladeui.js` | [§9.387](../../docs/decisions/9.387.md) |
| 組む単位（コイル1本）と数える単位（次の刃組までの本数・`bladeRunPlan`）は別。関数を分けたまま保つ | `test_bladeui.js` | [§9.387](../../docs/decisions/9.387.md) |
| 1本目が分割ありなら子ロットが条。子が読めないときは条にせず件数で言う | `test_bladeui.js` | [§9.387](../../docs/decisions/9.387.md) |
| 条の設計は必須。止めるのは**確定保存の1箇所**だけ（図・刃組表・所要は見せたまま） | `test_bladeui.js` | [§9.387](../../docs/decisions/9.387.md) |
| 条の設計が済んでいればその並びで開く（予定の写しで黙って上書きしない）。戻す道は記録を消さない | `test_bladeui.js` | [§9.387](../../docs/decisions/9.387.md) |
| 分割なしのコイルの幅・条数は**仕掛データの完全な行**から読む（写しには表に出していない列が無い） | `test_bladeui.js` | [§9.388](../../docs/decisions/9.388.md) |
| 完全な生データを取る口は`WL.split.lotRow`の1つ。判定は`bladeLotsFromSource`の純粋な関数へ切り出す | `test_bladeui.js` | [§9.388](../../docs/decisions/9.388.md) |
| 条数の範囲（1〜40）は測定画面の`defaultHorizontalCount`と同じにそろえる | `test_bladeui.js` | [§9.388](../../docs/decisions/9.388.md) |
| 取り直した値を当てないのは2つ——条の設計が記録済み／1本目が分割あり | `test_bladeui.js` | [§9.388](../../docs/decisions/9.388.md) |
| 向きの切り替えは刃組図の見出し。手順の窓の下に入るので、閉じてから押す | `test_bladeui.js` | [§9.380](../../docs/decisions/9.380.md) |
| フィンガーを当てる先は「いちばん外へ寄った板の面」（中心線だと寄った条へ食い込む） | `test_bladeui.js` | [§9.380](../../docs/decisions/9.380.md) |
| 刃選択の盤は「文として読める＋試し欄＋条件ごとの○×」。判定は`blade-core`を呼ぶ | `test_bladepick.js` | [§9.380](../../docs/decisions/9.380.md) |
| 設定の窓は触るたびに作り直さない。`input`で写し、描き直すのは他のカードだけ | `test_bladepick.js` | [§9.380](../../docs/decisions/9.380.md) |
| `normalize()`はサーバーの答えを選り分けない。足した鍵はここにも書く | `test_bladeui.js` | [§9.381](../../docs/decisions/9.381.md) |
| 条の設計は決めたその場で記録できる。状態は未記録／記録済み／記録と違うの3つ | `test_bladeui.js` | [§9.381](../../docs/decisions/9.381.md) |
| 刃組の確定保存は1件に全部載せる（台車・刃・部材・設定・予定本数・1本目の材料） | `test_bladeui.js` | [§9.382](../../docs/decisions/9.382.md) |
| 予定本数はコイルの本数（条では数えない）。範囲は次の刃組まで | `test_bladeui.js` | [§9.382](../../docs/decisions/9.382.md) |
| 刃組スケジュール一覧は記録と予定を`stopId`で結ぶ。未記録は字で書く | `test_bladeui.js` | [§9.383](../../docs/decisions/9.383.md) |
| 部材の並びは大きい寸法から。「種類×数」と「何種・何本」の両方を言う | `test_bladeui.js` | [§9.383](../../docs/decisions/9.383.md) |
