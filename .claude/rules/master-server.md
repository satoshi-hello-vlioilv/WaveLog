# マスタ（サーバー側）（32件）

索引: [規則の置き場](README.md)｜入口: [CLAUDE.md](../../CLAUDE.md)

`TableDef`・設備停止の3階層・既定値のたどり方

行は**守ることだけ**を書いてある。なぜそうなのか・実測値・撤回した案・踏んだ罠は
「くわしく」の先（[`docs/decisions/`](../../docs/decisions/README.md)）にある。
**直す前にその先を開くこと。**「固定する網」は `tests/run_all.sh <名前>` で回す。

| 守ること | 固定する網 | くわしく |
| --- | --- | --- |
| 外したら何が起き何が残るかはサーバーの語彙（`EQUIPMENT_FEATURE_EFFECTS`・`MEASURE_ITEM_EFFECT`）。画面へ写さない | `test_equse.js` | [§9.542](../../docs/decisions/9.542.md) |
| 端末ができることは`permission_capabilities()`の1箇所（既存の判定を掛け合わせるだけ）。書込は編集可能モードだけ | `test_roleperm.py` | [§9.538](../../docs/decisions/9.538.md) |
| 見張りは`permission_watch()`（できる端末の台数・1台以下を名指し）。登録の無い端末は数えない | `test_roleperm.py` | [§9.538](../../docs/decisions/9.538.md) |
| 表示列の編集はアクセス権限マスタの1列（3段・既定は編集可）。判定は`column_edit_check()`の1箇所・帳票の紙には掛けない | `test_roleperm.py`・`test_roleui.js` | [§9.512](../../docs/decisions/9.512.md) |
| 表示列の編集は**マスタ編集と別の軸**。画面は列レイアウトの応答（対象ごとの`canEditOwnColumns`／`canEditCommonColumns`）を読むだけ | `test_roleui.js` | [§9.512](../../docs/decisions/9.512.md) |
| 設備停止は3階層（分類→停止内容→内訳）。**内訳は名称を割らない**（集計は名称で束ねる） | `test_stopsub.py` | [§9.389](../../docs/decisions/9.389.md) |
| 停止内容の複製は**内訳の木ごと**写す。写しの名前を数えるのは`stop_reason_copy_name()`の1箇所 | `test_scstop.js` | [§9.400](../../docs/decisions/9.400.md) |
| 最初から選ばれる内訳は`stop_default_sub()`の1箇所（①1件ならそれ ②`[既定]`の印 ③無し） | `test_stopsub.py` | [§9.397](../../docs/decisions/9.397.md) |
| `[既定]`は兄弟のうち1つだけ。立てるとき兄弟を降ろす。**送らない鍵は触らない** | `test_stopsub.py` | [§9.397](../../docs/decisions/9.397.md) |
| `stop_sub_upsert()`の`standard_minutes`は**渡した値をそのまま書く**（省くと消える） | `test_stopsub.py` | [§9.397](../../docs/decisions/9.397.md) |
| 内訳の下はもう1段だけ（**深さは2段まで**）。親なしは`0`——`NULL`にするとUNIQUEが1件も止めない | `test_stopsub.py` | [§9.390](../../docs/decisions/9.390.md) |
| 内訳の並びは「親 → その子」をサーバーが作る。親を消すと**子も消える**。数えるのは1段目だけ | `test_stopsub.py` | [§9.390](../../docs/decisions/9.390.md) |
| 既定の分は「2段目 → 1段目 → 停止内容 → 無し」の4段。たどるのは`stop_default_minutes()`の1箇所 | `test_stopsub.py` | [§9.390](../../docs/decisions/9.390.md) |
| 時間マスタが持つのは「分」だけ。スライダーの両端は**選択肢そのもの**から作る | `test_stopsub.py` | [§9.389](../../docs/decisions/9.389.md) |
| 既定の分は「サブ → 親 → 無し」の3段。空欄を0にしない | `test_stopsub.py` | [§9.389](../../docs/decisions/9.389.md) |
| エラーを捨てるときは理由を1行残す。黙って捨てない | `test_quietlint.py` | [§9.328](../../docs/decisions/9.328.md) |
| マスタ1表の列定義は`TableDef`の1箇所 | `test_tabledef.py` | [§9.324](../../docs/decisions/9.324-1.md) |
| 測定画面から選択肢マスタへ足せる。既定は足せない | `test_opinline.js` | [§9.323](../../docs/decisions/9.323-1.md) |
| 設備の有効・無効は「機能ごと」。保存値は「使わない機能」 | `test_eqfeature.js` | [§9.132](../../docs/decisions/9.132.md) |
| 入力内容も設備ごとに出し分ける。保存値は「使わない入力内容」・**すべては外せない**（400で断り、行き先まで言う） | `test_measitems.js` | [§9.392](../../docs/decisions/9.392.md) |
| 移行済みの旧マスタは「無ければ作らない」 | `test_rawmaster.py` | [§9.255](../../docs/decisions/9.255.md) |
| 設備マスタは表が主役・修正はモーダル | — | [§9.250](../../docs/decisions/9.250.md) |
| 既定の品質データ結合は解除できる | — | [§9.194](../../docs/decisions/9.194.md) |
| `.mm-field`の中のチェックボックスに幅を与えないこと | `test_shift.js`・`test_workable.js` | [§9.197](../../docs/decisions/9.197.md) |
| `optionFill()`は候補に無い現在値を黙って捨てる | — | [§9.204](../../docs/decisions/9.204.md) |
| マスタの群は「その画面で何をするか」で分ける。群の中は決める順 | `test_master.js`・`test_mmtable.js` | [§9.264](../../docs/decisions/9.264.md) |
| 説明文の`**強調**`は`hintHtml()`を通す（逃がしてから印を変える） | — | [§9.222](../../docs/decisions/9.222.md) |
| 組み込みの入力欄も、見出しはマスタの項目名で書き換える | `test_oppad.js` | [§9.228](../../docs/decisions/9.228.md) |
| 群は「列でも区切れる」 | — | [§9.226](../../docs/decisions/9.226.md) |
| 設備名を持つマスタを増やしたら、改名連動の一覧へ足す | `test_opchoice.js` | [§9.221](../../docs/decisions/9.221.md) |
| 設備停止マスタの`[設備名]`は「対象設備」 | `test_stopeq.js` | [決まり](../../docs/decisions/rules-misc.md) |
| ③「記録した値」は操業データ項目マスタが決める | `test_recvalues.js` | [§9.242](../../docs/decisions/9.242.md) |
