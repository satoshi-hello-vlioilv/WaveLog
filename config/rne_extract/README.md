# config/rne_extract/ について

仕掛(SIKALOTNOW)・品質データ(SIKALOTDEF)をローカル運用(`config/local.json`の
`"sikalot_source": "local"`)で使うときだけ必要なフォルダです。ネットワーク共有
(既定運用)のみを使う場合は、このフォルダに何も置く必要はありません。

WaveLogは各PCへローカルコピーして運用する前提のため、ここに置くファイルは
**PCごとの手動配置**です。以下のファイルは機密情報(接続パスワード)や
サイト固有の資産を含むため、リポジトリへは含めず(`.gitignore`で除外済み)、
配布パッケージやセットアップ手順で別途配ってください。

## 配置するもの

```
config/rne_extract/
├── symnavim.conf              手動配置(接続情報。symnavim.conf.exampleを参照)
├── rne/
│   ├── SIKALOTNOW.RNE          手動配置(仕掛のNavigator問い合わせ定義)
│   └── SIKALOTDEF.RNE          手動配置(品質データのNavigator問い合わせ定義)
└── NAVIAP/
    ├── dllVC14/SymNaviA.dll        手動配置(32bit版、いずれか1つで可)
    ├── dllVC14x64/SymNaviA.dll     手動配置(64bit版、いずれか1つで可)
    ├── debugdllVC14/SymNaviA.dll   手動配置(デバッグ版、通常は不要)
    └── debugdllVC14x64/SymNaviA.dll 手動配置(デバッグ版、通常は不要)
```

- `SymNaviA.dll`はPythonのビット幅(64bit運用が基本)に合った1つがあれば動作
  します。`C:\NAVIAP`配下に利用可能なDLLがあればそちらを優先し、無ければここへ
  フォールバックします(`backend/navigator_api.py`の`candidate_dlls`)。
- `rne/`配下のファイル名は`backend/rne_scheduler.py`の`JOBS`が参照する固定名
  (`SIKALOTNOW.RNE`・`SIKALOTDEF.RNE`)のため、変更しないでください。
- `symnavim.conf`はSymfoNavi Navigator接続用のINI形式ファイルです。テンプレート
  は`symnavim.conf.example`を参照(実際のサーバー名・ID・パスワードは記載しない
  でください)。

## しくみ

`sikalot_source=local`のとき、`backend/rne_scheduler.py`が背景スレッドで
`rne_extract_interval_sec`(既定900秒=15分、`config/local.json`で変更可)ごとに
上記RNEを実行し、`db/sikalotnow.sqlite3`・`db/sikalotdef.sqlite3`を更新します。
実際の抽出処理はWindows専用(`SymNaviA.dll`をctypesで直接呼ぶ)で、サンドボックス
等の非Windows環境では常に失敗ログが出るだけで、サーバ自体は問題なく動作します。

検証で一時的にこのフォルダを使ったあとは、`config/local.json`の
`sikalot_source`を`null`(または削除)に戻し、既定のネットワーク共有読み込みへ
戻してから再起動してください(戻し忘れると以降の起動がローカルSQLite3を
読み続けます)。
