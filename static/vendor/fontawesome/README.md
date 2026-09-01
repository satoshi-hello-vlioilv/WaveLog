# Font Awesome Free 6.7.2（同梱）

利用者の指示「フォント一式をリポジトリへ同梱をお願いします」により、
**取りに行かずに動く**ようにここへ置いてある。

## なぜ同梱するのか

現場のWindows端末は**社内で閉じて動く**。CDN（cdnjs 等）へ出られる保証は
無く、出られない端末では**アイコンだけが四角い豆腐になる**——押す前に何の
ボタンか読めないので、押せないボタンと同じことになる（§4）。
`requirements.txt` を増やさないのと同じ理由（§9.240）で、**依存を増やさず
ファイルを持つ**ほうを選んだ。

## 何を入れて、何を入れていないか

| 入れたもの | 大きさ | 用途 |
|---|---|---|
| `css/fontawesome.min.css` | 57KB | アイコンのクラス（`.fa-xxx`）の定義 |
| `css/solid.min.css` | 0.6KB | Solid（`fa-solid`）の`@font-face` |
| `css/regular.min.css` | 0.6KB | Regular（`fa-regular`）の`@font-face` |
| `webfonts/fa-solid-900.woff2` | 155KB | Solid の字形 |
| `webfonts/fa-regular-400.woff2` | 25KB | Regular の字形 |
| `LICENSE.txt` | — | ライセンス（下記） |

**入れていないもの**

- **Brands（`fa-brands`）** ——企業ロゴ（GitHub・Twitter…）で、この
  アプリに出番が無い。字形だけで116KBある。
- **`.ttf`** ——`solid.min.css` / `regular.min.css` の`src`は
  `woff2` → `ttf` の順で書いてあり、**woff2に対応したブラウザは`ttf`を
  取りに行かない**。このアプリは`color-mix()`・コンテナクエリ・`:has()`を
  使っており、それらより woff2 のほうが10年古いので、**`ttf`へ落ちる
  ブラウザではそもそも画面が組み上がらない**。494KBを持つ意味が無い。
- `js/`・`less/`・`scss/`・`sprites/`・`svgs/`・`v4-shims` ——使わない。

## 使い方

`templates/index.html` が `css/fontawesome.min.css` → `solid.min.css` →
`regular.min.css` の順に読む。**`BOOT_CSS_FILES`（描画をブロックする束）へは
入れない**——ここへ足すと白い時間が戻る（§9.86）。`#appCss` と同じく
`media="print"` で読ませ、読み終わってから `all` へ移す。

マークアップは `<i class="fa-solid fa-print" aria-hidden="true"></i>`。
**アイコンだけのボタンには必ず`aria-label`か`title`で名前を付けること**
——絵だけでは何のボタんか読めない（§3「色（や形）だけで伝えない」）。

## 更新の仕方

```
npm pack @fortawesome/fontawesome-free@<版>
tar xf fortawesome-fontawesome-free-<版>.tgz
cp package/css/{fontawesome,solid,regular}.min.css       static/vendor/fontawesome/css/
cp package/webfonts/fa-{solid-900,regular-400}.woff2     static/vendor/fontawesome/webfonts/
cp package/LICENSE.txt                                    static/vendor/fontawesome/
```

**`static/css/` へは置かないこと**——`tests/test_csslint.py` と
`tests/test_theme.js` があのフォルダを全部走査し、「読み込み一覧と一致」
「リテラルpx・16進を新しく足さない」を見るので、他人の書いたCSSを入れると
その網が全部落ちる。

## ライセンス

Font Awesome Free 6.7.2 — https://fontawesome.com/license/free
アイコン: CC BY 4.0 ／ フォント: SIL OFL 1.1 ／ コード: MIT
Copyright 2024 Fonticons, Inc. 全文は `LICENSE.txt`。
