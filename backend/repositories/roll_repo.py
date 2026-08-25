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

■ 「設備の親子関係」の持ち方 ＝ **1ロール1設備**
利用者の指示（訂正）:

  「同一ロール名でも全く違う設備の全く違うものとして管理しなければいけない
   ものも多いため厳密に設備を割ってから、個別にロール管理したいです。
   したがって設備の下に子としてロールマスタが複数ある形、1ロール1設備が
   正しいです。」

`[設備名]` は**ちょうど1つの登録済み設備名**。カンマ区切り（`'A,B'`）も
`'*'`（すべての設備）も**受け付けない**——1行が複数の設備を指せると、
「どの設備のロールか」が決まらず、同名で中身の違うロールを別物として
管理できなくなる（それがこの訂正の理由そのもの）。

**設備停止マスタの書式を借りないこと。** あちらは1行で複数の設備に効くのが
仕様で、こちらは正反対。`stop_equipment_matches()` を使い回すと `'*'` の行が
全設備に出てしまう。照合は正規化した**完全一致**（`_same_eq()`）。

自然キーは **(設備名, ロール名)**。設備が違えば同じ名前でも別の行で、
互いに何の関係も無い。画面（`master-maint.js` の `groupBy:'equipment'`）は
設備を親、ロールを子として束ねて出す。

綴りは**設備マスタの表記へ寄せる**（`_canonical_eq()`）——全角/半角の
ゆれで「設備Ａ」と「設備A」が別の親になると、同じ設備の下にロールが2つの
束で並ぶ（画面の束ね方が黙って壊れる）。

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
# 設備停止マスタが「すべての設備」に使う印。**ロールでは受け付けない**が、
# 断るときと移行のときに名指しするので綴りをここに置く（§9.163）。
ALL_EQUIPMENTS = '*'

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


# ---------------------------------------------------------------------------
# 設備の解決（§9.239 ⑥ 訂正: 1ロール1設備）
# ---------------------------------------------------------------------------
# **語彙はここだけが持つ**（§9.163）。画面もルートも「1つだけ」「登録済み」の
# 判定を書き写さない——2箇所に置くと、画面が通す値をサーバーが弾く（または
# その逆）という食い違いが必ず生まれる。

def _norm_eq(v):
    """設備名の表記ゆれを潰す。**判定にだけ使い、保存には使わない**
    （保存するのは設備マスタの綴りそのもの。`_canonical_eq()`）。"""
    from .master_repo import normalize_equipment_name
    return normalize_equipment_name(v)


def _same_eq(a, b):
    na = _norm_eq(a)
    return bool(na) and na == _norm_eq(b)


def _split_eq(raw):
    """カンマ区切り（全角読点も）を分解する。**移行と、断るときの説明にだけ**
    使う——通常の保存経路はそもそも複数を受け付けない。"""
    return [x.strip() for x in str(raw or '').replace('、', ',').split(',') if x.strip()]


def _canonical_eq(c, raw):
    """ちょうど1つの**登録済み**設備名へ解決する（§9.239 ⑥ 訂正）。

    **断る理由を名指しで返す**（§CLAUDE 4／§6）——「保存できません」だけでは
    設備を消したのか綴りが違うのか複数書いたのかが分からない。

    戻すのは**設備マスタの綴り**。打った文字をそのまま保存すると、全角/半角の
    ゆれで同じ設備が2つの親として並ぶ（画面の束ねが黙って壊れる）。"""
    from .master_repo import equipment_master_rows
    raw = str(raw or '').strip()
    if not raw:
        raise ValueError('設備を選んでください。ロールは設備ごとに管理します'
                         '（同じロール名でも設備が違えば別のロールです）。')
    if raw == ALL_EQUIPMENTS:
        raise ValueError('「すべての設備」は指定できません。ロールは設備ごとに'
                         '実物が違うので、設備を1つだけ選んでください。')
    parts = _split_eq(raw)
    if len(parts) > 1:
        raise ValueError(f'設備は1つだけ選んでください（「{raw}」のように複数は'
                         f'指定できません）。同じロールが複数の設備にあるときは、'
                         f'設備ごとに1本ずつ登録してください。')
    want = parts[0]
    known = [str(r[1] or '').strip() for r in equipment_master_rows(c)]
    for name in known:
        if _same_eq(name, want):
            return name                       # 設備マスタの綴りへ寄せる
    if not known:
        raise ValueError('設備マスタに1件も登録がありません。先に「設備」タブで'
                         '設備を登録してから、そのロールを足してください。')
    raise ValueError(f'設備マスタに「{want}」がありません。先に「設備」タブで'
                     f'登録するか、登録済みの設備から選んでください。')


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
    _migrate_once(c)
    return False


# 移行はプロセスに1回だけ試す。目印はDBに残る（他の端末・次の起動のため）が、
# **毎回パス設定マスタを読みに行かない**——`ensure_table()`はどの入口からも
# 通るので、1リクエストで何度も呼ばれる。
_migrated_this_process = False


def _migrate_once(c):
    global _migrated_this_process
    if _migrated_this_process:
        return
    _migrated_this_process = True
    try:
        migrate_single_equipment(c)
    except Exception:
        # **移行に失敗してもロールマスタは開けること**（fail-open）。
        # 割れなかった行は「設備なし」として画面に出るので、気づいて直せる。
        pass


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
    """**その設備のロールだけ**（1ロール1設備。§9.239 ⑥ 訂正）。

    照合は正規化した完全一致で、**設備停止マスタの `stop_equipment_matches()`
    を借りないこと**——あちらは `'*'` を「すべての設備」として通すので、
    1本のロールが全設備の判定に混ざる。ロールは設備ごとに実物が違うので、
    混ざった瞬間に「当設備の対象ロールを判定する」という機能の意味が消える。

    **設備が空なら1本も返さない**（全部返す方が親切に見えるが、他の設備の
    ロールを候補に出すのはこの機能では嘘になる）。"""
    eq = str(equipment or '').strip()
    if not eq:
        return []
    return [x for x in roll_rows(c, include_disabled) if _same_eq(x['equipment'], eq)]


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

    # 設備は**ちょうど1つの登録済み設備**（§9.239 ⑥ 訂正）。
    # **触っていないときは確かめ直さない**——設備マスタからその設備が消えた
    # あとでも、そのロールの備考や径は直せるべき（確かめ直すと、消えた設備の
    # ロールが編集も削除もできない行として残る＝§CLAUDE 4）。
    eq = str(equipment or '').strip() if equipment is not None else None
    if prev is None:
        eq = _canonical_eq(c, eq)
        if not name:
            raise ValueError('ロール名を入力してください。')
    else:
        if eq is None or _same_eq(eq, prev.get('設備名')):
            eq = keep('設備名', None)          # 設備は触っていない＝そのまま
        else:
            eq = _canonical_eq(c, eq)          # 付け替えたときだけ確かめる
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
        # 自然キーは **(設備名, ロール名)**（§9.239 ⑥ 訂正）。同じ設備に同じ
        # 名前のロールを2本置かない——どちらの径が効くのか決められなくなる
        # （§9.113）。**逆に、設備が違えば同じ名前でも別の行**にする。
        # それがこの訂正の要件そのものなので、ロール名だけで探さないこと。
        # 照合は**正規化つき**——移行で入った行は綴りが設備マスタと
        # 揃っていないことがあり、素の`=`だと同じ設備に2本できる。
        cur.execute(f'SELECT [ロールID],[設備名],[ロール名] FROM [{TABLE}]')
        for rid, reo, rnm in cur.fetchall():
            if _same_eq(reo, eq) and str(rnm or '').strip() == name:
                roll_id = rid
                break
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
    """ロールが登録されている設備名。画面の束ね方（親）の材料。

    **`'*'` は出てこない**（1ロール1設備なので存在しない）。設備が空の行は
    移行し損ねた古い行なので、**黙って隠さず** `''` のまま返して画面に
    「設備なし」として見せる——隠すと直す手立てごと消える（§CLAUDE 4）。"""
    seen = []
    for x in roll_rows(c, True):
        eq = x['equipment']
        if eq not in seen:
            seen.append(eq)
    return seen


# ---------------------------------------------------------------------------
# 多設備で保存された行を1設備ずつへ割る（§9.239 ⑥ 訂正の移行）
# ---------------------------------------------------------------------------
MIGRATE_KEY = '__roll_single_equipment_split__'


def migrate_single_equipment(c, uid='migrate:roll'):
    """`'A,B'` / `'*'` の行を、**設備1つにつき1行**へ割る。

    **1度だけ**走らせる（目印はパス設定マスタ。§9.232 の
    `seed_mother_builtins` と同じ作法）——「多設備の行があれば割る」を毎回
    やる作りにすると、利用者が意図して直した綴りを繰り返し書き換えることに
    なる。

    `'*'` は**設備マスタの全設備へ展開する**——新しい決まりでは「すべての
    設備で同じ1本」という状態が存在しないので、設備ごとの実物として複製する
    のが唯一の正直な読み替え。

    **割り切れないうちは目印を書かない**（設備マスタが空で `'*'` を展開
    できない等）。書いてしまうと、設備を登録したあとも古い行が
    **どの設備にも当たらない見えない行**として残る（§CLAUDE 4）。
    戻り値は (割った元の行数, 作った行数, 残した行数)。

    **`ensure_table()` から呼ばれる**ので、ここで `ensure_table()` を呼ばない
    こと（無限再帰になる）。表が在ることは呼び出し側が保証する。"""
    from ..db_access import path_config_rows, set_path_config
    try:
        if path_config_rows(c).get(MIGRATE_KEY):
            return (0, 0, 0)
    except Exception:
        pass                      # 目印が読めなくても移行そのものは冪等
    from .master_repo import equipment_master_rows
    cur = c.cursor()
    cur.execute(f'SELECT [ロールID],[設備名] FROM [{TABLE}]')
    rows = cur.fetchall()
    known = [str(r[1] or '').strip() for r in equipment_master_rows(c)]
    split_from = made = left = 0
    for rid, raw in rows:
        raw = str(raw or '').strip()
        targets = known[:] if raw == ALL_EQUIPMENTS else _split_eq(raw)
        if len(targets) <= 1:
            continue              # 既に1設備（または空）＝触らない
        # **1本目は元の行を書き換え、2本目以降は複製する**——消してから
        # 作り直すと、途中で落ちたときにロールが丸ごと消える。
        cur.execute(f'SELECT * FROM [{TABLE}] WHERE [ロールID]=?', [rid])
        src = cur.fetchone()
        if src is None:
            continue
        cols = [d[0] for d in cur.description]
        base = dict(zip(cols, src))
        cur.execute(f'UPDATE [{TABLE}] SET [設備名]=?,[更新者ID]=?,[更新日時]=Now() '
                    f'WHERE [ロールID]=?', [targets[0], uid, rid])
        split_from += 1
        for eq in targets[1:]:
            vals = {k: v for k, v in base.items() if k != 'ロールID'}
            vals['設備名'] = eq
            vals['更新者ID'] = uid
            keys = ','.join(f'[{k}]' for k in vals)
            marks = ','.join('?' for _ in vals)
            cur.execute(f'INSERT INTO [{TABLE}] ({keys}) VALUES ({marks})',
                        list(vals.values()))
            made += 1
    # 割り残し（`'*'` なのに設備マスタが空、など）が無くなってから目印を書く。
    cur.execute(f'SELECT [設備名] FROM [{TABLE}]')
    for (raw,) in cur.fetchall():
        raw = str(raw or '').strip()
        if raw == ALL_EQUIPMENTS or len(_split_eq(raw)) > 1:
            left += 1
    c.commit()
    if not left:
        try:
            set_path_config(c, MIGRATE_KEY, 'done', uid)
        except Exception:
            pass
    return (split_from, made, left)
