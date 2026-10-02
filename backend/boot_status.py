"""boot_status.py: 起動の段の顔ぶれ（アプリ内の起動の覆い`#appBoot`が読む）。

`#appBoot`（templates/index.html）と base.js の`BOOT_SERVER_STEPS`／`BOOT_TOTAL_STEPS`は、
ここの`STEPS`（中身が起動するまでの段）と`BROWSER_STEPS`（画面を組み立てる段）を1本の進捗として
数える（`tests/test_boot.py`が3箇所の一致を見張る）。

以前はブラウザ版の待機画面（loading.html）へ進捗を渡すため、起動処理が段ごとに`boot_status.js`を
書き出していた。§9.548 でブラウザ版の起動の道を外し、中身の起動の進み具合はデスクトップ版の
起動画面（desktop/splash・窓口の`progress`の知らせ）が出すので、ここに残るのは顔ぶれだけ。
"""

STEPS=(
 ('env','実行環境を確認'),
 ('instance','起動中のアプリを確認'),
 ('packages','必要な部品を確認'),
 ('data','データの置き場所を確認'),
 ('app','アプリを読み込み'),
 ('server','Webサーバーを起動'),
)
# 中身が起動してから画面を組み立て終えるまでの段。アプリ内の起動の覆い(index.html)が
# 上の段と**1本の進捗**として数える。合計数をここで決め、両方がこの数を分母にする。
BROWSER_STEPS=(
 ('assets','画面部品を読み込み'),
 ('permission','権限を確認'),
 ('list','一覧を読み込み'),
 ('layout','表示を整える'),
)
TOTAL_STEPS=len(STEPS)+len(BROWSER_STEPS)
