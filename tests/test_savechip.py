#!/usr/bin/env python3
"""test_savechip.py: 遅い書き込みに「保存しています…」を出す（§9.273）。

============================================================
なぜ要るか
------------------------------------------------------------
共有のマスタへ保存するときは書込サイクル（ロック→取り直し→押し出し・§9.263）
を通るので、実機で数秒かかる。そのあいだ画面が無反応だと「効いていない」と
読まれ、もう一度押されることになる（利用者の報告「保存しましたというメッセージが
出るまで6秒くらい待たされます」）。

出す/出さないの分かれ目は「そのPOSTが**書くのか読むのか**」で、それを知って
いるのは**サーバー**（`access_mode._READ_ONLY_POST_ENDPOINTS`）。画面へ同じ
一覧を持つと必ず腐るので、**呼ぶ側が`quiet:true`の印を付ける**形にしてある。

ここで固定するのは3つ。**印の付け忘れ・付けすぎを機械で数える**。
 1. 読むだけのPOSTには**全部**印が付いている（付け忘れると「保存しています」
    と嘘をつく）
 2. 印が付いているのは読むだけのPOSTだけ（**付けすぎると本物の保存で
    出なくなる**——利用者が欲しがっているのはまさにそれ）
 3. 既定は「出す」（非GETは印が無ければ出る）
============================================================
"""
import pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

R = []
def rec(n, ok, d=''):
    R.append((n, ok, d))
    print(('PASS' if ok else 'FAIL') + ': ' + n + (' -- ' + str(d) if d else ''))


import app as appmod  # noqa: E402
from backend.access_mode import _READ_ONLY_POST_ENDPOINTS as READ_ONLY  # noqa: E402

# ---- サーバーの宣言 -> URL -------------------------------------------------
post_urls = {}
for rule in appmod.app.url_map.iter_rules():
    if 'POST' in (rule.methods or set()):
        post_urls.setdefault(rule.endpoint, []).append(str(rule.rule))
read_only_urls = set()
for e in READ_ONLY:
    for u in post_urls.get(e, []):
        read_only_urls.add(u)
rec('前提: 読むだけのPOSTのURLを引ける', len(read_only_urls) >= 5,
    f'{len(read_only_urls)}本: ' + ', '.join(sorted(read_only_urls)))

# ---- 画面の呼び出し箇所を数える --------------------------------------------
# `api('<url>', { ... })` の options に `quiet:true` があるか。
CALL = re.compile(r"""api\(\s*'(/api/[^']+)'\s*,\s*\{([^{}]*)""", re.S)
calls = []          # (ファイル, URL, quiet, 行)
for f in sorted((ROOT / 'static' / 'js').rglob('*.js')):
    src = f.read_text(encoding='utf-8')
    for m in CALL.finditer(src):
        url, opts = m.group(1), m.group(2)
        if 'method' not in opts:
            continue                       # GET（既定）は対象外
        method = re.search(r"method\s*:\s*'([A-Za-z]+)'", opts)
        if method and method.group(1).upper() == 'GET':
            continue
        calls.append((f.name, url, 'quiet:true' in opts,
                      src[:m.start()].count('\n') + 1))
rec('前提: 非GETの呼び出しを拾えている', len(calls) >= 20, f'{len(calls)}箇所')

# 1. 読むだけのPOSTには全部印が付いている
missing = [f'{fn}:{ln} {u}' for fn, u, q, ln in calls if u in read_only_urls and not q]
rec('読むだけのPOSTには全部 quiet:true が付いている', not missing,
    '付いていない: ' + ' / '.join(missing) if missing else
    f'{sum(1 for _, u, q, _ in calls if u in read_only_urls)}箇所')

# 2. 印が付いているのは読むだけのPOSTだけ
extra = [f'{fn}:{ln} {u}' for fn, u, q, ln in calls if q and u not in read_only_urls]
rec('本物の保存に quiet:true を付けていない（付けると出なくなる）', not extra,
    '余分: ' + ' / '.join(extra) if extra else 'なし')

# 3. 既定は「出す」——`api()`が非GETで自動的に出す作りであること。
#    **綴りで見る**のはここだけ（振る舞いは tests/test_savechip.js が実際に測る）。
base = (ROOT / 'static' / 'js' / 'core' / 'base.js').read_text(encoding='utf-8')
rec('api() が非GETで自動的に出す', "!=='GET'&&!quiet" in base.replace(' ', ''),
    'watching の条件が見当たらない')
rec('やり直しのボタンは自動側では出さない（二重に書かないため）',
    'autoEnd' in base and "paint('ng','保存できませんでした'" in base.replace('\n', ''))
rec('run() が出しているときは手を出さない（文言が入れ替わらない）',
    'if(busy>0||retry)return false;' in base.replace(' ', '').replace('\n', '')
    or 'if(busy>0||retry)returnfalse;' in base.replace(' ', '').replace('\n', ''))

ng = [x for x in R if not x[1]]
print('\n=== SUMMARY ===')
print(f'{len(R)-len(ng)}/{len(R)} passed')
for n, _, d in ng:
    print(' -', n, d)
sys.exit(1 if ng else 0)
