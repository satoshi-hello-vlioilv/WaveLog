"""table_def.py: マスタ1表の列定義を**1箇所**で持つ（§9.324 R1）。

以前は1つの表について、
  ・`CREATE TABLE`の列（新しいDB）
  ・`_ADDED_COLUMNS`（後から足した列を「無ければ足す」）
  ・`SELECT [a],[b],...`の並び（読む）
  ・`_row(r)`の`r[N]`（位置で読む。`len(r)>N`の守りつき）
  ・UPDATE／INSERTの列の並びと`args`（書く）
の5つがそれぞれ別の場所に書かれていた。列を1つ足すたびに5箇所を同じ順で
直す必要があり、実際に**`CREATE`だけが古いまま**で、新しいDBでは最初の1回だけ
`no such column: 繰返`（帳票ブロック）／`no such column: 役割`（操業データ項目）で
落ちていた（2回目は`add_missing_columns()`が足すので通る＝「リロードすると直る」）。

ここでは**列の並びを1つのタプルで持ち**、CREATE・足す・SELECT・辞書化・
UPDATE・INSERTを全部そこから作る。**読むのは名前**（`d['繰返']`）で、
位置では読まない。

約束:
  ・`columns`は`(列名, 型)`の並びで、**鍵と監査列は含めない**（鍵は`key`、
    監査列は`AUDIT`が持つ）。
  ・`fetch()`は**在る列だけで読む**——読み取り専用の接続では列を足せない
    （§9.221 ③の`choice_rows()`）ので、無い列は`None`で埋めて返す。
    「表が無い」は空の並び。
  ・`insert()`／`update()`は渡した辞書の鍵だけを書く。**知らない列は断る**
    （綴りの間違いが黙って捨てられないように）。監査列はここが書く。
  ・`add_missing()`は`db_access.add_missing_columns()`を通す（§9.315。
    同時に走っても壊れない窓口はあちらの1箇所）。
"""
from ..db_access import add_missing_columns, tables, cols

AUDIT = (('登録者ID', 'TEXT'), ('更新者ID', 'TEXT'),
         ('登録日時', 'DATETIME'), ('更新日時', 'DATETIME'))


def _q(name):
    return '[' + str(name).replace(']', ']]') + ']'


class TableDef:
    def __init__(self, table, key, columns, order_by=''):
        self.table = str(table)
        self.key = str(key)
        self.columns = tuple((str(n), str(t)) for n, t in columns)
        self.names = tuple(n for n, _ in self.columns)
        self.order_by = order_by
        dup = [n for n in self.names if self.names.count(n) > 1]
        if dup or self.key in self.names or any(n in self.names for n, _ in AUDIT):
            raise ValueError(f'{self.table}: 列名が重なっています: {sorted(set(dup))}')

    # ---- 作る・足す ----------------------------------------------------
    def create_sql(self):
        parts = [f'{_q(self.key)} INTEGER PRIMARY KEY AUTOINCREMENT']
        parts += [f'{_q(n)} {t}' for n, t in self.columns]
        parts += [f'{_q(n)} {t}' for n, t in AUDIT]
        return f'CREATE TABLE {_q(self.table)} (' + ', '.join(parts) + ')'

    def exists(self, c):
        return self.table in tables(c)

    def create(self, c, commit=True):
        c.cursor().execute(self.create_sql())
        if commit:
            c.commit()

    def add_missing(self, c, commit=True):
        """無い列だけ足す。戻り値は実際に足した列名（§9.315と同じ約束）。"""
        return add_missing_columns(c, self.table, self.columns + AUDIT, commit=commit)

    # ---- 読む ----------------------------------------------------------
    def all_names(self):
        return (self.key,) + self.names + tuple(n for n, _ in AUDIT)

    def select_sql(self, where='', order_by=None, names=None):
        names = tuple(names) if names is not None else self.all_names()
        sql = 'SELECT ' + ','.join(_q(n) for n in names) + f' FROM {_q(self.table)}'
        if where:
            sql += ' WHERE ' + where
        ob = self.order_by if order_by is None else order_by
        if ob:
            sql += ' ORDER BY ' + ob
        return sql

    def fetch(self, c, where='', args=(), order_by=None):
        """行を**列名を鍵にした辞書**で返す。**在る列だけで読む**（無い列は
        `None`）——読み取り専用の接続では列を足せないため。表が無ければ空。"""
        if not self.exists(c):
            return []
        have = set(cols(c, self.table))
        names = [n for n in self.all_names() if n in have]
        ob = self.order_by if order_by is None else order_by
        if ob:
            # 並びの鍵も**在る列だけ**（古い表に無い列で並べようとして落ちない）。
            keep = [t for t in ob.split(',')
                    if not any(f'[{n}]' in t for n in self.all_names() if n not in have)]
            ob = ','.join(keep)
        cur = c.cursor()
        cur.execute(self.select_sql(where, ob, names), list(args))
        rows = cur.fetchall()
        missing = [n for n in self.all_names() if n not in have]
        out = []
        for r in rows:
            d = dict(zip(names, r))
            for n in missing:
                d[n] = None
            out.append(d)
        return out

    def get(self, c, key_value):
        rows = self.fetch(c, f'{_q(self.key)}=?', [key_value], order_by='')
        return rows[0] if rows else None

    # ---- 書く ----------------------------------------------------------
    def _check(self, vals):
        bad = [k for k in vals if k not in self.names]
        if bad:
            raise ValueError(f'{self.table}: 知らない列です: {bad}')

    def insert(self, c, vals, uid, commit=True):
        """`vals`の鍵だけを書き、監査列はここが書く。戻り値は新しい鍵。"""
        self._check(vals)
        keys = list(vals)
        sql = (f'INSERT INTO {_q(self.table)} ('
               + ','.join(_q(k) for k in keys)
               + ',[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES ('
               + ','.join('?' for _ in keys) + ',?,?,Now(),Now())')
        cur = c.cursor()
        cur.execute(sql, [vals[k] for k in keys] + [uid, uid])
        if commit:
            c.commit()
        return int(cur.lastrowid)

    def update(self, c, key_value, vals, uid, commit=True):
        """`vals`の鍵だけを書く（**渡していない列は今の値のまま**・§9.212 ②）。"""
        self._check(vals)
        keys = list(vals)
        sql = (f'UPDATE {_q(self.table)} SET '
               + ','.join(f'{_q(k)}=?' for k in keys)
               + f',[更新者ID]=?,[更新日時]=Now() WHERE {_q(self.key)}=?')
        cur = c.cursor()
        cur.execute(sql, [vals[k] for k in keys] + [uid, key_value])
        if commit:
            c.commit()
        return cur.rowcount
