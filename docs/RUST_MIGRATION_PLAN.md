# 業務の Python を Rust へ移す——計画

**状態: P0（土台と物差し・[§9.633](decisions/9.633.md)）・P1a（純粋な関数6つ・[§9.634](decisions/9.634.md)）・P1b（並べ替え・書式・絞り込み・[§9.635](decisions/9.635.md)）・P1c（ダッシュボードの式・[§9.636](decisions/9.636.md)）済み。移したルートはまだ 0本。** 決めたことと経緯は [§9.632](decisions/9.632.md)。前の住み分けは [§9.563](decisions/9.563.md)。
窓（`desktop/`）の作りは [`DESKTOP_MIGRATION_DESIGN.md`](DESKTOP_MIGRATION_DESIGN.md)。

## 1. 目的と範囲

- **目的**: 製品が動くのに各 PC の Python を要らなくする。配る物は小さいまま（Python も flask も同梱しない・§9.563 追補）。
  この2つを両立できる道は、業務を Rust の exe へ移すことだけになった。
- **範囲は製品が動く部分だけ**（利用者の判断）。網・道具（`tests/run_all.sh`・`tests/make_fixture.py`・lint の網・
  `tests/pick_tests.py`）は開発と CI でしか動かないので Python のまま残す。
- **画面（JS・CSS）は変えない**。画面は `fetch("/api/...")` のままで、答える側だけが替わる。

### 利点と、減らないもの

| 減るもの | 減らないもの・増えるもの |
|---|---|
| Python の環境が原因の不具合（Store 版の写し・PATH の順・pip。記録上 20件・§9.563） | 論理・仕様の不具合（業務の不具合の大半。言語を替えても減らない） |
| 窓と Python の版ずれ（`protocol`・共有の Python と手元の exe） | 書き直しで新しく入る不具合（影の比較で抑える・§3） |
| 接続の閉じ忘れの種類（§9.270。所有権で閉じる） | 直して確かめる一回りが遅くなる（`cargo build`） |
| 型・形の誤り（業務の Python で 7件） | 新しい集計・取り込みを書く手間はやや増える |

## 2. いまの規模（2026-11-03 に測った）

| 層 | 量 |
|---|---|
| 業務の Python（`backend/`） | 約4.7万行（このほか更新履歴の字 7.4千行） |
| 内訳 | 保存の層（`repositories/`）1.42万／ルート 0.96万／ダッシュボード 0.57万／予定 0.56万／共有DB・写し・錠 0.56万／起動・更新 0.32万／そのほか（結合・Excel・並べ替え等）0.23万／RNE 0.08万 |
| ルート | 270本の定義（道×メソッドで数えると 273・§5 の物差しの数え方。多い順に `schedule.py` 40・`masters/bladeset*.py` 38・`masters/operation.py` 16・`core.py` 16） |
| 背景で動くスレッド | 15か所（写し・共有スケジュールの見張り・書込役・RNE・在席） |
| 外の部品 | flask だけ。ほかは標準ライブラリ（json・sqlite3・threading・re・unicodedata・zipfile・ctypes） |
| 網 | JS 236本（ほぼ全部 HTTP 越し＝答える側が Rust でもそのまま使える）／Python 112本（うち 83本が製品の Python を直に読み込む。計画を書いた時点の「91本」は数え方の誤り・§9.633） |
| Rust（`desktop/`） | 約3.1千行。`router.rs` が `/static/` だけ自分で返し、残りを Python（`program/sidecar.py`）へ渡す |

## 3. 移し方の土台

### 3.1 窓の振り分けを継ぎ目にする

`router.rs` の `Backend` の前に **「Rust が答えるルートの表」**（`desktop/core/src/routes.rs` の `ROUTES`）を置き、
表に無い問い合わせだけを Python へ回す。答えを決めるのは `wavelog_core::Core::answer()` の1箇所（P0 で入れた・§9.633）。
1本ずつ表へ足していき、最後に Python へ回す先が無くなったら窓口ごと外す。画面と JS の網は1行も変えない。

### 3.2 移す単位は「ルート」ではなく「書き手」

**1つのファイル・1つの事実の書き手は1言語**（§9.563・`data.md`）を移行の途中でも守る。

- **読むだけのルートは先に移してよい**（読み手は何言語でもよい）。
- **書くものは、その表・ファイルを書くコードを全部まとめて1回で移す**。半分だけ移すと2つの言語が同じファイルを書き、
  境界の不具合（記録上 9件）と同じ壊れ方をする。
- P0 で **書き手の対応表**（どの表・どのファイルを、どの関数が書くか）を作り、移す単位はこの表から切る。

### 3.3 影で比べてから切り替える（物差し）

1. 移した単位はまず **影** として動かす。同じ問い合わせを Python と Rust の両方へ送り、**答えるのは Python のまま**、違いだけ記録する。
2. 比べる材料は2つ——フィクスチャと JS の網が流す問い合わせ／利用者の端末で記録した実際の問い合わせ。
3. **不一致が 0件になったら切り替え**、Python の側を消す。
4. 書くルートは影で動かせない（2回書く）ので、**一時の置き場で両方に同じ書込を流し、終わった後の DB の指紋を比べる**。

### 3.4 開発と網のための HTTP の入口も Rust に持たせる

窓の枠（`frame.rs`）でも HTTP でも **同じハンドラ** が答える。JS の網は HTTP の入口を叩く（いまの `program/app.py` の役目）。
P0 で `wavelog-serve`（`desktop/core/src/bin/serve.rs`）を入れた。表に無い問い合わせは、内側に立てた `program/app.py`
（`WAVELOG_HTTP_PORT=5030`）へそのまま渡す。網は `WAVELOG_SERVE=rust tests/run_all.sh …` でこの入口を通る。
ポートを開くのは開発と網のときだけで、利用者の起動はいままでどおり窓だけ（§9.548）。

### 3.5 Rust の置き場

`desktop/` をワークスペースにし、**窓**（いまの `wavelog-desktop`）と **業務**（新しいクレート）を分ける。
業務のクレートは Tauri も Windows の部品も知らない（Linux で `cargo test` が全部回る）。Windows だけの物（Navigator の DLL・
`.lnk`）は `#[cfg(windows)]` の薄い層に閉じる。

## 4. 段階

| 段 | 移すもの | 終わった印 |
|---|---|---|
| **P0 土台**（済み・§9.633） | ワークスペースを分ける・「Rust が答える表＋Python へ回す」の振り分け・影で比べる仕組みと不一致の記録・HTTP の入口・書き手の対応表・物差し（§5）の基準値 | 数を出す仕組みが動く。移したルートは 0本 |
| **P1 純粋な関数**（P1a〜P1c 済み・§9.634〜§9.636。残りは P1d CSS・画面・更新履歴） | 字の正規化（NFKC）・真偽の読み方（`flags`）・日時（`datetext`）・並べ替え（`sort_order`）・`filter_sql`・`rule_cells`・`safe_regex`・式の評価器（`dashboard/formula`・`num_expr`。JS の `WL.formula` と**共通の試験表**を作る）・更新履歴（字をデータファイルへ出す）・CSS の連結・`index.html`（minijinja） | 試験表で Python と答えが一致する |
| **P2 読むだけのルート** | 仕掛・品質の一覧（写しを読むだけ）・ダッシュボードの計算・ログの閲覧 | 影の不一致が 0件 |
| **P3 保存と共有の層** | `sqlite_io`・`db_access`・`db_mirror`・錠・`master_share`・`storage_layout`・`paths`・`terminal_store`・在席（`presence`） | 写す・書く役が Rust だけになる |
| **P4 マスタ** | 表の群ごとに（設備・操業データ・ロール・刃組・帳票・フィルタ・列・アクセス権限・結合） | 群ごとに切り替えた |
| **P5 予定** | 予定の展開（`schedule_calc`）・共有スケジュールの書込サイクル（`schedule_sync`）・書込役（`schedule_owner`）・見張り・突合（`actual_match`・`actual_keep`）・履歴・換算係数 | **いちばん危ない段**。1つの単位として切り替える |
| **P6 残り** | 測定記録・更新の置き場（`app_update`）・ショートカット（`desktop_shortcut`）・Excel（`xlsx_io`）・RNE（Navigator の DLL を `libloading` で呼ぶ。DLL は 64bit・exe も 64bit） | 全ルートが Rust |
| **P7 撤去** | `program/sidecar.py`・`program/app.py`・flask・Python を探す処理（`locate::python()`）・`protocol` の版・Store 版の決まり（§9.318・§9.496）・`program/requirements.txt`・`.claude/rules/` と決定記録の更新 | 窓が Python を起こさない |

**P2 を終えた時点で実測し、続けるかをもう一度決める**（移した行数あたりの日数・影の不一致の出方・exe の大きさ）。

### 更新の配り方

業務が exe に入るので、版ごとに exe が変わる。`launch::plan()` は版ごとに写す作り（§9.554）なので仕組みは変えない。
P7 で版の中身（`PAYLOAD`）から `backend`・`program/*.py` が外れ、`static`・`templates`・exe になる。

## 5. 物差し（各段の前後で同じ数を測る）

数は `python3 tests/lib/rust_progress.py` が今のコードから出す（写しを持たない）。決まりは網 `test_rustplan.py` が見張る。

| 数 | いま | 目標 |
|---|---|---|
| Python が答えるルート（道×メソッド） | 273 | 0 |
| 影の比較の不一致（単位ごと） | — | 切り替える前に 0 |
| 書き手が2言語にまたがる事実 | 0 | どの時点でも 0 |
| 業務の Python の行数（更新履歴の字を除く） | 48,264 | 0 |
| Python が書く表（書き手の対応表 `docs/RUST_WRITERS.md`） | 51（表の名前が式で決まる書き手 25） | 0 |
| 煙テスト（`--smoke`）の結果・Python だけ／Rust の入口を通す | 184/184・184/184（73秒・87秒） | 変わらない |
| JS の網 236本の結果（通し） | **未計測**（通しは利用者の指示で回す・CLAUDE.md の A） | 変わらない |
| 製品の Python を直に読む網 83本 → `cargo test` へ移した数 | 0／83 | 83／83 |
| 起動〜画面の秒・メモリ・exe の大きさ | **未計測**（Windows の実機で P0 に測る） | 悪くならない |

## 6. 先に分かっている危険

| 危険 | 中身 | 受け方 |
|---|---|---|
| 正規表現 | Rust の `regex` は先読み・後読みを持たない（業務のコードに 4か所）。利用者が書く正規表現はいま Python の `re` で、JS の側は JS の意味 | `fancy-regex` を使うか JS の意味にそろえるかを P1 で決める（`safe_regex` の入れ子の断りは残す・§9.629） |
| 数の丸めと書き方 | Python の `round`（偶数への丸め）・浮動小数の字への直し方・JSON の鍵の順（flask は並べ替える） | 影の比較で最も違いが出る所。丸めの関数を1つにして試験表で固める |
| 日時 | 地方時の素の日時（タイムゾーン無し） | `chrono::NaiveDateTime` で同じ意味にそろえる |
| SQLite | 型の親和性・Python の整数は桁あふれしない | `rusqlite`（同梱の SQLite）。読む型を列ごとに決める |
| 共有のファイル（SMB） | 言語を替えても同じ OS の呼び出し。壊れ方は変わらない | 「共有の写し方の約束」（`docs/SHARED_READ.md`・§9.582）をそのまま移す |
| Navigator の DLL | 64bit（利用者の答え） | exe は 64bit のまま。呼び出しは `#[cfg(windows)]` の層だけ |
| 工数 | 約5万行の書き直し | P2 の後に実測して続けるかを決め直す |

## 7. 移している間の決まり

- **新しい機能**: 移した領域は Rust へ、まだの領域は Python へ足す。**移している最中の単位には足さない**（利用者の判断）。
- **直し**: Python の側で直したら、同じ単位を移すときの試験表へ1行足す（直した事実を移し漏らさない）。
- **網**: JS の網は変えない。Python の網は単位を移すときに `cargo test` へ移し、移したら Python の側を消す。
- push の前の検査（CLAUDE.md の F）は、窓を触るときと同じく `cargo fmt --check`・`cargo clippy`（Windows の的も）・`cargo test`。
