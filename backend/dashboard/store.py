"""store.py: ダッシュボードの組み・セット・外した組み込み・設備グループを読む・書く（§9.628。LotScope の routes/dashboard.py の保存の所）。

置き場は master.sqlite3 の`ダッシュボードマスタ`（元 dash＝組み・dashset＝セット・dashoff＝外した組み込み）と`設備グループマスタ`
（`repositories/dashboard_repo.py`）。中身の決まりは`layout.py`・`equip_groups.py`。ここは決まりを当てて書くだけ:
    名前は置き場（元・範囲・持ち主）ごとに1つ・★標準は置き場ごとに1つ（立てたら同じ置き場のほかの★を降ろす）
    書いてよいか（`Who.gate()`）: 共通デフォルト＝開発者・共通＝現場のマスタを書ける端末・自分だけ＝本人。切断中は書かない
"""
from ..repositories import dashboard_repo as repo
from ..textnorm import normalize_equipment_name as normalize_part
from . import equip_groups, layout

DASH, GROUP = repo.DASHBOARD, repo.EQUIP_GROUP
SCOPE_ORDER = {'me': 0, 'all': 1, 'default': 2}


class Forbidden(PermissionError):
 pass


class Who:
 """この問い合わせの人: login（ログインID）・common（共通を書けるか）・default（共通デフォルトを書けるか＝開発者）・revoked（切断中）"""

 def __init__(self, login, common, default, revoked=None):
  self.login, self.common, self.default, self.revoked = str(login or ''), bool(common), bool(default), revoked

 def gate(self, row, what='ダッシュボード'):
  if self.revoked:
   raise Forbidden(f'この端末は一時的に切断されています。{what}を書き換えられません。')
  if layout.can_edit(row, self.login, self.common, self.default):
   return
  scope = layout.scope_of(row)
  raise Forbidden(f'全員の既定の{what}を書き換えられるのは、開発者だけです。全員（共通）か自分だけに保存してください。' if scope == 'default'
                  else f'全員（共通）の{what}を書き換えられるのは、マスタを書ける端末（マスタ編集が「部分的編集可」以上）だけです。自分だけに保存してください。'
                  if scope == 'all' else f'ほかの ID の{what}は書き換えられません。')


def _rows(c):
 return repo.rows(c, DASH) if DASH.exists(c) else []


def _check_name(rows, data, self_id=None):
 g = layout.group_of(data)
 for r in rows:
  if r.get('id') != self_id and layout.group_of(r) == g and normalize_part(r.get('名前')) == normalize_part(data.get('名前')):
   what = {layout.LAYOUT_SOURCE: 'ダッシュボード', layout.SET_SOURCE: 'セット'}.get(data.get('元'), '組み')
   raise layout.LayoutError(f'{what}「{data.get("名前")}」はもうあります。上書きするか、別の名前にしてください。')


def _write(c, item_id, data, uid, base_rev=None):
 """作る（item_id が None）・直す。★標準を立てたら、同じ置き場のほかの★を降ろす（1回の書き込みで）。→ 書いた行"""
 rows = _rows(c)
 if item_id is None:
  _check_name(rows, data)
  item_id = repo.create(c, DASH, data, uid)
 else:
  old = repo.get(c, DASH, item_id)
  if old is not None:
   _check_name(rows, {**old, **data}, item_id)
  repo.update(c, DASH, item_id, data, uid, base_rev)
 row = repo.get(c, DASH, item_id)
 if row.get('標準') == '1':
  g = layout.group_of(row)
  for r in _rows(c):
   if r['id'] != item_id and r.get('標準') == '1' and layout.group_of(r) == g:
    repo.update(c, DASH, r['id'], {'標準': ''}, uid)
 return repo.get(c, DASH, item_id)


def _find(c, item_id, source):
 row = repo.get(c, DASH, item_id)
 if row is None or row.get('元') != source:
  what = 'セット' if source == layout.SET_SOURCE else 'ダッシュボード'
  raise repo.NotFound(f'{what} id={item_id} が見つかりません（ほかの PC が消した可能性があります）。')
 return row


# ---------------------------------------------------------------- ダッシュボードの組み
def layouts(c, who):
 """並び（自分の ID → 共通 → 共通デフォルト〈置いた物 → 組み込み〉）と、いま開く標準（standardId）"""
 every = _rows(c)
 rows = [r for r in every if r.get('元') == layout.LAYOUT_SOURCE and layout.visible(r, who.login)]
 std = layout.standard_for(rows, layout.LAYOUT_SOURCE, who.login)
 items = sorted((layout.layout_view(layout.with_builtin_replace(r), who.login, who.common, who.default) for r in rows),
                key=lambda x: (SCOPE_ORDER[x['scope']], x['name']))
 off, swapped = layout.builtin_skip(every, who.login)
 items += layout.builtin_layouts(skip=set(off) | swapped)
 for x in items:
  if x['body'].get('replaces'):
   x['replaces'] = f"b:{x['body']['replaces']}"
 names = {b['key']: b['name'] for b in layout.BUILTIN_LAYOUTS}
 # ★標準が無ければ組み込みの「標準」（入れ替えた物ならその行）。それも外していれば並びの先頭
 first = next((x['id'] for x in items if 'b:standard' in (x['id'], x.get('replaces'))), items[0]['id'] if items else None)
 return {'items': items, 'login': who.login, 'canEditCommon': who.common, 'canEditDefault': who.default,
         'standardId': std.get('id') if std else first,
         'cols': layout.GRID_COLS, 'rowsRange': [layout.ROWS_MIN, layout.ROWS_MAX],
         'hidden': [{'id': f'b:{k}', 'name': names.get(k, k), 'scope': sc} for k, sc in off.items()]}


def layout_create(c, who, data):
 row = layout.with_builtin_replace(layout.clean_layout_row(data, who.login))
 who.gate(row)
 return layout.layout_view(_write(c, None, row, who.login), who.login, who.common, who.default)


def layout_update(c, who, item_id, data, base_rev):
 old = _find(c, item_id, layout.LAYOUT_SOURCE)
 who.gate(old)
 row = layout.with_builtin_replace(layout.clean_layout_row(data, who.login, partial=True), old)
 row = {k: v for k, v in row.items() if k in ('名前', '中身', '標準', '備考')}
 return layout.layout_view(_write(c, item_id, row, who.login, base_rev), who.login, who.common, who.default)


def remove(c, who, item_id, base_rev, source):
 row = repo.get(c, DASH, item_id)
 if row is not None and row.get('元') == source:
  who.gate(row, 'セット' if source == layout.SET_SOURCE else 'ダッシュボード')
  repo.delete(c, DASH, item_id, base_rev)
 return {'ok': True}


def hide_builtins(c, who, scope, keys):
 """組み込みのダッシュボードを外す・戻す。scope: default（開発者。全員の一覧から）| me（自分の一覧から）。keys が空なら全部戻す"""
 if scope not in ('default', 'me'):
  raise layout.LayoutError('置き場（default か me）が違います。')
 want = {'元': layout.HIDE_SOURCE, '範囲': layout.SCOPES[scope], 'ログインID': who.login if scope == 'me' else ''}
 who.gate(want, '組み込みのダッシュボード')
 old = next((r for r in _rows(c) if layout.group_of(r) == layout.group_of(want)), None)
 keys = layout.clean_hide_body({'keys': keys or []})[0]['keys']
 if not keys:
  if old:
   repo.delete(c, DASH, old['id'])
  return {'ok': True, 'keys': []}
 row = layout.clean_hide_row({'name': layout.HIDE_NAME, 'scope': scope, 'body': {'keys': keys}}, who.login)
 if old:
  repo.update(c, DASH, old['id'], {'中身': row['中身']}, who.login)
 else:
  repo.create(c, DASH, row, who.login)
 return {'ok': True, 'keys': keys}


# ---------------------------------------------------------------- セット
def sets(c, who):
 rows = [r for r in _rows(c) if r.get('元') == layout.SET_SOURCE and layout.visible(r, who.login)]
 std = layout.standard_for(rows, layout.SET_SOURCE, who.login)
 items = sorted((layout.set_view(r, who.login, who.common, who.default) for r in rows), key=lambda x: (SCOPE_ORDER[x['scope']], x['name']))
 return {'items': items, 'standardId': std.get('id') if std else None, 'login': who.login, 'canEditCommon': who.common,
         'canEditDefault': who.default, 'max': layout.MAX_SET_ITEMS}


def set_create(c, who, data):
 row = layout.clean_set_row(data, who.login)
 who.gate(row, 'ダッシュボードのセット')
 return layout.set_view(_write(c, None, row, who.login), who.login, who.common, who.default)


def set_update(c, who, item_id, data, base_rev):
 who.gate(_find(c, item_id, layout.SET_SOURCE), 'ダッシュボードのセット')
 row = {k: v for k, v in layout.clean_set_row(data, who.login, partial=True).items() if k in ('名前', '中身', '標準', '備考')}
 return layout.set_view(_write(c, item_id, row, who.login, base_rev), who.login, who.common, who.default)


# ---------------------------------------------------------------- 設備グループ
def group_rows(c):
 return repo.rows(c, GROUP) if GROUP.exists(c) else []


def _check_group(rows, data, self_id=None):
 msg = equip_groups.check_unique(rows, data, self_id)
 if msg:
  raise equip_groups.GroupError(msg)


def group_create(c, uid, body):
 data = equip_groups.clean_row(body)
 rows = group_rows(c)
 _check_group(rows, data)
 if not str(data.get('表示順') or '').strip():
  data['表示順'] = max((int(r.get('表示順') or 0) for r in rows if str(r.get('表示順') or '').lstrip('-').isdigit()), default=0) + 10
 return repo.create(c, GROUP, data, uid)


def group_update(c, uid, item_id, body, base_rev):
 data = equip_groups.clean_row(body, partial=True)
 old = repo.get(c, GROUP, item_id)
 if old is not None and ('名称' in data or 'まとめ方' in data):
  _check_group(group_rows(c), {**old, **data}, item_id)
 repo.update(c, GROUP, item_id, data, uid, base_rev)


def group_listing(c, seen):
 """一覧。選べる設備（equipments）は実際に出てくる設備すべて（seen）＋グループに書いてある名前。グループごとに、いま当てはまる設備（matched）"""
 rows = group_rows(c)
 items = [equip_groups.view(r) for r in equip_groups.ordered(rows)]
 names = [x['name'] for x in seen]
 have = {normalize_part(n) for n in names}
 for n in (n for x in items for n in x['equipment']):
  if normalize_part(n) not in have:
   have.add(normalize_part(n))
   names.append(n)
   seen.append({'name': n, 'from': [], 'n': 0})
 for x in items:
  x['matched'] = equip_groups.members_in(x, names)
 grouped = equip_groups.sets(rows)
 for st in grouped:
  for g in st['groups']:
   g['matched'] = equip_groups.members_in(g, names)
 return {'items': items, 'sets': grouped, 'equipments': names, 'seen': seen, 'ruleOps': equip_groups.RULE_OPS}
