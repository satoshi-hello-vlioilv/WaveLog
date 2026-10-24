"""measurement.py: 測定コンテキスト・マスタ診断・バックアップAPI。

app.pyから移設。ロジックは変更していない(移動のみ)。
"""
import json
from flask import Blueprint, request, jsonify

from ..db_access import DBS, cfg, MEAS_DB, qi, connect, cols, tables, ensure_backup_table, merged_backup_rows, fresh_backup_rows, records_path_for, records_paths_all, records_copy_report, records_paths_holding, note_records_written, records_shared, invalidate_backup_rows_cache, QUALITY_DB_KEY, path_exists_safe
from ..access_mode import request_user_id, request_pc_name
from .body import body, any_
from .common import api_guard
# 選択肢の読み取りは §9.221 ③ で op.choice_values() の1本になった。
# **読み取り関数と表名の定数は import ごと外す**——残すと grep で
# read_operator_names が今もここに当たり、廃止した経路が現役だと誤読される
# (§9.87 で「同じ判定が2箇所に散って実際に壊れた」のと同じ入口)。
# ensure_* は /api/measurement/diagnose が今も表の作成を確かめるので残る。
from ..repositories.master_repo import (read_equipment_max_strips, read_equipment_kind,
                                        read_equipment_measure_items_off, MEASURE_ITEM_KEYS,
                                        STRIP_LIMIT, DEFAULT_MAX_STRIPS)
from ..repositories.master_repo import choice_usage_for, choice_usage_bump
from ..repositories import operation_repo as op
from .. import records_export
from ..dashboard import sources as dash_sources
from ..logging_setup import app_logger
from .. import db_mirror
from ..quiet import quiet

bp=Blueprint('measurement',__name__)

def _norm(v):return str(v or '').strip()

def _matching_table(ts,aliases):
 for a in aliases:
  if a in ts:return a
 for t in ts:
  if any(a.lower() in t.lower() for a in aliases):return t
 return None

def _matching_col(cs,aliases):
 for a in aliases:
  if a in cs:return a
 for c in cs:
  if any(a.lower() in c.lower() for a in aliases):return c
 return None

def _context_skeleton():
 """測定コンテキストの器。読めなかった段は空のまま返す（画面ごと落とさない）。"""
 return {'quality':[],'operators':[],'inspectors':[],'packers':[],'thickness_gauges':[],'width_gauges':[],'inner_diameters':[],'spools':[],'burr_types':[],'coil_stops':[],'max_strips':DEFAULT_MAX_STRIPS,'strip_limit':STRIP_LIMIT,'equipment_kind':'','measure_items_off':[],'measure_items':list(MEASURE_ITEM_KEYS),'diagnostics':{'master_path':str(DBS['MASTER']['path']),'master_exists':path_exists_safe(DBS['MASTER']['path']),'tables':[],'matches':{}}}

def _read_quality(lot,result):
 """品質情報（そのロットの異常・保留）。"""
 # 品質データは役割で引く(§9.87)。キーの綴りで探すと、マスタでキーを
 # 変えた端末で KeyError になり測定画面ごと開けなくなる。
 # **`cfg()`で引くこと**（§9.317・§9.198）。`DBS`が持っているのは設定に
 # 書いてある元のパス＝**共有そのもの**で、`cfg()`が`db_mirror`の写しへ
 # 差し替える。ここが`DBS`のままだったため、**測定画面を開くたびに共有の
 # 品質データを直接開いて**いた（一覧は`cfg()`を通るので、同じ端末でも
 # 一覧は出るのに測定画面だけ開けない、という分かりにくい形になる）。
 # **登録が消えていても測定画面ごと落とさない**（§9.87）——`cfg()`は
 # 知らないキーで送出するので、`DBS`に居ることを先に見る。
 # 品質データの写しがまだ無いときも測定画面は開く（共有は直接読まない・§9.582。品質の欄が空になるだけ）。
 try:qcfg=(cfg(QUALITY_DB_KEY) if (QUALITY_DB_KEY and QUALITY_DB_KEY in DBS) else {})
 except db_mirror.NotCopiedYet as _e:
  quiet('品質データをまだ手元へ写せていない（品質の欄は空で開く）',_e);qcfg={}
 qpath=qcfg.get('path')
 # **開く前に存在確認をしない**（§9.108・§9.317）。`Path.exists()`が
 # 「無い」と読み替えるのは ENOENT/ENOTDIR/EBADF/ELOOP と WinError
 # 21/123/1921 だけで、**WinError 5（アクセスが拒否されました）は送出する**。
 # 読み取り専用の共有では、ファイルは読めるのに属性の問い合わせだけが5で
 # 断られることがあり、**確認のつもりの1行が唯一の失敗原因**になっていた
 # （実機で「測定画面を開けません: [WinError 5]」）。まず開き、失敗したら
 # `connect()`が理由を切り分ける。**品質情報が読めなくても測定は続ける**
 # ——公差もマスタもこの後ろにあるので、ここで諦めると画面ごと開けない。
 if lot and qpath:
  try:
   with connect(qpath,True) as c:
    ts=tables(c);t=_matching_table(ts,['仕掛','品質情報','品質','保留'])
    if t:
     cs=cols(c,t,source=qpath);lot_col=_matching_col(cs,['ロット番号','ﾛｯﾄ番号','ロット№','LTNO'])
     if lot_col:
      cur=c.cursor()
      cur.execute(f'SELECT * FROM {qi(t)} WHERE CStr({qi(lot_col)})=? LIMIT 50',[lot])
      rows=cur.fetchall()
      for row in rows:
       d=dict(zip(cs,row));result['quality'].append({k:_norm(d.get(_matching_col(cs,[k]) or k)) for k in ['発生設備','登録日時','異常内容','コメント','最終処置','保留設定日','保留解除']})
  except Exception as qe:
   # **品質情報が読めなくても測定は続ける**（§9.317）。公差もマスタも
   # この後ろにあるので、ここで諦めると**測定画面ごと開けない**。
   # 黙って0件にはせず、理由を診断へ残してログにも書く（§4）。
   result['diagnostics']['quality_error']=str(qe)
   result['diagnostics']['quality_path']=str(qpath)
   app_logger().warning('品質情報を読めませんでした（測定は続けます）: %s (%s)',qpath,qe)

def _read_choices(c,equipment,result):
 """準備で選ぶ選択肢（オペレータ・測定器・内径・スプール・バリ揃え・コイル止め）。"""
 # 読み取りはオペレータマスタ（有効・表示順）から行う。
 # オペレータ欄のみ、対象設備（equipment）で作業可能設備によるフィルタをかける。
 # 割当が1件もないオペレータは常に表示対象（互換ポリシー）。検査員・梱包員は従来通り全件。
 # ---------- 選択肢は「まとまり名」で引く(§9.221 ③) ----------
 # 以前はオペレータ／機器／内径／スプール／バリ揃え／コイル止めの6つが
 # それぞれ専用の表と専用の読み取り関数を持っていた（同じことを6箇所）。
 # いまは`操業データ選択肢マスタ`の**まとまり名が違うだけ**で、読み口は
 # `op.choice_values()`の1本。設備の絞り込み（オペレータの作業可能設備）は
 # `[対象設備]`が空＝すべて、という約束でそのまま引き継いでいる。
 # **どのまとまりを見るかもマスタが決める**(§9.221 ③)。組み込みの欄の
 # `[選択肢名]`が答えるので、現場が別のまとまりへ向け替えられる。
 gname=lambda key:op.builtin_choice_name(c,key)
 people=op.choice_values(c,gname('operator'))
 people_for_equipment=(op.choice_values(c,gname('operator'),equipment=equipment)
                       if equipment else people)
 result['diagnostics']['matches']['操業データ選択肢マスタ']={
   'table':op.CHOICE_TABLE,'オペレータ':len(people),
   'filtered_by_equipment':equipment or '','filtered_count':len(people_for_equipment)}
 result['operators']=people_for_equipment
 # **検査員は設備で絞らない**（今までどおり全員）。
 result['inspectors']=people;result['packers']=people
 thickness_gauges=op.choice_values(c,gname('thicknessGauge'))
 width_gauges=op.choice_values(c,gname('widthGauge'))
 result['thickness_gauges']=thickness_gauges;result['width_gauges']=width_gauges
 inners=op.choice_values(c,gname('innerDiameter'))
 result['inner_diameters']=inners
 spools=op.choice_values(c,gname('spool'))
 result['spools']=spools
 burrs=op.choice_values(c,gname('burr'));coil_stops=op.choice_values(c,gname('coilStop'))
 result['diagnostics']['matches']['操業データ選択肢マスタ'].update({
   '板厚測定器':len(thickness_gauges),'板幅測定器':len(width_gauges),
   '内径':len(inners),'スプール':len(spools),
   'バリ揃え':len(burrs),'コイル止め':len(coil_stops)})
 result['burr_types']=burrs;result['coil_stops']=coil_stops

def _read_equipment_facts(c,equipment,result):
 """設備マスタが答える事実（最大条数・区分・使わない入力内容）と、選択肢の使用回数。"""
 # この設備で割れる最大条数(設備マスタ。未登録なら既定)。分割の上限確認と
 # 横割数の入力上限に使う。
 result['max_strips']=read_equipment_max_strips(c,equipment)
 result['diagnostics']['matches']['設備マスタ_最大条数']={'equipment':equipment,'value':result['max_strips'],'limit':STRIP_LIMIT}
 # 設備の区分(コイル／板)。板丈の公差は板の設備でだけ意味を持つため
 # (§9.157)。未設定は''で返し、画面側は「板」と決め付けない。
 result['equipment_kind']=read_equipment_kind(c,equipment)
 result['diagnostics']['matches']['設備マスタ_区分']={'equipment':equipment,'value':result['equipment_kind']}
 # この設備で**使わない入力内容**(設備マスタ。§9.392)。**ここへ相乗りさせる**
 # ——選択肢と同時に要るので、別のAPIにすると「一覧は出たが出し分けは
 # 前のまま」という瞬間ができる(上の choice_usage と同じ理由)。
 result['measure_items_off']=read_equipment_measure_items_off(c,equipment)
 result['diagnostics']['matches']['設備マスタ_無効入力内容']={
   'equipment':equipment,'value':result['measure_items_off']}
 # 設備ごとの使用回数(§9.133)。**ここへ相乗りさせる**——選択肢を並べる
 # ためだけに往復を増やさない(選択肢そのものと同時に要るデータなので、
 # 別のAPIにすると「選択肢は出たが並びは前のまま」という瞬間ができる)。
 result['choice_usage']=choice_usage_for(c,equipment)

@bp.get('/api/measurement/context')
def measurement_context():
 try:
  lot=request.args.get('lot','').strip();equipment=request.args.get('equipment','').strip()
  result=_context_skeleton()
  _read_quality(lot,result)
  master=DBS['MASTER']['path']
  if path_exists_safe(master) is not False:
   # ---------- 移行済みの6マスタはもう用意しない（§9.255 ①、利用者の報告） ----------
   # 「移行済みデータをすべて消したはずが、復活しました。
   #   旧マスタは無ければ表示しない形にしたいです」
   #
   # ここには`ensure_operator_master`ほか**7つの「無ければ作る」**が並んで
   # いた。中身は§9.221 ③で`操業データ選択肢マスタ`へ移したのに用意だけが
   # 残っていたので、**測定画面を1回開くだけで7つとも空の表として作り直され**、
   # マスタ管理の「移行済み」から消えなかった（＝消せないマスタ）。
   # 既定の選択肢（バリ揃え・コイル止め）は`operation_repo.CHOICE_SEEDS`が
   # 持つので、まっさらな端末でも選べる値は在る。
   # **`ensure_*`をここへ戻さないこと。** 移行元として読むのは
   # `migrate_legacy_choice_masters()`の1回だけで、あちらは表が無ければ
   # 「写すものが無い」として素通りする。
   # ---------- 選択肢は操業データ選択肢マスタの1本から引く(§9.221 ③) ----------
   # 利用者の指示「オペレータ、機器、スプール種別、内径種別、バリ揃え、
   # コイル止めについても汎用化した操業データ項目マスタに移行させて」。
   # **読むのは下の読み取り専用ブロック**なので、表と列をそろえ、6つの
   # マスタを1度だけ写すのはここ（上の`ensure_*`と同じ置き方）。
   try:
    result['diagnostics']['operation_choices']=op.ensure_operation_choices(master)
   except Exception as _e:result['diagnostics']['operation_choices_error']=str(_e)
   with connect(master,True) as c:
    result['diagnostics']['tables']=tables(c)
    _read_choices(c,equipment,result)
    _read_equipment_facts(c,equipment,result)
  return jsonify(result)
 except Exception as e:return jsonify(error=str(e)),500

@bp.post('/api/measurement/choice-usage')
def measurement_choice_usage():
 """準備で選んだ値の使用回数を1つ増やす(§9.133)。

 オペレータは実データで171人おり、五十音順のままだと「いつもの人」を毎回
 探すことになる。設備ごとに数えて、よく使うものを上へ並べるための記録。
 **選ばれた瞬間に数える**(保存まで待たない)——同じ人を選び直しただけでも
 使ったことに変わりはなく、待つと「今日はまだ上に来ない」が起きる。

 画面は結果を待たないので、失敗しても測定は止めない(数が1つ増えないだけ)。
 """
 try:
  x=body({'equipment': str, 'picks': any_})
  equipment=x.text('equipment')
  picks=x.get('picks') or {}
  if not equipment:return jsonify(error='設備名を指定してください。'),400
  if not isinstance(picks,dict):return jsonify(error='picksはオブジェクトで指定してください。'),400
  with connect(DBS['MASTER']['path']) as c:
   n=choice_usage_bump(c,equipment,picks,x.text('user_id'))
  return jsonify(ok=True,counted=n)
 except Exception as e:return jsonify(error=str(e)),500

@bp.get('/api/measurement/master-diagnostics')
def master_diagnostics():
 try:
  p=DBS['MASTER']['path'];found=path_exists_safe(p)
  out={'path':str(p),'exists':found,'size':0,'tables':{}}
  try:out['size']=p.stat().st_size
  except OSError:pass
  if found is not False:
   with connect(p,True) as c:
    for t in tables(c):out['tables'][t]=cols(c,t)
  return jsonify(out)
 except Exception as e:return jsonify(error=str(e)),500

@bp.post('/api/measurement/backup')
def backup():
 try:
  x=body({'id': str,'lotNo': str,'payload': any_,'equipment': str,'inspectionNo': str,
          'castingNo': str,'status': str,'codec': str,'created_by': str,'created_pc': str,
          'created_at': str,'updated_at_iso': str})
  required=['id','lotNo','payload'];missing=[k for k in required if not x.get(k)]
  if missing:return jsonify(error='必須項目不足: '+','.join(missing)),400
  # **書き込む先はその行の設備が決める**(§9.258)。設備ごとに1ファイルなので、
  # 1台の測定端末が触るファイルは原則1つ——同じファイルを2台が変えることが
  # 無くなり、クラウド同期でも壊れない。置き場が未設定ならMEAS_DB(今までどおり)。
  target=records_path_for(x.get('equipment',''),create=True)
  with connect(target) as c:
   ensure_backup_table(c);cur=c.cursor()
   # ---- 誰が・どの端末で入力を始めたか(§9.180) ----
   # **入力を始めた人と端末は上書きしない。** 測定は別のPCで続きを開ける
   # (§9.91)ので、保存のたびに書き換えると「誰が始めたか」が最後に保存した
   # 端末で塗り潰される。1行を作り直す作りなので、**消す前に控えを取る**。
   cur.execute('SELECT [登録者ID],[登録端末名],[登録日時] FROM [Web測定バックアップ] WHERE [記録ID]=?',[x['id']])
   prev=cur.fetchone() or (None,None,None)
   # 画面が送ってきた値(レコードが持つ「入力を始めた」情報)を最優先し、
   # 次に既存行の値、最後にこの端末の値へ落とす。
   created_by=x.text('created_by') or str(prev[0] or '').strip() or request_user_id(x)
   created_pc=x.text('created_pc') or str(prev[1] or '').strip() or request_pc_name()
   created_at=x.text('created_at') or (prev[2] if prev[2] else None)
   cur.execute('DELETE FROM [Web測定バックアップ] WHERE [記録ID]=?',[x['id']])
   # [更新時刻ISO]は**レコード自身の`updatedAt`**(§9.208 ⑤)。[更新日時]は
   # サーバーが押す現地時刻で、画面が持つUTCのISOとは物差しが違う——
   # 画面側の「新しい版あり」はこちらの列だけで判定する。
   record_updated_at=x.text('updated_at_iso')[:40]
   cur.execute('INSERT INTO [Web測定バックアップ] ([記録ID],[設備],[ロット番号],[検査番号],[鋳造番号],[状態],[更新日時],[圧縮形式],[ペイロード],[登録者ID],[登録端末名],[更新者ID],[更新端末名],[登録日時],[更新時刻ISO]) VALUES (?,?,?,?,?,?,Now(),?,?,?,?,?,?,?,?)',
               [x['id'],x.get('equipment',''),x.get('lotNo',''),x.get('inspectionNo',''),x.get('castingNo',''),
                x.get('status','編集中'),x.get('codec','delimiter-v1'),x['payload'],
                # 更新側は**この端末**の名前(引数を渡さない)。画面が送る
                # `pc_name`は「作った端末」の意味で使うので、混ぜない。
                created_by,created_pc,request_user_id(x),request_pc_name(),created_at,record_updated_at])
   c.commit()
  # 設備を後から入れ直した記録は、**前の設備のファイルに置き去りになる**。
  # 結合は記録IDごとに新しい方を採るので画面は正しいが、消さないと古い行が
  # 残り続ける。移した先(target)以外に同じ記録IDがあれば片付ける。
  for path,ids in records_paths_holding([x['id']]).items():
   if str(path)==str(target):continue
   try:
    with connect(path) as c2:
     c2.cursor().execute('DELETE FROM [Web測定バックアップ] WHERE [記録ID]=?',[x['id']]);c2.commit()
    # **書いた先は覚える**(§9.268)。写しから読むと、自分が消した行が
    # 写しの間隔ぶん残って見える。
    note_records_written(path)
   except Exception as e:
    app_logger().warning('設備を移した測定データ(%s)の置き去りを消せませんでした: %s',path,e)
  records_export.mark_dirty()
  # 実績バックアップのキャッシュ(§9.41)を捨てる。作業スケジュールの実績突合が
  # 保存直後の測定を必ず拾えるようにするため(署名でも変化は拾えるが、
  # 同一秒内の連続保存を取りこぼさないよう明示的に捨てる)。
  invalidate_backup_rows_cache()
  return jsonify(ok=True,direction='IndexedDB -> records.sqlite3',meas_path=str(target))
 except Exception as e:return jsonify(error=str(e)),500

@bp.post('/api/measurement/backup/delete')
def backup_delete():
 """端末内の測定データを削除したとき、バックアップ(records.sqlite3)からも消す。

 これが無かったため、データ一覧から削除しても[Web測定バックアップ]に行が
 残り続け、作業スケジュールの実績突合(§7.4)がその行を拾って「作業中
 (開始だけで終了が無い)」を出し続けていた。データ一覧には何も無いのに
 スケジュールにだけ作業中が並ぶ、という食い違いの原因(§9.52)。

 複数IDをまとめて渡せる。存在しないIDは無視して成功扱いにする
 (端末側の削除は既に済んでおり、ここで失敗にしても再送で解決しないため)。
 """
 try:
  x=body({'ids': any_, 'id': any_})
  ids=x.get('ids')
  if ids is None:
   one=x.get('id')
   ids=[one] if one else []
  ids=[str(i).strip() for i in ids if str(i or '').strip()]
  if not ids:return jsonify(error='削除対象IDがありません。'),400
  deleted=0
  # **持っているファイルだけを開く**(§9.258)。1つの記録は1つのファイルにしか
  # 無いので、全部へDELETEを流すと無関係な設備のファイルまでこの端末が
  # 書いたことになる。置き場が未設定なら今までどおりMEAS_DB 1本。
  holders=records_paths_holding(ids)
  for path,hit in holders.items():
   with connect(path) as c:
    ensure_backup_table(c);cur=c.cursor()
    for rid in hit:
     cur.execute('DELETE FROM [Web測定バックアップ] WHERE [記録ID]=?',[rid])
     deleted+=cur.rowcount or 0
    c.commit()
   # **書いた先は覚える**(§9.268)。以後この端末はここを実物から読む。
   note_records_written(path)
  records_export.mark_dirty()
  # 実績突合が次の描画で必ず消えた状態を見るようにする(§9.41のキャッシュ)。
  invalidate_backup_rows_cache()
  return jsonify(ok=True,deleted=deleted,requested=len(ids))
 except Exception as e:return jsonify(error=str(e)),500

@bp.get('/api/measurement/backup/summary')
def backup_summary():
 """データ一覧に**他のPCで保存された測定データ**を出すための軽い一覧(§9.91)。

 従来、途中経過は端末内(IndexedDB+localStorage)にしか無く、データ一覧も
 そこだけを読んでいたため、**別のPCからは同じロットの続きが見えなかった**
 (子ロットデータもレコードの中(settings.splitSourcesCache)にあるので同じ)。
 ここは records.sqlite3 の行を**ペイロード抜き**で返す。一覧に出すのに
 必要なのは見出しだけで、中身は開くときに1件だけ取ればよい
 (全件のペイロードを毎回運ぶと、共有越しでは一覧を開くたびに数MBになる)。

 読み取り専用。書き込みは一切しない。
 """
 try:
  # **読むのは全設備ぶん**(§9.258。閲覧は全設備の測定データが見られること)。
  # 結合(記録IDごとに新しい方)はmerged_backup_rows()の1箇所が持つ。**開いたその時の写しで答える**(§9.618)。
  items=fresh_backup_rows()
  paths=[str(p) for p in records_paths_all()]
  slim=[{k:v for k,v in r.items() if k!='payload'} for r in items]
  return jsonify(ok=True,items=slim,count=len(slim),table_exists=bool(items),
                 meas_path=str(MEAS_DB),meas_paths=paths,shared=records_shared())
 except Exception as e:
  # 一覧そのものは端末内のデータで出せるので、ここで500にしても画面は壊さない。
  app_logger().warning('/api/measurement/backup/summary で失敗: %s',e)
  return jsonify(error=f'共有データの一覧を読めませんでした: {e}',meas_path=str(MEAS_DB)),500

# ---------------------------------------------------------------------------
# 実績データリスト(§9.241 ③、利用者の指示)
# ---------------------------------------------------------------------------
# 「メインメニューに『実績』のデータをリストとして表示する機能。設備単位で
#  切り替えて対象期間のデータを一覧で確認できる。データ一覧の完了とは別扱いで
#  **閲覧のみ**、作業時に記録した**全データ**を扱える。」
#
# **GETだけ。書き込みは一切しない**ので、閲覧モードでもそのまま読める
# (書込ガードはGETを素通しする・backend/access_mode.py)。判定(現場日・直)は
# `backend/actuals.py`＝サーバーの1箇所が持ち、画面へ写さない(§9.163)。
ACTUALS_LIMIT_DEFAULT=2000

@bp.get('/api/measurement/actuals')
def measurement_actuals():
 from .. import actuals
 try:
  eq=str(request.args.get('equipment') or '').strip()
  frm=str(request.args.get('from') or '').strip()
  to=str(request.args.get('to') or '').strip()
  basis='cal' if str(request.args.get('basis') or '').strip()=='cal' else 'work'
  try:limit=int(request.args.get('limit') or ACTUALS_LIMIT_DEFAULT)
  except Exception as _e:quiet('数として読めない（既定で続ける）',_e);limit=ACTUALS_LIMIT_DEFAULT
  limit=max(1,min(20000,limit))
  # 記録に無い作業開始・作業終了は、ガントと同じ予定の行の実績で補う(§9.631 ②)。共有の予定を確かめるのは1分に1回まで(写しの控えが持つ)
  items=actuals.rows(equipment=eq,date_from=frm,date_to=to,basis=basis,times=dash_sources.plan_times())
  total=len(items)
  # **黙って切らない**(§CLAUDE「no silent caps」)。切ったことと件数を返し、
  # 画面が「期間を狭めてください」と書けるようにする。
  truncated=total>limit
  items=items[:limit]
  # ---- 記録した値のうち、頼まれた道ぶんだけ(§9.288 ⑧) ----
  # **全部返さない**(§9.94)——1件の記録は数百項目あり、全件ぶんを返すと
  # 一覧を開くたびに数MBになる。画面はいま出す列の道だけを送る。
  # **壊れた指定は無視して一覧は出す**(fail-open)。
  paths=[]
  try:
   raw=request.args.get('fields') or ''
   if raw:
    got=json.loads(raw)
    if isinstance(got,list):paths=[str(x) for x in got if str(x or '')][:400]
  except Exception as _e:quiet('保存された値を読めない（既定で続ける）',_e);paths=[]
  if paths:
   items=[dict(x,fields=actuals.field_values(x,paths)) for x in items]
  cat=actuals.catalog(eq)
  return jsonify(ok=True,items=items,count=len(items),total=total,
                 truncated=truncated,limit=limit,basis=basis,
                 # **列の呼び名はサーバーが答える**(§9.163)。画面が英字キーへ
                 # 日本語を当てる表を持つと、項目が増えたときに2箇所直すことになる。
                 lotFields=actuals.lot_fields(),
                 # 記録した値の候補(§9.288 ⑧)。**帳票と同じ1箇所**から作り、
                 # 派生値の群(統計・子ロット)だけ落として理由を添える。
                 fieldCatalog=cat.get('groups') or [],
                 fieldNote=cat.get('droppedNote') or '',
                 equipment=eq,**{'from':frm,'to':to})
 except Exception as e:
  app_logger().warning('/api/measurement/actuals で失敗: %s',e)
  return jsonify(error=f'実績データを読めませんでした: {e}'),500

@bp.get('/api/measurement/actuals/equipments')
def measurement_actuals_equipments():
 """実績が1件でもある設備。**設備マスタと突き合わせない**——マスタから消した
 設備の実績も見られる必要がある(履歴なので)。"""
 from .. import actuals
 try:
  return jsonify(ok=True,items=actuals.equipments())
 except Exception as e:
  app_logger().warning('/api/measurement/actuals/equipments で失敗: %s',e)
  return jsonify(error=f'設備の一覧を読めませんでした: {e}'),500

@bp.get('/api/measurement/backup/get')
def backup_get():
 """1件だけペイロード込みで返す(§9.91)。他のPCで保存された続きを開くとき、
 その1件だけを取り込むために使う。"""
 rid=str(request.args.get('id') or '').strip()
 if not rid:return jsonify(error='記録IDがありません。'),400
 try:
  items=fresh_backup_rows()
  hit=next((r for r in items if r.get('id')==rid),None)
  return jsonify(ok=True,item=hit,table_exists=bool(items),meas_path=str(MEAS_DB))
 except Exception as e:return jsonify(error=str(e)),500

@bp.get('/api/measurement/backup/list')
def backup_list():
 # PC引継ぎ等でIndexedDBが空の端末へ、db/records.sqlite3(Web測定バックアップ)から
 # インポートするための読み取り専用API。書き込みはせず、行をそのまま返す。
 # 実際のIndexedDBへの反映(JSON解凍・idbPut)はブラウザ側で行う。
 try:
  items=merged_backup_rows()
  return jsonify(ok=True,items=items,count=len(items),table_exists=bool(items),
                 meas_path=str(MEAS_DB),meas_paths=[str(p) for p in records_paths_all()])
 except Exception as e:return jsonify(error=f'測定データ読込失敗: {e}',meas_path=str(MEAS_DB)),500

@bp.post('/api/measurement/records/recopy')
@api_guard('写し直せませんでした')
def records_recopy():
 """共通設定の「置き場」の「写し直す」（§9.619）。ほかの PC が書く測定データを、いま確かめて写し直す。

 **読むだけのPOST**（共有は写すだけ・業務データは1行も書かない）。手動の設定でも写す（押したことが合図）。
 答えは1ファイルごとの読み方と理由（`records_copy_report()`）——押した結果を行で返す。"""
 n=db_mirror.refresh_records(manual=True)
 if n:invalidate_backup_rows_cache()
 return jsonify(ok=True,updated=n,files=records_copy_report())

@bp.get('/api/measurement/backup/list-view')
def backup_list_view():
 """閲覧・スケジュールモードのデータ一覧（§9.616）。**編集モードの一覧と同じ読み先**——全設備の共有の測定
 データ（写し）・この端末の分・閲覧用の複製を`merged_backup_rows()`の1箇所で結ぶ。

 以前は閲覧用の複製（records_backup_export_path）1本だけを読んでいた。共有の置き場（§9.258）を決めると複製は
 役目を終えて止まるので、**他の PC で完了した記録がこの一覧に届かなかった**（利用者の報告「測定したPCでしか
 閲覧できない」）。`configured`は「この端末の分のほかに読む先があるか」（無ければ画面が置き場の案内を出す）。
 """
 try:
  items=fresh_backup_rows()
  paths=[str(p) for p in records_paths_all()]
  configured=records_shared() or len(paths)>1
  return jsonify(ok=True,configured=configured,shared=records_shared(),items=items,count=len(items),
                 table_exists=bool(items),meas_path=str(MEAS_DB),meas_paths=paths)
 except Exception as e:return jsonify(error=f'測定データの一覧を読めませんでした: {e}',meas_path=str(MEAS_DB)),500
