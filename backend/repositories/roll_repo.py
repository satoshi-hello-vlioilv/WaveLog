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
# 接触面は **上 / 下 / 上下** が現場の呼び名（§9.246 ⑤、利用者の指示
# 「接触面は『上』『下』だけではなく、『上下』というものも存在する」）。
# ここは**サジェスト**なので、これに無い値（旧`上面`など）も今までどおり
# 保存でき、既に入っている行はそのまま残る。
CONTACT_FACES = ('上', '下', '上下', '端面', '非接触')
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


def _norm_face(v):
    """接触面の表記ゆれを潰す（判定にだけ使う。保存するのは打った文字）。

    設備名と同じ規則（全角/半角・前後の空白）へ寄せる——`上 `と`上`が
    別のロールになると、取り込みのたびに行が増える。"""
    from .master_repo import normalize_equipment_name
    return normalize_equipment_name(v)


def roll_key(equipment, name, contact_face):
    """ロール1本を見分ける自然キー（§9.246 ⑤、利用者の指示）。

    > 「ロールマスタの接触面は『上』『下』だけではなく、『上下』というものも
    >  存在するので、インポート時にデータ欠損させないように修正してください」

    §9.239 ⑥／§9.240 では **(設備名, ロール名)** の2つだけだった。ところが
    実データは**同じ設備の同じロール名が接触面ちがいで複数本**あり
    （上／下／上下）、取り込むと`roll_upsert()`が最初の1本を引き当てて
    **上書きし続け、最後の1行しか残らなかった**（画面からも2本目を
    「同じ設備に同じ名前のロールを2つ置けません」で登録できなかった）。

    **接触面まで含めて1本**と数える。**判定はここ1箇所**——`roll_upsert()`と
    `import_rows()`が同じ関数を通すので、片方だけ直した状態が作れない。

    **入出位置は入れない**（利用者が言っているのは接触面だけ）。同じ設備・
    同じ名前・同じ接触面で入出位置だけが違うロールが出てきたら、そのときに
    ここを1行足す——先回りで広げると、いま在る行の同一性が理由なく変わる。
    """
    return (_norm_eq(equipment), str(name or '').strip(), _norm_face(contact_face))


class RollIndex:
    """在るロールを自然キーで引く索引。**引き当ての規則はここだけが持つ**
    （§9.246 ⑤）。鍵の作り方（`roll_key()`）と「どの行に当てるか」は別の
    判断なので、それぞれ1箇所に置く。

    `rows` は `(ロールID, 設備名, ロール名, 接触面)` の並び。
    `roll_upsert()` は毎回DBから作り、`import_rows()` は下見の前に1回作って
    使い回す——**下見が数えたものと、保存で実際に起きることを同じ規則に
    決めさせる**（別々に持つと「追加1・上書き2」と言いながら1行しか
    残らない、が作れる。それが今回直した不具合そのもの）。
    """

    def __init__(self, rows):
        self._exact, self._blank, self._loose = {}, {}, {}
        for rid, eq, nm, fc in rows:
            k = roll_key(eq, nm, fc)
            base = k[:2]
            self._exact.setdefault(k, rid)
            self._loose.setdefault(base, []).append(rid)
            if not k[2]:
                self._blank.setdefault(base, []).append(rid)

    def find(self, equipment, name, contact_face):
        """`(ロールID or None, 理由)` を返す。

        理由:
          `'exact'`     3つとも一致
          `'blank'`     接触面がまだ空の同じロール（＝この機能より前の行）に
                        面を書き足す。**行は増やさない**
          `'loose'`     接触面を言われていない（列が無い／空欄）ので
                        (設備, 名前) で1本だけ当たった
          `'ambiguous'` 言われていないのに接触面ちがいで複数在る
                        ——**どれを直すか決められないので断る**（§CLAUDE 4）
          `None`        無い（＝追加）
        """
        k = roll_key(equipment, name, contact_face)
        base = k[:2]
        if contact_face is None:              # 列が無い／送っていない
            ids = self._loose.get(base) or []
            if len(ids) == 1:
                return (ids[0], 'loose')
            if len(ids) > 1:
                return (None, 'ambiguous')
            return (None, None)
        rid = self._exact.get(k)
        if rid is not None:
            return (rid, 'exact')
        if k[2]:
            # **接触面がまだ空の行は「まだ分類していない同じロール」**として
            # 拾う。拾わないと、書き出す→接触面を書き足す→取り込む、という
            # いちばんありそうな往復で行がちょうど二重になる。
            ids = self._blank.get(base) or []
            if ids:
                return (ids[0], 'blank')
        return (None, None)

    def take(self, equipment, name, contact_face):
        """`find()` と同じ規則で引き、**拾った行を使い済みにする**。

        面が空の行は1本しか無いので、2行目も「上書き」と数えると下見の
        「追加 N件」が実際と食い違う（下見の意味が無くなる）。
        """
        rid, why = self.find(equipment, name, contact_face)
        if rid is None:
            return (rid, why)
        k = roll_key(equipment, name, contact_face)
        base = k[:2]
        self._exact[k] = rid
        for d in (self._blank, self._loose):
            if rid in (d.get(base) or []):
                d[base].remove(rid)
        self._loose.setdefault(base, []).append(rid)
        return (rid, why)


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
    # **全角の ＊ も同じ意味に読む**（NFKCで寄せてから見る）。素の比較だと
    # `＊` が「設備マスタに無い名前」として別の断り方になり、同じ操作なのに
    # 説明が変わる。
    if _norm_eq(raw) == ALL_EQUIPMENTS:
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
    # **在るロールの索引は1回だけ作って使い回す**（§9.246 ⑤）。前段の
    # 引き当てと後段の重複判定が**同じ写し**を見ることが要点——別々に
    # SELECTすると、同じ行が2度目で別扱いになりうる。
    cur.execute(f'SELECT [ロールID],[設備名],[ロール名],[接触面] FROM [{TABLE}]')
    index = RollIndex(cur.fetchall())
    prev = None
    if roll_id is not None:
        cur.execute(f'SELECT * FROM [{TABLE}] WHERE [ロールID]=?', [roll_id])
        row = cur.fetchone()
        if row is None:
            raise ValueError('更新対象のロールが見つかりません。')
        cols = [d[0] for d in cur.description]
        prev = dict(zip(cols, row))
    # **自然キーで引き当てるのは`prev`を読む前**（§9.240 の追補）。
    # 以前はここが値を組み立てた**あと**に在ったため、IDを渡さない経路
    # （Excelの取り込み・登録API）では`prev`が`None`のままで`keep()`が効かず、
    # **送っていない列がNULLで上書きされた**（入出位置が消えた。
    # `tests/test_rollio.py`が捕まえた）。「渡していない項目は今の値を残す」
    # はIDを渡したときだけの約束ではない。
    if prev is None and roll_id is None and name and equipment is not None:
        want_eq = _norm_eq(equipment)
        if want_eq:
            # **接触面まで見て引き当てる**（§9.246 ⑤）。ここが(設備,名前)だけ
            # だったため、接触面ちがいの同名ロール（上／下／上下）を取り込むと
            # **同じ行を上書きし続け、最後の1行しか残らなかった**。
            #
            # **引き当ての規則は`RollIndex`の1箇所**。ここへインラインで
            # 比較を書くと、同じ規則が`import_rows()`にも要る＝2箇所になる。
            hit, why = index.find(equipment, name, contact_face)
            if why == 'ambiguous':
                # 接触面を言われていないのに、面ちがいで複数在る。**黙って
                # どれかを上書きしない**（§CLAUDE 4）——それが今回直した欠損。
                raise ValueError('%s の「%s」は接触面ちがいで複数登録されています。'
                                 'どれを直すか決められないので、接触面も指定して'
                                 'ください。' % (equipment, name))
            roll_id = hit
            if roll_id is not None:
                cur.execute(f'SELECT * FROM [{TABLE}] WHERE [ロールID]=?', [roll_id])
                row = cur.fetchone()
                if row is not None:
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

    # 自然キーは **(設備名, ロール名)**（§9.239 ⑥ 訂正）。同じ設備に同じ
    # 名前のロールを2本置かない——どちらの径が効くのか決められなくなる
    # （§9.113）。**逆に、設備が違えば同じ名前でも別の行**にする。
    # それがこの訂正の要件そのものなので、ロール名だけで探さないこと。
    # 照合は**正規化つき**——移行で入った行は綴りが設備マスタと
    # 揃っていないことがあり、素の`=`だと同じ設備に2本できる。
    #
    # **更新のときも見ること。** 以前は新規のときしか照合しておらず、
    # 既存の行の設備や名前を**既に在る組み合わせへ書き換えられた**
    # （画面からは「保存できた」ように見えて、次に開くと同じ設備に同名が
    # 2本並ぶ。ピッチ判定に同じロールが別々の径で二重に出る）。
    # **接触面まで含めて1本**（§9.246 ⑤）。ここが(設備,名前)だけだったため、
    # 現場にある「同じロール名の上／下／上下」を**登録すらできなかった**。
    face_now = vals['接触面']
    hit_id, _why = index.find(eq, name, face_now)
    if prev is None:
        if hit_id is not None:
            roll_id = hit_id          # 同じ組み合わせ＝上書き（取り込みもここを通る）
    elif hit_id is not None and hit_id != roll_id:
        # **断る理由に接触面を出す**（§CLAUDE 6）——「同じ名前」だけだと、
        # 接触面を変えれば置けることに気づけない。
        raise ValueError('「%s」（接触面 %s）は %s に登録済みです。同じ設備に'
                         '同じ名前・同じ接触面のロールを2つ置けません'
                         '（どちらの径で判定するか決まりません）。'
                         '上下で別のロールなら接触面を分けてください。'
                         % (name, face_now or '未設定', eq))
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
# 保留にした行の備考へ残す一言。**なぜ止まっているか・何をすれば直るか**を
# 書く（§CLAUDE 4／§6）。「移行しました」だけでは打つ手が分からない。
MIGRATE_NOTE = ('【移行】以前は「すべての設備」でしたが、ロールは設備ごとに'
                '1本ずつ持つ形に変わりました。設備を選び直してから'
                '「有効」に戻してください。')


def migrate_single_equipment(c, uid='migrate:roll'):
    """`'A,B'` / `'*'` の行を、1ロール1設備の形へ直す（§9.239 ⑥ 訂正）。

    **1度だけ**走らせる（目印はパス設定マスタ。§9.232 の
    `seed_mother_builtins` と同じ作法）——「多設備の行があれば直す」を毎回
    やる作りにすると、利用者が意図して直した綴りを繰り返し書き換える。

    ■ `'A,B'`（設備を名指ししたカンマ区切り）は**割る**
    利用者が設備を名指ししている以上、設備ごとの1行へ展開するのは解釈では
    なく忠実な読み替え。1本目は元の行を書き換え、2本目以降は複製する
    （消してから作り直すと、途中で落ちたときにロールが丸ごと消える）。
    **割った先に同じ (設備名, ロール名) が既に在れば作らない**——作ると
    同じ設備に同名が2本並び、ピッチ判定に同じロールが別々の径で二重に出る
    （§9.113 を移行そのものが破る）。

    ■ `'*'`（すべての設備）は**展開しない**
    設備マスタの全設備へコピーすると、利用者が一度も入力していない径・材質を
    **N台ぶんの現物の諸元として**書き込むことになる（ロールは特定の機械に
    付いている物なので、コピーは事実の捏造）。しかも移行後に増えた設備には
    付かないので、結局あとから手で足すことになる。
    かといって `'*'` のまま残すと、新しい照合ではどの設備にも当たらず
    **異常位置判定から黙って消える**（§CLAUDE 4）。
    だから**設備を空にし、無効にし、理由を備考へ残す**——「設備が未設定」の
    群として一覧に見えたまま止まるので、利用者が設備を選び直せる。

    **直し切れないうちは目印を書かない。** 戻り値は
    (割った元の行数, 作った行数, 保留にした行数, 衝突で飛ばした行数)。"""
    from ..db_access import path_config_rows, set_path_config
    try:
        if path_config_rows(c).get(MIGRATE_KEY):
            return (0, 0, 0, 0)
    except Exception:
        pass                      # 目印が読めなくても移行そのものは冪等
    cur = c.cursor()
    cur.execute(f'SELECT [ロールID],[設備名],[ロール名],[接触面] FROM [{TABLE}]')
    rows = cur.fetchall()
    # いま在る自然キー。割った先の衝突を見るのに使う。**鍵の作り方を
    # 2種類残さない**（§9.246 ⑤）——`roll_key()`の1箇所を通す。
    seen = {roll_key(e, n, f) for _i, e, n, f in rows}
    split_from = made = held = clash = 0
    for rid, raw, rname, rface in rows:
        raw = str(raw or '').strip()
        rname = str(rname or '').strip()
        if _norm_eq(raw) == ALL_EQUIPMENTS:
            cur.execute(
                f'UPDATE [{TABLE}] SET [設備名]=?,[有効]=0,'
                f'[備考]=?,[更新者ID]=?,[更新日時]=Now() WHERE [ロールID]=?',
                ['', (MIGRATE_NOTE + '\n' + _note_of(cur, rid)).strip(), uid, rid])
            held += 1
            continue
        targets = _split_eq(raw)
        if len(targets) <= 1:
            continue              # 既に1設備（または空）＝触らない
        cur.execute(f'SELECT * FROM [{TABLE}] WHERE [ロールID]=?', [rid])
        src = cur.fetchone()
        if src is None:
            continue
        cols = [d[0] for d in cur.description]
        base = dict(zip(cols, src))
        cur.execute(f'UPDATE [{TABLE}] SET [設備名]=?,[更新者ID]=?,[更新日時]=Now() '
                    f'WHERE [ロールID]=?', [targets[0], uid, rid])
        seen.discard(roll_key(raw, rname, rface))
        seen.add(roll_key(targets[0], rname, rface))
        split_from += 1
        for eq in targets[1:]:
            key = roll_key(eq, rname, rface)
            if key in seen:
                clash += 1        # その設備には同名が既に在る＝作らない
                continue
            vals = {k: v for k, v in base.items() if k != 'ロールID'}
            vals['設備名'] = eq
            vals['更新者ID'] = uid
            keys = ','.join(f'[{k}]' for k in vals)
            marks = ','.join('?' for _ in vals)
            cur.execute(f'INSERT INTO [{TABLE}] ({keys}) VALUES ({marks})',
                        list(vals.values()))
            seen.add(key)
            made += 1
    # 割り残しが無くなってから目印を書く（`'*'` は保留にした時点で片付いている）。
    left = 0
    cur.execute(f'SELECT [設備名] FROM [{TABLE}]')
    for (raw,) in cur.fetchall():
        raw = str(raw or '').strip()
        if _norm_eq(raw) == ALL_EQUIPMENTS or len(_split_eq(raw)) > 1:
            left += 1
    c.commit()
    if not left:
        try:
            set_path_config(c, MIGRATE_KEY, 'done', uid)
        except Exception:
            pass
    return (split_from, made, held, clash)


def _note_of(cur, rid):
    cur.execute(f'SELECT [備考] FROM [{TABLE}] WHERE [ロールID]=?', [rid])
    hit = cur.fetchone()
    return str((hit[0] if hit else '') or '')


# ---------------------------------------------------------------------------
# Excel の持ち出し・取り込み（§9.240、利用者の指示）
# ---------------------------------------------------------------------------
# 「ロールマスタについて EXCELでのインポート＆エクスポート機能を実装して
#  ください。」
#
# **列の並びと見出しはここ1つが持つ**（§9.163）。画面にもテストにも
# 書き写さない——書き写すと、列を1本足したときに書き出しと取り込みで
# 食い違う（見出しで突き合わせているので、片方だけ直すと黙って空になる）。
#
# **突き合わせは自然キー (設備名, ロール名)**（§9.239 ⑥ 訂正）。同じ設備に
# 同じ名前があれば上書き、無ければ追加。**IDの列は持ち出さない**——IDは
# 端末ごとの連番なので、別のPCで取り込むと無関係な行を書き換える（§9.171
# 「印はIDでなく名前で運ぶ」と同じ理由）。
IO_COLUMNS = (
    # (見出し, 鍵, 型, 列幅の目安)
    ('設備名',         'equipment',   'text', 18),
    ('ロール名',       'name',        'text', 22),
    ('入出位置',       'entryPos',    'text', 12),
    ('接触面',         'contactFace', 'text', 10),
    ('ロール径MAX',    'diaMax',      'num',  12),
    ('ロール径MIN',    'diaMin',      'num',  12),
    ('ロール面長',     'faceLen',     'num',  12),
    ('材質',           'material',    'text', 12),
    ('硬度',           'hardness',    'text', 10),
    ('本数',           'count',       'int',  8),
    ('ロール使用条件', 'useCond',     'text', 20),
    ('駆動方式',       'driveKind',   'text', 10),
    ('基準番号',       'refNo',       'text', 14),
    ('備考',           'note',        'text', 30),
    ('表示順',         'order',       'int',  8),
    ('有効',           'enabledText', 'text', 8),
)
IO_HEADER = tuple(x[0] for x in IO_COLUMNS)

# 取り込みが組み立てる鍵は**画面と同じ camelCase**（`_row()` が返す形）だが、
# `roll_upsert()` の引数は snake_case。**ここで1回だけ寄せる**——呼ぶ側で
# 綴りを2通り持つと、列を1本足したときに「取り込んでも1列だけ入らない」が
# 起きる（実際に `entryPos` で落ちた）。
_UPSERT_KW = {'entryPos': 'entry_pos', 'contactFace': 'contact_face',
              'diaMax': 'dia_max', 'diaMin': 'dia_min', 'faceLen': 'face_len',
              'useCond': 'use_cond', 'driveKind': 'drive_kind', 'refNo': 'ref_no'}


def export_bytes(c, equipment=''):
    """いまのロールを .xlsx の bytes で返す（§9.240）。

    **無効な行も出す**（`[有効]` 列で分かる）——出さないと、書き出して
    直して取り込む往復で**無効にした行が消える**。
    `equipment` を渡すとその設備だけ。"""
    from ..xlsx_io import write_sheet
    eq = str(equipment or '').strip()
    rows = rolls_for_equipment(c, eq, True) if eq else roll_rows(c, True)
    out = []
    for x in rows:
        line = []
        for _label, key, kind, _w in IO_COLUMNS:
            if key == 'enabledText':
                line.append('有効' if x.get('enabled', True) else '無効')
                continue
            v = x.get(key)
            if v is None or v == '':
                line.append('')
            elif kind in ('num', 'int'):
                line.append(v)              # 数はセルも数（Excelで計算できる）
            else:
                line.append(str(v))
        out.append(line)
    name = ('ロール_' + eq) if eq else 'ロール'
    return write_sheet(IO_HEADER, out,
                       widths=[x[3] for x in IO_COLUMNS], sheet_name=name)


def _num_or_none(v):
    """空欄は None。数として読めなければ `'NG'`（**0にしない**。§9.114）。"""
    v = str(v or '').strip().replace(',', '')
    if not v:
        return None
    try:
        return float(v)
    except ValueError:
        return 'NG'


def import_rows(c, uid, data, dry_run=True):
    """Excelから取り込む（§9.240）。**下見（dry_run）ができる**。

    §9.193 のクエリ結合と同じ作法で、**保存する前に何が起きるかを見せる**
    ——何件が追加で何件が上書きか、どの行がなぜ飛ばされるかを返す。

    **飛ばした行は必ず理由つきで返すこと**（§CLAUDE 4）。黙って減らすと
    「取り込んだのに増えていない」としか分からない。
    """
    from ..xlsx_io import read_sheet, XlsxError
    book = read_sheet(data)
    rows = book['rows']
    if not rows:
        raise XlsxError('シートが空です。1行目に見出し（%s …）を置いてください。'
                        % '／'.join(IO_HEADER[:3]))
    head = [str(x or '').strip() for x in rows[0]]
    # **見出しは名前で探す**（列の順番を変えても取り込める。§9.171）。
    pos = {}
    for label, key, _kind, _w in IO_COLUMNS:
        pos[key] = head.index(label) if label in head else -1
    missing = [lab for lab, key, _k, _w in IO_COLUMNS
               if key in ('equipment', 'name') and pos[key] < 0]
    if missing:
        raise XlsxError('見出しに %s がありません。1行目を見出しの行にして'
                        'ください（書き出したファイルをそのまま直すのが確実です）。'
                        % '・'.join(missing))
    # いま在る行（自然キー→ID）。**正規化して突き合わせる**——設備名の
    # 全角/半角ゆれで「同じロールが2本」になるのを防ぐ。
    # **引き当ての規則は`RollIndex`の1箇所**（§9.246 ⑤）。下見が数えたものと
    # 保存で実際に起きることを同じ規則に決めさせる——別々に持つと
    # 「追加1・上書き2」と言いながら1行しか残らない、が作れる。
    index = RollIndex([(x['id'], x['equipment'], x['name'], x['contactFace'])
                       for x in roll_rows(c, True)])
    # 同じファイルの中で同じキーが2度出てきたら、**2度目は黙って上書きしない**
    # （§CLAUDE 4）。上書きすると1行ぶんが消えるのに「取り込みました」としか
    # 出ないので、**行番号を添えて飛ばす**。
    seen_rows = {}

    def cell(r, key):
        i = pos[key]
        return str(r[i]).strip() if 0 <= i < len(r) and r[i] is not None else ''

    add = update = 0
    skipped = []
    plans = []
    for i, r in enumerate(rows[1:], start=2):
        if not any(str(v or '').strip() for v in r):
            continue                      # 空行は黙って飛ばす（Excelの末尾に必ず出る）
        eq_raw, name = cell(r, 'equipment'), cell(r, 'name')
        if not name:
            skipped.append({'row': i, 'why': 'ロール名が空です'})
            continue
        try:
            eq = _canonical_eq(c, eq_raw)
        except ValueError as e:
            skipped.append({'row': i, 'why': str(e), 'name': name})
            continue
        vals = {'equipment': eq, 'name': name}
        bad = None
        for label, key, kind, _w in IO_COLUMNS:
            if key in ('equipment', 'name'):
                continue
            raw = cell(r, key)
            if key == 'enabledText':
                vals['enabled'] = raw.strip() not in ('無効', '出さない', 'false', '0')
                continue
            if pos[key] < 0 or raw == '':
                vals[key] = None          # 列が無い／空欄＝触らない（§9.212 ②）
                continue
            if kind in ('num', 'int'):
                n = _num_or_none(raw)
                if n == 'NG':
                    bad = '%s が数として読めません（%s）' % (label, raw)
                    break
                vals[key] = int(n) if (kind == 'int' and n is not None) else n
            else:
                vals[key] = raw
        if bad:
            skipped.append({'row': i, 'why': bad, 'name': name})
            continue
        dmax, dmin = vals.get('diaMax'), vals.get('diaMin')
        if dmax is not None and dmin is not None and dmin > dmax:
            skipped.append({'row': i, 'name': name,
                            'why': 'ロール径MINがMAXより大きくなっています'})
            continue
        key = roll_key(eq, name, vals.get('contactFace'))
        if key in seen_rows:
            skipped.append({'row': i, 'name': name,
                            'why': '同じ（設備・ロール名・接触面）の行が%d行目にもあります。'
                                   'どちらの値で保存するか決められないので飛ばしました'
                                   '（接触面を分けるか、片方を消してください）。'
                                   % seen_rows[key]})
            continue
        seen_rows[key] = i
        # **`take()`は拾った行を使い済みにする**——面が空の行は1本しか無いので、
        # 2行目も「上書き」と数えると下見の件数が実際と食い違う。
        rid, why = index.take(eq, name, vals.get('contactFace'))
        if why == 'ambiguous':
            # 接触面の列が無いシートを、面で割った後のマスタへ取り込んだ場合。
            # **どれを直すか決められないので断る**（黙って1本を上書きしない）。
            skipped.append({'row': i, 'name': name,
                            'why': 'この設備の「%s」は接触面ちがいで複数登録されて'
                                   'います。接触面の列を足して、どれを直すかを'
                                   '決めてください。' % name})
            continue
        if rid is not None:
            update += 1
        else:
            add += 1
        plans.append(vals)
    result = {'total': len(rows) - 1, 'add': add, 'update': update,
              'skipped': skipped, 'sheet': book['sheet'], 'dryRun': bool(dry_run)}
    if dry_run:
        # **下見では3件だけ見せる**（§9.193。1件では「たまたま」と区別が付かない）
        result['sample'] = plans[:3]
        return result
    saved = 0
    for v in plans:
        try:
            roll_upsert(c, uid, **{_UPSERT_KW.get(k, k): val for k, val in v.items()})
            saved += 1
        except ValueError as e:
            skipped.append({'row': '-', 'name': v.get('name'), 'why': str(e)})
    result['saved'] = saved
    result['skipped'] = skipped
    return result
