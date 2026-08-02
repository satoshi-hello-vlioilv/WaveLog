"""config.py: アプリ固有値の集約。

アプリID・表示名・ポート・ローカル領域名など「このアプリを別のアプリと
区別する値」をここ1箇所へ集める。以前はポート番号がstart_app.bat/app.py/
base.jsへ、表示名がindex.html/base.js/list-view.jsへ散在しており、
変更のたびに追従漏れが起きやすかった。

フロントエンドへは /api/build 経由で渡し、HTML/JSへの直接埋め込みを避ける。
"""

# アプリを識別するID。待機画面(loading.html)や起動ガードが「同じポートに
# 居るのが本当にこのアプリか」を判定するのに使う。ローカル領域の名前や
# 多重起動判定にも用いるため、他アプリと重複しない値にする。
APP_ID='wavelog'
APP_NAME='測定伝送システム'

HOST='127.0.0.1'
PORT=5029

# %LOCALAPPDATA% 配下に作るフォルダ名(ログ・実行時ファイルの置き場所)
LOCAL_DIR_NAME='WaveLog'

# 起動時に不足していれば requirements.txt から導入を試みるパッケージ
REQUIRED_PACKAGES=('flask','pyodbc')

# ========================================================================
# ウォッチドッグ(開いているタブの存在監視)のしきい値
#  EMPTY_GRACE_SEC     : 開いているタブが0件になってから終了するまでの猶予
#  HEARTBEAT_STALE_SEC : ハートビートが届かないタブを「消えた」とみなすまでの
#                        時間。通信瞬断で誤終了しないよう十分長くする(保険)
# ========================================================================
HEARTBEAT_STALE_SEC=3600
EMPTY_GRACE_SEC=90
WATCHDOG_CHECK_INTERVAL_SEC=10

# 測定データバックアップ(records.sqlite3)の閲覧用複製(records_export.py)を
# チェックする間隔。変化があった場合のみ複製するため、間隔を短くしても
# 無駄な複製は増えない(負荷軽減より鮮度を優先したい場合はここを短くする)。
RECORDS_BACKUP_EXPORT_INTERVAL_SEC=600

# 仕掛/品質データのローカル運用(config/local.jsonの"sikalot_source"="local")時、
# RNEから抽出する既定間隔。現場ごとに負荷/鮮度要件が異なり変更したいという
# 要望があったため、他の間隔値と異なりconfig/local.jsonの
# "rne_extract_interval_sec"で上書きできるようにしてある(この値は未設定時の
# 既定値)。
RNE_EXTRACT_INTERVAL_SEC_DEFAULT=900

# スケジュール機能(docs/SCHEDULE_MODE_DESIGN.md §4)の排他制御。共有環境
# (Box等)上のschedule.sqlite3へは常に1端末だけが短時間だけ触るよう、呼び出し
# 1回分だけを保持する短命ロック(schedule.lock.json)で直列化する。TTLは
# 「クラッシュ等で解放されないまま残ったロックが、自然に失効するまでの
# 最大待ち時間」でもあるため、短すぎると競合を見逃し、長すぎると無関係な
# 待ちが増える。実際のBoxクライアントの同期速度を見て現場で調整できるよう、
# config/local.jsonの"schedule_lock_ttl_sec"/"schedule_lock_verify_delay_ms"
# で上書き可能にしてある(ここは未設定時の既定値)。
SCHEDULE_LOCK_TTL_SEC_DEFAULT=30
SCHEDULE_LOCK_VERIFY_DELAY_MS_DEFAULT=1500

# 負荷率(換算係数)モデル(docs/SCHEDULE_MODE_DESIGN.md §6)。
# LOAD_FACTOR_CACHE_TTL_SEC: 設備ごとの算出結果をプロセス内にキャッシュする
# 秒数(実績ソースのmtime変化でも無効化されるため、TTLは「変化を検知できない
# 場合の保険」の意味合いが強い)。MIN_SAMPLES: これ未満の有効実績しかない
# 設備は自設備モデルを作らず、全設備プールのモデルへT0だけ差し替えて使う(§6.5)。
LOAD_FACTOR_CACHE_TTL_SEC=600
MIN_SAMPLES=20

def app_url():
 return f'http://{HOST}:{PORT}/'
