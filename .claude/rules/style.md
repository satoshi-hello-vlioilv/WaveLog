# 見た目（CSS・寸法・色）（66件）

索引: [規則の置き場](README.md)｜入口: [CLAUDE.md](../../CLAUDE.md)

色と文字サイズのトークン・寸法の刻み・状態の見せ方

行は**守ることだけ**を書いてある。なぜそうなのか・実測値・撤回した案・踏んだ罠は
「くわしく」の先（[`docs/decisions/`](../../docs/decisions/README.md)）にある。
**直す前にその先を開くこと。**「固定する網」は `tests/run_all.sh <名前>` で回す。

| 守ること | 固定する網 | くわしく |
| --- | --- | --- |
| 字の太さは`--fw-body`／`--fw-ui`／`--fw-strong`（400／600／700）だけ。12px 以下の札は 600・`<b>`は 700 に止める | `test_csslint.py`・`test_smalltext.js` | [§9.562](../../docs/decisions/9.562.md) |
| 読ませる字は`--fs-sm`（12px）以上。10〜11px・9.5pxは図の中の字と記号だけ。新しい部品は12px未満を読ませる字に使わない | `test_smalltext.js` | [§9.560](../../docs/decisions/9.560.md) |
| 新しい部品のクラスの頭は**足す前に全CSS・全JSで引く**（`.lf-key`・`.rl-board`で既存の部品と衝突した） | `test_csslint.py` | [§9.553](../../docs/decisions/9.553.md) |
| 狭い窓の決まり（`max-width`）は`@media screen and`で画面にだけ（刷るときは紙の幅が窓の幅になる） | `test_screenprint.js` | [§9.525](../../docs/decisions/9.525.md) |
| ヘッダーの状態の札は「名前 値」の1行。字は隣の操作と同じ`--fs`、名前は細く薄く（`--ink-3`） | `test_headbar.js` | [§9.508](../../docs/decisions/9.508.md) |
| 画面名は縮ませない（譲るのは出どころの1行）。1180px以下は札の名前を畳む（名前は`title`が持つ） | `test_headbar.js` | [§9.508](../../docs/decisions/9.508.md) |
| 浮く面（`.wl-menu`）の中の塗りのボタンは**乗せた地も`--menu-item-hover`で宣言し直す**（`:hover`だけだと土台に負ける） | `test_listbar.js` | [§9.481](../../docs/decisions/9.481.md) |
| 表のセル（`td`）に`display:flex`を当てない。横並びは中の器が持つ（セルでなくなり罫線が段違いになる） | `test_bladeui.js` | [§9.469](../../docs/decisions/9.469.md) |
| レイヤ名は宣言した8つの中から選ぶ（綴り違いは**全部の後ろ**の別レイヤになり、`state`の「選ばれた札」が丸ごと死ぬ） | `test_csslint.py`・`test_bladeui.js` | [§9.427](../../docs/decisions/9.427.md) |
| 外から写した`@keyframes`は名前に印を付ける（`scale`/`rotate`は束ねると上書きし合う） | `test_uisize.js` | [§9.421](../../docs/decisions/9.421.md) |
| `<s>`は取り消し線の要素。薄い字に使うなら**器を増やすたび打ち消しの1行も増やす** | `test_bladeui.js` | [§9.420](../../docs/decisions/9.420.md) |
| 濃い地に`--danger-bg`／`--muted`を当てない（実測1.1:1）。`--nav-*`から選び**重ねた色で測る** | `test_theme.js` | [§9.409](../../docs/decisions/9.409.md) |
| 色のリテラルは増やさない（上限は`tests/fixtures/color_baseline.json`）。トークンと同じ値は`var()`で書く | `test_csslint.py` | [§9.350](../../docs/decisions/9.350.md) |
| 選択肢の札に添える印は**2つまで・短く**。溢れると名前のほうが切れる | `test_stopflow.js` | [§9.400](../../docs/decisions/9.400.md) |
| 連続して押すボタンは**大きさより「いつも同じ場所」**。手応えは結果を字で返すほうが受け持つ（実測 66→36px） | `test_scstop.js` | [§9.402](../../docs/decisions/9.402.md) |
| 入れた直後の時刻は**分からない**（前の行に`plannedEnd`が無い）。控えずに`—:—`と書き、予定が戻ってから入れる | `test_stopflow.js` | [§9.402](../../docs/decisions/9.402.md) |
| カードのラベル列は**固定幅で右揃え**（`auto`だと行ごとに値の左端がずれる） | `test_scstop.js` | [§9.402](../../docs/decisions/9.402.md) |
| 出入りする物の見た目は変えてよいが、**場所は動かさない**（動かすなら`opacity`だけ） | `test_scbar.js` | [§9.397](../../docs/decisions/9.397.md) |
| 選ばれた札の見た目は`90-state.css`の束ね規則1箇所。族ごとに同じ3行を書かない | `test_csslint.py` | [§9.353](../../docs/decisions/9.353.md) |
| 色帯は「面」とセットのときだけ出す。面の無い帯は括弧に見え、列の罫線とも競合する | `test_density.js` | [§9.344](../../docs/decisions/9.344.md) |
| 目に見えない字（空白・タブ・改行）を見せる記号は`visibleChars()`の1箇所で1文字ずつ当てる | `test_lotcopy.js` | [§9.371](../../docs/decisions/9.371.md) |
| 所要時間の書き方は`WL.duration`の1箇所。既定は「分」、切り替えは「表示」バッジの1枚に畳む。時点（〜前／〜後）と間隔（〜ごと）は別の軸 | `test_patchlint.py`・`test_uisize.js` | [§9.341](../../docs/decisions/9.341.md) |
| 状態チップの色は「正常＝中立／設定要＝橙／赤は取り消せない操作だけ」。同じ橙に2つの意味を持たせない | `test_headbar.js` | [§9.338](../../docs/decisions/9.338.md) |
| **揃えること自体を目的にしない**。見た目を動かす前に「読む人に何が良くなるか」を言う | `test_popmenu.js` | [§9.449](../../docs/decisions/9.449.md) |
| 土台の規則は**修飾子より前**に書く（同点なので後が勝ち、修飾子が黙って効かなくなる） | `test_popmenu.js` | [§9.448](../../docs/decisions/9.448.md) |
| 寸法は文字サイズから作る | `test_fit.js`・`test_typescale.js` | [§9.90](../../docs/decisions/9.90.md) |
| 色と文字サイズは`:root`のトークンから選ぶ | `test_theme.js` | [決まり](../../docs/decisions/rules-misc.md) |
| 表示件数の「全件」は「250件ずつ最後まで取り続ける」 | `test_allrows.js` | [§9.95](../../docs/decisions/9.95.md) |
| 同じセレクタの同じプロパティを2つのCSSファイルに書かない | `test_csslint.py` | [§9.324](../../docs/decisions/9.324-1.md) |
| 更新履歴の窓は中身の長さから決める | — | [§9.323](../../docs/decisions/9.323-1.md) |
| 作業以外の行の題名は「色・札・帯」と「位置・揃え」を選べる | — | [§9.295](../../docs/decisions/9.295.md) |
| 常時載っているカードは「頻度 × 重要度」で面積を配る | — | [§9.296](../../docs/decisions/9.296.md) |
| 紙のセルの余白は「左右」と「上下」で別の軸 | — | [§9.294](../../docs/decisions/9.294.md) |
| 日付（まとまり）の切り替わりの行間は別の軸 | — | [§9.294](../../docs/decisions/9.294.md) |
| アイコンのフォントは同梱する | `test_csslint.py`・`test_theme.js` | [§9.240](../../docs/decisions/9.240.md) |
| 紙は「余白 → 余力のある列 → 折り返し → 文字サイズ」の順で詰める | `test_rpblocks.js` | [§9.132](../../docs/decisions/9.132.md) |
| 紙は「画面の一覧の見た目」が正 | `test_csslint.py`・`test_scprint.js` | [§9.237](../../docs/decisions/9.237.md) |
| 列の一時的な色はマスタへ保存しない | `test_coltint.js` | [§9.239](../../docs/decisions/9.239.md) |
| 未入力の色・必須の橙・公差外の赤は`.opf-face`の1つの印へ当てる | `test_opblanktint.js` | [§9.288](../../docs/decisions/9.288.md) |
| 色は「いまどこに居るか」だけを語る | — | [§9.288](../../docs/decisions/9.288.md) |
| `--opf-num-w`のような共有の寸法を`em`で渡さない | `test_opunit.js` | [§9.257](../../docs/decisions/9.257.md) |
| 段を積む器は行を中身なりにする | — | [§9.250](../../docs/decisions/9.250.md) |
| セグメントとトグルは作りで分ける。トグルは「1枚の枠を割った形」 | `test_opwidget.js` | [§9.247](../../docs/decisions/9.247.md) |
| 意匠の「形」（角丸）は素のプルダウンと浮き窓まで届かせる | `test_oppad.js` | [§9.247](../../docs/decisions/9.247.md) |
| 未入力・未選択の配色は項目ごとに選べる。色は`WL.columnTint.PALETTE`の14色 | `test_opblanktint.js` | [§9.286](../../docs/decisions/9.286.md) |
| 意匠の「色」は13色＋既定。呼び名は未入力の配色と同じ語彙 | — | [§9.287](../../docs/decisions/9.287.md) |
| 重なり順は`--z-*`のトークンから選ぶ | — | [§9.112](../../docs/decisions/9.112.md) |
| 器に`display`を当てたら`[hidden]{display:none}`も1行書く（既定を打ち消す） | `test_bladeui.js` | [§9.377](../../docs/decisions/9.377.md) |
| 操業データの入力欄は「マスが幅を決め、欄は器いっぱい」 | — | [§9.218](../../docs/decisions/9.218.md) |
| 子ロットの行は親と同じ列定義を共有する | — | [§9.197](../../docs/decisions/9.197.md) |
| 新しい画面は`tests/test_scale.js`の巡回に入れる | `test_scale.js` | [§9.127](../../docs/decisions/9.127.md) |
| 表示サイズは3段階（`sm` .92 ／ `md` 1 ／ `lg` 1.1）。段を増やさない | `test_fit.js`・`test_uisize.js` | [§9.132](../../docs/decisions/9.132.md) |
| 行の見せ方（配色・アイコン）は`行表示マスタ` | `test_scrowstyle.js` | [§9.198](../../docs/decisions/9.198.md) |
| 差し込みの当たり判定は境目のそばだけ | `test_scbar.js` | [§9.199](../../docs/decisions/9.199.md) |
| 選ばせるものは「選ぶ前に見える」ようにする | — | [§9.200](../../docs/decisions/9.200.md) |
| 器と中身の文字サイズを食い違わせない | `test_msteps.js` | [§9.206](../../docs/decisions/9.206.md) |
| 列幅は掴んでいる側が動く | — | [§9.208](../../docs/decisions/9.208.md) |
| 汎用UIの高さは器の変数がそろえる | `test_oppad.js` | [§9.229](../../docs/decisions/9.229.md) |
| 縮んでよいのは案内だけ | `test_splitlive.js` | [§9.229](../../docs/decisions/9.229.md) |
| 選ばせ方は「選んだ札のほうが濃い」ことで示す | `test_oppad.js` | [§9.229](../../docs/decisions/9.229.md) |
| 段のバッジは短く。ロット情報は見切らせない | — | [§9.234](../../docs/decisions/9.234.md) |
| 自動で入る欄はカードの地で言う | `test_opdata.py`・`test_oppad.js` | [§9.234](../../docs/decisions/9.234.md) |
| 角丸が土台。ピルと角は使わない | `test_oppad.js` | [§9.227](../../docs/decisions/9.227.md) |
| 選ばせ方は「器の変数」でそろえる | `test_opdata.py`・`test_opui.js` | [§9.226](../../docs/decisions/9.226.md) |
| 「何で選ばせるか」と「どう見えるか」は別の軸 | — | [§9.223](../../docs/decisions/9.223.md) |
| 公差外・基準外は確認カードの色で気づかせる。NGの記録はその行の中 | `test_ngcard.js` | [§9.242](../../docs/decisions/9.242.md) |
