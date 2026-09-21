# WaveLog 開発メモ（AIアシスタント向け）

**この1枚は入口だけを持つ。** 規則の本体は
[`.claude/rules/`](.claude/rules/README.md)（726件・領域別の15枚）、
なぜそうなのか（実測値・撤回した案・踏んだ罠）は
[`docs/decisions/`](docs/decisions/README.md)（396の決定記録＋主題別の索引）。
**コードを触る前に、触る領域の1枚を開くこと。**

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
- **この規則は `.claude/rules/testing.md` の記述に優先する。** あちらには
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

## 規則の置き場（触る前に開く1枚）

一覧と「どの場所ならどれを開くか」は
[`.claude/rules/README.md`](.claude/rules/README.md)。
**画面に触るときは、領域の1枚に加えて
[`ui-principles.md`](.claude/rules/ui-principles.md) も必ず開く**
——認知コストを最小化し、探させず・思い出させず・推測させない、という
利用者からの恒久的な基準で、**直す画面だけでなく全画面に常時かかる**。

| 触る場所 | 開く1枚 |
| --- | --- |
| どの画面でも（見た目・情報の並べ方の基準） | [ui-principles.md](.claude/rules/ui-principles.md) |
| `program/`・`Start.vbs`・`#appBoot`・更新・在席 | [boot.md](.claude/rules/boot.md) |
| 共有DB・写し・錠・`config/local.json`・SQLite | [data.md](.claude/rules/data.md) |
| `backend/routes/`・`body(spec)`・`api_guard`・権限 | [api.md](.claude/rules/api.md) |
| `TableDef`・マスタのサーバー側・既定値 | [master-server.md](.claude/rules/master-server.md) |
| マスタ管理の画面・盤・編集モーダル | [master-ui.md](.claude/rules/master-ui.md) |
| `list-view.js`・列レイアウト・フィルタ・仮想行 | [list.md](.claude/rules/list.md) |
| 測定画面・操業データ項目・公差・条の設計 | [measure.md](.claude/rules/measure.md) |
| 刃組ガイダンス（`blade-*.js`）・部材・刃選択 | [bladeset.md](.claude/rules/bladeset.md) |
| 作業スケジュール・設備停止の登録・写しの同期 | [schedule.md](.claude/rules/schedule.md) |
| `print-core.js`・帳票ブロック・用紙と余白 | [report.md](.claude/rules/report.md) |
| `WL` 名前空間・窓・メニュー・拡張の登録表 | [ui-core.md](.claude/rules/ui-core.md) |
| 色・文字サイズ・寸法の刻み・状態の見せ方 | [style.md](.claude/rules/style.md) |
| テストを書く・回す・後片付け | [testing.md](.claude/rules/testing.md) |
| どの束にも入らないもの | [misc.md](.claude/rules/misc.md) |

## よく使うコマンド

```
tests/run_all.sh test_sccat test_roll   # 名前を指定して回す（ふだんはこれ）
tests/run_all.sh --changed              # 変更ファイルから対応表で選ぶ
tests/run_all.sh --pure                 # サーバー不要の層だけ（並列）
tests/run_all.sh --smoke                # 各領域1本ずつ
tests/run_all.sh                        # 通し。利用者の指示があるときだけ（上の A）
python3 tests/make_fixture.py           # 検証用フィクスチャの作り直し
```

- Playwright は同梱の Chromium を使う（`WAVELOG_CHROMIUM` 等で上書き可）。
- **テストを書くときの約束・後片付け・待ち方・踏んだ罠**は
  [`testing.md`](.claude/rules/testing.md) と `tests/README.md`。
- バージョンは意味のある変更ごとに `backend/changelog_data.py` の
  `APP_VERSION` を上げ、CHANGELOG に1件足す。

## 参照

- 構成: `docs/ARCHITECTURE.md`
- 機能と起動方法: `README.md`
- スケジュール機能そのものの設計: `docs/SCHEDULE_MODE_DESIGN.md`（§1〜§13）
- 構造と画面の評価、次に取り組む候補（推奨順・評価関数つき）:
  `docs/REVIEW_2026-09.md`（利用者の指示: 構造の改善案を優先し、画面の
  見た目が変わるものは都度確認して少しずつ）
- いま進めている作業そのものは、この1枚ではなく**タスク一覧と
  コミットメッセージ**が持つ。終わったことをここへ書き足さない。

## Git

- 開発は featureブランチ（現行: `claude/report-block-resize-bug-my9cj8`）で行い、
  **main へのマージは利用者の明示指示があったときだけ。**
