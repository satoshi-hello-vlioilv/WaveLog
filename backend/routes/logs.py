"""logs.py: ログビュワーのAPI(Blueprint)。

============================================================
なぜ画面から読めるようにするか
------------------------------------------------------------
ログは `%LOCALAPPDATA%\\WaveLog\\logs` にあり、**現場の端末では誰も開かない**。
「起動しない」「一覧が出ない」「固まった」と言われたときに、電話越しで
エクスプローラーの操作を説明してテキストエディタを開かせるのは現実的では
ないため、アプリの中から読める場所を用意する。

============================================================
1行 ≠ 1件（**折りたたみ**）
------------------------------------------------------------
`logging_setup.py` の書式は
`%(asctime)s %(levelname)-7s [%(name)s] %(message)s` で、**1件は必ず日時で
始まる**。ところが `log.exception()` が書くトレースバックは日時を持たない
行が何行も続く。ここを物理行のまま扱うと、

  * 画面では原因の行(`Traceback (most recent call last):` 以下)が
    別の出来事として散らばって読めなくなる
  * 「この1件を消す」で**見出しだけ消えて中身が残る**

ため、**日時で始まらない行は直前の件へ畳む**。件を消すときは畳んだ行も
一緒に消える(消す対象は物理行の集合として送る)。

============================================================
2系統を1本の時間軸へ
------------------------------------------------------------
WaveLogのログは目的別に2つある(`logging_setup.py`)。

  launcher.log … 起動入口(Python環境・多重起動判定・終了理由)
  app.log      … アプリ本体(リクエスト処理中のエラー)

調べたいのは**「その起動のとき何が起きたか」**で、これは2つにまたがる。
そこで既定では両方を読み、日時で1本に並べ直す。区切り(起動セッション)は
launcher側の `--- 起動 ---` 行で、画面はこれでまとめて表示する。

============================================================
書き込み中のファイルを書き換える
------------------------------------------------------------
削除・区切り(rotate)・消去は、**ロガーが開いたままのファイル**へ手を出す。
追記モードで開いている裏で中身を短くすると、次の追記が元の位置へ書かれて
**先頭が NUL で埋まる**。そのため、いずれも

  1. ハンドラのロックを取る(emitと同じ錠なので、書き込みと重ならない)
  2. flush → close(次のemitで開き直される。`FileHandler.emit`は
     stream が None なら開き直す)
  3. ファイルを書き換える

の順で行う。ロックを取らずにclose→書き換えだけにすると、その隙に別スレッドが
1行書いて開き直し、直後の書き換えでその行を失う。

============================================================
モードと権限
------------------------------------------------------------
読み出し(GET)は全モードから。**消す・区切るはeditモードだけ**
(`access_mode._WRITE_ALLOWED_MODES` に `'logs':{'edit'}`)。ログは端末ごとの
ローカルファイルで共有データではないが、消えると調査ができなくなる。
"""
import logging
import os
import re
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

from flask import Blueprint, jsonify, request, send_file
from .body import body, any_

from ..logging_setup import app_logger, launcher_logger
from ..paths import logs_dir
from ..quiet import quiet

bp=Blueprint('logs',__name__)

# このプロセスが立ち上がった時刻。起動の状況（§9.316）で「いつの起動か」を
# 言うのに使う——ログの区切りと突き合わせると、見ているのが今の起動かが分かる。
_PROCESS_STARTED=time.time()

# 系統(ストリーム)の定義。キー→(表示名, 実ファイル名, ロガーを返す関数)。
# ロガーを取りに行くのは、書き換えの前にハンドラを掴む必要があるため。
STREAMS={
 'app':('アプリ本体','app.log',app_logger),
 'launcher':('起動入口','launcher.log',launcher_logger),
}

# 末尾から読む量。RotatingFileHandlerが1ファイル1MBで回しているので、
# 現行ファイル1本はこの窓に収まる。古い版が残していた大きなファイルでも
# 画面が固まらないよう、窓そのものは決め打ちにしておく。
READ_BYTES=2*1024*1024
# 1回に返す件数の上限。既定でも十分に遡れる量にしつつ、絞り込みを
# 変えるたびに取り直すので、1回の転送は軽くしておく。
DEFAULT_LIMIT=1500
MAX_LIMIT=5000

# 1件の先頭。`2026-08-12 10:23:45,123 INFO    [app] 本文`
_HEAD=re.compile(r'^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}),(\d{3}) +([A-Z]+) +\[([^\]]*)\] ?(.*)$')
# 起動セッションの区切り(launcher.logの`--- 起動 ---`)。
_BOOT_MARK='--- 起動 ---'

LEVELS={'ERROR':'error','CRITICAL':'error','WARNING':'warning',
        'INFO':'info','DEBUG':'debug'}


def _stream_of(name):
 """ファイル名から系統キーを引く。`app.log.1` のような世代も同じ系統。

 **世代の接尾辞は数字だけ**を認める。`app.log.1.bak` のような手で置かれた
 控えまで拾うと、世代番号を読めないまま「現行」と並んでしまう。"""
 for key,(_label,filename,_logger) in STREAMS.items():
  if name==filename:return key
  if name.startswith(filename+'.') and name[len(filename)+1:].isdigit():return key
 return ''


def _generation(name):
 """世代番号。現行が0、`app.log.1` が1。並べ替えにだけ使う。"""
 tail=name.rsplit('.',1)[-1]
 return int(tail) if tail.isdigit() else 0


def _log_files():
 """いま置かれているログファイル。系統ごとに現行→古い順。"""
 d=logs_dir()
 out=[]
 for key,(label,filename,_logger) in STREAMS.items():
  found=[]
  for p in sorted(d.glob(filename+'*')):
   if not p.is_file():continue
   if _stream_of(p.name)!=key:continue
   found.append(p)
  found.sort(key=lambda p:_generation(p.name))
  for p in found:
   try:st=p.stat()
   except OSError:continue
   out.append({'name':p.name,'stream':key,'streamLabel':label,
               'current':_generation(p.name)==0,'generation':_generation(p.name),
               'size':st.st_size,
               'mtime':datetime.fromtimestamp(st.st_mtime).strftime('%Y-%m-%d %H:%M:%S')})
 return out


def _tail_lines(path,max_bytes):
 """末尾だけを読む。全文をメモリへ載せない。

 先頭は行の途中から始まっていることがあるので、切り詰めた場合は最初の1行を
 捨てる(半端な行を1件として見せないため)。"""
 try:size=path.stat().st_size
 except OSError:return [],0,False
 start=max(0,size-max_bytes)
 try:
  with path.open('rb') as f:
   if start:f.seek(start)
   raw=f.read()
 except OSError:
  return [],size,False
 lines=raw.decode('utf-8',errors='replace').splitlines()
 if start and lines:lines=lines[1:]
 return lines,size,bool(start)


def parse_records(lines,source,filename):
 """物理行の並びを「1件=見出し1行＋続きの行」へ畳む。

 日時で始まらない行(トレースバック等)は直前の件へ付ける。先頭がいきなり
 続きの行だった場合は、日時の無い件として1つ作る(捨てない——読めるものを
 黙って落とさない)。"""
 out=[]
 for line in lines:
  m=_HEAD.match(line)
  if m:
   ts,ms,level,logger,body=m.groups()
   out.append({'ts':ts,'ms':ms,'level':LEVELS.get(level,'info'),'levelRaw':level,
               'logger':logger,'text':body,'source':source,'file':filename,
               'lines':[line],'extra':[],'boot':body.strip()==_BOOT_MARK})
   continue
  if out:
   out[-1]['extra'].append(line)
   out[-1]['lines'].append(line)
  else:
   out.append({'ts':'','ms':'','level':'info','levelRaw':'','logger':'',
               'text':line,'source':source,'file':filename,
               'lines':[line],'extra':[],'boot':False})
 return out


def _sort_key(rec):
 """時間順。日時の無い件(先頭の半端な続き行)は最初に置く。"""
 return (rec['ts'] or '', rec['ms'] or '')


def _matches(rec,q,level,since):
 if level and level!='all':
  if level=='problem':
   if rec['level'] not in ('error','warning'):return False
  elif rec['level']!=level:return False
 if since and rec['ts'] and rec['ts']<since:return False
 if q:
  hay=(rec['text']+' '+' '.join(rec['extra'])+' '+rec['logger']).lower()
  if q not in hay:return False
 return True


# ========================================================================
# 起動の状況をまとめて1つに（§9.316、利用者の指示）
# ------------------------------------------------------------------------
# 「ログの保存場所が難しいので、毎回htmlを手動クリックで起動しています。
#   ログをアプリ上からコピーできるようにして、起動時の状況もアプリ上から
#   取得できるようにしてください」
#
# 起動の不具合は**起動した端末でしか分からない**のに、調べるための材料は
# `%LOCALAPPDATA%` の奥にある。電話越しにエクスプローラーを操作してもらうのは
# 現実的ではない——**1回押せば、そのまま貼れる1つの文章**にする。
#
# 集めるのは「どこを見て・何が在って・何が起きたか」の3つ。
#   ① いまの版・Python・端末（どのコードが動いているのか）
#   ② 置き場（**解決した実際のパス**と、在るか・大きさ・更新時刻・読めるか）
#   ③ 直近の起動1回ぶんのログ（`--- 起動 ---` から後ろ）
#
# **読むだけ**（GETなのでどのモードからも取れる）。**失敗しても部分的に返す**
# ——1つ読めないだけで「何も分からない」にしない（§4）。
# ========================================================================
def _place(label, path, note='', optional=False):
 """置き場1つぶんの事実。**存在確認で送出しない**（§9.108）——共有・クラウド
    越しの`exists()`はWinError 59等を送出しうるので、`path_exists_safe()`の
    True/False/**None（確かめられなかった）**をそのまま持つ。

 `optional`は**無いのがふつう**の置き場（次の起動用の待機画面・local.json）。
 健全な端末でも「無い」になるので、赤で出すと**毎回2件の偽の警告**を読ませる
 （§9.510・実測）。`bad`＝直すべきか、の答えはここの1箇所——画面も文章も
 これを読むだけにする。"""
 from ..db_access import path_exists_safe
 out={'label':label,'path':str(path) if path is not None else '',
      'exists':None,'size':None,'mtime':'','readable':None,'note':note,'error':'',
      'optional':bool(optional),'bad':False}
 if path is None:
  out['error']='解決できませんでした';out['bad']=True;return out
 try:out['exists']=path_exists_safe(path)
 except Exception as e:out['error']=f'{type(e).__name__}: {e}'
 if out['exists'] is False:
  # 無いものは「読めるか」を問わない（無い・読めない、と二重に言わない）
  out['bad']=not optional
  if optional:out['error']=''
  return out
 try:
  st=Path(path).stat()
  out['size']=st.st_size
  out['mtime']=datetime.fromtimestamp(st.st_mtime).strftime('%Y-%m-%d %H:%M:%S')
  out['isDir']=Path(path).is_dir()
 except Exception as e:
  if not out['error']:out['error']=f'{type(e).__name__}: {e}'
 # **「在る」だけでは足りない**（§9.314）——隔離されて0バイト・読めない、が
 # 起こりうる。フォルダーは中身が読めるかで見る。
 try:
  if out.get('isDir'):
   next(iter(Path(path).iterdir()),None);out['readable']=True
  else:
   with open(str(path),'rb') as f:out['readable']=bool(f.read(1))
 except Exception as _e:
  quiet('読めるかを確かめられない（読めないものとして出す）',_e)
  out['readable']=False
 out['bad']=out['readable'] is False
 return out


def boot_places():
 """調べるときに見る置き場を、**解決した実際のパス**で並べる（§9.316）。

 綴りではなく「いまこのプロセスが使っている値」を出す——設定に何と書いて
 あるかではなく、**どこを見に行っているか**が知りたいことなので。"""
 from .. import paths as P
 from ..config import APP_ID
 from ..launcher import ready
 from ..db_access import DBS
 out=[]
 def add(label,fn,note='',optional=False):
  try:out.append(_place(label,fn(),note,optional))
  except Exception as e:out.append({'label':label,'path':'','exists':None,'size':None,
                                    'mtime':'','readable':None,'note':note,
                                    'error':f'{type(e).__name__}: {e}',
                                    'optional':bool(optional),'bad':True})
 add('アプリ本体',lambda:P.APP_ROOT,'backend・static・program の置き場（初めての起動で %USERPROFILE%\\WaveLog へ写す）')
 add('デスクトップ版の本体',lambda:P.PROGRAM_DIR/'WaveLog.exe','入口がこの PC の版ごとの写しへ写して起動する物（main へは CI が置く）')
 add('ローカル領域',lambda:P.local_root(),'%LOCALAPPDATA%\\'+APP_ID+' 相当。書ける場所を順に探した結果')
 add('ログ',lambda:P.logs_dir())
 add('runtime',lambda:P.runtime_dir(),'刻印などの置き場')
 add('起動前確認の刻印',lambda:ready.stamp_file())
 add('作業用フォルダ',lambda:P.work_dir(),P.work_dir_reason() or '')
 add('config/local.json',lambda:P.local_config_path(),
     P.local_config_error() or '端末ごとの設定（無ければ既定で動く）',optional=True)
 for key in ('MASTER','MEAS'):
  entry=DBS.get(key) or {}
  if entry.get('path'):
   add(f"DB: {entry.get('label') or key}",lambda e=entry:Path(e['path']))
 return out


def boot_environment():
 """いま動いているものの素性（§9.316）。**版とPythonが最初の分かれ道**
    ——「直したはずの版が実際に動いているか」はここでしか分からない。"""
 import platform
 from ..changelog_data import APP_VERSION
 from ..config import APP_ID, PORT
 from ..launcher import ready
 from .. import paths as P
 env={'version':APP_VERSION,'appId':APP_ID,'port':PORT,
      'python':sys.executable,'pythonVersion':sys.version.split()[0],
      'platform':platform.platform(),'cwd':os.getcwd(),
      'startedAt':datetime.fromtimestamp(_PROCESS_STARTED).strftime('%Y-%m-%d %H:%M:%S'),
      'now':datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
 try:
  from ..access_mode import current_login_id, current_pc_name, get_mode
  env['loginId']=current_login_id();env['pcName']=current_pc_name();env['mode']=get_mode()
 except Exception as e:
  env['identityError']=f'{type(e).__name__}: {e}'
 # **このアプリからしか見えない写しになっていないか**（§9.318）。
 # Microsoft Store 版のPythonは`%LOCALAPPDATA%`への書き込みを私的な写しへ
 # 回すので、**こちらは読めるのにブラウザは読めない**——「在ると書いてあるのに
 # ファイルが見つかりません」の唯一の説明になりうる。**実測で言う**（推測しない）。
 try:
  env['browserDir']=str(P.browser_dir())
  env['browserDirReason']=P.browser_dir_reason()
 except Exception as e:
  env['browserDirError']=f'{type(e).__name__}: {e}'
 try:env['readyMismatch']=list(ready.mismatch() or [])
 except Exception as e:env['readyMismatch']=[f'確かめられませんでした: {e}']
 return env


def _current_records():
 """現行の2本（起動入口＋本体）を1本の時間軸へ。起動の状況と問題のまとめが
    同じ材料を読む（§9.510）。"""
 recs=[]
 for key,(label,filename,_logger) in STREAMS.items():
  path=logs_dir()/filename
  lines,_size,_cut=_tail_lines(path,READ_BYTES)
  if lines:recs.extend(parse_records(lines,key,filename))
 recs.sort(key=_sort_key)
 return recs


# ========================================================================
# エラー・警告を「同じ内容」でまとめる（§9.510、利用者の指示）
# ------------------------------------------------------------------------
# 「何かあったときは、ここのログからコピーして開発に戻せば状況が解析できる
#   ように」
#
# 実測で警告2,905件のうち2,873件が**同じ1文**だった。件数のまま並べると、
# 9件しかないエラーが警告の山に埋もれる——**種類で数える**。数字（件数・
# 秒数・ポート）だけが違う文は同じ内容とみなす。並びは**エラーが先・その中は
# 新しい順**。報告の文章も画面の「問題のまとめ」もこの1箇所を読む。
# ========================================================================
PROBLEM_TOP=15
_DIGITS=re.compile(r'\d+')


def _problem_query(text):
 """一覧の検索欄へ入れる語。**数字の手前まで**（数字は起きるたびに違う）。
    検索はサーバーの`_matches()`が小文字の部分一致で行う。"""
 head=re.split(r'\d',text or '',maxsplit=1)[0].strip()
 return (head if len(head)>=4 else (text or '').strip())[:40]


def problem_digest(records,top=PROBLEM_TOP):
 groups={}
 counts={'error':0,'warning':0}
 for r in records:
  lv=r.get('level')
  if lv not in counts:continue
  counts[lv]+=1
  key=(lv,_DIGITS.sub('#',r.get('text') or '')[:160])
  g=groups.get(key)
  if g is None:
   g=groups[key]={'level':lv,'text':r.get('text') or '','logger':r.get('logger') or '',
                  'source':r.get('source') or '','count':0,
                  'first':r.get('ts') or '','last':r.get('ts') or '','lines':r.get('lines') or []}
  g['count']+=1
  ts=r.get('ts') or ''
  if ts and (not g['first'] or ts<g['first']):g['first']=ts
  if ts>=g['last']:
   # 見本は**いちばん新しい1件**（トレースバックごと）
   g['last']=ts;g['text']=r.get('text') or '';g['lines']=r.get('lines') or []
 items=sorted(groups.values(),key=lambda g:g['last'],reverse=True)
 items.sort(key=lambda g:g['level']!='error')
 for g in items:g['query']=_problem_query(g['text'])
 kinds={lv:sum(1 for g in items if g['level']==lv) for lv in counts}
 return {'counts':counts,'kinds':kinds,'items':items[:top],'more':max(0,len(items)-top)}


@bp.get('/api/logs/problems')
def log_problems():
 """ログを見る段の「問題のまとめ」（§9.510）。読むだけ。"""
 return jsonify(ok=True,**problem_digest(_current_records()))


def last_boot_records(limit=400,recs=None):
 """直近の起動1回ぶん（§9.316）。`launcher.log`の`--- 起動 ---`から後ろを
    `app.log`と合わせて1本の時間軸へ並べる（この画面の既定と同じ扱い）。

 **区切りが見つからなければ末尾から**返す——「区切りが無いから何も出せない」
 のでは、いちばん知りたい初回起動で使えない。"""
 if recs is None:recs=_current_records()
 marks=[i for i,r in enumerate(recs) if r.get('boot')]
 picked=recs[marks[-1]:] if marks else recs[-limit:]
 return picked[:limit],bool(marks)


LEVEL_WORD={'error':'エラー','warning':'警告'}


def boot_report_text(env,places,records,found_mark,problems=None):
 """そのまま貼れる1つの文章（§9.316）。**画面の見た目ではなく中身を運ぶ**
    ——受け取る側（相談する相手）はテキストしか見ないので、ここで完結させる。"""
 L=[]
 L.append('==== WaveLog 起動の状況 ====')
 L.append(f"版        : VER{env.get('version','?')}   （{env.get('now','')} 時点）")
 L.append(f"起動時刻  : {env.get('startedAt','')}")
 L.append(f"端末      : {env.get('pcName','?')} / ログインID {env.get('loginId','?')}"
          f" / モード {env.get('mode','?')}")
 L.append(f"Python    : {env.get('pythonVersion','?')}  {env.get('python','')}")
 L.append(f"OS        : {env.get('platform','')}")
 L.append(f"ポート    : {env.get('port','')}   作業フォルダ: {env.get('cwd','')}")
 mism=env.get('readyMismatch') or []
 L.append('起動前確認: ' + ('済み（刻印あり）' if not mism else '要確認: '+' / '.join(map(str,mism))))
 if env.get('browserDirReason'):
  L.append('ほかのプログラムが読む置き場: '+str(env.get('browserDir',''))+'（'+str(env['browserDirReason'])+'）')
 L.append('')
 L.append('---- 置き場（いま見に行っている先） ----')
 for p in places:
  mark={True:'あり',False:'**無い**',None:'確かめられず'}.get(p.get('exists'),'?')
  if p.get('exists') is False and p.get('optional'):mark='無し（ふつう）'
  size='' if p.get('size') is None else f" {p['size']}バイト"
  read='' if p.get('readable') is None else ('' if p.get('readable') else ' **読めない**')
  L.append(f"  [{mark}]{size}{read} {p['label']}: {p['path']}")
  if p.get('mtime'):L.append(f"        更新 {p['mtime']}")
  if p.get('note'):L.append(f"        {p['note']}")
  if p.get('error'):L.append(f"        ！ {p['error']}")
 L.append('')
 # **次にすることを書く**（§4）——待機画面が「ファイルが見つかりません」に
 # なった端末では、**ブラウザのアドレス欄のパス**と上の「待機画面の写し」が
 # 同じかどうかが最初の分かれ道になる（別のタブ・別のファイルを見ていないか）。
 L.append('※ 待機画面が「ファイルが見つかりません」になったときは、'
          'ブラウザのアドレス欄のパスと、上の「待機画面の写し」のパスが'
          '同じかを見てください（違っていれば、開いているのは別のファイルです）。')
 L.append('')
 if problems is not None:
  c=problems.get('counts') or {};k=problems.get('kinds') or {}
  L.append('---- エラー・警告のまとめ（起動をまたいで・同じ内容は1つに） ----')
  L.append(f"  エラー {c.get('error',0):,}件（{k.get('error',0)}種類） / "
           f"警告 {c.get('warning',0):,}件（{k.get('warning',0)}種類）")
  for g in problems.get('items') or []:
   span=g['last'] if g['first']==g['last'] else f"{g['first']} 〜 {g['last']}"
   L.append(f"  [{LEVEL_WORD.get(g['level'],g['level'])}] ×{g['count']:,}  {span}  [{g.get('logger','')}] {g['text']}")
   # エラーはトレースバックごと（原因の行はそこにしか無い）
   if g['level']=='error':
    for x in (g.get('lines') or [])[1:40]:L.append('        '+x)
  if problems.get('more'):L.append(f"  （ほかに {problems['more']}種類。画面の「ログを見る」で読めます）")
  L.append('')
 L.append('---- 直近の起動のログ ----'
          + ('' if found_mark else '（起動の区切りが見つからないので末尾を出しています）'))
 for r in records:
  head=f"{r.get('ts','')}.{r.get('ms','')} {r.get('levelRaw','') or '-':7s} [{r.get('logger','')}] {r.get('text','')}"
  L.append('  '+head.rstrip())
  for x in r.get('extra') or []:
   L.append('      '+x)
 L.append('==== ここまで ====')
 return '\n'.join(L)


@bp.get('/api/boot-report')
def boot_report():
 """起動の状況を1つにまとめて返す（§9.316）。**部分的にでも返す**——
    どれか1つが読めなくても、残りは調べる役に立つ。"""
 try:
  env=boot_environment()
 except Exception as e:
  env={'error':f'{type(e).__name__}: {e}'}
 try:
  places=boot_places()
 except Exception as e:
  places=[{'label':'置き場を並べられませんでした','path':'','exists':None,'size':None,
           'mtime':'','readable':None,'note':'','error':f'{type(e).__name__}: {e}'}]
 problems=None
 try:
  recs=_current_records()
  records,found=last_boot_records(recs=recs)
  problems=problem_digest(recs)
 except Exception as e:
  records,found=[],False
  env['logError']=f'{type(e).__name__}: {e}'
 try:
  text=boot_report_text(env,places,records,found,problems)
 except Exception as e:
  text=f'まとめを作れませんでした: {type(e).__name__}: {e}'
 return jsonify(ok=True,env=env,places=places,records=records,
                bootMarkFound=found,problems=problems,text=text)


@bp.get('/api/logs/files')
def log_files():
 return jsonify(ok=True,files=_log_files(),dir=str(logs_dir()),
                streams=[{'key':k,'label':v[0],'file':v[1]} for k,v in STREAMS.items()])


@bp.get('/api/logs')
def read_logs():
 """絞り込んだ末尾を1本の時間軸で返す。

 絞り込みはサーバー側だけで行う(画面側にも同じ判定を置くと、片方だけ直した
 状態が作れる)。1MB級のファイルなので、条件を変えるたびに取り直してよい。"""
 files=request.args.get('files','')
 want=[x.strip() for x in files.split(',') if x.strip()]
 available={f['name']:f for f in _log_files()}
 targets=[n for n in want if n in available] or [f['name'] for f in available.values() if f['current']]
 q=(request.args.get('q') or '').strip().lower()
 level=(request.args.get('level') or 'all').strip()
 try:days=int(request.args.get('days') or 0)
 except ValueError:days=0
 since=(datetime.now()-timedelta(days=days)).strftime('%Y-%m-%d %H:%M:%S') if days>0 else ''
 try:limit=int(request.args.get('limit') or DEFAULT_LIMIT)
 except ValueError:limit=DEFAULT_LIMIT
 limit=max(1,min(limit,MAX_LIMIT))

 records=[];total=0;clipped=False;sizes={}
 for name in targets:
  path=logs_dir()/name
  lines,size,cut=_tail_lines(path,READ_BYTES)
  clipped=clipped or cut
  sizes[name]=size
  recs=parse_records(lines,_stream_of(name),name)
  total+=len(recs)
  records+=recs
 records.sort(key=_sort_key)
 matched=[r for r in records if _matches(r,q,level,since)]
 shown=matched[-limit:]
 counts={'error':0,'warning':0,'info':0,'debug':0}
 for r in records:counts[r['level']]=counts.get(r['level'],0)+1
 return jsonify(ok=True,records=shown,total=total,matched=len(matched),
                shown=len(shown),clipped=clipped,counts=counts,
                windowBytes=READ_BYTES,files=_log_files(),targets=targets,
                sizes=sizes,dir=str(logs_dir()))


# ========================================================================
# 書き換え系。ロガーが開いたままのファイルへ触るので、必ず _rewrite()/
# _with_handlers() を通すこと(冒頭の説明を参照)。
# ========================================================================
def _handlers_for(name):
 """そのファイルを開いているハンドラ。世代ファイル(app.log.1)は誰も
 開いていないので空になる。"""
 key=_stream_of(name)
 if not key:return []
 target=str(logs_dir()/name)
 logger=STREAMS[key][2]()
 return [h for h in logger.handlers
         if isinstance(h,logging.FileHandler) and os.path.abspath(h.baseFilename)==target]


def _with_handlers(name,fn):
 """開いているハンドラを止めてから fn() を実行する。

 ロック → flush → close の順。closeしたハンドラは次のemitで開き直される
 ため、後始末は要らない(開き直しは追記モードなので、書き換え後のファイルへ
 正しく続く)。"""
 handlers=_handlers_for(name)
 for h in handlers:h.acquire()
 try:
  for h in handlers:
   try:h.flush();h.close()
   except Exception as _e:quiet('接続を閉じられない（この要求のあいだだけの接続なので後で片付く）',_e)
  return fn()
 finally:
  for h in handlers:
   try:h.release()
   except Exception as _e:quiet('ログの鍵を解けない（次の追記でハンドラが開き直す）',_e)


def _resolve(name):
 """扱ってよいファイルかを確かめてパスを返す。**ログ置き場の中で、
 系統として知っているものだけ**(パスを組み立てさせない)。"""
 name=(name or '').strip()
 if not name or '/' in name or '\\' in name or not _stream_of(name):return None
 path=logs_dir()/name
 return path if path.exists() else None


@bp.post('/api/logs/rotate')
def rotate_now():
 """いまのログを1つ古い世代へ送り、新しいログを始める。

 世代の押し出しは`RotatingFileHandler.doRollover()`に任せる(自前で
 os.replaceを書くと、ハンドラが持っている世代数と食い違う)。"""
 name=body({'file': str}, silent=True, strict=True).text('file') or 'app.log'
 path=_resolve(name)
 if path is None:return jsonify(ok=False,error='そのログは扱えません'),400
 handlers=_handlers_for(name)
 rollers=[h for h in handlers if hasattr(h,'doRollover')]
 if not rollers:
  return jsonify(ok=False,error='このファイルは書き込み中ではないため区切れません（古い世代です）'),400
 size=path.stat().st_size
 for h in rollers:
  h.acquire()
  try:h.doRollover()
  finally:h.release()
 return jsonify(ok=True,size=size,files=_log_files())


@bp.post('/api/logs/clear')
def clear_log():
 name=body({'file': str}, silent=True, strict=True).text('file') or 'app.log'
 path=_resolve(name)
 if path is None:return jsonify(ok=False,error='そのログは扱えません'),400
 def do():
  path.write_text('',encoding='utf-8');return True
 _with_handlers(name,do)
 return jsonify(ok=True,files=_log_files())


def _rewrite(path,keep):
 text='\n'.join(keep)+('\n' if keep else '')
 path.write_text(text,encoding='utf-8')


@bp.post('/api/logs/delete-lines')
def delete_lines():
 """選んだ件を消す。**送られてくるのは物理行の集合**で、畳んだ続きの行
 (トレースバック)も含まれている。見出しだけ消して中身が残らないように。"""
 data=body({'file': str, 'lines': list}, silent=True, strict=True)
 name=data.text('file')
 path=_resolve(name)
 if path is None:return jsonify(ok=False,error='そのログは扱えません'),400
 remove=set(data.items_of('lines'))
 if not remove:return jsonify(ok=True,removed=0)
 def do():
  lines=path.read_text(encoding='utf-8',errors='replace').splitlines()
  keep=[x for x in lines if x not in remove]
  _rewrite(path,keep)
  return len(lines)-len(keep)
 removed=_with_handlers(name,do)
 return jsonify(ok=True,removed=removed,files=_log_files())


@bp.post('/api/logs/delete-old')
def delete_old():
 """指定日数より前の件を消す。**件の単位で消す**ので、続きの行だけが
 取り残されることはない(日時の無い行は直前の件の運命に従う)。"""
 # `days`は`any`のまま受けて読めなければ30へ倒す——**今までどおり**
 # （`int`で宣言すると読めない値が例外になり、このルートは`api_guard`を
 # 持たないので500になる。断り方を変えない・§9.132）。
 data=body({'file': str, 'days': any_}, silent=True)
 name=data.text('file')
 path=_resolve(name)
 if path is None:return jsonify(ok=False,error='そのログは扱えません'),400
 try:days=int(data.get('days') or 30)
 except (TypeError,ValueError):days=30
 days=max(1,min(3650,days))
 cutoff=(datetime.now()-timedelta(days=days)).strftime('%Y-%m-%d %H:%M:%S')
 def do():
  lines=path.read_text(encoding='utf-8',errors='replace').splitlines()
  recs=parse_records(lines,_stream_of(name),name)
  keep=[]
  removed=0
  for r in recs:
   # 日時が読めない件は残す(消す根拠が無いものを消さない)
   if r['ts'] and r['ts']<cutoff:removed+=1;continue
   keep+=r['lines']
  _rewrite(path,keep)
  return removed
 removed=_with_handlers(name,do)
 return jsonify(ok=True,removed=removed,days=days,files=_log_files())


@bp.get('/api/logs/download')
def download_log():
 """そのままの1本を保存する。貼り付けでは崩れる長いログを渡すため。"""
 path=_resolve(request.args.get('file') or '')
 if path is None:return jsonify(ok=False,error='そのログは扱えません'),400
 stamp=time.strftime('%Y%m%d-%H%M%S')
 return send_file(path,as_attachment=True,mimetype='text/plain',
                  download_name=f'{Path(path).stem}-{stamp}.log')
