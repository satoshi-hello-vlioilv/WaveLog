#!/usr/bin/env python3
"""test_eqstd.py: 設備ごとの「1ロットあたり標準時間」（§9.114）。

============================================================
なぜ要るか
------------------------------------------------------------
スケジュールの見積は実績から作る換算係数モデル（backend/load_factor.py）が
出す。だが**実績が1件も無い立ち上げ時**はモデルが組めず、全設備一律の
暫定既定値（120分）になっていた。設備によって1ロットの所要はまるで違うので、
そのままでは最初のスケジュールが使い物にならない。

そこで設備マスタへ「1ロットあたり標準時間（分）」を持たせ、**実績が無い
ときだけ**それを使う。実績がたまればモデルが優先される（この値は初期の
保険であって、実績を上書きするものではない）。

ここで固定するのは5つ。
 1. 保存できる（登録・編集・空欄に戻す）
 2. 空欄は「未設定」であって0分ではない（0・負・文字は未設定として扱う）
 3. **実績が無いときの見積がその値になる**（source='equipment-standard'）
 4. 未設定なら従来どおりの暫定既定値（source='default'）
 5. **実績があるときはモデルが優先**される（標準時間で上書きされない）
============================================================
"""
import pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import app as flask_app                                   # noqa: E402
from backend import db_access, load_factor, schedule_calc  # noqa: E402
from backend.repositories import master_repo as mr         # noqa: E402

R = []
def rec(name, ok, detail=''):
    R.append((name, ok, detail))
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + detail) if detail else ''))

client = flask_app.app.test_client()
# **実行ごとに一意にする**（tests/README.md）。設備の削除は論理削除なので、
# 同じ名前で登録し直すと「過去に削除された設備と同じ名前です」で409になり、
# 2回目以降の実行が最初の1件目から落ちる（実際に落ちた）。
PREFIX = '標準時間テスト設備'
NAME = PREFIX + str(int(__import__('time').time() * 1000))[-7:]


def cleanup():
    """作った設備は必ず消す（残すと後続の俯瞰ボード・設備リストの件数が変わる）。"""
    try:
        r = client.get('/api/equipment-master').get_json() or {}
        for it in (r.get('items') or []):
            if str(it.get('name') or '').startswith(PREFIX):
                client.post('/api/equipment-master/delete',
                            json={'id': it['id'], 'force': True, 'user_id': 'tests'})
    except Exception as e:
        print('  [cleanup]', e)


def main():
    try:
        cleanup()

        # ---- 1) 正規化: 空欄・0・負・文字は「未設定」 ----
        cases = [('', None), (None, None), ('0', None), ('-5', None), ('あ', None),
                 ('30', 30.0), ('45.5', 45.5), (90, 90.0)]
        bad = [f'{v!r}→{mr.normalize_standard_minutes(v)}(期待{w})'
               for v, w in cases if mr.normalize_standard_minutes(v) != w]
        rec('空欄・0・負・文字は未設定として扱う', not bad, ' / '.join(bad))
        # 上限で頭打ち（丸1日を超える入力は打ち間違い）。
        rec('現実的でない大きさは上限で止める',
            mr.normalize_standard_minutes('99999') == mr.STANDARD_MINUTES_MAX,
            str(mr.normalize_standard_minutes('99999')))

        # ---- 2) 登録・取得・編集・空欄へ戻す ----
        r = client.post('/api/equipment-master',
                        json={'name': NAME, 'standardMinutes': 45, 'user_id': 'tests'}).get_json() or {}
        rec('標準時間を付けて設備を登録できる', bool(r.get('ok')), str(r)[:120])

        def find():
            items = (client.get('/api/equipment-master').get_json() or {}).get('items') or []
            return next((x for x in items if x.get('name') == NAME), None)

        it = find()
        rec('登録した標準時間が一覧に返る', bool(it) and it.get('standardMinutes') == 45.0,
            str(it and it.get('standardMinutes')))

        client.post('/api/equipment-master/update',
                    json={'id': it['id'], 'name': NAME, 'standardMinutes': 75, 'user_id': 'tests'})
        it = find()
        rec('編集で標準時間を変えられる', bool(it) and it.get('standardMinutes') == 75.0,
            str(it and it.get('standardMinutes')))

        client.post('/api/equipment-master/update',
                    json={'id': it['id'], 'name': NAME, 'standardMinutes': '', 'user_id': 'tests'})
        it = find()
        rec('空欄に戻すと未設定になる（0分にならない）',
            bool(it) and it.get('standardMinutes') == '', repr(it and it.get('standardMinutes')))

        # ---- 3) 実績が無いときの見積 ----
        # **モデルが組めない状態を作る。** 実データに実績があるかどうかは
        # 環境次第なので、get_model を差し替えて「無い」を確実に作る。
        # (差し替えないと、実績のある環境では 5) と同じ経路しか通らず、
        #  この検証が何も確かめないまま通ってしまう。)
        orig_get_model = load_factor.get_model
        conn = None
        try:
            from backend.repositories import schedule_repo as sr
            sr.migrate_config_masters_from_shared()
            conn = sr.config_master_conn()

            client.post('/api/equipment-master/update',
                        json={'id': it['id'], 'name': NAME, 'standardMinutes': 33, 'user_id': 'tests'})

            load_factor.get_model = lambda *a, **k: None
            got = load_factor.estimate_work(conn, NAME, {})
            rec('実績が無ければ設備の標準時間を使う',
                got.get('minutes') == 33.0 and got.get('basis') == 'equipment-standard',
                f"{got.get('minutes')}分 / {got.get('basis')}")

            # 予定の見積解決まで通す（source が画面へそのまま出る）。
            est = schedule_calc.resolve_estimate(
                conn, NAME, {'kind': '作業', 'title': 'L0001', 'estimateMinutes': None, 'detail': {}})
            rec('予定の見積の出どころが equipment-standard になる',
                est.get('minutes') == 33.0 and est.get('source') == 'equipment-standard',
                f"{est.get('minutes')}分 / {est.get('source')}")

            # ---- 4) 未設定なら従来どおりの暫定既定値 ----
            client.post('/api/equipment-master/update',
                        json={'id': it['id'], 'name': NAME, 'standardMinutes': '', 'user_id': 'tests'})
            got = load_factor.estimate_work(conn, NAME, {})
            rec('標準時間が未設定なら暫定既定値のまま',
                got.get('minutes') == load_factor.DEFAULT_ESTIMATE_MINUTES
                and got.get('basis') == 'default',
                f"{got.get('minutes')}分 / {got.get('basis')}")

            # ---- 5) 優先順位（ここが設計の要点） ----
            #   ① その設備自身の実績モデル(equipment)
            #   ② 設備マスタの標準時間(equipment-standard)
            #   ③ 全設備をまとめたモデル(pooled)
            #   ④ 全体の暫定既定値(default)
            client.post('/api/equipment-master/update',
                        json={'id': it['id'], 'name': NAME, 'standardMinutes': 33, 'user_id': 'tests'})

            def model(basis, t0):
                return {'T0': t0, 'factors': {}, 'counts': {}, 'boundaries': {},
                        'sigmaLog': 0.0, 'basis': basis, 'n': 25, 'equipment': NAME}

            # ①>② その設備自身の実績が溜まったら、標準時間では上書きしない
            # （上書きすると、実績が集まっても精度が上がらない）。
            load_factor.get_model = lambda *a, **k: model('equipment', 200.0)
            got = load_factor.estimate_work(conn, NAME, {})
            rec('その設備自身の実績モデルは標準時間より優先される',
                got.get('minutes') == 200.0 and got.get('basis') == 'equipment',
                f"{got.get('minutes')}分 / {got.get('basis')}")

            # ②>③ **他の設備まで混ぜた統計(pooled)より標準時間を先にする。**
            # pooledは設備ごとの差をならした値で、1ロットの所要が設備で
            # まるで違うからこそ「設備単位で持たせたい」という要望だった。
            # ここを逆にすると、他設備の実績がある現場ではこの設定が
            # 一度も効かない（＝機能として死ぬ）。
            load_factor.get_model = lambda *a, **k: model('pooled', 500.0)
            got = load_factor.estimate_work(conn, NAME, {})
            rec('全設備をまとめたモデルより設備の標準時間が優先される',
                got.get('minutes') == 33.0 and got.get('basis') == 'equipment-standard',
                f"{got.get('minutes')}分 / {got.get('basis')}")

            # ③>④ 標準時間が未設定なら、pooledはそのまま使う（無い値の
            # ために実績を捨てない）。
            client.post('/api/equipment-master/update',
                        json={'id': it['id'], 'name': NAME, 'standardMinutes': '', 'user_id': 'tests'})
            got = load_factor.estimate_work(conn, NAME, {})
            rec('標準時間が未設定ならまとめたモデルをそのまま使う',
                got.get('minutes') == 500.0 and got.get('basis') == 'pooled',
                f"{got.get('minutes')}分 / {got.get('basis')}")
        finally:
            load_factor.get_model = orig_get_model
            if conn is not None:
                conn.close()

        # ---- 6) 列が無い古いDBでも落ちない ----
        # 他マスタと同じ互換ポリシー。読めなければ「未設定」で済ませる。
        with db_access.connect(db_access.DBS['MASTER']['path'], False) as c:
            rec('知らない設備名を引いてもNoneで済む',
                mr.read_equipment_standard_minutes(c, '存在しない設備XYZ') is None)
            rec('設備名が空でもNoneで済む',
                mr.read_equipment_standard_minutes(c, '') is None)
    finally:
        cleanup()

    ng = [x for x in R if not x[1]]
    print(f'\n== {len(R) - len(ng)}/{len(R)} PASS ==')
    sys.exit(1 if ng else 0)


main()
