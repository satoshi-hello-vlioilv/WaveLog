# デスクトップ版への移行（Tauri / Rust / Python）——事前確認と段取り

**状態: 事前確認（実装前）。** 利用者の依頼「Defect-Pitch-Analyzer で行ったように、Flask/Python で補っていた部分を
Tauri/Rust/Python に変換し、ポートによる影響や得意な分野ごとに分けて対応させたい。心配は、データベースの共有管理が
いまの機能を保ったまま移せるか」に対する、**手を付ける前の確認**の記録。参照した移行は Defect-Pitch-Analyzer の
`program/docs/DESKTOP_MIGRATION_DESIGN.md`（版 2.0.0。以下 DPA）。

## 1. 結論（共有DBの管理は保てるか）

**保てる。ただし条件が1つと、移し替えが要る物が1つある。**

- **条件: 共有DBを扱う層は Python のまま動かす**（DPA と同じ分け方。Rust へは移さない）。共有の仕組みは
  「共有フォルダ上のファイル（錠・改訂番号・目印・在席）」と「書込役の LAN の受け口」でできていて、
  **画面のポート（127.0.0.1:5029）を1か所も使っていない**（§3 の E1＝0件）。窓口がポートからパイプに
  変わっても、同じ Python のコードが同じファイルへ同じ手順で書く。ブラウザ版の PC とデスクトップ版の PC が
  混ざっても、互いに同じ作法で錠を取り合う。
- **移し替えが要る物: 端末の中の測定データ（IndexedDB と localStorage の写し）。** 置き場がブラウザの
  「オリジン」ごとに分かれるので、`127.0.0.1:5029` から `wavelog.localhost` へ変わると**見えなくなる**。
  共有へまだ送れていない記録（`syncState.status!=='synced'`）は**ここにしか無い**。移行の段取りに
  「送り切る→引き継ぐ」を必ず入れる（§5 の P3）。

## 2. 共有の仕組みの棚卸し

| # | 仕組み | 置き場・運び方 | 画面のポートへの依存 | 移行での扱い |
| --- | --- | --- | --- | --- |
| 1 | 作業予定の書込（錠→取り直し→当てる→改訂番号→置換） | `schedule.sqlite3`・`schedule.lock.json`（`schedule_sync.py`） | なし | Python のまま |
| 2 | 設備の編集セッション | `schedule.sessions.json`。保つのは画面のハートビート（相対の `fetch`） | なし | Python のまま。窓を閉じたら手放す（§4-1） |
| 3 | 書込役（§9.192） | 目印 `schedule.owner.json`＋**LAN の受け口（PORT+1＝5030・`0.0.0.0`）**。受け取った依頼は `flask_app.test_client()` で自分へ入れ直す | なし（受け口は画面のポートと別） | Python のまま。受け口を開くのも今と同じ `python.exe` なので、ファイアウォールの許可も変わらない |
| 4 | マスタの共有（§9.263） | `master.lock.json`＋`共有メタ`の改訂番号（`master_share.py`） | なし | Python のまま |
| 5 | 測定データ（共有） | 設備ごとの `records.sqlite3`（§9.258・1ファイル1書き手） | なし | Python のまま |
| 6 | 読み取り専用DBの写し | `db_mirror.py`（バックアップAPI→検査→世代名で置換） | なし | Python のまま |
| 7 | 在席・失効・最新版 | `presence/<端末>.json`・`.revoke.json` | なし | Python のまま。版にデスクトップの殻の版を添えるかは P4 で決める |
| 8 | 共有スケジュールの見張り | 改訂番号だけ見て変わったら写す（`schedule_watch.py`） | なし | Python のまま |
| 9 | **端末の中の測定データ** | IndexedDB `MeasurementLocal`＋localStorage `MeasurementLocalMirrorV31` | **オリジン（ポートを含む）** | **移し替えが要る**（§5 の P3） |

9件のうち8件はそのまま動き、1件だけ手当てが要る。手当ての要る1件は「共有」ではなく、3段の置き場（§9.202）の
1段目（端末の中）である。

## 3. 何で確かめたか（評価関数）

| 物差し | 確かめること | いまの値（2026-10-02） |
| --- | --- | --- |
| E1 依存の数（静的） | 共有の状態を持つ18モジュール（`db_mirror`・`master_share`・`schedule_sync`・`schedule_owner`・`schedule_watch`・`presence`・`atomic_io`・`sqlite_io`・`db_access`・`storage_layout`・`records_export`・`paths`・`access_mode`・`watchdog`・`repositories/schedule_repo`・`routes/schedule`・`routes/presence`・`routes/measurement`）が、画面の `HOST`/`PORT`/`app_url`・`request.host`/`remote_addr`/`url_root`・`_external`・ループバックの名前を使う箇所 | **0件**（字面の一致は7件。内訳は `schedule_owner.py` の説明文4行・書込役の受け口の予備のURL1行・`access_mode.py` のPC名の除外表2行で、どれも画面のポートではない） |
| E2 共有の網 | `test_mastershare`・`test_dbmirror`・`test_presence`・`test_scwatch`・`test_scsnapread`・`test_recmirror`・`test_recsplit`・`test_atomicio`・`test_tabclose`・`test_storage`・`test_localwork`・`test_pcname`（どれもサーバー不要） | **12本・359件合格／0件不合格**（フルスイートは回していない） |
| E3 窓口の差分（P1 で作る） | 同じ問い合わせをポート経由とパイプ経由へ送り、答え（状態コード・本文）と共有フォルダの最終状態（改訂番号・錠・目印・編集セッション・在席）が一致する割合 | 未測定（目標 100%） |
| E4 片付け（P1 で作る） | 窓を閉じた（標準入力が閉じた）とき、書込役・編集セッション・在席の3つが片付くか、何秒で片付くか | 未測定（目標 3/3。いまのブラウザ版はタブを閉じてから約8秒・`CLOSED_GRACE_SEC`） |
| E5 混在（P2 で測る） | ブラウザ版とデスクトップ版の2台が同じ共有で、書込役の中継・錠・改訂番号の衝突検出を両方向に満たすか | 未測定 |
| E6 引き継ぎ（P3 で作る） | 移行の前後で、未送信の測定データと端末にしか無い設定が1件も欠けないか（件数と中身の一致） | 未測定（目標 欠け0件） |

E1 は1回きりの調べで終わらせず、P1 で網（「共有の層は画面のポートを知らない」）として固定する。

## 4. 共有DBとは別に、手当てが要る所

窓口とオリジンが変わることで動きが変わる所。どれも共有DBの手順そのものには触らない。

1. **終わり方。** いまは「タブが0件になって8秒（届かなければ90秒）」で `watchdog.teardown()` を通って終わる。
   デスクトップ版では**窓を閉じる→標準入力が閉じる→同じ `teardown()` を通って終わる**ようにする
   （片付けの1箇所はそのまま。通る道を1本足す）。Rust が強制終了されても、OS がパイプを閉じるので Python は残らない。
2. **端末の設定（localStorage 約62件・sessionStorage 1件）。** 列の並び・窓の位置・プリセット・ICASコピーの規則
   （`scLotCopyRulesV1`・端末にしか無い）・使用設備（`AccessMeasurementConfiguredEquipment`・端末にしか無い）など。
   DPA の §4 と同じく、端末の作業場所の控えへ「変わった名前だけ」重ね、新しいオリジンで開いたときに戻す。
3. **LotData-Link。** Edge の拡張は WebView2 の中では動かない。LotDsp を開く（`window.open`）のは外のブラウザ（Edge）へ
   回すので、**ロット問い合わせと自動ログインは今までどおり使える**。使えなくなるのは、WaveLog の画面が拡張を見つける
   合図（`<html data-lotdsp-ext>`）と、そこから開く登録画面（`wl:lotdsp-options`）。使用設備の設定③は
   「入っていない」と誤って言わず、「デスクトップ版からは確かめられない・Edge で登録する」と言い分ける。
4. **ファイルのドロップ。** マスタ管理の取り込み（`master-maint.js`）はエクスプローラーからのドロップを読む。
   Tauri は既定で窓へのファイルのドロップを横取りするので、窓の設定で切る（`dragDropEnabled:false`）。
   `text/uri-list` で渡る道が WebView2 で同じかは**分からない**（実機で確かめる）。
5. **印刷と保存。** 隠した `<iframe>` からの印刷・`@page` の差し込み・`Blob` の保存・`Content-Disposition` の
   ダウンロードは、WebView2 でも動く見込みだが、**Windows の実機では確かめていない**（DPA も同じく未確認）。
6. **クリップボード。** `navigator.clipboard` は安全な文脈でだけ使える。`http://wavelog.localhost` は
   `*.localhost` なので安全な文脈に入る見込み（自己診断で確かめる）。

## 5. 段取り（各段は前の段の物差しが通ってから）

| 段 | 何を | 物差し |
| --- | --- | --- |
| P0 | この事前確認 | E1・E2 |
| P1 | Python の窓口 `program/sidecar.py`（標準入出力の枠・ポートを開かない）。背景処理の開始（写し・見張り・書込役）を `backend/launcher/server.py` と共通の1箇所へ。入力が閉じたら `teardown()` | E3・E4・E1 の網 |
| P2 | Rust の殻 `desktop/`（窓・1つだけ起動・`/static/` の直配り・Python の監督と起こし直し・外のリンクは Edge）。Windows の CI で本物の WebView2 の自己診断 | `cargo test`・自己診断・E5 |
| P3 | 端末の保存物の引き継ぎ（未送信の測定データを先に共有へ送り切る→残りを控えから引き継ぐ。設定は控えを重ねる） | E6 |
| P4 | WebView2 で違う所（§4 の 3〜6）と、版の知らせ | 自己診断の項目 |
| P5 | 配り方と、ブラウザ版との併存。併存を終えたら、ポートのための仕組み（`guard.py`・`process_manager.py`・`loading.html`・ハートビートによる推し量り）を外す | 利用者の確認 |

## 6. 役割の分け方（得意な分野ごと）

| 受け持つもの | 何を | 理由 |
| --- | --- | --- |
| **Rust**（`desktop/`） | 窓、起動と終了、1つだけ起動、起動画面（`loading.html` の役）、`/static/` の配信、Python の監督と起こし直し（「再起動待ち」・§9.200 も殻が起こし直せる）、外のリンク | OS の窓・プロセス・ファイルを直接扱える。ポートのための推し量りが要らなくなる |
| **Python**（`backend/`・そのまま） | 画面の HTML・API のすべて、**共有DBの書込サイクル・写し・在席・書込役**、RNE 抽出（Navigator の DLL）、Excel の読み書き、計算 | 共有の手順は網で固めてあり、移行のあいだブラウザ版と**同じコード**で動くことが混在の安全の根拠になる。遅さの原因は意図した待ち（錠の確かめ）で、言語の速さではない |
| **画面**（WebView2） | これまでと同じ HTML/JS/CSS。問い合わせは相対の `fetch` のまま | 変えない |

**Rust へ移さない物: 共有DBの書込サイクル・写し・在席・書込役。** 移すと、移行のあいだ Python の PC と
1バイト違わない手順で錠と改訂番号を取り合う必要が生まれ、利点（速さ）に対して危うさ（黙って上書き）が大きい。
`/css/*.css` の連結（`routes/core.py`）は Python が答える（殻の `/static/` 直配りの対象外）。

## 7. 分からないこと（利用者の確認が要る）

- **exe の置き場。** アプリのフォルダを Box から複数の PC で起動している（`schedule_owner.py` の冒頭の構想）。
  `.py` は読み終えると掴まないが、**exe は動いている間ファイルを掴む**ので、更新が届いたとき動いている PC で
  置き換えが詰まるおそれがある。端末の手元へ版ごとに写してから起動する形を考えているが、配り方は利用者が決める。
- 社内の PC で署名の無い exe が止められないか（SmartScreen・AppLocker）。DPA の exe が社内で動いたかを確かめたい。
- Microsoft Store 版の Python。殻（Rust）は Python が `AppData` に書いた物を**読めない**ことがある（§9.318・§9.496）。
  殻が読む物は殻が書くか、`paths.browser_dir()` を通す。殻が書いて Python が読む向きは問題ない見込み。
