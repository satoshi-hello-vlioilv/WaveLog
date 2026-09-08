"""actual_match.py: 仕掛から消えたロットを「実績」で突き合わせる（§9.364）。

------------------------------------------------------------------------
利用者の指示:「作業スケジュール表に組んだロットが、仕掛データから消えた
場合は、作業完了または作業開始したものとして扱いたい。…「実績」という
ジャンルを1つ追加します。このデータが設定ある場合、仕掛データから消えた
ロットを「実績」から「ロット番号」と「鋳造番号」と「前工程実績_作業終了_
日付」の組み合わせで検索し、対象のロットがHITした場合、作業完了とし、
スケジュールデータにHITした実績データを保存して…このキーの組み合わせは
後から変更できるようにしてほしいです。」

**判定はサーバーの1箇所**（§9.260と同じ作法）。画面はキーの文字列も列名も
持たない——持たせると、突合キーを変えた端末だけ挙動が違う状態が作れる。

**読むだけで1件も書き換えない。** 保存（HITした実績をスケジュールへ残す）は
書込役の端末が `with_write` を通して行う（§4.2）——読む側は写しに書かない
（§9.325）。

**開ける前に存在を確かめない**（CLAUDE.md）。共有越しでは stat だけが失敗
することがあり、確認のつもりの1行が唯一の失敗原因になる。読めなければ
「分からない」を返す（fail-open）——実績が読めないことを理由に、予定の
状態を勝手に動かさない。
------------------------------------------------------------------------
"""
import threading
import unicodedata

from .db_access import (cfg, connect, tables, cols,
                        WORK_DB_KEY, ACTUAL_DB_KEY, actual_match_keys)
from .logging_setup import app_logger
from .quiet import quiet


def norm_value(v):
    """突合のための正規化。全角/半角・大小・前後の空白のゆれを吸収する
    （CLAUDE.md「フィールド名」と同じ考え方）。日付は文字列のまま比べる
    ——書式を勝手に解釈すると、片方だけ解釈できたときに黙って外れる。"""
    return unicodedata.normalize('NFKC', str(v if v is not None else '')).strip().upper()


def norm_name(s):
    return unicodedata.normalize('NFKC', str(s or '')).strip().lower()


def _pick_column(columns, name):
    """列名を1つ引く。完全一致 → 正規化一致の順。**部分一致はしない**
    ——突合キーは利用者が明示した名前なので、近い名前へ勝手に寄せない。"""
    if name in columns:
        return name
    return {norm_name(c): c for c in columns}.get(norm_name(name))


def _table_of(entry, c):
    names = tables(c)
    if not names:
        return ''
    pref = str(entry.get('preferred') or '')
    return pref if pref in names else names[0]


_cache = {'work': None, 'actual': None}
_lock = threading.Lock()


def _stamp(path):
    """そのファイルの版。**中身が変わっていなければ作り直さない**（§9.198）
    ——予定を1回開くたびに仕掛と実績を全件読み直すと、行が増えるほど遅く
    なる（一番たちの悪い形で出る）。"""
    try:
        st = path.stat()
        return (str(path), st.st_mtime_ns, st.st_size)
    except Exception as _e:
        quiet('データソースの版を読めない（毎回読み直す）', _e)
        return (str(path), 0, 0)


def _load(key, key_names, want_rows):
    """そのデータソースを開いて、突合キー -> 行 の索引を作る。

    戻り値: (索引, 使えた列名の並び, エラー文字列)。列が1つも無ければ
    索引は空で、`使えた列`も空——**呼ぶ側は「分からない」として扱う**。"""
    if not key:
        return {}, [], ''
    try:
        entry = cfg(key)
    except Exception as e:
        return {}, [], f'読み込み先が決まっていません: {e}'
    try:
        with connect(entry['path'], entry.get('role') == 'readonly') as c:
            table = _table_of(entry, c)
            if not table:
                return {}, [], 'ファイルは開けましたが、表が1つもありません。'
            columns = list(cols(c, table, source=entry['path']))
            used = [(n, _pick_column(columns, n)) for n in key_names]
            used = [(n, col) for n, col in used if col]
            if not used:
                return {}, [], ('突合キーの列が1つも見つかりません（探した名前: '
                                + '／'.join(key_names) + '）。')
            quoted = ','.join('[' + col + ']' for _n, col in used)
            index = {}
            if want_rows:
                # 中身も残すので全列を読む（HITした行をそのまま保存するため）。
                sel = ','.join('[' + c2 + ']' for c2 in columns)
                cur = c.execute(f'SELECT {sel} FROM [{table}]')
                pos = {n: columns.index(col) for n, col in used}
                for r in cur.fetchall():
                    k = tuple(norm_value(r[pos[n]]) for n, _c in used)
                    if any(x == '' for x in k):
                        continue
                    index[k] = {columns[i]: r[i] for i in range(len(columns))}
            else:
                cur = c.execute(f'SELECT {quoted} FROM [{table}]')
                for r in cur.fetchall():
                    k = tuple(norm_value(v) for v in r)
                    if any(x == '' for x in k):
                        continue
                    index[k] = True
            return index, [n for n, _c in used], ''
    except Exception as e:
        app_logger().warning('データソース「%s」を突合のために読めませんでした: %s', key, e)
        return {}, [], f'読み込みに失敗しました: {e}'


def _cached(slot, key, key_names, want_rows):
    if not key:
        return {}, [], ''
    try:
        path = cfg(key)['path']
    except Exception as e:
        return {}, [], f'読み込み先が決まっていません: {e}'
    token = (_stamp(path), tuple(key_names), want_rows)
    with _lock:
        hit = _cache.get(slot)
        if hit and hit[0] == token:
            return hit[1], hit[2], hit[3]
    index, used, err = _load(key, key_names, want_rows)
    with _lock:
        _cache[slot] = (token, index, used, err)
    return index, used, err


def forget():
    """控えを捨てる（設定を変えた直後・検証用）。"""
    with _lock:
        _cache['work'] = None
        _cache['actual'] = None


def plan_values(entry_detail, plan_row, key_names):
    """予定の側の値。**明細（投入時の仕掛行の写し）を先に見て、無ければ
    予定そのものの列**（ロット番号・検査番号・鋳造番号）で補う。

    1つでも空なら None を返す——**足りない鍵で突き合わせない**。
    片方だけの鍵で当てにいくと、別のロットへ当たる。"""
    detail = entry_detail if isinstance(entry_detail, dict) else {}
    fallback = {'ロット番号': (plan_row or {}).get('lotNo'),
                '検査番号': (plan_row or {}).get('inspectionNo'),
                '鋳造番号': (plan_row or {}).get('castingNo')}
    norm_detail = {norm_name(k): v for k, v in detail.items()}
    out = []
    for name in key_names:
        v = detail.get(name)
        if v in (None, ''):
            v = norm_detail.get(norm_name(name))
        if v in (None, ''):
            v = fallback.get(name)
        v = norm_value(v)
        if not v:
            return None
        out.append(v)
    return tuple(out)


def describe():
    """いまの突合の設定と、読めているかどうか。画面と網が見る1箇所。"""
    keys = actual_match_keys()
    work_index, work_used, work_err = _cached('work', WORK_DB_KEY, keys, False)
    actual_index, actual_used, actual_err = _cached('actual', ACTUAL_DB_KEY, keys, True)
    return {'matchKeys': keys,
            'workKey': WORK_DB_KEY or '', 'actualKey': ACTUAL_DB_KEY or '',
            'workColumns': work_used, 'actualColumns': actual_used,
            'workRows': len(work_index), 'actualRows': len(actual_index),
            'workError': work_err, 'actualError': actual_err,
            'ready': bool(WORK_DB_KEY) and not work_err and bool(work_used)}


def lookup(entry_detail, plan_row):
    """1件ぶんの判定。戻り値は dict:

      {'missing': True/False, 'actual': 行 or None, 'reason': 説明}

    `missing` が None のときは**判定できなかった**（読めない・鍵が足りない）。
    そのときは呼ぶ側が状態を1つも動かさない——分からないことを、分かった
    ことにしない。"""
    keys = actual_match_keys()
    if not WORK_DB_KEY:
        return {'missing': None, 'actual': None,
                'reason': '役割「仕掛」のデータソースがありません。'}
    work_index, work_used, work_err = _cached('work', WORK_DB_KEY, keys, False)
    if work_err or not work_used:
        return {'missing': None, 'actual': None,
                'reason': work_err or '仕掛に突合キーの列がありません。'}
    k = plan_values(entry_detail, plan_row, work_used)
    if k is None:
        return {'missing': None, 'actual': None,
                'reason': '予定の側に突合キー（' + '／'.join(work_used) + '）の値が揃っていません。'}
    if k in work_index:
        return {'missing': False, 'actual': None, 'reason': '仕掛にあります。'}
    if not ACTUAL_DB_KEY:
        return {'missing': True, 'actual': None,
                'reason': '仕掛から消えています（役割「実績」のデータソースは設定されていません）。'}
    actual_index, actual_used, actual_err = _cached('actual', ACTUAL_DB_KEY, keys, True)
    if actual_err or not actual_used:
        return {'missing': True, 'actual': None,
                'reason': '仕掛から消えています（実績を読めません: '
                          + (actual_err or '突合キーの列がありません') + '）。'}
    ka = plan_values(entry_detail, plan_row, actual_used)
    hit = actual_index.get(ka) if ka is not None else None
    if hit is None:
        return {'missing': True, 'actual': None,
                'reason': '仕掛から消えていますが、実績に見つかりません（'
                          + '／'.join(actual_used) + 'で検索）。'}
    return {'missing': True, 'actual': hit,
            'reason': '実績に見つかりました（' + '／'.join(actual_used) + 'で一致）。'}
