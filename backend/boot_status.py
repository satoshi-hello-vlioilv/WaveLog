"""boot_status.py: 起動待機画面(loading.html)へ「今どの段階か」を伝える。

待機画面はブラウザが file:// で開く静的ページで、Webサーバーがまだ
立ち上がっていない間は当然どのAPIも叩けない。そのため以前は
**経過秒数だけ**で段階表示を切り替えていた(2秒未満→実行環境、5秒未満→
アプリを準備中、それ以降は全部「接続を確認中」)。実際の進捗ではないので、
共有の応答が遅くて時間がかかる場合は「接続を確認中」に延々留まり、
どこで待たされているのか利用者にも管理者にも分からなかった。

ここでは起動処理が段階ごとにアプリ直下へ小さなJSファイルを書き出し、
待機画面がそれを <script src> で読み込む(file:// 同士なのでfetchは使えない)。
Webサーバーの起動前から実際の進捗を出せる。

書き込みに失敗しても起動そのものは続ける(表示の都合で起動を止めない)。
"""
import json
import time

from .paths import APP_ROOT, browser_dir
from .changelog_data import APP_VERSION
from .quiet import quiet

STATUS_FILENAME='boot_status.js'
# 待機画面の一覧と対応させる。増減させるときは loading.html の steps も合わせる。
STEPS=(
 ('env','実行環境を確認'),
 ('instance','起動中のアプリを確認'),
 ('packages','必要な部品を確認'),
 ('data','データの置き場所を確認'),
 ('app','アプリを読み込み'),
 ('server','Webサーバーを起動'),
)
# 起動はここで終わりではない。Webサーバーが応答してからブラウザが画面を
# 組み立て終えるまでにもう少し時間がかかり、以前はその間、崩れた途中の
# 画面が見えていた。ブラウザ側も同じ「段階」として扱い、待機画面
# (loading.html)とアプリ内の起動オーバーレイ(index.html)が**1本の進捗**を
# 共有する。合計数をここで決め、両方がこの数を分母にする。
BROWSER_STEPS=(
 ('assets','画面部品を読み込み'),
 ('permission','権限を確認'),
 ('list','一覧を読み込み'),
 ('layout','表示を整える'),
)
TOTAL_STEPS=len(STEPS)+len(BROWSER_STEPS)
_STEP_INDEX={key:i for i,(key,_label) in enumerate(STEPS)}
_started=time.time()


def status_path():
 """進捗ファイルの置き場。**端末ごと**(§9.225)。

    アプリ本体は共有フォルダーへ置く運用があるので、ここを共有側にすると
    **全台が同じ1つを取り合う**——2台が同時に起動すると、相手の進捗が
    自分の待機画面に出る。しかも起動のたびに共有へ6回書くことになる。
    `loading.html`は`<script src="boot_status.js">`と**相対で**読むので、
    待機画面の写しと同じ場所へ置けばそれだけで筋が通る
    (`setup_check.waiting_page()`が写しの置き場)。

    **書けなかったら共有側へ落とす**——進捗が出ないより、出たほうがよい。

    置き場は`paths.browser_dir()`が答える(§9.318)——**待機画面と同じ場所**
    でなければ`<script src="boot_status.js">`が当たらない。答える場所を
    2つ持たないこと。"""
 try:
  return browser_dir()/STATUS_FILENAME
 except Exception as _e:
  quiet('進捗ファイルの置き場を決められない（アプリの隣へ置く）',_e)
  return APP_ROOT/STATUS_FILENAME


def _path():
 return status_path()


# 更新の作業をしているか（§9.411、利用者の指示③「アップデートなども実施して
# くれると思うので、実施しているときとしていないときの違いも分かるように」）。
# **4つしかない**——分からないうちは空（推測して「していない」と言わない）。
WORK_NONE=''        # まだ分からない／その段は更新と関係ない
WORK_SKIP='skip'    # 前回の確認のままで済んだ（飛ばした）
WORK_UPDATE='update'  # アプリの版が上がったので、いま反映している
# **「更新」と「確認」を言い分ける**（§9.415）。初めての起動・Pythonの入れ替え・
# 必要な部品の変更でも同じ段（30〜60秒）を通るが、**アプリは1文字も更新されて
# いない**。同じ題で「更新を反映中」と出すと、画面が事実と食い違う。
WORK_SETUP='setup'  # 版は同じだが、起動前の確認をやり直している
# 何が変わったから確認しているか（`ready.diff()`の答え）。**直近の1回を
# 覚えておく**——確認の途中の細かい進捗を書くたびに理由を渡し直さずに済む。
_work=WORK_NONE
_reasons=[]


def set_work(work,reasons=None):
 """この起動が更新の作業をしているかを決める。**決めるのは1箇所**
    （`start_app`の刻印の判定）——ここは覚えるだけ。"""
 global _work,_reasons
 _work=work or WORK_NONE
 if reasons is not None:_reasons=[str(x) for x in reasons]


def report(step,detail='',failed=False,work=None,reasons=None):
 """現在の段階を書き出す。step は STEPS のキー。

 `work`/`reasons` を渡すと、以降の書き出しにも同じものが付く（§9.411）
 ——待機画面は「更新を反映しています」と「更新なし」を**同じ場所**で
 言い分ける。"""
 if work is not None or reasons is not None:set_work(work if work is not None else _work,reasons)
 index=_STEP_INDEX.get(step)
 if index is None:return
 payload={'step':step,'index':index,'total':TOTAL_STEPS,
          'label':STEPS[index][1],'detail':str(detail or ''),
          'version':APP_VERSION,'work':_work,'reasons':list(_reasons),
          'failed':bool(failed),'at':time.time(),'elapsed':round(time.time()-_started,1)}
 try:
  _path().write_text('window.wavelogBootStatus&&window.wavelogBootStatus('
                     +json.dumps(payload,ensure_ascii=False)+');\n',encoding='utf-8')
 except Exception as _e:
  quiet('起動の進捗を書けない（待機画面が古いまま出る）',_e)


def clear():
 """起動完了後に消す(次回起動時に前回の内容が一瞬見えるのを防ぐ)。"""
 try:_path().unlink(missing_ok=True)
 except Exception as _e:quiet('いらないファイルを消せない（次の掃除で片付く）',_e)


# ===========================================================================
# 待機画面がブラウザで生きているか（§9.318、利用者の報告）
# ---------------------------------------------------------------------------
# 「起動時、うまくいかなくてhtmlを後から直接クリックして起動している」
#
# **渡したことと、見えていることは別**——`os.startfile()`は成功しても、
# ブラウザがそのファイルを開けたかは分からない（隔離・同期・掃除・
# 私的な写し・復元タブ・関連付け…原因はいくらでもある）。
# 待機画面は`http://127.0.0.1:PORT/api/ready.js`を**繰り返し**読みに来るので、
# **1回でも来たなら、そのブラウザで生きている**と言い切れる。
# ここはその印だけを持つ（判定と打つ手は`start_app`が持つ）。
# ===========================================================================
_waiting_seen=0.0

def note_waiting_seen():
 """待機画面から問い合わせが来た。**時刻を覚えるだけ**。"""
 global _waiting_seen
 _waiting_seen=time.time()

def waiting_seen():
 """待機画面がブラウザで生きていた時刻（一度も来ていなければ0.0）。"""
 return _waiting_seen
