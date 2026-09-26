#!/usr/bin/env python3
"""test_logs.py: ログビュワーのサーバー側（§9.99）。

============================================================
なぜ要るか
------------------------------------------------------------
ログを画面から読ませる仕掛けで、いちばん壊れやすいのは次の3つ。

 1. **1行 ≠ 1件。** `log.exception()` が書くトレースバックは日時を持たない
    行が何行も続く。物理行のまま扱うと、画面では原因の行が別の出来事として
    散らばり、削除では**見出しだけ消えて中身が残る**。
 2. **書き込み中のファイルを書き換える。** 追記モードで開かれている裏で
    中身を短くすると、次の追記が元の位置へ行き**先頭がNULで埋まる**。
 3. **どのファイルでも読めてしまう。** ファイル名をそのまま繋ぐと、
    ログ置き場の外まで読み書きできる。

ここで固定するのは、折りたたみ・絞り込み・件単位の削除・置き場の外を
断ること・区切り(rotate)・**作ったAPIが画面から呼ばれていること**の6点。
**本物のログには触らない**——`logs_dir()`を一時フォルダへ差し替えて動かす(この端末で動いているサーバーのログを
テストが消してしまわないようにするため)。
============================================================
"""
import logging
import logging.handlers
import pathlib
import re
import shutil
import sys
import tempfile
import urllib.parse
from datetime import datetime, timedelta

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import apppath  # noqa: F401 `program/` を探索先へ（§9.404）
import app as flask_app                       # noqa: E402
from backend import access_mode               # noqa: E402
from backend.routes import logs as logs_mod   # noqa: E402

R = []


def rec(name, ok, detail=''):
    R.append(ok)
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + str(detail)) if detail else ''))


client = flask_app.app.test_client()
TMP = pathlib.Path(tempfile.mkdtemp(prefix='wavelog-logs-'))


def stamp(days_ago=0, hh='10:00:00'):
    d = datetime.now() - timedelta(days=days_ago)
    return d.strftime('%Y-%m-%d ') + hh


APP_LOG = f"""{stamp(0,'10:00:01')},100 INFO    [app] 一覧を開いた db=SIKALOTNOW
{stamp(0,'10:00:02')},200 ERROR   [app] 予期しないエラー
Traceback (most recent call last):
  File "app.py", line 1, in <module>
    raise ValueError('壊れた値')
ValueError: 壊れた値
{stamp(0,'10:00:03')},300 WARNING [app] 共有が遅い elapsed=9s
{stamp(9,'09:00:00')},000 INFO    [app] 9日前の記録
"""

LAUNCHER_LOG = f"""{stamp(0,'09:59:58')},000 INFO    [launcher] --- 起動 ---
{stamp(0,'09:59:59')},000 INFO    [launcher] プロセスID  : 1234
"""


def seed():
    (TMP / 'app.log').write_text(APP_LOG, encoding='utf-8')
    (TMP / 'launcher.log').write_text(LAUNCHER_LOG, encoding='utf-8')


def get(path):
    r = client.get(path)
    return r.status_code, r.get_json() or {}


def post(path, payload):
    r = client.post(path, json=payload)
    return r.status_code, r.get_json() or {}


def main():
    logs_mod.logs_dir = lambda: TMP        # 本物のログには触らない
    seed()

    # ---- 1. 折りたたみ（1行ではなく1件） ----
    st, d = get('/api/logs?files=app.log')
    recs = d.get('records') or []
    rec('現行のログを読める', st == 200 and bool(recs), f'{st} / {len(recs)}件')
    err = next((r for r in recs if r['level'] == 'error'), None)
    rec('日時で始まる行が1件になる（4件）', len(recs) == 4, [r['text'][:18] for r in recs])
    rec('トレースバックは直前の件へ畳まれる',
        bool(err) and len(err['extra']) == 4, len(err['extra']) if err else '(エラー無し)')
    rec('件は自分の物理行を全部持っている（消すときに使う）',
        bool(err) and len(err['lines']) == 5, len(err['lines']) if err else '')
    # 並びは日時順なので、9日前の1件が先頭へ来る（画面もこの順で受け取る）
    rec('レベルを読み取っている',
        [r['level'] for r in recs] == ['info', 'info', 'error', 'warning'],
        [r['level'] for r in recs])

    # ---- 2. 2系統を1本の時間軸へ ----
    st, d = get('/api/logs?files=app.log,launcher.log')
    recs = d.get('records') or []
    times = [r['ts'] for r in recs]
    rec('2系統を1本の時間軸に並べる（日時順・両方が混ざる）',
        times == sorted(times) and {r['source'] for r in recs} == {'app', 'launcher'},
        f"{len(recs)}件 / {sorted({r['source'] for r in recs})}")
    boot_at = next((i for i, r in enumerate(recs) if r.get('boot')), -1)
    rec('起動の直後にその起動の本体ログが続く',
        boot_at >= 0 and recs[boot_at + 1]['source'] == 'launcher'
        and recs[boot_at + 2]['source'] == 'app',
        [r['source'] for r in recs])
    rec('起動の区切りに印が付く（画面はここでまとめる）',
        any(r.get('boot') for r in recs), sum(1 for r in recs if r.get('boot')))

    # ---- 3. 絞り込み ----
    st, d = get('/api/logs?files=app.log&level=problem')
    rec('レベルで絞れる（警告とエラー）',
        [r['level'] for r in d.get('records') or []] == ['error', 'warning'],
        [r['level'] for r in d.get('records') or []])
    st, d = get('/api/logs?files=app.log&q=' + urllib.parse.quote('共有'))
    rec('文字で絞れる', len(d.get('records') or []) == 1, len(d.get('records') or []))
    st, d = get('/api/logs?files=app.log&q=ValueError')
    rec('畳んだ続きの行も検索の対象',
        len(d.get('records') or []) == 1, len(d.get('records') or []))
    st, d = get('/api/logs?files=app.log&days=3')
    rec('期間で絞れる（9日前の1件が落ちる）',
        len(d.get('records') or []) == 3, len(d.get('records') or []))
    st, d = get('/api/logs?files=app.log')
    rec('絞っていないときの件数を返す（何件中の何件かが分かる）',
        d.get('total') == 4 and d.get('matched') == 4, f"total={d.get('total')} matched={d.get('matched')}")

    # ---- 3b. 問題のまとめ（§9.510） ----
    # 同じ内容（数字だけ違う）は1つ・エラーが先・見本はトレースバックごと。
    extra = (f"{stamp(0,'10:00:04')},400 WARNING [app] 共有が遅い elapsed=12s\n"
             f"{stamp(0,'10:00:05')},500 WARNING [app] 共有が遅い elapsed=3s\n")
    (TMP / 'app.log').write_text(APP_LOG + extra, encoding='utf-8')
    st, d = get('/api/logs/problems')
    items = d.get('items') or []
    rec('問題のまとめを返す（件数と種類の数）',
        st == 200 and d.get('counts') == {'error': 1, 'warning': 3}
        and d.get('kinds') == {'error': 1, 'warning': 1},
        f"{d.get('counts')} / {d.get('kinds')}")
    rec('数字だけ違う文は同じ内容として1つにまとめる（×3）',
        len(items) == 2 and items[1]['count'] == 3, [(g['level'], g['count']) for g in items])
    rec('エラーが先に来る（警告の山に埋もれない）',
        bool(items) and items[0]['level'] == 'error', [g['level'] for g in items])
    rec('見本はトレースバックごと持つ（原因の行はそこにしか無い）',
        bool(items) and any('ValueError' in x for x in items[0]['lines']),
        items[0]['lines'][-1] if items else '')
    rec('絞り込みの語は数字の手前まで（起きるたびに違う数字で外れない）',
        len(items) == 2 and items[1]['query'] == '共有が遅い elapsed=', items[1]['query'] if len(items) == 2 else '')
    st, d2 = get('/api/logs?files=app.log&q=' + urllib.parse.quote(items[1]['query'] if len(items) == 2 else 'x'))
    rec('その語で一覧を絞るとまとめた件数と同じだけ出る',
        len(d2.get('records') or []) == 3, len(d2.get('records') or []))
    text = logs_mod.boot_report_text({'version': '9.9.9'}, [], [], True,
                                     logs_mod.problem_digest(logs_mod._current_records()))
    rec('報告の文章にもまとめが入る（件数×とトレースバック）',
        'エラー・警告のまとめ' in text and '×3' in text and 'ValueError: 壊れた値' in text,
        text.split('\n')[1:4] if text else '')

    # ---- 3c. 無いのがふつうの置き場は「要確認」にしない（§9.510） ----
    gone = TMP / 'no-such.html'
    p1 = logs_mod._place('次の起動用', gone, optional=True)
    p2 = logs_mod._place('写し', gone)
    rec('無いのがふつうの置き場は bad にしない（偽の警告を出さない）',
        p1['exists'] is False and p1['bad'] is False and p1['readable'] is None, p1)
    rec('無くてはならない置き場が無ければ bad',
        p2['exists'] is False and p2['bad'] is True, p2)
    empty = TMP / 'empty.html'
    empty.write_text('', encoding='utf-8')
    p3 = logs_mod._place('空の写し', empty)
    rec('在っても読めなければ bad（在る、で済ませない）',
        p3['exists'] is True and p3['readable'] is False and p3['bad'] is True, p3)
    t2 = logs_mod.boot_report_text({}, [p1, p2], [], True)
    rec('文章でも「無し（ふつう）」と「**無い**」を書き分ける',
        '[無し（ふつう）]' in t2 and '[**無い**]' in t2, t2.split('\n')[10:14])

    # ---- 4. 削除は件の単位（見出しだけ消えない） ----
    seed()
    st, d = get('/api/logs?files=app.log')
    err = next(r for r in d['records'] if r['level'] == 'error')
    st, d = post('/api/logs/delete-lines', {'file': 'app.log', 'lines': err['lines']})
    body = (TMP / 'app.log').read_text(encoding='utf-8')
    rec('選んだ件を消せる', st == 200 and d.get('removed') == 5, f"{st} / {d.get('removed')}")
    rec('トレースバックも一緒に消える（残骸を残さない）',
        'Traceback' not in body and 'ValueError' not in body, body[:60])
    rec('選んでいない件は残る', '一覧を開いた' in body and '共有が遅い' in body)

    seed()
    st, d = post('/api/logs/delete-old', {'file': 'app.log', 'days': 3})
    body = (TMP / 'app.log').read_text(encoding='utf-8')
    rec('指定期間より前を消せる', st == 200 and d.get('removed') == 1, f"{st} / {d.get('removed')}")
    rec('期間で消しても続きの行は取り残されない',
        'Traceback' in body and '9日前' not in body)

    # ---- 5. 置き場の外は断る ----
    for bad in ('../app.py', 'master.sqlite3', '/etc/passwd', 'app.log/../../x'):
        st, d = post('/api/logs/delete-lines', {'file': bad, 'lines': ['x']})
        rec(f'ログ置き場の外は断る（{bad}）', st == 400, st)

    # ---- 6. 区切り（rotate）は書き込み中のファイルだけ ----
    seed()
    st, d = post('/api/logs/rotate', {'file': 'app.log'})
    rec('誰も書いていないファイルは区切らない（理由を返す）',
        st == 400 and 'error' in d, f"{st} / {str(d)[:60]}")

    # 本番と同じ世代数。backupCount=0 だと doRollover は世代を作らず truncate も
    # しない（何も起きない）ので、ここを 0 にしないこと。
    handler = logging.handlers.RotatingFileHandler(TMP / 'app.log', backupCount=3, encoding='utf-8')
    logger = logging.getLogger('app')
    logger.addHandler(handler)
    try:
        st, d = post('/api/logs/rotate', {'file': 'app.log'})
        rec('書き込み中のログは区切れる', st == 200, f"{st} / {str(d)[:60]}")
        rec('1つ古い世代へ送られる', (TMP / 'app.log.1').exists())
        rec('新しいログは空から始まる', (TMP / 'app.log').read_text(encoding='utf-8') == '')
        st, d = get('/api/logs/files')
        names = [f['name'] for f in d.get('files') or []]
        rec('世代も一覧に出る', 'app.log.1' in names, names)
        # ハンドラを閉じたあとも書き続けられること(次のemitで開き直す)
        seed()
        st, _ = post('/api/logs/clear', {'file': 'app.log'})
        # 本物のログを汚さないよう、logger ではなくこのハンドラへ直接流す
        handler.emit(logging.LogRecord('app', logging.INFO, __file__, 1, '区切りの後の1行', None, None))
        handler.flush()
        after = (TMP / 'app.log').read_text(encoding='utf-8')
        rec('書き換えたあとも追記が続く（NULで埋まらない）',
            '区切りの後の1行' in after and '\x00' not in after, repr(after[:40]))
    finally:
        logger.removeHandler(handler)
        try:
            handler.close()
        except Exception:
            pass

    # ---- 7. 画面から呼ばれないAPIを作らない ----
    # `/api/logs/clear` を作ったのに画面へボタンを置き忘れ、**一度も動かない
    # 実装**になっていた(§9.96と同じ形。押すまで気づけない)。エンドポイントと
    # 画面の呼び出しを機械的に突き合わせる。
    src = (ROOT / 'backend' / 'routes' / 'logs.py').read_text(encoding='utf-8')
    view = (ROOT / 'static' / 'js' / 'core' / 'log-view.js').read_text(encoding='utf-8')
    routes = set(re.findall(r"@bp\.(?:get|post)\('([^']+)'\)", src))
    unused = sorted(r for r in routes if r not in view)
    rec('作ったAPIは画面から呼ばれている（一度も動かない実装を残さない）',
        not unused, ', '.join(unused))

    # ---- 8. 消す操作はeditモードだけ ----
    rec('消す・区切るはeditモードだけ（書込ガードに宣言してある）',
        access_mode._WRITE_ALLOWED_MODES.get('logs') == {'edit'},
        access_mode._WRITE_ALLOWED_MODES.get('logs'))

    shutil.rmtree(TMP, ignore_errors=True)
    print(f'\n== {sum(R)}/{len(R)} PASS ==')
    sys.exit(0 if all(R) else 1)


try:
    main()
finally:
    shutil.rmtree(TMP, ignore_errors=True)
