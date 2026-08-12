#!/usr/bin/env python3
"""test_assetcache.py: 資材(JS/CSS)は起動のたびに読み直さない（§9.97）。

============================================================
なぜ要るか
------------------------------------------------------------
画面側のJSは19本で1.0MB、CSSは0.4MB。`app.py` の `after_request` が
**全ての応答へ無条件に `no-store` を付けていた**ため、起動のたびに
この1.4MBを丸ごと読み直していた。共有フォルダ越し・低速な端末ほど
そのまま起動時間になる。

しかも `backend/routes/core.py` の `_css_bundle()` は
`public, max-age=31536000, immutable` を明示していた——「以前は no-cache で
毎回取り直しており、起動のたびに数百KBを読み直す」という**コメント付きの
対処**まで書かれていたのに、`after_request` はビューの後に走るので
**上書きされて一度も効いていなかった**。直したつもりが効いていない、の典型。

長期キャッシュしてよい理由は**版がURLに入っている**こと。JS/CSSは
`?t=<全資材の最新更新時刻>` を付けて読み込むので、中身が変われば
URLごと変わる。だから「古いものを掴んだまま」にはならない。

ここで固定するのは4つ。
 1. `?t=` 付きのJS/CSSは長期キャッシュを返す
 2. 画面(HTML)とAPIは**今までどおり**毎回取り直させる（古い在庫を見せない）
 3. `?t=` の無いJSは長期キャッシュしない（版が分からないため）
 4. 資材を1つ触ると `?t=` が変わる（＝更新が確実に届く）
============================================================
"""
import pathlib
import re
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import app as flask_app  # noqa: E402

R = []


def rec(name, ok, detail=''):
    R.append(ok)
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + detail) if detail else ''))


client = flask_app.app.test_client()
LONG = 'max-age=31536000'


def cc(path):
    r = client.get(path)
    return r.status_code, r.headers.get('Cache-Control', '')


def main():
    # 画面から実際に使われている ?t= を取り出す(埋め込みの形ごと確かめる)
    html = client.get('/').get_data(as_text=True)
    m = re.search(r"TOKEN='\?t=(\d+)'", html)
    token = m.group(1) if m else ''
    rec('画面が資材の版(?t=)を埋め込んでいる', bool(token), token)

    # ---- 1. 版付きの資材は長期キャッシュ ----
    st, v = cc(f'/static/js/base.js?t={token}')
    rec('版付きのJSは長期キャッシュを返す', st == 200 and LONG in v, f'{st} / {v}')
    st, v = cc(f'/css/app.css?t={token}')
    rec('版付きのCSSも長期キャッシュを返す', st == 200 and LONG in v, f'{st} / {v}')
    st, v = cc(f'/css/boot.css?t={token}')
    rec('起動用CSSも長期キャッシュを返す', st == 200 and LONG in v, f'{st} / {v}')

    # ---- 2. 画面とAPIは毎回取り直させる ----
    st, v = cc('/')
    rec('画面(HTML)は毎回取り直させる', 'no-store' in v, v)
    st, v = cc('/api/build')
    rec('APIの応答は毎回取り直させる（古い在庫を見せない）', 'no-store' in v, v)
    st, v = cc(f'/api/build?t={token}')
    rec('APIは ?t= が付いていても長期キャッシュしない', 'no-store' in v, v)

    # ---- 3. 版の無い資材は長期キャッシュしない ----
    st, v = cc('/static/js/base.js')
    rec('版の無いJSは長期キャッシュしない（どの版か分からないため）',
        'no-store' in v, v)

    # ---- 4. 資材を触ると版が変わる ----
    target = ROOT / 'static' / 'js' / 'base.js'
    before = target.stat().st_mtime
    try:
        now = time.time() + 2
        import os
        os.utime(target, (now, now))
        html2 = client.get('/').get_data(as_text=True)
        m2 = re.search(r"TOKEN='\?t=(\d+)'", html2)
        rec('資材を1つ触ると版が変わる（更新が確実に届く）',
            bool(m2) and m2.group(1) != token, f'{token} → {m2.group(1) if m2 else "?"}')
    finally:
        import os
        os.utime(target, (before, before))

    print(f'\n== {sum(R)}/{len(R)} PASS ==')
    sys.exit(0 if all(R) else 1)


main()
