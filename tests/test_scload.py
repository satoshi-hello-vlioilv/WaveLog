#!/usr/bin/env python3
"""test_scload.py: 読み込みを速くした4点と、起点の5分刻み（§9.198）。

============================================================
なぜ要るか
------------------------------------------------------------
利用者の指摘は「スケジュール表の読み込みに時間がかかる。自前サーバーの
影響か、クエリ結合の影響か」。調べると原因は4つで、いちばん効いていたのは
**クエリ結合が写しではなく共有フォルダのファイルを直接読んでいた**こと
だった。どれも**速さそのものは環境で変わる**ので、ここで固定するのは
時間ではなく**形**（何を読むか・何回読むか）。

 1. 相手のデータは`cfg()`（＝写し）から読む。`DBS`を直に見ない
 2. 相手の行は`SELECT *`にしない（要る列だけ）
 3. 実績の索引は材料が同じなら作り直さない
 4. 見積のマスタ引きは1回の展開で1回だけ
 5. 予定の起点は5分刻みへ**切り上げ**、着手中があるときは丸めない
 6. 書込役(§9.192)がoffのときは名前解決へ行かない
============================================================
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from datetime import datetime, timedelta                    # noqa: E402

from backend import db_access, load_factor, query_join, schedule_calc, schedule_owner  # noqa: E402

R = []


def rec(name, ok, detail=''):
    R.append((name, ok, detail))
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + detail) if detail else ''))


# ---- 1) 相手は cfg()（＝写し）から読む -------------------------------
# `cfg()`を差し替えて「そちらが返したパスで開くか」を見る。**DBSを直に
# 見ていると差し替えが効かない**ので、この網はそのときだけ落ちる。
work = db_access.WORK_DB_KEY
qual = db_access.QUALITY_DB_KEY
opened = []
SQL = []
real_connect = query_join.connect


def _spy_connect(path, ro=True, *a, **kw):
    """開いた先とSQLを記録する。**接続オブジェクトを包まないこと**——
    `db_access.tables()`は`isinstance(c, sqlite3.Connection)`で分岐するので、
    包むとpyodbc用の枝へ落ちて`'Cursor' object has no attribute 'tables'`で
    黙って失敗する（実際にそうなった）。sqlite3のトレースを使う。"""
    opened.append(str(path))
    c = real_connect(path, ro, *a, **kw)
    try:
        c.set_trace_callback(SQL.append)
    except Exception:
        pass
    return c


MIRROR = str(ROOT / 'db' / 'test_fixture' / 'sikalotdef_test.sqlite3')
real_cfg = query_join.cfg


def _spy_cfg(k):
    out = dict(real_cfg(k))
    if k == qual:
        out['path'] = pathlib.Path(MIRROR)      # 「写しはここ」と答える
        out['mirrored'] = True
    return out


query_join.connect = _spy_connect
query_join.cfg = _spy_cfg
try:
    d = query_join.builtin_quality_def()
    if d:
        base = db_access.cfg(work)
        with real_connect(base['path'], True) as c:
            cur = c.cursor()
            cur.execute('SELECT * FROM [仕掛] LIMIT 20')
            cols = [x[0] for x in cur.description]
            rows = [dict(zip(cols, r)) for r in cur.fetchall()]
        SQL.clear()
        opened.clear()
        query_join.apply_joins(work, '仕掛', cols, rows, [d])
        rec('相手は cfg() が答えたパス（＝写し）から読む',
            any(MIRROR in p for p in opened), '/'.join(opened)[:160])
        rights = [s for s in SQL if ' FROM ' in s and 'IN (' in s]
        rec('相手の行は SELECT * にしない（要る列だけ読む）',
            bool(rights) and all(not s.startswith('SELECT *') for s in rights),
            (rights[0][:90] if rights else 'キーで絞る問い合わせが無い'))
    else:
        rec('相手は cfg() が答えたパス（＝写し）から読む', False, '既定の品質データ結合が作れない')
        rec('相手の行は SELECT * にしない（要る列だけ読む）', False, '同上')
finally:
    query_join.connect = real_connect
    query_join.cfg = real_cfg

# ---- 3) 実績の索引は材料が同じなら作り直さない ------------------------
rows = [{'id': 'x1', 'payload': '{"basic":{"lotNo":"L1","castingNo":"C1","mfgMaterial":"A"}}',
         'updated_at': '2026-01-01T00:00:00'}]
i1 = schedule_calc.build_actual_index(rows)
i2 = schedule_calc.build_actual_index(rows)
rec('同じ材料なら索引を作り直さない', i1 is i2)
i3 = schedule_calc.build_actual_index(list(rows))
rec('材料が別なら作り直す', i3 is not i1)

# ---- 4) 見積のマスタ引きは1回の展開で1回だけ --------------------------
calls = {'std': 0, 'ovr': 0}
real_std = load_factor.read_equipment_standard_minutes
real_ovr = load_factor.resolve_overrides
load_factor.read_equipment_standard_minutes = lambda c, e: (calls.__setitem__('std', calls['std'] + 1),
                                                            real_std(c, e))[1]
load_factor.resolve_overrides = lambda c, e: (calls.__setitem__('ovr', calls['ovr'] + 1),
                                              real_ovr(c, e))[1]
try:
    from backend.repositories import schedule_repo as sr
    mc = sr.config_master_conn()
    try:
        sr.ensure_config_master_tables(mc)
        memo = {}
        for _ in range(5):
            load_factor.estimate_work(mc, 'テスト設備A', {'lotNo': 'L1'}, memo=memo)
        rec('控えを渡せば設備マスタは1回しか引かない', calls['std'] <= 1, str(calls['std']))
        calls['std'] = 0
        for _ in range(3):
            load_factor.estimate_work(mc, 'テスト設備A', {'lotNo': 'L1'})
        rec('控えを渡さなければ今までどおり毎回引く', calls['std'] == 3, str(calls['std']))
    finally:
        mc.close()
finally:
    load_factor.read_equipment_standard_minutes = real_std
    load_factor.resolve_overrides = real_ovr

# ---- 5) 起点は5分刻みへ切り上げ ---------------------------------------
base = datetime(2026, 8, 19, 10, 0, 0)
cases = [('10:23:11', '10:25'), ('10:25:00', '10:25'), ('10:25:30', '10:30'),
         ('10:00:00', '10:00'), ('10:56:00', '11:00')]
ok = True
detail = []
for src, want in cases:
    h, m, s = (int(x) for x in src.split(':'))
    got = schedule_calc._round_up(base.replace(hour=h, minute=m, second=s), 5)
    detail.append(f'{src}->{got.strftime("%H:%M")}')
    ok = ok and got.strftime('%H:%M') == want
rec('起点は5分刻みへ切り上げる（切り下げない）', ok, ' / '.join(detail))
rec('刻みが0なら何もしない',
    schedule_calc._round_up(base.replace(minute=23), 0).minute == 23)

# 展開まで通して確かめる。**予定が1本も無い状態で見る**——着手中の作業が
# あるときは実績の開始時刻をそのまま起点にする（丸めない）ので、行が
# 混ざると「丸めたのか、着手中だから丸めなかったのか」が分からなくなる。
try:
    from backend import schedule_sync
    from backend.db_access import connect as _conn
    local, _stale = schedule_sync.fetch_snapshot()
    c = _conn(local, False, 'sqlite')
    mc2 = sr.config_master_conn()
    try:
        sr.ensure_config_master_tables(mc2)
        hit = None
        for hh in range(0, 24):                      # 稼働帯に当たる時刻を探す
            now = datetime(2026, 8, 19, hh, 23, 41)
            out = schedule_calc._expand_plan_with(c, mc2, 'テスト設備A', now, [],
                                                  history_hours=None, include_unplanned=False)
            if out.get('anchorRounded'):
                hit = out
                break
        if hit:
            a = hit['anchorRounded']
            got = datetime.fromisoformat(hit['anchor'])
            rec('展開まで通しても起点が5分刻みになる',
                got.minute % 5 == 0 and got.second == 0 and a['unitMinutes'] == 5,
                json.dumps({'anchor': hit['anchor'], 'rounded': a}, ensure_ascii=False))
            rec('丸める前の時刻も返す（黙って動かさない）',
                datetime.fromisoformat(a['from']) < got, json.dumps(a, ensure_ascii=False))
        else:
            rec('展開まで通しても起点が5分刻みになる', False, '稼働帯に当たる時刻が見つからない')
            rec('丸める前の時刻も返す（黙って動かさない）', False, '同上')
    finally:
        mc2.close()
        c.close()
except Exception as e:                               # 共有が未設定の環境では飛ばさない
    rec('展開まで通しても起点が5分刻みになる', False, f'確かめられなかった: {e}')
    rec('丸める前の時刻も返す（黙って動かさない）', False, f'確かめられなかった: {e}')

# ---- 6) 書込役がoffのときは名前解決へ行かない -------------------------
hit = {'n': 0}
real_urls = schedule_owner.local_urls
schedule_owner.local_urls = lambda: (hit.__setitem__('n', hit['n'] + 1), real_urls())[1]
real_enabled = schedule_owner.enabled
try:
    schedule_owner.enabled = lambda: False
    st = schedule_owner.status()
    rec('書込役がoffなら名前解決しない', hit['n'] == 0 and st['myUrls'] == [], str(hit['n']))
    schedule_owner.enabled = lambda: True
    schedule_owner.status()
    rec('onなら今までどおり自分のURLを出す', hit['n'] == 1, str(hit['n']))
finally:
    schedule_owner.local_urls = real_urls
    schedule_owner.enabled = real_enabled

print('\n=== SUMMARY ===')
ng = [x for x in R if not x[1]]
print('%d/%d passed' % (len(R) - len(ng), len(R)))
for n, _o, d in ng:
    print(' -', n, d)
raise SystemExit(1 if ng else 0)
