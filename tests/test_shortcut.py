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

ng = [n for n, ok in R if not ok]
print(f'\n== {len(R) - len(ng)}/{len(R)} PASS ==')
sys.exit(1 if ng else 0)
