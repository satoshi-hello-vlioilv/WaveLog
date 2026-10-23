"""dashboard_repo.py: ダッシュボードの組み（ダッシュボードマスタ）と設備グループ（設備グループマスタ）の置き場（§9.628）。

どちらも master.sqlite3 の1表（列は`TableDef`の1箇所）。中身の決まりは`backend/dashboard/layout.py`（組み）と
`backend/dashboard/equip_groups.py`（グループ）が持ち、ここは読む・書く・版（`[版]`）の突き合わせだけ。

行の形（画面と中身の決まりが読む）: {id, rev, updated_at, updated_by, <列名>…}。版は書くたびに 1 つ上がり、直す・消すときに
画面が持っている版（base_rev）と違えば`Conflict`（ほかの PC が先に直した・§9.613 と同じ考え方）。
"""
from .table_def import TableDef

DASHBOARD = TableDef('ダッシュボードマスタ', 'ダッシュボードID',
                     (('名前', 'TEXT'), ('元', 'TEXT'), ('範囲', 'TEXT'), ('ログインID', 'TEXT'), ('標準', 'TEXT'),
                      ('中身', 'TEXT'), ('備考', 'TEXT'), ('版', 'INTEGER')), order_by='[ダッシュボードID]')
EQUIP_GROUP = TableDef('設備グループマスタ', 'グループID',
                       (('名称', 'TEXT'), ('まとめ方', 'TEXT'), ('設備', 'TEXT'), ('ルール', 'TEXT'), ('表示順', 'INTEGER'),
                        ('備考', 'TEXT'), ('版', 'INTEGER')), order_by='[表示順],[グループID]')


class Conflict(Exception):
 """画面が持っている版が今の版と違う（ほかの PC が先に直した・消した）。row は今の行（消えていれば None）"""

 def __init__(self, row):
  super().__init__('ほかの PC が先に直しました。読み直してから、もう一度直してください。')
  self.row = row


class NotFound(LookupError):
 pass


def ensure(c):
 for t in (DASHBOARD, EQUIP_GROUP):
  if not t.exists(c):
   t.create(c, commit=False)
  else:
   t.add_missing(c, commit=False)
 c.commit()


def _view(t, d):
 """表の行 → 中身の決まりが読む形（id・rev・updated_at・updated_by）"""
 out = {k: ('' if v is None else v) for k, v in d.items() if k not in (t.key, '版', '登録者ID', '更新者ID', '登録日時', '更新日時')}
 out.update(id=d[t.key], rev=int(d.get('版') or 1), updated_at=str(d.get('更新日時') or ''),
            updated_by={'id': d.get('更新者ID') or ''} if d.get('更新者ID') else {})
 for k in ('標準', '表示順'):
  if k in out:
   out[k] = '' if out[k] in (None, '') else str(out[k])
 return out


def rows(c, t):
 return [_view(t, d) for d in t.fetch(c)]


def _find(c, t, item_id):
 d = t.get(c, item_id)
 return _view(t, d) if d else None


def _check_rev(row, base_rev):
 if base_rev is not None and int(row.get('rev') or 1) != int(base_rev):
  raise Conflict(row)


def _vals(t, data):
 return {k: (v if k == '表示順' and v not in ('', None) else ('' if v is None else str(v))) for k, v in data.items() if k in t.names}


def create(c, t, data, uid):
 ensure(c)
 new = t.insert(c, {**_vals(t, data), '版': 1}, uid, commit=False)
 return new


def update(c, t, item_id, data, uid, base_rev=None):
 ensure(c)
 old = _find(c, t, item_id)
 if old is None:
  if base_rev is not None:
   raise Conflict(None)
  raise NotFound(f'id={item_id} が見つかりません（ほかの PC が消した可能性があります）。')
 _check_rev(old, base_rev)
 t.update(c, item_id, {**_vals(t, data), '版': int(old.get('rev') or 1) + 1}, uid, commit=False)
 return item_id


def delete(c, t, item_id, base_rev=None):
 ensure(c)
 old = _find(c, t, item_id)
 if old is None:
  return False
 _check_rev(old, base_rev)
 c.cursor().execute(f'DELETE FROM [{t.table}] WHERE [{t.key}]=?', [item_id])
 return True


def get(c, t, item_id):
 return _find(c, t, item_id) if t.exists(c) else None
