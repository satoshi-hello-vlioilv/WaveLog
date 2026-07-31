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

def app_url():
 return f'http://{HOST}:{PORT}/'
