# -*- coding: utf-8 -*-
"""test_pcname.py: この端末の呼び名を確実に取る(§9.208 ⑧、利用者の指示)

「PC名が取得できていないようなので工夫してください。起動時に取得して
 設定情報として保持する形で、確実に取得をお願いします。」

`socket.gethostname()`1本だけに頼っていたため、それが空・`localhost`・
例外を返す端末ではPC名が丸ごと欠けた。PC名はアクセス権限マスタとの照合・
監査列（誰がどの端末で）・編集セッションの持ち主表示のすべてが見る値なので、
欠けると権限も来歴も分からなくなる。

ここで固定すること:
  1. **出どころを複数持ち、使えた最初のものを採る**
  2. **使えない値（空・localhost 等）は採らない**
  3. **健全な端末の答えは変えない**（`gethostname()`が使えるならそれ）
  4. **設定（共通設定の`pc_name`）で名乗り直せる**——自動判定だけだと
     直す手立てが現場に無い
  5. **起動時に1回決めて持ち続ける**（リクエストのたびに解決し直さない）
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

R = []
def rec(name, ok, detail=''):
    R.append((name, ok, detail))
    print(('PASS' if ok else 'FAIL') + ': ' + name + (' -- ' + str(detail) if detail else ''))

from backend import access_mode as am   # noqa: E402

# ---- 1) 使える／使えない値の見分け ----------------------------------
bad = ['', '   ', 'localhost', 'LOCALHOST', 'localhost.localdomain', '(none)',
       'unknown', '127.0.0.1', '::1']
rec('空・localhost・(none)などは名前として採らない',
    all(am._usable_pc_name(x) == '' for x in bad),
    [x for x in bad if am._usable_pc_name(x)])
rec('ふつうの名前はそのまま採る（前後の空白と末尾の点だけ落とす）',
    am._usable_pc_name('  LINE1-PC. ') == 'LINE1-PC', am._usable_pc_name('  LINE1-PC. '))
rec('長すぎる名前は80字で切る', len(am._usable_pc_name('x' * 500)) == 80)

# ---- 2) 出どころが複数ある ------------------------------------------
info = am.resolve_pc_name(force=True)
sources = [t['source'] for t in info['tried']]
rec('出どころを複数持っている（1本に頼らない）', len(sources) >= 5, sources)
rec('gethostname が候補に入っている', any('gethostname' in s for s in sources), sources)
rec('COMPUTERNAME（Windowsの機械名）が候補に入っている',
    any('COMPUTERNAME' in s for s in sources), sources)
rec('この端末の名前を決められた', bool(info['name']), info)
rec('どこから取ったかを答える', bool(info['source']), info['source'])

# ---- 3) 健全な端末の答えを変えない ----------------------------------
import socket  # noqa: E402
host = am._usable_pc_name(socket.gethostname())
if host:
    rec('gethostname が使えるならその値のまま（既存の権限マスタを無効にしない）',
        info['name'] == host and 'gethostname' in info['source'],
        f"{info['name']} / {info['source']}")
else:
    rec('gethostname が使えない環境では別の出どころへ落ちる', bool(info['name']), info)

# ---- 4) 使えない値は飛ばして次を採る --------------------------------
real_host = socket.gethostname
try:
    socket.gethostname = lambda: 'localhost'
    fallback = am.resolve_pc_name(force=True)
finally:
    socket.gethostname = real_host
rec('gethostname が localhost でも別の出どころで名乗れる',
    bool(fallback['name']) and fallback['name'] != 'localhost', fallback)
rec('飛ばした候補も「試した」記録に残る（現地で切り分けられる）',
    any(t['source'].startswith('socket.gethostname') and not t['usable']
        for t in fallback['tried']), fallback['tried'])

# ---- 5) 設定で名乗り直せる ------------------------------------------
real_override = am._pc_name_override
try:
    am._pc_name_override = lambda: 'GENBA-01'
    named = am.pc_name_info()
    rec('共通設定の pc_name が最優先で効く',
        named['name'] == 'GENBA-01' and '設定' in named['source'], named)
    am._pc_name_override = lambda: ''
    back = am.pc_name_info()
    rec('設定を空へ戻すと自動判定へ戻る',
        back['name'] != 'GENBA-01' and '設定' not in back['source'], back)
finally:
    am._pc_name_override = real_override
    am.resolve_pc_name(force=True)

# ---- 6) 覚えている（毎回解決し直さない） ----------------------------
calls = {'n': 0}
real_cand = am._pc_name_candidates
try:
    def counted():
        calls['n'] += 1
        return real_cand()
    am._pc_name_candidates = counted
    am.resolve_pc_name(force=True)   # 1回目は解決する
    for _ in range(5):
        am.current_pc_name()
    rec('起動時に1回決めたら覚えている（呼ぶたびに解決し直さない）',
        calls['n'] == 1, f"解決 {calls['n']}回")
finally:
    am._pc_name_candidates = real_cand
    am.resolve_pc_name(force=True)

# ---- 7) 監査列の窓口も同じ答えを見る --------------------------------
from backend import db_access as da  # noqa: E402
rec('db_access.request_pc_name も同じ名前を返す（判定は1箇所・§9.180）',
    da.request_pc_name() == am.current_pc_name(),
    f"{da.request_pc_name()} / {am.current_pc_name()}")
rec('画面が明示した端末名は上書きしない（作った端末を塗り潰さない）',
    da.request_pc_name({'pc_name': 'OTHER-PC'}) == 'OTHER-PC')

ng = [x for x in R if not x[1]]
print(f"\n== {len(R)-len(ng)}/{len(R)} PASS ==")
sys.exit(1 if ng else 0)
