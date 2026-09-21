# 規則の置き場

入口: [CLAUDE.md](../../CLAUDE.md)

**規則（守ること）はここ、経緯（なぜ・実測値・撤回した案・踏んだ罠）は
[`docs/decisions/`](../../docs/decisions/README.md)。** 表の行は守ることだけを
書いてあり、その根拠は行ごとの「くわしく」の先にある。

**コードを触る前に、触る領域の1枚を開くこと。** 画面に触るときは
[ui-principles.md](ui-principles.md) も一緒に開く（全画面に常時かかる基準）。

| 触る場所 | 開く1枚 | 件数 |
| --- | --- | --- |
| どの画面でも（見た目・情報の並べ方の基準） | [ui-principles.md](ui-principles.md) | 14 |
| `program/`・`Start.vbs`・`#appBoot`・更新・在席 | [boot.md](boot.md) | 44 |
| 共有DB・写し・錠・`config/local.json`・SQLite | [data.md](data.md) | 57 |
| `backend/routes/`・`body(spec)`・`api_guard`・権限 | [api.md](api.md) | 20 |
| `TableDef`・マスタのサーバー側・既定値 | [master-server.md](master-server.md) | 27 |
| マスタ管理の画面・盤・編集モーダル | [master-ui.md](master-ui.md) | 20 |
| `list-view.js`・列レイアウト・フィルタ・仮想行 | [list.md](list.md) | 115 |
| 測定画面・操業データ項目・公差・条の設計 | [measure.md](measure.md) | 97 |
| 刃組ガイダンス（`blade-*.js`）・部材・刃選択 | [bladeset.md](bladeset.md) | 125 |
| 作業スケジュール・設備停止の登録・写しの同期 | [schedule.md](schedule.md) | 49 |
| `print-core.js`・帳票ブロック・用紙と余白 | [report.md](report.md) | 92 |
| `WL` 名前空間・窓・メニュー・拡張の登録表 | [ui-core.md](ui-core.md) | 22 |
| 色・文字サイズ・寸法の刻み・状態の見せ方 | [style.md](style.md) | 56 |
| テストを書く・回す・後片付け | [testing.md](testing.md) | 49 |
| どの束にも入らないもの | [misc.md](misc.md) | 17 |

「固定する網」の欄はテスト名。`tests/run_all.sh <名前>` で回す。
