# そのほか（35件）

索引: [規則の置き場](README.md)｜入口: [CLAUDE.md](../../CLAUDE.md)

どの束にも入らないもの（ダッシュボード・§9.628 もここ）

行は**守ることだけ**を書いてある。なぜそうなのか・実測値・撤回した案・踏んだ罠は
「くわしく」の先（[`docs/decisions/`](../../docs/decisions/README.md)）にある。
**直す前にその先を開くこと。**「固定する網」は `tests/run_all.sh <名前>` で回す。

| 守ること | 固定する網 | くわしく |
| --- | --- | --- |
| パネルの元の状態は`source_state()`の1箇所（ready・copying・unset）。写し中は選べて字で言い、選べないのは置き場が未設定の元だけ | `test_dashsrc.js`・`test_dashapi.py` | [§9.630](../../docs/decisions/9.630.md) |
| 予定と実績のガントは`ops.plan`（元は作業予定）。実績の棒は行の実績（出どころは`actual_from()`）、予定の枠はまだ終わっていない行（作業中は作業開始＋見積） | `test_dashapi.py` | [§9.630](../../docs/decisions/9.630.md) |
| いまの作業（作業中のロットか設備停止・予定完了＝作業開始＋見積・次の予定）は`_now_one()`の1箇所。パネル「いまの作業」もガントの行の名前の下も同じ答え | `test_dashapi.py` | [§9.630](../../docs/decisions/9.630.md) |
| 合計の比は集計の種類`ratio`（列の合計 ÷ `per`の合計・両方が数の行だけ）。生産性は行ごとの比の平均にしない | `test_dashapi.py` | [§9.630](../../docs/decisions/9.630.md) |
| 既定のダッシュボードは「生産の状況」（`BUILTIN_DEFAULT`）。品種は 用途名×丈数×条数 の3列の組合せ、良品重量は`good_weight()`の1箇所 | `test_dashapi.py`・`test_dashboard.js` | [§9.630](../../docs/decisions/9.630.md) |
| ガントの棒の札は全部入るか、1本でも入らなければパネルの全部を下3桁にそろえ、凡例で言う（1枚の中で書き方を混ぜない） | — | [§9.630](../../docs/decisions/9.630.md) |
| ダッシュボードの添え書きは項目（元・設備・期間・条件）で持つ（`metaParts()`）。多くのパネルで同じ物は「このダッシュボードの前提」に1回 | `test_dashboard.js`・`test_dbequip.js` | [§9.628](../../docs/decisions/9.628.md) |
| パネルに書かない項目は共通と同じ。共通にある期間・条件を持たないパネルは「期間 すべて」「条件 なし」と書く | `test_dashboard.js` | [§9.628](../../docs/decisions/9.628.md) |
| ダッシュボードの色相は設備だけ（`equipColor()`の1箇所・設備の木の順）。量の棒・1つの値は紺 | `test_dashboard.js` | [§9.628](../../docs/decisions/9.628.md) |
| 数える物は1行も無くても 0（総計のマス・合わせた表のセル）。「–」は分からない値だけ | `test_dashapi.py` | [§9.628](../../docs/decisions/9.628.md) |
| 合わせた表の行は数えた設備ぜんぶ（答えの`parts`・0 は単位つき）。並びは決めた列→隣の列→名前、並べた列の見出しに ▼ | `test_dashboard.js` | [§9.628](../../docs/decisions/9.628.md) |
| 表の全体の設備は`equips`（`@mine`も）。まとまりの`equip`は設備の列の名前で、設備の名前ではない | `test_dashboard.js` | [§9.628](../../docs/decisions/9.628.md) |
| 同じ数を2か所に出さない（合わせた表の「計」は`noTotal`・数字のパネルの題に単位の括弧を書かない） | `test_dashboard.js` | [§9.628](../../docs/decisions/9.628.md) |
| 時の軸は期間の始まり〜終わり（数の無い日・月も並ぶ）。字は終わりの日から間引く | — | [§9.628](../../docs/decisions/9.628.md) |
| 問い合わせは`WL.dashKit.fetch`の1本（`@mine`→使用設備）。元の意味は`WL.dashKit.src`の1箇所 | `test_dbequip.js` | [§9.628](../../docs/decisions/9.628.md) |
| 設備グループはマスタ管理の汎用の表（POST /update・/delete）。決まりは1行1つの字（`parse_rules_text()`） | `test_equipgroupui.js`・`test_dashapi.py` | [§9.628](../../docs/decisions/9.628.md) |
| LotDspのタブは「Tab N：中身の名前」。顔ぶれは`WL.lotDspTab.TABS`の1箇所（値は番号のまま） | `test_eqsetup.js` | [§9.511](../../docs/decisions/9.511.md) |
| デスクトップ版の窓の中かは`WL.base.inDesktopShell()`の1箇所。窓の中では拡張の名乗りが来ないので「入っていません」と言い切らず、確かめる道を1つ出す | `test_lotdsplink.js` | [§9.550](../../docs/decisions/9.550.md) |
| ロット問い合わせのログインと取込は LotData-Link（別リポジトリ）が持つ。WaveLog は ID・パスワードを受け取らず、合図だけ使う | `test_lotdsplink.js` | [§9.521](../../docs/decisions/9.521.md) |
| 計算を直したら、**その計算を説明している字**も直す（字は網にかからない） | — | [§9.420](../../docs/decisions/9.420.md) |
| フラットネスの全〇は「印を持つボタンだけ」を拾う | — | [§9.320](../../docs/decisions/9.320.md) |
| 畳んでよいのは「言い回し」だけ。単位・できること・取り違えを防ぐ事実は別 | — | [§9.255](../../docs/decisions/9.255.md) |
| `program/requirements.txt`は`flask`だけ。増やしたら網も書き直す | `test_noaccess.py` | [§9.268](../../docs/decisions/9.268.md) |
| 折り返す横並びの器へ「1行ぶんの物」を入れるときは`flex:1 0 100%` | — | [§9.250](../../docs/decisions/9.250.md) |
| 画面が出す「切」の呼び名は`flags.OFF_WORDS`へ全部並べる | `test_bladeset.py`・`test_flags.py` | [§9.377](../../docs/decisions/9.377.md) |
| 「選ばない」の札は値を持たない | `test_opblank.js` | [§9.286](../../docs/decisions/9.286.md) |
| 札の「字」は`WL.optionBlankLabel`、「未選択か」は値で見る | `test_opblank.js` | [§9.288](../../docs/decisions/9.288.md) |
| 説明文の印を解くのは`WL.markup()`の1箇所 | `test_changelog.py`・`test_changelogui.js` | [§9.286](../../docs/decisions/9.286.md) |
| 浮きウィンドウ（`WL.makeFloatingWindow`）の端は8方向 | — | [決まり](../../docs/decisions/rules-misc.md) |
| 応答がJSONでないときは状態コードから言い直す | — | [§9.200](../../docs/decisions/9.200.md) |
| 「空欄（選ばない）」の札は出さないようにできる | — | [§9.228](../../docs/decisions/9.228.md) |
| `<select>`に値の見せ方を当てない | — | [§9.221](../../docs/decisions/9.221.md) |
| フィールド名 | — | [決まり](../../docs/decisions/rules-misc.md) |
| 作業時間は分まで | — | [§9.242](../../docs/decisions/9.242.md) |
| 【§9.559で update.bat を外した】update.batの文字コード | — | [決まり](../../docs/decisions/rules-misc.md) |
