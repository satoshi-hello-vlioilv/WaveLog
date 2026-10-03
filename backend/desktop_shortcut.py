"""desktop_shortcut.py: デスクトップへ起動ショートカットを作る（§9.410）。

===========================================================================
利用者の指示（§9.410）
  「デスクトップにWaveLogの起動ショートカットを作成する機能が欲しいです。
    アイコンも設定できますか？」

**作るのは`.lnk`1本**で、行き先は毎日の入口である`Start.vbs`（§9.405
「入口は1つ」）。ここで別の起動路（`start_app.bat`等）を指せるようにすると、
**入口が2つ**になる——現場のショートカットだけが古い入口を指したまま残る。

なぜアプリの窓（`WaveLog.exe --lnk`）に作らせるか（§9.552）
---------------------------------------------------------------------------
`.lnk`はただのファイルではなくシェルのオブジェクトなので、Windows の部品
（COM の`IShellLinkW`）越しにしか作れない。以前は WSH（`cscript`）で補助
スクリプトを起こしていたが、WSH のための回り道が4つ要った（補助スクリプトを
英数字だけで書く・空の引数の身代わり・読めない字の置き換え・補助スクリプトを
ほかのプログラムの置き場へ置く——§9.486・§9.496）。窓（Rust）は同じ部品を直に
呼べるので、頼みを JSON 1つで渡すだけになった。**道は1本**——作るのも読むのも
`--lnk`の1つ。**決めるのはここ**（どこへ・どの名前で・上書きしてよいか・前の
名前を片付けるか）で、窓は頼まれた1件を作る／読むだけ。

**アイコンは2つから選べる**（利用者の問い「アイコンも設定できますか？」）:
  既定 … アプリのマーク（`app_icon.py`がその場で描く`.ico`）
  指定 … 利用者が選んだ`.ico`／`.exe`／`.dll`
===========================================================================
"""
import json
import os
import subprocess
import sys
import time
from pathlib import Path

from . import app_icon
from . import desktop_shell
from .paths import APP_ROOT, PROGRAM_DIR
from .quiet import quiet

# ショートカットの既定の名前。**画面で名乗っている名前**にそろえる
# （デスクトップに「WaveLog」とだけ出ても、現場は何のアイコンか分からない）。
DEFAULT_NAME='測定伝送システム'
# 行き先＝毎日の入口（§9.405・§9.406でリポジトリ直下に残した1本）。
TARGET_NAME='Start.vbs'
# 指定できるアイコンの種類。`.exe`／`.dll`は中の絵を使う（`,0`が既定）。
ICON_SUFFIXES=('.ico','.exe','.dll')
# 窓（exe）の副コマンド（`desktop/src/lnk.rs`の`ARG`と同じ字）。
LNK_ARG='--lnk'
DESCRIPTION='測定伝送システム（WaveLog）を起動します'


def target_path():
 return APP_ROOT/TARGET_NAME


def shell_exe():
 """ショートカットを作る窓（exe）。**いま動いている窓**が先（窓が名乗る`WAVELOG_SHELL_EXE`・
    手元へ写した版ごとのフォルダの中）。窓の外（開発の入口）では配ってある`program/WaveLog.exe`。"""
 run=desktop_shell.running()['exe']
 return Path(run) if run else PROGRAM_DIR/'WaveLog.exe'


def _lnk(req):
 """窓に`.lnk`を1件作らせる／読ませる（§9.552）。頼みも答えも JSON 1つ（字は UTF-8・位置で読まない）。
    **答えを読めなくても落とさない**——理由を字で返す（画面は`error`をそのまま出す）。"""
 exe=shell_exe()
 if not exe.is_file():
  return {'ok':False,'error':'ショートカットを作る窓（%s）が見つかりません'%exe}
 try:
  p=subprocess.run([str(exe),LNK_ARG],input=json.dumps(req,ensure_ascii=False),capture_output=True,
                   timeout=30,text=True,encoding='utf-8',errors='replace',**_no_window())
 except subprocess.TimeoutExpired:
  return {'ok':False,'error':'ショートカットの読み書きが時間内に終わりませんでした'}
 except OSError as e:
  return {'ok':False,'error':'ショートカットを作る窓を起こせません（%s）: %s'%(exe,e)}
 try:
  out=json.loads((p.stdout or '').strip().splitlines()[-1])
 except (ValueError,IndexError):
  return {'ok':False,'error':'窓の答えを読めません（終了コード %s）%s'%(p.returncode,(p.stderr or '').strip()[:200])}
 return out if isinstance(out,dict) else {'ok':False,'error':'窓の答えの形が違います'}


def _icon_parts(spec):
 """`IconLocation`の形（`C:\\x.exe,0`）を「絵のファイル」と「何番目の絵か」に分ける。"""
 path,sep,idx=str(spec or '').rpartition(',')
 if sep and idx.strip().lstrip('-').isdigit():
  return path,int(idx)
 return str(spec or ''),0


def supported():
 """作れる端末か。**作れないときは理由を返す**（§CLAUDE 4）。"""
 if sys.platform!='win32':
  return False,'この機能はWindowsでだけ使えます（この端末は %s）'%sys.platform
 if not target_path().exists():
  return False,'起動ファイル（%s）が見つかりません'%target_path()
 return True,''


def desktop_dir():
 """デスクトップの場所。**レジストリを先に見る**——OneDriveを使っている
    端末ではデスクトップが`%USERPROFILE%\\Desktop`ではない（そこへ作ると
    **画面に出ないショートカット**ができる）。"""
 try:
  import winreg                                    # 遅延: Windowsにしか無い
  key=r'Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders'
  with winreg.OpenKey(winreg.HKEY_CURRENT_USER,key) as k:
   val=winreg.QueryValueEx(k,'Desktop')[0]
  path=Path(os.path.expandvars(str(val)))
  if path.is_dir():return path
 except Exception as _e:
  quiet('デスクトップの場所をレジストリから引けない（既定の場所を使う）',_e)
 return Path(os.path.expanduser('~'))/'Desktop'


def _safe_name(raw):
 """ファイル名にできない字を落とす。空になったら既定へ戻す。"""
 name=str(raw or '').strip()
 for ch in '\\/:*?"<>|':name=name.replace(ch,'')
 name=name.strip().rstrip('.')
 return name or DEFAULT_NAME


def link_path(name=None):
 return desktop_dir()/(_safe_name(name)+'.lnk')


def _icon_spec(icon):
 """使うアイコンを決める。戻り値は（`IconLocation`へ渡す文字列, 出どころ, 断り）。

 **指定が読めないときは黙って既定へ落とさない**（§CLAUDE 4・§9.231）——
 選んだファイルが無いことに気づけないまま、違う絵のショートカットができる。"""
 raw=str(icon or '').strip()
 if raw:
  path=Path(os.path.expandvars(raw))
  if path.suffix.lower() not in ICON_SUFFIXES:
   return '','', 'アイコンに使えるのは %s です（指定: %s）'%('／'.join(ICON_SUFFIXES),path.suffix or '拡張子なし')
  if not path.exists():
   return '','', '指定されたアイコンが見つかりません: %s'%path
  # `.exe`／`.dll`は「何番目の絵か」まで要る（既定は0番）。
  spec=str(path) if path.suffix.lower()=='.ico' else f'{path},0'
  return spec,'指定',''
 made=app_icon.ensure()
 if made is None:
  return '','', ''      # 既定の絵を作れなかった：絵なしで作る（作れないよりまし）
 return str(made),'既定',''


def _no_window():
 """黒い画面を出さずに実行する（`setup_check._no_window()`と同じ作法）。"""
 if sys.platform!='win32':return {}
 return {'creationflags':getattr(subprocess,'CREATE_NO_WINDOW',0)}


def _same_path(a,b):
 """同じ場所を指しているか。Windowsは大文字小文字を区別しないので
    `normcase`で揃える（`C:\\WaveLog`と`c:\\wavelog`は同じ）。"""
 if not a or not b:return False
 try:
  return os.path.normcase(os.path.abspath(str(a)))==os.path.normcase(os.path.abspath(str(b)))
 except Exception as _e:
  quiet('道を比べられない（別物として扱う）',_e)
  return False


def link_target(path):
 """その`.lnk`が指している先（§9.446）。**読めなければ空**。

    上書き・片付けの前に「**自分が作ったものか**」を確かめるために要る——
    同じ名前の、利用者が自分で作った別のショートカットを黙って消さない
    （§CLAUDE 5「危ない操作を主要動線に置かない」）。読むのも作るのと同じ
    窓の1つの道（`_lnk()`の`read`）で、道を2本にしない。"""
 if sys.platform!='win32':return ''
 out=_lnk({'op':'read','path':str(path)})
 if not out.get('ok'):
  quiet('ショートカットの行き先を読めない（別物として扱う）',out.get('error'))
  return ''
 return str(out.get('target') or '').strip()


def is_ours(path):
 """このアプリが作ったショートカットか（行き先が`Start.vbs`か）。"""
 return _same_path(link_target(path),target_path())


def rename_from(prev,name):
 """名前を変えて作り直すとき、**片付ける前の名前**（§9.446）。

    変えていない・前の名前が無いなら空。ここは**字だけで決まる**ので、
    ファイルを見ない（見るのは呼ぶ側）——判断を1箇所に置き、網から直に
    確かめられるようにする。"""
 prev=_safe_name(prev) if str(prev or '').strip() else ''
 if not prev:return ''
 return '' if prev==_safe_name(name) else prev


def remember(name,icon,uid=None):
 """**作ったときの名前と絵を残す**（§9.445）。`saved()`と対になる書き込みで、
    読む先と同じ`パス設定マスタ`の1箇所へ書く。

    なぜここで書くか
    ---------------------------------------------------------------------
    以前は共通設定の画面の欄（`data-pc-field`）だけが保存の道だった（§9.433）。
    その画面は**スケジュールモードでは出ない**ので、現場の端末では「作った
    名前」がどこにも残らず、次に開くと既定の名前に戻り、**作ってあるのに
    「まだ作っていません」**と出る（`status()`は名前からファイルを探す）。
    残すのは**この2つの鍵だけ**——置き場・読み込み先といった他の設定は
    ここからは一切触らない（あちらは編集モードの画面が持つ）。"""
 from .db_access import DBS, connect, set_path_config   # 遅延: 起動順に縛りを作らない
 try:
  with connect(DBS['MASTER']['path'],False) as c:
   set_path_config(c,'shortcut_name',str(name or '').strip(),uid or '')
   set_path_config(c,'shortcut_icon',str(icon or '').strip(),uid or '')
 except Exception as _e:
  # 作れてはいるので**作成そのものは成功**として返す（黙って捨てない・§9.328）。
  quiet('ショートカットの設定を残せない（作成自体は成功している）',_e)


def saved(key):
 """共通設定に残してある値（§9.433）。**決めた名前と絵は残す**——以前は
    どこにも保存しておらず、画面を切り替えると既定の名前へ戻っていた
    （利用者の報告）。読むのは`パス設定マスタ`の1箇所で、
    `path_config_value()`が答える（§data「置き場の答えは1箇所」）。

    **遅延importにする理由**: `db_access`はマスタDBの置き場を解決するため
    起動の途中で組み上がる。ここを頭で読むと、起動の順番に縛りが増える。"""
 from .db_access import path_config_value            # 遅延: 起動順に縛りを作らない
 try:
  return str(path_config_value(key,'') or '').strip()
 except Exception as _e:
  quiet('ショートカットの設定を読めない（既定で続ける）',_e)
  return ''


def status(name=None):
 """いまの状態。**画面はこの答えをそのまま出す**（判定を2箇所に持たない）。

    名前を渡されなければ**共通設定に残した名前**を使う（§9.433）——
    「作成済みか」は名前から決まるファイルが在るかで見るので、ここが既定名に
    倒れると、別の名前で作ったショートカットを「まだ作っていません」と言う。"""
 ok,why=supported()
 if not str(name or '').strip():name=saved('shortcut_name')
 link=None
 try:link=link_path(name)
 except Exception as _e:quiet('デスクトップの場所を決められない',_e)
 out={'ok':True,'supported':ok,'why':why,
      'name':_safe_name(name),'defaultName':DEFAULT_NAME,
      # 画面が「指定の絵」を選び直せるように、残してある絵のパスも返す。
      'icon':saved('shortcut_icon'),
      # **残してある名前そのもの**（§9.445）。`name`は「空なら既定へ倒した
      # 結果」なので、欄へ出すと**決めていない名前を決めたように見える**。
      # 欄が出すのはこちら（空欄なら既定の名前が薄い字で出る）。
      'savedName':saved('shortcut_name'),
      'desktop':str(desktop_dir()) if ok else '',
      'link':str(link) if link else '',
      'target':str(target_path()),
      'exists':bool(link and link.exists()),
      # **同じ名前の物が自分のものか**まで答える（§9.446）。画面はこれを見て
      # 「作り直す（自分の）」と「上書きする（別の物）」を言い分ける
      # ——判定はここの1箇所で、画面に書き写さない（§9.163）。
      'linkTarget':'','mine':False,
      'updatedAt':'','iconSuffixes':list(ICON_SUFFIXES)}
 try:
  if out['exists']:
   out['updatedAt']=time.strftime('%Y-%m-%d %H:%M',time.localtime(link.stat().st_mtime))
 except Exception as _e:
  quiet('ショートカットの更新時刻を読めない（時刻を出さない）',_e)
 if out['exists']:
  out['linkTarget']=link_target(link)
  out['mine']=_same_path(out['linkTarget'],target_path())
 return out


def create(name=None,icon=None,uid=None,overwrite=False):
 """デスクトップへ作る。戻り値は`status()`＋結果。

    **渡された値をそのまま使う**（§9.433）。画面の欄は共通設定に残した値から
    組み立ててあるので、ここで保存値へ落とすと**「アプリのマーク」を選んだのに
    前に指定した絵で作られる**（空欄＝既定、を保存値で上書きしてしまう）。

    すでに在るときの振る舞い（§9.446、利用者の指示「すでにある場合は上書きして
    書き換える」）
    ---------------------------------------------------------------------
    ・**自分が作ったもの**（行き先が`Start.vbs`）なら、そのまま**上書き**する
      ——名前も絵も、いま決めた内容へ書き換わる。
    ・**別のショートカット**（行き先が違う）は`overwrite`が真のときだけ上書き
      する。既定では断り、`needConfirm`と行き先を返す——利用者が自分で作った
      同名のアイコンを、黙って消さないため（§CLAUDE 5）。
    ・**名前を変えたとき**は、前に作ったほうを片付ける（`rename_from()`）。
      置いていくと同じ物が2つデスクトップに並ぶ——「書き換え」にならない。"""
 ok,why=supported()
 if not ok:return {'ok':False,'error':why}
 spec,source,bad=_icon_spec(icon)
 if bad:return {'ok':False,'error':bad}
 link=link_path(name)
 # **別の物の上は、断ってから**（黙って消さない・§CLAUDE 4）。
 if link.exists() and not overwrite and not is_ours(link):
  return {'ok':False,'needConfirm':True,'link':str(link),
          'linkTarget':link_target(link),
          'error':'同じ名前の別のショートカットがあります: %s'%link}
 try:
  link.parent.mkdir(parents=True,exist_ok=True)
 except Exception as _e:
  quiet('デスクトップのフォルダを用意できない',_e)
 icon_file,icon_index=_icon_parts(spec)
 made=_lnk({'op':'make','path':str(link),'target':str(target_path()),'workdir':str(APP_ROOT),
            'icon':icon_file,'iconIndex':icon_index,'description':DESCRIPTION})
 if not made.get('ok') or not link.exists():
  return {'ok':False,'error':'ショートカットを作れませんでした: '+str(made.get('error') or '作ったはずのファイルがありません')}
 # **名前を変えたなら、前に作ったほうを片付ける**（§9.446）。片付けるのは
 # **自分が作った物だけ**——同じ名前で利用者が置いた別の物は触らない。
 dropped=''
 prev=rename_from(saved('shortcut_name'),name)
 if prev:
  old=link_path(prev)
  try:
   if old.exists() and is_ours(old):
    old.unlink();dropped=prev
  except Exception as _e:
   # 新しいほうは出来ているので、**作成は成功として返す**（理由は1行残す）。
   quiet('前の名前のショートカットを片付けられない',_e)
 # **作った内容を残す**（§9.445）。次に開いたとき、この名前で「作成済み」と
 # 言えるようにする（画面の保存ボタンに頼らない）。
 remember(name,icon,uid)
 out=status(name)
 out['created']=True
 # **何をしたかを言う**（§CLAUDE 4・6）——作ったのか、書き換えたのか、
 # 付け替えたのかで、画面が返す言葉が変わる。
 out['renamedFrom']=dropped
 # `icon`は**共通設定に残した値**（status が入れる）。実際に使った絵は
 # 別の鍵で返す——同じ鍵に2つの意味を持たせない（§CLAUDE 8）。
 out['iconUsed']=spec
 out['iconSource']=source
 return out
