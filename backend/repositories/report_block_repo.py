# -*- coding: utf-8 -*-
"""帳票ブロックマスタ(§9.217): 帳票へ足す「自分で作った塊」。

利用者の指示:

  「内部データについても各項目ごと設計できるように、編集追加などできる
   ようにすることで設計の自由度を上げることができます。」

帳票の塊は`report-dashboard.js`の`RP_BLOCKS`が持っており、**中身の作り方は
コードの側**にある（測定表・条の図・異常位置判定のように、組み立てそのものが
仕事のものが多いため）。一方で「この値とこの値を並べて出したいだけ」という
塊は現場ごとに違い、そのたびにコードを直すのは現実的でない。

そこで**「ラベルと値の出どころを並べた塊」だけをマスタで作れる**ようにした。
1行＝1つの塊で、`[内容]`に`ラベル=出どころ`を並べる。出どころは測定レコードの
中の道（`basic.lotNo`／`settings.measureType`／`settings.opData.運転方式`…）で、
**操業データの項目もそのまま使える**（§9.216 ②で項目名が鍵になっているため）。

**幅と行数は規格の中から選ぶ**（§9.217）——紙は12マスのグリッドで、高さも
24pxを1行とする行数で持つ。自由に入れさせると、増えるたびに紙の割り付けが
崩れる（§9.135「粗いグリッドで組む」と同じ理由）。

対象設備の書式は設備停止マスタと同じ(`schedule_repo.stop_equipment_*`)。
判定を新しく書き起こさない。
"""
from .master_repo import tables

TABLE = '帳票ブロックマスタ'

# 幅（12マス基準）と高さ（行数）。**選べる数を増やさない**——粗いほど
# 左端がそろう（§9.135）。帳票の幅の選択肢（1/4・1/3・1/2・2/3・全幅）と
# 同じ数に合わせてある。
SPANS = (3, 4, 6, 8, 12)
ROWS = (2, 3, 4, 6, 8, 12)


def normalize_span(v):
    try:
        n = int(v)
    except (TypeError, ValueError):
        return 6
    return min(SPANS, key=lambda s: abs(s - n))


def normalize_rows(v):
    try:
        n = int(v)
    except (TypeError, ValueError):
        return 0
    if n <= 0:
        return 0                      # 0＝中身なり（自動で測る）
    return min(ROWS, key=lambda s: abs(s - n))


# 画面が「出どころ」を選ばせるための見本。**ここに無い道も書ける**
# （測定レコードの形は増えるので、選択肢で塞がない）。
FIELD_CATALOG = (
    ('ロット番号', 'basic.lotNo'),
    ('検査番号', 'basic.inspectionNo'),
    ('鋳造番号', 'basic.castingNo'),
    ('オーダー番号', 'basic.orderNo'),
    ('用途名', 'basic.purposeName'),
    ('取引先', 'basic.customer'),
    ('納入先', 'basic.delivery'),
    ('製造材質', 'basic.material'),
    ('製造板厚', 'basic.thickness'),
    ('製造板幅', 'basic.width'),
    ('登録設備', 'settings.registeredEquipment'),
    ('入力内容', 'settings.measureType'),
    ('丈位置', 'settings.lengthPos'),
    ('縦割数', 'settings.verticalCount'),
    ('横割数', 'settings.horizontalCount'),
    ('オペレータ', 'settings.operator'),
    ('検査員', 'settings.inspector'),
    ('作業人数', 'settings.crewSize'),
    ('内径', 'settings.innerDiameter'),
    ('スプール', 'settings.spool'),
    ('作業開始時刻', 'workTime.startAt'),
    ('作業終了時刻', 'workTime.endAt'),
    ('更新日時', 'updatedAt'),
)


def parse_content(text):
    """`ラベル=出どころ`の並びを読む。改行でもカンマでも区切れる。

    **壊れた行は1行だけ落とす**（§9.88の読み替えルールと同じ約束）——
    1行の書き間違いで塊ごと消えると、どこが悪いのか分からなくなる。
    `=`が無い行は「ラベルも道も同じ」として扱う（`basic.lotNo`だけ書いても
    出る）。"""
    out = []
    for raw in str(text or '').replace('、', ',').replace('\r', '\n').replace(',', '\n').split('\n'):
        s = raw.strip()
        if not s:
            continue
        if '=' in s:
            label, _, path = s.partition('=')
            label, path = label.strip(), path.strip()
        else:
            label, path = s, s
        if not path:
            continue
        out.append({'label': label or path, 'path': path})
    return out


def _row(r):
    return {'id': r[0], 'equipment': str(r[1] or '').strip(),
            'name': str(r[2] or '').strip(), 'order': r[3],
            'span': normalize_span(r[4]), 'rows': normalize_rows(r[5]),
            'content': str(r[6] or ''), 'fields': parse_content(r[6]),
            'note': str(r[7] or ''), 'enabled': True if r[8] is None else bool(r[8])}


def ensure_table(c):
    if TABLE in tables(c):
        return False
    cur = c.cursor()
    cur.execute('CREATE TABLE [帳票ブロックマスタ] ('
                '[ブロックID] INTEGER PRIMARY KEY AUTOINCREMENT, [設備名] TEXT, '
                '[ブロック名] TEXT, [表示順] INTEGER, [幅] INTEGER, [行数] INTEGER, '
                '[内容] TEXT, [備考] TEXT, [有効] INTEGER, '
                '[登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
    c.commit()
    return True


def block_rows(c, include_disabled=False):
    ensure_table(c)
    cur = c.cursor()
    cur.execute('SELECT [ブロックID],[設備名],[ブロック名],[表示順],[幅],[行数],[内容],[備考],[有効] '
                'FROM [帳票ブロックマスタ] ORDER BY [表示順],[ブロックID]')
    out = []
    for r in cur.fetchall():
        b = _row(r)
        if not b['enabled'] and not include_disabled:
            continue
        out.append(b)
    return out


def blocks_for_equipment(c, equipment):
    """その設備で使う塊だけ。判定は設備停止マスタと**同じ関数**を通す。"""
    from . import schedule_repo as sr
    eq = str(equipment or '').strip()
    out = []
    for b in block_rows(c):
        target = b['equipment']
        if not target or target == '*':
            out.append(b)
            continue
        if eq and sr.stop_equipment_matches(target, eq):
            out.append(b)
    return out


def block_upsert(c, uid, equipment='*', name='', order=None, span=6, rows=0,
                 content='', note='', enabled=True, block_id=None):
    ensure_table(c)
    name = str(name or '').strip()
    if not name:
        raise ValueError('ブロック名を入力してください。')
    equipment = str(equipment or '').strip() or '*'
    cur = c.cursor()
    # **並び順を渡していないときは今の値を残す**（§9.212 ②と同じ約束）。
    if order is None:
        if block_id is not None:
            cur.execute('SELECT [表示順] FROM [帳票ブロックマスタ] WHERE [ブロックID]=?', [int(block_id)])
        else:
            cur.execute('SELECT [表示順] FROM [帳票ブロックマスタ] WHERE [設備名]=? AND [ブロック名]=?',
                        [equipment, name])
        hit = cur.fetchone()
        if hit:
            order = hit[0]
    args = [equipment, name, order, normalize_span(span), normalize_rows(rows),
            str(content or ''), str(note or ''), -1 if enabled else 0]
    if block_id is not None:
        cur.execute('UPDATE [帳票ブロックマスタ] SET [設備名]=?,[ブロック名]=?,[表示順]=?,[幅]=?,'
                    '[行数]=?,[内容]=?,[備考]=?,[有効]=?,[更新者ID]=?,[更新日時]=Now() '
                    'WHERE [ブロックID]=?', args + [uid, int(block_id)])
        c.commit()
        return int(block_id)
    # 自然キーは(設備名,ブロック名)。**同じ設備に同じ名前を2つ置かない**
    # ——塊の並び・幅・高さは名前を鍵に列レイアウトマスタへ入るので、
    # 2つあるとどちらの設定か決まらない（§9.113と同じ理由）。
    cur.execute('SELECT [ブロックID] FROM [帳票ブロックマスタ] WHERE [設備名]=? AND [ブロック名]=?',
                [equipment, name])
    hit = cur.fetchone()
    if hit:
        cur.execute('UPDATE [帳票ブロックマスタ] SET [表示順]=?,[幅]=?,[行数]=?,[内容]=?,[備考]=?,'
                    '[有効]=?,[更新者ID]=?,[更新日時]=Now() WHERE [ブロックID]=?',
                    args[2:] + [uid, hit[0]])
        c.commit()
        return int(hit[0])
    if order is None:
        cur.execute('SELECT MAX([表示順]) FROM [帳票ブロックマスタ]')
        top = cur.fetchone()[0] or 0
        order = int(top) + 10
        args[2] = order
    cur.execute('INSERT INTO [帳票ブロックマスタ] '
                '([設備名],[ブロック名],[表示順],[幅],[行数],[内容],[備考],[有効],'
                '[登録者ID],[更新者ID],[登録日時],[更新日時]) '
                'VALUES (?,?,?,?,?,?,?,?,?,?,Now(),Now())', args + [uid, uid])
    c.commit()
    return int(cur.lastrowid)


def block_delete(c, block_id, uid):
    ensure_table(c)
    cur = c.cursor()
    cur.execute('DELETE FROM [帳票ブロックマスタ] WHERE [ブロックID]=?', [int(block_id)])
    c.commit()
    return cur.rowcount
