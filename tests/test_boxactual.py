#!/usr/bin/env python3
"""test_boxactual.py: 設備ごとの実績ファイルで突き合わせ、作業時間を登録して完了へ（§9.595）。

============================================================
利用者の指示
------------------------------------------------------------
「実績データを『\\\\Nlmsrvngy03\\Read\\【New】実績』に配置する。（このデータは過去1カ月までさかのぼった
 最新の実績であるが、順次更新され、1か月以上経つものは保持されないので、データを突き合せたらこちらで
 保持する機構を設けておく必要がある）
 実績_LS4.sqlite3といったような、『実績_＊＊＊.sqlite3』の＊＊＊が設備名となるファイルを検索設備名が
 一致するものを突合せ対象とし、『ﾛｯﾄ番号』、『鋳造番号』、『BOX番号』をキーとして突合せを行い、
 データを取得する。取得したデータの中から、『BOX実績_作業開始_日付』と『BOX実績_作業終了_日付』を
 使って作業時間を登録し、完了データへ移行する仕組みに変更したい。」
答え: BOX番号は仕掛にある／完了は「実績に当たったら」（仕掛に残っていても）／残すのは当たった行だけ
（裏で定期にも）／日付の列は時刻まで持つ。

ここで固定すること:
 1. ファイル名の型（`実績_{設備}.sqlite3`）の読み方・設備名の切り出し（全角・半角のゆれを吸収）
 2. **設備名が一致するファイルだけ**を突き合わせる（別の設備のファイルに同じロットがあっても当てない）
 3. 「実績に当たったら」の定義は**仕掛に残っていても完了**、開始・終了の時刻が作業時間になる
 4. 明細に無い突合キー（BOX番号）は**いまの仕掛の行**から補う
 5. 時刻が読めない・逆転しているときは作業時間にしない（時刻の入力を求める側へ倒す）
 6. 残す形（`[実績JSON]`）に開始・条件が入り、読み戻すと同じ答えになる
 7. 定義の保存は**送らなかった鍵を消さない**・完了突合でない行には効かない設定を残さない
 8. 一度きりの登録（データソース・定義）は何度呼んでも1件
 9. 写しの係・できることの判定・下見がフォルダを1つの表として開かない

**材料は一時の置き場に作り、本物の置き場へ書かない**（§9.504）。差し替えた設定は finally で戻す。
最後に**物差し**（実績のある予定のうち、時刻つきで完了になった数）を出す。
============================================================
"""
import json
import pathlib
import sqlite3
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend import db_access, db_mirror, actual_match, query_join, schedule_calc  # noqa: E402 パスを通してから読む
from backend import actual_keep, source_capability                               # noqa: E402 パスを通してから読む
from backend.repositories import master_repo                                     # noqa: E402 パスを通してから読む

R = []


def rec(name, ok, detail=''):
    R.append(ok)
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + detail) if detail else ''))


TMP = pathlib.Path(tempfile.mkdtemp(prefix='wl_boxact_'))
FOLDER = TMP / '実績'
FOLDER.mkdir()
WIP = TMP / 'wip.sqlite3'
WK, AK = 'T_WIP_BOX', 'T_ACT_BOX'
PATTERN = '実績_{設備}.sqlite3'
START, END = master_repo.BOX_ACTUAL_START_COLUMN, master_repo.BOX_ACTUAL_FINISH_COLUMN


def make_db(path, table, columns, rows):
    with sqlite3.connect(path) as c:
        c.execute(f'CREATE TABLE [{table}] (' + ','.join(f'[{x}] TEXT' for x in columns) + ')')
        c.executemany(f'INSERT INTO [{table}] VALUES (' + ','.join('?' * len(columns)) + ')', rows)


# 仕掛: L1・L2・L5 は残っている（L5 は明細に BOX番号 が無い予定のため）。
make_db(WIP, '仕掛', ['ロット番号', '鋳造番号', 'BOX番号'],
        [('L1', 'C1', 'B1'), ('L2', 'C2', 'B2'), ('L5', 'C5', 'B5')])
ACOLS = ['ﾛｯﾄ番号', '鋳造番号', 'BOX番号', START, END, 'BOX実績_重量']
# 設備名は全角で置く（型の読み方が NFKC で吸収すること）。
make_db(FOLDER / '実績_ＬＳ４.sqlite3', 'BOX実績', ACOLS, [
    ('L1', 'C1', 'B1', '2026/10/01 08:00:00', '2026/10/01 09:30:00', '512'),
    ('L3', 'C3', 'B3', '2026-10-02 10:00', '2026-10-02 11:15', '498'),
    ('L5', 'C5', 'B5', '2026/10/03 13:05:00', '2026/10/03 13:50:00', '505'),
    # 時刻が逆転（作業時間にしない）。
    ('L7', 'C7', 'B7', '2026/10/04 10:00:00', '2026/10/04 09:00:00', '500'),
])
# 別の設備のファイル。L2 は LS4 の予定にあるが、こちらにしか無い（当ててはいけない）。
make_db(FOLDER / '実績_LS5.sqlite3', 'BOX実績', ACOLS, [
    ('L2', 'C2', 'B2', '2026/10/01 08:00:00', '2026/10/01 08:30:00', '500')])
(FOLDER / 'メモ.txt').write_text('型に合わない', encoding='utf-8')
make_db(FOLDER / '実績_.sqlite3', 'BOX実績', ACOLS, [])    # 設備名が空（数えない）

DEF = {'id': -1, 'name': 'BOX実績突合（網）', 'purpose': '完了突合', 'left': WK, 'leftTable': '',
       'right': AK, 'rightTable': '',
       'keys': [{'left': l, 'right': r} for l, r in master_repo.BOX_ACTUAL_JOIN_KEYS],
       'columns': [], 'prefix': '', 'finishColumn': END, 'startColumn': START, 'finishWhen': 'hit'}

saved = {'defs': query_join.finish_definitions, 'work': actual_match.WORK_DB_KEY,
         'enabled': db_mirror.enabled}
db_access.DBS[WK] = {'path': WIP, 'label': '仕掛（網）', 'role': 'readonly', 'preferred': '仕掛',
                     'purpose': 'その他', 'listed': False, 'pattern': '', 'engine': 'sqlite'}
db_access.DBS[AK] = {'path': FOLDER, 'label': '実績（網）', 'role': 'readonly', 'preferred': '',
                     'purpose': 'その他', 'listed': False, 'pattern': PATTERN, 'engine': 'sqlite'}
query_join.finish_definitions = lambda: [dict(DEF)]
actual_match.WORK_DB_KEY = WK
# 写しは作らない（一時の置き場をそのまま読む。写しの係の作法は test_dbmirror が見る）。
db_mirror.enabled = lambda: False
actual_match.forget()


def plan(pid, lot, cast, box=None, state='予定'):
    detail = {'lotNo': lot, 'castingNo': cast}
    if box:
        detail['BOX番号'] = box
    return ({'id': pid, 'kind': '作業', 'parentId': None, 'state': state, 'actual': None,
             'lotNo': lot, 'castingNo': cast, 'inspectionNo': '', 'equipment': 'LS4'}, detail)


def run_plan(entry, detail, stored=None):
    schedule_calc._apply_actual_source(entry, detail, stored)
    entry['manual'] = schedule_calc.join_times(entry)
    return entry


try:
    # ---- 1. 型 ------------------------------------------------------------
    rec('型は {設備} を1つと DB の拡張子を持つものだけ（全角の括弧も読む）',
        db_access.normalize_file_pattern('実績_｛設備｝.sqlite3') == PATTERN
        and db_access.normalize_file_pattern('実績.sqlite3') == ''
        and db_access.normalize_file_pattern('実績_{設備}_{設備}.sqlite3') == ''
        and db_access.normalize_file_pattern('実績_{設備}.txt') == ''
        and db_access.normalize_file_pattern('sub/実績_{設備}.sqlite3') == '')
    rec('ファイル名から設備名を切り出す（大小・全角半角を吸収）',
        db_access.equipment_of_file(PATTERN, '実績_LS4.sqlite3') == 'LS4'
        and db_access.equipment_of_file(PATTERN, '実績_ＬＳ４.SQLITE3') == 'LS4'
        and db_access.equipment_of_file(PATTERN, '実績_.sqlite3') == ''
        and db_access.equipment_of_file(PATTERN, '仕掛_LS4.sqlite3') == '')
    files = db_access.pattern_files(AK)
    rec('フォルダの中の型に合うファイルだけ数える（設備ごとに1つ）',
        sorted(v[0] for v in files.values()) == ['LS4', 'LS5'], json.dumps(sorted(files), ensure_ascii=False))
    try:
        db_access.cfg(AK)
        rec('フォルダを1つの表として開かない（理由を言って断る）', False)
    except ValueError as e:
        rec('フォルダを1つの表として開かない（理由を言って断る）', '設備ごとのファイル' in str(e), str(e))
    try:
        db_access.cfg_for(AK, 'LS9')
        rec('設備のファイルが無ければ、見つかった設備まで言って断る', False)
    except db_access.NoEquipmentFile as e:
        rec('設備のファイルが無ければ、見つかった設備まで言って断る', 'LS4' in str(e) and 'LS5' in str(e), str(e))
    got = db_access.cfg_for(AK, 'ｌｓ４')
    rec('設備名で引くと、その設備の1ファイルを指す', got['path'].name == '実績_ＬＳ４.sqlite3', str(got['path']))
    tg = dict(db_mirror.targets())
    rec('写しの係は設備ごとに1つずつ写し、フォルダそのものは写さない',
        db_access.pattern_mirror_key(AK, 'LS4') in tg and db_access.pattern_mirror_key(AK, 'LS5') in tg
        and AK not in tg, json.dumps(sorted(k for k in tg if k.startswith(AK)), ensure_ascii=False))

    # ---- 2〜5. 突き合わせ -------------------------------------------------
    p1 = run_plan(*plan(1, 'L1', 'C1', 'B1'))
    rec('仕掛に残っていても、実績に当たれば完了（実績に当たったら）',
        p1['state'] == '完了' and p1['finishWhen'] == 'hit' and p1['missingFromWork'] is None,
        json.dumps({k: p1.get(k) for k in ('state', 'finishWhen', 'missingFromWork', 'doneReason')},
                   ensure_ascii=False))
    rec('開始・終了の時刻が作業時間になる（分にそろえ、出どころは実績データ）',
        (p1['manual'] or {}).get('startAt') == '2026-10-01T08:00'
        and (p1['manual'] or {}).get('endAt') == '2026-10-01T09:30'
        and (p1['manual'] or {}).get('endFrom') == schedule_calc.JOIN_TIMES_FROM,
        json.dumps(p1['manual'], ensure_ascii=False))
    rec('当たった行の値を持ち帰る（相手の全列）', (p1['actualSource'] or {}).get('BOX実績_重量') == '512')
    p2 = run_plan(*plan(2, 'L2', 'C2', 'B2'))
    rec('別の設備のファイルにだけあるロットには当てない（仕掛にあるので予定のまま）',
        p2['state'] == '予定' and p2['missingFromWork'] is False and not p2['actualSource'],
        json.dumps({k: p2.get(k) for k in ('state', 'missingFromWork', 'missingReason')}, ensure_ascii=False))
    p3 = run_plan(*plan(3, 'L3', 'C3', 'B3'))
    rec('仕掛から消えたロットも当たれば完了・時刻つき（書式の違う日時も読む）',
        p3['state'] == '完了' and (p3['manual'] or {}).get('startAt') == '2026-10-02T10:00'
        and (p3['manual'] or {}).get('endAt') == '2026-10-02T11:15', json.dumps(p3['manual'], ensure_ascii=False))
    p5 = run_plan(*plan(5, 'L5', 'C5'))
    rec('明細に BOX番号 が無ければ、いまの仕掛の行から補って当てる',
        p5['state'] == '完了' and (p5['manual'] or {}).get('endAt') == '2026-10-03T13:50',
        json.dumps({'state': p5['state'], 'reason': p5['missingReason']}, ensure_ascii=False))
    p7 = run_plan(*plan(7, 'L7', 'C7', 'B7'))
    rec('終わりが始まりより前の時刻は作業時間にしない（完了にはする）',
        p7['state'] == '完了' and p7['manual'] is None)
    p8 = run_plan(*plan(8, 'L8', 'C8', 'B8'))
    rec('仕掛から消えて実績にも無いロットは今までどおり（完了・時刻は人が入れる）',
        p8['state'] == '完了' and not p8['actualSource'] and p8['manual'] is None)
    done = run_plan(*plan(9, 'L1', 'C1', 'B1', state='取消'))
    rec('計画者が確定した取消は動かさない', done['state'] == '取消' and not done['actualSource'])

    # ---- 6. 残す形 ---------------------------------------------------------
    pay = actual_keep._payload(p1)
    back = schedule_calc.saved_actual_source(json.dumps(pay, ensure_ascii=False))
    rec('残す形に開始・完了・条件が入り、読み戻すと同じ',
        back['startedAt'] == p1['startedAt'] and back['finishedAt'] == p1['finishedAt']
        and back['finishWhen'] == 'hit' and back['values'].get('BOX実績_重量') == '512',
        json.dumps({k: pay.get(k) for k in ('startedAt', 'finishedAt', 'finishWhen', 'joinName')},
                   ensure_ascii=False))
    # 相手のファイルから消えたあとでも、残した写しで同じ答え（保持の値打ち）。
    query_join.finish_definitions = lambda: []
    kept = run_plan(*plan(1, 'L1', 'C1', 'B1'), stored=json.dumps(pay, ensure_ascii=False))
    query_join.finish_definitions = lambda: [dict(DEF)]
    rec('相手から消えても、残した写しで完了・時刻つきのまま',
        kept['state'] == '完了' and kept['actualSourceSaved'] and (kept['manual'] or {}).get('endAt') == '2026-10-01T09:30'
        and kept['doneReason'] == schedule_calc.DONE_BY_HIT, kept['doneReason'])
    rec('まだ残していない当たった行だけを残す対象にする',
        [e['id'] for e in actual_keep.pending({'entries': [p1, p2, p3, kept]})] == [1, 3])

    # ---- 7・8. 定義とデータソースの登録（一時のマスタ） ---------------------
    master = TMP / 'master.sqlite3'
    with db_access.connect(master, False) as c:
        jid = master_repo.query_join_save(c, dict(DEF, name='網の定義', enabled='有効'), 'tests')
        def row():
            return [d for d in master_repo.query_joins(c, include_disabled=True) if d['id'] == jid][0]
        one = row()
        rec('定義は開始日時列と完了の条件を保存する',
            one['startColumn'] == START and one['finishWhen'] == 'hit', json.dumps(one, ensure_ascii=False)[:200])
        body = {k: v for k, v in one.items() if k not in ('startColumn', 'finishWhen')}
        master_repo.query_join_save(c, dict(body, enabled='有効'), 'tests', jid=jid)
        rec('送らなかった開始日時列・完了の条件は消えない（古い画面の保存）',
            row()['startColumn'] == START and row()['finishWhen'] == 'hit')
        master_repo.query_join_save(c, dict(one, purpose='', enabled='有効'), 'tests', jid=jid)
        rec('完了突合でない行には開始日時列・条件を残さない',
            row()['startColumn'] == '' and row()['finishWhen'] == master_repo.QUERY_JOIN_FINISH_WHEN_DEFAULT)
        key = db_access.register_actual_folder(c)
        again = db_access.register_actual_folder(c)
        rows = [r for r in db_access.data_source_rows(c, include_disabled=True) if r.get('filePattern')]
        rec('実績の置き場は一度だけ登録（型・置き場・一覧に出さない）',
            key == again == db_access.ACTUAL_FOLDER_SOURCE_KEY and len(rows) == 1
            and rows[0]['filePattern'] == db_access.ACTUAL_FOLDER_PATTERN
            and rows[0]['share'] == db_access.ACTUAL_FOLDER_DEFAULT and not rows[0]['listed'],
            json.dumps(rows, ensure_ascii=False, default=str)[:240])
        made = master_repo.migrate_box_actual_join(c, 'SIKALOTNOW', key)
        twice = master_repo.migrate_box_actual_join(c, 'SIKALOTNOW', key)
        box = [d for d in master_repo.query_joins(c, include_disabled=True) if d['right'] == key]
        rec('BOX実績の完了突合は一度だけ（3つの鍵・開始と終了の列・実績に当たったら）',
            made and twice is None and len(box) == 1
            and [(k['left'], k['right']) for k in box[0]['keys']] == list(master_repo.BOX_ACTUAL_JOIN_KEYS)
            and box[0]['startColumn'] == START and box[0]['finishColumn'] == END
            and box[0]['finishWhen'] == 'hit', json.dumps(box, ensure_ascii=False)[:240])

    # ---- 9. 下見・できること ------------------------------------------------
    pr = query_join.probe_finish(dict(DEF))
    rec('下見は設備ごとのファイルを全部読み、開始・終了を読めた数を言う',
        pr['ok'] and sorted(f['equipment'] for f in pr['files']) == ['LS4', 'LS5']
        and pr['startReadable'] == 5 and pr['finishReadable'] == 5,
        json.dumps({k: pr.get(k) for k in ('files', 'matched', 'startReadable', 'finishReadable', 'note')},
                   ensure_ascii=False))
    rec('下見は作業時間の内訳（登録できる・逆転）と見本1件を言い、設備が違う同じ鍵を重なりと数えない',
        pr['timed'] == 4 and pr['inverted'] == 1 and pr['ambiguous'] == 0
        and (pr['sample'] or {}).get('minutes') == 90.0 and (pr['sample'] or {}).get('equipment') == 'LS4'
        and all('\0' not in k for ex in pr['examples'] for k in ex),
        json.dumps({k: pr.get(k) for k in ('timed', 'inverted', 'ambiguous', 'sample')}, ensure_ascii=False))
    cap = source_capability.describe({'key': AK, 'label': '網', 'filePattern': PATTERN, 'active': True},
                                     path=FOLDER)
    rec('できることの判定はフォルダを一覧するだけ（一覧には使えない・完了突合に使える）',
        cap['files'] == ['LS4', 'LS5'] and not cap['features']['list']['ok'] and cap['features']['finish']['ok'],
        json.dumps(cap, ensure_ascii=False)[:240])

    # ---- 物差し --------------------------------------------------------------
    with_actual = [p1, p3, p5, p7]
    timed = [p for p in with_actual if p['state'] == '完了' and p.get('manual')]
    wrong = [p for p in (p2,) if p['state'] == '完了']
    print(f'物差し: 実績のある予定 {len(with_actual)}件のうち時刻つきで完了 {len(timed)}件'
          f'（時刻が逆転して登録しない 1件）・別の設備へ取り違え {len(wrong)}件')
    rec('物差し: 時刻の読める3件は全部時刻つきで完了・取り違え0件', len(timed) == 3 and not wrong)
finally:
    query_join.finish_definitions = saved['defs']
    actual_match.WORK_DB_KEY = saved['work']
    db_mirror.enabled = saved['enabled']
    db_access.DBS.pop(WK, None)
    db_access.DBS.pop(AK, None)
    actual_match.forget()
    import shutil
    shutil.rmtree(TMP, ignore_errors=True)
    rec('一時の置き場を片付けた', not TMP.exists())

n_fail = R.count(False)
print(f'\n{len(R) - n_fail}/{len(R)} PASS')
sys.exit(1 if n_fail else 0)
