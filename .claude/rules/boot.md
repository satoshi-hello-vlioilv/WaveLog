# 起動・停止・監視（53件）

索引: [規則の置き場](README.md)｜入口: [CLAUDE.md](../../CLAUDE.md)

`program/` の3本・`Start.vbs`・`#appBoot`・更新の刻印・在席の監視・デスクトップ版の窓口

行は**守ることだけ**を書いてある。なぜそうなのか・実測値・撤回した案・踏んだ罠は
「くわしく」の先（[`docs/decisions/`](../../docs/decisions/README.md)）にある。
**直す前にその先を開くこと。**「固定する網」は `tests/run_all.sh <名前>` で回す。

| 守ること | 固定する網 | くわしく |
| --- | --- | --- |
| 窓の版は exe を作ったコミット（CI が埋める）。窓だけ古いかは`desktop_shell.stale()`の1箇所 | `test_presence.py` | [§9.552](../../docs/decisions/9.552.md) |
| `.lnk`を作る・読むのは窓の副コマンド`--lnk`（JSON 1つ）。決めるのは`desktop_shortcut.py` | `test_shortcut.py` | [§9.552](../../docs/decisions/9.552.md) |
| 窓の自己診断は保存（1つの画面で1本だけ）と印刷の書類も見る。保存の受け手（`on_download`）は**自己診断のときだけ**付ける（付けると既定の案内が消える） | — | [§9.551](../../docs/decisions/9.551.md) |
| 利用者の起動はデスクトップ版だけ（Start.vbs → `program/WaveLog.exe`）。HTTP の入口`program/app.py`は開発と網のため | `test_faststart.py` | [§9.548](../../docs/decisions/9.548.md) |
| main へは CI が exe を置く（`publish`・作った元の指紋で置き直しを決める）。手で作った exe を足さない | — | [§9.548](../../docs/decisions/9.548.md) |
| 外した物の残りは`setup_check.RETIRED`で片付ける（合図は新しい Start.vbs）。端末の手元の物は`RETIRED_LOCAL` | `test_faststart.py` | [§9.548](../../docs/decisions/9.548.md) |
| デスクトップ版の窓は`desktop/`（Rust）。`/static/`だけ直に返し、残り（画面・API・連結 CSS）は Python へ | `test_boot.py`・`test_sidecar.py` | [§9.546](../../docs/decisions/9.546.md) |
| 窓の Python は PATH の順に最初の`pythonw.exe`がある場所（並べ替えない）。版（`protocol`）が違えば起こさない | `test_sidecar.py` | [§9.546](../../docs/decisions/9.546.md) |
| Start.vbs は exe を手元の版ごとのフォルダへ写して起動するだけ。起動できなければ理由と次の一手（ブラウザ版へ逃げない） | `test_faststart.py` | [§9.546](../../docs/decisions/9.546.md)・[§9.548](../../docs/decisions/9.548.md) |
| 起動画面（`desktop/splash`）は`#appBoot`と同じトークン・同じ地。アイコンは`app_icon.py`が描く（`.ico`を置かない） | `test_boot.py` | [§9.546](../../docs/decisions/9.546.md) |
| デスクトップ版の窓口は`program/sidecar.py`（標準入出力の枠・ポートなし）。標準出力は枠だけ。入力が閉じたら`watchdog._exit()`で終わる | `test_sidecar.py` | [§9.544](../../docs/decisions/9.544.md) |
| 起動の背景処理（写し・見張り・書込役）は`services.start()`の1箇所（窓口と開発・網の入口が呼ぶ）。タブの見張りは持たない | `test_sidecar.py` | [§9.544](../../docs/decisions/9.544.md) |
| update.bat は**版を最初に言う**（`ready.version_note()`の1箇所・前回の刻印と比べる） | `test_cleanup.py` | [§9.497](../../docs/decisions/9.497.md) |
| update.bat は確かめる前に作り直せる物を片付ける（`file_cleanup.run_for_update()`）。ショートカットの絵は残す | `test_cleanup.py` | [§9.497](../../docs/decisions/9.497.md) |
| アプリの外（update.bat）から設定を読むのは`path_config`。**`db_access`を読み込まない**（読み込むと共有マスタの写しを作り直す） | `test_cleanup.py` | [§9.497](../../docs/decisions/9.497.md) |
| ほかのプログラムが読むファイル（ショートカットの絵）の置き場は`paths.browser_dir()`の1箇所 | `test_shortcut.py` | [§9.496](../../docs/decisions/9.496.md) |
| `say`の約束は`say(m, bad=False, quiet=False)`。`say=lambda`で渡すときも`quiet`を受ける | `test_faststart.py` | [§9.495](../../docs/decisions/9.495.md) |
| `update.bat`の画面は「結果」と「次にすること」だけ（記録は`to_console=False`で`launcher.log`へ） | `test_faststart.py` | [§9.431](../../docs/decisions/9.431.md) |
| `setup_check.run()`へ渡す`say`は`quiet=True`（記録だけ）を受ける。結果の言葉は`setup_app.py`の1箇所 | `test_faststart.py` | [§9.431](../../docs/decisions/9.431.md) |
| 刻印のPythonは`python_mark()`でそろえる（`pythonw.exe`＝`python.exe`）。控えた値も読むときにそろえる | `test_faststart.py` | [§9.415](../../docs/decisions/9.415.md) |
| 再確認の理由は**それだけで読める1文**（`ready.diff()`）。頭に「変わったもの:」を継ぎ足さない・長い道は末尾だけ | `test_faststart.py`・`test_boot.py` | [§9.415](../../docs/decisions/9.415.md) |
| 直接実行する3本とその資材は`program/`。**リポジトリ直下に`.py`も`.bat`も置かない** | `test_faststart.py` | [§9.406](../../docs/decisions/9.406.md) |
| 直下に残すのは`Start.vbs`（毎日の入口）と、移すと**黙って効かなくなる**`.gitignore`／`eslint.config.mjs`だけ | `test_faststart.py` | [§9.406](../../docs/decisions/9.406.md) |
| 直下の孤児`__pycache__`は片付ける。**`.py`が1本も無い**かつ**中身が`.pyc`だけ**のときに限る | `test_faststart.py` | [§9.406](../../docs/decisions/9.406.md) |
| `program/`の3本は`import _pycache_bootstrap`→`import _approot`の順で通す（置き場が先・探索先が次） | `test_faststart.py` | [§9.406](../../docs/decisions/9.406.md) |
| `backend`から素の`from app import app`を書かない。答えは`app_module.flask_app()`の1箇所 | `test_scowner.py` | [§9.404](../../docs/decisions/9.404.md) |
| ファイルを移すときは見張り（`pick_tests.py`・lintの対象・CI）も一緒に動かす | `test_pick.py` | [§9.404](../../docs/decisions/9.404.md) |
| 起動画面の地は深い紺＋斜めの光。**カードは不透明な白のまま**（透かすと本文が薄れ、描画も重い） | `test_boot.py` | [§9.411](../../docs/decisions/9.411.md) |
| 波紋はヘッダーの帯の中だけ（`overflow:hidden`）。輪は**幅と高さ**で広げる（`scale`は線まで太る） | `test_theme.js` | [§9.411](../../docs/decisions/9.411.md) |
| ショートカットの行き先は`Start.vbs`1本、アイコンは`app_icon.py`が描く。作れない端末は理由を返す | `test_shortcut.py` | [§9.410](../../docs/decisions/9.410.md) |
| 【§9.552で撤回】補助スクリプト（`make_shortcut.vbs`）へ位置で渡す——いまは窓の副コマンドへ JSON 1つ | `test_shortcut.py` | [§9.486](../../docs/decisions/9.486.md) |
| 起動前の確認は`update.bat`（旧`setup.bat`）が受け持ち、刻印で飛ばす | `test_faststart.py` | [§9.225](../../docs/decisions/9.225.md) |
| 入口の名前は「いつ押すか」を言う。旧名を入口として残さない（入口は1つ） | `test_faststart.py` | [§9.405](../../docs/decisions/9.405.md) |
| 置き場・名前が変わった古いファイルは`MOVED_AWAY`で片付ける。**新しいほうが在るときだけ**（片方しか無いうちは触らない） | `test_faststart.py` | [§9.405](../../docs/decisions/9.405.md) |
| サーバー再起動 | — | [決まり](../../docs/decisions/rules-misc.md) |
| 起動基盤に触るとき | — | [決まり](../../docs/decisions/rules-misc.md) |
| 起動オーバーレイ（`#appBoot`） | `test_boot.py`・`test_bootui.js` | [決まり](../../docs/decisions/rules-misc.md) |
| 枠線なしでも「区切り」と「設備停止」を見分けられるようにする | — | [§9.295](../../docs/decisions/9.295.md) |
| 作業以外の行は「題名だけ」。内容の列を束ねて置く | `test_scprint.js` | [§9.294](../../docs/decisions/9.294.md) |
| 起動できない端末のことは、その端末から言えるようにする | `test_bootreport.js` | [§9.163](../../docs/decisions/9.163.md) |
| 説明文（docstring）にWindowsのパスをそのまま書かない | `test_pywarn.py` | [§9.275](../../docs/decisions/9.275.md) |
| 掃除してよいのは「消えても取り直せるもの」だけ | `test_cleanup.py` | [§9.249](../../docs/decisions/9.249.md) |
| テストをまとめる線引きは「同じ画面を見るために同じ起動を待っているか」 | — | [§9.249](../../docs/decisions/9.249.md) |
| 設備停止の入口は`#scStopButtons`の1つ | `test_scstop.js` | [§9.181](../../docs/decisions/9.181.md) |
| データソースは「名称」も再起動待ち | `test_dsrestart.js` | [§9.183](../../docs/decisions/9.183.md) |
| データソースの読み込み先は「今マスタにある行」から作る | — | [§9.163](../../docs/decisions/9.163.md) |
| 「どこから読むか」はデータソースの行が1つだけ持つ | `test_datasource.py`・`test_dscap.py` | [§9.168](../../docs/decisions/9.168.md) |
| 「更新は届いたが再起動していない」をサーバーが答える | — | [§9.200](../../docs/decisions/9.200.md) |
| この端末の呼び名は起動時に1回だけ決めて持つ | `test_pcname.py` | [§9.208](../../docs/decisions/9.208.md) |
| 資材(JS/CSS)は`?t=`付きなら長期キャッシュへ回す | `test_assetcache.py` | [§9.97](../../docs/decisions/9.97.md) |
| 仕掛/品質データのローカル運用 | — | [決まり](../../docs/decisions/rules-misc.md) |
| フォルダ構成 | — | [決まり](../../docs/decisions/rules-misc.md) |
| 起動スクリプトは CRLF 改行で保存する | `test_faststart.py` | [§9.229](../../docs/decisions/9.229.md) |
