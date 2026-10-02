#!/usr/bin/env python3
"""test_sidecar.py: デスクトップ版の窓口（`program/sidecar.py`・§9.544・評価関数 E3／E4）。

============================================================
なぜ要るか
------------------------------------------------------------
デスクトップ版は画面のポートを開かず、窓（Tauri）が Python を子として起こして
**標準入出力の枠**で問い合わせる。移行で崩してはいけないのは2つ。

 E3 **答えが同じ**であること——ポートの版（Flask をそのまま呼ぶ）と1バイトも
    違わない。違えば、画面の JS は同じなのに片方だけで壊れる。本物の子プロセスへ
    パイプで送った答えを、同じアプリへ直接送った答えと突き合わせる
    （HTML・部品・連結した CSS・API・404・400 の理由・日本語の問い合わせ・
    約200KB の日本語の POST・40本同時）。
 E4 **窓を閉じたら片付けて終わる**こと——ブラウザ版はタブが0件になって8秒後に
    `watchdog.teardown()`（書込役をやめる・編集セッション・在席）を通って終わる。
    デスクトップ版は標準入力が閉じたのを見て**同じ片付けを通る**。片付けないと、
    他の端末が共有の目印の期限（既定90秒）まで待たされる（§9.301 ①）。

枠そのものの約束も固める: 壊れた行を捨てて続ける・print や子プロセスの出力が
枠に混ざらない（fd 1 を標準エラーへ向け直す）。

書込役の片付けは、**この窓口が書込役になれたときだけ**測れる（別のプロセス
——回帰のサーバー——が書込役ならなれない）。なれなかったら「測っていない」と
書き、合否に数えない（§9.369「物が無いを欠陥として記録しない」）。
============================================================
"""
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse

ROOT = pathlib.Path(__file__).resolve().parent.parent
# 窓口と同じ「この端末の作業場所」を使う（在席の手元の置き場・ログを同じ所で見る）。
# **backend を読む前に**決める（paths は最初の答えを覚える）。
LOCAL = pathlib.Path(tempfile.mkdtemp(prefix='wl-sidecar-'))
os.environ['LOCALAPPDATA'] = str(LOCAL)
sys.path.insert(0, str(ROOT))

import apppath  # noqa: F401,E402 `program/` を探索先へ（§9.404）
import app as flask_app  # noqa: E402
import sidecar  # noqa: E402  program/sidecar.py（枠の読み書き・fd の向け直し）
from backend import presence  # noqa: E402
from backend.access_mode import current_login_id, current_pc_name  # noqa: E402
from backend.watchdog import TEARDOWN_BUDGET_SEC  # noqa: E402

R = []


def rec(name, ok, detail=''):
    R.append(bool(ok))
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + detail) if detail else ''))


def note(text):
    print('INFO: ' + text)


class Side:
    """本物の子プロセス（`python program/sidecar.py`）と枠で話す係。"""

    def __init__(self):
        self.err_path = LOCAL / 'sidecar_stderr.log'
        self.err = open(self.err_path, 'wb')
        env = dict(os.environ, PYTHONIOENCODING='utf-8')
        self.p = subprocess.Popen([sys.executable, '-X', 'utf8', 'program/sidecar.py'], cwd=ROOT,
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.err, env=env)
        self.replies, self.notices = {}, []
        self.cv = threading.Condition()
        self.next = 1
        self.wlock = threading.Lock()
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        while True:
            f = sidecar.read_frame(self.p.stdout)
            if f is None:
                break
            head, body = f
            with self.cv:
                if head.get('id'):
                    self.replies[head['id']] = (head, body)
                else:
                    self.notices.append(head)
                self.cv.notify_all()
        with self.cv:
            self.notices.append({'event': 'eof'})
            self.cv.notify_all()

    def wait_event(self, names, timeout):
        end = time.monotonic() + timeout
        with self.cv:
            while True:
                hit = next((n for n in self.notices if n.get('event') in names), None)
                if hit or time.monotonic() > end:
                    return hit
                self.cv.wait(0.2)

    def raw(self, data):
        with self.wlock:
            self.p.stdin.write(data)
            self.p.stdin.flush()

    def ask(self, method, path, query='', body=b'', headers=None):
        with self.wlock:
            rid = self.next
            self.next += 1
        head = {'id': rid, 'method': method, 'path': path, 'query': query, 'headers': headers or {},
                'len': len(body)}
        self.raw(json.dumps(head, ensure_ascii=False).encode('utf-8') + b'\n' + body)
        return rid

    def reply(self, rid, timeout=60):
        end = time.monotonic() + timeout
        with self.cv:
            while rid not in self.replies and time.monotonic() < end:
                self.cv.wait(0.2)
            return self.replies.get(rid)

    def call(self, *a, **kw):
        return self.reply(self.ask(*a, **kw))

    def close(self, timeout=20):
        """入力を閉じる（窓を閉じたのと同じ）。→ 終わるまでの秒数（終わらなければ None）"""
        t0 = time.monotonic()
        self.p.stdin.close()
        try:
            self.p.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            return None
        return time.monotonic() - t0

    def kill(self):
        if self.p.poll() is None:
            self.p.kill()
            self.p.wait()
        self.err.close()


def digest(b):
    return hashlib.sha256(b or b'').hexdigest()[:12]


def header(h, name):
    for k, v in (h.get('headers') or []):
        if k.lower() == name.lower():
            return v
    return ''


def direct(method, path, query='', body=b'', headers=None):
    """同じアプリへ直接（ポートの版と同じ Flask の処理）。→ (状態, 種類, 本文, Cache-Control)"""
    r = flask_app.app.test_client().open(path, method=method, query_string=query, data=body,
                                         headers=headers or {})
    return r.status_code, r.headers.get('Content-Type', ''), r.get_data(), r.headers.get('Cache-Control', '')


def resolve_body():
    rows = [{'ロット番号': f'試験{i:05d}', '品名': '日本語の品名・ｶﾅ・①', '設備': '条切1号'} for i in range(2000)]
    return json.dumps({'rows': rows}, ensure_ascii=False).encode('utf-8')


CASES = [
    # (名前, method, path, query, body, headers)
    ('画面（HTML）', 'GET', '/', '', b'', None),
    ('部品（版付きの JS・長く使い回す）', 'GET', '/static/js/core/base.js', 't=1', b'', None),
    ('連結した CSS（Python が作る束）', 'GET', '/css/app.css', 't=1', b'', None),
    ('更新履歴', 'GET', '/api/changelog', '', b'', None),
    ('データソースの一覧', 'GET', '/api/catalog', '', b'', None),
    ('この端末の名乗り', 'GET', '/api/whoami', '', b'', None),
    ('いまのモード', 'GET', '/api/access-mode', '', b'', None),
    ('無いところ（404）', 'GET', '/api/no-such-route', '', b'', None),
    ('400 の理由（日本語）', 'POST', '/api/measurement/backup', '', b'{}', {'Content-Type': 'application/json'}),
    ('日本語の問い合わせ文字', 'GET', '/api/measurement/backup/get',
     urllib.parse.urlencode({'id': '存在しない記録・日本語'}), b'', None),
    ('約200KBの日本語の POST', 'POST', '/api/query-join/resolve', '', resolve_body(),
     {'Content-Type': 'application/json'}),
]


def check_answers(side):
    """E3: 同じ問い合わせへの答えが、直接呼んだときと1バイトも違わないか。"""
    same = 0
    for name, method, path, query, body, headers in CASES:
        got = side.call(method, path, query, body, headers)
        want = direct(method, path, query, body, headers)
        if got is None:
            rec(f'E3 {name}: 答えが返る', False, '60秒たっても答えない')
            continue
        h, b = got
        ok = (h['status'], header(h, 'Content-Type'), digest(b)) == (want[0], want[1], digest(want[2]))
        if path.startswith(('/static/', '/css/')):
            ok = ok and header(h, 'Cache-Control') == want[3]
        same += ok
        rec(f'E3 {name}: 直接呼んだときと同じ答え', ok,
            f'{h["status"]} {len(b)}B {digest(b)} / 直接 {want[0]} {len(want[2])}B {digest(want[2])}')
    rec(f'E3 一致した割合 {same}/{len(CASES)}', same == len(CASES))
    # 40本同時（長い問い合わせが短いものを待たせない・番号で持ち主へ返る）
    want = direct('GET', '/api/changelog')[2]
    ids = [side.ask('GET', '/api/changelog', f'n={i}') for i in range(40)]
    got = [side.reply(i) for i in ids]
    ok = sum(1 for g in got if g and g[0]['status'] == 200 and g[1] == want)
    rec('E3 40本同時に送っても全部が番号どおりに同じ答え', ok == 40, f'{ok}/40')


def check_frames(side):
    """枠の約束: 壊れた行は捨てて続ける・print や子プロセスの出力が枠に混ざらない。"""
    side.raw(b'this is not json\n')
    side.raw(b'["not", "an", "object"]\n')
    r = side.call('GET', '/api/whoami')
    rec('壊れた行（JSON でない・オブジェクトでない）を捨てて、次の問い合わせに答える',
        bool(r) and r[0]['status'] == 200)
    code = ('import sys, subprocess; sys.path.insert(0, {prog!r}); import sidecar; '
            'rin, out = sidecar.protocol_streams(); print("noise-print"); '
            'subprocess.run([sys.executable, "-c", "print(\\"child-noise\\")"]); '
            'sidecar.Writer(out).send({{"id": 0, "event": "probe"}})').format(prog=str(ROOT / 'program'))
    p = subprocess.run([sys.executable, '-c', code], cwd=ROOT, capture_output=True, timeout=60,
                       env=dict(os.environ, PYTHONIOENCODING='utf-8'))
    lines = p.stdout.splitlines()
    ok = len(lines) == 1 and json.loads(lines[0]).get('event') == 'probe'
    rec('print と子プロセスの出力は標準エラーへ行き、標準出力は枠だけ', ok and b'noise-print' in p.stderr
        and b'child-noise' in p.stderr, f'標準出力 {p.stdout[:80]!r}')


def check_teardown(side):
    """E4: 入力を閉じたら、同じ片付けを通って速やかに終わる。"""
    login, pc = current_login_id(), current_pc_name()
    entry = presence._entry_path(presence.terminal_key(login, pc))
    side.call('POST', '/api/heartbeat', 'tab=sidecar-test')
    end = time.monotonic() + 10
    while not entry.exists() and time.monotonic() < end:
        time.sleep(0.2)
    rec('ハートビートで在席が書かれる（窓口がパイプでも同じ）', entry.exists(), str(entry))
    # 書込役（なれたときだけ測る）。見張りは2秒待ってから名乗り、1.5秒後に確かめる。
    owner, marker_id, end = False, '', time.monotonic() + 12
    while time.monotonic() < end:
        r = side.call('GET', '/api/schedule/owner-status')
        st = json.loads(r[1]) if r and r[0]['status'] == 200 else {}
        if not st.get('enabled') or not st.get('configured'):
            break
        if st.get('isOwner'):
            owner, marker_id = True, str(st.get('id') or '')
            break
        time.sleep(0.5)
    from backend import schedule_owner
    secs = side.close()
    rec(f'入力を閉じたら終わる（片付けの持ち時間 {TEARDOWN_BUDGET_SEC}秒＋0.5秒以内）',
        secs is not None and secs <= TEARDOWN_BUDGET_SEC + 0.5,
        '終わらない' if secs is None else f'{secs:.2f}秒（ブラウザ版はタブを閉じてから約8秒）')
    rec('終わった後に在席が消えている', not entry.exists(), str(entry))
    if owner:
        m = schedule_owner.read_marker()
        rec('書込役だったなら、目印を手放している（他の端末が期限を待たずに引き継げる）',
            not (isinstance(m, dict) and m.get('id') == marker_id) if marker_id else not m,
            f'目印 {(m or {}).get("pc", "なし") if isinstance(m, dict) else m}')
    else:
        note('書込役の片付けは測っていない（この窓口は書込役になれなかった——別のプロセスが書込役か、'
             '共有スケジュールが未設定）')
    log = (LOCAL / 'WaveLog' / 'logs' / 'launcher.log').read_text(encoding='utf-8', errors='replace')
    rec('終了理由が「窓を閉じた」と記録される', sidecar.EXIT_REASON in log)
    tail = log[log.rfind('終了理由'):]
    rec('同じ片付け（書込役・編集セッション・在席）を通った記録がある', '片付け' in tail and '在席=' in tail,
        next((ln for ln in tail.splitlines() if '片付け' in ln), '')[-80:])


def main():
    side = Side()
    try:
        ready = side.wait_event(('ready', 'fatal', 'eof'), 120)
        rec('窓口が「準備できた」と知らせる（ポートを開かずに）', bool(ready) and ready.get('event') == 'ready',
            json.dumps(ready, ensure_ascii=False)[:160] if ready else '120秒たっても知らせが無い')
        rec('知らせに枠の約束の版が入っている（窓が版のずれを言えるように）',
            bool(ready) and ready.get('protocol') == sidecar.PROTOCOL, str((ready or {}).get('protocol')))
        if not ready or ready.get('event') != 'ready':
            print(side.err_path.read_text(encoding='utf-8', errors='replace')[-2000:])
            return 1
        check_answers(side)
        check_frames(side)
        check_teardown(side)
        err = side.err_path.read_text(encoding='utf-8', errors='replace')
        rec('標準エラーに未処理の例外が出ていない', 'Traceback' not in err, err[-300:] if 'Traceback' in err else '')
    finally:
        side.kill()
        shutil.rmtree(LOCAL, ignore_errors=True)
    print(f'\n== {sum(R)}/{len(R)} PASS ==')
    return 0 if all(R) else 1


if __name__ == '__main__':
    sys.exit(main())
