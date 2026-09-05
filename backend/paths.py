"""paths.py: アプリ本体と「実行中に変化するファイル」の置き場所を分ける。

ログ・実行時情報・キャッシュ等は、アプリ本体と同じ場所ではなくユーザー別の
ローカル領域(Windowsでは %LOCALAPPDATA%\\WaveLog)へ置く。アプリ本体を共有
フォルダーに置いた場合でも、端末ごとの実行状態が衝突せず、共有側へログや
キャッシュを大量生成しないようにするため。

配布形態(端末ごとのコピー / 共有フォルダー)がどちらでも破綻しないよう、
実行時ファイルは常にローカル領域へ置く。

**作り直せるファイルは、置き場が手元でなければ自動で手元へ逃がす**(§9.109)。
DBファイル(db/)そのものは既存データの移動を伴うため場所を維持するが、
「共有から写しただけ」「共有から取り直せる」ものは別で、共有・クラウド同期
フォルダーの上に置くと**Windowsでは置き換えが拒まれて更新できなくなる**
(§9.108)。利用者に設定を求めるのではなく、`work_dir()`が置き場を決める。

  db_dir が手元          → そのまま db_dir を使う(今までどおり)
  db_dir が共有/クラウド → %LOCALAPPDATA%\\WaveLog\\work\\<識別子>

**本物のデータ(master.sqlite3 / records.sqlite3)は動かさない。** 黙って
別の場所へ移すと、クラウドで同期されているつもりのデータが同期対象から
外れる。動かしてよいのは「消えても取り直せるもの」だけ。
"""
from pathlib import Path
import ctypes
import hashlib
import json
import os
import re
import sys

from .config import LOCAL_DIR_NAME
from .quiet import quiet

APP_ROOT=Path(__file__).resolve().parent.parent

# ========================================================================
# 任意の設定ファイル(config/local.json)によるブートストラップ設定の上書き
#  - マスタDB(db/master.sqlite3)自体の置き場所を決める3項目
#    (db_dir/master_db_path/records_db_path)専用。この3つは、値をマスタDBの
#    中に保存すると「読みに行く先が分からないまま読みに行く」鶏と卵になる
#    ため、config/local.jsonでの上書きが唯一の設定手段として残る
#    (ブートストラップ専用の最小限のファイル)。
#  - それ以外(仕掛/品質データの読み込み先・共有パス・各種間隔設定)は
#    db/master.sqlite3側のパス設定マスタ(backend/db_access.pyの
#    PATH_CONFIG_TABLE)へ移行済みで、マスタ管理画面から編集する。
#    config/local.jsonに残っていた値は初回起動時に一度だけパス設定マスタへ
#    自動移行される(db_access.py の _migrate_legacy_path_config)。
#  - ファイルが無い場合は空の設定として扱い、既存データの場所に一切影響しない。
#  - **読めなかった場合は黙らないこと**(§9.271、利用者の報告
#    「master_db_pathを書いたのに正しく読み込んでいない」)。以前は
#    `except Exception: return {}` で握り潰しており、**BOM付きで保存された・
#    ANSI(CP932)で保存された・カンマを1つ多く打った**、のどれでも
#    「設定が1つも書かれていない」のと**まったく同じ**になっていた。
#    このファイルはマスタの置き場を決めるので、空として扱うと本体は
#    `db\master.sqlite3` を黙って読み、画面にも何も出ない。
#    理由を`local_config_error()`に残し、起動ログと共通設定の画面に出す。
# ========================================================================
def local_config_path():
 return APP_ROOT/'config'/'local.json'

# 直近の読み込みで何が起きたか。None=問題なし。
_local_config_error=None

def local_config_error():
 """`config/local.json` を読めなかった理由（読めていればNone）。

 **「無い」と「読めない」は別のこと。** 無いのはふつうの状態だが、
 読めないのは**書いた設定が全部効いていない**という事故で、打つ手も違う。"""
 load_local_config()
 return _local_config_error

def load_local_config():
 """`config/local.json` を読む。**現場が手で書くファイル**なので、
 Windowsのエディタが付けるものは受ける（BOM・CP932）。"""
 global _local_config_error
 path=local_config_path()
 _local_config_error=None
 if not path.exists():
  return {}
 raw=None
 try:
  raw=path.read_bytes()
 except Exception as e:
  _local_config_error=f'{path} を開けませんでした（{e}）。'
  return {}
 text=None
 # utf-8-sig は BOM 付きも無しも読める。日本語Windowsのメモ帳で「ANSI」を
 # 選ぶと CP932 になるので、そこまでは受ける（読めれば設定は効く）。
 for enc in ('utf-8-sig','cp932'):
  try:
   text=raw.decode(enc);break
  except UnicodeDecodeError:
   continue
 if text is None:
  _local_config_error=(f'{path} の文字コードを判別できませんでした。'
                       'UTF-8 で保存し直してください。')
  return {}
 try:
  data=json.loads(text)
 except Exception as e:
  _local_config_error=(f'{path} の書き方に誤りがあります（{e}）。'
                       'カンマの打ち過ぎ・引用符の閉じ忘れ・`\\` の重ね忘れが'
                       'よくある原因です。直すまで、このファイルに書いた設定は'
                       '1つも効きません。')
  return {}
 if not isinstance(data,dict):
  _local_config_error=f'{path} は {{ }} で囲んだ設定の並びである必要があります。'
  return {}
 return data

# 環境変数の展開（§9.268の追補、利用者の指摘）
#   "%LOCALAPPDATA%\\WaveLog" のように書けること。**書いたとおりに保存し、
#   使うときに展開する**のが要点——展開して保存すると端末ごとに違う文字列に
#   なり、同じ config/local.json を全端末へ配れなくなる（変数で書きたい理由が
#   まさにそれ）。
#   **`%VAR%` も `$VAR` も両方見る。** `os.path.expandvars` はプラットフォーム
#   任せ（Windowsは`%VAR%`、POSIXは`$VAR`）なので、それだけに頼ると
#   **検証がLinuxで走るこの構成では`%VAR%`の道を一度も通らない**
#   （§9.108・`is_network_path`が生の文字列で見ているのと同じ理由）。
_ENV_PERCENT=re.compile(r'%([A-Za-z_][A-Za-z0-9_]*)%')

def expand_path(raw):
 """設定に書かれた文字列 -> 実際のパス文字列。環境変数と`~`を展開する。

 **未定義の変数はそのまま残す**（`os.path.expandvars`と同じ作法）——
 消してしまうと、打ち間違えた変数名が「フォルダ名の一部が抜けたパス」に
 化けて、身に覚えのない場所へ書きに行く。
 """
 text=str(raw or '')
 if not text:return ''
 text=_ENV_PERCENT.sub(lambda m:os.environ.get(m.group(1),m.group(0)),text)
 text=os.path.expandvars(text)
 try:
  text=os.path.expanduser(text)
 except Exception as _e:
  quiet('`~`を展開できない（書いたまま使う）',_e)
 return text

def configured_path(key):
 """config/local.jsonでのパス上書き値(db_dir/master_db_path/records_db_path
 専用)。未設定/該当なしはNone。**環境変数を展開してから返す。**"""
 value=load_local_config().get(key)
 if not value:return None
 text=expand_path(value)
 return Path(text) if text else None

# ---------------------------------------------------------------------------
# ユーザー別ローカル領域（§9.255 ③、利用者の報告「他PCで起動に失敗する」）
# ---------------------------------------------------------------------------
# ここは**起動のいちばん最初に通る**（`start_app.main()`の1行目が
# `ensure_local_dirs()`で、その次が`launcher_logger()`＝`logs_dir()`）。
# 以前は`mkdir`の失敗をそのまま送出していたので、`%LOCALAPPDATA%`が
# 移動プロファイル（ネットワーク上のホーム）・ポリシー・容量で書けない端末では
# **待機画面を開く前にプロセスが死んでいた**。`Start.vbs`は`pythonw.exe`を
# 黒い画面なしで起動するので、利用者から見えるのは「モーダルが出ない」だけ
# ——前に開いていたタブが残っていれば、そこに接続エラーが出たままになる
# （報告の「モーダルが出ずエラー画面」）。
#
# **書ける場所を1つ必ず見つける。** 候補は
#   %LOCALAPPDATA% → XDG_DATA_HOME → ホーム → 一時フォルダー
# の順で、**実際に作って書いてみて**決める——`exists()`は「書けるか」を
# 答えない（§9.108と同じ理由）。決めた場所は覚える（呼ぶたびに探し直すと、
# 遅い共有では確認そのものが起動より重くなる・§9.225）。
_LOCAL_ROOT=None

def _local_root_candidates():
 out=[]
 for key in ('LOCALAPPDATA','XDG_DATA_HOME'):
  base=os.environ.get(key)
  if base:out.append(Path(base)/LOCAL_DIR_NAME)
 try:out.append(Path.home()/'.local'/'share'/LOCAL_DIR_NAME)
 except Exception as _e:quiet('この候補を作れない（次の候補を試す）',_e)
 try:
  import tempfile
  out.append(Path(tempfile.gettempdir())/LOCAL_DIR_NAME)
 except Exception as _e:quiet('この候補を作れない（次の候補を試す）',_e)
 return out

def local_root():
 """ユーザー別ローカル領域のルート。**実際に書ける場所**を返す。

 **健全な端末の答えは変えない**（`%LOCALAPPDATA%\\WaveLog`）——書けたら
 そこで止まるので、候補が増えても今までと同じ場所になる（§9.208 ⑧の
 端末名の解決と同じ作法）。"""
 global _LOCAL_ROOT
 if _LOCAL_ROOT is not None:return _LOCAL_ROOT
 cands=_local_root_candidates()
 for path in cands:
  try:
   path.mkdir(parents=True,exist_ok=True)
   probe=path/'.writable'
   probe.write_text('',encoding='utf-8')
   try:probe.unlink()
   except Exception as _e:quiet('いらないファイルを消せない（次の掃除で片付く）',_e)
   _LOCAL_ROOT=path
   return path
  except Exception as _e:
   quiet('いらないファイルを消せない（次の掃除で片付く）',_e)
   continue
 # どこにも書けない。**それでもパスは返す**——ここで送出すると、
 # 起動が待機画面を開く前に死ぬ（この節の冒頭がまさにそれ）。
 _LOCAL_ROOT=cands[0] if cands else Path('.')/LOCAL_DIR_NAME
 return _LOCAL_ROOT

def ensure_local_dirs():
 """ローカル領域の各フォルダを作成し、辞書で返す。

 **1つも送出しない**（§9.255 ③）——作れなかったフォルダがあっても起動は
 続ける。どれが作れなかったかは呼び出し元がログへ残せるよう、辞書とは別に
 `ensure_local_dirs.failed`へ名前を積む（起動の1行目なので、ここでログを
 開くと鶏と卵になる）。"""
 root=local_root()
 dirs={name:root/name for name in ('runtime','logs','pycache','cache','work','backup')}
 failed=[]
 for name,path in dirs.items():
  try:
   path.mkdir(parents=True,exist_ok=True)
  except Exception as e:
   failed.append(f'{name}: {e}')
 ensure_local_dirs.failed=failed
 return dirs
ensure_local_dirs.failed=[]

def _sub_dir(name):
 """ローカル領域の下の1つ。**作れなくてもパスを返す**（送出しない）。"""
 path=local_root()/name
 try:
  path.mkdir(parents=True,exist_ok=True)
 except Exception as _e:
  quiet('フォルダを作れない（次の候補を試す）',_e)
 return path

def logs_dir():
 return _sub_dir('logs')

def runtime_dir():
 return _sub_dir('runtime')

def instance_file():
 """起動中のプロセス情報(PID・URL・アプリ配置場所)を書き出す先。"""
 return runtime_dir()/'instance.json'

# ========================================================================
# 共有フォルダー(ネットワーク)配置の検出
# SQLiteファイルをSMB共有上に置いて複数端末から書き込むと、ロックが正しく
# 効かず破損し得る。配置形態が未確定のため、検出したら警告をログへ残す。
# ========================================================================
_DRIVE_REMOTE=4

def is_network_path(path):
 """パスがUNCまたはネットワークドライブ上にあればTrue。

 **UNCの判定は resolve() の前に、渡された文字列そのもので行う。**
 resolve()は共有が落ちていると失敗し得るし、Linuxでは`\\\\server\\share`が
 ただのファイル名、`//server/share`が`/server/share`へ潰れてしまい、
 判定そのものが消える(この関数の要の分岐がテストで踏めなくなる)。"""
 raw=str(path)
 if raw.startswith('\\\\') or raw.startswith('//'):
  return True
 try:
  text=str(Path(path).resolve())
 except OSError:
  # 共有が落ちていると resolve() 自体が失敗する。**そのときは「手元ではない」**
  # と読む(確かめられないものを手元とみなすと、まさに壊れる場所へ写しに行く)。
  return True
 if text.startswith('\\\\') or text.startswith('//'):
  return True
 if sys.platform!='win32':
  return False
 drive=os.path.splitdrive(text)[0]
 if not drive:
  return False
 try:
  return ctypes.windll.kernel32.GetDriveTypeW(f'{drive}\\')==_DRIVE_REMOTE
 except Exception as _e:
  quiet('ドライブの種類を引けない（ネットワークではないものとして扱う）',_e)
  return False

# ------------------------------------------------------------------------
# クラウド同期フォルダーの見分け(§9.108)
# Box Drive・OneDrive等は同期のあいだファイルを掴む。掴む時間が数秒〜数分と
# 桁違いに長いため、置き換えの再試行では吸収できない。名前で見分ける。
# **名前だけなので確証ではない**——だから「置けない」ではなく「置かない」
# 判断に使い、理由を添えて記録する。
# ------------------------------------------------------------------------
_CLOUD_MARKERS=(
 ('boxdrive','Box Drive'),('/box/','Box'),('\\box\\','Box'),
 ('onedrive','OneDrive'),('dropbox','Dropbox'),
 ('google drive','Google ドライブ'),('googledrive','Google ドライブ'),
 ('icloud','iCloud'),('nextcloud','Nextcloud'),
)

def cloud_sync_hint(path):
 """そのパスがクラウド同期フォルダーの中に見えるなら、その名前を返す。"""
 s=str(path or '').lower()
 if not s:
  return ''
 for marker,name in _CLOUD_MARKERS:
  if marker in s:
   return name
 return ''

# ========================================================================
# 「作り直せるファイル」の置き場(§9.109)
# ========================================================================
def db_dir():
 """DBの置き場所。config/local.jsonの"db_dir"で上書き可能。"""
 return configured_path('db_dir') or APP_ROOT/'db'

def _install_id():
 """同じPCに複数のインストールがあっても混ざらないための短い印。"""
 return hashlib.sha1(str(db_dir()).encode('utf-8',errors='replace')).hexdigest()[:8]

def _decide_work_dir():
 """作り直せるファイルをどこへ置くかを決める。→ (置き場, 理由)

 **判定は1回だけ**(work_dir()が覚える)。is_network_path()はresolve()を
 伴うので、リクエストのたびに呼ぶと共有が不調なときにそれ自体が詰まる
 原因になる(CLAUDE.md「共有DBを開く前にstatを置かない」と同じ理由)。"""
 base=db_dir()
 cloud=cloud_sync_hint(base)
 if cloud:
  return local_root()/'work'/_install_id(),f'{cloud}の中のため手元へ移しました'
 try:
  remote=is_network_path(base)
 except Exception as _e:
  quiet('置き場の種類を確かめられない（分からないものとして続ける）',_e)
  remote=False
 if remote:
  return local_root()/'work'/_install_id(),'ネットワーク上のため手元へ移しました'
 return base,''

_work_dir=None

def work_dir():
 """写し・作業コピーなど**作り直せるファイル**の置き場。

 置き場が手元なら`db_dir()`そのもの(今までどおり)。共有・クラウド同期
 フォルダーの上なら、ユーザー別のローカル領域へ自動で逃がす。"""
 global _work_dir
 if _work_dir is None:
  _work_dir=_decide_work_dir()
 path=_work_dir[0]
 try:
  path.mkdir(parents=True,exist_ok=True)
 except OSError:
  pass
 return path

def work_dir_reason():
 """手元へ逃がした理由(逃がしていなければ空文字)。画面・ログの説明用。"""
 if _work_dir is None:
  work_dir()
 return _work_dir[1]

def work_dir_relocated():
 return bool(work_dir_reason())

def reset_work_dir_cache():
 """検証用。判定をやり直させる。"""
 global _work_dir
 _work_dir=None


# ===========================================================================
# ブラウザが読むファイルの置き場（§9.318、利用者の報告）
# ---------------------------------------------------------------------------
# 「起動時、うまくいかなくてhtmlを後から直接クリックして起動している」
#
# 実機のログでは、待機画面の写しは**在って・読めて・ブラウザへ渡した**のに、
# ブラウザは「ファイルが見つかりません」と出していた。この食い違いが起こる
# 道が1つある——**Microsoft Store 版のPython**（`\WindowsApps\` の下）は
# MSIXの入れ物の中で動くので、`%LOCALAPPDATA%` への書き込みが
# `%LOCALAPPDATA%\Packages\<パッケージ>\LocalCache\Local\…` の**私的な写し**
# へ回される。**このアプリからは読める**（読みは元の場所へ落ちる）が、
# **ブラウザは別のプロセス**なので元の場所を見に行き、そこには何も無い。
#
# **推測で場所を変えないこと。** 1つ書いてみて、私的な写しの側に**実際に
# 現れたときだけ**移す——Linuxや通常のPythonでは何も起きず、健全な端末の
# 置き場は1バイトも変わらない。
# ===========================================================================
def msix_private_copy(path):
    """`path`が**このアプリからしか見えない写し**になっていれば、その写しの
    実際の場所を返す（なっていなければNone）。

    見るのは`%LOCALAPPDATA%\\Packages\\<パッケージ>\\LocalCache\\Local\\`の下に
    **同じ相対パスのファイルが実在するか**だけ。**存在確認で送出しない**
    （§9.108）——共有・ポリシーで失敗しうるので、分からなければNone。"""
    try:
        base=os.environ.get('LOCALAPPDATA')
        if not base:return None
        base=Path(base)
        rel=Path(path).relative_to(base)
    except Exception as _e:
        quiet('私的な写しの道を組み立てられない（写しは無いものとして扱う）',_e)
        return None
    parts=rel.parts
    if not parts or parts[0].lower()=='packages':
        return None                       # 写しの側そのもの。潜らない
    pkgs=base/'Packages'
    # **いま動いているPythonのパッケージを先に見る**（`sys.executable`の親の
    # フォルダ名がそのままパッケージ名）。当たれば1回のstatで済む。
    names=[]
    try:
        exe=Path(sys.executable)
        if any(p.lower()=='windowsapps' for p in exe.parts):
            names.append(exe.parent.name)
    except Exception as _e:
        quiet('Pythonの置き場からパッケージ名を拾えない（次の手掛かりを試す）',_e)
    try:
        for entry in pkgs.iterdir():
            if entry.name not in names:names.append(entry.name)
    except Exception as _e:
        quiet('パッケージの一覧を辿れない（拾えた名前だけで見る）',_e)
    for name in names:
        cand=pkgs/name/'LocalCache'/'Local'/rel
        try:
            if cand.is_file():return cand
        except OSError:
            continue
    return None


_BROWSER_DIR=None

def _browser_dir_candidates():
    """ブラウザからも見える置き場の候補。**`%LOCALAPPDATA%`の外**を選ぶ
    ——MSIXが写しへ回すのは`AppData\\Local`・`AppData\\Roaming`なので、
    ホーム直下とアプリ本体の隣はその外側にある。"""
    out=[]
    try:out.append(Path.home()/('.'+LOCAL_DIR_NAME.lower())/'runtime')
    except Exception as _e:quiet('この候補を作れない（次の候補を試す）',_e)
    out.append(APP_ROOT/'runtime')
    return out

def _visible_probe(path):
    """そこへ1つ書いてみて、**ブラウザからも見える場所か**を確かめる。
    書けない／私的な写しになる場所ならFalse。"""
    try:
        path.mkdir(parents=True,exist_ok=True)
        probe=path/'.visible'
        probe.write_text('',encoding='utf-8')
        hidden=msix_private_copy(probe)
        try:probe.unlink()
        except Exception as _e:quiet('いらないファイルを消せない（次の掃除で片付く）',_e)
        return hidden is None
    except Exception as _e:
        quiet('フォルダを作れない（次の候補を試す）',_e)
        return False

def browser_dir():
    """**ブラウザが読むファイル**（起動待機画面と、その進捗）の置き場。

    既定は`runtime_dir()`——**健全な端末では今までと同じ**。書いたものが
    私的な写しになる端末でだけ、ブラウザからも見える場所へ移す。
    どこにも移せなければ`runtime_dir()`のまま（開けないより、いまの場所で
    開いてみるほうがまし）。決めた場所は覚える。"""
    global _BROWSER_DIR
    if _BROWSER_DIR is not None:return _BROWSER_DIR[0]
    default=runtime_dir()
    if _visible_probe(default):
        _BROWSER_DIR=(default,'')
        return default
    for cand in _browser_dir_candidates():
        if _visible_probe(cand):
            _BROWSER_DIR=(cand,
                f'{default} はこのアプリからしか見えない写しになるため、'
                f'ブラウザからも見える {cand} へ置きます')
            return cand
    _BROWSER_DIR=(default,
        f'{default} はこのアプリからしか見えない写しになる可能性がありますが、'
        '代わりの置き場が見つかりませんでした')
    return default

def browser_dir_reason():
    """既定から移した理由（移していなければ空文字）。画面・ログの説明用。"""
    if _BROWSER_DIR is None:browser_dir()
    return _BROWSER_DIR[1]

def reset_browser_dir_cache():
    """検証用。判定をやり直させる。"""
    global _BROWSER_DIR
    _BROWSER_DIR=None
