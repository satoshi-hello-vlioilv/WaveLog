# WaveLog 開発メモ（AIアシスタント向け）

構成の詳細は `docs/ARCHITECTURE.md`、機能と起動方法は `README.md` を参照。

## 必ず守ること

- **サーバー再起動**: `app.py`/`templates`/`static` を変更したら
  `pkill -f "python3 -u app.py"` → `python3 -u app.py` で再起動してから確認する
  （自動リロード無効。再起動忘れは過去に誤診断の原因になった）。
- **バージョン更新**: 意味のある変更をコミットするたびに
  `changelog_data.py` の `APP_VERSION` を上げ、`CHANGELOG` 先頭へ
  エントリを追記する（新しい順）。
- **関数の定義は1箇所**: コア5ファイル内で同名関数を再定義しない。
  拡張ファイルからは `const base=fn; fn=function(){...base()...}` のラップのみ可、
  全置換は不可。IIFE内から公開する関数は `window.X=X` を明示。
- **列表示マスタ**: `/api/table` は表示設定で列を落とす。内部計算用の
  問い合わせには `include_hidden=1` を付ける。
- **フィールド名**: Accessの実カラム名は全角/半角ゆれがある。照合は
  `normalizedFieldName`/`exactFieldNumber` 系を使い、直接文字列比較しない。
  分割関連の実カラム名は「親子管理_子カード<N>」「コンマ5本分割_切断巾<N>」
  （旧VBA名 KOCARD/K05JO はエイリアスであり実カラム名ではない）。
- **DBエンジンの使い分け**: 仕掛(SIKALOTNOW)・品質データ(SIKALOTDEF)は工場側の
  別システムが所有するネットワーク共有上の読み取り専用Accessファイルのため、
  今後もpyodbc経由でAccessのまま読む。マスタ(`マスタ.sqlite3`)・測定データ
  バックアップ(`測定データ.sqlite3`)は本アプリ自身が読み書きするローカルの
  SQLiteで、`db_access.py`の`connect()`がパス拡張子でAccess/SQLiteを自動判別
  する。`masters.py`のSQLはNow()/Nz()等のAccess関数をそのまま使っているが、
  `connect()`がSQLite接続へユーザー定義関数として登録して吸収している。

## 検証

- Playwright ヘッドレス（Chromium: `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`、
  `NODE_PATH=/opt/node22/lib/node_modules`）。テストは scratchpad の `test_*.js`。
- サンドボックスにAccessドライバは無く、仕掛/品質データ系API(`/api/table`等、
  SIKALOTNOW/SIKALOTDEF)は接続先がAccessのままのため500を返す。実データ依存の
  検証は`page.route`でモックして行う。一方マスタ系API(`/api/operator-master`等)
  はSQLite化済みのため、サンドボックスでもモック無しで実際にサーバー経由の
  読み書きを検証できる。
- `openMeasurement`/`resumeStoredMeasure` は内部のマスタ問い合わせ失敗で
  例外を投げ得る。後続処理を確実に実行したいラップは `finally` に置く。

## Git

- 開発は featureブランチ（現行: `claude/quality-data-graph-layout-ban528`）で行い、
  ユーザーの明示指示があった場合のみ main へマージする。
