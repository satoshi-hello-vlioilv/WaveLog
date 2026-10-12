"""stop_rule_repo.py: 設備停止の挿入条件（§9.588）——停止内容ごとの判定表。

利用者の指示:
  「設備停止項目に、できたスケジュールに設備停止の自動挿入もしくはそれに近い内容で、スケジュールを評価して
   不足している設備停止があれば、自動挿入か黄色などの目立つ色で警告して表示する機能を実装したいです。」
  「判定条件は設備停止マスタの設備停止ごとに持たせ、判定はスケジュールからロットが追加・削除、並び替えされる
   ごとに、ロットがもと居た場所の前後と新しく挿入された前後ロットの情報から判定します。」
  「条件は列のデータを組み合わせて条件テーブルを判定条件とし、その設備停止の挿入数、挿入すべきそれぞれの時間と
   自動挿入か、警告のみか選べるようにします。」

**表の作りは判定表**（刃組の保持方式・刃選択と同じ・`backend/rule_cells.py`）: 列＝境目の前後のロットの値、
行＝1つの決まり、右端＝答え（挿入数・それぞれの時間・自動で入れるか知らせるだけか）。上から最初に当たった行、
最後の行は「どれにも当てはまらないとき」（既定は 0本＝要らない）。

列（データ）は仕掛の列名に接頭辞を付けて読む（`STOP_RULE_SETS`の1箇所）:
  prev.<列>（前のロットの値）・next.<列>（後ろのロットの値）・
  chg.<列>（前と後ろで「変わる／同じ」）・diff.<列>（後ろ−前の数）
判定は画面（`static/js/schedule/stop-rules.js` → `WL.ruleCells.firstRule()`）の1本。ここは保存の前に整えるだけ。

**§9.590 で行の条件を「式」でも持てるようにした**（利用者の指示「一覧表にある表示列の『この列の作り方』のような
条件入力ができるとやりやすい」）。式は一覧の式と同じ書き方（`WL.formula`）で、名前は `[前.列]`（前のロット）・
`[後.列]`（後ろのロット）。組み立てる画面の選んだ形（`build`）も一緒に残し、開き直したときに同じ文で出す。
式を持つ行は式で判定し、セルの条件（`conditions`）は前の版の表のために読み続ける。
"""
import json

from ..db_access import add_missing_columns, cols, ensure_audit_columns, tables
from .. import rule_cells

TABLE = '設備停止挿入条件マスタ'
# (群の鍵, 接頭辞, 呼び名, 説明, 型, 選択肢)。**列の顔ぶれはここ1箇所**（画面は`vocab()`を読むだけ）。
STOP_RULE_SETS = (
    ('prev', 'prev.', '前のロット', '境目の前（先に流す）ロットの値', 'auto', ()),
    ('next', 'next.', '後ろのロット', '境目の後ろ（次に流す）ロットの値', 'auto', ()),
    ('chg', 'chg.', '変わったか', '前のロットと後ろのロットで値が「変わる」か「同じ」か', 'choice', ('変わる', '同じ')),
    ('diff', 'diff.', '差（後ろ−前）', '後ろのロットの値から前のロットの値を引いた数（どちらかが数でなければ空）', 'num', ()),
)
STOP_RULE_PREFIXES = tuple(p for _k, p, _l, _d, _t, _o in STOP_RULE_SETS)
# 答え: 動作。**自動で入れる**か、**知らせるだけ**か。
ACTION_AUTO = 'auto'
ACTION_WARN = 'warn'
# 呼び名は短く（表の右端の欄に入る長さ・「知らせる」が黄色の帯で提案することは盤の説明の1行が言う）。
STOP_RULE_ACTIONS = ((ACTION_WARN, '知らせる'), (ACTION_AUTO, '自動で入れる'))
COUNT_MAX = 9
MINUTES_MAX = 1440
# 式（§9.590）。長さは一覧の式と同じ上限（`list-formula.js`の`MAX_LEN`）。名前の頭は`FORMULA_PREFIXES`の2つだけ。
FORMULA_MAX = 2000
FORMULA_PREFIXES = (('前.', '前のロット'), ('後.', '後ろのロット'))
_BUILD_MAX = 4000


def field_ok(f):
    return any(rule_cells.prefixed_field(f, p) for p in STOP_RULE_PREFIXES)


def vocab():
    """画面へ渡す語彙（列の群・答えの選び方・上限）。"""
    return {'sets': [{'key': k, 'prefix': p, 'label': l, 'desc': d, 'kind': t, 'options': list(o)}
                     for k, p, l, d, t, o in STOP_RULE_SETS],
            'actions': [{'key': k, 'label': l} for k, l in STOP_RULE_ACTIONS],
            'ops': [{'op': o, 'label': l, 'two': o in rule_cells.RULE_OPS_2} for o, l in rule_cells.RULE_OPS],
            'countMax': COUNT_MAX, 'minutesMax': MINUTES_MAX,
            'formulaPrefixes': [{'prefix': p, 'label': l} for p, l in FORMULA_PREFIXES]}


def _int(v, lo, hi):
    try:
        n = int(float(str(v).strip()))
    except (TypeError, ValueError):
        return None
    return max(lo, min(hi, n))


def normalize_answer(r):
    """1行の答え → {count, minutes, action}。**時間は挿入数ぶんの並び**（足りなければ空＝その停止の標準の分）。"""
    count = _int((r or {}).get('count'), 0, COUNT_MAX) or 0
    raw = (r or {}).get('minutes')
    items = raw if isinstance(raw, list) else str(raw or '').replace('、', ',').split(',') if raw not in (None, '') else []
    mins = [_int(x, 1, MINUTES_MAX) if str(x).strip() not in ('', 'None') else None for x in items][:count]
    mins += [None] * (count - len(mins))
    action = (r or {}).get('action')
    return {'count': count, 'minutes': mins, 'action': action if action in (ACTION_AUTO, ACTION_WARN) else ACTION_WARN}


def _seed():
    return [{'conditions': [], 'formula': '', 'build': None, 'count': 0, 'minutes': [], 'action': ACTION_WARN, 'note': ''}]


def normalize_formula(v):
    """式（§9.590）。字の長さと改行だけ整える——**書き方を確かめるのは画面**（`WL.formula.check()`・一覧の式と同じ1本）。"""
    return ' '.join(str(v or '').split())[:FORMULA_MAX]


def normalize_build(v):
    """組み立てる画面の選んだ形（§9.590）。辞書だけを、長すぎなければそのまま残す（中身を読むのは画面）。"""
    if not isinstance(v, dict):
        return None
    try:
        text = json.dumps(v, ensure_ascii=False)
    except (TypeError, ValueError):
        return None
    return v if len(text) <= _BUILD_MAX else None


def _tidy(rows):
    """条件のある行を上から、**条件の無い行は最後の1つだけ**既定として残す（無ければ0本の既定を足す）。"""
    out, default = [], None
    for r in rows if isinstance(rows, list) else []:
        if not isinstance(r, dict):
            continue
        formula = normalize_formula(r.get('formula'))
        row = dict(normalize_answer(r), conditions=[] if formula else rule_cells.normalize_conditions(r.get('conditions'), field_ok),
                   formula=formula, build=normalize_build(r.get('build')) if formula else None,
                   note=str(r.get('note') or '').strip()[:200])
        if row['conditions'] or row['formula']:
            out.append(row)
        else:
            default = row
    return out + [default or _seed()[0]]


def ensure_table(c):
    if TABLE not in tables(c):
        c.execute(f'CREATE TABLE [{TABLE}] ([条件ID] INTEGER PRIMARY KEY AUTOINCREMENT, [停止理由ID] INTEGER, '
                  '[条件JSON] TEXT, [挿入数] INTEGER, [時間JSON] TEXT, [動作] TEXT, [備考] TEXT, [列JSON] TEXT, '
                  '[表示順] INTEGER, [有効] INTEGER, [登録日時] DATETIME, [更新日時] DATETIME)')
        c.execute(f'CREATE INDEX [IX_{TABLE}_停止] ON [{TABLE}] ([停止理由ID],[表示順])')
        c.commit()
    add_missing_columns(c, TABLE, (('列JSON', 'TEXT'), ('式', 'TEXT'), ('組立JSON', 'TEXT')))
    ensure_audit_columns(c, TABLE)


def _loads(v, default):
    try:
        x = json.loads(v or '')
    except (TypeError, ValueError):
        return default
    return x if isinstance(x, type(default)) else default


def rules_all(c):
    """停止理由IDごとの表 → {id: {'rows','cols','stored'}}。**読み取り専用の接続でも読む**（表が無ければ空）。"""
    if TABLE not in tables(c):
        return {}
    cur = c.cursor()
    # 式の2列は§9.590で足した——読み取り専用の接続では`ensure_table()`が足せないので、無ければ空として読む。
    have = set(cols(c, TABLE, use_cache=False))
    fx = '[式]' if '式' in have else "''"
    bj = '[組立JSON]' if '組立JSON' in have else "''"
    cur.execute(f'SELECT [停止理由ID],[条件JSON],[挿入数],[時間JSON],[動作],[備考],[列JSON],{fx},{bj} FROM [{TABLE}] '
                'WHERE [有効] IS NULL OR [有効]<>0 ORDER BY [停止理由ID],[表示順],[条件ID]')
    by = {}
    for sid, cj, n, mj, act, note, colj, fv, bv in cur.fetchall():
        b = by.setdefault(int(sid), {'rows': [], 'cols': _loads(colj, [])})
        b['rows'].append({'conditions': _loads(cj, []), 'formula': fv or '', 'build': _loads(bv, {}) or None,
                          'count': n, 'minutes': _loads(mj, []), 'action': act, 'note': note or ''})
    out = {}
    for sid, b in by.items():
        rows = _tidy(b['rows'])
        out[sid] = {'rows': rows, 'cols': rule_cells.table_cols(b['cols'], rows, field_ok), 'stored': True}
    return out


def rules_for(c, stop_id):
    """1つの停止内容の表。未登録は既定の1行（0本＝要らない）。"""
    got = rules_all(c).get(int(stop_id))
    return got or {'rows': _seed(), 'cols': [], 'stored': False}


def rules_replace(c, stop_id, rows, cols, uid):
    """1つの停止内容の表を**丸ごと置き換える**（判定表の盤は表1枚を保存する・§9.530）。"""
    ensure_table(c)
    tidy = _tidy(rows)
    cj = json.dumps(rule_cells.table_cols(cols, tidy, field_ok), ensure_ascii=False)
    c.execute(f'DELETE FROM [{TABLE}] WHERE [停止理由ID]=?', [int(stop_id)])
    for i, r in enumerate(tidy):
        c.execute(f'INSERT INTO [{TABLE}] ([停止理由ID],[条件JSON],[式],[組立JSON],[挿入数],[時間JSON],[動作],[備考],[列JSON],'
                  '[表示順],[有効],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,?,?,?,?,?,?,?,-1,?,?,Now(),Now())',
                  [int(stop_id), json.dumps(r['conditions'], ensure_ascii=False), r['formula'],
                   json.dumps(r['build'], ensure_ascii=False) if r['build'] else '', r['count'],
                   json.dumps(r['minutes']), r['action'], r['note'], cj, (i + 1) * 10, uid, uid])
    return len(tidy)


def rules_reset(c, stop_id):
    """未登録に戻す（既定の1行＝要らない）。"""
    ensure_table(c)
    c.execute(f'DELETE FROM [{TABLE}] WHERE [停止理由ID]=?', [int(stop_id)])


def rules_copy(c, src_id, dst_id, uid):
    """停止内容を複製したときに表も写す（§9.400「持っているもの全部」）。登録が無ければ何もしない。"""
    got = rules_all(c).get(int(src_id))
    if got:
        rules_replace(c, dst_id, got['rows'], got['cols'], uid)
