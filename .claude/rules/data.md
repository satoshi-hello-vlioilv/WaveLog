# データの置き場と共有（58件）

索引: [規則の置き場](README.md)｜入口: [CLAUDE.md](../../CLAUDE.md)

共有DB／写し／錠・`config/local.json`・SQLite の入出力・保存の状態

行は**守ることだけ**を書いてある。なぜそうなのか・実測値・撤回した案・踏んだ罠は
「くわしく」の先（[`docs/decisions/`](../../docs/decisions/README.md)）にある。
**直す前にその先を開くこと。**「固定する網」は `tests/run_all.sh <名前>` で回す。

| 守ること | 固定する網 | くわしく |
| --- | --- | --- |
| ショートカットの名前と絵は`パス設定マスタ`へ残す。鍵は**保存の受け側にも**足す | `test_shortcut.py` | [§9.433](../../docs/decisions/9.433.md) |
| 起動ショートカットの設定を書くのは`desktop_shortcut.remember()`の1箇所（作れたときだけ・鍵は2つだけ） | `test_shortcut.py` | [§9.445](../../docs/decisions/9.445.md) |
| 共通設定の欄は`data-pc-field`を名乗れば保存に載る。**値は組み立てるときに入れる** | `test_shortcut.py` | [§9.433](../../docs/decisions/9.433.md) |
| 端末に持つ設定の例（seed）は**読んだその場で保存する**。IDを時刻から作らない | `test_lotcopy.js` | [§9.400](../../docs/decisions/9.400.md) |
| 保存された`[]`は「まだ作っていない」ではなく**「利用者が空にした」**。見分けるのは鍵の有無 | `test_lotcopy.js` | [§9.400](../../docs/decisions/9.400.md) |
| ログビュワー（`backend/routes/logs.py`／`static/js/core/log-view.js`）は「1行」でなく「1件」で扱う | `test_logs.py`・`test_logview.js` | [§9.99](../../docs/decisions/9.99.md) |
| 新しいキャッシュは`WL.ttlCache()`を使う | — | [§9.67](../../docs/decisions/9.67.md) |
| 共有のデータは「読むのは写し・書くのは実物」で揃える | `test_recmirror.py` | [§9.268](../../docs/decisions/9.268.md) |
| 共有マスタの錠は「持ち主が自分なら引き継ぐ」。名乗れない端末は自分と言わない | `test_mastershare.py` | [§9.384](../../docs/decisions/9.384.md) |
| 錠待ち（409）は錠が切れるまで粘る。編集権(423)は待っても戻らないので即言う | `test_scfail.js`・`test_mastershare.py` | [§9.384](../../docs/decisions/9.384.md) |
| 元データは「見る」と「取り込む」を分ける。見るのは全端末・書くのは書ける端末だけ | `test_scperm.js` | [§9.378](../../docs/decisions/9.378.md) |
| `config/local.json`のパスは環境変数を展開する。保存は書いたまま | — | [§9.268](../../docs/decisions/9.268.md) |
| `config/local.json`を読めなかったことを黙らないこと | — | [§9.271](../../docs/decisions/9.271.md) |
| 置き場はフォルダで書いてよい。答えるのは`resolve_db_file()`の1箇所 | — | [§9.271](../../docs/decisions/9.271.md) |
| 画面から来る「入/切」は`flags.flag_of()`の1箇所で真偽へ直す | `test_flags.py` | [§9.324](../../docs/decisions/9.324-1.md) |
| SQLiteの入出力は`backend/sqlite_io.py`、置き場の答えは`db_access`、書込は`bootstrap()` | `test_dblayer.py` | [§9.329](../../docs/decisions/9.329.md) |
| 作業予定を「読む側」は写しに書かない | `test_scsnapread.py` | [§9.325](../../docs/decisions/9.325.md) |
| 在席は端末ごとに1ファイル。切断は「書き込みだけ」を止める | `test_presence.py`・`test_presenceui.js` | [§9.272](../../docs/decisions/9.272.md) |
| 置き場の答えは`backend/storage_layout.py`の1箇所 | `test_storage.py`・`test_storageui.js` | [§9.267](../../docs/decisions/9.267.md) |
| 測定データは設備ごとに1ファイル。置き場の答えは`db_access`の1箇所 | `test_recsplit.py` | [§9.258](../../docs/decisions/9.258.md) |
| 測定データの保存は端末内と共有DBの両方へ | `test_share.js` | [§9.91](../../docs/decisions/9.91.md) |
| 編集セッションは「名乗る役」。止める役はやめた | `test_scowner.py`・`test_scwho.js` | [§9.291](../../docs/decisions/9.291.md) |
| 同期のタイミングはチップを押すと開く。秒読みはしない | — | [§9.292](../../docs/decisions/9.292.md) |
| 終わる前に片付ける。片付けは`watchdog.teardown()`の1箇所 | `test_appquit.js`・`test_scowner.py` | [§9.108](../../docs/decisions/9.108.md) |
| 書込役が応答しないときは、理由を見分けて引き取れる | `test_appquit.js`・`test_scowner.py` | [§9.163](../../docs/decisions/9.163.md) |
| 「いつのデータか」に答えるチップは1つ。畳んだ先に打つ手を2つ置く | `test_scbar.js` | [§9.292](../../docs/decisions/9.292.md) |
| 説明の量は`hintHtml()`の1箇所で決める | — | [§9.274](../../docs/decisions/9.274.md) |
| 表の切り替えはヘッダーのバッジ1つ。器（`#tabs`）は動かさない | — | [§9.288](../../docs/decisions/9.288.md) |
| 「右端に空ける幅」は1つの変数が持つ。詳細度の競争をしない | — | [§9.250](../../docs/decisions/9.250.md) |
| 数を扱う道具は「そのまま打つ」の1枠に収める | `test_opwidget.js` | [§9.250](../../docs/decisions/9.250.md) |
| 「いま見ているのはいつのデータか」は元データの時刻 | — | [§9.286](../../docs/decisions/9.286.md) |
| 選ぶ的は行いっぱい。印は押す物ではない。全選択は文字のボタン | `test_scpick.js` | [§9.363](../../docs/decisions/9.363.md) |
| 選んでからまとめて動かせる | `test_multidrag.js`・`test_scpick.js` | [§9.177](../../docs/decisions/9.177.md) |
| 共有スケジュールは「変わったときだけ」取り込む | `test_scwatch.py`・`test_scwatchui.js` | [§9.188](../../docs/decisions/9.188.md) |
| 共有スケジュールへ書くのは1台だけにできる | `test_scowner.py` | [§9.192](../../docs/decisions/9.192.md) |
| 読んだデータは「何として使うか」を選べる | — | [§9.193](../../docs/decisions/9.193.md) |
| 遅い書き込みには「保存しています…」を出す | `test_savechip.js`・`test_savechip.py` | [§9.273](../../docs/decisions/9.273.md) |
| 設定の保存の状態は`WL.saveState`が1箇所に出す | — | [§9.212](../../docs/decisions/9.212.md) |
| 上部メニューバーへ物を足すときは「余り」を測ってから | `test_scwho.js` | [§9.211](../../docs/decisions/9.211.md) |
| 見栄えは「重ねない・そろえる・囲みすぎない」を数で固定する | `test_msteps.js` | [§9.129](../../docs/decisions/9.129.md) |
| 読み取り専用のデータソースは`cfg()`で開く。`DBS[...]['path']`を直に使わない | — | [§9.198](../../docs/decisions/9.198.md) |
| 遅いときは「どこが遅いか」を画面に出す | — | [§9.198](../../docs/decisions/9.198.md) |
| 親ロットの印は「親」（数字なし）か「子N」（件数つき） | — | [§9.199](../../docs/decisions/9.199.md) |
| 「新しい版あり」は同じ物差しで比べる | — | [§9.208](../../docs/decisions/9.208.md) |
| 共有スケジュールの置き場はフォルダで指定できる | — | [§9.262](../../docs/decisions/9.262.md) |
| マスタを共有に置くときは作業予定と同じ書込サイクルを通す | `test_mastershare.py` | [§9.263](../../docs/decisions/9.263.md) |
| 共有の置き場は1枚で見せる。判定はサーバーが持つ | `test_pcshare.js` | [§9.260](../../docs/decisions/9.260.md) |
| 共通設定は「図 → 章のレール → 章（欄＋その場の状態）」 | — | [§9.208](../../docs/decisions/9.208.md) |
| 空き（ダミー）は「カード1枚」の属性 | — | [§9.228](../../docs/decisions/9.228.md) |
| 仕掛由来の添え書きは1行・置き場を選べる | — | [§9.233](../../docs/decisions/9.233.md) |
| 接続先はすべてSQLite（Access接続は廃止） | `test_dbopen.py` | [決まり](../../docs/decisions/rules-misc.md) |
| マスタの保存先は`db/master.sqlite3`に集約 | — | [§9.27](../../docs/decisions/9.27.md) |
| パス設定マスタ | — | [§9.192](../../docs/decisions/9.192.md) |
| 共有上の読み取り専用DBは`db_mirror`が手元へ写し、画面は写しを読む | `test_dbmirror.py` | [決まり](../../docs/decisions/rules-misc.md) |
| Windowsは開いているファイルを置き換えられない | `test_atomicio.py`・`test_dbmirror.py` | [§9.108](../../docs/decisions/9.108.md) |
| `with connect(...) as c:` は接続を閉じない | `test_mastershare.py` | [§9.270](../../docs/decisions/9.270.md) |
| 作り直せるファイルの置き場は`paths.work_dir()`が決める | `test_localwork.py` | [§9.109](../../docs/decisions/9.109.md) |
| 参照データを増やすときは`データソースマスタ`の1行 | `test_datasource.py` | [決まり](../../docs/decisions/rules-misc.md) |
