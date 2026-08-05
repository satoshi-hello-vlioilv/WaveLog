# config/rne_extract/ について

仕掛(SIKALOTNOW)・品質データ(SIKALOTDEF)をRNE(Navigator問い合わせ定義)から
抽出するときに必要なフォルダです。ネットワーク共有から直接読むだけの運用
(既定)で、抽出を一切使わない場合は、このフォルダに何も置く必要はありません。

WaveLogは各PCへローカルコピーして運用する前提のため、ここに置くファイルは
**PCごとの手動配置**です。以下のファイルは機密情報(接続パスワード)や
サイト固有の資産を含むため、リポジトリへは含めません(`.gitignore`で除外し、
追跡もしていません)。配布パッケージやセットアップ手順で別途配ってください。

**クローン直後はこのフォルダにREADMEと`symnavim.conf.example`しかありません。**
下の「配置するもの」が揃うまで抽出は動きませんが、アプリの他の機能には
影響しません(マスタ管理 > パス設定のRNE抽出パネルに、何が足りないかが出ます)。

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

抽出は**取得元(`sikalot_source`)と独立して実行できます**。共有から読む運用の
ままローカルの複製を作っておきたい、配置と接続を試したい、といった場合の
ためです。

- **定期実行**: パス設定マスタの`rne_extract_enabled`で決めます。
  `auto`(既定)=`sikalot_source=local`のときだけ / `on`=取得元に関わらず回す /
  `off`=回さない。毎周回で読み直すのでアプリの再起動は不要です。
- **手動実行**: マスタ管理 > パス設定の「今すぐ抽出」。上の設定や取得元に
  関わらず、このフォルダの資材が揃っていればいつでも実行できます。

`rne_extract_enabled`が有効なとき、`backend/rne_scheduler.py`が背景スレッドで
`rne_extract_interval_sec`(既定900秒=15分、マスタ管理画面の「パス設定」
タブで変更可。こちらは再起動不要で次回の周回から反映)ごとに上記RNEを実行し、
`db/sikalotnow.sqlite3`・`db/sikalotdef.sqlite3`を更新します。実際の抽出処理は
Windows専用(`SymNaviA.dll`をctypesで直接呼ぶ)で、サンドボックス等の
非Windows環境では常に失敗ログが出るだけで、サーバ自体は問題なく動作します。

検証で一時的にこのフォルダを使ったあとは、マスタ管理画面の「パス設定」タブで
`sikalot_source`を既定(未設定/network)に戻し、既定のネットワーク共有読み込みへ
戻してから再起動してください(sikalot_sourceは接続先を決める値のため、保存後も
サーバー再起動まで反映されません。戻し忘れると以降の起動がローカルSQLite3を
読み続けます)。
