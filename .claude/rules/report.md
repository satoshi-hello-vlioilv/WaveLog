# 帳票と紙（96件）

索引: [規則の置き場](README.md)｜入口: [CLAUDE.md](../../CLAUDE.md)

`print-core.js`・帳票ブロック／レイアウト・用紙と余白

行は**守ることだけ**を書いてある。なぜそうなのか・実測値・撤回した案・踏んだ罠は
「くわしく」の先（[`docs/decisions/`](../../docs/decisions/README.md)）にある。
**直す前にその先を開くこと。**「固定する網」は `tests/run_all.sh <名前>` で回す。

| 守ること | 固定する網 | くわしく |
| --- | --- | --- |
| 段組の答えは`WL.recordLayout.plan()`の1箇所（1件＝段×横24マス・既定2段・最大4段）。操業データ表の紙と測定実績の一覧の段組が同じ答えを読む | `test_recordlayout.js`・`test_opsheet.js` | [§9.553](../../docs/decisions/9.553.md) |
| 配置は列レイアウトマスタの`places`。書くのは配置の盤だけ（全置換の保存は送らない＝`OWNED_ELSEWHERE`）。盤の寸法はサーバーの`PLACE_*`と同じ | `test_recordlayout.js` | [§9.553](../../docs/decisions/9.553.md) |
| 盤に入らない・重なった項目は名指す（黙って落とさない）。押し出しで**新しく**あふれるときだけ断る。最初の1手で今の見た目を固める | `test_recordlayout.js` | [§9.553](../../docs/decisions/9.553.md) |
| 画面をそのまま刷るのは`printScreen()`（器を画面の大きさに止め、比を保って1枚へ・WebGLは絵へ）。段取りは`runPrint()`の1箇所 | `test_screenprint.js` | [§9.525](../../docs/decisions/9.525.md) |
| 紙は画面で開いている子ロットを出す。載せるかどうかを決めるのは`buildPages`の1箇所 | `test_scprint.js` | [§9.357](../../docs/decisions/9.357.md) |
| 丈別データの外観・巻ズレは**中身のある列だけ**出す。列幅は出す列だけで100%に配り直す | `test_rpblocks.js` | [§9.393](../../docs/decisions/9.393.md) |
| 設備で外した入力内容は紙からも落とす。**値があれば出す**。判定は`rpItemOff()`の1箇所 | `test_rpblocks.js` | [§9.395](../../docs/decisions/9.395.md) |
| 種を持つ塊（`測定条件`等）は**コードへ行を足しても紙が変わらない**。足す先は道（`calc.*`） | `test_rpblocks.js` | [§9.395](../../docs/decisions/9.395.md) |
| 紙まわり（用紙・`@page`・mm換算・列幅の配分・刷り出し）は`print-core.js`の1本 | `test_printcore.py` | [§9.332](../../docs/decisions/9.332.md) |
| ピッチ判定・異常位置判定の欄の見せ方は利用者が選べる | `test_rpdefect.js` | [§9.323](../../docs/decisions/9.323-1.md) |
| 作業予定表の印刷は「紙のための別の割り付け」 | `test_scprint.js` | [§9.115](../../docs/decisions/9.115.md) |
| 区切りの行間は「日付が変わる行」に効く | — | [§9.295](../../docs/decisions/9.295.md) |
| マスの持ちものを紙へ運ぶ口は`rpCellTuple()`の1つ。1つも落とさない | — | [§9.296](../../docs/decisions/9.296.md) |
| 行・列を「最大」で出せる。既定は「その塊の今までの出し方」 | `test_rbsample.js`・`test_rpblocks.js` | [§9.132](../../docs/decisions/9.132.md) |
| 紙ぜんたいの余白を選べる。詰める段は「溢れたときだけ」動く | `test_rpblocks.js` | [§9.163](../../docs/decisions/9.163.md) |
| 書き下ろしは「1つの並び」で測る。2つを混ぜると塊が重なる | `test_rplayout.js` | [§9.163](../../docs/decisions/9.163.md) |
| 書き戻してよい高さは「利用者が決めた高さ」だけ | — | [§9.174](../../docs/decisions/9.174.md) |
| 紙の余白は「横」と「縦」の別の軸。横は文字の表示領域を広げる | `test_rpblocks.js` | [§9.294](../../docs/decisions/9.294.md) |
| 数で決まる設定は「− 数 ＋」の1組。値ごとに札を並べない | `test_blockbuild.js`・`test_rbmodal.js` | [§9.247](../../docs/decisions/9.247.md) |
| 書き下ろし（`rpSeedPositions`）が書くのは「置き場所」だけ | `test_csslint.py`・`test_rplayout.js` | [§9.222](../../docs/decisions/9.222.md) |
| 縁を引くとき、重なっても縮めない | — | [§9.223](../../docs/decisions/9.223.md) |
| 紙の文字は太字にできる。既定の大きさは「大」 | — | [§9.294](../../docs/decisions/9.294.md) |
| 紙の列は画面の列。印刷専用の列を既定で足さない | — | [§9.293](../../docs/decisions/9.293.md) |
| 幅と文字は別の答え。文字は幅の圧縮に引きずられない | — | [§9.293](../../docs/decisions/9.293.md) |
| 印刷プレビューの設定は3段（タブ）＋足元の要約 | — | [§9.293](../../docs/decisions/9.293.md) |
| 印刷範囲は「日付」か「選んだ予定」で絞る。日付は打たせない | `test_scprint.js` | [§9.292](../../docs/decisions/9.292.md) |
| 帳票のマスは「ラベルを上下」にできる。印はマスが持つ | — | [§9.292](../../docs/decisions/9.292.md) |
| 帳票の表は「縮める前に余白を詰める」 | `test_rpblocks.js` | [§9.132](../../docs/decisions/9.132.md) |
| 帳票の半自動の塊も、渡していない設定は消えない | — | [§9.320](../../docs/decisions/9.320.md) |
| 紙の測定データ・丈別データの表は本文と同じ大きさ | — | [§9.320](../../docs/decisions/9.320.md) |
| 異常位置判定は、ピッチだけでも保存できる | `test_defectlink.js` | [§9.319](../../docs/decisions/9.319.md) |
| 紙の「異常位置判定」と「ピッチ判定」は別の塊 | `test_rpdefect.js` | [§9.319](../../docs/decisions/9.319.md) |
| 保存の往復のあいだに触ったぶんを捨てない | `test_rpsave.js` | [§9.263](../../docs/decisions/9.263.md) |
| 紙の余白は「紙の軸 × 塊の段」の掛け算。フォールバックで代用させない | `test_rppack.js` | [§9.289](../../docs/decisions/9.289.md) |
| 紙の配置は「触ったら裏で保存」。保存ボタンは持たない | `test_rpblocks.js` | [§9.113](../../docs/decisions/9.113.md) |
| 盤のマスの高さは実測して入れる | `test_rbmodal.js` | [§9.210](../../docs/decisions/9.210.md) |
| 「印刷」は画面ごとに1つ。判定は画面が登録で名乗る | — | [§9.233](../../docs/decisions/9.233.md) |
| 紙にだけ`print-color-adjust:exact`を付ける。説明を先に書かない | `test_rbsample.js`・`test_rpprint.js` | [§9.290](../../docs/decisions/9.290.md) |
| 帳票印刷の列は「紙専用の選び直し」を持たず、画面（`timeline:<設備>`）をそのまま使う | `test_scprint.js` | [§9.235](../../docs/decisions/9.235.md) |
| 帳票ブロックの中身は「セル」で持つ。並びに載せずに「出す」は作れない | `test_rbcells.js`・`test_rbcells.py` | [§9.274](../../docs/decisions/9.274.md) |
| 帳票ブロックの道は「記録の中の本当の置き場」を答える | — | [§9.285](../../docs/decisions/9.285.md) |
| 帳票の書式へ渡すのは「地方時へ直した値」。生のISOを渡さない | `test_rbcatalog.js` | [§9.285](../../docs/decisions/9.285.md) |
| 節の列数は`--rp-cols`が1本で運ぶ。クラスへ数を焼き込まない | `test_rpprint.js` | [§9.289](../../docs/decisions/9.289.md) |
| 帳票プレビューは用紙の切れ目を出す。物差しは紙の「幅」から作る | `test_csslint.py`・`test_rpprint.js` | [§9.281](../../docs/decisions/9.281.md) |
| 組み換え中も紙を割る。行を数えるのは`rpRowAtGrid()`の1箇所 | `test_rplayout.js`・`test_rpprint.js` | [§9.282](../../docs/decisions/9.282.md) |
| 組み換え中は紙をまたぐ塊を切らない。`clip-path`は当たり判定まで切る | — | [§9.283](../../docs/decisions/9.283.md) |
| ずらし量は測って答える。控えない | — | [§9.283](../../docs/decisions/9.283.md) |
| 「行の頭」と「その点を含む行」は別の関数 | — | [§9.283](../../docs/decisions/9.283.md) |
| 大きさを変える取っ手は四辺＋四隅の8方向 | — | [§9.283](../../docs/decisions/9.283.md) |
| 塊は名前が鍵。既定の塊と同じ名前の行を作らせない | — | [§9.282](../../docs/decisions/9.282.md) |
| 「中の並べ方」は表（ピボット）には当てない | `test_rbcells.py`・`test_rpmaster.js` | [§9.282](../../docs/decisions/9.282.md) |
| 盤で組んだマスの並びがあれば、それが紙の正 | — | [§9.278](../../docs/decisions/9.278.md) |
| 帳票ブロックの窓の見本は「紙と同じ組み立て」で描く | — | [§9.278](../../docs/decisions/9.278.md) |
| 大きさは「既定」だと欄の名前で言い切る | — | [§9.278](../../docs/decisions/9.278.md) |
| 表は「ピボット」で組む。軸は名前と値だけを持ち、置き場は盤が決める | `test_rbcells.js`・`test_rbcells.py`・`test_rpprint.js` | [§9.277](../../docs/decisions/9.277.md) |
| 帳票は「レイアウト（親）＋ブロック（子）」の2枚のマスタで持つ | `test_rlmaster.js` | [§9.254](../../docs/decisions/9.254.md) |
| 見本のロット1件で帳票を確かめる | `test_rbsample.js` | [§9.253](../../docs/decisions/9.253.md) |
| 用紙は「大きさ」と「向き」を分けて選ぶ。A4/B4/A3×縦/横 | `test_opsheet.js`・`test_scprint.js` | [§9.252](../../docs/decisions/9.252.md) |
| 用紙サイズ・向きはA4/A3×縦/横から選べる | — | [§9.235](../../docs/decisions/9.235.md) |
| 分割後の子ロットの情報は印刷ON/OFFでき、親子は同じ塊として改ページする | — | [§9.235](../../docs/decisions/9.235.md) |
| 「すべての設備を続けて印刷する」は成り代わって解く | — | [§9.235](../../docs/decisions/9.235.md) |
| 印刷プレビューの倍率は「見え方」で、メニューは「決める理由」で分ける | `test_scprint.js` | [§9.238](../../docs/decisions/9.238.md) |
| 帳票の配置は設備を選んで編集できる。紙は1枚ずつその設備で固定する | — | [§9.239](../../docs/decisions/9.239.md) |
| 帳票の「出していない塊」は左サイドバー（`.rp-nav`）に縦で置く | — | [§9.276](../../docs/decisions/9.276.md) |
| 紙の見本は四方から掴んで大きさを変えられる。ただし選べる値にしか止まらない | — | [§9.250](../../docs/decisions/9.250.md) |
| ダミーの値はサーバーが持つ | — | [§9.250](../../docs/decisions/9.250.md) |
| 帳票ブロックの編集窓は「4つの束＋紙の見本」 | `test_rbmodal.js` | [§9.249](../../docs/decisions/9.249.md) |
| 帳票の塊は子ロットごとに繰り返せる | `test_rpprint.js` | [§9.247](../../docs/decisions/9.247.md) |
| 印刷の合図は2つ持ってよいが、刷るのは1回だけ | `test_rpprint.js` | [§9.247](../../docs/decisions/9.247.md) |
| 同じ指摘が2度来たら、入れた機能ではなく既定を疑う | `test_rpprint.js` | [§9.248](../../docs/decisions/9.248.md) |
| 列ごとの並べ替えは「塊(bucket)」で持つ | — | [§9.187](../../docs/decisions/9.187.md) |
| コメントは「枠を置いてから書く」 | `test_sccomment.js`・`test_scprint.js` | [§9.191](../../docs/decisions/9.191.md) |
| 印刷はプレビューを先に出す | — | [§9.186](../../docs/decisions/9.186.md) |
| 測定データの表は「列の集まり」で持つ | `test_rpblocks.js` | [§9.173](../../docs/decisions/9.173.md) |
| 帳票の見せ方は設備ごとに覚える | `test_rpblocks.js` | [§9.174](../../docs/decisions/9.174.md) |
| 帳票の中身は「塊（ブロック）の並び」 | `test_rpblocks.js` | [§9.169](../../docs/decisions/9.169.md) |
| 帳票の空きマスはグリッドの中へ入れない | `test_rplayout.js` | [§9.218](../../docs/decisions/9.218.md) |
| 帳票の頭は「設備名・作業年月日・ロット番号」を同じ大きさで横に並べる | — | [§9.161](../../docs/decisions/9.161.md) |
| 操作列は1行に収める。畳んだ先の設定はボタンに書く | `test_scbar.js` | [§9.199](../../docs/decisions/9.199.md) |
| 帳票の`formats`へ文字列を入れないこと | `test_rpblocks.js` | [§9.205](../../docs/decisions/9.205.md) |
| 紙の上の座標は「拡大前」へ直してから測る | — | [§9.222](../../docs/decisions/9.222.md) |
| `widths`へ「数」を入れるのは掛け算ではなく足し算 | — | [§9.222](../../docs/decisions/9.222.md) |
| 「中身なり」の塊に高さを書き込まない | — | [§9.222](../../docs/decisions/9.222.md) |
| 断りの一言は「見えるところ」に出す | — | [§9.222](../../docs/decisions/9.222.md) |
| 大きさを変えても場所は動かさない | — | [§9.222](../../docs/decisions/9.222.md) |
| 帳票に「エリア（枠と文字）」の塊を足せる／枠は付け外しできる | `test_rpblocks.js` | [§9.234](../../docs/decisions/9.234.md) |
| 帳票カードの中の並べ方はCSSだけで組む | — | [§9.226](../../docs/decisions/9.226.md) |
| 帳票の塊は「選んで組み立てる」 | `test_blockbuild.js` | [§9.226](../../docs/decisions/9.226.md) |
| 帳票の編集中の見た目は刷り上がりそのまま | `test_rpblocks.js`・`test_rplayout.js` | [§9.223](../../docs/decisions/9.223.md) |
| 帳票の塊は「置きたいマスへ置く」 | `test_rpblocks.js`・`test_rplayout.js` | [§9.221](../../docs/decisions/9.221.md) |
| `widths`へ「数」を入れるときの倍率は、いちばん大きい数から決める | — | [§9.221](../../docs/decisions/9.221.md) |
| 帳票の紙の箱は、刷るときもプレビューと同じ | `test_rpprint.js` | [§9.242](../../docs/decisions/9.242.md) |
| 帳票の中の枠を器いっぱいへ伸ばすのは「高さを決めた塊」だけ | — | [§9.242](../../docs/decisions/9.242.md) |
| 盤の「見えている塊」と保存される並びを食い違わせない | `test_reclayout.js` | [§9.243](../../docs/decisions/9.243.md) |
| 紙に出すのは「帳票だけの1枚もの」 | `test_rpprint.js` | [§9.244](../../docs/decisions/9.244.md) |
| 帳票ブロックの中身はマトリクスで並べられる | `test_blockbuild.js` | [§9.245](../../docs/decisions/9.245.md) |
