# -*- coding: utf-8 -*-
"""ロールマスタ(§9.239 ⑥): 設備ごとに持つロールの諸元。

利用者の指示:

  「モーダルにタブを追加し、欠陥を発見した際にピッチがある場合、ピッチを
   入力し、当設備の対象ロールを判定する機能を実装したいです。ロールマスタが
   必要になるので、ロールマスタは『設備／入出位置／接触面／ロール径MAX／
   ロール径MIN／ロール面長／材質／硬度／本数／ロール名／ロール使用条件／
   駆動方式／基準番号／備考』という種類だけカラムを持つものとする。
   設備のカラムはマスタに親子関係を持たせ、設備単位でロールマスタを持つ
   形とする。使うデータはこのカラムのうちロール径MAXを主とし、
   ロール径MINもデータがあるものはそれも計算に用いる。」

■ 「設備の親子関係」の持ち方
`[設備名]` は**設備停止マスタと同じ書式**（`'A'` / `'A,B,C'` / `'*'`）で、
判定は `schedule_repo.stop_equipment_*` の1箇所を借りる（§CLAUDE
「判定は1箇所」。新しい照合を書き起こさない）。画面では設備を親、
ロールを子として**設備ごとに束ねて**出す（`groupBy`）——マスタを2つに
割らずに階層を作れるので、`[設備名]` を1つ直せば所属が変わる。

■ 判定に使うのは径
欠陥が長手方向に一定のピッチで出るとき、そのピッチは**そのロールの周長**
（＝π×径）に一致する。径は摩耗で減るので、MAXとMINがあれば周長は
**範囲**になる。MINが空なら「MAXの1点」——**0で埋めないこと**
（§9.114／§9.231「引けなかったら None。0にすると何を打っても弾かれる欄に
なる」）。計算そのものは画面（`defect-locator.js`）が持つ——ここは
「何を保存するか」だけを決める。

■ 語彙はここだけが持つ
入出位置・接触面・駆動方式の選択肢は `ENTRY_POSITIONS` / `CONTACT_FACES` /
`DRIVE_KINDS` にあり、GETの戻りで画面へ渡す（§9.163。画面へ書き写すと
増やしたときに2箇所直すことになる）。**知らない値も保存できる**
（現場の呼び名は選択肢で塞げない）。
"""
from ..db_access import ensure_audit_columns, tables

TABLE = 'ロールマスタ'

# 入出位置・接触面・駆動方式の呼び名。**選択肢で塞がない**（現場の呼び名は
# 事前に数え切れないので、ここに無い値も保存できる）。画面はこの一覧を
# サジェストとして出すだけ。
ENTRY_POSITIONS = ('入側', '出側', '中間', 'ルーパー', '巻取', '巻出')
CONTACT_FACES = ('上面', '下面', '両面', '端面', '非接触')
DRIVE_KINDS = ('駆動', '従動', 'フリー', 'ブレーキ')

_ADDED_COLUMNS = (
    ('入出位置', 'TEXT'), ('接触面', 'TEXT'),
    ('ロール径MAX', 'REAL'), ('ロール径MIN', 'REAL'), ('ロール面長', 'REAL'),
    ('材質', 'TEXT'), ('硬度', 'TEXT'), ('本数', 'INTEGER'),
    ('ロール使用条件', 'TEXT'), ('駆動方式', 'TEXT'), ('基準番号', 'TEXT'),
    ('備考', 'TEXT'), ('表示順', 'INTEGER'), ('有効', 'INTEGER'),
)


def _num(v):
    """空欄は None のまま（**0にしない**）。数として読めない値も None。"""
    if v in (None, ''):
        return None
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    return n if n == n else None            # NaN を弾く


def _int(v):
    n = _num(v)
    return None if n is None else int(n)


def ensure_table(c):
    if TABLE not in tables(c):
        cur = c.cursor()
        cur.execute('CREATE TABLE [ロールマスタ] ('
                    '[ロールID] INTEGER PRIMARY KEY AUTOINCREMENT, [設備名] TEXT, '
                    '[入出位置] TEXT, [接触面] TEXT, '
                    '[ロール径MAX] REAL, [ロール径MIN] REAL, [ロール面長] REAL, '
                    '[材質] TEXT, [硬度] TEXT, [本数] INTEGER, [ロール名] TEXT, '
                    '[ロール使用条件] TEXT, [駆動方式] TEXT, [基準番号] TEXT, [備考] TEXT, '
                    '[表示順] INTEGER, [有効] INTEGER, '
                    '[登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
        c.commit()
        ensure_audit_columns(c, TABLE)
        return True
    # 既存DBへの追加は他マスタと同じ「無ければ ALTER TABLE で足す」方式。
    cur = c.cursor()
    have = {r[1] for r in cur.execute(f'PRAGMA table_info([{TABLE}])')}
    added = False
    for name, kind in _ADDED_COLUMNS:
        if name not in have:
            cur.execute(f'ALTER TABLE [{TABLE}] ADD COLUMN [{name}] {kind}')
            added = True
    if added:
        c.commit()
    ensure_audit_columns(c, TABLE)
    return False


_SELECT = ('SELECT [ロールID],[設備名],[入出位置],[接触面],[ロール径MAX],[ロール径MIN],'
           '[ロール面長],[材質],[硬度],[本数],[ロール名],[ロール使用条件],[駆動方式],'
           '[基準番号],[備考],[表示順],[有効] '
           f'FROM [{TABLE}] ORDER BY [設備名],[表示順],[ロールID]')


def _row(r):
    return {'id': r[0],
            'equipment': str(r[1] or '').strip(),
            'entryPos': str(r[2] or '').strip(),
            'contactFace': str(r[3] or '').strip(),
            'diaMax': _num(r[4]), 'diaMin': _num(r[5]), 'faceLen': _num(r[6]),
            'material': str(r[7] or '').strip(),
            'hardness': str(r[8] or '').strip(),
            'count': _int(r[9]),
            'name': str(r[10] or '').strip(),
            'useCond': str(r[11] or '').strip(),
            'driveKind': str(r[12] or '').strip(),
            'refNo': str(r[13] or '').strip(),
            'note': str(r[14] or ''),
            'order': r[15],
            # [有効] が NULL の行は**有効**として扱う（列を足したときに
            # 既存の行が勝手に消えないように。他マスタと同じ約束）。
            'enabled': True if r[16] is None else bool(r[16])}


def roll_rows(c, include_disabled=False):
    ensure_table(c)
    cur = c.cursor()
    cur.execute(_SELECT)
    out = []
    for r in cur.fetchall():
        x = _row(r)
        if not x['enabled'] and not include_disabled:
            continue
        out.append(x)
    return out


def rolls_for_equipment(c, equipment, include_disabled=False):
    """その設備のロールだけ。判定は設備停止マスタと**同じ関数**を通す
    （`'*'`＝すべての設備／カンマ区切り／名前の全角半角ゆれ。§CLAUDE）。"""
    from . import schedule_repo as sr
    eq = str(equipment or '').strip()
    out = []
    for x in roll_rows(c, include_disabled):
        target = x['equipment']
        if not target or target == '*':
            out.append(x)
            continue
        if eq and sr.stop_equipment_matches(target, eq):
            out.append(x)
    return out


def roll_upsert(c, uid, equipment=None, name=None, entry_pos=None, contact_face=None,
                dia_max=None, dia_min=None, face_len=None, material=None, hardness=None,
                count=None, use_cond=None, drive_kind=None, ref_no=None, note=None,
                order=None, enabled=None, roll_id=None):
    """1行を書く。**渡していない項目は今の値をそのまま残す**（§9.212 ②）。

    全置換にすると、呼ぶ側が1項目でも渡し忘れたときにその設定だけが黙って
    消える（計算式・並べ替え・幅固定で3回起きている形）。"""
    ensure_table(c)
    name = str(name or '').strip() if name is not None else None
    cur = c.cursor()
    prev = None
    if roll_id is not None:
        cur.execute(f'SELECT * FROM [{TABLE}] WHERE [ロールID]=?', [roll_id])
        row = cur.fetchone()
        if row is None:
            raise ValueError('更新対象のロールが見つかりません。')
        cols = [d[0] for d in cur.description]
        prev = dict(zip(cols, row))
    keep = lambda col, v: (prev.get(col) if (v is None and prev is not None) else v)

    eq = str(equipment or '').strip() if equipment is not None else None
    if prev is None:
        eq = eq or '*'
        if not name:
            raise ValueError('ロール名を入力してください。')
    else:
        eq = keep('設備名', eq) or '*'
        name = keep('ロール名', name)
        if not str(name or '').strip():
            raise ValueError('ロール名を入力してください。')

    dmax = _num(dia_max) if dia_max is not None else None
    dmin = _num(dia_min) if dia_min is not None else None
    dmax = keep('ロール径MAX', dmax)
    dmin = keep('ロール径MIN', dmin)
    # **入れ替えない。断る。** どちらが正か決められないので、黙って直すと
    # 「入れた値と違う値が保存されている」になる（§4／§6）。
    if dmax is not None and dmin is not None and dmin > dmax:
        raise ValueError('ロール径MINがMAXより大きくなっています。値を確かめてください。')

    vals = {
        '設備名': eq,
        '入出位置': keep('入出位置', None if entry_pos is None else str(entry_pos).strip()),
        '接触面': keep('接触面', None if contact_face is None else str(contact_face).strip()),
        'ロール径MAX': dmax,
        'ロール径MIN': dmin,
        'ロール面長': keep('ロール面長', _num(face_len) if face_len is not None else None),
        '材質': keep('材質', None if material is None else str(material).strip()),
        '硬度': keep('硬度', None if hardness is None else str(hardness).strip()),
        '本数': keep('本数', _int(count) if count is not None else None),
        'ロール名': name,
        'ロール使用条件': keep('ロール使用条件', None if use_cond is None else str(use_cond).strip()),
        '駆動方式': keep('駆動方式', None if drive_kind is None else str(drive_kind).strip()),
        '基準番号': keep('基準番号', None if ref_no is None else str(ref_no).strip()),
        '備考': keep('備考', None if note is None else str(note)),
        '表示順': keep('表示順', _int(order) if order is not None else None),
        '有効': keep('有効', None if enabled is None else (-1 if enabled else 0)),
    }
    if vals['有効'] is None:
        vals['有効'] = -1

    if prev is None:
        # 自然キーは (設備名, ロール名)。同じ設備に同じ名前のロールを2本
        # 置かない——どちらの径が効くのか決められなくなる（§9.113）。
        cur.execute(f'SELECT [ロールID] FROM [{TABLE}] WHERE [設備名]=? AND [ロール名]=?',
                    [eq, name])
        hit = cur.fetchone()
        if hit:
            roll_id = hit[0]
    if roll_id is None:
        keys = ','.join(f'[{k}]' for k in vals)
        marks = ','.join('?' for _ in vals)
        cur.execute(f'INSERT INTO [{TABLE}] ({keys},[登録者ID],[更新者ID],[登録日時],[更新日時]) '
                    f'VALUES ({marks},?,?,Now(),Now())',
                    list(vals.values()) + [uid, uid])
        c.commit()
        return cur.lastrowid
    sets = ','.join(f'[{k}]=?' for k in vals)
    cur.execute(f'UPDATE [{TABLE}] SET {sets},[更新者ID]=?,[更新日時]=Now() WHERE [ロールID]=?',
                list(vals.values()) + [uid, roll_id])
    c.commit()
    return roll_id


def roll_delete(c, roll_id, uid=''):
    ensure_table(c)
    cur = c.cursor()
    cur.execute(f'DELETE FROM [{TABLE}] WHERE [ロールID]=?', [roll_id])
    n = cur.rowcount
    c.commit()
    return n


def equipments(c):
    """登録のある設備名（`'*'` を含む）。画面の束ね方の材料。"""
    seen = []
    for x in roll_rows(c, True):
        eq = x['equipment'] or '*'
        if eq not in seen:
            seen.append(eq)
    return seen
