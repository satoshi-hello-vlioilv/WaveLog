"""desktop_shortcut.py: デスクトップへ起動ショートカットを作る（§9.410）。

===========================================================================
利用者の指示（§9.410）
  「デスクトップにWaveLogの起動ショートカットを作成する機能が欲しいです。
    アイコンも設定できますか？」

**作るのは`.lnk`1本**で、行き先は毎日の入口である`Start.vbs`（§9.405
「入口は1つ」）。ここで別の起動路（`start_app.bat`等）を指せるようにすると、
**入口が2つ**になる——現場のショートカットだけが古い入口を指したまま残る。

なぜWSH（`cscript`）で作るか
---------------------------------------------------------------------------
`.lnk`はただのファイルではなくシェルのオブジェクトなので、COM越しにしか
作れない。**道は1本にする**——この端末では`Start.vbs`（WSH）が毎日動いて
いるので、WSHは必ず使える。PowerShellも足すと同じことをする道が2つになり、
片方だけ直した状態が作れる（しかも工場の端末はPowerShellを止めていることが
ある）。

**アイコンは2つから選べる**（利用者の問い「アイコンも設定できますか？」）:
  既定 … アプリのマーク（`app_icon.py`がその場で描く`.ico`）
  指定 … 利用者が選んだ`.ico`／`.exe`／`.dll`
===========================================================================
"""
import os
import subprocess
import sys
import time
from pathlib import Path

from . import app_icon
from .paths import APP_ROOT, runtime_dir
from .quiet import quiet

# ショートカットの既定の名前。**画面で名乗っている名前**にそろえる
# （デスクトップに「WaveLog」とだけ出ても、現場は何のアイコンか分からない）。
DEFAULT_NAME='測定伝送システム'
# 行き先＝毎日の入口（§9.405・§9.406でリポジトリ直下に残した1本）。
TARGET_NAME='Start.vbs'
HELPER_NAME='make_shortcut.vbs'
# 指定できるアイコンの種類。`.exe`／`.dll`は中の絵を使う（`,0`が既定）。
ICON_SUFFIXES=('.ico','.exe','.dll')

# 補助スクリプトは**ASCIIだけ**で書く。WSHはBOMの無い`.vbs`をANSIとして
# 読むので、日本語を入れると端末の言語設定によっては文字化けで落ちる。
_HELPER=(
 'Option Explicit\r\n'
 'Dim a, sh, lnk\r\n'
 'Set a = WScript.Arguments\r\n'
 'Set sh = CreateObject("WScript.Shell")\r\n'
 'Set lnk = sh.CreateShortcut(a(0))\r\n'
 'lnk.TargetPath = a(1)\r\n'
 'lnk.WorkingDirectory = a(2)\r\n'
 'lnk.Description = a(4)\r\n'
 'If Len(a(3)) > 0 Then lnk.IconLocation = a(3)\r\n'
 'lnk.Save\r\n'
)


def target_path():
 return APP_ROOT/TARGET_NAME


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


def _helper_path():
 """補助スクリプト。**中身が違うときだけ**書き直す（毎回書くと共有の掃除と
    競合する）。"""
 path=runtime_dir()/HELPER_NAME
 try:
  if path.exists() and path.read_text(encoding='ascii',errors='ignore')==_HELPER:
   return path
  path.parent.mkdir(parents=True,exist_ok=True)
  path.write_text(_HELPER,encoding='ascii',newline='')
  return path
 except Exception as _e:
  quiet('ショートカットの補助スクリプトを置けない',_e)
  return None


def _no_window():
 """黒い画面を出さずに実行する（`setup_check._no_window()`と同じ作法）。"""
 if sys.platform!='win32':return {}
 return {'creationflags':getattr(subprocess,'CREATE_NO_WINDOW',0)}


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
      'updatedAt':'','iconSuffixes':list(ICON_SUFFIXES)}
 try:
  if out['exists']:
   out['updatedAt']=time.strftime('%Y-%m-%d %H:%M',time.localtime(link.stat().st_mtime))
 except Exception as _e:
  quiet('ショートカットの更新時刻を読めない（時刻を出さない）',_e)
 return out


def create(name=None,icon=None,uid=None):
 """デスクトップへ作る（既に在れば作り直す）。戻り値は`status()`＋結果。

    **渡された値をそのまま使う**（§9.433）。画面の欄は共通設定に残した値から
    組み立ててあるので、ここで保存値へ落とすと**「アプリのマーク」を選んだのに
    前に指定した絵で作られる**（空欄＝既定、を保存値で上書きしてしまう）。"""
 ok,why=supported()
 if not ok:return {'ok':False,'error':why}
 helper=_helper_path()
 if helper is None:
  return {'ok':False,'error':'ショートカットを作る補助スクリプトを置けませんでした'}
 spec,source,bad=_icon_spec(icon)
 if bad:return {'ok':False,'error':bad}
 link=link_path(name)
 try:
  link.parent.mkdir(parents=True,exist_ok=True)
 except Exception as _e:
  quiet('デスクトップのフォルダを用意できない',_e)
 args=['cscript','//nologo','//B',str(helper),str(link),str(target_path()),
       str(APP_ROOT),spec,'測定伝送システム（WaveLog）を起動します']
 try:
  p=subprocess.run(args,capture_output=True,text=True,timeout=30,**_no_window())
 except FileNotFoundError:
  return {'ok':False,'error':'cscript が見つかりません（Windows Script Host が無効になっている可能性があります）'}
 except subprocess.TimeoutExpired:
  return {'ok':False,'error':'ショートカットの作成が時間内に終わりませんでした'}
 if p.returncode!=0 or not link.exists():
  detail=(p.stderr or p.stdout or '').strip().splitlines()
  return {'ok':False,'error':'ショートカットを作れませんでした: '
          +(detail[-1] if detail else f'終了コード {p.returncode}')}
 # **作った内容を残す**（§9.445）。次に開いたとき、この名前で「作成済み」と
 # 言えるようにする（画面の保存ボタンに頼らない）。
 remember(name,icon,uid)
 out=status(name)
 out['created']=True
 # `icon`は**共通設定に残した値**（status が入れる）。実際に使った絵は
 # 別の鍵で返す——同じ鍵に2つの意味を持たせない（§CLAUDE 8）。
 out['iconUsed']=spec
 out['iconSource']=source
 return out
