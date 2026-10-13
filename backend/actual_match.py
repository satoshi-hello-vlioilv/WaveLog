"""actual_match.py: 仕掛から消えたロットを、登録した突合で探す（§9.364・§9.365）。

------------------------------------------------------------------------
利用者の指示（§9.364）:「作業スケジュール表に組んだロットが、仕掛データから
消えた場合は、作業完了または作業開始したものとして扱いたい。…対象のロットが
HITした場合、作業完了とし、スケジュールデータにHITした実績データを保存して…
このキーの組み合わせは後から変更できるようにしてほしいです。」

続けて（§9.365）:「クエリ結合のようなスタイルでデータをキーで突合せする汎用
スタイルにしてほしい。結合後に、どのデータを使えるようにするか…も選べるように」
——**突合の定義そのものは`クエリ結合マスタ`（用途＝完了突合）が持つ**。ここは
その定義を読んで、1件ぶんの判定を答えるだけ:

  ① 予定のロットは、まだ仕掛にあるか      （定義の「左」のキー列で見る）
  ② 消えていたら、相手のどの行に当たるか  （定義の「右」のキー列で探す）
  ③ 当たった行から、何を持ち帰るか        （取り込む列・接頭辞・完了日時列）

**判定はサーバーの1箇所**（§9.260と同じ作法）。画面はキーの文字列も列名も
持たない——持たせると、突合キーを変えた端末だけ挙動が違う状態が作れる。

**読むだけで1件も書き換えない。** 保存（HITした行をスケジュールへ残す）は
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

from . import query_join
from .db_access import (cfg, cfg_for, connect, no_pattern_file_text, pattern_files,
                        source_pattern, tables, cols, WORK_DB_KEY)
# 「定義の持ちもの」は定義を持つ側にある(§9.365)。ここから呼ぶ名前は
# **同じ関数**——2つ置くと、片方だけ直した状態が作れる。
from .query_join import finish_time_of, parse_finish_time, start_time_of, take_columns
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


def _table_of(entry, want, c):
    """読む表を決める。定義に書いてあればそれ、無ければ既定テーブル→先頭。"""
    names = tables(c)
    if not names:
        return ''
    want = str(want or '').strip()
    if want:
        return want if want in names else ''
    pref = str(entry.get('preferred') or '')
    return pref if pref in names else names[0]


# ---- 読み込み（版が変わらなければ作り直さない）--------------------------
# `want_rows`の3つ目の値。同じ鍵が2行以上あれば None を入れる（仕掛の行を引くとき）。
UNIQUE_ROWS = 'unique'
_cache = {}
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


def _source(key, equipment):
    """読む先の設定。**設備ごとのファイルの相手（§9.595）はその設備の1ファイル**——
    「実績_＊＊＊.sqlite3」の＊＊＊が予定の設備と一致するものだけを突き合わせる。"""
    if source_pattern(key):
        return cfg_for(key, equipment)
    return cfg(key)


def _load(key, table, key_names, want_rows, equipment=''):
    """そのデータソースを開いて、突合キー -> 行 の索引を作る。

    戻り値: (索引, 使えた列名の並び, エラー文字列)。列が1つも無ければ
    索引は空で、`使えた列`も空——**呼ぶ側は「分からない」として扱う**。"""
    if not key:
        return {}, [], ''
    try:
        entry = _source(key, equipment)
    except Exception as e:
        return {}, [], f'読み込み先が決まっていません: {e}'
    try:
        with connect(entry['path'], entry.get('role') == 'readonly') as c:
            t = _table_of(entry, table, c)
            if not t:
                return {}, [], (f'表「{table}」がありません。' if table
                                else 'ファイルは開けましたが、表が1つもありません。')
            columns = list(cols(c, t, source=entry['path']))
            used = [(n, _pick_column(columns, n)) for n in key_names]
            used = [(n, col) for n, col in used if col]
            if not used:
                return {}, [], ('突合キーの列が1つも見つかりません（探した名前: '
                                + '／'.join(key_names) + '）。')
            index = {}
            if want_rows:
                # 中身も残すので全列を読む（当たった行をそのまま保存するため）。
                sel = ','.join('[' + c2 + ']' for c2 in columns)
                cur = c.execute(f'SELECT {sel} FROM [{t}]')
                pos = {n: columns.index(col) for n, col in used}
                for r in cur.fetchall():
                    k = tuple(norm_value(r[pos[n]]) for n, _c in used)
                    if any(x == '' for x in k):
                        continue
                    if want_rows == UNIQUE_ROWS and k in index:
                        # 1行に決まらない鍵は「分からない」(§9.595)。どちらかを選ばない。
                        index[k] = None
                        continue
                    index[k] = {columns[i]: r[i] for i in range(len(columns))}
            else:
                quoted = ','.join('[' + col + ']' for _n, col in used)
                cur = c.execute(f'SELECT {quoted} FROM [{t}]')
                for r in cur.fetchall():
                    k = tuple(norm_value(v) for v in r)
                    if any(x == '' for x in k):
                        continue
                    index[k] = True
            return index, [n for n, _c in used], ''
    except Exception as e:
        app_logger().warning('データソース「%s」を突合のために読めませんでした: %s', key, e)
        return {}, [], f'読み込みに失敗しました: {e}'


def _cached(key, table, key_names, want_rows, equipment=''):
    """版が同じなら読み直さない。**控えの鍵に列の並びまで入れる**——
    突合キーを変えた直後に前の索引を使うと、変えていないように見える。
    設備ごとのファイル（§9.595）は設備も鍵に入れる（設備ごとに別のファイル）。"""
    if not key:
        return {}, [], ''
    if not source_pattern(key):
        equipment = ''
    try:
        path = _source(key, equipment)['path']
    except Exception as e:
        return {}, [], f'読み込み先が決まっていません: {e}'
    slot = (key, str(table or ''), tuple(key_names), want_rows, equipment)
    token = _stamp(path)
    with _lock:
        hit = _cache.get(slot)
        if hit and hit[0] == token:
            return hit[1], hit[2], hit[3]
    index, used, err = _load(key, table, key_names, want_rows, equipment)
    with _lock:
        _cache[slot] = (token, index, used, err)
    return index, used, err


def forget():
    """控えを捨てる（設定を変えた直後・検証用）。"""
    with _lock:
        _cache.clear()


# ---- 予定の側の値 ------------------------------------------------------
def plan_values(entry_detail, plan_row, key_names):
    """予定の側の値。**明細（投入時の仕掛行の写し）を先に見て、無ければ
    予定そのものの列**（ロット番号・検査番号・鋳造番号）で補い、それでも
    無ければ**いまの仕掛の行**から読む（§9.595）。

    最後の段は、明細に後から突合キーに足した列（BOX番号など）が無いときのため
    ——明細は予定へ入れた時点の写しなので、そのあと足した列は入っていない。
    仕掛の行は**ロット番号・鋳造番号で1行に決まったときだけ**使う（`work_row()`）。

    1つでも空なら None を返す——**足りない鍵で突き合わせない**。
    片方だけの鍵で当てにいくと、別のロットへ当たる。"""
    detail = entry_detail if isinstance(entry_detail, dict) else {}
    fallback = {'ロット番号': (plan_row or {}).get('lotNo'),
                '検査番号': (plan_row or {}).get('inspectionNo'),
                '鋳造番号': (plan_row or {}).get('castingNo')}
    norm_detail = {norm_name(k): v for k, v in detail.items()}
    out = []
    work = None
    for name in key_names:
        v = detail.get(name)
        if v in (None, ''):
            v = norm_detail.get(norm_name(name))
        if v in (None, ''):
            v = fallback.get(name)
        if v in (None, ''):
            if work is None:
                work = work_row(detail, plan_row) or {}
            v = work.get(name)
            if v in (None, ''):
                v = {norm_name(k): x for k, x in work.items()}.get(norm_name(name))
        v = norm_value(v)
        if not v:
            return None
        out.append(v)
    return tuple(out)


# 仕掛の行を引く鍵（予定の行がいつも持っている2つ）。
WORK_ROW_KEYS = ('ロット番号', '鋳造番号')


def work_row(entry_detail, plan_row):
    """予定のロットの、**いまの仕掛の行**（全列）。1行に決まらなければ None。

    鍵はロット番号＋鋳造番号（予定の行がいつも持つ2つ）。仕掛の表に鋳造番号の
    列が無ければロット番号だけで引く。読めない・同じ鍵が2行以上あるなら None
    （推測しない）。"""
    if not WORK_DB_KEY:
        return None
    detail = entry_detail if isinstance(entry_detail, dict) else {}
    index, used, err = _cached(WORK_DB_KEY, '', list(WORK_ROW_KEYS), UNIQUE_ROWS)
    if err or not used or 'ロット番号' not in used:
        return None
    vals = []
    for name in used:
        v = detail.get(name)
        if v in (None, ''):
            v = {'ロット番号': (plan_row or {}).get('lotNo'),
                 '鋳造番号': (plan_row or {}).get('castingNo')}.get(name)
        v = norm_value(v)
        if not v:
            return None
        vals.append(v)
    return index.get(tuple(vals))


# ---- 1件ぶんの判定 -----------------------------------------------------
def _left_keys(d):
    return [str(k.get('left') or '') for k in (d.get('keys') or []) if k.get('left')]


def _right_keys(d):
    return [str(k.get('right') or '') for k in (d.get('keys') or []) if k.get('right')]


def _pair_map(d):
    """左の列名 -> 右の列名。左のキーで作った値の並びを、右の並びへ直す。"""
    return {str(k.get('left') or ''): str(k.get('right') or '') for k in (d.get('keys') or [])}


def _in_work(d, entry_detail, plan_row):
    """この定義のキーで見て、予定のロットが仕掛にまだあるか。

    戻り値: (True/False/None, 理由)。**None は「分からない」**——読めない・
    鍵が足りないときで、呼ぶ側は状態を1つも動かさない。"""
    names = _left_keys(d)
    if not names:
        return None, '突合キーが登録されていません。'
    index, used, err = _cached(WORK_DB_KEY, d.get('leftTable'), names, False)
    if err or not used:
        return None, err or '仕掛に突合キーの列がありません。'
    k = plan_values(entry_detail, plan_row, used)
    if k is None:
        return None, '予定の側に突合キー（' + '／'.join(used) + '）の値が揃っていません。'
    return (k in index), ''


def _equipment_of(plan_row):
    """予定の行の設備名（設備ごとのファイルを選ぶ鍵・§9.595）。"""
    return str((plan_row or {}).get('equipment') or '').strip()


def _find_right(d, entry_detail, plan_row):
    """相手のデータで探す。戻り値: (当たった行 or None, 使った列, 理由)。"""
    right_key = str(d.get('right') or '')
    if not right_key:
        return None, [], '相手のデータソースが登録されていません。'
    names = _right_keys(d)
    if not names:
        return None, [], '突合キーが登録されていません。'
    index, used, err = _cached(right_key, d.get('rightTable'), names, True,
                               _equipment_of(plan_row))
    if err or not used:
        return None, [], err or '相手に突合キーの列がありません。'
    # 予定の側の値は**左の列名**で取り、右の並びへ直す（左右で名前が違って
    # よいのがこの仕組みの値打ち。§9.365）。
    back = {}
    for left, right in _pair_map(d).items():
        back.setdefault(right, left)
    want_left = [back.get(n, n) for n in used]
    k = plan_values(entry_detail, plan_row, want_left)
    if k is None:
        return None, used, '予定の側に突合キー（' + '／'.join(want_left) + '）の値が揃っていません。'
    return index.get(k), used, ''


def _right_summary(d):
    """相手の側が読めているか（describe用）。設備ごとのファイルなら全部の設備を足し合わせる。"""
    key = d.get('right')
    names = _right_keys(d)
    if not source_pattern(key):
        index, used, err = _cached(key, d.get('rightTable'), names, True)
        return len(index), used, err, []
    rows, used, errs, files = 0, [], [], []
    for equip, _path in sorted(pattern_files(key).values()):
        index, u, err = _cached(key, d.get('rightTable'), names, True, equip)
        rows += len(index)
        used = used or u
        files.append({'equipment': equip, 'rows': len(index), 'error': err})
        if err:
            errs.append(f'{equip}: {err}')
    if not files:
        errs.append(no_pattern_file_text(key))
    return rows, used, ('／'.join(errs[:3]) if errs and not used else ''), files


def describe():
    """いまの完了突合の設定と、読めているかどうか。画面と網が見る1箇所。"""
    defs = query_join.finish_definitions()
    out = []
    for d in defs:
        left_index, left_used, left_err = _cached(WORK_DB_KEY, d.get('leftTable'), _left_keys(d), False)
        right_rows, right_used, right_err, files = _right_summary(d)
        out.append({
            'id': d.get('id'), 'name': d.get('name') or '', 'builtin': bool(d.get('builtin')),
            'left': d.get('left') or '', 'right': d.get('right') or '',
            'keys': list(d.get('keys') or []),
            'columns': list(d.get('columns') or []), 'prefix': d.get('prefix') or '',
            'finishColumn': d.get('finishColumn') or '',
            'startColumn': d.get('startColumn') or '',
            'finishWhen': d.get('finishWhen') or FINISH_WHEN_GONE,
            'workColumns': left_used, 'actualColumns': right_used,
            'workRows': len(left_index), 'actualRows': right_rows, 'actualFiles': files,
            'workError': left_err, 'actualError': right_err,
            'ready': bool(WORK_DB_KEY) and not left_err and bool(left_used),
        })
    return {'workKey': WORK_DB_KEY or '', 'definitions': out,
            'configured': bool(defs),
            # 画面と網が「いま何で突き合わせているか」を1つの並びで読めるように。
            'matchKeys': (_left_keys(defs[0]) if defs else []),
            'ready': any(x['ready'] for x in out)}


# 完了突合の「いつ完了にするか」(§9.595)。語彙は`master_repo.QUERY_JOIN_FINISH_WHEN`。
FINISH_WHEN_GONE = 'gone'
FINISH_WHEN_HIT = 'hit'


def _hit_result(d, hit, used, missing, reason):
    """当たった行から返す形（2つの道で同じ）。"""
    return {'missing': missing, 'complete': True, 'actual': take_columns(d, hit),
            'startedAt': start_time_of(d, hit), 'finishedAt': finish_time_of(d, hit),
            'joinName': d.get('name') or '', 'finishWhen': d.get('finishWhen') or FINISH_WHEN_GONE,
            'reason': reason or (f"「{d.get('name')}」に見つかりました（" + '／'.join(used) + 'で一致）。')}


def lookup(entry_detail, plan_row):
    """1件ぶんの判定。戻り値は dict:

      {'missing': True/False/None, 'complete': 完了にするか, 'actual': 持ち帰った値 or None,
       'startedAt': ISO文字列 or '', 'finishedAt': ISO文字列 or '', 'joinName': 定義名,
       'finishWhen': 'gone'/'hit', 'reason': 説明}

    完了にする道は2つ（§9.595）:
      ⓪ 「実績に当たったら」の定義 … **仕掛を見ずに**相手で探し、当たれば完了
         （利用者の指示。実績が先に届き、仕掛から消えるのは後になる運用のため）
      ①② 「仕掛から消えたら」の定義 … 仕掛から消え、相手に当たれば完了（§9.364）

    `missing` が None のときは**判定できなかった**（読めない・鍵が足りない）。
    そのときは呼ぶ側が状態を1つも動かさない——分からないことを、分かった
    ことにしない。"""
    blank = {'missing': None, 'complete': False, 'actual': None, 'startedAt': '',
             'finishedAt': '', 'joinName': '', 'finishWhen': '', 'reason': ''}
    if not WORK_DB_KEY:
        return dict(blank, reason='役割「仕掛」のデータソースがありません。')
    defs = query_join.finish_definitions()
    if not defs:
        return dict(blank, reason='完了突合の設定がありません'
                                  '（マスタ管理 > クエリ結合で「完了突合」を1件登録します）。')
    reasons = []
    # ⓪ 当たったら完了の定義が先（表示順）。
    for d in defs:
        if (d.get('finishWhen') or FINISH_WHEN_GONE) != FINISH_WHEN_HIT:
            continue
        hit, used, why = _find_right(d, entry_detail, plan_row)
        if hit:
            return _hit_result(d, hit, used, None, '')
        if why:
            reasons.append(f"{d.get('name')}: {why}")
    # ① まだ仕掛にあるか。**1つでも「ある」と言えば動かさない**——消えたと
    #    決めるのは、全部の定義が「無い」と言えたときだけ（作業中のロットを
    #    完了にしてしまわないため）。
    decided = False
    for d in defs:
        present, why = _in_work(d, entry_detail, plan_row)
        if present is True:
            return dict(blank, missing=False, joinName=d.get('name') or '',
                        reason=('／'.join(reasons) + '／' if reasons else '') + '仕掛にあります。')
        if present is False:
            decided = True
        elif why:
            reasons.append(f"{d.get('name')}: {why}")
    if not decided:
        return dict(blank, reason='／'.join(reasons) or '仕掛を読めませんでした。')
    # ② 相手で探す。**先に当たった定義が正**（表示順）。⓪で探した定義も探し直す
    #    （控えから引くだけ）——消えたロットはどの定義で当たっても完了。
    for d in defs:
        hit, used, why = _find_right(d, entry_detail, plan_row)
        if hit:
            return _hit_result(d, hit, used, True, '')
        if why and (d.get('finishWhen') or FINISH_WHEN_GONE) != FINISH_WHEN_HIT:
            reasons.append(f"{d.get('name')}: {why}")
    return dict(blank, missing=True,
                reason='仕掛から消えていますが、突合先に見つかりません'
                       + (('（' + '／'.join(reasons) + '）') if reasons else '。'))


# **再公開**（§9.365）。突合の入口はここなので、`actual_match.take_columns()`
# のような呼び方も通るようにしておく。実体は`query_join`の1つだけ。
__all__ = ['norm_value', 'norm_name', 'plan_values', 'work_row', 'take_columns', 'finish_time_of',
           'start_time_of', 'parse_finish_time', 'describe', 'lookup', 'forget']
