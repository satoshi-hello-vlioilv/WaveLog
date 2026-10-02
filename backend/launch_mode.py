"""launch_mode.py: この端末の起動のしかた（ブラウザ版／デスクトップ版）を1箇所で持つ（§9.547）。

===========================================================================
利用者の指示（§9.547）
  「良いですが最終的にはexe起動に一本化したいです。」
  （端末ごとに切り替えるスイッチを置く → 段を踏んで exe の起動へ寄せる）

誰が読むか
---------------------------------------------------------------------------
読むのは**`Start.vbs`（WSH）**——Python が動く前に「どちらで起こすか」を決める
のは Start.vbs だけだから。なので置き場は**Python と WSH の両方から見える所**:

  1. `%LOCALAPPDATA%\\WaveLog\\runtime\\launch_mode.txt`
  2. `%USERPROFILE%\\.wavelog\\runtime\\launch_mode.txt`

Microsoft Store 版の Python が 1 へ書くと、**このアプリからしか見えない写し**に
なる（§9.318・§9.496）。そのときは 2 へ書く（`paths.msix_private_copy()`で見分ける）。
Start.vbs は**両方を見て新しいほう**を採る——古い Python のときに残った 1 が
あっても、いま書いたほうが勝つ。アプリ本体の隣（`APP_ROOT/runtime`）は使わない
——共有（Box）の上なので、**端末ごと**にならない。

既定（`DEFAULT`）は Start.vbs の`Const DEFAULT_MODE`と同じ値（網が見張る）。
一本化は**この既定を変える**ことで進める（設計書の「起動の一本化」）。
===========================================================================
"""
import os
import sys
import time
from pathlib import Path

from . import paths
from .paths import APP_ROOT
from .quiet import quiet

# 顔ぶれ。**画面の字もここから出す**（画面へ書き写さない・§9.163）。
MODES=('browser','desktop')
LABELS={'browser':'ブラウザ版','desktop':'デスクトップ版'}
HINTS={'browser':'いつものブラウザ（Edge）で開きます',
       'desktop':'専用の窓（WaveLog.exe）で開きます。ポートを使いません'}
# 引数なしの Start.vbs が起こすもの。Start.vbs の`Const DEFAULT_MODE`と同じ値。
DEFAULT='browser'
FILE_NAME='launch_mode.txt'
EXE_NAME='WaveLog.exe'


def _home():
 return Path.home()


def places():
 """Start.vbs が読む置き場（この順に書いてみる）。"""
 out=[]
 base=os.environ.get('LOCALAPPDATA')
 if base:out.append(Path(base)/'WaveLog'/'runtime'/FILE_NAME)
 try:out.append(_home()/'.wavelog'/'runtime'/FILE_NAME)
 except Exception as _e:quiet('ホームの場所を決められない（この置き場は使わない）',_e)
 return out


def _read(path):
 try:
  word=path.read_text(encoding='utf-8-sig').strip().lower()
 except Exception as _e:
  quiet('起動のしかたを読めない（無いものとして扱う）',_e)
  return None
 return word if word in MODES else None


def saved():
 """残してある起動のしかたと、その置き場。**新しいほう**を採る（Start.vbs と同じ）。
    無ければ`(None, None)`。"""
 best=None
 for p in places():
  try:
   if not p.is_file():continue
   t=p.stat().st_mtime
  except Exception as _e:
   quiet('起動のしかたの置き場を見られない（次を見る）',_e)
   continue
  if best is None or t>best[0]:best=(t,p)
 if best is None:return None,None
 return _read(best[1]),best[1]


def write(mode):
 """残す。**Start.vbs から見える置き場**へ書けたときだけ`ok`。"""
 if mode not in MODES:
  return {'ok':False,'error':'起動のしかたは %s のどれかです'%'・'.join(MODES)}
 tried=[]
 for p in places():
  try:
   p.parent.mkdir(parents=True,exist_ok=True)
   p.write_text(mode+'\r\n',encoding='utf-8')
  except Exception as e:
   tried.append(f'{p}: {e}')
   continue
  if paths.msix_private_copy(p) is not None:
   # このアプリからしか見えない写しになった＝Start.vbs は読めない。消して次へ。
   try:p.unlink()
   except Exception as _e:quiet('写しになった置き場を片付けられない',_e)
   tried.append(f'{p}: このアプリからしか見えない写しになります')
   continue
  for other in places():
   if other==p:continue
   try:
    if other.is_file():other.unlink()
   except Exception as _e:quiet('もう1つの置き場の古い設定を消せない（新しいほうが勝つ）',_e)
  return {'ok':True,'mode':mode,'file':str(p)}
 return {'ok':False,'error':'起動のしかたを残せる場所がありません（'+' / '.join(tried)+'）'}


def exe_info(root=None):
 """Start.vbs の隣の WaveLog.exe。無ければ`exists`が偽。"""
 path=Path(root or APP_ROOT)/EXE_NAME
 out={'path':str(path),'exists':False,'size':0,'updatedAt':''}
 try:
  if path.is_file():
   st=path.stat()
   out.update(exists=True,size=st.st_size,
              updatedAt=time.strftime('%Y-%m-%d %H:%M',time.localtime(st.st_mtime)))
 except Exception as _e:
  quiet('WaveLog.exe を見られない（無いものとして扱う）',_e)
 return out


def status(running,root=None):
 """画面が出すものを全部ここで決める（判定を画面へ書き写さない）。
    `running`＝いま動いている版（問い合わせの宛先から呼ぶ側が決める）。"""
 mode,file=saved()
 exe=exe_info(root)
 supported=sys.platform=='win32'
 why=''
 if not supported:why='起動のしかたを選べるのは Windows だけです（この端末は %s）'%sys.platform
 desktop_why='' if exe['exists'] else \
  f'{EXE_NAME} が Start.vbs の隣にありません（{exe["path"]}）。置くと選べます'
 return {'ok':True,'supported':supported,'why':why,
         'mode':mode or DEFAULT,'saved':bool(mode),'default':DEFAULT,
         'file':str(file or ''),'running':running if running in MODES else '',
         'modes':[{'key':k,'label':LABELS[k],'hint':HINTS[k]} for k in MODES],
         'exe':exe,'canDesktop':supported and exe['exists'],'desktopWhy':desktop_why}
