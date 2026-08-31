"""source_capability.py: データソース1件が「この設定で何ができるか」を答える（§9.163）。

------------------------------------------------------------------------
データソースを1行足せば左メニューの一覧には出る。だが**測定を開ける・
作業スケジュールへ投入できる・品質として結合できる**かどうかは、役割
(データソースマスタの[役割])だけでは決まらない——行にロット番号や設備名の
列が無ければ、画面はその機能を**黙って出さない**のが既存の方針だからで
（tests/test_dsnav.js「必須列を決め打ちしない」）、利用者から見ると
「登録したのにボタンが出ない」としか見えない。

そこで、**登録した設定で実際にできること／できない理由**をマスタ管理の
画面へ出す。判定はここ1箇所に置く——散らばると、画面の言うことと実際の
挙動が食い違う（§9.87でキー文字列の直接比較が十数箇所へ散って実際に
壊れたのと同じ形）。

**判定は読むだけ**で、1件も書き換えない。共有が不調なら「確かめられ
ませんでした」と理由を返す（例外を投げてマスタ画面ごと開けなくしない）。
------------------------------------------------------------------------
"""
import unicodedata
from pathlib import Path

from .db_access import (DBS, cfg, connect, tables, cols,
                        WORK_DB_KEY, QUALITY_DB_KEY, SCHEDULE_DB_KEY,
                        PURPOSE_WORK, PURPOSE_QUALITY, PURPOSE_SCHEDULE)
from .logging_setup import app_logger


def norm_name(s):
 """全角/半角・大小文字のゆれを吸収して比較する（CLAUDE.md「フィールド名」）。"""
 return unicodedata.normalize('NFKC', str(s or '')).strip().lower()


def find_column(columns, aliases):
 """列名の別名解決。完全一致 → 正規化一致 → 部分一致の順に探す。
 部分一致は誤爆(例: 別名'LTNO'が'PLTNO'に一致)しやすいので最後の手段。"""
 for a in aliases:
  if a in columns:
   return a
 norm = {norm_name(c): c for c in columns}
 for a in aliases:
  hit = norm.get(norm_name(a))
  if hit:
   return hit
 for c in columns:
  if any(norm_name(a) in norm_name(c) for a in aliases):
   return c
 return None


# 画面が機能を出すかどうかを決めている別名。**static/js/base.js の aliases と
# 同じ並び**にしてある（あちらが画面側の唯一の定義で、こちらはサーバーが
# 「その機能が使えるか」を答えるためだけに持つ写し）。片方だけ増やすと、
# 画面には出るのにここが「使えません」と言う、という食い違いになる。
FEATURE_ALIASES = {
 'lotNo': ['ロット番号', 'ﾛｯﾄ番号', 'ロット№', 'LTNO'],
 'castingNo': ['鋳造番号', 'ﾁｭｳｿﾞｳ番号', 'CYNO'],
 'mfgMaterial': ['製造材質', 'ﾒｲｿﾞｳ材質', 'LTA'],
 'equipment': ['BOX設計_設備名', '設備'],
 'residualCourse': ['残仕掛設備ｺｰｽ', '残仕掛設備コース', 'ZANMC'],
}
# 分割(条割)の判定は別名表ではなく**列名の接頭辞**で行う(static/js/lot-split.js)。
SPLIT_PREFIXES = ('親子管理_子カード', '親子管理_子ｶｰﾄﾞ', 'KOCARD',
                  'コンマ5本分割_切断巾', 'ｺﾝﾏ5本分割_切断巾', 'K05W')
# 品質データの結合に要る3つのキー(backend/routes/tables.py の _JOIN_KEY_ALIASES)。
JOIN_KEYS = ('lotNo', 'castingNo', 'mfgMaterial')
_JOIN_KEY_LABEL = {'lotNo': 'ロット番号', 'castingNo': '鋳造番号', 'mfgMaterial': '製造材質'}


def _has_split_columns(columns):
 lowered = [norm_name(c) for c in columns]
 return any(any(c.startswith(norm_name(p)) for p in SPLIT_PREFIXES) for c in lowered)


def _entry_of(key, path=None, preferred=''):
 """開く先。`path`を渡すと**登録されていない下書きのパス**でも確かめられる
 （§9.168の「保存する前に確かめる」）。渡さなければ登録済みの接続設定。"""
 if path is None:
  return cfg(key)
 return {'path': Path(path), 'role': 'readonly', 'preferred': preferred}


def _read_columns(key, path=None, preferred=''):
 """そのデータソースを実際に開いて、既定テーブルの列名を読む。
 **開く前に存在確認をしない**（CLAUDE.md。共有越しではstatだけ失敗する
 ことがあり、確認のつもりの1行が唯一の失敗原因になる）。
 戻り値: (テーブル名, 列名リスト, 全テーブル名, エラー文字列)"""
 entry = _entry_of(key, path, preferred)
 with connect(entry['path'], entry.get('role') == 'readonly') as c:
  names = tables(c)
  if not names:
   return '', [], [], 'ファイルは開けましたが、表が1つもありません。'
  preferred = entry.get('preferred') or ''
  table = preferred if preferred in names else names[0]
  return table, list(cols(c, table, source=entry['path'])), names, ''


def sample_columns(key, limit=400):
 """既定テーブルの列名と、見本の1行（§9.285 ④、利用者の指示）。

 「仕掛情報などリンクしているデータのうち、直接アプリで使用していない
  データでも…ひっぱれるデータ範囲の拡張をしてほしい」

 **どの表を読むかの答えはここ1箇所**——`_read_columns()`と同じ選び方
 （既定テーブル→無ければ先頭）を通す。帳票ブロックの候補が自前で表を
 選ぶと、「一覧に出ている列」と「紙で選べる列」が食い違いうる。

 **読めなければ空**（fail-open）——仕掛DBが開けないだけで帳票ブロックの
 候補が丸ごと空になると、塊を作る手立てが消える。
 **開く前に存在確認をしない**（CLAUDE.md。共有越しではstatだけ失敗する
 ことがあり、確認のつもりの1行が唯一の失敗原因になる）。

 戻り値: [{'name': 列名, 'sample': 見本の値}, ...]"""
 try:
  entry = _entry_of(key, None, '')
  with connect(entry['path'], entry.get('role') == 'readonly') as c:
   names = tables(c)
   if not names:
    return []
   preferred = entry.get('preferred') or ''
   table = preferred if preferred in names else names[0]
   cur = c.cursor()
   cur.execute(f'SELECT * FROM [{table}] LIMIT 1')
   heads = [str(d[0]) for d in (cur.description or [])][:int(limit)]
   row = cur.fetchone()
  vals = list(row) if row else []
  return [{'name': n, 'sample': ('' if i >= len(vals) or vals[i] is None
                                 else str(vals[i]))}
          for i, n in enumerate(heads)]
 except Exception as e:
  app_logger().info('sample_columns(%s) skipped: %s', key, e)
  return []


def _quality_key_table(key, all_tables, entry_preferred, path=None):
 """品質データ側で「3つのキー列がすべて揃っているテーブル」を探す。
 /api/table の結合と**同じ選び方**（preferredを先頭に、無ければ全部試す）。"""
 entry = _entry_of(key, path, entry_preferred)
 missing_of_first = None
 with connect(entry['path'], entry.get('role') == 'readonly') as c:
  ordered = ([entry_preferred] if entry_preferred in all_tables else []) \
            + [n for n in all_tables if n != entry_preferred]
  for t in ordered:
   try:
    cs = cols(c, t, source=entry['path'])
   except Exception:
    continue
   missing = [_JOIN_KEY_LABEL[k] for k in JOIN_KEYS
              if not find_column(cs, FEATURE_ALIASES[k])]
   if not missing:
    return t, []
   if missing_of_first is None:
    missing_of_first = missing
 return '', (missing_of_first or [_JOIN_KEY_LABEL[k] for k in JOIN_KEYS])


def _feature(ok, note, detail=''):
 return {'ok': bool(ok), 'note': note, 'detail': detail}


def describe(source, path=None):
 """1件ぶんの「できること」。sourceはdata_source_rows()の1要素。

 `path`を渡すと**まだ保存していない下書き**でも確かめる（§9.168）。
 接続先はサーバー起動時に1回だけ決まるので、これが無いと「保存して
 再起動するまで打ち間違いに気づけない」ことになる。そのときの役割は
 下書きの[役割]を信じる（登録済みの役割との重なりは保存側が弾く）。

 **できないことは、できないと書く**（CLAUDE.md）。ok=False のときは
 必ず理由(note)を入れる——「押しても何も起きない」を画面の外で説明
 させないため。"""
 draft = path is not None
 key = source.get('key') or ''
 label = source.get('label') or key
 purpose = source.get('purpose') or ''
 out = {'key': key, 'table': '', 'columnCount': 0, 'error': '',
        'features': {}}

 if not source.get('active', True):
  out['error'] = 'このデータソースは「無効」です。一覧にも抽出対象にも出ません。'
  out['features'] = {
   'list': _feature(False, '無効にしているので一覧に出ません。'),
   'measure': _feature(False, '無効のため確かめていません。'),
   'plan': _feature(False, '無効のため確かめていません。'),
   'quality': _feature(False, '無効のため確かめていません。'),
  }
  return out

 if key not in DBS and not draft:
  out['error'] = ('この端末ではまだ読み込み先が決まっていません。'
                  '読み込み先はサーバー起動時に1回だけ決まるため、'
                  '登録・変更のあとはサーバーを再起動してください。')
  reason = '再起動するまで確かめられません。'
  out['features'] = {k: _feature(False, reason)
                     for k in ('list', 'measure', 'plan', 'quality', 'schedule')}
  return out

 columns, all_tables = [], []
 try:
  table, columns, all_tables, err = _read_columns(key, path, source.get('preferred') or '')
  out['table'] = table
  out['columnCount'] = len(columns)
  out['error'] = err
 except Exception as e:
  # 共有が不調でも**マスタ画面は開けること**を優先する(fail-open)。
  app_logger().warning('データソース「%s」の内容を確かめられませんでした: %s', key, e)
  out['error'] = f'読み込み先を確かめられませんでした: {e}'
  reason = '読み込み先を確かめられなかったので分かりません。'
  out['features'] = {k: _feature(False, reason)
                     for k in ('list', 'measure', 'plan', 'quality')}
  return out

 col = lambda k: find_column(columns, FEATURE_ALIASES[k])
 lot, equip, residual = col('lotNo'), col('equipment'), col('residualCourse')
 # 下書きは**その行が名乗っている役割**で判定する（まだ登録されていないので
 # WORK_DB_KEY と一致しようがない）。登録済みは実際に効いている役割で見る。
 is_work = (purpose == PURPOSE_WORK) if draft else (bool(WORK_DB_KEY) and key == WORK_DB_KEY)
 is_quality = (purpose == PURPOSE_QUALITY) if draft else (bool(QUALITY_DB_KEY) and key == QUALITY_DB_KEY)
 is_schedule = (purpose == PURPOSE_SCHEDULE) if draft else (bool(SCHEDULE_DB_KEY) and key == SCHEDULE_DB_KEY)

 # ---- ① 一覧として見る（役割によらず、開ければ必ずできる） ----
 if out['error']:
  list_f = _feature(False, out['error'])
 else:
  list_f = _feature(True, f'左メニュー「{label}」から開けます。',
                    f'表「{out["table"]}」の{len(columns)}列を出します。')

 # ---- ② 測定を開く ----
 if not is_work:
  measure_f = _feature(False,
   f'役割が「{PURPOSE_WORK}」ではありません。測定を開けるのは役割「{PURPOSE_WORK}」の1件だけです。'
   if purpose != PURPOSE_WORK else
   f'役割「{PURPOSE_WORK}」は別のデータソースに付いています（役割は1件だけです）。')
 elif not lot:
  measure_f = _feature(False,
   'ロット番号の列が見つかりません（探した名前: '
   + '／'.join(FEATURE_ALIASES['lotNo']) + '）。測定はロット番号を鍵にするため開けません。')
 else:
  detail = ('条割（分割）も出ます。' if _has_split_columns(columns)
            else '分割の列（親子管理_子カード／コンマ5本分割_切断巾）が無いので、条割は出ません。')
  measure_f = _feature(True, f'「{lot}」をロット番号として測定を開きます。', detail)

 # ---- ③ 作業スケジュールへ投入する ----
 if not is_work:
  plan_f = _feature(False, f'役割「{PURPOSE_WORK}」のデータソースだけが予定へ投入できます。')
 elif not equip:
  plan_f = _feature(False,
   '設備名の列が見つかりません（探した名前: '
   + '／'.join(FEATURE_ALIASES['equipment']) + '）。どの設備の予定にするかを行から決められません。')
 elif not lot:
  plan_f = _feature(False, 'ロット番号の列が見つかりません。予定の題名と実績の突き合わせに使うため必要です。')
 else:
  detail = (f'作業可否は「{residual}」で判定します。' if residual
            else '残仕掛設備ｺｰｽの列が無いので、作業可否はすべて「?」のままになります。')
  plan_f = _feature(True, f'スケジュールモードで「{equip}」の予定へ投入できます。', detail)

 # ---- ④ 品質データとして結合する ----
 if not is_quality:
  quality_f = _feature(False, '役割が「品質」ではありません。結合できるのは役割「品質」の1件だけです。')
 else:
  try:
   qt, missing = _quality_key_table(key, all_tables,
                                    (source.get('preferred') or '') if draft
                                    else (cfg(key).get('preferred') or ''), path)
  except Exception as e:
   qt, missing = '', [f'確かめられませんでした（{e}）']
  if qt:
   quality_f = _feature(True, f'表「{qt}」を、ロット番号・鋳造番号・製造材質で仕掛の一覧へ結合します。',
                        'これは既定の結合です。別のキー・別の相手で結合したいときは'
                        'マスタ管理 > クエリ結合で登録します（役割が無いデータソースも相手にできます）。')
  else:
   quality_f = _feature(False,
    '突合キーの列がすべて揃った表がありません（足りない列: ' + '・'.join(missing) + '）。')

 # ---- ⑤ スケジュール(作業予定)の本体として使う ----
 # 役割「スケジュール」(§9.193)。**予定を書く先**なので、表`作業予定`が
 # 無いファイルを指していると、共有スケジュールとしては使えない。
 if not is_schedule:
  schedule_f = _feature(False,
   f'役割が「{PURPOSE_SCHEDULE}」ではありません。予定の本体にできるのは1件だけです。')
 elif out['error']:
  schedule_f = _feature(False, out['error'])
 elif SCHEDULE_PLAN_TABLE not in (all_tables or []):
  schedule_f = _feature(False,
   f'表「{SCHEDULE_PLAN_TABLE}」がありません（見つかった表: '
   + ('・'.join(all_tables or []) or 'なし') + '）。'
   '共有スケジュールDBを指しているか確かめてください。')
 else:
  schedule_f = _feature(True, f'このファイルを共有スケジュール（{SCHEDULE_PLAN_TABLE}）として読み書きします。',
                        '共通設定の「共有スケジュールの置き場」を入れてある端末では、そちらが優先されます。')

 out['features'] = {'list': list_f, 'measure': measure_f, 'plan': plan_f,
                    'quality': quality_f, 'schedule': schedule_f}
 return out


# 共有スケジュールDBの中身の目印(backend/repositories/schedule_repo.py の実体)。
SCHEDULE_PLAN_TABLE = '作業予定'
FEATURE_ORDER = ('list', 'measure', 'plan', 'quality', 'schedule')
FEATURE_LABEL = {'list': '一覧として見る', 'measure': '測定を開く',
                 'plan': 'スケジュールへ投入', 'quality': '品質として結合',
                 'schedule': '予定の本体にする'}
