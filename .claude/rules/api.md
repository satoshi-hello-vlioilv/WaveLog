# APIとルート（20件）

索引: [規則の置き場](README.md)｜入口: [CLAUDE.md](../../CLAUDE.md)

`backend/routes/`・`body(spec)`・`api_guard`・権限とモード

行は**守ることだけ**を書いてある。なぜそうなのか・実測値・撤回した案・踏んだ罠は
「くわしく」の先（[`docs/decisions/`](../../docs/decisions/README.md)）にある。
**直す前にその先を開くこと。**「固定する網」は `tests/run_all.sh <名前>` で回す。

| 守ること | 固定する網 | くわしく |
| --- | --- | --- |
| 新しいマスタのAPIは`routes/masters/`の段へ足す（`schedule.py`は40ルートで上限・上げられない） | `test_routesplit.py` | [§9.389](../../docs/decisions/9.389.md) |
| 「同じ内容をもう1行作る」は**登録とは別のルート**（登録は自然キーで既存行の更新に倒れる） | `test_scstop.js` | [§9.400](../../docs/decisions/9.400.md) |
| 設定系マスタの開き方は`routes/common.py`の`cfg_read`／`cfg_write_response`の1箇所 | `test_importlint.py` | [§9.389](../../docs/decisions/9.389.md) |
| 権限区分（開発者／メンテナンス者／一般ユーザー）は「何を触れるか」と別の軸 | — | [§9.272](../../docs/decisions/9.272.md) |
| マスタのAPIは11の段（1段20ルートまで）。Blueprintは`_base.py`の1つのまま | `test_routesplit.py` | [§9.333](../../docs/decisions/9.333.md) |
| 画面から来るJSONは`body(spec)`で読む。鍵は必ず宣言する | `test_body.py` | [§9.330](../../docs/decisions/9.330.md) |
| 「送られてきた鍵だけ書く」更新は`sets`/`vals`を組み立てる。`if in x`で分岐を2の冪に増やさない | `test_measitems.js` | [§9.392](../../docs/decisions/9.392.md) |
| ルートの「失敗の受け方」は`api_guard`の1箇所 | `test_apiguard.py` | [§9.324](../../docs/decisions/9.324-1.md) |
| 区分は4つ。「設備作業者」はマスタを出さない。段は`マスタ編集`の1列 | `test_roleperm.py`・`test_roleui.js` | [§9.163](../../docs/decisions/9.163.md) |
| データ一覧の「0件」は「無い」とは限らない | `test_recperm.js` | [§9.107](../../docs/decisions/9.107.md) |
| 日付・直の枠は「上位階層の箱」。行いっぱい×3行 | `test_scframe.js` | [§9.238](../../docs/decisions/9.238.md) |
| 更新者IDは名乗るだけ。答えるのは`current_login_id()`の1箇所 | — | [§9.276](../../docs/decisions/9.276.md) |
| 選択肢の「よく使う順」は並べる余地のある形だけ | — | [§9.248](../../docs/decisions/9.248.md) |
| タイムラインの「内容」も同じ列レイアウトマスタ | `test_sccols.js` | [§9.246](../../docs/decisions/9.246.md) |
| スケジュールの編集権は1設備1名。在席を出し、奪えるようにする | `test_modeguard.py`・`test_scsession.py`・`test_scwho.js` | [§9.211](../../docs/decisions/9.211.md) |
| 列設定の保存は「送った項目だけ書く」 | `test_colsave.py` | [§9.212](../../docs/decisions/9.212.md) |
| 自動／手動のバッジは常に同じ位置に出す | — | [§9.210](../../docs/decisions/9.210.md) |
| 取り消せない操作を主要動線に置かない | `test_recdel.js` | [§9.221](../../docs/decisions/9.221.md) |
| 編集可能モード/閲覧モード/スケジュールモード | `test_modeguard.py` | [決まり](../../docs/decisions/rules-misc.md) |
| 作業スケジュール表の「見えるもの」はモードで変えない | `test_scmodecols.js` | [§9.246](../../docs/decisions/9.246.md) |
