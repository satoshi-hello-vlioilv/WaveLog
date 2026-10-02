"""config.py: アプリ固有値の集約。

アプリID・表示名・ポート・ローカル領域名など「このアプリを別のアプリと
区別する値」をここ1箇所へ集める。以前はポート番号がstart_app.bat/app.py/
base.jsへ、表示名がindex.html/base.js/list-view.jsへ散在しており、
変更のたびに追従漏れが起きやすかった。

`HOST`/`PORT`は**開発と網の入口**（`backend/launcher/server.py`）と、書込役の LAN の受け口
（`PORT+1`）のため。利用者の起動はデスクトップ版（ポートなし）だけ（§9.548）。

フロントエンドへは /api/build 経由で渡し、HTML/JSへの直接埋め込みを避ける。
"""

# アプリを識別するID（/api/build と書込役の受け口が名乗る）。他アプリと重複しない値にする。
APP_ID='wavelog'
APP_NAME='測定伝送システム'

HOST='127.0.0.1'
PORT=5029

# デスクトップ版(§9.544・docs/DESKTOP_MIGRATION_DESIGN.md)の画面の置き場。
# ポートを開かず、窓(Tauri)が自前の仕組み`wavelog`で受けて標準入出力で渡す。
# WindowsのWebView2では`http://<仕組み>.localhost/`になる(Tauriの決まり)。
# **窓(Rust)の側も同じ名前を使う**——食い違うとURLの組み立てがずれる。
DESKTOP_SCHEME='wavelog'
DESKTOP_BASE_URL=f'http://{DESKTOP_SCHEME}.localhost/'

# %LOCALAPPDATA% 配下に作るフォルダ名(ログ・実行時ファイルの置き場所)
LOCAL_DIR_NAME='WaveLog'

# 起動時に不足していれば requirements.txt から導入を試みるパッケージ
REQUIRED_PACKAGES=('flask',)

# 測定データバックアップ(records.sqlite3)の閲覧用複製(records_export.py)を
# チェックする間隔。変化があった場合のみ複製するため、間隔を短くしても
# 無駄な複製は増えない(負荷軽減より鮮度を優先したい場合はここを短くする)。
RECORDS_BACKUP_EXPORT_INTERVAL_SEC=600

# 仕掛/品質データのローカル運用(パス設定マスタの"sikalot_source"="local")時、
# RNEから抽出する既定間隔。現場ごとに負荷/鮮度要件が異なり変更したいという
# 要望があったため、他の間隔値と異なりパス設定マスタ(db/master.sqlite3、
# マスタ管理画面から編集)の"rne_extract_interval_sec"で上書きできるように
# してある(この値は未設定時の既定値)。
RNE_EXTRACT_INTERVAL_SEC_DEFAULT=900

# スケジュール機能(docs/SCHEDULE_MODE_DESIGN.md §4)の排他制御。共有環境
# (Box等)上のschedule.sqlite3へは常に1端末だけが短時間だけ触るよう、呼び出し
# 1回分だけを保持する短命ロック(schedule.lock.json)で直列化する。TTLは
# 「クラッシュ等で解放されないまま残ったロックが、自然に失効するまでの
# 最大待ち時間」でもあるため、短すぎると競合を見逃し、長すぎると無関係な
# 待ちが増える。実際のBoxクライアントの同期速度を見て現場で調整できるよう、
# パス設定マスタの"schedule_lock_ttl_sec"/"schedule_lock_verify_delay_ms"
# で上書き可能にしてある(ここは未設定時の既定値)。
SCHEDULE_LOCK_TTL_SEC_DEFAULT=30
SCHEDULE_LOCK_VERIFY_DELAY_MS_DEFAULT=1500
# ファイルサーバー(SMB)は書いた直後に読み返せるので、確認の待ちは短くてよい
# (§9.267の追補。`master_share`のLOCK_VERIFY_DELAY_NETWORK_SECと同じ考え方)。
# 上の1500msはクラウド同期(Box等。結果整合なので待たないと確かめにならない)向け。
SCHEDULE_LOCK_VERIFY_DELAY_NETWORK_MS=300
# 共有スケジュールの見張り(§9.188)。読むたびに共有から写し直すのをやめ、
# 改訂番号だけを見て**変わったときだけ**写す。
#   INTERVAL … 変化を見る間隔(秒)。写しはこの間隔のあいだ「新しい」とみなす。
#   PAUSE    … 写した直後に休む時間(秒)。頻繁に更新が続くときに、
#              こちらが写し続けて共有を掴み続けるのを防ぐ(利用者の指示で30秒)。
SCHEDULE_WATCH_INTERVAL_SEC_DEFAULT=15
SCHEDULE_WATCH_PAUSE_SEC_DEFAULT=30
# 共有スケジュールの「持ち主」(§9.192)。1台だけが共有ファイルへ書き、
# 他の端末は書き込みをその1台へHTTPで頼む。
#   PORT+1 を受け口にする（本体のFlaskは 127.0.0.1 のまま。受け口だけLANへ開く）。
#   TTL … 目印(schedule.owner.json)の有効期限。切れたら別の端末が名乗り出る。
SCHEDULE_OWNER_PORT_DEFAULT=PORT+1
SCHEDULE_OWNER_TTL_SEC_DEFAULT=90

# 負荷率(換算係数)モデル(docs/SCHEDULE_MODE_DESIGN.md §6)。
# LOAD_FACTOR_CACHE_TTL_SEC: 設備ごとの算出結果をプロセス内にキャッシュする
# 秒数(実績ソースのmtime変化でも無効化されるため、TTLは「変化を検知できない
# 場合の保険」の意味合いが強い)。MIN_SAMPLES: これ未満の有効実績しかない
# 設備は自設備モデルを作らず、全設備プールのモデルへT0だけ差し替えて使う(§6.5)。
LOAD_FACTOR_CACHE_TTL_SEC=600
MIN_SAMPLES=20

