"""services.py: 起動したあと裏で回す処理の開始（§9.544）。

窓口が2つある——ポートで待つ`server.py`（ブラウザ版）と、標準入出力で
答える`program/sidecar.py`（デスクトップ版）。**裏で回す処理はどちらでも
同じ**でなければならない。共有DBの写し・共有スケジュールの見張り・書込役は、
他の端末と同じ作法で共有フォルダへ触る仕組みで、窓口によって片方だけ
動いていると、移行のあいだ混在する端末どうしの約束が崩れる。

だから開始の手順は**ここ1箇所**に置き、2つの窓口が同じ関数を呼ぶ。
入れていないもの: `watchdog.start()`（タブが0件で終わる見張り）。これは
「ブラウザを閉じたかをハートビートで推し量る」ポート版だけの仕組みで、
デスクトップ版は**標準入力が閉じたこと**で終わる（推し量りが要らない）。

どれも**失敗しても起動は止めない**（画面は前の写し・自分で書く道で動く）。
"""


def start(log):
 """写し・見張り・書込役を始める。`log`は起動の記録（launcher.log）。"""
 # 共有上の読み取り専用DBを手元へ写す背景処理(§9.89)。共有の更新と読み取りが
 # 重なると正しく読めないため、画面は常に手元の写しを読む。写せなくても
 # 画面は前の写し(または共有)で動くので、ここでの失敗は起動を止めない。
 try:
  from backend import db_mirror, paths  # 遅延: 読めなくても起動は止めない（写しが無くても画面は共有を直に読む）
  if db_mirror.enabled():
   db_mirror.start()
   log.info('共有DBの写し: %d秒ごとに更新します',db_mirror.interval_sec())
   # 置き場が共有・クラウド同期フォルダーの上なら、写しは自動で手元へ
   # 逃がしてある(§9.109)。**利用者に設定を求めない**ので、ここは
   # 「こうしてください」ではなく「こうしました」を残すだけにする。
   if paths.work_dir_relocated():
    log.info('作業用ファイル(写し・作業コピー)は手元へ置きます: %s（%s）',
             paths.work_dir(),paths.work_dir_reason())
 except Exception as e:
  log.warning('共有DBの写しを開始できませんでした: %s',e)
 # 共有スケジュールの見張り(§9.188)。**読むたびに共有から写すのをやめ**、
 # 改訂番号だけを見て変わったときだけ写す。写せなくても画面は前の写しで
 # 動くので、ここでの失敗は起動を止めない。
 try:
  from backend import schedule_sync, schedule_watch  # 遅延: 読めなくても起動は止めない（見張りが無くても前の写しで動く）
  if schedule_sync.SCHEDULE_SHARE_PATH and schedule_sync.watch_enabled():
   schedule_watch.start()
   log.info('共有スケジュールの見張り: %d秒ごとに確かめ、取り込んだら%d秒休みます',
            schedule_sync.watch_interval_sec(),schedule_sync.watch_pause_sec())
 except Exception as e:
  log.warning('共有スケジュールの見張りを開始できませんでした: %s',e)
 # 共有スケジュールの持ち主(§9.192→§9.269)。**既定は on**。持ち主になれた
 # 端末だけが小さな受け口をLANへ開く（画面の窓口とは別のポート。窓口が
 # パイプでも同じに開く）。切ってある現場は今までどおり各端末が自分で共有へ書く。
 # 見張りは**入れていなくても回す**（1分ごとに設定だけを見る。共有には触らない）。
 # こうしておくと、マスタ管理で入れ切りしたときに再起動を待たなくてよい。
 try:
  from backend import schedule_owner  # 遅延: 読めなくても起動は止めない（書込役が無くても各端末が自分で書く）
  schedule_owner.start()
  if schedule_owner.enabled():
   log.info('共有スケジュールの持ち主機構: 有効（受け口 %s）',
            ', '.join(schedule_owner.local_urls()))
  else:
   log.info('共有スケジュールの持ち主機構: 無効（各端末が自分で共有へ書きます）')
 except Exception as e:
  log.warning('持ち主機構を開始できませんでした: %s',e)
