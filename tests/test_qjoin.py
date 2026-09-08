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
import shutil
import sqlite3
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import app as flask_app                                     # noqa: E402
from backend import db_access, query_join                   # noqa: E402

R = []


def rec(name, ok, detail=''):
    R.append((name, ok, detail))
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + detail) if detail else ''))


client = flask_app.app.test_client()
UID = 'test-qjoin'
NAME_PREFIX = 'テスト結合'
WORK = db_access.WORK_DB_KEY
QUALITY = db_access.QUALITY_DB_KEY


# 結合の仕方を確かめるための相手（この検証だけで作って消す）。
KIND_DIR = tempfile.mkdtemp(prefix='qjkind-')
KIND_DB = pathlib.Path(KIND_DIR) / 'qjkind.sqlite3'


def purge():
    """検証で作った行を**物理的に**消す。マスタDBはフィクスチャ差し替えの
    対象外で実行をまたいで生き延びるため（§9.121）、前後で必ず片付ける。
    **既定の結合の印も戻す**——解除したまま終わると、次の実行では品質の列が
    出ず、関係の無いテストが「列が消えた」で落ちる。"""
    try:
        conn = sqlite3.connect(db_access.DBS['MASTER']['path'])
        conn.execute("DELETE FROM [クエリ結合マスタ] WHERE [結合名] LIKE ?", (NAME_PREFIX + '%',))
        conn.execute("DELETE FROM [データソースマスタ] WHERE [キー] LIKE 'QJTEST%'")
        conn.execute("DELETE FROM [パス設定マスタ] WHERE [設定キー]=?",
                     (query_join.BUILTIN_QUALITY_SWITCH_KEY,))
        conn.commit()
        conn.close()
    except Exception:
        pass
    db_access.DBS.pop('QJKIND', None)
    shutil.rmtree(KIND_DIR, ignore_errors=True)


def post(path, body):
    r = client.post(path, json=body)
    return r.status_code, (r.get_json() or {})


def get(path):
    r = client.get(path)
    return r.status_code, (r.get_json() or {})


purge()
try:
    # ---- 1) 役割の汎用化 ----
    # 役割は§9.364で「実績」が増えて5つになった。**数ではなく顔ぶれを見る**
    # ——数だけを固定すると、増やしたときに「何が増えたか」を言えないまま
    # 数字を書き換えることになる。
    rec('役割は 仕掛／品質／実績／スケジュール／その他 の5つ',
        db_access.DATA_SOURCE_PURPOSES == ('仕掛', '品質', '実績', 'スケジュール', ''),
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

    # ---- 10) 結合の仕方（6通り）----
    # **行がどう増減するかを確かめる。** 相手として、①この一覧の表示中の行に
    # 当たるもの ②この一覧には居るが表示中のページには居ないもの ③この一覧に
    # 居ないもの、の3種類を用意する。②が要るのは、「相手にしかない行」を
    # **表示中のページだけで決めていないか**を見るため（ページで決めていると
    # ②が「相手にしかない行」として増えてしまう）。
    st, t = get(f'/api/table?db={WORK}&table=仕掛&page_size=200')
    all_rows = t.get('rows') or []
    all_cols = t.get('columns') or []
    lots = [r.get('ロット番号') for r in all_rows if r.get('ロット番号')]
    page_rows = all_rows[:5]
    page_lots = [r.get('ロット番号') for r in page_rows]
    far_lot = next((x for x in lots if x not in page_lots), None)
    pathlib.Path(KIND_DIR).mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(KIND_DB))
    conn.execute('CREATE TABLE [相手] ([ロット番号] TEXT, [等級] TEXT)')
    conn.executemany('INSERT INTO [相手] VALUES (?,?)',
                     [(page_lots[0], 'A'), (page_lots[1], 'B'), (page_lots[2], 'C'),
                      (far_lot, 'D'), ('QJZZZ1', 'E'), ('QJZZZ2', 'F')])
    conn.commit()
    conn.close()
    db_access.DBS['QJKIND'] = {'path': KIND_DB, 'role': 'readonly', 'label': '結合の仕方の検証',
                               'preferred': '相手', 'purpose': '', 'listed': False}

    def kind_case(kind):
        d = {'id': 0, 'name': NAME_PREFIX + 'K', 'left': WORK, 'leftTable': '仕掛',
             'right': 'QJKIND', 'rightTable': '相手', 'kind': kind,
             'keys': [{'left': 'ロット番号', 'right': 'ロット番号'}],
             'columns': [], 'prefix': 'K_', 'multi': 'first', 'active': True}
        cs, rows, infos = query_join.apply_joins(
            WORK, '仕掛', list(all_cols), [dict(x) for x in page_rows], [d])
        return cs, rows, (infos[0] if infos else {})

    rec('結合の仕方は6通り',
        [k['key'] for k in query_join.JOIN_KINDS]
        == ['left', 'inner', 'right', 'full', 'leftOnly', 'rightOnly']
        and query_join.JOIN_KIND_DEFAULT == 'left',
        '/'.join(k['key'] for k in query_join.JOIN_KINDS))
    rec('結合方法が未設定なら左外部（保存済みの行の見え方を変えない）',
        query_join.kind_of({})['key'] == 'left'
        and query_join.kind_of({'kind': 'しらない'})['key'] == 'left')

    cs, rows, info = kind_case('left')
    rec('左外部: この一覧の行はすべて残る',
        len(rows) == 5 and info.get('matched') == 3 and 'K_等級' in cs,
        f"{len(rows)}行 matched={info.get('matched')}")
    cs, rows, info = kind_case('inner')
    rec('内部: 当たった行だけになる',
        len(rows) == 3 and info.get('droppedRows') == 2,
        f"{len(rows)}行 dropped={info.get('droppedRows')}")
    cs, rows, info = kind_case('leftOnly')
    rec('この一覧にしかない行: 当たらなかった行だけ・相手の列は足さない',
        len(rows) == 2 and 'K_等級' not in cs and info.get('addedColumns') == 0,
        f"{len(rows)}行 列={[c for c in cs if c.startswith('K_')]}")
    cs, rows, info = kind_case('rightOnly')
    rec('相手にしかない行: この一覧の全体と突き合わせる（ページだけで決めない）',
        len(rows) == 2 and info.get('addedRows') == 2
        and sorted(r.get('ロット番号') for r in rows) == ['QJZZZ1', 'QJZZZ2'],
        f"{len(rows)}行 {[r.get('ロット番号') for r in rows]}")
    rec('相手にしかない行にも突合キーの値は入る（どの行か分かる）',
        all(r.get('K_等級') for r in rows) and all(r.get('ロット番号') for r in rows),
        json.dumps(rows[0] if rows else {}, ensure_ascii=False)[:100])
    cs, rows, info = kind_case('right')
    rec('右外部: 当たった行＋相手にしかない行',
        len(rows) == 5 and info.get('droppedRows') == 2 and info.get('addedRows') == 2,
        f"{len(rows)}行 dropped={info.get('droppedRows')} added={info.get('addedRows')}")
    cs, rows, info = kind_case('full')
    rec('完全外部: どちらかにあれば残る',
        len(rows) == 7 and info.get('droppedRows') == 0 and info.get('addedRows') == 2,
        f"{len(rows)}行")
    _cs, _rows, info = kind_case('inner')
    summary = query_join.summarize([info])
    rec('行が増減したことをまとめが伝える',
        summary.get('rowsChanged') is True and summary.get('droppedRows') == 2,
        json.dumps({k: summary.get(k) for k in ('rowsChanged', 'droppedRows', 'addedRows')},
                   ensure_ascii=False))

    # 保存・読み出しでも結合方法が残ること（既定は左外部のまま）。
    st, r = post('/api/query-join-master/update', {
        'user_id': UID, 'id': jid, 'name': NAME_PREFIX + 'A', 'left': WORK, 'right': QUALITY,
        'prefix': 'Q_', 'kind': 'inner',
        'keys': [{'left': 'ロット番号', 'right': 'ロット番号'}]})
    st, m = get('/api/query-join-master')
    saved = {x['id']: x for x in (m.get('items') or [])}.get(jid) or {}
    rec('結合方法が保存され、読み出せる', saved.get('kind') == 'inner', str(saved.get('kind')))
    rec('結合の仕方の一覧をサーバーが答える（画面で持たない）',
        len(m.get('kinds') or []) == 6 and m.get('kindDefault') == 'left',
        str(len(m.get('kinds') or [])))
    post('/api/query-join-master/update', {
        'user_id': UID, 'id': jid, 'name': NAME_PREFIX + 'A', 'left': WORK, 'right': QUALITY,
        'prefix': 'Q_', 'kind': 'left',
        'keys': [{'left': 'ロット番号', 'right': 'ロット番号'}]})

    # ---- 11) 既定の品質データ結合を解除できる ----
    st, r = post('/api/query-join-master/builtin', {'user_id': UID, 'enabled': False})
    rec('既定の結合を解除できる', st == 200 and r.get('enabled') is False, f"{st} {r.get('error','')}")
    rec('解除は即座に効く（再起動を待たせない）',
        query_join.builtin_quality_enabled() is False)
    st, t = get(f'/api/table?db={WORK}&table=仕掛&page_size=50&join_quality=1')
    rec('解除したら品質の列は出ない。**エラーにはしない**',
        st == 200 and len(t.get('rows') or []) > 0 and t.get('joinQuality') is None,
        f"{st} {len(t.get('rows') or [])}行 {t.get('joinQuality')}")
    defs = query_join.definitions_for(WORK, '仕掛', include_builtin=True)
    rec('解除中は既定を当てない', not any(d.get('builtin') for d in defs),
        '/'.join(str(d.get('name')) for d in defs))
    rec('解除しても既定の内容は見られる（真似できることが値打ち）',
        bool(query_join.builtin_quality_def()),
        json.dumps((query_join.builtin_quality_def() or {}).get('keys'), ensure_ascii=False))
    st, m = get('/api/query-join-master')
    rec('画面へも「解除中」と内容の両方を返す',
        m.get('builtinEnabled') is False and bool(m.get('builtin')),
        f"enabled={m.get('builtinEnabled')} builtin={bool(m.get('builtin'))}")
    st, r = post('/api/query-join-master/builtin', {'user_id': UID, 'enabled': True})
    rec('既定に戻せる',
        st == 200 and r.get('enabled') is True and query_join.builtin_quality_enabled() is True)

    # ---- 12) 突合キーを選ぶための見本 ----
    st, c = get(f'/api/table-columns?db={QUALITY}&samples=1')
    samples = c.get('samples') or {}
    rec('列の見本を返す（形が合うかを見て選べる）',
        st == 200 and len(samples) > 0
        and any(len(v) > 0 for v in samples.values())
        and all(len(v) <= 3 for v in samples.values()),
        json.dumps({k2: v for k2, v in list(samples.items())[:2]}, ensure_ascii=False)[:100])
    rec('名前のゆれを吸収した名前もサーバーが返す（規則を画面へ写さない）',
        isinstance(c.get('normalized'), dict) and len(c.get('normalized') or {}) == len(c.get('columns') or []),
        str(len(c.get('normalized') or {})))

    # ---- 13) 削除 ----
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
