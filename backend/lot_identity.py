"""lot_identity.py: 同じロットを見分ける決まり（ロットの見分け方・§9.612）。

利用者の指示「ロットを消し込む処理の条件も見えないので、こちらも設定ができるように汎用化して組み込んでください。
過去の完了ロットと同じ番号が来たら同じロットナンバーを表示できない可能性もあるので条件も、ロット番号、鋳造番号、
製造材質、BOX番号といった組み合わせかつ複数回同一工程を通るものでも正しくスケジューリングで区別できるようにしたい」
→ 答え「区別の列も設定で選ぶ」。

・決まりは2つの列の並び: **鍵の列**（同じロットか）と**区別の列**（同じロットの何回目か。例: 前工程の終了日）。
  持つのはデータソースマスタの役割「仕掛」の行の`[ロット識別JSON]`（`{"keys":[…],"pass":[…]}`・空欄＝既定）。
・答えるのは`identity()`の1箇所。鍵を作るのは`key_of()`の1箇所——**予定の行**（明細＝入れたときの仕掛の行の写し）と
  **仕掛一覧の行**（`/api/table`が`__lotKey`を添える）の両方がここを通る。画面は鍵を作らず、比べるだけ。
・書き方の違い（全角・半角・大小・前後の空白）は同じと読む（`norm()`＝NFKC・前後の空白を落として大文字）。
・列の値は名前で引き、無ければ同じ意味の別名（`source_capability.FEATURE_ALIASES`）で引く（`ﾛｯﾄ番号`・`LTNO`…）。
"""
import json
import threading
import time
import unicodedata

from .quiet import quiet
from .sqlite_io import add_missing_columns, cols, connect, tables
from .source_capability import FEATURE_ALIASES

DEFAULT_KEYS = ('ロット番号', '鋳造番号', '製造材質')
COLUMN = 'ロット識別JSON'
SEP = '\x1f'
ROW_KEY = '__lotKey'   # 一覧の応答の行に添える鍵の名前（列ではない＝`columns`に載せない）
_CACHE_SEC = 20
_cache = {'at': 0.0, 'value': None}
_lock = threading.Lock()


def norm(value):
    """書き方の違いを同じと読む（NFKC・前後の空白を落として大文字）。"""
    return unicodedata.normalize('NFKC', str(value if value is not None else '')).strip().upper()


def _names(v):
    out = []
    for x in (v if isinstance(v, (list, tuple)) else []):
        n = str(x or '').strip()
        if n and n not in out:
            out.append(n)
    return out


def parse(raw):
    """保存値（JSON の文字列か dict）→ `{keys, pass, note, isDefault}`。読めない・空なら既定（理由は`note`）。"""
    note = ''
    v = raw
    if isinstance(v, str):
        t = v.strip()
        if not t:
            v = {}
        else:
            try:
                v = json.loads(t)
            except ValueError as e:
                note = f'ロットの見分け方を読めませんでした（{e}）。既定（{"・".join(DEFAULT_KEYS)}）で見分けます。'
                v = {}
    if not isinstance(v, dict):
        v = {}
    keys = _names(v.get('keys'))
    passes = [n for n in _names(v.get('pass')) if n not in keys]
    return {'keys': keys or list(DEFAULT_KEYS), 'pass': passes, 'note': note, 'isDefault': not keys and not passes}


def _alias_group(name):
    """その名前と同じ意味の列名（別名の表の1組＋画面の鍵の名前）。無ければその名前だけ。"""
    for key, group in FEATURE_ALIASES.items():
        if name == key or name in group:
            return [name] + [g for g in group if g != name] + ([key] if key != name else [])
    return [name]


def value_of(row, name):
    """行のその列の値（名前 → 同じ意味の別名の順）。無ければ ''。"""
    for n in _alias_group(name):
        v = row.get(n)
        if v is not None and str(v).strip() != '':
            return v
    return ''


def key_of(row, conf=None):
    """1行の鍵。鍵の列の先頭（ふつうはロット番号）が空なら ''（見分けられない＝どれとも同じにしない）。"""
    c = conf or identity()
    parts = [norm(value_of(row or {}, n)) for n in list(c['keys']) + list(c['pass'])]
    if not parts or not parts[0]:
        return ''
    return SEP.join(parts)


def attach(rows, conf=None):
    """一覧の行（dict の並び）へ鍵を添える（`ROW_KEY`）。列を絞る前の行で呼ぶ（鍵の列が出す列に無くても作れる）。"""
    c = conf or identity()
    for r in rows:
        r[ROW_KEY] = key_of(r, c)
    return rows


def _read():
    from .db_access import DBS, DATA_SOURCE_TABLE, PURPOSE_WORK   # 遅延: db_access は起動の途中で読むと輪になる
    try:
        with connect(DBS['MASTER']['path'], True) as c:
            if DATA_SOURCE_TABLE not in tables(c) or COLUMN not in set(cols(c, DATA_SOURCE_TABLE)):
                return parse('')
            cur = c.cursor()
            cur.execute(f'SELECT [{COLUMN}] FROM [{DATA_SOURCE_TABLE}] WHERE [役割]=? AND ([有効] IS NULL OR [有効]<>0)', [PURPOSE_WORK])
            r = cur.fetchone()
            return parse(r[0] if r else '')
    except Exception as e:
        quiet('ロットの見分け方を読めない（既定で見分ける）', e)
        return parse('')


def identity():
    """いま効いているロットの見分け方。**答えるのはここだけ**（短く控える・書いたら`forget()`）。"""
    with _lock:
        if _cache['value'] is not None and time.monotonic() - _cache['at'] < _CACHE_SEC:
            return _cache['value']
    v = _read()
    with _lock:
        _cache['value'] = v
        _cache['at'] = time.monotonic()
    return v


def forget():
    with _lock:
        _cache['value'] = None


def write(c, raw, uid):
    """役割「仕掛」の行へ書く（`c`＝マスタDBの書ける接続）。書いた値（`parse`の形）を返す。行が無ければ ValueError。"""
    from .db_access import DATA_SOURCE_TABLE, PURPOSE_WORK, ensure_data_source_table   # 遅延: 上と同じ
    ensure_data_source_table(c)
    add_missing_columns(c, DATA_SOURCE_TABLE, ((COLUMN, 'TEXT'),))
    v = parse(raw if isinstance(raw, (str, dict)) else '')
    saved = '' if v['isDefault'] else json.dumps({'keys': v['keys'], 'pass': v['pass']}, ensure_ascii=False)
    cur = c.cursor()
    cur.execute(f'UPDATE [{DATA_SOURCE_TABLE}] SET [{COLUMN}]=?,[更新者ID]=?,[更新日時]=Now() WHERE [役割]=?', [saved, uid, PURPOSE_WORK])
    if not cur.rowcount:
        raise ValueError('役割「仕掛」のデータソースがありません（データ接続で役割を付けてから決めてください）。')
    forget()
    return v
