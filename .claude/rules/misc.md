# そのほか（18件）

索引: [規則の置き場](README.md)｜入口: [CLAUDE.md](../../CLAUDE.md)

どの束にも入らないもの

行は**守ることだけ**を書いてある。なぜそうなのか・実測値・撤回した案・踏んだ罠は
「くわしく」の先（[`docs/decisions/`](../../docs/decisions/README.md)）にある。
**直す前にその先を開くこと。**「固定する網」は `tests/run_all.sh <名前>` で回す。

| 守ること | 固定する網 | くわしく |
| --- | --- | --- |
| LotDspのタブは「Tab N：中身の名前」。顔ぶれは`WL.lotDspTab.TABS`の1箇所（値は番号のまま） | `test_eqsetup.js` | [§9.511](../../docs/decisions/9.511.md) |
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
| update.batの文字コード | — | [決まり](../../docs/decisions/rules-misc.md) |
