"""rne.py: RNE抽出の状態表示と手動実行のAPI(Blueprint)。

backend/routes/masters.py から分離した(docs/REFACTORING_PLAN.md フェーズ4.1)。
ロジックは変更していない(移動のみ)。URLも従来と同一。

**エンドポイント名がBlueprint名込みで参照されている**: 手動実行は
「読み直すだけのPOST」としてガードの対象外に置かれており、
backend/access_mode.py の _READ_ONLY_POST_ENDPOINTS が
'masters.rne_extract_run' を持っていた。この分離に合わせて
'rne.rne_extract_run' へ更新してある。更新し忘れると、全モードで叩けたはずの
手動実行がeditモード以外で403になる。tests/test_modeguard.py が固定している。
"""
from flask import Blueprint, jsonify

bp=Blueprint('rne',__name__)

# ========================================================================
# RNE抽出(仕掛/品質データのローカル運用)の状態表示と手動実行(§9.50)
#  従来は「起動時に1回＋rne_extract_interval_secごと」の背景実行だけで、
#  動いているのかを画面から確かめる手段も、その場で取り直す手段も無かった。
#  (「実際に起動させる方法が分からない」という指摘。抽出の成否はアプリログに
#   しか出ていなかった。)
# ========================================================================
@bp.get('/api/rne-extract/status')
def rne_extract_status():
 from .. import rne_scheduler
 return jsonify(ok=True,**rne_scheduler.last_status())

@bp.post('/api/rne-extract/run')
def rne_extract_run():
 """画面の「今すぐ抽出」。抽出は数十秒かかり得るので背景スレッドで走らせ、
 画面は /status をポーリングして結果を見る(要求は即座に返す)。"""
 from .. import rne_scheduler
 import threading as _th
 # 手動実行は取得元(sikalot_source)に関わらず行える。共有から読む運用でも、
 # ローカルの複製を用意する・配置と接続を試す目的で実行できてよいため。
 missing=[j['rne'] for j in rne_scheduler.JOBS
          if not (rne_scheduler.RNE_ASSETS_DIR/'rne'/j['rne']).exists()]
 if missing:
  return jsonify(error=f'抽出定義(RNE)が配置されていません: {", ".join(missing)}。'
                       f'{rne_scheduler.RNE_ASSETS_DIR/"rne"} へ配置してください。'),400
 if not (rne_scheduler.RNE_ASSETS_DIR/'symnavim.conf').exists():
  return jsonify(error=f'接続情報 symnavim.conf が配置されていません'
                       f'({rne_scheduler.RNE_ASSETS_DIR})。'),400
 status=rne_scheduler.last_status()
 if status.get('running'):
  return jsonify(error='抽出が既に実行中です。完了までお待ちください。'),409
 def _go():
  try:rne_scheduler.run_batch('manual')
  except Exception:pass   # 失敗は last_status()のjobs[].errorに出る
 _th.Thread(target=_go,daemon=True,name='rne-manual').start()
 return jsonify(ok=True,started=True,message='抽出を開始しました。完了すると状態表示が更新されます。')
