#!/usr/bin/env python3
"""test_launchmode.py: この端末の起動のしかた（`backend/launch_mode.py`・§9.547）の決まり。

 1. 置き場は2つ（`%LOCALAPPDATA%\\WaveLog\\runtime`・`~\\.wavelog\\runtime`）で、**Start.vbs が読む道と同じ**
 2. 既定は1つ（Python の`DEFAULT`＝Start.vbs の`Const DEFAULT_MODE`）。引数なしの Start.vbs が手元の設定を読む
 3. Store 版の Python で写しになる置き場へは書かない（次の置き場へ書く）。もう1つの古い設定は消す
 4. 読むのは**新しいほう**。字が違う・空なら残していないものとして既定へ
 5. exe が Start.vbs の隣に無ければデスクトップ版を選べない（理由を返す）。Windows でなければ選べない
 6. 口: いま動いている版は宛先で分かる（デスクトップ版の窓口＝`wavelog.localhost`）。書くのは3モードとも通す
"""
import os
import pathlib
import re
import sys
import tempfile
import time
import types

BASE = tempfile.mkdtemp(prefix='wl-launch-')
os.environ['LOCALAPPDATA'] = os.path.join(BASE, 'L')   # backend を読む前に
ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

R = []


def rec(name, ok, detail=''):
    R.append(bool(ok))
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + detail) if detail else ''))


def main():
    from backend import launch_mode as lm
    home = pathlib.Path(BASE) / 'H'
    lm._home = lambda: home
    vbs = (ROOT / 'Start.vbs').read_bytes().decode('cp932')

    # ---- 1・2. Start.vbs と同じ道・同じ既定 ----
    pl = lm.places()
    rec('1 置き場は2つ（LOCALAPPDATA → ホーム）', pl == [pathlib.Path(BASE) / 'L' / 'WaveLog' / 'runtime' / lm.FILE_NAME,
                                                      home / '.wavelog' / 'runtime' / lm.FILE_NAME], str(pl))
    rec('1 Start.vbs も同じ2つを読む', '"%LOCALAPPDATA%") & "\\WaveLog\\runtime\\launch_mode.txt"' in vbs
        and '"%USERPROFILE%") & "\\.wavelog\\runtime\\launch_mode.txt"' in vbs)
    m = re.search(r'Const DEFAULT_MODE = "(\w+)"', vbs)
    rec('2 既定は Python と Start.vbs で同じ値', bool(m) and m.group(1) == lm.DEFAULT and lm.DEFAULT in lm.MODES,
        m.group(1) if m else '定数なし')
    rec('2 引数なしの Start.vbs は手元の設定を読む・引数があればそちら',
        'If mode = "" Then mode = SavedMode()' in vbs and vbs.index('SavedMode()') < vbs.index('If mode = "desktop" Then'))
    rec('2 Start.vbs が受ける字は顔ぶれと同じ', all(f'word = "{k}"' in vbs for k in lm.MODES))
    rec('2 Start.vbs は新しいほうを採る', 'DateLastModified > bestTime' in vbs)
    rec('2 Start.vbs は行末の余分な CR を落として読む', 'Replace(ts.ReadLine, vbCr, "")' in vbs)

    # ---- 3. 書く ----
    rec('3 残していなければ既定', lm.saved() == (None, None) and lm.status('browser')['mode'] == lm.DEFAULT)
    r = lm.write('desktop')
    rec('3 ふつうの端末は1つ目へ書く', r.get('ok') and r['file'] == str(pl[0]) and lm.saved()[0] == 'desktop', str(r))
    rec('3 書いた字は Start.vbs が読める形（ASCII・1行）', pl[0].read_bytes() == b'desktop\r\n')
    orig = lm.paths.msix_private_copy
    lm.paths.msix_private_copy = lambda p: p if str(p).startswith(str(pl[0].parent)) else None
    try:
        r = lm.write('browser')
    finally:
        lm.paths.msix_private_copy = orig
    rec('3 写しになる置き場は使わず、ホームへ書く', r.get('ok') and r['file'] == str(pl[1]), str(r))
    rec('3 写しになった置き場の書きかけは残さない', not pl[0].exists())
    rec('3 顔ぶれに無い字は断る', not lm.write('chrome')['ok'])

    # ---- 4. 新しいほう ----
    pl[0].parent.mkdir(parents=True, exist_ok=True)
    pl[0].write_text('desktop\r\n', encoding='utf-8')
    old = time.time() - 3600
    os.utime(pl[1], (old, old))
    rec('4 新しいほうを採る', lm.saved() == ('desktop', pl[0]), str(lm.saved()))
    pl[0].write_text('chrome\r\n', encoding='utf-8')
    rec('4 字が違えば残していないものとして既定へ', lm.saved()[0] is None and lm.status('')['mode'] == lm.DEFAULT)
    lm.write('browser')
    rec('4 書いたらもう1つの古い設定は消す（どちらを読んでも同じ）', sum(p.exists() for p in pl) == 1)

    # ---- 5. exe と OS ----
    d = pathlib.Path(tempfile.mkdtemp(prefix='wl-exe-'))
    st = lm.status('browser', root=d)
    rec('5 exe が無ければデスクトップ版を選べず、置き場まで言う',
        not st['canDesktop'] and lm.EXE_NAME in st['desktopWhy'] and str(d) in st['desktopWhy'])
    (d / lm.EXE_NAME).write_bytes(b'MZ' + b'\0' * 100)
    real = lm.sys
    lm.sys = types.SimpleNamespace(platform='win32')
    try:
        st = lm.status('browser', root=d)
        rec('5 exe があれば選べる（大きさと時刻も返す）', st['canDesktop'] and st['exe']['size'] == 102 and st['exe']['updatedAt'])
    finally:
        lm.sys = real
    lm.sys = types.SimpleNamespace(platform='linux')
    try:
        st = lm.status('browser', root=d)
    finally:
        lm.sys = real
    rec('5 Windows でなければ選べず、理由を言う', not st['supported'] and not st['canDesktop'] and 'Windows' in st['why'])
    rec('5 顔ぶれの字はサーバーが持つ', [m['key'] for m in st['modes']] == list(lm.MODES)
        and all(m['label'] and m['hint'] for m in st['modes']))

    # ---- 6. 口 ----
    sys.path.insert(0, str(ROOT / 'program'))
    import _pycache_bootstrap  # noqa: F401  バイトコードの置き場を先に決める（§9.406）
    import _approot  # noqa: F401  探索先へ program/ を足す（§9.406）
    from backend.app_module import flask_app
    from backend import access_mode
    c = flask_app().test_client()
    a = c.get('/api/app/launch-mode').get_json()
    b = c.get('/api/app/launch-mode', headers={'Host': 'wavelog.localhost'}).get_json()
    rec('6 いま動いている版は宛先で分かる', a['running'] == 'browser' and b['running'] == 'desktop', f"{a['running']} / {b['running']}")
    rec('6 書く口は3モードとも通す', access_mode._ENDPOINT_EXTRA_MODES.get('core.app_launch_mode_set') == {'edit', 'view', 'schedule'})
    lm.sys = types.SimpleNamespace(platform='win32')
    real_root = lm.APP_ROOT
    try:
        lm.APP_ROOT = pathlib.Path(tempfile.mkdtemp(prefix='wl-noexe-'))
        r = c.post('/api/app/launch-mode', json={'mode': 'desktop'})
        rec('6 exe が無いのにデスクトップ版は 400 と理由', r.status_code == 400 and lm.EXE_NAME in r.get_json()['error'])
        lm.APP_ROOT = d
        r = c.post('/api/app/launch-mode', json={'mode': 'desktop'})
        rec('6 選べば残り、答えにいまの設定が載る', r.status_code == 200 and r.get_json()['mode'] == 'desktop'
            and r.get_json()['saved'] and lm.saved()[0] == 'desktop', str(r.get_json())[:200])
    finally:
        lm.sys = real
        lm.APP_ROOT = real_root
    lm.sys = types.SimpleNamespace(platform='linux')
    try:
        r = c.post('/api/app/launch-mode', json={'mode': 'browser'})
    finally:
        lm.sys = real
    rec('6 Windows でない端末では断る（400 と理由）', r.status_code == 400 and 'Windows' in r.get_json()['error'])

    n = len(R) - sum(R)
    print(f'== {sum(R)}/{len(R)} PASS ==')
    return 1 if n else 0


if __name__ == '__main__':
    sys.exit(main())
