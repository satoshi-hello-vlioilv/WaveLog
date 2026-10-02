#!/usr/bin/env python3
"""test_terminalstore.py: 端末の控え（`backend/terminal_store.py`・§9.545）の決まり。

画面どうし（ブラウザ版とデスクトップ版）の突き合わせは `test_terminal.js` が2つのオリジンで測る。
ここはサーバーだけで決まることを固める。

 1. 記録は**新しいほうだけ**を受け付ける（同じ・古い版で上書きしない）
 2. 消した印は残り、**消した後に届いた古い記録を受け付けない**。消した後の新しい記録は受け付ける
 3. 見出し（index）は中身を運ばない。中身は指定した記録だけ
 4. 設定は**送った名前だけ**重ね、同じ値では通し番号を進めない。消した名前（None）も残る
 5. 「最後に見た番号より後」だけを返す（`revs` も添える）
 6. 置き場は端末の作業場所（`local_root()/terminal`）。`%TEMP%` にも `db/`（共有・Box）にも置かない
 7. 控えの口は**どのモードでも・切断中でも**書ける（端末の手元にしか無いので。共有の段は切断で止まる）
 8. 画面の HTML に控えの設定を埋めて渡している（画面のJSより先に当てるため）
"""
import os
import pathlib
import sys
import tempfile

LOCAL = tempfile.mkdtemp(prefix='wl-termstore-')
os.environ['LOCALAPPDATA'] = LOCAL           # backend を読む前に（paths は最初の答えを覚える）
ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

R = []


def rec(name, ok, detail=''):
    R.append(bool(ok))
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + detail) if detail else ''))


def main():
    from backend import paths, terminal_store as t
    T = lambda m: f'2026-10-02T01:{m:02d}:00.000Z'  # noqa: E731

    # ---- 6. 置き場 ----
    p = t.store_path()
    rec('6 置き場は端末の作業場所（local_root()/terminal）', p.parent == paths.local_root() / 'terminal', str(p))
    rec('6 %TEMP%（tempfile.gettempdir()直下）でも db/（Box・共有）でもない',
        p.parent != pathlib.Path(tempfile.gettempdir()) and ROOT / 'db' not in p.parents)

    # ---- 1. 新しいほうだけ ----
    r = t.put_records([{'id': 'a', 'updatedAt': T(10), 'v': 1}, {'id': 'b', 'updatedAt': T(10)}])
    rec('1 新しい記録は書く', r['stored'] == 2, str(r))
    r = t.put_records([{'id': 'a', 'updatedAt': T(9), 'v': 'old'}, {'id': 'a', 'updatedAt': T(10), 'v': 'same'}])
    rec('1 古い版・同じ版では上書きしない', r['kept'] == 2 and t.records(['a'])[0]['record']['v'] == 1, str(r))
    r = t.put_records([{'id': 'a', 'updatedAt': T(11), 'v': 2}])
    rec('1 新しい版で上書きする', r['stored'] == 1 and t.records(['a'])[0]['record']['v'] == 2)
    r = t.put_records([{'updatedAt': T(1)}, 'x', {'id': ' '}])
    rec('1 IDの無い・形の違う行は黙って飛ばす（他を道連れにしない）', r == {'stored': 0, 'kept': 0, 'refused': 0}, str(r))

    # ---- 2. 消した印 ----
    rec('2 消すと印が残る', t.delete_records(['b'], T(20)) == 1
        and [x for x in t.index() if x['id'] == 'b'][0]['deletedAt'] == T(20))
    r = t.put_records([{'id': 'b', 'updatedAt': T(15)}])
    rec('2 消した後に届いた古い記録は受け付けない（消したものが別の窓から戻らない）', r['refused'] == 1, str(r))
    rec('2 消した記録は中身を持たない', t.records(['b'])[0]['record'] is None)
    rec('2 前の削除より古い時刻で消し直しても印は動かない', t.delete_records(['b'], T(5)) == 0)
    r = t.put_records([{'id': 'b', 'updatedAt': T(25), 'again': True}])
    rec('2 消した後に作り直した新しい記録は受け付ける（印は外れる）', r['stored'] == 1
        and [x for x in t.index() if x['id'] == 'b'][0]['deletedAt'] == '')

    # ---- 3. 見出しと中身 ----
    idx = t.index()
    rec('3 見出しは中身を運ばない', all(set(x) == {'id', 'updatedAt', 'deletedAt'} for x in idx), str(idx[:1]))
    many = [{'id': f'm{i:04d}', 'updatedAt': T(30)} for i in range(1200)]
    t.put_records(many)
    got = t.records([x['id'] for x in many] + ['nope'])
    rec('3 中身は指定した記録だけ（SQLの変数の上限を超える数でも）', len(got) == 1200, f'{len(got)}件')

    # ---- 4・5. 設定 ----
    r0 = t.settings(0)['rev']
    r1 = t.put_settings({'k1': 'v1', 'k2': 'v2'})
    r2 = t.put_settings({'k1': 'v1'})
    rec('4 同じ値では通し番号を進めない（相手の窓に無駄な取り直しをさせない）', r1 == r0 + 2 and r2 == r1, f'{r0}→{r1}→{r2}')
    r3 = t.put_settings({'k2': None, 'k3': 'x' * (t.MAX_SETTING_BYTES + 1), 'k4': 5})
    s = t.settings(r1)
    rec('4 送った名前だけ重ね、消した名前は None で残る（大きすぎる値・文字列でない値は捨てる）',
        s['values'] == {'k2': None} and r3 == r1 + 1, str(s))
    rec('5 最後に見た番号より後だけを返し、名前ごとの番号を添える',
        s['revs'] == {'k2': r3} and set(t.settings(0)['values']) == {'k1', 'k2'})

    # ---- 7・8. ルート ----
    import apppath  # noqa: F401  `program/` を探索先へ（§9.404）
    import app as flask_app
    from backend import access_mode as am
    c = flask_app.app.test_client()
    mode0 = am.get_mode()
    try:
        am._mode = 'view'
        r = c.post('/api/terminal/settings', json={'values': {'k5': 'view'}, 'origin': 'http://x'})
        rec('7 閲覧モードでも控えへ書ける', r.status_code == 200, str(r.status_code))
        orig = am.revocation_now
        am.revocation_now = lambda: {'by': '試験', 'byPc': 'PC', 'remainingSec': 60}
        try:
            r = c.post('/api/terminal/records/put', json={'records': [{'id': 'z', 'updatedAt': T(40)}]})
            r2 = c.post('/api/measurement/backup', json={})
            rec('7 切断中でも控えへは書ける（共有へは書けない）', r.status_code == 200 and r2.status_code == 403,
                f'控え {r.status_code} / 共有 {r2.status_code}')
        finally:
            am.revocation_now = orig
    finally:
        am._mode = mode0
    html = c.get('/').get_data(as_text=True)
    rec('8 画面の HTML に控えの設定を埋めて渡している', 'window.__wlTerminal={' in html and '"k5"' in html)
    from backend.routes.core import JS_FILES
    rec('8 控えを当てる JS は画面のJSのいちばん先', JS_FILES[0] == 'core/terminal-sync.js', JS_FILES[0])
    st = c.get('/api/terminal/status').get_json()
    rec('控えの様子を返す（使った画面の印つき）', st.get('ok') and any(o['origin'] == 'http://x' for o in st['origins']))

    print(f'\n== {sum(R)}/{len(R)} PASS ==')
    return 0 if all(R) else 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    finally:
        import shutil
        shutil.rmtree(LOCAL, ignore_errors=True)
