#!/usr/bin/env python3
"""test_qjoin.py: データ接続のクエリ結合と、役割の汎用化（§9.193）。

============================================================
なぜ要るか
------------------------------------------------------------
① **読んだデータに使い道が無かった。** 一覧へ別のデータソースの列を足せる
   のは品質データだけで、突合キーも「ロット番号・鋳造番号・製造材質」の
   決め打ちだった。参照データは自由に増やせるのに、増やしたデータは
   「眺める」以外に使えなかった（利用者の指示: 読むだけで終わらせず、
   使うかどうか・どのデータとして使うかを選べるようにする）。

② **同じ処理を2つ持たない。** 品質データ結合は保存されない1件の定義として
   同じエンジン(backend/query_join.py)へ移した。別々に持つと、片方だけ
   直した状態が作れる（§9.163でキー文字列の直接比較が散って実際に壊れた形）。

③ **役割は各1件。** 仕掛／品質／スケジュールは1件ずつしか付けられない
   （2件あるとどちらを使うか決められない）。「作業」という旧い呼び名は
   「仕掛」へ寄せ、保存済みの行はそのまま読める。

ここで固定するのは、
 1. 結合マスタのCRUDと、壊れた定義を断ること
 2. 突合・接頭辞・取り込む列・複数一致の扱い（当てた結果そのもの）
 3. 相手が居ない／キーが無いときに**理由を返して素通しする**こと
 4. 既定の品質データ結合が、登録した結合に置き換わること
 5. 「一覧に出さない」データソースがカタログから消え、**結合の相手には
    なれる**こと
 6. 役割の一意制約と、旧い呼び名の読み替え
============================================================
"""
import json
import pathlib
import sqlite3
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import app as flask_app                                     # noqa: E402
from backend import db_access, query_join                   # noqa: E402
from backend.repositories import master_repo as mr          # noqa: E402

R = []


def rec(name, ok, detail=''):
    R.append((name, ok, detail))
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + detail) if detail else ''))


client = flask_app.app.test_client()
UID = 'test-qjoin'
NAME_PREFIX = 'テスト結合'
WORK = db_access.WORK_DB_KEY
QUALITY = db_access.QUALITY_DB_KEY


def purge():
    """検証で作った行を**物理的に**消す。マスタDBはフィクスチャ差し替えの
    対象外で実行をまたいで生き延びるため（§9.121）、前後で必ず片付ける。"""
    try:
        conn = sqlite3.connect(db_access.DBS['MASTER']['path'])
        conn.execute("DELETE FROM [クエリ結合マスタ] WHERE [結合名] LIKE ?", (NAME_PREFIX + '%',))
        conn.execute("DELETE FROM [データソースマスタ] WHERE [キー] LIKE 'QJTEST%'")
        conn.commit()
        conn.close()
    except Exception:
        pass


def post(path, body):
    r = client.post(path, json=body)
    return r.status_code, (r.get_json() or {})


def get(path):
    r = client.get(path)
    return r.status_code, (r.get_json() or {})


purge()
try:
    # ---- 1) 役割の汎用化 ----
    rec('役割は 仕掛／品質／スケジュール／その他 の4つ',
        db_access.DATA_SOURCE_PURPOSES == ('仕掛', '品質', 'スケジュール', ''),
        str(db_access.DATA_SOURCE_PURPOSES))
    rec('旧い呼び名「作業」は「仕掛」として読む',
        db_access.normalize_purpose('作業') == db_access.PURPOSE_WORK
        and db_access.normalize_purpose('品質') == db_access.PURPOSE_QUALITY
        and db_access.normalize_purpose('しらない') == db_access.PURPOSE_OTHER)
    st, cat = get('/api/catalog')
    rec('カタログが役割つきのキーを返す',
        cat.get('workKey') == WORK and cat.get('qualityKey') == QUALITY
        and 'scheduleKey' in cat,
        f"work={cat.get('workKey')} quality={cat.get('qualityKey')}")

    # 役割は各1件。既に「品質」が付いている状態で、別の行へ付けようとする。
    st, r = post('/api/data-source-master', {
        'user_id': UID, 'key': 'QJTEST1', 'label': 'テスト用の相手', 'purpose': '品質',
        'share': 'qjtest.sqlite3'})
    rec('役割が埋まっていれば、名前を添えて断る',
        st == 400 and QUALITY in (r.get('error') or ''), f"{st} {r.get('error')}")
    st, r = post('/api/data-source-master', {
        'user_id': UID, 'key': 'QJTEST1', 'label': 'テスト用の相手', 'purpose': 'その他',
        'share': 'qjtest.sqlite3', 'listed': False})
    rec('役割「その他」なら登録できる', st == 200 and r.get('ok'), f"{st} {r.get('error','')}")
    st, ds = get('/api/data-source-master')
    holders = ds.get('purposeHolders') or {}
    rec('どの役割がどこに付いているかをサーバーが答える',
        holders.get('仕掛') == WORK and holders.get('品質') == QUALITY,
        json.dumps(holders, ensure_ascii=False))
    added = {x['key']: x for x in ds.get('items', [])}.get('QJTEST1') or {}
    rec('「一覧に出さない」が保存される', added.get('listed') is False, str(added.get('listedText')))
    # **仕掛は隠せない**（隠すと測定・予定投入の入口が消える）。
    work_row = {x['key']: x for x in ds.get('items', [])}.get(WORK) or {}
    rec('役割「仕掛」は一覧から隠せない', work_row.get('listed') is True, str(work_row.get('listed')))

    # ---- 2) 結合マスタのCRUD ----
    st, r = post('/api/query-join-master', {'user_id': UID, 'name': NAME_PREFIX + 'A'})
    rec('足す先・相手が無い定義は断る', st == 400 and bool(r.get('error')), f"{st} {r.get('error')}")
    st, r = post('/api/query-join-master', {
        'user_id': UID, 'name': NAME_PREFIX + 'A', 'left': WORK, 'right': QUALITY, 'keys': []})
    rec('突合キーが無い定義は断る', st == 400 and 'キー' in (r.get('error') or ''), f"{st} {r.get('error')}")
    st, r = post('/api/query-join-master', {
        'user_id': UID, 'name': NAME_PREFIX + 'A', 'left': WORK, 'leftTable': '',
        'right': QUALITY, 'rightTable': '', 'prefix': 'Q_',
        'keys': [{'left': 'ロット番号', 'right': 'ロット番号'}]})
    jid = r.get('id')
    rec('結合を登録できる', st == 200 and bool(jid), f"{st} {r.get('error','')}")
    st, r = post('/api/query-join-master', {
        'user_id': UID, 'name': NAME_PREFIX + 'A', 'left': WORK, 'right': QUALITY,
        'keys': [{'left': 'ロット番号', 'right': 'ロット番号'}]})
    rec('同じ結合名は2つ作れない', st == 400 and '既に' in (r.get('error') or ''), f"{st} {r.get('error')}")

    # ---- 3) 当てた結果 ----
    st, t = get(f'/api/table?db={WORK}&table=仕掛&page_size=50&join=1')
    cols = t.get('columns') or []
    qcols = [c for c in cols if c.startswith('Q_')]
    rec('登録した結合が一覧に当たる', st == 200 and len(qcols) > 0, f'{len(qcols)}列 {qcols[:3]}')
    info = t.get('joinQuality') or {}
    rec('結合の名前・当たった件数を返す',
        info.get('applied') and info.get('matched', 0) > 0 and NAME_PREFIX + 'A' in (info.get('names') or []),
        json.dumps({k: info.get(k) for k in ('applied', 'matched', 'addedColumns', 'names')}, ensure_ascii=False))
    rec('突合キーそのものは足さない（左に同じ値がある）',
        'Q_ロット番号' not in qcols, str(qcols[:5]))
    row0 = (t.get('rows') or [{}])[0]
    rec('足した列の値が行に入る', any(row0.get(c) not in (None, '') for c in qcols),
        json.dumps({c: row0.get(c) for c in qcols[:3]}, ensure_ascii=False))
    rec('列名は1つずつ（同じ名前が2つ並ばない）', len(cols) == len(set(cols)), f'{len(cols)}列')

    # join=1 を付けない問い合わせには当たらない（内部の軽い問い合わせを重くしない）
    st, t2 = get(f'/api/table?db={WORK}&table=仕掛&page_size=50')
    rec('join=1 が無ければ結合しない',
        not [c for c in (t2.get('columns') or []) if c.startswith('Q_')]
        and t2.get('joinQuality') is None, str(t2.get('joinQuality')))

    # ---- 4) 取り込む列を絞る／複数一致 ----
    st, r = post('/api/query-join-master/update', {
        'user_id': UID, 'id': jid, 'name': NAME_PREFIX + 'A', 'left': WORK, 'right': QUALITY,
        'prefix': 'Q_', 'columns': ['検査結果'],
        'keys': [{'left': 'ロット番号', 'right': 'ロット番号'}]})
    rec('取り込む列を絞れる（更新）', st == 200, f"{st} {r.get('error','')}")
    st, t = get(f'/api/table?db={WORK}&table=仕掛&page_size=50&join=1')
    qcols = [c for c in (t.get('columns') or []) if c.startswith('Q_')]
    rec('絞った列だけが足される', qcols == ['Q_検査結果'], str(qcols))

    # ---- 5) 相手が居ない・キーが無いときは理由を返して素通し ----
    st, r = post('/api/query-join-master/update', {
        'user_id': UID, 'id': jid, 'name': NAME_PREFIX + 'A', 'left': WORK, 'right': 'NOSUCHDB',
        'keys': [{'left': 'ロット番号', 'right': 'ロット番号'}]})
    st, t = get(f'/api/table?db={WORK}&table=仕掛&page_size=50&join=1')
    info = t.get('joinQuality') or {}
    rec('相手が居なくても一覧は出る（fail-open）', st == 200 and len(t.get('rows') or []) > 0,
        f"{len(t.get('rows') or [])}行")
    rec('結合できなかった理由を文章で返す',
        not info.get('applied') and 'NOSUCHDB' in (info.get('reason') or ''),
        (info.get('reason') or '')[:80])
    st, r = post('/api/query-join-master/update', {
        'user_id': UID, 'id': jid, 'name': NAME_PREFIX + 'A', 'left': WORK, 'right': QUALITY,
        'keys': [{'left': 'そんな列は無い', 'right': 'ロット番号'}]})
    st, t = get(f'/api/table?db={WORK}&table=仕掛&page_size=50&join=1')
    info = t.get('joinQuality') or {}
    rec('この一覧に無いキーを指したら、その列名を言う',
        'そんな列は無い' in (info.get('reason') or ''), (info.get('reason') or '')[:80])

    # ---- 6) 既定の品質データ結合 ----
    b = query_join.builtin_quality_def()
    rec('既定の品質データ結合は保存されない定義として名乗る',
        bool(b) and b.get('builtin') and b['left'] == WORK and b['right'] == QUALITY,
        json.dumps({'left': b.get('left'), 'right': b.get('right')} if b else {}, ensure_ascii=False))
    st, t = get(f'/api/table?db={WORK}&table=仕掛&page_size=50&join_quality=1')
    info = t.get('joinQuality') or {}
    rec('join_quality=1 は今までどおり効く',
        info.get('applied') and info.get('matched', 0) > 0, json.dumps(
            {k: info.get(k) for k in ('applied', 'matched', 'addedColumns')}, ensure_ascii=False))
    # 同じ相手への結合を登録してあるときは、既定を当てない（同じ列を2回引かない）。
    post('/api/query-join-master/update', {
        'user_id': UID, 'id': jid, 'name': NAME_PREFIX + 'A', 'left': WORK, 'right': QUALITY,
        'prefix': 'Q_', 'keys': [{'left': 'ロット番号', 'right': 'ロット番号'}]})
    defs = query_join.definitions_for(WORK, '仕掛', include_builtin=True)
    rec('同じ相手への結合を登録したら、既定は当てない',
        not any(d.get('builtin') for d in defs) and len(defs) == 1,
        '/'.join(str(d.get('name')) for d in defs))

    # ---- 7) 下見（保存する前に確かめる） ----
    st, r = post('/api/query-join-master/probe', {
        'left': WORK, 'right': QUALITY, 'prefix': 'Q_',
        'keys': [{'left': 'ロット番号', 'right': 'ロット番号'}]})
    p = r.get('result') or {}
    rec('保存する前に当ててみられる', st == 200 and p.get('ok') and p.get('matched', 0) > 0,
        f"{p.get('matched')}/{p.get('sampled')}")
    rec('下見は実例を3件まで返す（1件では「たまたま」と区別が付かない）',
        1 <= len(p.get('examples') or []) <= 3, str(len(p.get('examples') or [])))
    st, r = post('/api/query-join-master/probe', {'left': WORK, 'right': QUALITY, 'keys': []})
    rec('キーが無いときは「まだ確かめられない」と言う（例外にしない）',
        st == 200 and (r.get('result') or {}).get('ok') is False,
        ((r.get('result') or {}).get('reason') or '')[:60])

    # ---- 8) スケジュール表向けの引き当て ----
    st, k = get(f'/api/query-join/keys?db={WORK}')
    rec('突合に要る列名だけを先に答える',
        st == 200 and k.get('keys') == ['ロット番号'], json.dumps(k.get('keys'), ensure_ascii=False))
    lot = (t.get('rows') or [{}])[0].get('ロット番号')
    st, res = post('/api/query-join/resolve', {'db': WORK, 'rows': [{'ロット番号': lot}, {}]})
    rec('鍵の値だけ渡せば、足す列の値が返る',
        st == 200 and res.get('columns') and res['values'][0].get('Q_検査結果') is not None,
        json.dumps(res.get('values'), ensure_ascii=False)[:120])
    rec('鍵が空の行は空で返る（行数は崩さない）',
        len(res.get('values') or []) == 2 and res['values'][1] == {},
        str(len(res.get('values') or [])))

    # ---- 9) 列名だけを引く ----
    st, c = get(f'/api/table-columns?db={QUALITY}')
    rec('列の名前だけを引ける（行は運ばない）',
        st == 200 and len(c.get('columns') or []) > 0 and 'rows' not in c,
        f"{c.get('table')} {len(c.get('columns') or [])}列")

    # ---- 10) 削除 ----
    st, r = post('/api/query-join-master/delete', {'user_id': UID, 'id': jid})
    rec('削除できる', st == 200 and r.get('deleted') == 1, str(r.get('deleted')))
    st, t = get(f'/api/table?db={WORK}&table=仕掛&page_size=50&join=1')
    rec('削除したら列も消える',
        not [c for c in (t.get('columns') or []) if c.startswith('Q_')], '')
finally:
    purge()

print('\n=== SUMMARY ===')
ng = [x for x in R if not x[1]]
print('%d/%d passed' % (len(R) - len(ng), len(R)))
raise SystemExit(1 if ng else 0)
