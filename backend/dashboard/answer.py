"""answer.py: パネルの数（§9.628。LotScope の routes/dashboard.py の数える所。Flask を知らない）。

どの元も`pivot.query_many()`の1か所で数える。ここが持つのはその前後だけ:
    answer()       … 1つの組み（パネルか、合わせた表の列のまとまり）→ 集計表と同じ形の答え。同じ組み・同じ写し・同じ「今日」なら前の答え
    split_answer() … 設備の分け方（esplit: series＝設備ごとの系列／facet＝設備ごとに並べる／sum＝合算）
    link_answer()  … 別のデータを合わせる（目標と実績・積み上げ・差・達成率）
    board_answer() … 合わせた表（visual board）
数えられなければ {error, kind, status}（パネルの中に理由を出す。kind=copying は写し終えたら画面が引き直す）。
"""
import json
import os
import re
import threading
from collections import OrderedDict

from ..textnorm import normalize_equipment_name as normalize_part
from . import aggregate, equip_groups, layout, pivot, sources

CACHE_MAX = 96
BOX_VISUALS = ('box', 'violin', 'xbar')
EQUIP_DIM = {'column': pivot.EQUIP_DIM, 'part': ''}
ROLE_NAME = {'target': '目標', 'actual': '実績', 'base': '基準', '': ''}
_DAY = re.compile(r'\d{4}(-\d{2}){0,2}')

# 画面は全部のパネルを一度に問い合わせる。重い集計を同時に走らせると取り合って、順に数えるより遅い
# （LotScope の実測: 6 枚で順に 4.8 秒・一度に 21.7 秒）。数えるのは 1 つずつにする
_COUNT_LOCK = threading.Lock()
_cache = OrderedDict()


class Context:
 """1回の問い合わせの材料: いま（now）と設備グループの行（group_rows。マスタから読んだ物）"""

 def __init__(self, now, group_rows):
  self.now, self.group_rows = now, list(group_rows or [])


def _file_sig(path):
 try:
  st = os.stat(path)
  return [str(path), st.st_mtime_ns, st.st_size]
 except OSError:
  return [str(path), 0, 0]


def _box_column(p):
 """行ごとの分かれ方が要る形（箱ひげ・バイオリン・X̄-R 管理図）は、1つ目の数の値の列で数える"""
 if p.get('visual') not in BOX_VISUALS:
  return ''
 return next((m.get('column') for m in p['body']['measures'] if m.get('column') and m.get('agg') != 'distinct'), '')


def _group_sets(p, ctx):
 """設備グループの段（@egroup）のまとめ方 → グループ（query_many の sets）。PANEL_SET はこのパネルで決めたグループ"""
 b = p.get('body') or {}
 names = {d.get('part') or '' for d in (b.get('rows') or []) + (b.get('cols') or []) if d.get('column') == pivot.EGROUP_DIM}
 if not names:
  return None
 out = {}
 for n in names:
  if n == pivot.PANEL_SET or not n:
   eg = p.get('egroup') or {}
   out[n] = [{'name': g['name'], 'members': g.get('members') or []} for g in eg.get('groups') or []] if eg.get('mode') == 'panel' else []
  else:
   out[n] = equip_groups.groups_for(ctx.group_rows, n)
 return out


def _remember(key, make):
 hit = _cache.get(key)
 if hit is not None:
  _cache.move_to_end(key)
  return hit
 with _COUNT_LOCK:             # 待っている間に同じ組みを数え終えていれば、その答え
  hit = _cache.get(key)
  if hit is None:
   hit = make()
   if 'error' in hit:
    return hit
   _cache[key] = hit
   while len(_cache) > CACHE_MAX:
    _cache.popitem(last=False)
 return hit


def forget():
 """控えた答えを捨てる（網・データを入れ替えたとき）"""
 _cache.clear()


def _count(p, parts, ctx, egroups, sets):
 b = p['body']
 try:
  return pivot.query_many(parts, search=p['search'], filters=json.dumps(p['filters'], ensure_ascii=False),
                          rows=json.dumps(b['rows'], ensure_ascii=False), cols=json.dumps(b['cols'], ensure_ascii=False),
                          measures=json.dumps(b['measures'], ensure_ascii=False), today=ctx.now.date(), period=p['period'], now=ctx.now,
                          calc=p.get('calc'), equips=p.get('equips'), egroups=egroups, box=_box_column(p), sets=sets)
 except pivot.PivotError as e:
  return {'error': str(e), 'kind': 'invalid', 'status': 400}
 except Exception as e:
  return {'error': str(e), 'kind': 'error', 'status': 503}


def units(ms):
 """値に単位を添える（分の値は unit: min。画面が端末の時間の書き方で書く）"""
 return [{**m, 'unit': 'min'} if sources.minutes_of(m) else m for m in ms or []]


def answer(p, ctx):
 """1つの組みの数 → 答え（集計表と同じ形に、元の名前・読めなかった設備）。数えられなければ {error, kind, status}"""
 try:
  parts, failed, name = sources.parts_for(p['source'], p.get('equips'), p['basis'])
 except sources.SourceFail as f:
  return f.answer()
 egroups = layout.resolve_egroup(p.get('egroup'), p.get('equips'), lambda n: equip_groups.groups_for(ctx.group_rows, n))
 sets = _group_sets(p, ctx)
 stamp = ctx.now.strftime('%Y-%m-%d %H:%M:%S')
 days = [x.work['clock'].place(stamp, x.work['basis'])[0] if x.work else '' for x in parts]
 key = json.dumps([p, egroups, sets, [[_file_sig(x.path), x.table] for x in parts], days, ctx.now.date().isoformat(), [f['name'] for f in failed]],
                  ensure_ascii=False, sort_keys=True, default=str)
 hit = _remember(key, lambda: _count(p, parts, ctx, egroups, sets))
 if 'error' in hit:
  return hit
 note = ('設備のまとめのマスタ「' + p['egroup']['set'] + '」にグループがありません（マスタ管理の「設備グループ」）。'
         if p.get('egroup') and p['egroup']['mode'] == 'master' and not egroups else '')
 out = {**with_eorder(hit, p), 'sourceName': name, 'failed': failed, 'now': stamp}
 out['measures'] = units(out.get('measures'))
 if note:
  out['note'] = ' '.join(x for x in (hit.get('note'), note) if x)
 return out


# ---------------------------------------------------------------- 設備の分け方
def split_answer(p, ctx):
 """series … 列の段の頭に設備（グラフは設備ごとの系列）。数字（kpi）と、列の段がいっぱいなら facet
    facet  … 行の段の頭に設備を足して1回数え、設備ごとの答え facets: [{key, name, answer}] に分ける"""
 sp = layout.split_of(p) if sources.equip_ok(p['source']) else ''
 b = p['body']
 if sp == 'series' and (p['visual'] == 'kpi' or len(b['cols']) >= pivot.MAX_DIMS):
  sp = 'facet'
 if sp == 'series':
  a = answer({**p, 'body': {**b, 'cols': [EQUIP_DIM] + b['cols']}}, ctx)
  return {**a, 'esplit': 'series'} if 'cells' in a else a
 if sp != 'facet' or len(b['rows']) >= pivot.MAX_DIMS:
  a = answer(p, ctx)
  told = sp == 'sum' and (p.get('esplit') or len(p.get('equips') or []) >= 2 or (p.get('egroup') or {}).get('mode') == 'sum')
  return {**a, 'esplit': sp} if 'cells' in a and told else a
 ms = b['measures']
 a = answer({**p, 'body': {**b, 'rows': [EQUIP_DIM] + b['rows'], 'measures': [{k: v for k, v in m.items() if k != 'show'} for m in ms]}}, ctx)
 if 'cells' not in a:
  return a
 return {**a, 'esplit': 'facet', 'facets': facets_of(a, ms)}


_SUB_KEYS = ('table', 'lotsBy', 'start', 'bins', 'stats', 'box', 'truncated', 'months', 'month', 'shifts')


def facets_of(a, measures):
 """行の段の頭が設備の答え → 設備ごとの答え（行の段・鍵の並びは頭を外す）"""
 nr, nc = len(a['dims']['rows']) - 1, len(a['dims']['cols'])
 out = []
 for k in [x for x in a['orders'][0] if x != ''][:layout.MAX_FACETS]:
  cells = [{'r': c['r'][1:], 'c': c['c'], 'v': list(c['v'])} for c in a['cells'] if c['r'][:1] == [k]]
  orders = [[x for x in o if any(len(c['r']) > i and c['r'][i] == x for c in cells)] for i, o in enumerate(a['orders'][1:nr + 1])] + a['orders'][nr + 1:]
  aggregate.apply_show(cells, measures, nr, nc, orders)
  sub = {**{x: a[x] for x in _SUB_KEYS if x in a},
         'dims': {'rows': a['dims']['rows'][1:], 'cols': a['dims']['cols']}, 'measures': [{**m, 'name': aggregate.name(m)} for m in measures],
         'orders': orders, 'labels': a['labels'][1:], 'cells': cells, 'count': None,
         'boxes': [{**x, 'r': x['r'][1:]} for x in a.get('boxes') or [] if x['r'][:1] == [k]]}
  out.append({'key': k, 'name': a['labels'][0].get(k, k), 'answer': sub})
 return out


# ---------------------------------------------------------------- 設備の手で並べた順
def order_names(names, eorder):
 """名前の並び → 手で並べた順（eorder にある名前をその順に先へ・無い名前は今の順のまま後ろへ）"""
 if not eorder:
  return list(names)
 at = {normalize_part(n): i for i, n in enumerate(eorder)}
 return sorted(names, key=lambda n: (0, at[normalize_part(n)]) if normalize_part(n) in at else (1, 0))


def order_parts(parts, eorder):
 """数える設備の表（Part）を手で並べた順に（ガントの行・ABC の設備の札の順）"""
 if not eorder:
  return parts
 names = order_names([x.name for x in parts], eorder)
 return sorted(parts, key=lambda x: names.index(x.name))


def with_eorder(a, p):
 """答えの設備の段（@equip）の鍵の並びを、パネルの手で並べた順に"""
 eo = p.get('eorder')
 if not eo or 'orders' not in a:
  return a
 dims = a['dims']['rows'] + a['dims']['cols']
 orders = [order_names(o, eo) if i < len(dims) and dims[i].get('column') == pivot.EQUIP_DIM else o for i, o in enumerate(a['orders'])]
 return {**a, 'orders': orders}


# ---------------------------------------------------------------- 別のデータを合わせる（link）
def _link_key(k):
 """軸の鍵 → そろえる鍵（字の値の頭の $・数の # を外し、NFKC・大文字に）"""
 k = str(k)
 if k[:1] in ('$', '#'):
  k = k[1:]
 return normalize_part(k)


def _link_values(answers):
 keys, labels, first = {}, {}, []
 for i, a in enumerate(answers):
  if 'cells' not in a:
   continue
  for k in a['orders'][0]:
   if k == '':
    continue
   ck = _link_key(k)
   if ck not in keys:
    keys[ck] = {}
    labels[ck] = a['labels'][0].get(k, k)
    first.append(ck)
   keys[ck][i] = next((c['v'][0] for c in a['cells'] if c['r'] == [k] and not c['c']), None)
 order = sorted(first) if first and all(_DAY.fullmatch(k) for k in first) else first
 return keys, labels, order


def _link_cells(link, answers, keys, order):
 sides = link['sides']
 vals = {k: [keys[k].get(i) for i in range(len(sides))] for k in order}
 grand = []
 for i, x in enumerate(sides):
  if x['build'] == 'cum':
   run = 0
   for k in order:
    v = vals[k][i]
    run += v if isinstance(v, (int, float)) else 0
    vals[k][i] = run
   grand.append(run if order else None)
  else:
   grand.append(next((c['v'][0] for c in answers[i].get('cells') or [] if not c['r'] and not c['c']), None))
 # 差・達成率の相手は目標、無ければ基準（全設備の平均など。§9.628 自設備の「全設備との差」）
 ti = next((i for i, x in enumerate(sides) if x['role'] == 'target'), next((i for i, x in enumerate(sides) if x['role'] == 'base'), -1))
 ai = next((i for i, x in enumerate(sides) if x['role'] == 'actual'), -1)
 extra = [e for e in link.get('extra') or [] if ti >= 0 and ai >= 0]

 def extras(v):
  t, r = v[ti] if ti >= 0 else None, v[ai] if ai >= 0 else None
  ok = isinstance(t, (int, float)) and isinstance(r, (int, float))
  return [(r - t if ok else None) if e == 'diff' else (round(r / t * 100, 4) if ok and t else None) for e in extra]
 cells = [{'r': [k], 'c': [], 'v': vals[k] + extras(vals[k])} for k in order] + [{'r': [], 'c': [], 'v': grand + extras(grand)}]
 return cells, extra


def aggregate_name(m, source):
 """値の名前（ロット数は測定データ・作業予定なら作業の本数）"""
 return ('作業の本数' if source in (sources.REC, sources.PLAN) else 'ロット数') if m.get('agg') == 'lots' else aggregate.name(m)


def link_answer(p, ctx):
 """合わせるデータを1つずつ数え、軸の値でそろえて1つの答え（値＝データごと）にする"""
 link = p['link']
 answers = [answer(layout.side_query(link, i, p), ctx) for i in range(len(link['sides']))]
 if all('cells' not in a for a in answers):
  return answers[0]
 keys, labels, order = _link_values(answers)
 cells, extra = _link_cells(link, answers, keys, order)
 sides = link['sides']
 names = []
 for i, x in enumerate(sides):
  base = x['title'] or f"{answers[i].get('sourceName') or ''}の{aggregate_name(x['measure'], x['source'])}"
  names.append(f"{ROLE_NAME[x['role']]}：{base}" if x['role'] else base)
 ms = [{**x['measure'], 'name': names[i] + ('（積み上げ）' if x['build'] == 'cum' else ''), 'role': x['role'], 'side': i} for i, x in enumerate(sides)]
 ref = ROLE_NAME['target' if any(x['role'] == 'target' for x in sides) else 'base']
 ms = units(ms)
 mins = all(m.get('unit') == 'min' for m in ms)           # 分どうしの差も分
 ms += [{'agg': 'sum', 'name': f'差（実績−{ref}）' if e == 'diff' else f'達成率（実績÷{ref} %）', 'role': e,
         **({'unit': 'min'} if e == 'diff' and mins else {})} for e in extra]
 ok = [a for a in answers if 'cells' in a]
 note = '　'.join(f"{names[i]}: {a['error']}" for i, a in enumerate(answers) if 'cells' not in a)
 return {'table': '', 'count': sum(a.get('count') or 0 for a in ok), 'lotsBy': '', 'start': '', 'bins': [], 'stats': {}, 'box': '', 'boxes': [],
         'dims': {'rows': [{**sides[0]['key'], 'name': '・'.join(dict.fromkeys(pivot._dim_name(x['key']) for x in sides))}], 'cols': []},
         'measures': ms, 'orders': [order], 'labels': [labels], 'cells': cells, 'truncated': {'rows': False, 'cols': False},
         'months': [], 'month': '', 'ignoredFilters': sorted({f for a in ok for f in a.get('ignoredFilters') or []}),
         'equipIgnored': any(a.get('equipIgnored') for a in ok), 'note': ' '.join(x for x in [note] + [a.get('note') or '' for a in ok] if x),
         'sourceName': '・'.join(dict.fromkeys(a.get('sourceName') or '' for a in ok)),
         'failed': [f for a in ok for f in a.get('failed') or []], 'now': ctx.now.strftime('%Y-%m-%d %H:%M:%S'),
         'link': {'sides': [{'role': x['role'], 'build': x['build'], 'name': names[i], 'sourceName': answers[i].get('sourceName') or '',
                             'keyName': pivot._dim_name(x['key']), **({'error': answers[i]['error']} if 'cells' not in answers[i] else {})}
                            for i, x in enumerate(sides)]}}


# ---------------------------------------------------------------- 合わせた表・設備の見分け
def equip_tree(names, group_rows, set_name=None):
 """設備グループのまとめ方ごとに、names の設備がどのグループに入るか → [{name, groups: [{name, members}]}]"""
 out = []
 for st in equip_groups.sets(group_rows):
  if set_name and st['name'] != set_name:
   continue
  out.append({'name': st['name'], 'groups': [{'name': g['name'], 'members': equip_groups.members_in(g, names)} for g in st['groups']]})
 return out


def board_answer(p, ctx):
 """合わせた表 → {groups: [列のまとまりごとの答え], equipOrder: 設備の並び, now[, tree]}"""
 groups = [answer(layout.board_query(p, i), ctx) for i in range(len(p['groups']))]
 out = {'groups': groups, 'equipOrder': sources.equipment_names(), 'now': ctx.now.strftime('%Y-%m-%d %H:%M:%S')}
 if p['order'].get('tree'):     # 行をグループの見出しの下にまとめる: 表に出る行の名前で、グループの入り方を決める
  keys = list(dict.fromkeys(str((a.get('labels') or [{}])[0].get(k, k)) for a in groups if 'orders' in a for k in a['orders'][0] if k != ''))
  out['tree'] = (equip_tree(keys, ctx.group_rows, p['order']['tree']) or [{'groups': []}])[0]['groups']
 return out


def equipment_seen(ctx):
 """実際に出てくる設備（設備グループのマスタ・スライサーで選ぶ設備）→ [{name, from: [どこで見たか], n: 件数}]。
    設備マスタ → 設備の段が使える元（測定データ・作業予定・データソース）の設備の段の値"""
 out = {}

 def add(name, where, n=0):
  name = str(name or '').strip()
  if not name:
   return
  x = out.setdefault(normalize_part(name), {'name': name, 'from': [], 'n': 0})
  if where not in x['from']:
   x['from'].append(where)
  x['n'] += n or 0
 for n in sources.equipment_names():
  add(n, '設備マスタ')
 for s in sources.source_items():
  if not s.get('equip') and not sources.equip_ok(s['key']):
   continue
  p = layout.clean_panel({'visual': 'none', 'source': s['key'], 'body': {'rows': [EQUIP_DIM], 'measures': [{'agg': 'count'}]}}, 0, layout.ROWS_MAX)
  a = answer(p, ctx)
  if 'cells' not in a:
   continue
  counts = {c['r'][0]: c['v'][0] for c in a['cells'] if len(c['r']) == 1}
  for k in a['orders'][0]:
   if k:
    add(a['labels'][0].get(k, k), s['name'], counts.get(k))
 return list(out.values())


def fields(source, equips, calc):
 """パネルを組む所の左のカラムの札: 列ごとの手がかり（種類の数・数・日付）と、特別な段（設備・設備グループ・作業日・直）"""
 parts, failed, name = sources.parts_for(source, equips)
 merged, order, table = {}, [], ''
 for x in parts[:12]:
  try:
   d = pivot.fields(x.path, table=x.table, preferred_table=x.preferred_table, table_candidates=x.table_candidates, calc=calc)
  except Exception as e:
   failed.append({'name': x.name, 'error': str(e), 'kind': 'error'})
   continue
  table = table or d['table']
  for f in d['fields']:
   m = merged.get(f['column'])
   if m is None:
    merged[f['column']] = dict(f)
    order.append(f['column'])
   else:
    m.update(kinds=max(m['kinds'], f['kinds']), many=m['many'] or f['many'], numeric=m['numeric'] and f['numeric'], date=m['date'] or f['date'])
    if m.get('error') and not f.get('error'):
     m.pop('error')
 return {'fields': [merged[c] for c in order], 'special': _special(parts), 'table': table, 'sourceName': name, 'failed': failed}


def _special(parts):
 out = []
 if parts and all(x.equip for x in parts):
  col = parts[0].equip.get('column')
  out.append({'column': pivot.EQUIP_DIM, 'name': '設備', 'hint': f'「{col}」の値から見分けた設備' if col else '設備ごとの表・ファイル'})
  out.append({'column': pivot.EGROUP_DIM, 'name': '設備グループ', 'hint': '設備が入るグループ（マスタ管理の「設備グループ」のまとめ方）'})
 if parts and parts[0].work:
  start = parts[0].work.get('start') or '作業開始'
  out += [{'column': '@workday', 'name': '作業日', 'hint': f'「{start}」の日（現場歴／太陽暦）', 'date': True},
          {'column': '@shift', 'name': '直', 'hint': f'「{start}」の時刻が入る直（マスタ管理の勤務体系）'}]
 return out
