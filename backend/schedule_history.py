# -*- coding: utf-8 -*-
"""schedule_history.py: 作業スケジュールの過去履歴（§9.502）。**読むだけ**。

利用者の指示:「作業スケジュールの過去履歴を見る機能」「設備停止も含んだ形で記録のすべてを残し、
フィルタなども検索しやすいように」（案A＝段「履歴」）。

**材料は予定の表そのもの**（別表を作らない）。`作業予定`は行を物理的に消さない——外した予定は
`[有効]=0`で残る（`plan_delete`）ので、外した作業・終わって外した設備停止・申し送りも全部ここにある。

**時刻は出どころつきで返す**（推測で埋めない）:
 - 作業 … 測定データの実績（開始〜終了）→ 保存した完了突合の完了日時 → 最後に行を変えた日時
 - 設備停止 … 予定の表は**実際に止まった時刻を持たない**（並びから毎回「いまから」を計算するだけ）。
   分かるのは「入れた日時」「外した日時」「見積の分」なので、その3つをそのまま返す
 - 申し送り … 書いた日時
 - 計画外の実績 … 測定データの開始〜終了（予定の行が無い実績）
日付は**現場歴**（勤務の日付補正を当てた1日・§9.195）で束ねる。答えるのは`history()`の1箇所。
"""
import json
from datetime import datetime, timedelta, date

from . import schedule_calc as sc
from .repositories import schedule_repo as sr
from .repositories.master_repo import normalize_equipment_name
from .quiet import quiet

# 1回に返す期間の上限（日）。**青天井にしない**——予定の表は年単位で溜まる。
MAX_DAYS = 93
# 全期間から探すときに返す件数の上限（新しい順）。超えたら「もっと絞って」と言う。
MAX_FOUND = 500

# 区分。**語彙はここ1箇所**（画面は`cat`の鍵と字を使うだけ）。並びは画面の札の並び。
CATS = [
    {'key': 'done', 'label': '完了', 'note': '作業が終わったロット（測定データ・完了突合）'},
    {'key': 'cancel', 'label': '取消', 'note': '取消にした作業'},
    {'key': 'removed', 'label': '外した作業', 'note': '予定から外した作業（行は残っています）'},
    {'key': 'stop', 'label': '設備停止', 'note': '入れて、外した（終わった）設備停止'},
    {'key': 'comment', 'label': '申し送り', 'note': '予定の中に書いた申し送り'},
    {'key': 'unplanned', 'label': '計画外の実績', 'note': '予定に無いまま測定したロット'},
]
CAT_KEYS = [c['key'] for c in CATS]


def _dt(v):
    """DBの日時（文字列・datetime）を naive なローカル時刻へ。読めなければ None（落ちない）。"""
    if not v:
        return None
    if isinstance(v, datetime):
        return v
    try:
        return sc._parse_dt(str(v).strip())
    except ValueError as e:
        quiet('日時を読めない（その時刻は無いものとして扱う）', e)
        return None


def _iso(dt):
    return dt.isoformat(timespec='seconds') if dt else None


def _minutes(a, b):
    if not a or not b or b < a:
        return None
    return round((b - a).total_seconds() / 60.0, 1)


def _project(detail, keys):
    """明細（仕掛行の写し・200列ほど）から、画面が出す列だけを返す。全部運ぶと重い。"""
    return {k: detail[k] for k in keys if detail.get(k) not in (None, '')}


def _stop_sub(detail):
    """設備停止の内訳の字（§9.389）。1段目・2段目を「／」でつなぐ。"""
    parts = [str(detail.get('stopSub') or '').strip(), str(detail.get('stopSub2') or '').strip()]
    return '／'.join(p for p in parts if p)


def _field(mc, equipment):
    """現場歴の日付と直を答える関数と、直の並び（勤務区分マスタの順）。"""
    specific, global_ = sr.shift_rows(mc, equipment), sr.shift_rows(mc, '')
    rows = specific if specific else global_

    def of(dt):
        if dt is None:
            return None, None
        name, off = sc.resolve_shift_info(specific, global_, dt)
        return (dt + timedelta(days=off)).date().isoformat(), name
    return of, [str(r[2]) for r in (rows or [])]


def _base(r, detail, keys):
    """予定の表の1行の共通部分。"""
    created_at, updated_at = _dt(r[15]), _dt(r[16])
    active = True if r[14] is None else bool(r[14])
    return {'id': r[0], 'kind': str(r[3] or ''), 'lotNo': str(r[4] or ''), 'castingNo': str(r[6] or ''),
            'title': str(r[7] or ''), 'remark': str(r[13] or ''),
            'createdBy': str(r[19] or ''), 'createdPc': str(r[20] or ''), 'createdAt': _iso(created_at),
            'updatedBy': str(r[17] or ''), 'updatedPc': str(r[21] or ''), 'updatedAt': _iso(updated_at),
            'removed': not active, 'removedAt': None if active else _iso(updated_at),
            'estimateMinutes': r[10], 'start': None, 'end': None, 'minutes': None,
            'at': None, 'atSource': '', 'who': '', 'recordId': None, 'subText': '',
            'detail': _project(detail, keys), 'children': []}


def _touched(e):
    """時刻の手がかりが無いときの置き場: **最後に行を変えた日時**（出どころを言う）。"""
    e['at'] = e['updatedAt']
    e['atSource'] = '外した日時' if e['removed'] else '状態を変えた日時'


def _work(e, r, detail, actual):
    """作業の行。いまの予定に居る作業（予定・着手）は None（履歴ではない）。"""
    stored = str(r[11] or '')
    if actual is not None:
        st, en = _dt(actual.get('startAt')), _dt(actual.get('endAt'))
        e.update(start=_iso(st), end=_iso(en), minutes=_minutes(st, en), at=_iso(st or en),
                 atSource='測定データの実績', who=str(actual.get('createdBy') or ''), recordId=actual.get('id'))
        state = sc.derive_state(stored or None, actual)
    else:
        saved = sc.saved_actual_source(r[22]) if stored not in sc.PLAN_TERMINAL_STATES else None
        state = '完了' if saved else stored
        if saved:
            fin = _dt(saved['finishedAt'])
            e.update(end=_iso(fin), at=_iso(fin),
                     atSource=('完了突合（%s）' % saved['joinName']) if saved['joinName'] else '完了突合')
    if state == '完了':
        e['cat'] = 'done'
    elif state == '取消':
        e['cat'] = 'cancel'
    elif e['removed']:
        e['cat'] = 'removed'
    else:
        return None
    if not e['at']:
        _touched(e)
    return e


def _other(e, r, detail):
    """作業以外の行。いまの予定に居る設備停止・日付と直の枠は None。"""
    kind = e['kind']
    if kind == 'コメント':
        e.update(cat='comment', at=e['createdAt'], atSource='書いた日時')
        return e
    if kind == '設備停止':
        # **いまの予定に居る設備停止は履歴ではない**（並びの中でこれから起きる）。
        if not e['removed'] and str(r[11] or '') not in sc.PLAN_TERMINAL_STATES:
            return None
        e.update(cat='stop', subText=_stop_sub(detail), minutes=r[10])
        _touched(e)
        return e
    # 日付・直の枠（§9.238）は**並びの目印**で、起きたことの記録ではないので出さない。
    return None


def _unplanned(a, keys):
    st, en = _dt(a.get('startAt')), _dt(a.get('endAt'))
    basic = a.get('basic') or {}
    return {'id': sc.UNPLANNED_ID_PREFIX + str(a.get('id') or ''), 'kind': '作業', 'cat': 'unplanned',
            'lotNo': str(basic.get('lotNo') or ''), 'castingNo': str(basic.get('castingNo') or ''),
            'title': '', 'remark': '', 'removed': False, 'removedAt': None,
            'createdBy': str(a.get('createdBy') or ''), 'createdPc': str(a.get('createdPc') or ''),
            'createdAt': str(a.get('createdAt') or ''), 'updatedBy': str(a.get('updatedBy') or ''),
            'updatedPc': str(a.get('updatedPc') or ''), 'updatedAt': str(a.get('updatedAt') or ''),
            'estimateMinutes': None, 'start': _iso(st), 'end': _iso(en), 'minutes': _minutes(st, en),
            'at': _iso(st or en), 'atSource': '測定データの実績', 'who': str(a.get('createdBy') or ''),
            'recordId': a.get('id'), 'subText': '', 'detail': _project(basic, keys), 'children': []}


def _text_of(e):
    """探すときに見る字（ロット番号・名称・内訳・備考・担当・端末・明細の値）。"""
    parts = [e['lotNo'], e['castingNo'], e['title'], e['subText'], e['remark'], e['who'],
             e['createdBy'], e['createdPc'], e['updatedBy'], e['updatedPc'], ' '.join(e['children'])]
    parts += [str(v) for v in e['detail'].values()]
    return '\n'.join(p for p in parts if p).lower()


def matches(e, query):
    """空白で区切った語が**すべて**当たるか（AND）。画面の絞り込みと同じ規則。"""
    text = _text_of(e)
    return all(w in text for w in str(query or '').lower().split())


def history(c_share, mc, equipment, day_from=None, day_to=None, keys=None, actual_index=None, query='',
            anywhere=True, now=None):
    """`equipment`の、現場歴で`day_from`〜`day_to`（両端を含む・`date`）の履歴。

    **期間を渡さなければ「現場歴の今日」**（暦の今日ではない——3直の0時〜7時は前の日に入る）。
    期間は`MAX_DAYS`日までに切り詰め、切ったら`clipped`で言う（黙って切らない）。

    `query`があれば語で絞る（新しい順に`MAX_FOUND`件まで・`found`に総数）。`anywhere`が真なら
    **期間を見ずに全期間から**、偽なら期間の中だけ。**探す規則は`matches()`の1箇所**（画面は写さない）。

    戻り値: {'entries': [...], 'days': {日付: {区分: 件数}}, 'undated': 件数, 'shifts': [直の並び], 'cats': CATS,
             'from'／'to'／'today': 'YYYY-MM-DD', 'clipped': bool, 'query', 'found'}
    **`days`は期間に関係なく全日ぶん**（暦に件数を出すため。数えるだけなので軽い）。
    `undated`は日時の手がかりが1つも無い記録の数（黙って落とさず、画面が件数で言う）。
    """
    keys = [str(k) for k in (keys or []) if str(k)]
    field_of, shifts = _field(mc, equipment)
    today = date.fromisoformat(field_of(now or datetime.now())[0])
    day_to = day_to or day_from or today
    day_from = day_from or day_to
    if day_from > day_to:
        day_from, day_to = day_to, day_from
    clipped = (day_to - day_from).days + 1 > MAX_DAYS
    if clipped:
        day_from = day_to - timedelta(days=MAX_DAYS - 1)
    if actual_index is None:
        actual_index = sc.build_actual_index()
    rows = sr.plan_rows(c_share, equipment, include_inactive=True)
    children = {}
    for r in rows:
        if r[18] is not None:
            # 子ロット（§9.83）は親の明細行。**親の1件に束ねる**（単独の記録にしない）。
            children.setdefault(r[18], []).append(str(r[4] or ''))
    entries, matched = [], set()
    for r in rows:
        if r[18] is not None:
            continue
        try:
            detail = json.loads(r[8]) if r[8] else {}
        except ValueError as e:
            quiet('明細を読めない（空として扱う）', e)
            detail = {}
        e = _base(r, detail, keys)
        if e['kind'] == '作業':
            actual = sc.match_actual(actual_index, detail.get('lotNo') or r[4], detail.get('castingNo') or r[6],
                                     detail.get('mfgMaterial'))
            if actual is not None:
                matched.add(actual['key'])
            e = _work(e, r, detail, actual)
        else:
            e = _other(e, r, detail)
        if e is not None:
            e['children'] = children.get(r[0], [])
            entries.append(e)
    # 計画外の実績（§9.33）。予定の行（外したものも）に当たった実績は除く。
    target = normalize_equipment_name(equipment)
    for key, a in actual_index.items():
        if key in matched or not a.get('startAt'):
            continue
        if normalize_equipment_name(a.get('equipment') or '') == target:
            entries.append(_unplanned(a, keys))
    days, out, undated, found = {}, [], 0, 0
    lo, hi = day_from.isoformat(), day_to.isoformat()
    query = str(query or '').strip()
    for e in entries:
        e['fieldDate'], e['shift'] = field_of(_dt(e['at']))
        d = e['fieldDate']
        if d is None:
            undated += 1
            continue
        counts = days.setdefault(d, {})
        counts[e['cat']] = counts.get(e['cat'], 0) + 1
        in_period = lo <= d <= hi
        if query:
            if (anywhere or in_period) and matches(e, query):
                found += 1
                out.append(e)
        elif in_period:
            out.append(e)
    out.sort(key=lambda e: (e['at'] or '', str(e['id'])))
    if query:
        out = out[-MAX_FOUND:]
    return {'entries': out, 'days': days, 'undated': undated, 'shifts': shifts, 'cats': CATS,
            'from': lo, 'to': hi, 'today': today.isoformat(), 'clipped': clipped and not (query and anywhere),
            'query': query, 'found': found}


def parse_day(value, default=None):
    """'YYYY-MM-DD' を date へ。空・読めなければ既定（落ちない・黙らない）。"""
    if not value:
        return default
    try:
        return date.fromisoformat(str(value).strip())
    except ValueError as e:
        quiet('日付を読めない（既定の日で出す）', e)
        return default
