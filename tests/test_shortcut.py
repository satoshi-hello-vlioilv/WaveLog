"""test_shortcut.py: デスクトップの起動ショートカットとアイコン（§9.410）

利用者の指示⑤「デスクトップにWaveLogの起動ショートカットを作成する機能が
欲しいです。アイコンも設定できますか？」

**サーバーもブラウザも要らない**（1段目の網・§9.337）。固定するのは4つ:
  1. アイコンは**コードで描いて**`.ico`として読める形になっている
     （同梱の画像を持たない＝同じ絵が2箇所に無い・§9.410）
  2. 行き先は**毎日の入口（`Start.vbs`）1本**（入口を2つにしない・§9.405）
  3. **作れない端末は理由を返す**（黙って失敗しない・§CLAUDE 4）
  4. アイコンの指定は**読めないものを黙って既定へ落とさない**（§9.231）
"""
import inspect
import re
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend import app_icon, desktop_shortcut  # noqa: E402

R = []


def rec(name, ok, detail=''):
    R.append((name, ok))
    print(('PASS: ' if ok else 'FAIL: ') + name + (f' -- {detail}' if detail else ''))


# ---- 1) アイコン ----------------------------------------------------------
ico = app_icon.build()
reserved, kind, count = struct.unpack('<HHH', ico[:6])
rec('.ico の頭が規格どおり（予約0・種類1＝アイコン）', reserved == 0 and kind == 1, f'{reserved}/{kind}')
rec('登録した大きさの数だけ絵が入っている', count == len(app_icon.SIZES), f'{count} 件')
sizes, ok_offsets = [], True
for i in range(count):
    w, h, _c, _r, _p, _bpp, length, offset = struct.unpack('<BBBBHHII', ico[6 + 16 * i:22 + 16 * i])
    sizes.append(w or 256)
    if offset + length > len(ico) or length <= 0:
        ok_offsets = False
rec('どの絵も中身の場所と長さが合っている（読める）', ok_offsets, str(sizes))
rec('Windowsが使う大きさ（16/32/48/256）が全部入っている',
    all(s in sizes for s in (16, 32, 48, 256)), str(sorted(sizes)))
# **256だけはPNG**（古いシェルは小さい寸法のPNGを読まないことがある・§9.410）。
big = next(i for i in range(count) if struct.unpack('<BB', ico[6 + 16 * i:8 + 16 * i]) == (0, 0))
_w, _h, _c, _r, _p, _bpp, length, offset = struct.unpack('<BBBBHHII', ico[6 + 16 * big:22 + 16 * big])
rec('256の絵はPNGで入っている', ico[offset:offset + 8] == b'\x89PNG\r\n\x1a\n', ico[offset:offset + 4].hex())
small = next(i for i in range(count) if struct.unpack('<BB', ico[6 + 16 * i:8 + 16 * i])[0] == 16)
_w, _h, _c, _r, _p, _bpp, length, offset = struct.unpack('<BBBBHHII', ico[6 + 16 * small:22 + 16 * small])
hdr = struct.unpack('<Iii', ico[offset:offset + 12])
rec('小さい絵はDIB（BITMAPINFOHEADER・高さは2倍で書く決まり）',
    hdr[0] == 40 and hdr[1] == 16 and hdr[2] == 32, str(hdr))
# **絵が真っ黒・真っ白でない**＝実際に描けている（3色が出ている）。
rgba = app_icon.render(48)
colors = {tuple(rgba[i:i + 3]) for i in range(0, len(rgba), 4) if rgba[i + 3] > 200}
rec('描いた絵に地・波・丸の3色が出ている', len(colors) >= 3, f'{len(colors)}色')

# ---- 2) 行き先は毎日の入口1本 ---------------------------------------------
rec('行き先は Start.vbs（入口を2つにしない・§9.405）',
    desktop_shortcut.target_path().name == 'Start.vbs', desktop_shortcut.TARGET_NAME)
rec('行き先が実在する', desktop_shortcut.target_path().exists(), str(desktop_shortcut.target_path()))

# ---- 3) 作れない端末は理由を返す -------------------------------------------
ok, why = desktop_shortcut.supported()
if sys.platform == 'win32':
    rec('Windowsでは作れると答える', ok, why)
else:
    rec('Windows以外では理由を付けて断る', (not ok) and 'Windows' in why, why)
    out = desktop_shortcut.create('回帰_shortcut')
    rec('作れない端末では作らず、理由を返す', out.get('ok') is False and bool(out.get('error')), str(out)[:80])
st = desktop_shortcut.status('回帰_shortcut')
rec('状態は「作れるか・どこへ・何を起動するか」を全部答える',
    all(k in st for k in ('supported', 'why', 'link', 'target', 'exists', 'defaultName')), str(sorted(st))[:90])

# ---- 4) 名前とアイコンの読み方 ---------------------------------------------
rec('ファイル名に使えない字は落とす', desktop_shortcut._safe_name('a/b:c*?') == 'abc',
    desktop_shortcut._safe_name('a/b:c*?'))
rec('空の名前は既定へ戻す', desktop_shortcut._safe_name('   ') == desktop_shortcut.DEFAULT_NAME)
spec, source, bad = desktop_shortcut._icon_spec('C:/nowhere/none.ico')
rec('無いアイコンを指定したら断る（黙って既定へ落とさない・§9.231）',
    not spec and bool(bad) and '見つかりません' in bad, bad)
spec, source, bad = desktop_shortcut._icon_spec('C:/x/icon.png')
rec('使えない拡張子は理由を付けて断る', not spec and bool(bad) and '.ico' in bad, bad)
spec, source, bad = desktop_shortcut._icon_spec(str(ROOT / 'Start.vbs'))
rec('.vbs も断る（絵を持たない）', not spec and bool(bad), bad)

# ---- 5) 名前と絵は共通設定へ残る（§9.433、利用者の報告） -------------------
# 「名前を変えても画面を切り替えると元に戻ってしまう」——どこにも保存して
# おらず、「作る」を押した瞬間だけ使われていた。**パス設定マスタの1行**に
# 残し、渡されなければそこから引く（読むのは`path_config_value()`の1箇所）。
from backend.db_access import PATH_CONFIG_KEYS                # 遅延: 網の並び順に合わせる
from backend.routes.path_config import _PATH_CONFIG_TEXT_FIELDS
rec('名前と絵はパス設定マスタの鍵として宣言してある',
    'shortcut_name' in PATH_CONFIG_KEYS and 'shortcut_icon' in PATH_CONFIG_KEYS,
    str([k for k in PATH_CONFIG_KEYS if k.startswith('shortcut')]))
# **画面から保存できること**まで見る（鍵を足しても受け側に無ければ、触っても
# 何も起きず開き直すと元に戻る——§9.208 ⑨で実際に3つ踏んだ壊れ方）。
rec('共通設定の保存が名前と絵を受け付ける',
    'shortcut_name' in _PATH_CONFIG_TEXT_FIELDS and 'shortcut_icon' in _PATH_CONFIG_TEXT_FIELDS,
    str(_PATH_CONFIG_TEXT_FIELDS))
# **渡されなければ保存値を使う**。`saved()`が読めないときも落ちない。
rec('保存値の読み口があり、読めなくても既定で続ける',
    isinstance(desktop_shortcut.saved('shortcut_name'), str),
    repr(desktop_shortcut.saved('shortcut_name')))
# **作るときは渡された値をそのまま使う**（§9.433）——ここで保存値へ落とすと、
# 「アプリのマーク」を選んだのに前に指定した絵で作られる。
src = inspect.getsource(desktop_shortcut.create)
# **作る物は引数で決まる**。保存値を読むのは §9.446 で足した「前の名前の片付け」
# の1回だけで、**作る名前・絵には使わない**（使うと、アプリのマークを選んだのに
# 前に指定した絵で作られる）。
rec('create() は渡された名前・絵を保存値で上書きしない（作る物は引数で決まる）',
    'link_path(name)' in src and '_icon_spec(icon)' in src
    and "saved('shortcut_icon')" not in src
    and src.count("saved('shortcut_name')") == 1
    and "rename_from(saved('shortcut_name'),name)" in src,
    '保存値を読むのは片付けの1回だけ' if src.count('saved(') == 1 else f'saved() が{src.count("saved(")}回')
# 状態は保存した名前で見る（既定名に倒れると「まだ作っていません」と言う）。
rec('status() は名前を渡されなければ保存値を使う',
    "saved('shortcut_name')" in inspect.getsource(desktop_shortcut.status))

# ---- 6) 作ったときの名前と絵は「作った側」が残す（§9.445、利用者の指示） ----
# 盤はヘッダーの「表示」へ移した（どのモードからも開ける）。共通設定の画面は
# **スケジュールモードでは出ない**ので、あちらの保存ボタンに頼っていると、
# 現場の端末では名前がどこにも残らず、作ってあるのに「まだ作っていません」と
# 出続ける（status() は名前からファイルを探すため）。
rec('残してある名前そのものを status() が返す（欄はこれを出す）',
    'savedName' in st and isinstance(st['savedName'], str), repr(st.get('savedName')))
rec('画面へ出す名前は「空なら既定へ倒した結果」と別の鍵で返す（同じ鍵に2つの意味を持たせない）',
    st.get('name') == desktop_shortcut._safe_name('回帰_shortcut'), str(st.get('name')))
rec('create() は作れたら名前と絵を残す（画面の保存ボタンに頼らない）',
    'remember(' in src, 'remember を呼んでいる' if 'remember(' in src else src[-120:])
rsrc = inspect.getsource(desktop_shortcut.remember)
rec('残すのは shortcut_name / shortcut_icon の2鍵だけ（置き場・読み込み先は触らない）',
    sorted(re.findall(r"set_path_config\(c,'([a-z_]+)'", rsrc)) == ['shortcut_icon', 'shortcut_name'],
    str(re.findall(r"set_path_config\(c,'([a-z_]+)'", rsrc)))
rec('残せなくても作成そのものは失敗にしない（黙って捨てない・§9.328）',
    'quiet(' in rsrc and 'except' in rsrc)

# ---- 7) すでに在るときは上書き・名前を変えたら付け替え（§9.446、利用者の指示） ----
# 「すでにある場合は上書きして書き換える機能も実装して下さい」
# ・**自分が作ったもの**（行き先が Start.vbs）は、そのまま上書きする。
# ・**別のショートカット**は `overwrite` が真のときだけ上書きする（黙って消さない）。
# ・**名前を変えたとき**は前のほうを片付ける（デスクトップに2つ残さない）。
LNK_RS = (ROOT / 'desktop' / 'src' / 'lnk.rs').read_text(encoding='utf-8')
rec('作るのも読むのも窓の副コマンド1つ（make／read・§9.552）',
    f'pub const ARG: &str = "{desktop_shortcut.LNK_ARG}";' in LNK_RS
    and '"read" =>' in LNK_RS and '"make" =>' in LNK_RS,
    desktop_shortcut.LNK_ARG)
rec('行き先を読めない端末では空を返す（落ちない・別物として扱う）',
    desktop_shortcut.link_target(ROOT / 'Start.vbs') == '',
    repr(desktop_shortcut.link_target(ROOT / 'Start.vbs')))
rec('同じ道は書き方が違っても同じと見る（`..`は畳む）',
    desktop_shortcut._same_path(ROOT / 'Start.vbs', ROOT / 'db' / '..' / 'Start.vbs')
    and not desktop_shortcut._same_path(ROOT / 'a.lnk', ROOT / 'b.lnk'))
# 大文字小文字の揺れ（`C:\WaveLog` と `c:\wavelog`）は **Windowsでだけ**畳む。
# この端末はLinuxで`normcase`が何もしないので、**ここでは測っていない**
# ——道具に任せていることだけを確かめる（§9.369「測れないなら測っていないと書く」）。
rec('大文字小文字の揺れは os.path.normcase に任せる（Windowsで畳まれる）',
    'normcase' in inspect.getsource(desktop_shortcut._same_path))
rec('空の行き先は「自分のもの」と見ない（読めなかったものを消さない）',
    not desktop_shortcut._same_path('', str(desktop_shortcut.target_path())))
# 付け替えの判断は**字だけで決まる**ので、ここで直に確かめられる。
rec('名前を変えたときだけ前の名前を返す（変えていなければ空）',
    desktop_shortcut.rename_from('旧名', '新名') == '旧名'
    and desktop_shortcut.rename_from('同じ名前', '同じ名前') == ''
    and desktop_shortcut.rename_from('', '新名') == '',
    desktop_shortcut.rename_from('旧名', '新名'))
rec('前の名前も使えない字を落としてから比べる（見た目が違うだけで消さない）',
    desktop_shortcut.rename_from('a/b', 'ab') == '', desktop_shortcut.rename_from('a/b', 'ab'))
rec('status() は「同じ名前の物が自分のものか」まで答える',
    'mine' in st and 'linkTarget' in st, str({k: st[k] for k in ('mine', 'linkTarget')}))
# 断りは**確認すれば進める**ことまで返す（画面が聞き直せる・§CLAUDE 4）。
rec('別のショートカットの上は、確認を求めて断る（overwriteが真なら進む）',
    "needConfirm" in src and 'is_ours(link)' in src and 'overwrite' in src,
    '確認の道がある' if 'needConfirm' in src else src[:100])
# 片付けるのは**自分が作った物だけ**。利用者が置いた同名の物は触らない。
rec('前の名前を片付けるのは、それが自分の作った物のときだけ',
    'rename_from(' in src and 'is_ours(old)' in src and 'unlink()' in src,
    '片付けの条件がある' if 'is_ours(old)' in src else src[-200:])
rec('片付けられなくても作成は失敗にしない（理由は1行残す）',
    src.count('quiet(') >= 1 and "out['renamedFrom']" in src)

# ---- 8) 窓（exe）へ渡す頼みと、答えの読み方（§9.552。§9.486の「位置で読む」を置き換えた） ----
# 以前は`cscript`へ位置で渡し、1つずれただけで作れなかった（§9.486・利用者の報告「作成もうまく
# いかなかった」）。いまは**名前の付いた JSON 1つ**で渡すので、位置はずれようがない。
# この端末は Windows ではないので、**窓が受け取る頼み**を組み立てて確かめる（`.lnk`そのものは
# Windows の CI の自己診断が作って読み戻す——selftest.js の「ショートカット」）。
def _capture_create(icon_spec, answer='{"ok": true}', make_file=True):
    import json as _json
    import subprocess as _sp
    import tempfile
    seen = []
    tmp = Path(tempfile.mkdtemp())
    exe = tmp / 'WaveLog.exe'
    exe.write_bytes(b'MZ')
    keep = {k: getattr(desktop_shortcut, k) for k in
            ('supported', 'desktop_dir', '_icon_spec', 'remember', 'saved', 'shell_exe')}
    real_run = _sp.run

    def fake_run(argv, **kw):
        req = _json.loads(kw.get('input') or '{}')
        seen.append((list(argv), req, kw))
        if req.get('op') == 'make' and make_file:
            Path(req['path']).write_bytes(b'lnk')
        return _sp.CompletedProcess(argv, 0 if '"ok": true' in answer else 1, answer, '')
    try:
        desktop_shortcut.supported = lambda: (True, '')
        desktop_shortcut.desktop_dir = lambda: tmp
        desktop_shortcut._icon_spec = lambda icon: (icon_spec, '既定', '')
        desktop_shortcut.remember = lambda *a, **k: None
        desktop_shortcut.saved = lambda key: ''
        desktop_shortcut.shell_exe = lambda: exe
        _sp.run = fake_run
        out = desktop_shortcut.create('試し 測定', '', None, False)
    finally:
        _sp.run = real_run
        for k, v in keep.items():
            setattr(desktop_shortcut, k, v)
    return out, seen


for _label, _spec, _want in (('既定の絵', r'C:\x\wavelog.ico', (r'C:\x\wavelog.ico', 0)),
                             ('exe の中の絵', r'C:\x\a,b.exe,0', (r'C:\x\a,b.exe', 0)),
                             ('絵なし（作れなかった）', '', ('', 0))):
    _out, _seen = _capture_create(_spec)
    _make = [r for _a, r, _k in _seen if r.get('op') == 'make']
    _r = _make[0] if _make else {}
    rec(f'窓へ渡す頼みは名前付きの1件（{_label}・§9.552）',
        bool(_r) and _seen[0][0][1:] == [desktop_shortcut.LNK_ARG] and _r['path'].endswith('試し 測定.lnk')
        and _r['target'] == str(desktop_shortcut.target_path()) and (_r['icon'], _r['iconIndex']) == _want,
        str({k: _r.get(k) for k in ('icon', 'iconIndex')}))
    rec(f'その頼みで作成が成功として返る（{_label}）', bool(_out.get('ok') and _out.get('created')),
        str(_out.get('error') or '')[:80])
_kw = _capture_create('')[1][0][2]
rec('頼みは UTF-8 の JSON で渡す（日本語の名前・道を字化けさせない）',
    _kw.get('encoding') == 'utf-8' and _kw.get('text') is True, str({k: _kw.get(k) for k in ('encoding', 'text')}))
# 窓が断ったら、**窓の言った理由**が画面まで届く（「終了コード 1」だけにしない・§9.486の趣旨）。
_out, _ = _capture_create('', answer='{"ok": false, "error": "ショートカットを保存できません（X）: アクセスが拒否されました"}',
                          make_file=False)
rec('窓の断りの理由をそのまま返す', _out.get('ok') is False and 'アクセスが拒否' in str(_out.get('error')),
    str(_out.get('error'))[:80])
_out, _ = _capture_create('', answer='これはJSONではない', make_file=False)
rec('窓の答えが読めなくても落ちず、読めないと言う', _out.get('ok') is False and '読めません' in str(_out.get('error')),
    str(_out.get('error'))[:80])
_srcmod = inspect.getsource(desktop_shortcut)
rec('cscript・補助スクリプトの道は残っていない（§9.552）',
    'cscript' not in _srcmod.split('"""', 2)[2] and '_HELPER' not in _srcmod and 'NO_ICON' not in _srcmod)

# ---- 窓の場所（§9.552） ----
# 作るのは**いま動いている窓**（手元へ写した版ごとのフォルダ）——Box の上の exe を起こすと掴んで
# 更新を止める（設計書 §7）。窓の外（開発の入口）では配ってある exe。
import os as _os  # noqa: E402
_keep_env = {k: _os.environ.get(k) for k in ('WAVELOG_SHELL', 'WAVELOG_SHELL_EXE')}
try:
    _os.environ['WAVELOG_SHELL'] = 'desktop'
    _os.environ['WAVELOG_SHELL_EXE'] = r'C:\Users\u\AppData\Local\WaveLog\desktop\1-2\WaveLog.exe'
    _in = desktop_shortcut.shell_exe()
    _os.environ.pop('WAVELOG_SHELL')
    _out_shell = desktop_shortcut.shell_exe()
finally:
    for k, v in _keep_env.items():
        if v is None:
            _os.environ.pop(k, None)
        else:
            _os.environ[k] = v
rec('窓の中では、いま動いている窓（手元へ写した exe）に作らせる', str(_in).endswith(r'1-2\WaveLog.exe'), str(_in))
rec('窓の外では配ってある program/WaveLog.exe', _out_shell == ROOT / 'program' / 'WaveLog.exe', str(_out_shell))

# ---- 絵は「ほかのプログラムからも見える置き場」へ（§9.496、利用者の報告） ----
# Microsoft Store 版の Python は`AppData\Local`への書込を**このアプリからしか見えない写し**へ回す。
# 絵（.ico）を読むのはエクスプローラー（別のプログラム）——見えないと白紙の絵になる。
# 置き場の答えは`paths.browser_dir()`の1箇所（MSIXの端末でだけ外へ移す）。
import tempfile as _tf  # noqa: E402
from backend import paths as _paths  # noqa: E402
_vis = Path(_tf.mkdtemp()) / 'visible'
_keep_bd = _paths.browser_dir
try:
    _paths.browser_dir = lambda: _vis
    _ip = app_icon.icon_path()
finally:
    _paths.browser_dir = _keep_bd
rec('ショートカットの絵はほかのプログラムからも見える置き場に置く（§9.496）',
    Path(_ip).parent == _vis, str(_ip))
from backend.launcher import setup_check as _sc  # noqa: E402
rec('使わなくなった補助スクリプトは端末の手元から片付ける（§9.552）', 'make_shortcut.vbs' in _sc.RETIRED_LOCAL)

ng = [n for n, ok in R if not ok]
print(f'\n== {len(R) - len(ng)}/{len(R)} PASS ==')
sys.exit(1 if ng else 0)
