"""master_tables.py: 専用画面を持たないマスタを、階層の中で編集する(§9.249 ②)。

  「テーブル生データ内で閲覧可能なマスタかつ、テーブル生データマスタの配置
   された階層にないものは、この階層に配置し、編集可能な形に実装してください。」

これまで`master.sqlite3`の表のうち、マスタ管理にタブを持たないものは
**「テーブル生データ」から中身を眺めることしかできなかった**。直したいときは
その表を書く画面（列の設定パネル・登録フィルタ・行の色…）を思い出して
探しに行く必要があり、**どこからも直せない表**（移行済みの旧マスタなど）も
混ざっていた。

ここが受け持つのは3つ。
  ・`GET  /api/master-table/catalog`     … どの表があり、どこから編集するか
  ・`GET  /api/master-table/<表>`        … 中身（rowid つき）
  ・`POST /api/master-table/<表>`        … 追加 / `…/update` 更新 / `…/delete` 削除

**専用タブとの対応表(`COVERED_BY`)はここが持つ**(§9.163)。画面が持つと、
タブを1つ足すたびに2箇所直すことになる。**綴りの腐りは
`tests/test_rawmaster.py`が機械で見る**——`COVERED_BY`の値が
`master-maint.js`の`MASTER_DEFS`に実在するキーかどうかを突き合わせる。

**触るのは`master.sqlite3`だけ。** 仕掛・品質の原本（読み取り専用の写し）と
共有スケジュールはここから見えない——書ける口をそこへ向けると、
別のアプリが書いている表を壊し得る。
"""
from flask import Blueprint, jsonify, request

from ..db_access import (AUDIT_COLUMNS, DBS, connect, ensure_audit_columns,
                         tables)
from ..access_mode import request_user_id
from .body import body, any_
from ..logging_setup import app_logger
from ..quiet import quiet

bp = Blueprint('master_tables', __name__)

# 専用タブが面倒を見ている表 → そのタブのキー(master-maint.js の MASTER_DEFS)。
COVERED_BY = {
 '設備マスタ': 'equipment',
 'アクセス権限マスタ': 'accessPermission',
 'データソースマスタ': 'dataSource',
 'パス設定マスタ': 'pathConfig',
 'クエリ結合マスタ': 'queryJoin',
 '操業データ項目マスタ': 'opItem',
 '操業データ選択肢マスタ': 'opChoice',
 # §9.306-B 選択肢の親子。専用の盤（左＝まとまり／右＝親子の木）で編集する。
 '選択肢リンクマスタ': 'choiceLink',
 'ロールマスタ': 'roll',
 '帳票ブロックマスタ': 'reportBlock',
 '設備停止マスタ': 'stopReason',
 '設備停止分類マスタ': 'stopCategory',
 '負荷率上書きマスタ': 'loadFactor',
 '勤務体系マスタ': 'shiftMaster',
 '勤務区分マスタ': 'shiftMaster',
 '勤務体系設備マスタ': 'shiftMaster',
}

# 専用タブは無いが、**別の画面から書いている**表。どこで書いているかを
# 名指しする(§CLAUDE 6「出どころを画面に出す」)——ここで直せることと、
# ふだんの直し方があることは両立する。
EDITED_FROM = {
 '稼働カレンダーマスタ': '実績カレンダー画面の稼働日設定',
 '列レイアウトマスタ': '一覧の見出し右クリック →「列の設定」／帳票は「帳票レイアウト」タブ',
 '列プリセットマスタ': '列の設定パネルの「プリセット」',
 'ソートプリセットマスタ': '一覧の見出しの並べ替え',
 '一覧表示設定マスタ': '一覧の表示設定',
 '表示ルールマスタ': '列の設定パネルの「読み替え」',
 'スケジュール列表示マスタ': '作業スケジュール表の「表示列」',
 'スケジュール内容表示マスタ': '作業スケジュール表の内容欄の「表示項目」',
 '行表示マスタ': '作業スケジュール表の「行の色」',
 'フィルタプリセットマスタ': '一覧の「登録フィルタ」',
 'フィルタ個人設定マスタ': '登録フィルタの「いつも適用」',
 '選択履歴マスタ': '（自動で増えます。操業データの選択肢を選ぶたびに1つ数えます）',
}

# 移行が済んでいて、**アプリがもう読まない**表(§9.221 ③・§9.111)。
# 消していないのは、移行前のデータを見返せるようにするため。
# **「直せます」と書かない**(§CLAUDE 4)——直しても画面は変わらない。
RETIRED = {
 'オペレータマスタ': '「選択肢の値」の「オペレータ」へ移りました',
 'オペレータ設備マスタ': '「選択肢の値」の「対象設備」へ移りました',
 '機器マスタ': '「選択肢の値」の「板厚測定器」「板幅測定器」へ移りました',
 'スプール種別マスタ': '「選択肢の値」の「スプール」へ移りました',
 '内径種別マスタ': '「選択肢の値」の「内径」へ移りました',
 'バリ揃えマスタ': '「選択肢の値」の「バリ揃え」へ移りました',
 'コイル止めマスタ': '「選択肢の値」の「コイル止め」へ移りました',
 '勤務形態マスタ': '「勤務形態」タブ（勤務体系＋勤務区分）へ移りました',
}

# 何のための表かの一言。**空でもよい**——分からないものに嘘の説明を付けない。
NOTES = {
 '列レイアウトマスタ': '一覧ごとの列の並び・幅・表示名・書式・読み替え・計算式',
 '列プリセットマスタ': '列の組み合わせに名前を付けて呼び出すためのもの',
 'ソートプリセットマスタ': '並べ替えの決まりを名前で覚えておくためのもの',
 '一覧表示設定マスタ': '一覧ごとの表示件数・行間などの覚え',
 '表示ルールマスタ': '値の読み替え（コード→日本語など）の規則',
 'スケジュール列表示マスタ': '作業スケジュール表の仕掛一覧に出す列',
 'スケジュール内容表示マスタ': 'タイムラインの内容欄に出す項目',
 '行表示マスタ': '区分・停止分類ごとの行の色とアイコン',
 'フィルタプリセットマスタ': '登録した絞り込み条件（みんなのもの／個人のもの）',
 'フィルタ個人設定マスタ': '利用者ごとの「いつも適用」の印',
 '選択履歴マスタ': '選択肢が選ばれた回数（「よく使う順」の材料）',
 '稼働カレンダーマスタ': '設備ごとの稼働日・非稼働日',
}

# 左の一覧に出す短い呼び名。**1行に収まる長さにする**(§9.218 ③)——
# 折り返すとそこだけ2行になって並びが崩れる。表の名前そのものは題と`title`が言う。
SHORT_LABELS = {
 'スケジュール列表示マスタ': 'スケジュール列',
 'スケジュール内容表示マスタ': 'スケジュール内容',
 'フィルタプリセットマスタ': 'フィルタ登録',
 'フィルタ個人設定マスタ': 'フィルタ個人',
 'オペレータ設備マスタ': 'オペ設備(旧)',
 'オペレータマスタ': 'オペレータ(旧)',
 'スプール種別マスタ': 'スプール(旧)',
 '内径種別マスタ': '内径(旧)',
 'バリ揃えマスタ': 'バリ揃え(旧)',
 'コイル止めマスタ': 'コイル止め(旧)',
 '機器マスタ': '機器(旧)',
 '勤務形態マスタ': '勤務形態(旧)',
}

# 1行がとても長くなる列。編集の欄を複数行にする(1行の欄に押し込むと、
# 何を書いたのかが読めない・§9.217)。
LONG_COLUMNS = ('内容', '設定値', '式', '計算式', '条件', '備考', 'レイアウト', '値',
                '設備別レイアウト', '文字', 'ルール', 'JSON')

AUDIT_NAMES = tuple(n for n, _ in AUDIT_COLUMNS) + ('登録日時', '更新日時')


def _short(table):
 if table in SHORT_LABELS:
  return SHORT_LABELS[table]
 name = str(table)
 if name.endswith('マスタ'):
  name = name[:-3]
 return name


def _master_path():
 return DBS['MASTER']['path']


def _schema(c, table):
 """列の作り。**rowidは列として返さない**——鍵として別に扱う。"""
 cur = c.cursor()
 cur.execute(f'PRAGMA table_info([{table}])')
 out = []
 for _cid, name, decl, notnull, dflt, pk in cur.fetchall():
  # **「サーバーが埋めるので触らせない列」は1つの印で答える**(§9.163)。
  # 監査列と、rowidの別名になる`INTEGER PRIMARY KEY`がそれ。
  # **主キーだからと一律に外さないこと**——`[設定キー] TEXT PRIMARY KEY`の
  # ように**利用者が決める鍵**を持つ表では、外すと1行も足せなくなる。
  rowid_pk = bool(pk) and str(decl or '').strip().upper() == 'INTEGER'
  out.append({'name': str(name), 'decl': str(decl or ''), 'notnull': bool(notnull),
              'default': dflt, 'pk': bool(pk), 'rowidPk': rowid_pk,
              'audit': str(name) in AUDIT_NAMES,
              'auto': rowid_pk or str(name) in AUDIT_NAMES})
 return out


def _known(table):
 """その表を画面がどう扱うか。**知らない表も落とさない**——マスタを足した
 のに一覧へ出ないと、足した本人にしか場所が分からなくなる。"""
 if table in COVERED_BY:
  return {'kind': 'covered', 'tab': COVERED_BY[table], 'where': '', 'note': NOTES.get(table, '')}
 if table in RETIRED:
  return {'kind': 'retired', 'tab': '', 'where': RETIRED[table], 'note': NOTES.get(table, '')}
 if table in EDITED_FROM:
  return {'kind': 'elsewhere', 'tab': '', 'where': EDITED_FROM[table], 'note': NOTES.get(table, '')}
 return {'kind': 'here', 'tab': '', 'where': '', 'note': NOTES.get(table, '')}


@bp.get('/api/master-table/catalog')
def master_table_catalog():
 """マスタDBの表と、その扱い。**読めなくても200で返す**(理由は本文に書く)。"""
 path = _master_path()
 try:
  if not path.exists():
   return jsonify(tables=[], path=str(path), error='マスタDBがまだありません（最初の保存時に作られます）')
  with connect(path, True) as c:
   names = [t for t in tables(c) if not str(t).startswith('sqlite_')]
   out = []
   for t in names:
    info = _known(t)
    try:
     rows = c.execute(f'SELECT COUNT(*) FROM [{t}]').fetchone()[0]
    except Exception as _e:
     quiet('件数を数えられない（件数を出さない）',_e)
     rows = None
    cols = _schema(c, t)
    info.update({'table': t, 'rows': rows, 'columns': [x['name'] for x in cols],
                 'schema': cols, 'label': _short(t), 'long': list(LONG_COLUMNS)})
    out.append(info)
 except Exception as e:
  app_logger().exception('/api/master-table/catalog で失敗しました')
  return jsonify(tables=[], path=str(path), error=str(e))
 return jsonify(tables=out, path=str(path))


def _resolve(table):
 """扱ってよい表か。**名前を組み立てさせない**——マスタDBに実在する表だけ。"""
 path = _master_path()
 if not path.exists():
  return None, 'マスタDBがまだありません（最初の保存時に作られます）'
 name = str(table or '').strip()
 if not name or name.startswith('sqlite_'):
  return None, 'その表は扱えません'
 with connect(path, True) as c:
  if name not in tables(c):
   return None, f'「{name}」という表はマスタDBにありません'
 return name, ''


@bp.get('/api/master-table/<path:table>')
def master_table_rows(table):
 """中身。**鍵はrowid**——自然キーの無い表（列レイアウトマスタなど）でも
 1行を名指しできる唯一の手立て。"""
 name, err = _resolve(table)
 if name is None:
  return jsonify(error=err), 400
 limit = min(2000, max(1, int(request.args.get('limit', 500) or 500)))
 with connect(_master_path(), True) as c:
  cols = _schema(c, name)
  keys = [x['name'] for x in cols]
  quoted = ','.join(f'[{k}]' for k in keys) or '*'
  cur = c.cursor()
  cur.execute(f'SELECT rowid,{quoted} FROM [{name}] LIMIT ?', [limit])
  items = []
  for row in cur.fetchall():
   d = {'id': row[0]}
   for i, k in enumerate(keys):
    v = row[i + 1]
    d[k] = '' if v is None else v
   items.append(d)
  total = c.execute(f'SELECT COUNT(*) FROM [{name}]').fetchone()[0]
 info = _known(name)
 info.update({'table': name, 'items': items, 'schema': cols, 'total': total,
              'limit': limit, 'truncated': total > len(items),
              'label': _short(name), 'long': list(LONG_COLUMNS)})
 return jsonify(info)


def _writable_values(x, cols):
 """送られてきた値のうち、**実在する列で・監査列でないもの**だけ。
 知らないキーは黙って捨てる（列名を打ち間違えたまま保存できてしまうより、
 保存されないほうが気づける）。"""
 out = {}
 for col in cols:
  if col['auto']:
   continue
  if col['name'] in x:
   v = x[col['name']]
   out[col['name']] = None if v in (None, '') else v
 return out


def _touch(name, cols, uid, created):
 """監査列を埋める。**登録側は上書きしない**(§9.180)。"""
 have = {c['name'] for c in cols}
 sets = {}
 if '更新者ID' in have:
  sets['更新者ID'] = uid
 if created and '登録者ID' in have:
  sets['登録者ID'] = uid
 return sets, ('更新日時' in have), ('登録日時' in have and created)


@bp.post('/api/master-table/<path:table>')
def master_table_insert(table):
 name, err = _resolve(table)
 if name is None:
  return jsonify(error=err), 400
 x = body({'id': any_}, silent=True)   # 鍵はその表の列そのもの（実行時に決まる）
 uid = request_user_id(x)
 with connect(_master_path(), False) as c:
  ensure_audit_columns(c, name)
  cols = _schema(c, name)
  vals = _writable_values(x, cols)
  sets, upd_dt, ins_dt = _touch(name, cols, uid, True)
  vals.update(sets)
  if not vals:
   return jsonify(error='書き込める列がありません'), 400
  keys = list(vals)
  place = ','.join('?' for _ in keys)
  extra_cols, extra_vals = [], []
  if ins_dt:
   extra_cols.append('[登録日時]'); extra_vals.append('Now()')
  if upd_dt:
   extra_cols.append('[更新日時]'); extra_vals.append('Now()')
  sql = (f'INSERT INTO [{name}] (' + ','.join(f'[{k}]' for k in keys) + (',' + ','.join(extra_cols) if extra_cols else '')
         + ') VALUES (' + place + (',' + ','.join(extra_vals) if extra_vals else '') + ')')
  cur = c.cursor()
  try:
   cur.execute(sql, [vals[k] for k in keys])
  except Exception as e:
   return jsonify(error=f'保存できませんでした: {e}'), 400
  c.commit()
  rid = cur.lastrowid
 return jsonify(ok=True, id=rid, message=f'{name} に1行足しました')


@bp.post('/api/master-table/<path:table>/update')
def master_table_update(table):
 name, err = _resolve(table)
 if name is None:
  return jsonify(error=err), 400
 x = body({'id': any_}, silent=True)   # 鍵はその表の列そのもの（実行時に決まる）
 uid = request_user_id(x)
 try:
  rid = int(x.get('id'))
 except (TypeError, ValueError):
  return jsonify(error='どの行かが分かりません（idが必要です）'), 400
 with connect(_master_path(), False) as c:
  ensure_audit_columns(c, name)
  cols = _schema(c, name)
  vals = _writable_values(x, cols)
  sets, upd_dt, _ = _touch(name, cols, uid, False)
  vals.update(sets)
  if not vals and not upd_dt:
   return jsonify(error='書き換える列がありません'), 400
  assigns = [f'[{k}]=?' for k in vals] + (['[更新日時]=Now()'] if upd_dt else [])
  cur = c.cursor()
  try:
   cur.execute(f'UPDATE [{name}] SET ' + ','.join(assigns) + ' WHERE rowid=?',
               [vals[k] for k in vals] + [rid])
  except Exception as e:
   return jsonify(error=f'保存できませんでした: {e}'), 400
  if not cur.rowcount:
   return jsonify(error='その行は見つかりませんでした（ほかの端末が消したのかもしれません）'), 404
  c.commit()
 return jsonify(ok=True, id=rid, message=f'{name} の1行を書き換えました')


@bp.post('/api/master-table/<path:table>/drop')
def master_table_drop(table):
 """表そのものを消す（§9.250 ③、利用者の指示「移行済みのマスタについては
 不要なはずなので削除できるようにしてください」）。

 **消せるのは`RETIRED`に載っている表だけ。** アプリがもう読まない、と
 このファイルが名指ししている表に限る——生きている表を消せる口があると、
 押し間違い1回でマスタが消える（§CLAUDE 5「危ない操作を主要動線に置かない」）。
 **判定は`RETIRED`の1箇所**で、画面には表の名前を書き写さない（§9.163）。
 """
 name, err = _resolve(table)
 if name is None:
  return jsonify(error=err), 400
 if name not in RETIRED:
  return jsonify(error=f'「{name}」はアプリが読んでいる表なので、ここからは消せません。'
                       '（消せるのは移行済みの表だけです）'), 400
 with connect(_master_path(), False) as c:
  try:
   rows = c.execute(f'SELECT COUNT(*) FROM [{name}]').fetchone()[0]
  except Exception as _e:
   quiet('件数を数えられない（件数を出さない）',_e)
   rows = None
  c.cursor().execute(f'DROP TABLE IF EXISTS [{name}]')
  c.commit()
 app_logger().info('移行済みの表を削除しました: %s (%s件)', name, rows)
 return jsonify(ok=True, table=name, rows=rows,
                message=f'{name} を削除しました' + (f'（{rows}件）' if rows is not None else ''))


@bp.post('/api/master-table/<path:table>/delete')
def master_table_delete(table):
 name, err = _resolve(table)
 if name is None:
  return jsonify(error=err), 400
 x = body({'id': any_}, silent=True)   # 鍵はその表の列そのもの（実行時に決まる）
 try:
  rid = int(x.get('id'))
 except (TypeError, ValueError):
  return jsonify(error='どの行かが分かりません（idが必要です）'), 400
 with connect(_master_path(), False) as c:
  cur = c.cursor()
  cur.execute(f'DELETE FROM [{name}] WHERE rowid=?', [rid])
  if not cur.rowcount:
   return jsonify(error='その行は見つかりませんでした'), 404
  c.commit()
 return jsonify(ok=True, message=f'{name} の1行を消しました')
