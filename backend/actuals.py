"""actuals.py: 実績データリストと操業データ表のための「1件＝1作業」の行(§9.241 ②③)。

============================================================
利用者の指示（2件）:
 ・メインメニューに「実績」のデータをリストとして表示する機能。**設備単位で
   切り替えて対象期間のデータを一覧**で確認できること。データ一覧の「完了」
   とは別扱いで**閲覧のみ**（＝閲覧権限で扱える）。データ一覧の完了は表示
   データ数が少ないが、こちらは**作業時に記録した全データ**を扱う。
 ・各設備別で操業データ表（帳票）を、**日ごとまたは日＋直ごとに1枚**。

なぜサーバーが持つか
------------------------------------------------------------
**「日＋直」を決められるのはサーバーだけ**（§9.163・§9.195）。時刻→直の判定は
`schedule_calc.resolve_shift_info()` の1箇所しか無く、画面へ写すと答えが2つに
なる。現場日（`workDate`）も `schedule_calc` が1箇所でまとめて決める約束なので、
測定レコード側でも**同じ関数を通す**（代表時刻の決め方だけが違う）。

**読むのは`merged_backup_rows()`**——この端末のDB(`records.sqlite3`)と閲覧用の
複製の両方を記録IDで突き合わせた実績なので、書込端末でも閲覧専用端末でも
同じものが見える（§9.202）。データ一覧が端末内(IndexedDB)を混ぜるのと違い、
実績データリストは**編集しない**ので混ぜない——混ぜると「保存を押していない
途中経過」が実績として紙に出る。

payload を解くのは高くつくので覚える
------------------------------------------------------------
1件のペイロードは測定値まで入った完全なJSONで、設備1つぶんでも数百件になる。
**記録IDと更新時刻を鍵に、解いた結果だけを覚える**（中身が変わらないかぎり
解き直さない）。覚えるのは**軽い抜粋だけ**で、測定値の本体は持たない
（持つと端末のメモリに全件が乗る）。

**読むだけ。書き込みは一切しない。**
============================================================
"""
import json
import threading
from datetime import timedelta

from . import schedule_calc
from .db_access import merged_backup_rows
from .repositories import schedule_repo as sr

# 解いた抜粋の覚え。{記録ID: (署名, 抜粋)}。署名は「更新日時＋レコード自身の
# 更新時刻」で、どちらかが動いたら解き直す。**上限は持たない**——1件あたり
# 数百バイトで、記録IDの数はそのまま現場の作業件数（数万でも数MB）。
_cache = {}
_lock = threading.Lock()

# レコードから運ぶ設定のうち、**重いものは落とす**。子ロットの控えや測定の
# 対象外一覧は1件で数百KBになることがあり、一覧にも紙にも出さない。
_HEAVY_SETTINGS = ('splitSourcesCache', 'splitGroups', 'measureScope')


def _sig(row):
    return (row.get('updated_at') or '', row.get('record_updated_at') or '')


def _payload(row):
    """ペイロードをJSONとして解く。**解けなくても行は返す**（fail-open）
    ——1件の壊れたレコードで一覧ごと開けなくなるほうが困る。"""
    raw = row.get('payload')
    if not raw:
        return None
    try:
        obj = json.loads(raw)
        return obj if isinstance(obj, dict) else None
    except Exception:
        return None


def _slim_settings(settings):
    if not isinstance(settings, dict):
        return {}, {}
    op = settings.get('opData')
    op = dict(op) if isinstance(op, dict) else {}
    out = {k: v for k, v in settings.items()
           if k not in _HEAVY_SETTINGS and k != 'opData'
           and not isinstance(v, (dict, list))}
    return out, op


def _extract(row):
    """1件の抜粋（直・現場日はまだ入れない。設備ごとの勤務行が要るため）。"""
    p = _payload(row) or {}
    basic = p.get('basic') if isinstance(p.get('basic'), dict) else {}
    settings, op = _slim_settings(p.get('settings'))
    wt = p.get('workTime') if isinstance(p.get('workTime'), dict) else {}
    # **設備は使用設備（測定した端末の登録設備）を先に見る**（§9.162の2系統）。
    # 共有DBの[設備]列も同じ意味なので、行の値を最優先にする。
    equipment = (str(row.get('equipment') or '').strip()
                 or str(settings.get('registeredEquipment') or '').strip()
                 or str(p.get('registeredEquipment') or '').strip()
                 or str(basic.get('equipment') or '').strip())
    return {
        'id': row.get('id') or '',
        'equipment': equipment,
        'lotNo': row.get('lotNo') or basic.get('lotNo') or '',
        'inspectionNo': row.get('inspectionNo') or basic.get('inspectionNo') or '',
        'castingNo': row.get('castingNo') or basic.get('castingNo') or '',
        'status': row.get('status') or p.get('status') or '',
        'updatedAt': row.get('record_updated_at') or '',
        'updatedAtDb': row.get('updated_at') or '',
        'createdAt': row.get('created_at') or '',
        'createdBy': row.get('created_by') or '',
        'createdPc': row.get('created_pc') or '',
        'updatedBy': row.get('updated_by') or '',
        'updatedPc': row.get('updated_pc') or '',
        'workStart': str(wt.get('startAt') or ''),
        'workEnd': str(wt.get('endAt') or ''),
        'basic': basic,
        'settings': settings,
        'opData': op,
        # ペイロードが解けたかどうか。**「操業データが無い」と「読めなかった」を
        # 混ぜない**——紙で空欄が続いたときに、どちらなのかを画面が言えるように。
        'readable': bool(p),
    }


def _duration_min(start, end):
    a = schedule_calc._parse_dt(start) if start else None
    b = schedule_calc._parse_dt(end) if end else None
    if not a or not b:
        return None
    m = (b - a).total_seconds() / 60.0
    return round(m, 1) if m >= 0 else None


def _shift_rows_for(conn, equipment, memo):
    """設備ごとの勤務行。**1回引いたら使い回す**——1件ごとに引くと、
    設備1つの一覧でも記録の数だけマスタを開くことになる。"""
    key = equipment or ''
    if key not in memo:
        try:
            memo[key] = sr.shift_rows(conn, key)
        except Exception:
            memo[key] = []
    return memo[key]


def _with_shift(item, conn, memo, global_rows):
    """現場日と直を足す。**代表時刻は作業開始→作業終了→更新時刻の順**。

    予定側（`schedule_calc` の `workDate`）は「完了・取消なら実績、他は予定
    開始」だが、実績には予定が無いので**記録された事実だけ**から決める。
    どの時刻から決めたかは `workDateFrom` で必ず言う（同じ日付でも当たる
    見込みが違う・§CLAUDE 6）。
    """
    ref, src = '', ''
    for value, name in ((item.get('workStart'), 'start'),
                        (item.get('workEnd'), 'end'),
                        (item.get('updatedAt') or item.get('updatedAtDb'), 'updated')):
        if value:
            ref, src = value, name
            break
    dt = None
    if ref:
        try:
            dt = schedule_calc._parse_dt(ref)
        except Exception:
            dt = None
    item['durationMin'] = _duration_min(item.get('workStart'), item.get('workEnd'))
    if dt is None:
        item['workDate'] = None
        item['calDate'] = None
        item['shift'] = ''
        item['shiftDayOffset'] = 0
        item['workDateFrom'] = ''
        return item
    spec = _shift_rows_for(conn, item.get('equipment'), memo)
    name, off = schedule_calc.resolve_shift_info(spec, global_rows, dt)
    item['shift'] = name or ''
    item['shiftDayOffset'] = int(off or 0)
    item['calDate'] = dt.date().isoformat()
    item['workDate'] = (dt + timedelta(days=int(off or 0))).date().isoformat()
    item['workDateFrom'] = src
    item['refAt'] = ref
    return item


def rows(equipment=None, date_from=None, date_to=None, basis='work', force=False):
    """実績の行。**絞り込みはここだけ**（画面に同じ判定を書かない）。

    equipment: 設備名。空なら全設備。
    date_from/date_to: 'YYYY-MM-DD'（両端を含む）。空なら制限なし。
    basis: 'work'＝現場歴で切る（既定）／'cal'＝太陽暦で切る。
           **紙と画面で切り方を変えないこと**（日ごとに配る紙の件数が
           画面と合わなくなる・§9.195）。
    """
    all_rows = merged_backup_rows(force=force) or []
    eq = str(equipment or '').strip()
    eq_norm = sr.normalize_equipment_name(eq) if eq else ''
    out = []
    conn = None
    memo = {}
    global_rows = []
    try:
        try:
            sr.migrate_config_masters_from_shared()
        except Exception:
            pass
        try:
            conn = sr.config_master_conn()
            global_rows = sr.shift_rows(conn, '')
        except Exception:
            conn = None
        for row in all_rows:
            rid = row.get('id')
            if not rid:
                continue
            sig = _sig(row)
            with _lock:
                hit = _cache.get(rid)
            if hit and hit[0] == sig:
                item = dict(hit[1])
            else:
                item = _extract(row)
                with _lock:
                    _cache[rid] = (sig, item)
                item = dict(item)
            if eq_norm and sr.normalize_equipment_name(item.get('equipment')) != eq_norm:
                continue
            item = _with_shift(item, conn, memo, global_rows)
            key = item.get('calDate') if basis == 'cal' else item.get('workDate')
            if date_from and (not key or key < date_from):
                continue
            if date_to and (not key or key > date_to):
                continue
            out.append(item)
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass
    # 新しい順（作業開始が無い行は更新時刻で並ぶ）。**画面で並べ直せる**ので
    # ここは1本だけ持つ。
    out.sort(key=lambda x: (x.get('refAt') or '', x.get('id') or ''), reverse=True)
    return out


def equipments(force=False):
    """実績が1件でもある設備の一覧。**設備マスタと突き合わせない**——
    マスタから消した設備の実績も見られる必要がある（履歴なので）。"""
    seen = {}
    for row in (merged_backup_rows(force=force) or []):
        name = str(row.get('equipment') or '').strip()
        if not name:
            continue
        seen[name] = seen.get(name, 0) + 1
    return [{'name': k, 'count': v} for k, v in sorted(seen.items())]


def lot_fields():
    """仕掛（ロットの情報）の列の**呼び名**。語彙はサーバーだけが持つ（§9.163）
    ——`operation_repo.AUTO_VALUES` の `lot.*` をそのまま使う。画面へ写すと、
    項目を足したときに2箇所直すことになる。"""
    from .repositories import operation_repo as op
    out = []
    for key, label, _group, unit, _note in op.AUTO_VALUES:
        if not key.startswith('lot.'):
            continue
        out.append({'key': key[4:], 'label': label, 'unit': unit or ''})
    return out


def forget():
    """解いた抜粋を捨てる（検証用・データを入れ替えたとき）。"""
    with _lock:
        _cache.clear()
