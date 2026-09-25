# 規則の置き場

入口: [CLAUDE.md](../../CLAUDE.md)

**ここに在るのは「領域ごとの個別の規則」だけ。** 汎用（利用者からの恒久的な
指示・すべての作業に常時かかるもの——作業の進め方・コードの基準・画面の基準）は
入口の [CLAUDE.md](../../CLAUDE.md) が持ち、経緯（なぜ・実測値・撤回した案・
踏んだ罠）は [`docs/decisions/`](../../docs/decisions/README.md) が持つ。
表の行は守ることだけを書いてあり、その根拠は行ごとの「くわしく」の先にある。

**コードを触る前に、触る領域の1枚を開くこと。** 画面に触るときは
CLAUDE.md の「画面を作るときの基準」（14項目）と、それをWaveLogの寸法へ落とした
[ui-principles.md](ui-principles.md) も一緒に開く。

| 触る場所 | 開く1枚 | 件数 |
| --- | --- | --- |
| どの画面でも（基準をWaveLogの寸法へ落としたもの） | [ui-principles.md](ui-principles.md) | 7節 |
| `program/`・`Start.vbs`・`#appBoot`・更新・在席 | [boot.md](boot.md) | 50 |
| 共有DB・写し・錠・`config/local.json`・SQLite | [data.md](data.md) | 64 |
| `backend/routes/`・`body(spec)`・`api_guard`・権限 | [api.md](api.md) | 20 |
| `TableDef`・マスタのサーバー側・既定値 | [master-server.md](master-server.md) | 27 |
| マスタ管理の画面・盤・編集モーダル | [master-ui.md](master-ui.md) | 21 |
| `list-view.js`・列レイアウト・フィルタ・仮想行 | [list.md](list.md) | 144 |
| 測定画面・操業データ項目・公差・条の設計 | [measure.md](measure.md) | 97 |
| 刃組ガイダンス（`blade-*.js`）・部材・刃選択 | [bladeset.md](bladeset.md) | 208 |
| 作業スケジュール・設備停止の登録・写しの同期 | [schedule.md](schedule.md) | 83 |
| `print-core.js`・帳票ブロック・用紙と余白 | [report.md](report.md) | 92 |
| `WL` 名前空間・窓・メニュー・拡張の登録表 | [ui-core.md](ui-core.md) | 38 |
| 色・文字サイズ・寸法の刻み・状態の見せ方 | [style.md](style.md) | 60 |
| テストを書く・回す・後片付け | [testing.md](testing.md) | 52 |
| どの束にも入らないもの | [misc.md](misc.md) | 17 |

「固定する網」の欄はテスト名。`tests/run_all.sh <名前>` で回す。
規則は合わせて **973件**（`ui-principles.md` は節で数える）。
