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
import time
from datetime import datetime, timedelta
from pathlib import Path

from flask import Blueprint, jsonify, request, send_file

from ..logging_setup import app_logger, launcher_logger
from ..paths import logs_dir

bp=Blueprint('logs',__name__)

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
   except Exception:pass
  return fn()
 finally:
  for h in handlers:
   try:h.release()
   except Exception:pass


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
 name=(request.get_json(silent=True) or {}).get('file') or 'app.log'
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
 name=(request.get_json(silent=True) or {}).get('file') or 'app.log'
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
 data=request.get_json(silent=True) or {}
 name=data.get('file') or ''
 path=_resolve(name)
 if path is None:return jsonify(ok=False,error='そのログは扱えません'),400
 remove=set(data.get('lines') or [])
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
 data=request.get_json(silent=True) or {}
 name=data.get('file') or ''
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
