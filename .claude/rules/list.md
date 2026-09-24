# 一覧と列（138件）

索引: [規則の置き場](README.md)｜入口: [CLAUDE.md](../../CLAUDE.md)

`list-view.js`・列レイアウトマスタ・フィルタ・仮想行

行は**守ることだけ**を書いてある。なぜそうなのか・実測値・撤回した案・踏んだ罠は
「くわしく」の先（[`docs/decisions/`](../../docs/decisions/README.md)）にある。
**直す前にその先を開くこと。**「固定する網」は `tests/run_all.sh <名前>` で回す。

| 守ること | 固定する網 | くわしく |
| --- | --- | --- |
| 「☰ 表示」は**表示列の編集がいちばん上・主ボタン**（アイコン）。下の行は字も欄も1つの大きさ | `test_listbar.js` | [§9.476](../../docs/decisions/9.476.md) |
| 表示列の入口はどの画面でも`fa-table-columns`の印。パネルの規則は`.lt-view-panel`で名乗る | `test_listbar.js` | [§9.476](../../docs/decisions/9.476.md) |
| 表示ルールの左辺が式なら`formula`（式が真なら）。比べ方と右辺は出さない | `test_colrule.js`・`test_displayrule.py` | [§9.474](../../docs/decisions/9.474.md) |
| 条件が見る列の値は**ルールごと**（元のデータ／表示の値）。答えは`WL.cellFormat.ruleRow()`の1箇所 | `test_colrule.js` | [§9.474](../../docs/decisions/9.474.md) |
| 列の見え方は画面が`view`で渡す（key/calc/raw/format/rule）。**式の列は元のデータでも式の結果** | `test_colrule.js` | [§9.474](../../docs/decisions/9.474.md) |
| ルール→式は`WL.displayRules.toFormula()`の1箇所（評価と同じ意味）。式にできない物は`notes`で言う | `test_colrule.js` | [§9.474](../../docs/decisions/9.474.md) |
| 表示ルールの比べ方は式の`cmp()`の1本（数を緩く読む）。判定も変換した式もこれを通す | `test_colrule.js`・`test_formula.js` | [§9.477](../../docs/decisions/9.477.md) |
| 式の候補は`WL.formula.suggest()`の1つ（焦点は入力欄のまま）。関数の顔ぶれは`sigs` | `test_formula.js`・`test_colrule.js` | [§9.474](../../docs/decisions/9.474.md) |
| 表示ルールの窓は2ペイン（左3割＝試した結果）。条件は同じ格子で、高さは`--ctl-h-sm` | `test_colrule.js` | [§9.474](../../docs/decisions/9.474.md) |
| 一覧の帯は**2段**（1段目＝すぐ使う操作・2段目＝常に見る状態）。決めたら触らない設定は「☰ 表示」のパネル | `test_listbar.js` | [§9.468](../../docs/decisions/9.468.md) |
| 開いた絞り込みの窓は**その場で閉じる**（✕・Escはバーぜんたい・同時に1つ）。開いたら押せる最初の欄へ焦点 | `test_filter.js` | [§9.468](../../docs/decisions/9.468.md) |
| **1回のEscで閉じるのは1枚**。閉じた層は`preventDefault`で名乗り、外側は`defaultPrevented`で止まる | `test_listbar.js`・`test_dbequip.js` | [§9.471](../../docs/decisions/9.471.md) |
| 網が表示列・表示件数・並びを触るときは`W.listView(page)`で「☰ 表示」を開いてから（人と同じ道） | `test_listbar.js` | [§9.468](../../docs/decisions/9.468.md) |
| 名前→列は`WL.columnLayout.keyByName()`の1箇所（元の名前→表示名→別名）。表示名を付けても元の名前で引ける | `test_colrule.js`・`test_sctimecols.js` | [§9.464](../../docs/decisions/9.464.md) |
| 文字列の抽出・変換は`WL.formula`の関数（mid・extract・replace…）。正規表現は書いている最中に断る | `test_formula.js` | [§9.464](../../docs/decisions/9.464.md) |
| 条件の片側に式（`kind:'calc'`）、表示値は`=`で始めると式。式が見る列も`columnsUsed()`に数える | `test_colrule.js`・`test_displayrule.py` | [§9.464](../../docs/decisions/9.464.md) |
| 屑幅の式は`WL.split.scrapWidths()`の1箇所（片耳＝両耳合計÷2）。読めない値は`null`で0にしない | `test_scscrap.js` | [§9.389](../../docs/decisions/9.389.md) |
| スケジュールの固定列は`SC_COL_BEFORE`／`SC_COL_AFTER`のどちらかに必ず載せる（載せ忘れると選べない列になる） | `test_scscrap.js` | [§9.389](../../docs/decisions/9.389.md) |
| 一覧を描き直すときはスクロール位置を`renderGrid()`の入口で控える（戻すのは並べ終えてから） | `test_scpick.js` | [§9.357](../../docs/decisions/9.357.md) |
| 仕掛一覧から伏せるロットは`WL.scheduleView.hiddenLotSet()`の1箇所が答える | `test_wipgone.js` | [§9.368](../../docs/decisions/9.368.md) |
| 一覧のJS（`list-view.js`）は閉じてある。外から呼ぶのは`WL.list`の17個。`typeof`の判定も名前空間で書く | `test_eslint.py` | [§9.355](../../docs/decisions/9.355.md) |
| 条件を足す入口はボタン。検索欄の顔をした器を同時に2つ出さない | `test_filter.js` | [§9.345](../../docs/decisions/9.345.md) |
| 読み込みの秒数は**遅いときだけ**出す。「遅い」の答えは`WL.slowLoadMs`の1箇所。チップを消しても内訳の入口は残す | `test_listcache.js` | [§9.340](../../docs/decisions/9.340.md) |
| 関数の定義は1箇所 | `test_patchlint.py` | [§9.96](../../docs/decisions/9.96.md) |
| どの列を出すかはサーバーが決めない | — | [§9.165](../../docs/decisions/9.165.md) |
| 一覧の描画で「ブラウザに測らせない・一度に渡さない」 | `test_listperf.js` | [§9.94](../../docs/decisions/9.94.md) |
| 一覧は「横に見えている列」しか本文を作らない | `test_listperf.js` | [§9.104](../../docs/decisions/9.104.md) |
| `#grid th`の`position:sticky`を詳細度で打ち消さないこと | `test_gridhead.js` | [§9.104](../../docs/decisions/9.104.md) |
| 一覧の見せ方（`列レイアウトマスタ`／`一覧表示設定マスタ`）は全置換 | `test_colformat.js`・`test_collayout.js`・`test_colrule.js`・`test_colsort.js`・`test_displayrule.py` | [§9.88](../../docs/decisions/9.88.md) |
| 列の見せ方は「みんなと同じ／自分だけ」を一覧ごと・人ごとに選べる | `test_colscope.py`・`test_colscopeui.js` | [§9.259](../../docs/decisions/9.259.md) |
| 列の設定パネルは触った結果をそのまま一覧へ出す | `test_lcpanel.js` | [§9.90](../../docs/decisions/9.90.md) |
| 見出し側の操作も`WL.listColumnKeys()`の1本の並びで保存する | `test_collayout.js` | [§9.110](../../docs/decisions/9.110.md) |
| 列は名前で引くので、同じ名前を2つ並べない | — | [§9.113](../../docs/decisions/9.113.md) |
| 列マスタの保存は全置換なので、渡す設定を1つでも書き漏らさない | — | [§9.113](../../docs/decisions/9.113.md) |
| 式で作る列に`eval`を使わないこと | `test_formula.js` | [§9.111](../../docs/decisions/9.111.md) |
| 列の設定パネルは「出どころ」で分類する | `test_lcpanel.js` | [§9.105](../../docs/decisions/9.105.md) |
| 番号・ボタンの列も「出す/出さない」に従う | — | [§9.105](../../docs/decisions/9.105.md) |
| マスタ管理のタブは「いつの分の応答か」で描く | `test_mmswitch.js` | [§9.331](../../docs/decisions/9.331.md) |
| 画面の共有状態`S`の鍵は`base.js`の1つのリテラルだけが決める。`Object.seal(S)`で後付けを断る | `test_globallint.py` | [§9.327](../../docs/decisions/9.327.md) |
| 列の設定パネルは差し替え口で使い回す | `test_sccontent.js` | [§9.120](../../docs/decisions/9.120.md) |
| 列幅は「自動／手動／固定」の3つ | `test_collayout.js` | [§9.119](../../docs/decisions/9.119.md) |
| 紙の列幅を測るときは「作業以外の行も束ねない形で」測る | — | [§9.296](../../docs/decisions/9.296.md) |
| リンクマスタの盤は「左＝まとまりの入れ物／右＝親子の木」 | `test_choicelinkui.js` | [§9.197](../../docs/decisions/9.197.md) |
| 親を選ぶと子の候補が絞られる。絞り込みの表はサーバーが答える | `test_choicelink.py`・`test_opparent.js` | [§9.163](../../docs/decisions/9.163.md) |
| 仮想行の先取りは「画面の高さ」から決める | `test_allrows.js` | [§9.94](../../docs/decisions/9.94.md) |
| 一覧の文字は`--tbl-fs`。画面ごとに散らさない | — | [§9.296](../../docs/decisions/9.296.md) |
| 紙の列の幅は「実際に刷る文字」から決められる | — | [§9.294](../../docs/decisions/9.294.md) |
| 紙の文字は「文字が切れない限界」まで。余白は列の幅の一部 | — | [§9.293](../../docs/decisions/9.293.md) |
| 一覧の下の余白は測って決める。空けた場所には役目を持たせる | `test_scbar.js` | [§9.292](../../docs/decisions/9.292.md) |
| 窓は先に出してから中身を組み立てる。`initialHidden`の`null`は「保存値が正」 | `test_actuals.js` | [§9.292](../../docs/decisions/9.292.md) |
| 紙の文字は「余っているぶんだけ大きく」。幅と文字は必ず同じ比率で動かす | — | [§9.292](../../docs/decisions/9.292.md) |
| 一覧を広く使う印は`body.sc-wide`の1つ。戻る道は必ず1つ見えている | `test_scbar.js` | [§9.292](../../docs/decisions/9.292.md) |
| 後から足した列を「無ければ足す」のは`db_access.add_missing_columns()`の1箇所 | `test_ddllint.py` | [§9.216](../../docs/decisions/9.216.md) |
| ピッチ判定の塊は器の幅で段を切り替える | `test_rptext.js` | [§9.320](../../docs/decisions/9.320.md) |
| 使用設備は`WL.equipment`が1箇所で書き、変わったら知らせる | `test_dbequip.js` | [§9.285](../../docs/decisions/9.285.md) |
| 仕掛の生の列は`source.<列名>`。「まとめて1つの鍵」の入れ物は`.`で割らない | — | [§9.285](../../docs/decisions/9.285.md) |
| 「内訳の列数」が空のときは、マスの並びから列数を当てる | — | [§9.279](../../docs/decisions/9.279.md) |
| 選ばせる札が3段に折れると窓が画面より高くなる | `test_rollwipe.js` | [§9.255](../../docs/decisions/9.255.md) |
| 子ロットの折りたたみバッジは列を選べる。既定はロット番号 | `test_scbar.js`・`test_scprint.js` | [§9.235](../../docs/decisions/9.235.md) |
| 印刷は「画面のさわやかな見た目」に寄せる: 枠線ON/OFF・列の範囲・幅は自然体 | `test_scprint.js` | [§9.236](../../docs/decisions/9.236.md) |
| 予定から外す受け皿は掴んでいる間だけ出す | `test_scdrop.js` | [§9.116](../../docs/decisions/9.116.md) |
| その場フィルタは登録もトークン化もしない | `test_adhoc.js` | [§9.238](../../docs/decisions/9.238.md) |
| 並びに載っている列は全部掴める。幅の下限をCSSで持たない | — | [§9.239](../../docs/decisions/9.239.md) |
| 子ロットは畳んでいる間DOMを作らない | `test_gridchild.js` | [§9.239](../../docs/decisions/9.239.md) |
| 表の揃えは`WL.columnAlign`の1箇所が答える | — | [§9.239](../../docs/decisions/9.239.md) |
| 専用の画面（`special:*`）を汎用の描き直しで潰さない | — | [§9.276](../../docs/decisions/9.276.md) |
| 説明文に生のHTMLタグを書かない。長い説明は畳んで階層にする | `test_hintlint.py` | [§9.276](../../docs/decisions/9.276.md) |
| 【§9.299で組み直した】操業データ項目の設定窓は「見本の帯＋3列」 | — | [§9.288](../../docs/decisions/9.288.md) |
| 一覧の道具（`#grid`・`#tabs`・`#genericFilterBar`・`#listToolbar`）を伏せるのは`90-state.css`の`:is()`1本 | `test_actuals.js` | [§9.288](../../docs/decisions/9.288.md) |
| 実績データの列は「帳票と同じ候補」から作る | — | [§9.288](../../docs/decisions/9.288.md) |
| Excelの読み書きは`backend/xlsx_io.py`の1箇所。依存を足さない | `test_rollio.py` | [§9.240](../../docs/decisions/9.240.md) |
| マスタ一覧はカテゴリごとに畳め、移行済みは消せる | — | [§9.250](../../docs/decisions/9.250.md) |
| マスタの表は並べ替え・列幅調整できる。道具は`WL.columnWidthGrip`を使い回す | — | [§9.250](../../docs/decisions/9.250.md) |
| 決めることが多い編集窓は段（タブ）に分ける | — | [§9.250](../../docs/decisions/9.250.md) |
| 専用タブを持たないマスタもマスタ管理の階層で編集する | `test_rawmaster.py` | [§9.249](../../docs/decisions/9.249.md) |
| 足した選ばせ方は`メニュー`と`切替`。`一覧`と同じ顔にしない | — | [§9.247](../../docs/decisions/9.247.md) |
| 列の並びは「描くときに絞り、保存するときは絞らない」 | `test_colkeep.js` | [§9.248](../../docs/decisions/9.248.md) |
| 列の絞り込みは「出どころ」と「表示中/非表示中」の2軸 | — | [§9.248](../../docs/decisions/9.248.md) |
| 選ばせ方は束ねて出す。語彙はサーバーが持つ | — | [§9.248](../../docs/decisions/9.248.md) |
| 見せる範囲は「実施した設備」で絞る。設備の無い記録は隠さない | `test_eqscope.js` | [§9.248](../../docs/decisions/9.248.md) |
| まとめて入れる／まとめて外すは対で持つ | `test_scpick.js` | [§9.170](../../docs/decisions/9.170.md) |
| フィルタの持ち出し・取り込みは「フィルタだけ」 | `test_filterio.js` | [§9.171](../../docs/decisions/9.171.md) |
| 適用中のフィルタは端末に覚える | `test_filteractive.js` | [§9.175](../../docs/decisions/9.175.md) |
| 登録一覧は「組み合わせごとの節」。作るのは2手（選ぶ→名前を付ける） | `test_filtergroup.js` | [§9.287](../../docs/decisions/9.287.md) |
| 【主動線は§9.287で作り替えた】群＝プリセットの入れ物 | — | [§9.287](../../docs/decisions/9.287.md) |
| ページめくりは一覧ツールバーが持つ | — | [§9.286](../../docs/decisions/9.286.md) |
| スケジュール表の列も全部が列レイアウトマスタに乗る | `test_sctimecols.js` | [§9.176](../../docs/decisions/9.176.md) |
| 列の設定もファイルへ持ち出せる | `test_colio.js` | [§9.178](../../docs/decisions/9.178.md) |
| 開いたときの表示と、カーソル位置への追加 | `test_scinsert.js` | [§9.179](../../docs/decisions/9.179.md) |
| 開く前に用意し、見えないものは作らない | `test_scwarm.js` | [§9.182](../../docs/decisions/9.182.md) |
| 「いつも適用（固定）」は1つの印 | `test_filterlock.js` | [§9.190](../../docs/decisions/9.190.md) |
| 鍵付き・デフォルトのフィルタは「当てる前に取る」 | `test_filterkeep.js` | [§9.184](../../docs/decisions/9.184.md) |
| フィルタは個人のもの／共有のものを分けて持つ | `test_filteruser.js` | [§9.172](../../docs/decisions/9.172.md) |
| 読み替えルールの編集は「書いた本人が確かめられる」ことが要件 | `test_colrule.js` | [§9.117](../../docs/decisions/9.117.md) |
| 丈の表の列幅は見出しではなく中身から配る | — | [§9.160](../../docs/decisions/9.160.md) |
| データ一覧も表の規格に載せる | — | [§9.161](../../docs/decisions/9.161.md) |
| データ一覧の表示列は仕掛一覧と同じパネルを流用する | `test_reccols.js` | [§9.162](../../docs/decisions/9.162.md) |
| 「この設定でできること」はサーバーの1箇所が答える | `test_dscap.py` | [§9.163](../../docs/decisions/9.163.md) |
| 見出しの操作（列幅・右クリック）は1つの道具を使い回す | — | [§9.164](../../docs/decisions/9.164.md) |
| クエリ結合は`クエリ結合マスタ`の1行、実処理は`backend/query_join.py`の1箇所 | `test_qjoin.py`・`test_qjoinui.js` | [§9.193](../../docs/decisions/9.193.md) |
| 突合の定義は`クエリ結合マスタ`の1行。用途で使いみちを分ける | `test_finishjoin.py`・`test_qjoinui.js` | [§9.365](../../docs/decisions/9.365.md) |
| 利用者が入れた設定を「保存されていない既定」にしない | `test_finishjoin.py`・`test_qjoinui.js` | [§9.367](../../docs/decisions/9.367.md) |
| 完了突合は登録された行だけが効く。無ければ変換しない | `test_finishjoin.py`・`test_actualmatch.py` | [§9.367](../../docs/decisions/9.367.md) |
| スケジュール表で使う結合は選べる。保存値は「使わない」側 | `test_finishjoin.py` | [§9.365](../../docs/decisions/9.365.md) |
| 結合の仕方は「3つの真偽値」で持つ | `test_qjoin.py`・`test_qjoinui.js` | [§9.194](../../docs/decisions/9.194.md) |
| 突合キーは両側の列を並べて結ぶ | `test_qjoinui.js` | [§9.197](../../docs/decisions/9.197.md) |
| 表の列の区切りは「隙間の中」へ引く | — | [§9.197](../../docs/decisions/9.197.md) |
| 列幅は「掴んでいる間と離してから0.3秒」邪魔しない | `test_sctimecols.js` | [§9.197](../../docs/decisions/9.197.md) |
| 列の設定は掴むたびに`get()`で取り直す | — | [§9.211](../../docs/decisions/9.211.md) |
| 列幅を掴んでいる間の描き直しは`WL.columnResize.defer()`へ預ける | — | [§9.211](../../docs/decisions/9.211.md) |
| `WL.columnLayout`は3枚の重ね | `test_sctimecols.js` | [§9.212](../../docs/decisions/9.212.md) |
| 日付は「現場歴」と「太陽暦」の2列 | — | [§9.197](../../docs/decisions/9.197.md) |
| 挿入位置のゴーストで表を動かさない | `test_scinsert.js` | [§9.196](../../docs/decisions/9.196.md) |
| 同じグリッドに並べる行は、見出しも本文も同じ文字サイズにする | — | [§9.193](../../docs/decisions/9.193.md) |
| 幅は規格へ丸め、群の中でそろえる | `test_msteps.js` | [§9.131](../../docs/decisions/9.131.md) |
| 行の印は既定で付けない | — | [§9.201](../../docs/decisions/9.201.md) |
| スケジュール表の列の既定は1箇所でだけ判断する | `test_scbar.js`・`test_sctimecols.js` | [§9.207](../../docs/decisions/9.207.md) |
| 横スクロールする一覧の地と罫線はセルが持つ | — | [§9.208](../../docs/decisions/9.208.md) |
| 状態を出す欄が失敗したら**理由と次の手立てを字で**出す（印だけ・色だけにしない） | `test_navwords.js` | [§9.450](../../docs/decisions/9.450.md) |
| 1行も当たらない結合は**行を落とさず失敗として返す**（内部・右外部も）。相手が空なら「空」と名指し | `test_qjoin.py` | [§9.452](../../docs/decisions/9.452.md) |
| 一覧が0行なら**表の中で理由と次の手**を言う（絞った／伏せた／元データが空＝エラー）。答えは`listEmptyNote()` | `test_qjoinui.js` | [§9.452](../../docs/decisions/9.452.md) |
| 絞って0件なら**効いている条件を出どころつきで並べ、外す手を1つ**。名乗るのは`WL.listHooks.onNarrow()`の提供者 | `test_filter.js` | [§9.453](../../docs/decisions/9.453.md) |
| 畳んだ左メニューの行き先は浮き出しで示す | `test_nav.js` | [§9.265](../../docs/decisions/9.265.md) |
| 左メニューの行き先は**必ず説明を持つ**（畳むと浮き出しが`title`を本文に使う） | `test_navwords.js` | [§9.447](../../docs/decisions/9.447.md) |
| 元データの説明は**用途が先・出どころが後**。用途は`DB_NAV_WHAT`の1箇所（役割から引く） | `test_navwords.js` | [§9.447](../../docs/decisions/9.447.md) |
| 曖昧語を**取り去ると何も残らない名前**を作らない（`実績`／`実績データ`）。頭に修飾語を付ける | `test_navwords.js` | [§9.447](../../docs/decisions/9.447.md) |
| 列幅の余りは「何も無い場所」が受ける | — | [§9.209](../../docs/decisions/9.209.md) |
| マスタのモーダルの入力欄は型から決まる規格幅 | — | [§9.221](../../docs/decisions/9.221.md) |
| 切れたボタンは`title`では救えない | `test_fit.js` | [§9.222](../../docs/decisions/9.222.md) |
| `minmax(0,1fr)`と`auto`を1つのグリッドに混ぜない | — | [§9.222](../../docs/decisions/9.222.md) |
| 保存したら窓は閉じる。失敗したら閉じない | — | [§9.222](../../docs/decisions/9.222.md) |
| 単位を置くのは`placeUnit()`の1箇所、基準は「見えている操作面」 | `test_opunit.js` | [§9.233](../../docs/decisions/9.233.md) |
| 計算式の列にも表示ルールが効く／他の列だけのルールも当たる | `test_colrule.js`・`test_colsave.py`・`test_sctimecols.js` | [§9.234](../../docs/decisions/9.234.md) |
| 予定を描くたびに仕掛一覧を作り直さない | — | [§9.224](../../docs/decisions/9.224.md) |
| 段（タブ）に分けた窓は、描かれていない段の値を控えから読む | — | [§9.223](../../docs/decisions/9.223.md) |
| 条の設計カードの3点 | `test_splitlive.js` | [§9.221](../../docs/decisions/9.221.md) |
| 「どれが仕掛でどれが品質か」はキーでなく`データソースマスタ`の`[役割]` | `test_datasource.py`・`test_dskeylint.py`・`test_dsnav.js` | [決まり](../../docs/decisions/rules-misc.md) |
| 仕掛から消えたロットは実績で突き合わせる。在席は「仕掛にも在る列」だけで見る | `test_actualmatch.py` | [§9.364](../../docs/decisions/9.364.md) |
