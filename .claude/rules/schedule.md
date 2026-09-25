# 作業スケジュール（82件）

索引: [規則の置き場](README.md)｜入口: [CLAUDE.md](../../CLAUDE.md)

予定の行・設備停止の登録・写しの同期・ロット番号のコピー

行は**守ることだけ**を書いてある。なぜそうなのか・実測値・撤回した案・踏んだ罠は
「くわしく」の先（[`docs/decisions/`](../../docs/decisions/README.md)）にある。
**直す前にその先を開くこと。**「固定する網」は `tests/run_all.sh <名前>` で回す。

| 守ること | 固定する網 | くわしく |
| --- | --- | --- |
| 過去履歴は段「履歴」（見るだけ）。材料は予定の表そのもの・組み立ては`schedule_history.history()`の1箇所 | `test_schedhist.py`・`test_schistui.js` | [§9.502](../../docs/decisions/9.502.md) |
| 履歴の時刻は出どころつき。設備停止は「入れた→外した」と「見積」を字で書き分ける（止まった時間とは言わない） | `test_schedhist.py` | [§9.502](../../docs/decisions/9.502.md) |
| 履歴の既定の日は現場歴の今日（サーバーが答える・単位「期間」でも）。探す規則は`matches()`の1箇所、字の畳み方は`search_fold()`（画面へ写さない） | `test_schedhist.py` | [§9.502](../../docs/decisions/9.502.md) |
| 実績1件は予定の行1本にだけ当たる。有効な行が先に取り、外した行は「外す前に始まった・この設備の実績」のときだけ（`_removed_owns()`） | `test_schedhist.py` | [§9.502](../../docs/decisions/9.502.md) |
| 段「履歴」も**いまの設備の**内容の列で出す（`switchToHistory()`が控えを揃えてから出す） | `test_schistui.js` | [§9.502](../../docs/decisions/9.502.md) |
| 表示列の候補の土台は仕掛の元データの列名（`scLoadWorkColumns()`の1箇所）。`S.columns`（画面がいま持つ表）に頼らない | `test_sccolpanel.js` | [§9.501](../../docs/decisions/9.501.md) |
| 候補は材料が変わったときだけ作る（`scMemo()`）。予定の`detail`／`joined`をその場で書き換えたら`touchContentCandidates()` | `test_sccolpanel.js` | [§9.501](../../docs/decisions/9.501.md) |
| 仕掛一覧は見え方（伏せるロット・出す列）が変わるときだけ描き直す。描いた状態は`hiddenLotSet()`の口で控える | `test_sccolpanel.js` | [§9.501](../../docs/decisions/9.501.md) |
| 小計の設定は「表示」の畳む段。中は決める順の番号付きの節、集計の項目は見出しと欄が同じ格子の表＋見本 | `test_scsubtotal.js` | [§9.500](../../docs/decisions/9.500.md) |
| 「表示」の畳む段の開け閉めは`SC_VIEW_ACCS`／`setViewAcc()`の1箇所（開けたら他を畳む） | `test_scsubtotal.js`・`test_scdragscroll.js` | [§9.500](../../docs/decisions/9.500.md) |
| 小計は**1行**。「行」の集計の器は列の真下から右隣の集計の無い列まで広げる（縦に積まない）。式は最後の器の後ろ | `test_scsubtotal.js` | [§9.499](../../docs/decisions/9.499.md) |
| 小計は**集計の項目の並び**。集計は`SC_SUBTOTAL_AGGS`、式は`WL.formula`、書式は`WL.cellFormat`（仕組みを足さない） | `test_scsubtotal.js` | [§9.498](../../docs/decisions/9.498.md) |
| 小計の式が引く名前は`subtotalItemName()`の1箇所。古い保存（`cols`）は`subtotalItemsOf()`が読み替える | `test_scsubtotal.js` | [§9.498](../../docs/decisions/9.498.md) |
| 小計の桁と単位は**別々に**決まる（決めたほうは書式・決めていないほうは材料なり）。自動の桁は`subtotalAutoDec()`の1箇所 | `test_scsubtotal.js` | [§9.498](../../docs/decisions/9.498.md) |
| 小計「行」の揃えは**その列の1マスの中**（`subgrid`＋中身の器`.sc-st-in`）。入らなければ列の左端から伸ばす | `test_scsubtotal.js` | [§9.499](../../docs/decisions/9.499.md) |
| 小計の式を読めない理由は`subtotalFormulaError()`の1箇所（無い名前も）。引く値が読めない区切りでは計算しない。数えるのは全部の項目 | `test_scsubtotal.js` | [§9.498](../../docs/decisions/9.498.md) |
| 集計の項目の「計算」は集計した値へ続けて当てる（`÷1000×0.8`＝`[値]/1000*0.8`）。式の形は`subtotalExprOf()`の1箇所 | `test_scsubtotal.js` | [§9.503](../../docs/decisions/9.503.md) |
| 小計は**まとめとは別の軸**（区切りのお尻で数える）。区切りの語彙は`bucketOf()`の1本をまとめと共有する | `test_scsubtotal.js` | [§9.493](../../docs/decisions/9.493.md) |
| 小計が数えるのは作業ロットだけ（`subtotalCounted()`の1箇所）。子ロットは親の1本 | `test_scsubtotal.js` | [§9.493](../../docs/decisions/9.493.md) |
| 合計は数として読めた値だけ。読めない・単位の違う値は0で足さず`*`と件数で言う | `test_scsubtotal.js` | [§9.493](../../docs/decisions/9.493.md) |
| ICASコピーの最初の1行は`区切らずにつなぐ`（普通の行）。触っていない旧い例の2本は片付ける | `test_lotcopy.js` | [§9.462](../../docs/decisions/9.462.md) |
| 仕掛落ちの「着手」は作業中扱い（予定の終わり＝現在時刻）。見積ぶん居座らせない | `test_actualmatch.py` | [§9.462](../../docs/decisions/9.462.md) |
| 完了にならない理由は`advance_note()`の1箇所が答え、行の印（橙）で出す。全行共通の理由は知らせで1回 | `test_actualmatch.py` | [§9.462](../../docs/decisions/9.462.md) |
| ロット番号の**横に**LotDspの的（字は押す形にしない）。的が`data-lot-dsp`を名乗り、道は`base.js`の1本 | `test_lotcopy.js`・`test_screport.js` | [§9.460](../../docs/decisions/9.460.md) |
| 追加は**操作に身元（`操作ID`）を持たせ、同じ身元は2回適用しない**（再送は止めない） | `test_plandup.js` | [§9.438](../../docs/decisions/9.438.md) |
| 行間の差し込みの札が書くのは**「どこへ入るか」だけ**。何ができるかは線の`title`と`#scSplitHint`が持つ | `test_scinsert.js` | [§9.439](../../docs/decisions/9.439.md) |
| 札は**当たり判定を持たない**（押せるのは線だけ）。押せる箱を2つ重ねると下の行のボタンを食う | `test_scinsert.js` | [§9.439](../../docs/decisions/9.439.md) |
| 位置を決めた札に**「やめる」は持たない**（窓を閉じれば`clearInsertPin()`を通る。外す道は1本） | `test_scinsert.js` | [§9.439](../../docs/decisions/9.439.md) |
| 差し込み案内は**3段**（`SC_INSERT_GUIDES`）。`off`でも**掴んで運ぶ間の線は出す**（`insertByDrag`） | `test_scinsert.js` | [§9.439](../../docs/decisions/9.439.md) |
| `off`を選んだら**できないと書く**。固定したあとは`line`でも札を出す（状態を色だけで伝えない） | `test_scinsert.js` | [§9.439](../../docs/decisions/9.439.md) |
| 身元は**行と同じINSERTで**入れる。有効・無効は見ない（消した予定も適用済み） | `test_plandup.js` | [§9.438](../../docs/decisions/9.438.md) |
| 身元を足すのは**追加だけ**（更新・削除・並べ替えは2回書いても増えない） | `test_plandup.js` | [§9.438](../../docs/decisions/9.438.md) |
| 身元は**積むときに1回だけ**作る（投げ直しで作り直さない・時刻から作らない） | `test_plandup.js` | [§9.438](../../docs/decisions/9.438.md) |
| 設備停止の追加は**左＝停止内容（全高・1列）／右上＝カード（2/3幅）／右下＝内訳の列＋いま入れた**。足元の帯は§9.402で撤回 | `test_stopflow.js`・`test_scstop.js` | [§9.402](../../docs/decisions/9.402.md) |
| 時間は**目盛り**。顔ぶれは時間マスタの選択肢そのもの。無い分は「その他の分…」で打ち、**打った分は目盛りに1本足して**つまみを立てる | `test_stopflow.js` | [§9.402](../../docs/decisions/9.402.md) |
| 設備名は**窓の題**が言う（カードの行き先には出さない）。入る位置と時刻はカードの1行 | `test_scstop.js` | [§9.402](../../docs/decisions/9.402.md) |
| 入れたものは「いま入れた」の列に並び、**窓を閉じるまで取り消せる**（合計も出す）。外す道は`removeEntries()`の1本 | `test_stopflow.js` | [§9.402](../../docs/decisions/9.402.md) |
| 内訳を持たない停止内容では**空の列を置かず「どこへ入るか」を出す**。無いことはカードの見出しが言う | `test_scstop.js` | [§9.402](../../docs/decisions/9.402.md) |
| ICASコピーは**ルールが1本も無くても必ずつなぐ**。素のつなぎ方は**区切り無しの連結**（§9.403で半角スペースから改めた）。無いことを断る理由にしない | `test_lotcopy.js` | [§9.403](../../docs/decisions/9.403.md) |
| 設備停止は「内容 →（内訳）→ 時間」の手順で入れる。窓は開かず一覧と入れ替える | `test_stopflow.js` | [§9.389](../../docs/decisions/9.389.md) |
| 一覧の上端は動かさない。案内は一覧の**下**の「知らせの棚」（`#scNotices`）へ | `test_scbar.js` | [§9.397](../../docs/decisions/9.397.md) |
| 行の右クリックは**作業導線の順に群で束ねる**（進める→直す→増やす・写す→選ぶ・並べる→画面→外す）。群は5件以下、**中身の無い群は出さない** | `test_scstop.js` | [§9.399](../../docs/decisions/9.399.md) |
| 予定の行の複製を出すのは**申し送りだけ**。設備停止・作業・枠には出さない（顔ぶれは`DUPLICABLE_KINDS`の1箇所） | `test_scstop.js` | [§9.401](../../docs/decisions/9.401.md) |
| Deleteで外すのも`removeEntries()`の1本を通す。欄・IME変換中・窓が開いている間は取らない。Backspaceは取らない | `test_scpick.js` | [§9.399](../../docs/decisions/9.399.md) |
| 帯（ヘッダーの操作列）は1行のまま。譲るのは**状態の文字だけ**（押せる物は縮ませない） | `test_scbar.js` | [§9.397](../../docs/decisions/9.397.md) |
| 設備停止は左＝一覧／右＝設定の2ペイン。一覧と入れ替えない（§9.389の作法を撤回） | `test_stopflow.js` | [§9.397](../../docs/decisions/9.397.md) |
| 内訳と時間は**最初から選ばれている**。進むボタンの字は「いま入るもの」そのもの | `test_stopflow.js` | [§9.397](../../docs/decisions/9.397.md) |
| 段が増えるのは**下を持つ内訳を選んだときだけ**（空の段を出さない）。1段目を選び直したら2段目は捨てる | `test_stopflow.js` | [§9.390](../../docs/decisions/9.390.md) |
| 予定へ渡すのは**いちばん下の内訳のID**1つ。1段目は`stopSub`のまま・2段目は`stopSub2`（既存の集計を割らない） | `test_stopsub.py`・`test_stopflow.js` | [§9.390](../../docs/decisions/9.390.md) |
| 内訳の札は題名の一部ではない。答えるのは`nonWorkSubText()`の1箇所（紙も同じ1本） | `test_stopflow.js` | [§9.389](../../docs/decisions/9.389.md) |
| 予定の内訳（サブカテゴリ）は`[明細JSON]`。触れるのは**設備停止の行だけ**（作業の写しを潰さない） | `test_stopsub.py` | [§9.389](../../docs/decisions/9.389.md) |
| 作業スケジュールの「開始」は着手できる**全行**に出す（次の1本は現場が自由に選ぶ。先頭N行に絞らない） | `test_workable.js` | [§9.339](../../docs/decisions/9.339.md) |
| 送り出した画面は**来た道の段へ戻す**（`open({mode})`）。段の名前は`SC_MODES`の1箇所 | `test_bladeui.js` | [§9.407](../../docs/decisions/9.407.md) |
| 設備停止の行き先は`設備停止マスタ`の`[連携機能]`。行は持たない・語彙はサーバー | `test_bladeset.py`・`test_bladeui.js` | [§9.377](../../docs/decisions/9.377.md) |
| 行き先の的は題名の横に別に立てる（行いっぱいは「選ぶ」・ダブルクリックは「直す」） | `test_bladeui.js` | [§9.377](../../docs/decisions/9.377.md) |
| 予定の写しは「画面に出している項目だけ」元データから取り込み直す。空は「変わった」と読まない | `test_srcsync.js` | [§9.375](../../docs/decisions/9.375.md) |
| 写しへ書き戻すのは`plan_merge_detail()`の1箇所。渡した鍵だけ重ね、作業の行だけ | `test_srcsync.js` | [§9.375](../../docs/decisions/9.375.md) |
| 外した予定は「仕掛にまだ在るとき」だけ一覧へ戻す。在席は3値・不明なら戻す | `test_wipgone.js` | [§9.368](../../docs/decisions/9.368.md) |
| 選んだ予定のロット番号はつないでコピーできる。つなぎ方は`WL.lotCopy.joinLots()`の1箇所 | `test_lotcopy.js` | [§9.368](../../docs/decisions/9.368.md) |
| 書込が失敗したら必ず理由を言う。`onFailure`があることを「知らせた」と数えない（見出しは`SC_OP_LABEL`の1箇所） | `test_scfail.js` | [§9.372](../../docs/decisions/9.372.md) |
| 失敗は「開発へ報告できる形」で残す。文脈は画面が`WL.feedback.provide()`で名乗る（土台に画面の知識を書かない） | `test_feedback.js` | [§9.373](../../docs/decisions/9.373.md) |
| 報告は「人が読む形＋機械で読む1行（`WLFB1`）」。足あとは必ず失敗で終わる。版は控えてから使う | `test_feedback.js` | [§9.373](../../docs/decisions/9.373.md) |
| 掴んでいる間は器の縁で表を送る。判定は「予定の画面の上でドラッグ中か」の1つ（掴んでいる物で数えない） | `test_scdragscroll.js` | [§9.374](../../docs/decisions/9.374.md) |
| 色と濃さの意味は「表示」に畳む。見本は**実物と同じクラス**で描く（色を書き写さない） | `test_scdragscroll.js` | [§9.374](../../docs/decisions/9.374.md) |
| 動かせない行は掴んだ時点で理由を言う。判定は`reorderableEntry()`と同じ順で見る | `test_scfail.js` | [§9.372](../../docs/decisions/9.372.md) |
| 区切りは「あたった決まりを書いた順にぜんぶ重ねる」。区切り文字は1文字に限らない（空白だけでも可） | `test_lotcopy.js` | [§9.371](../../docs/decisions/9.371.md) |
| さかのぼりの起点はサーバーの`history_from()`が1箇所で答える | `test_schistory.js` | [§9.366](../../docs/decisions/9.366.md) |
| 済んだ行の代表時刻は`actual.startAt`→`actual.endAt`→`finishedAt`の順 | `test_schistory.js`・`test_scrowstyle.js` | [§9.366](../../docs/decisions/9.366.md) |
| 稼働カレンダーは足りなくなったら伸びる | `test_scload.py` | [§9.291](../../docs/decisions/9.291.md) |
| 開始ボタンを作る場所は2つある。文字とHTMLは1箇所 | `test_workable.js` | [§9.51](../../docs/decisions/9.51.md) |
| 作業日・直を直す道は行の右クリックからも辿れる。判定は`frameInsertable()`の1箇所、窓は「どこへ入るか」を先に言う | `test_scframe.js` | [§9.376](../../docs/decisions/9.376.md) |
| 空の日付・直の枠は「ここから先の起点を進めるだけ」 | `test_scframe.js` | [§9.238](../../docs/decisions/9.238.md) |
| 申し送り（コメント）は時間を取らない | `test_sccomment.js` | [§9.189](../../docs/decisions/9.189.md) |
| 書込のあとは予定の時刻を取り直す | `test_scundecided.js` | [§9.185](../../docs/decisions/9.185.md) |
| 現場歴の日付補正は勤務区分マスタの1列 | `test_workdate.py` | [§9.195](../../docs/decisions/9.195.md) |
| 同じ材料なら作り直さない | — | [§9.198](../../docs/decisions/9.198.md) |
| 予定の起点は5分刻みへ切り上げる | — | [§9.198](../../docs/decisions/9.198.md) |
| 「表示範囲」は「さかのぼり」と言い、起点の日時を出す | — | [§9.198](../../docs/decisions/9.198.md) |
| 取りに行った応答は「いつの分か」で捨てる | `test_scsave.js` | [§9.200](../../docs/decisions/9.200.md) |
| 赤いまま残っている網は網ではない | — | [§9.200](../../docs/decisions/9.200.md) |
| 分割ありの親ロットは子ロットをぶら下げて予定へ入る | `test_scsplit.js` | [決まり](../../docs/decisions/rules-misc.md) |
| 見積の出どころは4段で、順番を入れ替えないこと | `test_eqstd.py` | [§9.114](../../docs/decisions/9.114.md) |
