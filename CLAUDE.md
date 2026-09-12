# WaveLog 開発メモ（AIアシスタント向け）

**このファイルは規則だけを持つ。** なぜそうなのか（実測値・撤回した案・
踏んだ罠）は各行の「くわしく」の先——[`docs/decisions/`](docs/decisions/README.md)
（302の決定記録＋主題別の索引）にある。**触る前にその先を開くこと。**

構成の詳細は `docs/ARCHITECTURE.md`、機能と起動方法は `README.md`、
スケジュール機能そのものの設計は `docs/SCHEDULE_MODE_DESIGN.md`（§1〜§13）。
構造と画面の評価と、次に取り組む候補の一覧（推奨順・評価関数つき）は
`docs/REVIEW_2026-09.md`（利用者の指示: 構造の改善案を優先し、画面の見た目が
変わるものは都度確認して少しずつ）。

## 作業の進め方（利用者からの恒久的な指示・最優先）

**この2つは、このファイルの他のどの記述よりも優先する。** どちらも
「勝手に始めない／勝手に思い出したことにしない」という同じ趣旨で、
**セッションが変わっても・話題が変わっても常に効く。**

### A. フルスイートは、指示があるまで実施しない

**`tests/run_all.sh` を引数なしで回すのは、利用者が明示的に指示したときだけ。**
自分の判断で「コミット前だから」「念のため」で通しを回さないこと。

- ふだんは**テスト名を指定して回す**（`tests/run_all.sh test_sccat test_roll`）か、
  `tests/run_all.sh --changed`（変更ファイルから対応表で選ぶ・§9.103）を使う。
- **回していないことは必ず言う。** 「関連するテストだけ回した／フルスイートは
  回していない」と報告に書くこと。黙っていると、通したものとして読まれる。
- **この規則は下の「検証」節の記述に優先する。** あちらには
  「コミット前は必ず引数なしで通しを回す」と書いてあったが、**利用者の指示で
  撤回した**（回すかどうかを決めるのは利用者）。

### B. 会話が圧縮されたら、要約ではなく実物を読み直してから続ける

会話の圧縮（コンテキストの要約）が起きたら、**そのまま作業を再開しないこと。**
要約は「何をしていたか」の写しであって、**いま何が真実か**ではない。

圧縮のあと、コードへ触る前に必ずこの順でやる:

1. **実物を読み直す。** 要約の記述を根拠にしない——直近で参照・編集した
   **実ファイル**と、**進捗メモ**（スクラッチパッドの `PROGRESS.md` 等）を
   実際に開いて読む。`git status` / `git log --oneline -5` / `git diff` で
   **いまの作業ツリーの事実**も確かめる（**ブランチとバージョンまで見ること**
   ——コンテナが作り直されて作業ツリーだけ巻き戻っていることが実際にあった）。
2. **直前の依頼を再確認する。** 依頼の原文（利用者の言葉）に当たり直す。
3. **3点を要約して先に提示する**——「**今の依頼内容**」「**対象**（どのファイル・
   どの画面・どのブランチ）」「**次にやること**」。
4. **認識が合っているかを利用者に確認してから**続ける。**ズレがあれば、
   コードを変更する前に指摘する。**

**進捗メモは圧縮に備えて先に書いておくこと**（依頼の原文・対象・済み／次の一手・
運用上の約束）。圧縮されてから書こうとしても、そのときには材料が消えている。
**ただしスクラッチパッドは消えることがある**（コンテナが作り直されると
作業ツリーごと巻き戻り、メモも消える。実際に起きた）ので、**残す価値のある
ことは push とコミットメッセージへ書く**——読み直せる場所は、最後は
リモートのブランチだけ。だから**こまめに push すること。**

## 画面を作るときの基準（利用者からの恒久的な指示）

**認知心理学・情報アーキテクチャ・色彩心理学に基づき、認知コストを最小化し、
理解性・操作性・美しさを最大化する。さらに、ユーザーに探させず・思い出させず・
推測させず、必要な情報と次の行動を文脈に応じて先回りして提示し、目的達成を
支援するUI/UXを設計する。**

これは**すべての画面に常時かかる基準**で、直す画面だけの話ではない。
「探させない」＝今どこに何があるかを画面が言う、「思い出させない」＝前に
決めた値・前の画面の文脈をこちらが運ぶ、「推測させない」＝出どころ・単位・
効くタイミングを書く。迷ったらこの順で判断する:

1. **面積は「頻度 × 重要度」で配る。** 1回決めるだけのものに画面の1/3を
   割かない（測定画面がまさにそうなっていた。§9.122）。
2. **次にすることを常に1つだけ指す。** 探させない・数えさせない。
3. **状態は色だけで伝えない。** 必ず文字（分類名・件数・理由）を添える。
4. **できないことは、できないと書く。** 押せるのに何も起きないボタンを
   残さない（使えない機能はボタンごと消す）。
5. **危ない操作を主要動線に置かない**（「完了」の隣に「削除」を置かない）。
6. **出どころ・単位・根拠を画面に出す。** 同じ数字でも当たる見込みが違う
   （見積の4段、公差の出どころ、進捗の分母）。
7. **見た目の値はトークンから選ぶ**（色・文字サイズ・余白・重なり順）。
   リテラルを新しく足さない。
8. **同じ情報を2箇所に出さない。** 同じ数字が並ぶと、読む側は「違うもの
   かもしれない」と数え直すことになる（§9.129で進捗が3箇所に出ていた）。
9. **情報欄は縦にそろえる。** ラベル列は固定幅にする——`auto`だと項目ごとに
   値の左端がずれ、視線が列を追えなくなる。
10. **枠は「まとまり」だけに使う。** 読み取り専用の値に入力欄風の枠を付けない
   （押せそうに見える）。枠の中に枠を作らない。装飾で情報を増やさない。
11. **入れ物は中身の長さから決め、決めた幅は規格へ丸める。** 1桁しか入らない
   欄に250pxを与えない、短い選択肢のプルダウンを器いっぱいに伸ばさない、
   2行しかない一覧に7行の高さを取らない。**器がグリッドの1マスぶんに自動で
   伸びるのを放置しない**——`max-width`（または`size`）を中身から決めて、
   余りは空白にする。長さがマスタ由来で分からないものは**実際の選択肢を
   測って決める**（§9.130の`fitControlWidths()`）。
   **ただし中身なりの幅をそのまま使うと、1画面に何種類もの幅が生まれて
   並ばない**（実測19種）。測った幅は`--w-*`の**直近上位へ丸め**、
   **同じ群の中は群の最大へそろえる**（§9.131）。中身から決めることと
   きれいに並ぶことは、規格へ丸めて初めて両立する。
12. **余白があるなら、タブの裏に隠しているものを出す。** 意味のない余白を
   極力なくす——空きは「器が中身より大きい」ではなく「置くべきものを別の
   場所へ隠している」ことの現れであることが多い（§9.131。測定画面の3段は
   タブ5枚を畳んでいたが、実測すると場所は余っていた）。
13. **カードの配置は「可能な限り粗いグリッド」で組む**（§9.135）。外側は
   **横4×縦3**（1マス437×307px）、形は6種だけ（`1×1`/`2×1`/`1×2`/`2×2`/
   `4×1`/`2×3`）。**細かくするのはカードの内側だけ**——外から見えるのは
   カード1枚なので、中が5列でも画面はがたつかない。グリッドを細かくすると
   余白は詰められるが、**左端の候補が増えてそろって見えなくなる**
   （横12にすると候補が12通り）。マスが余ったら、①タブの裏の情報を出して
   埋める→②カードを1段小さくする→③余らせたままにする、の順。
   **列を増やして詰めない。**
14. **視覚導線と作業導線を一致させる。** 左から右・上から下の並びが、
   実際にする順番と同じであること（①これは何か→どう測るか、②どこを測る→
   入れる→根拠、③あと何が残っているか→何が記録されたか）。

## 必ず守ること（不変条件の表）

コードを触る前に、**触る場所の束をひととおり読む**こと。行は「守ること」
だけを書いてある——**なぜそうなのか・実測値・撤回した案・踏んだ罠は
「くわしく」の先**（[`docs/decisions/`](docs/decisions/README.md)）にある。
直す場所が分かっている規則は、そこを開いてから触る。

（525件。「固定する網」は `tests/run_all.sh <名前>` で回す）

### 起動・停止・監視（26件）

| 守ること | 固定する網 | くわしく |
| --- | --- | --- |
| 起動前の確認は`setup.bat`が受け持ち、刻印で飛ばす | `test_faststart.py` | [§9.225](docs/decisions/9.225.md) |
| サーバー再起動 | — | [決まり](docs/decisions/rules-misc.md) |
| 起動基盤に触るとき | — | [決まり](docs/decisions/rules-misc.md) |
| 「開いているタブが0件」は2つの意味を持つ | `test_tabclose.py` | [§9.98](docs/decisions/9.98.md) |
| 起動オーバーレイ（`#appBoot`） | `test_boot.py`・`test_bootui.js` | [決まり](docs/decisions/rules-misc.md) |
| 枠線なしでも「区切り」と「設備停止」を見分けられるようにする | — | [§9.295](docs/decisions/9.295.md) |
| 作業以外の行は「題名だけ」。内容の列を束ねて置く | `test_scprint.js` | [§9.294](docs/decisions/9.294.md) |
| 渡したことと、見えていることは別。見えていなければアプリを直接開く | `test_bootopen.py` | [§9.318](docs/decisions/9.318.md) |
| 起動できない端末のことは、その端末から言えるようにする | `test_bootreport.js` | [§9.163](docs/decisions/9.163.md) |
| ブラウザへ渡したファイルを、その起動のあいだ差し替えない | `test_faststart.py` | [§9.255](docs/decisions/9.255.md) |
| 「0件になった時刻」はタブが名乗った時点で捨てる | `test_tabclose.py` | [§9.98](docs/decisions/9.98.md) |
| 起動の白画面は入り口が5つとも塞がっている。残るのは`import`の21秒 | — | [§9.255](docs/decisions/9.255.md) |
| 説明文（docstring）にWindowsのパスをそのまま書かない | `test_pywarn.py` | [§9.275](docs/decisions/9.275.md) |
| 掃除してよいのは「消えても取り直せるもの」だけ | `test_cleanup.py` | [§9.249](docs/decisions/9.249.md) |
| テストをまとめる線引きは「同じ画面を見るために同じ起動を待っているか」 | — | [§9.249](docs/decisions/9.249.md) |
| 設備停止の入口は`#scStopButtons`の1つ | `test_scstop.js` | [§9.181](docs/decisions/9.181.md) |
| データソースは「名称」も再起動待ち | `test_dsrestart.js` | [§9.183](docs/decisions/9.183.md) |
| データソースの読み込み先は「今マスタにある行」から作る | — | [§9.163](docs/decisions/9.163.md) |
| 「どこから読むか」はデータソースの行が1つだけ持つ | `test_datasource.py`・`test_dscap.py` | [§9.168](docs/decisions/9.168.md) |
| 「更新は届いたが再起動していない」をサーバーが答える | — | [§9.200](docs/decisions/9.200.md) |
| この端末の呼び名は起動時に1回だけ決めて持つ | `test_pcname.py` | [§9.208](docs/decisions/9.208.md) |
| 資材(JS/CSS)は`?t=`付きなら長期キャッシュへ回す | `test_assetcache.py` | [§9.97](docs/decisions/9.97.md) |
| ループバック(127.0.0.1)への問い合わせはプロキシを通さない | — | [決まり](docs/decisions/rules-misc.md) |
| 仕掛/品質データのローカル運用 | — | [決まり](docs/decisions/rules-misc.md) |
| フォルダ構成 | — | [決まり](docs/decisions/rules-misc.md) |
| 起動スクリプトは CRLF 改行で保存する | `test_faststart.py` | [§9.229](docs/decisions/9.229.md) |

### データの置き場と共有（50件）

| 守ること | 固定する網 | くわしく |
| --- | --- | --- |
| ログビュワー（`backend/routes/logs.py`／`static/js/core/log-view.js`）は「1行」でなく「1件」で扱う | `test_logs.py`・`test_logview.js` | [§9.99](docs/decisions/9.99.md) |
| 新しいキャッシュは`WL.ttlCache()`を使う | — | [§9.67](docs/decisions/9.67.md) |
| 共有のデータは「読むのは写し・書くのは実物」で揃える | `test_recmirror.py` | [§9.268](docs/decisions/9.268.md) |
| `config/local.json`のパスは環境変数を展開する。保存は書いたまま | — | [§9.268](docs/decisions/9.268.md) |
| `config/local.json`を読めなかったことを黙らないこと | — | [§9.271](docs/decisions/9.271.md) |
| 置き場はフォルダで書いてよい。答えるのは`resolve_db_file()`の1箇所 | — | [§9.271](docs/decisions/9.271.md) |
| 画面から来る「入/切」は`flags.flag_of()`の1箇所で真偽へ直す | `test_flags.py` | [§9.324](docs/decisions/9.324-1.md) |
| SQLiteの入出力は`backend/sqlite_io.py`、置き場の答えは`db_access`、書込は`bootstrap()` | `test_dblayer.py` | [§9.329](docs/decisions/9.329.md) |
| 作業予定を「読む側」は写しに書かない | `test_scsnapread.py` | [§9.325](docs/decisions/9.325.md) |
| 在席は端末ごとに1ファイル。切断は「書き込みだけ」を止める | `test_presence.py`・`test_presenceui.js` | [§9.272](docs/decisions/9.272.md) |
| 置き場の答えは`backend/storage_layout.py`の1箇所 | `test_storage.py`・`test_storageui.js` | [§9.267](docs/decisions/9.267.md) |
| 測定データは設備ごとに1ファイル。置き場の答えは`db_access`の1箇所 | `test_recsplit.py` | [§9.258](docs/decisions/9.258.md) |
| 測定データの保存は端末内と共有DBの両方へ | `test_share.js` | [§9.91](docs/decisions/9.91.md) |
| 編集セッションは「名乗る役」。止める役はやめた | `test_scowner.py`・`test_scwho.js` | [§9.291](docs/decisions/9.291.md) |
| 同期のタイミングはチップを押すと開く。秒読みはしない | — | [§9.292](docs/decisions/9.292.md) |
| 終わる前に片付ける。片付けは`watchdog.teardown()`の1箇所 | `test_appquit.js`・`test_scowner.py` | [§9.108](docs/decisions/9.108.md) |
| 書込役が応答しないときは、理由を見分けて引き取れる | `test_appquit.js`・`test_scowner.py` | [§9.163](docs/decisions/9.163.md) |
| 「いつのデータか」に答えるチップは1つ。畳んだ先に打つ手を2つ置く | `test_scbar.js` | [§9.292](docs/decisions/9.292.md) |
| 説明の量は`hintHtml()`の1箇所で決める | — | [§9.274](docs/decisions/9.274.md) |
| 表の切り替えはヘッダーのバッジ1つ。器（`#tabs`）は動かさない | — | [§9.288](docs/decisions/9.288.md) |
| 「右端に空ける幅」は1つの変数が持つ。詳細度の競争をしない | — | [§9.250](docs/decisions/9.250.md) |
| 数を扱う道具は「そのまま打つ」の1枠に収める | `test_opwidget.js` | [§9.250](docs/decisions/9.250.md) |
| 「いま見ているのはいつのデータか」は元データの時刻 | — | [§9.286](docs/decisions/9.286.md) |
| 選ぶ的は行いっぱい。印は押す物ではない。全選択は文字のボタン | `test_scpick.js` | [§9.363](docs/decisions/9.363.md) |
| 選んでからまとめて動かせる | `test_multidrag.js`・`test_scpick.js` | [§9.177](docs/decisions/9.177.md) |
| 共有スケジュールは「変わったときだけ」取り込む | `test_scwatch.py`・`test_scwatchui.js` | [§9.188](docs/decisions/9.188.md) |
| 共有スケジュールへ書くのは1台だけにできる | `test_scowner.py` | [§9.192](docs/decisions/9.192.md) |
| 読んだデータは「何として使うか」を選べる | — | [§9.193](docs/decisions/9.193.md) |
| 遅い書き込みには「保存しています…」を出す | `test_savechip.js`・`test_savechip.py` | [§9.273](docs/decisions/9.273.md) |
| 設定の保存の状態は`WL.saveState`が1箇所に出す | — | [§9.212](docs/decisions/9.212.md) |
| 上部メニューバーへ物を足すときは「余り」を測ってから | `test_scwho.js` | [§9.211](docs/decisions/9.211.md) |
| 見栄えは「重ねない・そろえる・囲みすぎない」を数で固定する | `test_msteps.js` | [§9.129](docs/decisions/9.129.md) |
| 読み取り専用のデータソースは`cfg()`で開く。`DBS[...]['path']`を直に使わない | — | [§9.198](docs/decisions/9.198.md) |
| 遅いときは「どこが遅いか」を画面に出す | — | [§9.198](docs/decisions/9.198.md) |
| 親ロットの印は「親」（数字なし）か「子N」（件数つき） | — | [§9.199](docs/decisions/9.199.md) |
| 「新しい版あり」は同じ物差しで比べる | — | [§9.208](docs/decisions/9.208.md) |
| 共有スケジュールの置き場はフォルダで指定できる | — | [§9.262](docs/decisions/9.262.md) |
| マスタを共有に置くときは作業予定と同じ書込サイクルを通す | `test_mastershare.py` | [§9.263](docs/decisions/9.263.md) |
| 共有の置き場は1枚で見せる。判定はサーバーが持つ | `test_pcshare.js` | [§9.260](docs/decisions/9.260.md) |
| 共通設定は「図 → 章のレール → 章（欄＋その場の状態）」 | — | [§9.208](docs/decisions/9.208.md) |
| 空き（ダミー）は「カード1枚」の属性 | — | [§9.228](docs/decisions/9.228.md) |
| 仕掛由来の添え書きは1行・置き場を選べる | — | [§9.233](docs/decisions/9.233.md) |
| 接続先はすべてSQLite（Access接続は廃止） | `test_dbopen.py` | [決まり](docs/decisions/rules-misc.md) |
| マスタの保存先は`db/master.sqlite3`に集約 | — | [§9.27](docs/decisions/9.27.md) |
| パス設定マスタ | — | [§9.192](docs/decisions/9.192.md) |
| 共有上の読み取り専用DBは`db_mirror`が手元へ写し、画面は写しを読む | `test_dbmirror.py` | [決まり](docs/decisions/rules-misc.md) |
| Windowsは開いているファイルを置き換えられない | `test_atomicio.py`・`test_dbmirror.py` | [§9.108](docs/decisions/9.108.md) |
| `with connect(...) as c:` は接続を閉じない | `test_mastershare.py` | [§9.270](docs/decisions/9.270.md) |
| 作り直せるファイルの置き場は`paths.work_dir()`が決める | `test_localwork.py` | [§9.109](docs/decisions/9.109.md) |
| 参照データを増やすときは`データソースマスタ`の1行 | `test_datasource.py` | [決まり](docs/decisions/rules-misc.md) |

### APIとルート（16件）

| 守ること | 固定する網 | くわしく |
| --- | --- | --- |
| 権限区分（開発者／メンテナンス者／一般ユーザー）は「何を触れるか」と別の軸 | — | [§9.272](docs/decisions/9.272.md) |
| マスタのAPIは9つの段。Blueprintは`_base.py`の1つのまま | `test_routesplit.py` | [§9.333](docs/decisions/9.333.md) |
| 画面から来るJSONは`body(spec)`で読む。鍵は必ず宣言する | `test_body.py` | [§9.330](docs/decisions/9.330.md) |
| ルートの「失敗の受け方」は`api_guard`の1箇所 | `test_apiguard.py` | [§9.324](docs/decisions/9.324-1.md) |
| 区分は4つ。「設備作業者」はマスタを出さない。段は`マスタ編集`の1列 | `test_roleperm.py`・`test_roleui.js` | [§9.163](docs/decisions/9.163.md) |
| データ一覧の「0件」は「無い」とは限らない | `test_recperm.js` | [§9.107](docs/decisions/9.107.md) |
| 日付・直の枠は「上位階層の箱」。行いっぱい×3行 | `test_scframe.js` | [§9.238](docs/decisions/9.238.md) |
| 更新者IDは名乗るだけ。答えるのは`current_login_id()`の1箇所 | — | [§9.276](docs/decisions/9.276.md) |
| 選択肢の「よく使う順」は並べる余地のある形だけ | — | [§9.248](docs/decisions/9.248.md) |
| タイムラインの「内容」も同じ列レイアウトマスタ | `test_sccols.js` | [§9.246](docs/decisions/9.246.md) |
| スケジュールの編集権は1設備1名。在席を出し、奪えるようにする | `test_modeguard.py`・`test_scsession.py`・`test_scwho.js` | [§9.211](docs/decisions/9.211.md) |
| 列設定の保存は「送った項目だけ書く」 | `test_colsave.py` | [§9.212](docs/decisions/9.212.md) |
| 自動／手動のバッジは常に同じ位置に出す | — | [§9.210](docs/decisions/9.210.md) |
| 取り消せない操作を主要動線に置かない | `test_recdel.js` | [§9.221](docs/decisions/9.221.md) |
| 編集可能モード/閲覧モード/スケジュールモード | `test_modeguard.py` | [決まり](docs/decisions/rules-misc.md) |
| 作業スケジュール表の「見えるもの」はモードで変えない | `test_scmodecols.js` | [§9.246](docs/decisions/9.246.md) |

### マスタ（サーバー側）（16件）

| 守ること | 固定する網 | くわしく |
| --- | --- | --- |
| エラーを捨てるときは理由を1行残す。黙って捨てない | `test_quietlint.py` | [§9.328](docs/decisions/9.328.md) |
| マスタ1表の列定義は`TableDef`の1箇所 | `test_tabledef.py` | [§9.324](docs/decisions/9.324-1.md) |
| 測定画面から選択肢マスタへ足せる。既定は足せない | `test_opinline.js` | [§9.323](docs/decisions/9.323-1.md) |
| 設備の有効・無効は「機能ごと」。保存値は「使わない機能」 | `test_eqfeature.js` | [§9.132](docs/decisions/9.132.md) |
| 移行済みの旧マスタは「無ければ作らない」 | `test_rawmaster.py` | [§9.255](docs/decisions/9.255.md) |
| 設備マスタは表が主役・修正はモーダル | — | [§9.250](docs/decisions/9.250.md) |
| 既定の品質データ結合は解除できる | — | [§9.194](docs/decisions/9.194.md) |
| `.mm-field`の中のチェックボックスに幅を与えないこと | `test_shift.js`・`test_workable.js` | [§9.197](docs/decisions/9.197.md) |
| `optionFill()`は候補に無い現在値を黙って捨てる | — | [§9.204](docs/decisions/9.204.md) |
| マスタの群は「その画面で何をするか」で分ける。群の中は決める順 | `test_master.js`・`test_mmtable.js` | [§9.264](docs/decisions/9.264.md) |
| 説明文の` | — | [§9.222](docs/decisions/9.222.md) |
| 組み込みの入力欄も、見出しはマスタの項目名で書き換える | `test_oppad.js` | [§9.228](docs/decisions/9.228.md) |
| 群は「列でも区切れる」 | — | [§9.226](docs/decisions/9.226.md) |
| 設備名を持つマスタを増やしたら、改名連動の一覧へ足す | `test_opchoice.js` | [§9.221](docs/decisions/9.221.md) |
| 設備停止マスタの`[設備名]`は「対象設備」 | `test_stopeq.js` | [決まり](docs/decisions/rules-misc.md) |
| ③「記録した値」は操業データ項目マスタが決める | `test_recvalues.js` | [§9.242](docs/decisions/9.242.md) |

### マスタ管理の画面（13件）

| 守ること | 固定する網 | くわしく |
| --- | --- | --- |
| マスタ管理のJSは「定義／盤／専用画面」の5本。受け渡しは`WL.mm`の1つ | `test_loadorder.py` | [§9.324](docs/decisions/9.324-1.md) |
| 盤を入れた段は縦積みにする。折り返す横並びのままだと高さが決まらない | `test_rbmodal.js` | [§9.291](docs/decisions/9.291.md) |
| 器の高さを与えないと窓は中身なりで止まる | `test_rbmodal.js` | [§9.254](docs/decisions/9.254.md) |
| 操業データ項目のレイアウトは設備ごとに重ねる。行は複製しない | `test_opdata.py` | [§9.239](docs/decisions/9.239.md) |
| `esc()`は「属性にも使う」ので引用符まで逃がす | `test_rbcells.js` | [§9.276](docs/decisions/9.276.md) |
| 落とす場所の印で盤を動かさない | `test_opui.js` | [§9.218](docs/decisions/9.218.md) |
| 浮きパネルの中に絶対配置のポップアップを作らない | — | [§9.201](docs/decisions/9.201.md) |
| 設定ページは段（タブ）＋畳み（アコーディオン） | `test_measstore.js`・`test_pcshare.js`・`test_setpage.js` | [§9.261](docs/decisions/9.261.md) |
| 操作が少ない画面の操作列は1行目へ相乗りさせる | — | [§9.266](docs/decisions/9.266.md) |
| 盤の落とし先は「カーソルの真下の物」で決める | `test_oppad.js` | [§9.230](docs/decisions/9.230.md) |
| マスタ管理の汎用CRUDは4本セット | `test_crudroutes.py` | [決まり](docs/decisions/rules-misc.md) |
| 「記録した値」の並べ方は専用の盤が持つ | — | [§9.243](docs/decisions/9.243.md) |
| 「既定へ戻す」は本当に空へ帰す | — | [§9.243](docs/decisions/9.243.md) |

### 一覧と列（113件）

| 守ること | 固定する網 | くわしく |
| --- | --- | --- |
| 一覧を描き直すときはスクロール位置を`renderGrid()`の入口で控える（戻すのは並べ終えてから） | `test_scpick.js` | [§9.357](docs/decisions/9.357.md) |
| 仕掛一覧から伏せるロットは`WL.scheduleView.hiddenLotSet()`の1箇所が答える | `test_wipgone.js` | [§9.368](docs/decisions/9.368.md) |
| 一覧のJS（`list-view.js`）は閉じてある。外から呼ぶのは`WL.list`の17個。`typeof`の判定も名前空間で書く | `test_eslint.py` | [§9.355](docs/decisions/9.355.md) |
| 条件を足す入口はボタン。検索欄の顔をした器を同時に2つ出さない | `test_filter.js` | [§9.345](docs/decisions/9.345.md) |
| 読み込みの秒数は**遅いときだけ**出す。「遅い」の答えは`WL.slowLoadMs`の1箇所。チップを消しても内訳の入口は残す | `test_listcache.js` | [§9.340](docs/decisions/9.340.md) |
| 関数の定義は1箇所 | `test_patchlint.py` | [§9.96](docs/decisions/9.96.md) |
| どの列を出すかはサーバーが決めない | — | [§9.165](docs/decisions/9.165.md) |
| 一覧の描画で「ブラウザに測らせない・一度に渡さない」 | `test_listperf.js` | [§9.94](docs/decisions/9.94.md) |
| 一覧は「横に見えている列」しか本文を作らない | `test_listperf.js` | [§9.104](docs/decisions/9.104.md) |
| `#grid th`の`position:sticky`を詳細度で打ち消さないこと | `test_gridhead.js` | [§9.104](docs/decisions/9.104.md) |
| 一覧の見せ方（`列レイアウトマスタ`／`一覧表示設定マスタ`）は全置換 | `test_colformat.js`・`test_collayout.js`・`test_colrule.js`・`test_colsort.js`・`test_displayrule.py` | [§9.88](docs/decisions/9.88.md) |
| 列の見せ方は「みんなと同じ／自分だけ」を一覧ごと・人ごとに選べる | `test_colscope.py`・`test_colscopeui.js` | [§9.259](docs/decisions/9.259.md) |
| 列の設定パネルは触った結果をそのまま一覧へ出す | `test_lcpanel.js` | [§9.90](docs/decisions/9.90.md) |
| 見出し側の操作も`WL.listColumnKeys()`の1本の並びで保存する | `test_collayout.js` | [§9.110](docs/decisions/9.110.md) |
| 列は名前で引くので、同じ名前を2つ並べない | — | [§9.113](docs/decisions/9.113.md) |
| 列マスタの保存は全置換なので、渡す設定を1つでも書き漏らさない | — | [§9.113](docs/decisions/9.113.md) |
| 式で作る列に`eval`を使わないこと | `test_formula.js` | [§9.111](docs/decisions/9.111.md) |
| 列の設定パネルは「出どころ」で分類する | `test_lcpanel.js` | [§9.105](docs/decisions/9.105.md) |
| 番号・ボタンの列も「出す/出さない」に従う | — | [§9.105](docs/decisions/9.105.md) |
| マスタ管理のタブは「いつの分の応答か」で描く | `test_mmswitch.js` | [§9.331](docs/decisions/9.331.md) |
| 画面の共有状態`S`の鍵は`base.js`の1つのリテラルだけが決める。`Object.seal(S)`で後付けを断る | `test_globallint.py` | [§9.327](docs/decisions/9.327.md) |
| 列の設定パネルは差し替え口で使い回す | `test_sccontent.js` | [§9.120](docs/decisions/9.120.md) |
| 列幅は「自動／手動／固定」の3つ | `test_collayout.js` | [§9.119](docs/decisions/9.119.md) |
| 紙の列幅を測るときは「作業以外の行も束ねない形で」測る | — | [§9.296](docs/decisions/9.296.md) |
| リンクマスタの盤は「左＝まとまりの入れ物／右＝親子の木」 | `test_choicelinkui.js` | [§9.197](docs/decisions/9.197.md) |
| 親を選ぶと子の候補が絞られる。絞り込みの表はサーバーが答える | `test_choicelink.py`・`test_opparent.js` | [§9.163](docs/decisions/9.163.md) |
| 仮想行の先取りは「画面の高さ」から決める | `test_allrows.js` | [§9.94](docs/decisions/9.94.md) |
| 一覧の文字は`--tbl-fs`。画面ごとに散らさない | — | [§9.296](docs/decisions/9.296.md) |
| 紙の列の幅は「実際に刷る文字」から決められる | — | [§9.294](docs/decisions/9.294.md) |
| 紙の文字は「文字が切れない限界」まで。余白は列の幅の一部 | — | [§9.293](docs/decisions/9.293.md) |
| 一覧の下の余白は測って決める。空けた場所には役目を持たせる | `test_scbar.js` | [§9.292](docs/decisions/9.292.md) |
| 窓は先に出してから中身を組み立てる。`initialHidden`の`null`は「保存値が正」 | `test_actuals.js` | [§9.292](docs/decisions/9.292.md) |
| 紙の文字は「余っているぶんだけ大きく」。幅と文字は必ず同じ比率で動かす | — | [§9.292](docs/decisions/9.292.md) |
| 一覧を広く使う印は`body.sc-wide`の1つ。戻る道は必ず1つ見えている | `test_scbar.js` | [§9.292](docs/decisions/9.292.md) |
| 後から足した列を「無ければ足す」のは`db_access.add_missing_columns()`の1箇所 | `test_ddllint.py` | [§9.216](docs/decisions/9.216.md) |
| ピッチ判定の塊は器の幅で段を切り替える | `test_rptext.js` | [§9.320](docs/decisions/9.320.md) |
| 使用設備は`WL.equipment`が1箇所で書き、変わったら知らせる | `test_dbequip.js` | [§9.285](docs/decisions/9.285.md) |
| 仕掛の生の列は`source.<列名>`。「まとめて1つの鍵」の入れ物は`.`で割らない | — | [§9.285](docs/decisions/9.285.md) |
| 「内訳の列数」が空のときは、マスの並びから列数を当てる | — | [§9.279](docs/decisions/9.279.md) |
| 選ばせる札が3段に折れると窓が画面より高くなる | `test_rollwipe.js` | [§9.255](docs/decisions/9.255.md) |
| 子ロットの折りたたみバッジは列を選べる。既定はロット番号 | `test_scbar.js`・`test_scprint.js` | [§9.235](docs/decisions/9.235.md) |
| 印刷は「画面のさわやかな見た目」に寄せる: 枠線ON/OFF・列の範囲・幅は自然体 | `test_scprint.js` | [§9.236](docs/decisions/9.236.md) |
| 予定から外す受け皿は掴んでいる間だけ出す | `test_scdrop.js` | [§9.116](docs/decisions/9.116.md) |
| その場フィルタは登録もトークン化もしない | `test_adhoc.js` | [§9.238](docs/decisions/9.238.md) |
| 並びに載っている列は全部掴める。幅の下限をCSSで持たない | — | [§9.239](docs/decisions/9.239.md) |
| 子ロットは畳んでいる間DOMを作らない | `test_gridchild.js` | [§9.239](docs/decisions/9.239.md) |
| 表の揃えは`WL.columnAlign`の1箇所が答える | — | [§9.239](docs/decisions/9.239.md) |
| 専用の画面（`special:*`）を汎用の描き直しで潰さない | — | [§9.276](docs/decisions/9.276.md) |
| 説明文に生のHTMLタグを書かない。長い説明は畳んで階層にする | `test_hintlint.py` | [§9.276](docs/decisions/9.276.md) |
| 【§9.299で組み直した】操業データ項目の設定窓は「見本の帯＋3列」 | — | [§9.288](docs/decisions/9.288.md) |
| 一覧の道具（`#grid`・`#tabs`・`#genericFilterBar`・`#listToolbar`）を伏せるのは`90-state.css`の`:is()`1本 | `test_actuals.js` | [§9.288](docs/decisions/9.288.md) |
| 実績データの列は「帳票と同じ候補」から作る | — | [§9.288](docs/decisions/9.288.md) |
| Excelの読み書きは`backend/xlsx_io.py`の1箇所。依存を足さない | `test_rollio.py` | [§9.240](docs/decisions/9.240.md) |
| マスタ一覧はカテゴリごとに畳め、移行済みは消せる | — | [§9.250](docs/decisions/9.250.md) |
| マスタの表は並べ替え・列幅調整できる。道具は`WL.columnWidthGrip`を使い回す | — | [§9.250](docs/decisions/9.250.md) |
| 決めることが多い編集窓は段（タブ）に分ける | — | [§9.250](docs/decisions/9.250.md) |
| 専用タブを持たないマスタもマスタ管理の階層で編集する | `test_rawmaster.py` | [§9.249](docs/decisions/9.249.md) |
| 足した選ばせ方は`メニュー`と`切替`。`一覧`と同じ顔にしない | — | [§9.247](docs/decisions/9.247.md) |
| 列の並びは「描くときに絞り、保存するときは絞らない」 | `test_colkeep.js` | [§9.248](docs/decisions/9.248.md) |
| 列の絞り込みは「出どころ」と「表示中/非表示中」の2軸 | — | [§9.248](docs/decisions/9.248.md) |
| 選ばせ方は束ねて出す。語彙はサーバーが持つ | — | [§9.248](docs/decisions/9.248.md) |
| 見せる範囲は「実施した設備」で絞る。設備の無い記録は隠さない | `test_eqscope.js` | [§9.248](docs/decisions/9.248.md) |
| まとめて入れる／まとめて外すは対で持つ | `test_scpick.js` | [§9.170](docs/decisions/9.170.md) |
| フィルタの持ち出し・取り込みは「フィルタだけ」 | `test_filterio.js` | [§9.171](docs/decisions/9.171.md) |
| 適用中のフィルタは端末に覚える | `test_filteractive.js` | [§9.175](docs/decisions/9.175.md) |
| 登録一覧は「組み合わせごとの節」。作るのは2手（選ぶ→名前を付ける） | `test_filtergroup.js` | [§9.287](docs/decisions/9.287.md) |
| 【主動線は§9.287で作り替えた】群＝プリセットの入れ物 | — | [§9.287](docs/decisions/9.287.md) |
| ページめくりは一覧ツールバーが持つ | — | [§9.286](docs/decisions/9.286.md) |
| スケジュール表の列も全部が列レイアウトマスタに乗る | `test_sctimecols.js` | [§9.176](docs/decisions/9.176.md) |
| 列の設定もファイルへ持ち出せる | `test_colio.js` | [§9.178](docs/decisions/9.178.md) |
| 開いたときの表示と、カーソル位置への追加 | `test_scinsert.js` | [§9.179](docs/decisions/9.179.md) |
| 開く前に用意し、見えないものは作らない | `test_scwarm.js` | [§9.182](docs/decisions/9.182.md) |
| 「いつも適用（固定）」は1つの印 | `test_filterlock.js` | [§9.190](docs/decisions/9.190.md) |
| 鍵付き・デフォルトのフィルタは「当てる前に取る」 | `test_filterkeep.js` | [§9.184](docs/decisions/9.184.md) |
| フィルタは個人のもの／共有のものを分けて持つ | `test_filteruser.js` | [§9.172](docs/decisions/9.172.md) |
| 読み替えルールの編集は「書いた本人が確かめられる」ことが要件 | `test_colrule.js` | [§9.117](docs/decisions/9.117.md) |
| 丈の表の列幅は見出しではなく中身から配る | — | [§9.160](docs/decisions/9.160.md) |
| データ一覧も表の規格に載せる | — | [§9.161](docs/decisions/9.161.md) |
| データ一覧の表示列は仕掛一覧と同じパネルを流用する | `test_reccols.js` | [§9.162](docs/decisions/9.162.md) |
| 「この設定でできること」はサーバーの1箇所が答える | `test_dscap.py` | [§9.163](docs/decisions/9.163.md) |
| 見出しの操作（列幅・右クリック）は1つの道具を使い回す | — | [§9.164](docs/decisions/9.164.md) |
| クエリ結合は`クエリ結合マスタ`の1行、実処理は`backend/query_join.py`の1箇所 | `test_qjoin.py`・`test_qjoinui.js` | [§9.193](docs/decisions/9.193.md) |
| 突合の定義は`クエリ結合マスタ`の1行。用途で使いみちを分ける | `test_finishjoin.py`・`test_qjoinui.js` | [§9.365](docs/decisions/9.365.md) |
| 利用者が入れた設定を「保存されていない既定」にしない | `test_finishjoin.py`・`test_qjoinui.js` | [§9.367](docs/decisions/9.367.md) |
| 完了突合は登録された行だけが効く。無ければ変換しない | `test_finishjoin.py`・`test_actualmatch.py` | [§9.367](docs/decisions/9.367.md) |
| スケジュール表で使う結合は選べる。保存値は「使わない」側 | `test_finishjoin.py` | [§9.365](docs/decisions/9.365.md) |
| 結合の仕方は「3つの真偽値」で持つ | `test_qjoin.py`・`test_qjoinui.js` | [§9.194](docs/decisions/9.194.md) |
| 突合キーは両側の列を並べて結ぶ | `test_qjoinui.js` | [§9.197](docs/decisions/9.197.md) |
| 表の列の区切りは「隙間の中」へ引く | — | [§9.197](docs/decisions/9.197.md) |
| 列幅は「掴んでいる間と離してから0.3秒」邪魔しない | `test_sctimecols.js` | [§9.197](docs/decisions/9.197.md) |
| 列の設定は掴むたびに`get()`で取り直す | — | [§9.211](docs/decisions/9.211.md) |
| 列幅を掴んでいる間の描き直しは`WL.columnResize.defer()`へ預ける | — | [§9.211](docs/decisions/9.211.md) |
| `WL.columnLayout`は3枚の重ね | `test_sctimecols.js` | [§9.212](docs/decisions/9.212.md) |
| 日付は「現場歴」と「太陽暦」の2列 | — | [§9.197](docs/decisions/9.197.md) |
| 挿入位置のゴーストで表を動かさない | `test_scinsert.js` | [§9.196](docs/decisions/9.196.md) |
| 同じグリッドに並べる行は、見出しも本文も同じ文字サイズにする | — | [§9.193](docs/decisions/9.193.md) |
| 幅は規格へ丸め、群の中でそろえる | `test_msteps.js` | [§9.131](docs/decisions/9.131.md) |
| 行の印は既定で付けない | — | [§9.201](docs/decisions/9.201.md) |
| スケジュール表の列の既定は1箇所でだけ判断する | `test_scbar.js`・`test_sctimecols.js` | [§9.207](docs/decisions/9.207.md) |
| 横スクロールする一覧の地と罫線はセルが持つ | — | [§9.208](docs/decisions/9.208.md) |
| 畳んだ左メニューの行き先は浮き出しで示す | `test_nav.js` | [§9.265](docs/decisions/9.265.md) |
| 列幅の余りは「何も無い場所」が受ける | — | [§9.209](docs/decisions/9.209.md) |
| マスタのモーダルの入力欄は型から決まる規格幅 | — | [§9.221](docs/decisions/9.221.md) |
| 切れたボタンは`title`では救えない | `test_fit.js` | [§9.222](docs/decisions/9.222.md) |
| `minmax(0,1fr)`と`auto`を1つのグリッドに混ぜない | — | [§9.222](docs/decisions/9.222.md) |
| 保存したら窓は閉じる。失敗したら閉じない | — | [§9.222](docs/decisions/9.222.md) |
| 単位を置くのは`placeUnit()`の1箇所、基準は「見えている操作面」 | `test_opunit.js` | [§9.233](docs/decisions/9.233.md) |
| 計算式の列にも表示ルールが効く／他の列だけのルールも当たる | `test_colrule.js`・`test_colsave.py`・`test_sctimecols.js` | [§9.234](docs/decisions/9.234.md) |
| 予定を描くたびに仕掛一覧を作り直さない | — | [§9.224](docs/decisions/9.224.md) |
| 段（タブ）に分けた窓は、描かれていない段の値を控えから読む | — | [§9.223](docs/decisions/9.223.md) |
| 条の設計カードの3点 | `test_splitlive.js` | [§9.221](docs/decisions/9.221.md) |
| 「どれが仕掛でどれが品質か」はキーでなく`データソースマスタ`の`[役割]` | `test_datasource.py`・`test_dskeylint.py`・`test_dsnav.js` | [決まり](docs/decisions/rules-misc.md) |
| 仕掛から消えたロットは実績で突き合わせる。在席は「仕掛にも在る列」だけで見る | `test_actualmatch.py` | [§9.364](docs/decisions/9.364.md) |

### 測定画面（83件）

| 守ること | 固定する網 | くわしく |
| --- | --- | --- |
| 公差の答えは`WL.tolerance`の登録表。描いたあとに足すのは`WL.measureHooks`へ登録し、被せない | `test_patchlint.py`・`test_tolscale.js` | [§9.348](docs/decisions/9.348.md) |
| テストの待ちは`tests/lib/wait.js`の道具で「条件」で置く | — | [§9.324](docs/decisions/9.324-1.md) |
| 紙の「混入位置」の何条目かは赤太字。赤は1つ | — | [§9.323](docs/decisions/9.323-1.md) |
| 異常位置の条混入位置は3か所まで。1か所ぶんの計算は`spotOf()`の1箇所 | `test_rpdefect.js` | [§9.323](docs/decisions/9.323-1.md) |
| 紙の「合うロール径」に式を書かない | — | [§9.323](docs/decisions/9.323-1.md) |
| 測定の桁は「測定器が保証できるところまで」 | `test_devdigits.js` | [§9.320](docs/decisions/9.320.md) |
| 公差の桁は測定値と同じにそろえる | — | [§9.320](docs/decisions/9.320.md) |
| 測定画面のレールは「通常使うボタン」だけにする | `test_devdigits.js` | [§9.320](docs/decisions/9.320.md) |
| 公差外は完了を止めない。止めるのは「誰が測ったか」だけ | `test_ngdone.js` | [§9.319](docs/decisions/9.319.md) |
| 読み取り専用のデータソースは`cfg()`で開き、開く前に存在を確かめない | `test_ctxfail.js`・`test_srcread.py` | [§9.198](docs/decisions/9.198.md) |
| 見本（デモ）は「いまの入力の決まり」に乗せる | `test_rbcells.py`・`test_rbsample.js` | [§9.321](docs/decisions/9.321.md) |
| 見本のロットは器の上限まで埋める | `test_rbsample.js` | [§9.254](docs/decisions/9.254.md) |
| 操業データの「自動」項目は式で作れる。評価器は増やさない | `test_opauto.js`・`test_opformula.js` | [§9.256](docs/decisions/9.256.md) |
| 設定窓の見本は`WL.opData.buildPreviewField()`の1本で作る | — | [§9.276](docs/decisions/9.276.md) |
| フィルタの「組み合わせ（プリセット）」は行そのもの。条件は何回でも使える | `test_filtergroup.js` | [§9.288](docs/decisions/9.288.md) |
| 選ばせ方の顔ぶれを網へ直に書かない | `test_oppad.js`・`test_opui.js` | [§9.288](docs/decisions/9.288.md) |
| 操業データ項目の設定モーダルは「見本＝上の帯（高さ固定）／設定＝多段組み」 | — | [§9.288](docs/decisions/9.288.md) |
| ロールを見分けるのは6つ（設備名・ロール名・接触面・径MAX・径MIN・備考） | `test_roll.js`・`test_rollio.py` | [§9.257](docs/decisions/9.257.md) |
| ロールはまとめて消せる／ファイルの内容そのものに入れ替えられる | `test_rollio.py`・`test_rollwipe.js` | [§9.251](docs/decisions/9.251.md) |
| 手打ちの席が無い形では、設定を押せなくして理由を書く | — | [§9.247](docs/decisions/9.247.md) |
| ロールマスタは1ロール1設備。判定は`WL.defect.rollMatches`の1箇所 | `test_roll.js` | [§9.239](docs/decisions/9.239.md) |
| フィルタは「条件 → その組み合わせ」の2層。バーに出すのは組み合わせだけ | — | [§9.287](docs/decisions/9.287.md) |
| 効いている条件は「アイコン＋件数」の1バッジ。中身はポップオーバー | — | [§9.287](docs/decisions/9.287.md) |
| 「選ばない」の札の字は`WL.optionBlankLabel`の1箇所 | — | [§9.287](docs/decisions/9.287.md) |
| 操業データ項目の保存は`opSaveItem()`の`body`に全部載せる | — | [§9.287](docs/decisions/9.287.md) |
| 「誰が・どの端末で」は登録と更新を分けて持つ | `test_audittrail.js` | [§9.180](docs/decisions/9.180.md) |
| 測定画面は「準備→測定→確認」の3段 | `test_msteps.js` | [§9.123](docs/decisions/9.123.md) |
| ②測定は「項目リスト＋測定表」で、表は使う条数ぶんだけ描く | — | [§9.124](docs/decisions/9.124.md) |
| 測定中の巡回キーは持たない | `test_msteps.js` | [§9.160](docs/decisions/9.160.md) |
| 入力内容の「母材」と「揃い/肉厚/長さ」は1つの項目 | `test_mcore.js`・`test_msteps.js`・`test_opmother.js` | [§9.160](docs/decisions/9.160.md) |
| 母材の「計算全長（参考）」は元データがそろったときだけ出す | — | [§9.160](docs/decisions/9.160.md) |
| 屑幅の割り付けは`WL.split.scrapInfo()`の1箇所が答える | `test_splitlive.js` | [§9.160](docs/decisions/9.160.md) |
| 操業データは「何を記録するか」をマスタが決める | `test_msteps.js`・`test_opdata.py` | [§9.215](docs/decisions/9.215.md) |
| 選ばせ方（プルダウン/ラジオ/タブ/一覧）は`<select>`を残したまま被せる | — | [§9.218](docs/decisions/9.218.md) |
| 操業データ項目の設定はモーダルで開く | — | [§9.218](docs/decisions/9.218.md) |
| 設定窓の未保存の変更は、遅れて届いた再読み込みで捨てない（`opState.dirty`の1件だけ残す） | `test_opunit.js` | [§9.361](docs/decisions/9.361.md) |
| ③測定データ分析は「板厚・板幅のMIN/MAX」が主役 | `test_msteps.js` | [§9.214](docs/decisions/9.214.md) |
| 条の図のロット番号は幅で桁数を変える | `test_splitlive.js` | [§9.213](docs/decisions/9.213.md) |
| 屑幅の片寄せは図の縁を掴んで直せる | — | [§9.167](docs/decisions/9.167.md) |
| ②の「丈位置くらべ」は出ていない丈のためにある | — | [§9.128](docs/decisions/9.128.md) |
| 中身を減らしたら器も減らす | `test_msteps.js` | [§9.126](docs/decisions/9.126.md) |
| 入れ物の大きさは中身の長さから決める | `test_msteps.js` | [§9.130](docs/decisions/9.130.md) |
| ①準備は役割でまとめ、③確認は完了前の確認表を持つ | `test_msteps.js` | [§9.125](docs/decisions/9.125.md) |
| 測定中は受信欄(`#deviceInput`)のDOMを作り直さない・動かさない | `test_mcore.js` | [§9.122](docs/decisions/9.122.md) |
| 測定データの置き場は3段 | `test_measstore.js` | [§9.202](docs/decisions/9.202.md) |
| 揃いは「選んで記録」。4桁の揃いコードは廃止した | — | [§9.203](docs/decisions/9.203.md) |
| 揃いの合否は切断面等級から出す | — | [§9.204](docs/decisions/9.204.md) |
| 測定の手で打つ数値欄は`WL.numericInput`に乗せる | — | [§9.208](docs/decisions/9.208.md) |
| 手動入力ではカーソルを印に追従させる。自動転送では絶対に触らない | — | [§9.208](docs/decisions/9.208.md) |
| 母材の欄は打った時点でレコードへ入れる | — | [§9.208](docs/decisions/9.208.md) |
| 測定の見出しは1行 | — | [§9.209](docs/decisions/9.209.md) |
| 測定表は器に入るぶんだけ縮める | — | [§9.209](docs/decisions/9.209.md) |
| 測定の見出しは2行まで | — | [§9.210](docs/decisions/9.210.md) |
| 条の図のラベルは幅ごとにまとめて決める | — | [§9.210](docs/decisions/9.210.md) |
| 屑幅がマイナスになる条数は受け付けない | — | [§9.210](docs/decisions/9.210.md) |
| 分割の無いロットでも条の図を出す | — | [§9.209](docs/decisions/9.209.md) |
| 現場が触る選択肢は「操業データ選択肢マスタ」の1枚 | `test_opchoice.js` | [§9.221](docs/decisions/9.221.md) |
| 器の高さを中まで届ける鎖は1段でも抜かない | — | [§9.222](docs/decisions/9.222.md) |
| 組み込みの欄も型以外はすべて設定できる | — | [§9.229](docs/decisions/9.229.md) |
| 測定の控えは「ロットの事実」と「マスタの設定」を分ける | — | [§9.229](docs/decisions/9.229.md) |
| 上下限はマスタから引ける。引けなかった値を0にしない | `test_oplimit.js` | [§9.231](docs/decisions/9.231.md) |
| 母材の欄も操業データの項目 | `test_opmother.js` | [§9.232](docs/decisions/9.232.md) |
| `valueEl()`は「書ける欄」。画面に出ている欄は`outputEl()`／`displayEl()` | — | [§9.233](docs/decisions/9.233.md) |
| マスタが差配している欄の印は`opf-host`の1つ | — | [§9.233](docs/decisions/9.233.md) |
| 進捗の分母はマスタが届いてから塗り直す | `test_opmother.js` | [§9.234](docs/decisions/9.234.md) |
| 条の設計カードは1画面に収める。減らすのは冗長な文だけ | `test_defectlink.js`・`test_splitlive.js` | [§9.234](docs/decisions/9.234.md) |
| 測定の見出しは1行。公差は1箇所でだけ言う | `test_msteps.js` | [§9.234](docs/decisions/9.234.md) |
| 自動で入る値・計算値も操業データの1行にする | `test_opauto.js`・`test_opdata.py` | [§9.234](docs/decisions/9.234.md) |
| 条の設計の印は流れの中へ置き、操作の行は縮ませない | `test_splitlive.js` | [§9.233](docs/decisions/9.233.md) |
| 手入力の案内は入れる場所のすぐ上／測定の見出しは1行 | `test_msteps.js` | [§9.233](docs/decisions/9.233.md) |
| 設定窓は「選んでも1pxも動かない」 | — | [§9.227](docs/decisions/9.227.md) |
| 空き（ダミー）の群は「印を持つ1行」で作る | `test_oppad.js` | [§9.227](docs/decisions/9.227.md) |
| 異常位置判定は`WL.defect.markers()`が1箇所で答える | `test_defectlink.js` | [§9.226](docs/decisions/9.226.md) |
| 必須はカードではなく「構成」が持つ | `test_opdata.py`・`test_opui.js` | [§9.223](docs/decisions/9.223.md) |
| 操業データの単位は9マスの盤で置く | — | [§9.221](docs/decisions/9.221.md) |
| 測定値の桁は`measurementDigits()`の1箇所が決める | `test_mcore.js` | [§9.242](docs/decisions/9.242.md) |
| バリの2段は測定の見出しのバッジが出す | `test_burr.js` | [§9.242](docs/decisions/9.242.md) |
| 「公差」と「基準」は`WL.measureItem.limitWord()`の1箇所が言い分ける | — | [§9.242](docs/decisions/9.242.md) |
| 測定値の統計は`stat.<項目>.<集計>`。語彙はサーバーが持つ | `test_rpprint.js` | [§9.242](docs/decisions/9.242.md) |
| 「選択肢を持つか」はサーバーでも族で見る | `test_opdata.py` | [§9.244](docs/decisions/9.244.md) |
| 統計は「条に紐づくか」で2種類に分かれる | `test_rpprint.js` | [§9.244](docs/decisions/9.244.md) |
| 「選ばない」の札は空文字だけではない | `test_opblank.js` | [§9.246](docs/decisions/9.246.md) |
| ロールは「設備名＋ロール名＋接触面＋径MAX＋径MIN＋備考」で1本 | `test_rollio.py` | [§9.246](docs/decisions/9.246.md) |

### 作業スケジュール（21件）

| 守ること | 固定する網 | くわしく |
| --- | --- | --- |
| 作業スケジュールの「開始」は着手できる**全行**に出す（次の1本は現場が自由に選ぶ。先頭N行に絞らない） | `test_workable.js` | [§9.339](docs/decisions/9.339.md) |
| 外した予定は「仕掛にまだ在るとき」だけ一覧へ戻す。在席は3値・不明なら戻す | `test_wipgone.js` | [§9.368](docs/decisions/9.368.md) |
| 選んだ予定のロット番号はつないでコピーできる。つなぎ方は`WL.lotCopy.joinLots()`の1箇所 | `test_lotcopy.js` | [§9.368](docs/decisions/9.368.md) |
| 書込が失敗したら必ず理由を言う。`onFailure`があることを「知らせた」と数えない（見出しは`SC_OP_LABEL`の1箇所） | `test_scfail.js` | [§9.372](docs/decisions/9.372.md) |
| 動かせない行は掴んだ時点で理由を言う。判定は`reorderableEntry()`と同じ順で見る | `test_scfail.js` | [§9.372](docs/decisions/9.372.md) |
| 区切りは「あたった決まりを書いた順にぜんぶ重ねる」。区切り文字は1文字に限らない（空白だけでも可） | `test_lotcopy.js` | [§9.371](docs/decisions/9.371.md) |
| さかのぼりの起点はサーバーの`history_from()`が1箇所で答える | `test_schistory.js` | [§9.366](docs/decisions/9.366.md) |
| 済んだ行の代表時刻は`actual.startAt`→`actual.endAt`→`finishedAt`の順 | `test_schistory.js`・`test_scrowstyle.js` | [§9.366](docs/decisions/9.366.md) |
| 稼働カレンダーは足りなくなったら伸びる | `test_scload.py` | [§9.291](docs/decisions/9.291.md) |
| 開始ボタンを作る場所は2つある。文字とHTMLは1箇所 | `test_workable.js` | [§9.51](docs/decisions/9.51.md) |
| 空の日付・直の枠は「ここから先の起点を進めるだけ」 | `test_scframe.js` | [§9.238](docs/decisions/9.238.md) |
| 申し送り（コメント）は時間を取らない | `test_sccomment.js` | [§9.189](docs/decisions/9.189.md) |
| 書込のあとは予定の時刻を取り直す | `test_scundecided.js` | [§9.185](docs/decisions/9.185.md) |
| 現場歴の日付補正は勤務区分マスタの1列 | `test_workdate.py` | [§9.195](docs/decisions/9.195.md) |
| 同じ材料なら作り直さない | — | [§9.198](docs/decisions/9.198.md) |
| 予定の起点は5分刻みへ切り上げる | — | [§9.198](docs/decisions/9.198.md) |
| 「表示範囲」は「さかのぼり」と言い、起点の日時を出す | — | [§9.198](docs/decisions/9.198.md) |
| 取りに行った応答は「いつの分か」で捨てる | `test_scsave.js` | [§9.200](docs/decisions/9.200.md) |
| 赤いまま残っている網は網ではない | — | [§9.200](docs/decisions/9.200.md) |
| 分割ありの親ロットは子ロットをぶら下げて予定へ入る | `test_scsplit.js` | [決まり](docs/decisions/rules-misc.md) |
| 見積の出どころは4段で、順番を入れ替えないこと | `test_eqstd.py` | [§9.114](docs/decisions/9.114.md) |

### 帳票と紙（89件）

| 守ること | 固定する網 | くわしく |
| --- | --- | --- |
| 紙は画面で開いている子ロットを出す。載せるかどうかを決めるのは`buildPages`の1箇所 | `test_scprint.js` | [§9.357](docs/decisions/9.357.md) |
| 紙まわり（用紙・`@page`・mm換算・列幅の配分・刷り出し）は`print-core.js`の1本 | `test_printcore.py` | [§9.332](docs/decisions/9.332.md) |
| ピッチ判定・異常位置判定の欄の見せ方は利用者が選べる | `test_rpdefect.js` | [§9.323](docs/decisions/9.323-1.md) |
| 作業予定表の印刷は「紙のための別の割り付け」 | `test_scprint.js` | [§9.115](docs/decisions/9.115.md) |
| 区切りの行間は「日付が変わる行」に効く | — | [§9.295](docs/decisions/9.295.md) |
| マスの持ちものを紙へ運ぶ口は`rpCellTuple()`の1つ。1つも落とさない | — | [§9.296](docs/decisions/9.296.md) |
| 行・列を「最大」で出せる。既定は「その塊の今までの出し方」 | `test_rbsample.js`・`test_rpblocks.js` | [§9.132](docs/decisions/9.132.md) |
| 紙ぜんたいの余白を選べる。詰める段は「溢れたときだけ」動く | `test_rpblocks.js` | [§9.163](docs/decisions/9.163.md) |
| 書き下ろしは「1つの並び」で測る。2つを混ぜると塊が重なる | `test_rplayout.js` | [§9.163](docs/decisions/9.163.md) |
| 書き戻してよい高さは「利用者が決めた高さ」だけ | — | [§9.174](docs/decisions/9.174.md) |
| 紙の余白は「横」と「縦」の別の軸。横は文字の表示領域を広げる | `test_rpblocks.js` | [§9.294](docs/decisions/9.294.md) |
| 数で決まる設定は「− 数 ＋」の1組。値ごとに札を並べない | `test_blockbuild.js`・`test_rbmodal.js` | [§9.247](docs/decisions/9.247.md) |
| 書き下ろし（`rpSeedPositions`）が書くのは「置き場所」だけ | `test_csslint.py`・`test_rplayout.js` | [§9.222](docs/decisions/9.222.md) |
| 縁を引くとき、重なっても縮めない | — | [§9.223](docs/decisions/9.223.md) |
| 紙の文字は太字にできる。既定の大きさは「大」 | — | [§9.294](docs/decisions/9.294.md) |
| 紙の列は画面の列。印刷専用の列を既定で足さない | — | [§9.293](docs/decisions/9.293.md) |
| 幅と文字は別の答え。文字は幅の圧縮に引きずられない | — | [§9.293](docs/decisions/9.293.md) |
| 印刷プレビューの設定は3段（タブ）＋足元の要約 | — | [§9.293](docs/decisions/9.293.md) |
| 印刷範囲は「日付」か「選んだ予定」で絞る。日付は打たせない | `test_scprint.js` | [§9.292](docs/decisions/9.292.md) |
| 帳票のマスは「ラベルを上下」にできる。印はマスが持つ | — | [§9.292](docs/decisions/9.292.md) |
| 帳票の表は「縮める前に余白を詰める」 | `test_rpblocks.js` | [§9.132](docs/decisions/9.132.md) |
| 帳票の半自動の塊も、渡していない設定は消えない | — | [§9.320](docs/decisions/9.320.md) |
| 紙の測定データ・丈別データの表は本文と同じ大きさ | — | [§9.320](docs/decisions/9.320.md) |
| 異常位置判定は、ピッチだけでも保存できる | `test_defectlink.js` | [§9.319](docs/decisions/9.319.md) |
| 紙の「異常位置判定」と「ピッチ判定」は別の塊 | `test_rpdefect.js` | [§9.319](docs/decisions/9.319.md) |
| 保存の往復のあいだに触ったぶんを捨てない | `test_rpsave.js` | [§9.263](docs/decisions/9.263.md) |
| 紙の余白は「紙の軸 × 塊の段」の掛け算。フォールバックで代用させない | `test_rppack.js` | [§9.289](docs/decisions/9.289.md) |
| 紙の配置は「触ったら裏で保存」。保存ボタンは持たない | `test_rpblocks.js` | [§9.113](docs/decisions/9.113.md) |
| 盤のマスの高さは実測して入れる | `test_rbmodal.js` | [§9.210](docs/decisions/9.210.md) |
| 「印刷」は画面ごとに1つ。判定は画面が登録で名乗る | — | [§9.233](docs/decisions/9.233.md) |
| 紙にだけ`print-color-adjust:exact`を付ける。説明を先に書かない | `test_rbsample.js`・`test_rpprint.js` | [§9.290](docs/decisions/9.290.md) |
| 帳票印刷の列は「紙専用の選び直し」を持たず、画面（`timeline:<設備>`）をそのまま使う | `test_scprint.js` | [§9.235](docs/decisions/9.235.md) |
| 帳票ブロックの中身は「セル」で持つ。並びに載せずに「出す」は作れない | `test_rbcells.js`・`test_rbcells.py` | [§9.274](docs/decisions/9.274.md) |
| 帳票ブロックの道は「記録の中の本当の置き場」を答える | — | [§9.285](docs/decisions/9.285.md) |
| 帳票の書式へ渡すのは「地方時へ直した値」。生のISOを渡さない | `test_rbcatalog.js` | [§9.285](docs/decisions/9.285.md) |
| 節の列数は`--rp-cols`が1本で運ぶ。クラスへ数を焼き込まない | `test_rpprint.js` | [§9.289](docs/decisions/9.289.md) |
| 帳票プレビューは用紙の切れ目を出す。物差しは紙の「幅」から作る | `test_csslint.py`・`test_rpprint.js` | [§9.281](docs/decisions/9.281.md) |
| 組み換え中も紙を割る。行を数えるのは`rpRowAtGrid()`の1箇所 | `test_rplayout.js`・`test_rpprint.js` | [§9.282](docs/decisions/9.282.md) |
| 組み換え中は紙をまたぐ塊を切らない。`clip-path`は当たり判定まで切る | — | [§9.283](docs/decisions/9.283.md) |
| ずらし量は測って答える。控えない | — | [§9.283](docs/decisions/9.283.md) |
| 「行の頭」と「その点を含む行」は別の関数 | — | [§9.283](docs/decisions/9.283.md) |
| 大きさを変える取っ手は四辺＋四隅の8方向 | — | [§9.283](docs/decisions/9.283.md) |
| 塊は名前が鍵。既定の塊と同じ名前の行を作らせない | — | [§9.282](docs/decisions/9.282.md) |
| 「中の並べ方」は表（ピボット）には当てない | `test_rbcells.py`・`test_rpmaster.js` | [§9.282](docs/decisions/9.282.md) |
| 盤で組んだマスの並びがあれば、それが紙の正 | — | [§9.278](docs/decisions/9.278.md) |
| 帳票ブロックの窓の見本は「紙と同じ組み立て」で描く | — | [§9.278](docs/decisions/9.278.md) |
| 大きさは「既定」だと欄の名前で言い切る | — | [§9.278](docs/decisions/9.278.md) |
| 表は「ピボット」で組む。軸は名前と値だけを持ち、置き場は盤が決める | `test_rbcells.js`・`test_rbcells.py`・`test_rpprint.js` | [§9.277](docs/decisions/9.277.md) |
| 帳票は「レイアウト（親）＋ブロック（子）」の2枚のマスタで持つ | `test_rlmaster.js` | [§9.254](docs/decisions/9.254.md) |
| 見本のロット1件で帳票を確かめる | `test_rbsample.js` | [§9.253](docs/decisions/9.253.md) |
| 用紙は「大きさ」と「向き」を分けて選ぶ。A4/B4/A3×縦/横 | `test_opsheet.js`・`test_scprint.js` | [§9.252](docs/decisions/9.252.md) |
| 用紙サイズ・向きはA4/A3×縦/横から選べる | — | [§9.235](docs/decisions/9.235.md) |
| 分割後の子ロットの情報は印刷ON/OFFでき、親子は同じ塊として改ページする | — | [§9.235](docs/decisions/9.235.md) |
| 「すべての設備を続けて印刷する」は成り代わって解く | — | [§9.235](docs/decisions/9.235.md) |
| 印刷プレビューの倍率は「見え方」で、メニューは「決める理由」で分ける | `test_scprint.js` | [§9.238](docs/decisions/9.238.md) |
| 帳票の配置は設備を選んで編集できる。紙は1枚ずつその設備で固定する | — | [§9.239](docs/decisions/9.239.md) |
| 帳票の「出していない塊」は左サイドバー（`.rp-nav`）に縦で置く | — | [§9.276](docs/decisions/9.276.md) |
| 紙の見本は四方から掴んで大きさを変えられる。ただし選べる値にしか止まらない | — | [§9.250](docs/decisions/9.250.md) |
| ダミーの値はサーバーが持つ | — | [§9.250](docs/decisions/9.250.md) |
| 帳票ブロックの編集窓は「4つの束＋紙の見本」 | `test_rbmodal.js` | [§9.249](docs/decisions/9.249.md) |
| 帳票の塊は子ロットごとに繰り返せる | `test_rpprint.js` | [§9.247](docs/decisions/9.247.md) |
| 印刷の合図は2つ持ってよいが、刷るのは1回だけ | `test_rpprint.js` | [§9.247](docs/decisions/9.247.md) |
| 同じ指摘が2度来たら、入れた機能ではなく既定を疑う | `test_rpprint.js` | [§9.248](docs/decisions/9.248.md) |
| 列ごとの並べ替えは「塊(bucket)」で持つ | — | [§9.187](docs/decisions/9.187.md) |
| コメントは「枠を置いてから書く」 | `test_sccomment.js`・`test_scprint.js` | [§9.191](docs/decisions/9.191.md) |
| 印刷はプレビューを先に出す | — | [§9.186](docs/decisions/9.186.md) |
| 測定データの表は「列の集まり」で持つ | `test_rpblocks.js` | [§9.173](docs/decisions/9.173.md) |
| 帳票の見せ方は設備ごとに覚える | `test_rpblocks.js` | [§9.174](docs/decisions/9.174.md) |
| 帳票の中身は「塊（ブロック）の並び」 | `test_rpblocks.js` | [§9.169](docs/decisions/9.169.md) |
| 帳票の空きマスはグリッドの中へ入れない | `test_rplayout.js` | [§9.218](docs/decisions/9.218.md) |
| 帳票の頭は「設備名・作業年月日・ロット番号」を同じ大きさで横に並べる | — | [§9.161](docs/decisions/9.161.md) |
| 操作列は1行に収める。畳んだ先の設定はボタンに書く | `test_scbar.js` | [§9.199](docs/decisions/9.199.md) |
| 帳票の`formats`へ文字列を入れないこと | `test_rpblocks.js` | [§9.205](docs/decisions/9.205.md) |
| 紙の上の座標は「拡大前」へ直してから測る | — | [§9.222](docs/decisions/9.222.md) |
| `widths`へ「数」を入れるのは掛け算ではなく足し算 | — | [§9.222](docs/decisions/9.222.md) |
| 「中身なり」の塊に高さを書き込まない | — | [§9.222](docs/decisions/9.222.md) |
| 断りの一言は「見えるところ」に出す | — | [§9.222](docs/decisions/9.222.md) |
| 大きさを変えても場所は動かさない | — | [§9.222](docs/decisions/9.222.md) |
| 帳票に「エリア（枠と文字）」の塊を足せる／枠は付け外しできる | `test_rpblocks.js` | [§9.234](docs/decisions/9.234.md) |
| 帳票カードの中の並べ方はCSSだけで組む | — | [§9.226](docs/decisions/9.226.md) |
| 帳票の塊は「選んで組み立てる」 | `test_blockbuild.js` | [§9.226](docs/decisions/9.226.md) |
| 帳票の編集中の見た目は刷り上がりそのまま | `test_rpblocks.js`・`test_rplayout.js` | [§9.223](docs/decisions/9.223.md) |
| 帳票の塊は「置きたいマスへ置く」 | `test_rpblocks.js`・`test_rplayout.js` | [§9.221](docs/decisions/9.221.md) |
| `widths`へ「数」を入れるときの倍率は、いちばん大きい数から決める | — | [§9.221](docs/decisions/9.221.md) |
| 帳票の紙の箱は、刷るときもプレビューと同じ | `test_rpprint.js` | [§9.242](docs/decisions/9.242.md) |
| 帳票の中の枠を器いっぱいへ伸ばすのは「高さを決めた塊」だけ | — | [§9.242](docs/decisions/9.242.md) |
| 盤の「見えている塊」と保存される並びを食い違わせない | `test_reclayout.js` | [§9.243](docs/decisions/9.243.md) |
| 紙に出すのは「帳票だけの1枚もの」 | `test_rpprint.js` | [§9.244](docs/decisions/9.244.md) |
| 帳票ブロックの中身はマトリクスで並べられる | `test_blockbuild.js` | [§9.245](docs/decisions/9.245.md) |

### 画面の土台（10件）

| 守ること | 固定する網 | くわしく |
| --- | --- | --- |
| 拡張は登録表へ: あとに足す`on`／前で断る`gate`／丸ごと持つ`own`（`WL.measureHooks`・`WL.listHooks`）。被せも全置換も作らない | `test_patchlint.py`・`test_tolscale.js` | [§9.352](docs/decisions/9.352.md) |
| 初回の案内は帯の1箇所。空の器は「ここに何が出るか」だけを言う | `test_uiux.js` | [§9.343](docs/decisions/9.343.md) |
| 窓は`confirmModal`／`alertModal`／`promptModal`の3つだけ。素の`alert`/`confirm`/`prompt`は呼ばない | `test_patchlint.py`・`test_modalkeep.js` | [§9.342](docs/decisions/9.342.md) |
| 窓は1枚しかない。窓の中から窓を開かない（名前を直すのはその場、消すのは行の中で2手） | `test_lotcopy.js` | [§9.368](docs/decisions/9.368.md) |
| メニューの入れ子は本体へ足す。1項目のHTMLと配線は`rowMenuItemsHtml`/`bindRowMenuItems`の1箇所 | `test_lotcopy.js` | [§9.368](docs/decisions/9.368.md) |
| `window.*`への新規公開は名前空間経由 | `test_globallint.py` | [決まり](docs/decisions/rules-misc.md) |
| 画面のJSは領域フォルダ。綴りは1つ | `test_loadorder.py` | [§9.334](docs/decisions/9.334.md) |
| 設定の窓は「決める順の番号付きの節」で、同じ値を2箇所に出さない | `test_eqsetup.js` | [§9.257](docs/decisions/9.257.md) |
| モーダルは背景クリックで閉じない | `test_modalkeep.js` | [§9.221](docs/decisions/9.221.md) |
| マスタの1行を直す窓は汎用モーダル1枚 | — | [§9.222](docs/decisions/9.222.md) |

### 見た目（CSS・寸法・色）（46件）

| 守ること | 固定する網 | くわしく |
| --- | --- | --- |
| 色のリテラルは増やさない（上限は`tests/fixtures/color_baseline.json`）。トークンと同じ値は`var()`で書く | `test_csslint.py` | [§9.350](docs/decisions/9.350.md) |
| 選ばれた札の見た目は`90-state.css`の束ね規則1箇所。族ごとに同じ3行を書かない | `test_csslint.py` | [§9.353](docs/decisions/9.353.md) |
| 色帯は「面」とセットのときだけ出す。面の無い帯は括弧に見え、列の罫線とも競合する | `test_density.js` | [§9.344](docs/decisions/9.344.md) |
| 目に見えない字（空白・タブ・改行）を見せる記号は`visibleChars()`の1箇所で1文字ずつ当てる | `test_lotcopy.js` | [§9.371](docs/decisions/9.371.md) |
| 所要時間の書き方は`WL.duration`の1箇所。既定は「分」、切り替えは「表示」バッジの1枚に畳む。時点（〜前／〜後）と間隔（〜ごと）は別の軸 | `test_patchlint.py`・`test_uisize.js` | [§9.341](docs/decisions/9.341.md) |
| 状態チップの色は「正常＝中立／設定要＝橙／赤は取り消せない操作だけ」。同じ橙に2つの意味を持たせない | `test_headbar.js` | [§9.338](docs/decisions/9.338.md) |
| 寸法は文字サイズから作る | `test_fit.js`・`test_typescale.js` | [§9.90](docs/decisions/9.90.md) |
| 色と文字サイズは`:root`のトークンから選ぶ | `test_theme.js` | [決まり](docs/decisions/rules-misc.md) |
| 表示件数の「全件」は「250件ずつ最後まで取り続ける」 | `test_allrows.js` | [§9.95](docs/decisions/9.95.md) |
| 同じセレクタの同じプロパティを2つのCSSファイルに書かない | `test_csslint.py` | [§9.324](docs/decisions/9.324-1.md) |
| 更新履歴の窓は中身の長さから決める | — | [§9.323](docs/decisions/9.323-1.md) |
| 作業以外の行の題名は「色・札・帯」と「位置・揃え」を選べる | — | [§9.295](docs/decisions/9.295.md) |
| 常時載っているカードは「頻度 × 重要度」で面積を配る | — | [§9.296](docs/decisions/9.296.md) |
| 紙のセルの余白は「左右」と「上下」で別の軸 | — | [§9.294](docs/decisions/9.294.md) |
| 日付（まとまり）の切り替わりの行間は別の軸 | — | [§9.294](docs/decisions/9.294.md) |
| アイコンのフォントは同梱する | `test_csslint.py`・`test_theme.js` | [§9.240](docs/decisions/9.240.md) |
| 紙は「余白 → 余力のある列 → 折り返し → 文字サイズ」の順で詰める | `test_rpblocks.js` | [§9.132](docs/decisions/9.132.md) |
| 紙は「画面の一覧の見た目」が正 | `test_csslint.py`・`test_scprint.js` | [§9.237](docs/decisions/9.237.md) |
| 列の一時的な色はマスタへ保存しない | `test_coltint.js` | [§9.239](docs/decisions/9.239.md) |
| 未入力の色・必須の橙・公差外の赤は`.opf-face`の1つの印へ当てる | `test_opblanktint.js` | [§9.288](docs/decisions/9.288.md) |
| 色は「いまどこに居るか」だけを語る | — | [§9.288](docs/decisions/9.288.md) |
| `--opf-num-w`のような共有の寸法を`em`で渡さない | `test_opunit.js` | [§9.257](docs/decisions/9.257.md) |
| 段を積む器は行を中身なりにする | — | [§9.250](docs/decisions/9.250.md) |
| セグメントとトグルは作りで分ける。トグルは「1枚の枠を割った形」 | `test_opwidget.js` | [§9.247](docs/decisions/9.247.md) |
| 意匠の「形」（角丸）は素のプルダウンと浮き窓まで届かせる | `test_oppad.js` | [§9.247](docs/decisions/9.247.md) |
| 未入力・未選択の配色は項目ごとに選べる。色は`WL.columnTint.PALETTE`の14色 | `test_opblanktint.js` | [§9.286](docs/decisions/9.286.md) |
| 意匠の「色」は13色＋既定。呼び名は未入力の配色と同じ語彙 | — | [§9.287](docs/decisions/9.287.md) |
| 重なり順は`--z-*`のトークンから選ぶ | — | [§9.112](docs/decisions/9.112.md) |
| 操業データの入力欄は「マスが幅を決め、欄は器いっぱい」 | — | [§9.218](docs/decisions/9.218.md) |
| 子ロットの行は親と同じ列定義を共有する | — | [§9.197](docs/decisions/9.197.md) |
| 新しい画面は`tests/test_scale.js`の巡回に入れる | `test_scale.js` | [§9.127](docs/decisions/9.127.md) |
| 表示サイズは3段階（`sm` .92 ／ `md` 1 ／ `lg` 1.1）。段を増やさない | `test_fit.js`・`test_uisize.js` | [§9.132](docs/decisions/9.132.md) |
| 行の見せ方（配色・アイコン）は`行表示マスタ` | `test_scrowstyle.js` | [§9.198](docs/decisions/9.198.md) |
| 差し込みの当たり判定は境目のそばだけ | `test_scbar.js` | [§9.199](docs/decisions/9.199.md) |
| 選ばせるものは「選ぶ前に見える」ようにする | — | [§9.200](docs/decisions/9.200.md) |
| 器と中身の文字サイズを食い違わせない | `test_msteps.js` | [§9.206](docs/decisions/9.206.md) |
| 列幅は掴んでいる側が動く | — | [§9.208](docs/decisions/9.208.md) |
| 汎用UIの高さは器の変数がそろえる | `test_oppad.js` | [§9.229](docs/decisions/9.229.md) |
| 縮んでよいのは案内だけ | `test_splitlive.js` | [§9.229](docs/decisions/9.229.md) |
| 選ばせ方は「選んだ札のほうが濃い」ことで示す | `test_oppad.js` | [§9.229](docs/decisions/9.229.md) |
| 段のバッジは短く。ロット情報は見切らせない | — | [§9.234](docs/decisions/9.234.md) |
| 自動で入る欄はカードの地で言う | `test_opdata.py`・`test_oppad.js` | [§9.234](docs/decisions/9.234.md) |
| 角丸が土台。ピルと角は使わない | `test_oppad.js` | [§9.227](docs/decisions/9.227.md) |
| 選ばせ方は「器の変数」でそろえる | `test_opdata.py`・`test_opui.js` | [§9.226](docs/decisions/9.226.md) |
| 「何で選ばせるか」と「どう見えるか」は別の軸 | — | [§9.223](docs/decisions/9.223.md) |
| 公差外・基準外は確認カードの色で気づかせる。NGの記録はその行の中 | `test_ngcard.js` | [§9.242](docs/decisions/9.242.md) |

### 検証（テスト）（26件）

| 守ること | 固定する網 | くわしく |
| --- | --- | --- |
| 網が当てにする物は「誰が作るか」を書けること。この端末の名乗りと権限はフィクスチャが持つ | `test_layers.py` | [§9.370](docs/decisions/9.370.md) |
| 後片付けは「消えた」で確かめる。ランナーの道は絶対、テストは名前空間で呼ぶ | `test_layers.py`・`test_waitlint.py` | [§9.362](docs/decisions/9.362.md) |
| 通しで落ちた本はランナーがその場で単独へ回して切り分ける。実績も1本ごとに空へ戻す | `test_layers.py` | [§9.356](docs/decisions/9.356.md) |
| マスタは1本ごとに丸ごと戻す。汚した本は指紋で名指しする。落ちた本は単独で2回、待ちは黙らない | `test_layers.py`・`test_waitlint.py` | [§9.360](docs/decisions/9.360.md) |
| 「いま」から引き直す値は幅で見る。言い切りは自分が作った行に限る。最初の描画は1回で測る | `test_wkfast.js`・`test_scsplit.js` | [§9.358](docs/decisions/9.358.md) |
| 実績を置く網は自分で消す。「作業中」を見る網は開始を打刻してから保存する（一時保存だけでは「予定」のまま） | `test_scsync.js`・`test_startwork.js` | [§9.351](docs/decisions/9.351.md) |
| 文書が指す名前・撮る道具の選択子は実在させる。関数の中の`import`は増やさない（理由は`# 遅延:`） | `test_docindex.py`・`test_importlint.py` | [§9.349](docs/decisions/9.349.md) |
| 固定待ち（`waitForTimeout`）とハーネスの写しは増やさない。網の骨組みは`tests/lib/harness.js`、待ちは`wait.js`の道具で | `test_waitlint.py` | [§9.347](docs/decisions/9.347.md) |
| `offsetParent`で「見えているか」を測らない。`position:fixed`と未組み立ての両方で`null`になる | — | [§9.346](docs/decisions/9.346.md) |
| テストが開く／取りに行く`static/js`の道は領域つきで実在するURL（`/static/js/…`）。取れた中身が短ければ落とす | `test_loadorder.py` | [§9.334](docs/decisions/9.334.md) |
| テストは3層（`--pure`＝サーバー不要・並列／`--smoke`＝各1本／全件は指示があったときだけ）。一覧の宣言は`run_all.sh`の1箇所 | `test_layers.py` | [§9.337](docs/decisions/9.337.md) |
| 1段目（純粋な網）は「まっさらな取得で通る」ものだけ。確かめ方は`git archive` | `test_layers.py` | [§9.369](docs/decisions/9.369.md) |
| 「物が無い」を欠陥として記録しない。測れないなら前提を作るか、測っていないと書く | `test_ddllint.py`・`test_layers.py` | [§9.369](docs/decisions/9.369.md) |
| 並列で回している網に、共有の`db/`の差分を自分のせいにさせない | `test_dblayer.py` | [§9.369](docs/decisions/9.369.md) |
| 更新履歴は版ごとに「利用者向け／開発の記録（`'dev':True`）」。判定は`changelog_data.is_dev()`の1箇所、画面は`e.dev`を読むだけ | `test_changelog.py`・`test_changelogui.js` | [§9.336](docs/decisions/9.336.md) |
| 知識の置き場は「規則＝CLAUDE.md の表／経緯＝`docs/decisions/9.xxx.md`」。§番号は振り直さない | `test_docindex.py` | [§9.335](docs/decisions/9.335.md) |
| 画面のJSの`no-undef`は0件。globalsは実物から作るので、IIFEで閉じると外からの呼び出しが出る | `test_eslint.py` | [§9.354](docs/decisions/9.354.md) |
| 画面のJS32本は全部閉じてある。土台は短い名前のまま`window.X=X`で明示公開、他は`WL.<領域>` | `test_globallint.py`・`test_eslint.py` | [§9.359](docs/decisions/9.359.md) |
| 標準の静的解析（pyflakes／eslint）は網の一部。規則は`eslint.config.mjs`の1箇所 | `test_eslint.py`・`test_pyflakes.py` | [§9.326](docs/decisions/9.326.md) |
| ピボットの軸は「行」「列」の2つの箱。掴んでも押しても動く | — | [§9.278](docs/decisions/9.278.md) |
| 段の札の高さは「文字×行送り」で決める。`overflow:hidden`の箱は中で切れる | — | [§9.253](docs/decisions/9.253.md) |
| 器の幅は測ってから決める。固定ぶんに数を足して追いかけない | — | [§9.250](docs/decisions/9.250.md) |
| `<col>`を細くしたら`table.style.width`も一緒に動かす | — | [§9.211](docs/decisions/9.211.md) |
| 並べ替えの確定は`drop`ではなく`dragend` | `test_scsave.js` | [§9.201](docs/decisions/9.201.md) |
| 浮きメニューは「開いた器を控える」までが1組 | `test_recdel.js` | [§9.222](docs/decisions/9.222.md) |
| 盤の右クリックは「よく使うものに絞る」 | — | [§9.228](docs/decisions/9.228.md) |
| 落ちたPythonテストを「全部PASS」と数えない | — | [§9.244](docs/decisions/9.244.md) |

### そのほか（15件）

| 守ること | 固定する網 | くわしく |
| --- | --- | --- |
| バージョン更新 | — | [決まり](docs/decisions/rules-misc.md) |
| フラットネスの全〇は「印を持つボタンだけ」を拾う | — | [§9.320](docs/decisions/9.320.md) |
| 畳んでよいのは「言い回し」だけ。単位・できること・取り違えを防ぐ事実は別 | — | [§9.255](docs/decisions/9.255.md) |
| `requirements.txt`は`flask`だけ。増やしたら網も書き直す | `test_noaccess.py` | [§9.268](docs/decisions/9.268.md) |
| 折り返す横並びの器へ「1行ぶんの物」を入れるときは`flex:1 0 100%` | — | [§9.250](docs/decisions/9.250.md) |
| 「選ばない」の札は値を持たない | `test_opblank.js` | [§9.286](docs/decisions/9.286.md) |
| 札の「字」は`WL.optionBlankLabel`、「未選択か」は値で見る | `test_opblank.js` | [§9.288](docs/decisions/9.288.md) |
| 説明文の印を解くのは`WL.markup()`の1箇所 | `test_changelog.py`・`test_changelogui.js` | [§9.286](docs/decisions/9.286.md) |
| 浮きウィンドウ（`WL.makeFloatingWindow`）の端は8方向 | — | [決まり](docs/decisions/rules-misc.md) |
| 応答がJSONでないときは状態コードから言い直す | — | [§9.200](docs/decisions/9.200.md) |
| 「空欄（選ばない）」の札は出さないようにできる | — | [§9.228](docs/decisions/9.228.md) |
| `<select>`に値の見せ方を当てない | — | [§9.221](docs/decisions/9.221.md) |
| フィールド名 | — | [決まり](docs/decisions/rules-misc.md) |
| 作業時間は分まで | — | [§9.242](docs/decisions/9.242.md) |
| start_app.batの文字コード | — | [決まり](docs/decisions/rules-misc.md) |

## 検証

- **フルスイートは指示があるまで実施しない**（利用者の恒久的な指示。冒頭の
  「作業の進め方」A）。既定は**テスト名を指定**するか`--changed`で、
  **回していないことを報告に必ず書く。**
- **欠陥注入で確かめるときは、直したあとに`__pycache__`を消すこと**（§9.267の追補）:
  Pythonの`.pyc`の既定の invalidation は**元ファイルの更新時刻（秒単位）と
  大きさ**なので、**同じ秒に・同じ大きさで書き戻すと`.pyc`が無効化されない**
  ——**直したはずのコードが古いまま動く**。欠陥注入は`sed`で入れて`cp`で戻すため
  この条件をそのまま満たす（実際に`SCHEDULE_LOCK_VERIFY_DELAY_NETWORK_MS`と
  `SCHEDULE_LOCK_VERIFY_DELAY_MS_DEFAULT`が**どちらも37文字**で踏んだ。
  網が「直したのに落ちたまま」になり、製品側を疑って探すことになる）。
  1秒以上あければ正しく無効化される。**置き場は`sys.pycache_prefix`**なので
  `backend/__pycache__`だけ消しても足りない——`%LOCALAPPDATA%\WaveLog\pycache`
  （Linuxでは`~/.local/share/WaveLog/pycache`）も消す。
  現場の運用では踏まない（人が編集して同じ秒に再起動し、しかも大きさが
  1バイトも変わらない、は起きない）ので、**製品側の作りは変えない。**
- **回帰テストは `tests/` にある。実行は `tests/run_all.sh` だけ**（1,624件）。
  引数にテスト名を並べるとそれだけ実行する（`tests/run_all.sh test_sccat`）。
  ランナーがパス設定マスタの退避→検証用フィクスチャへ差し替え→復元まで
  行うので、**手でパスを戻す必要はない**（`trap`で異常終了時も戻し、退避値は
  `tests/.saved_paths.json`にも残すのでコンテナごと落ちても次回が復元する）。
  テストを書くときの約束（後始末は`finally`・**落ちてもブラウザを閉じる**・
  固定待ち禁止・識別子は実行ごとに一意）は `tests/README.md` に、
  フィクスチャの作り直しは `python3 tests/make_fixture.py` にある。以前は
  scratchpad に置いておりセッションのたびに消えていた
  （`docs/REFACTORING_PLAN.md` フェーズ0で常設化）。
- **個人設定を消すときは「個人のまま」消す**（§9.274の追補）: 誰の行を読み書き
  するかは`column_layout_owner()`が答える（§9.259）ので、**先に「みんなのもの」へ
  戻してから消すと、消えるのは共通の行だけ**で個人の行が残る。
  `tests/test_colscopeui.js`の後始末がこの順で、**1回の実行につき37行**が
  `列レイアウトマスタ`へ積み上がっていた（実測436行）。消す→戻す→消す、の順。
- **落ちたテストを疑う前に、前の実行の置き土産を疑う**（§9.121）: 共有
  スケジュールDBは作業用コピーを作り直し、作業予定は1本ごとに`reseed`で
  戻すが、**「見せ方」の設定（列レイアウトマスタ・スケジュール内容表示
  マスタ）は`db/master.sqlite3`に残り、実行をまたいで生き延びる**。
  後片付け前に落ちたテストや手元の確認スクリプトの設定を、次の実行が丸ごと
  引き継ぐ。**壊れ方が遠いので本体の変更を疑って探すことになる**——
  `timeline:テスト設備A`で`lotNo`が非表示のまま残っていたせいで、内容欄とは
  何の関係も無い`test_orphan.js`が「実績がスケジュールに出ない」で3件落ちた
  （行の題名はロット番号を出す内容セルなので、隠すと探せなくなる）。
  ランナーは開始時に`resetcontent`で検証用設備ぶんを白紙へ戻す。
  **この呼び出しを消さないこと**、そして**手元の確認スクリプトにも
  後片付けを書くこと**（落ちた側の`catch`にも。今回の元凶がそれだった）。
- **検証用マスタDBは`reseed`のたびに戻す**（§9.284、`tests/make_fixture.py`の
  `fix_master()`）: 共有スケジュールDBと違い、**`db/master.sqlite3`はgitが
  持っていない**（`.gitignore`で`*.sqlite3`）。全テストがこの1つを共有して
  書き換えるので、**片付け損ねた1本が以降ずっと全部を巻き添えにする**。
  実測では、通しを数回まわしただけで**データソースの表示順が両方0**になり
  （左メニューの先頭が「品質データ」＝「分割」も「測定」も無い一覧を
  全部の網が見ていた）、**勤務体系が無効**になり（直が引けず現場日・実績データ表・
  枠の候補が全滅）、**旧マスタから移した選択肢が消え**（§9.255 ③で作り直さない
  ので**二度と戻らない**）、**`列レイアウト個人設定マスタ`に1行残り**（§9.259。
  1行で以降の全部が「保存したのにマスタに入っていない」を見る）、
  **`列レイアウトマスタ`の`list:`が積み上がって**いた（`resetcontent`は
  `timeline:`／`print:`／`report:`しか戻さない。回すたびに1列ずつ隠れていく）。
  **足りない行を戻し、名前で見分けられる屑だけ片付ける**（`RT%新設備`・`回帰_%`等。
  無差別に消すと、後片付けを持つ網の期待と食い違う）。**冪等にすること。**
  **抽出テーブル・既定テーブルは触らない**（フィクスチャの表の名前はここでは
  分からず、書き換えると一覧が開けなくなる）。43件の赤のうち**28件がこれ**だった。
- **「いま」から引き直す値を、時刻の一致で見ない**（§9.284、`test_scframe`）:
  予定の起点は展開のたびに`now`から引き直す（§9.198）ので、2回の問い合わせの
  あいだに**壁時計のぶんだけ必ず動く**（起点は5分刻みへ切り上げるので、境目を
  またぐと**5分跳ぶ**）。分まで（`slice(0,16)`）で比べていたため、**秒の境目を
  またいだ実行だけが落ちて**いた。**幅で見て、その幅の根拠を書くこと**——本物の
  失敗（枠が押し出す＝9日後）とゆらぎ（最大5分）が桁で離れているなら、
  あいだの1時間で取り違えない。**再実行で緑になったからといって「フレーク」で
  片付けないこと**（§9.200。落ちる仕組みを言えるまで探す）。
- **作業中の折り返しは`tests/run_all.sh --changed`**（§9.103）: 変更ファイル
  （`git diff` ＋ 追跡外）から関係するテストだけを`tests/pick_tests.py`の
  対応表で選ぶ。**通しの代わりではない**——「関係ない」の根拠はその手書きの
  表しかない。**ただし「コミット前は必ず引数なしで通しを回す」は撤回した**
  （冒頭の「作業の進め方」A。**通しを回すかどうかは利用者が決める**ので、
  絞り込みで回したことと、通していないことを報告に書く）。分からない
  ファイル・土台（`base.js`/`index.html`/`app.py`/`backend/config.py`/
  `run_all.sh`/`db/`）は全件へ倒れる。**テストやソースを足したら対応表にも
  足すこと**——`tests/test_pick.py`が「実体の無いテスト名」「どの規則からも
  呼ばれないテスト」「どの規則にも当たらないソース」で落ちる。
- **テストの待ちは「時間」でなく「条件」で置く**（§9.102）: 固定待ちは
  速い画面では無駄に待ち、遅い画面では足りない。レイアウトの確定は
  `requestAnimationFrame`2回、画面ぶんの取得は「取得中の数が0のまま静か」、
  モーダルは`waitForSelector`で待つ。`test_fit.js`は70秒→35秒になった
  （58秒が固定待ちだった）。**速くしたら「同じものを見ている」ことを
  確かめる**——「見つからない」ことを確かめるテストは、早すぎて何も
  描けていなくても素通りするので、両方PASSは証拠にならない。要素数の
  突き合わせと、本物の不具合の注入で確かめること。
- **走っている`run_all.sh`を止めない・止めるなら1本ずつ**（今回踏んだ）:
  `pkill -f run_all.sh`は**入れ子の子シェルにも当たる**ので、**先に死んだ側の
  `trap`がパス設定を本番へ戻し、生き残った側がフィクスチャのまま走り続ける**
  ——ランナー自身が禁じている「2本同時」と同じ状態になる。しかも生き残った側の
  `save_paths`が**フィクスチャのパスを「本番」として退避**するので、
  **元の設定が上書きで失われる**（`tests/.saved_paths.json`も消える）。
  **走っている最中に製品のファイルを編集しないこと**も同じ理由——JSはページを
  開くたびに読み直されるが**Pythonはサーバー起動時のまま**なので、
  「画面は新しい・サーバーは古い」状態の結果を見ることになる。
  やり直したいときは**終わるまで待つ**（`until grep -q 合計 …`）。
- **テストがブラウザを閉じずに落ちると連鎖する**: 残ったChromiumが設備の
  編集セッションを掴んだままハートビートを打ち続け、後続のスケジュール系の
  書込が全て「編集中です」で弾かれる（実際に1本のFATALから8本が落ち、
  ロックが効かない・並べ替えが反映されないという別々の不具合に見えた）。
  各テストは終了処理で必ず閉じ、ランナーも1本ごとに掃除する。
- Playwright ヘッドレス（Chromium: `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`、
  `NODE_PATH=/opt/node22/lib/node_modules`）。環境が違う場合は
  `WAVELOG_CHROMIUM`/`WAVELOG_PLAYWRIGHT`/`WAVELOG_NODE` で上書きする。
- **接続先が全てSQLiteになったため、仕掛/品質データ系API(`/api/table`等)も
  モック無しで検証できる**。ランナーが`db/test_fixture/`の`.sqlite3`を指すので、
  実際にサーバー経由で読める（以前はAccessドライバが無く500を返すため
  `page.route`でモックしていた。その必要は無い）。
- `openMeasurement`/`resumeStoredMeasure` は内部のマスタ問い合わせ失敗で
  例外を投げ得る。後続処理を確実に実行したいラップは `finally` に置く。

## Git

- 開発は featureブランチ（現行: `claude/path-config-master-management-djha13`）で行い、
  ユーザーの明示指示があった場合のみ main へマージする。
