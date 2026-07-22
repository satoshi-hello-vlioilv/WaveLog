from flask import Flask, render_template, request, jsonify
from pathlib import Path
import json, os, pyodbc, subprocess

app=Flask(__name__); BASE=Path(__file__).resolve().parent

# 手動管理のバージョン番号。画面に表示される「デプロイ確認用」の主表示。
# gitが使えない配布先(zipコピー等)でも必ず値が出るよう、こちらを主とする。
# 意味のある変更をコミットするたびに更新すること。
APP_VERSION='1.20.0'

# 更新履歴。画面の「VERx.y.z」バッジから一覧表示する。APP_VERSIONを
# 上げるたびに、このリストの先頭に新しいバージョンを追記すること。
CHANGELOG=[
 {'version':'1.20.0','notes':['仕掛一覧の閲覧時、使用設備と一致する(BOX設計_設備名)条件を既定で自動適用するようにした。色分け表示され、解除しようとすると確認ダイアログが出る','フィルタのマスタ登録を、条件の組み合わせ単位ではなく条件1つずつの個別登録に変更。適用時は現在の条件へ追加(マージ)するようにした','フィルタ・マスタ更新の登録者IDを、この端末のWindowsログインIDから自動取得するようにし、手入力を求めるプロンプトを廃止']},
 {'version':'1.19.0','notes':['仕掛データ取得・再開の際、BOX設計_設備名が登録済みの使用設備と一致しない場合は必須条件としてブロックするよう修正','分割(子ロット)データの実カラム名が「親子管理_子カード*」「コンマ5本分割_切断巾*」であることを反映し、子ロットデータを正しく取得できるよう修正(従来は誤ったカラム名を参照しており分割ありのロットも「分割なし」表示になっていた)','仕掛データ一覧の一番左に「分割」列を追加し、分割データの有無を一覧上で確認できるようにした']},
 {'version':'1.18.0','notes':['測定画面の「作業時間」タブに、過去実績との比較カードを追加。用途名・製造材質・製造調質・実績板厚・実績板幅・丈割数・条割数・使用設備が一致する完了データから、過去の平均作業時間・N数・バラつき(標準偏差)を算出し、今回(または作業中の経過時間)との差分を表示する']},
 {'version':'1.17.1','notes':['条割(分割)ロットで、測定中にフォーカスが移った条に応じて公差の数値表示・図示・「条ごとの公差」一覧のハイライトが連動するよう修正。従来は常に1条目の公差のまま表示が固定されていた']},
 {'version':'1.17.0','notes':['条割(分割)ロットの判定公差を、条ごとに正しい子ロットの公差で判定するよう修正。従来は分割していても常に親ロット1つの公差で判定されていた','条割変更画面に、子ロットを仕掛(SIKALOTNOW)へ再検索して取得した実際の目標幅・公差を表示','測定画面・帳票に「条ごとの公差」一覧を追加し、分割時にどの条がどのロットの公差で判定されたかを確認できるようにした']},
 {'version':'1.16.0','notes':['母材パネルに「元幅（実績）」表示欄を追加。前工程の実績板幅(BOX実績_板幅)を自動表示する','測定帳票の「母材実績／カード指示」に元幅列を追加し、帳票にも反映されるようにした']},
 {'version':'1.15.0','notes':['帳票プレビューの左側ロット一覧の幅を縮小し、帳票表示エリアの幅を拡大','帳票の表示倍率に「幅に合わせる」モードを追加し、表示エリアの幅いっぱいに帳票を表示できるようにした','帳票プレビューでCtrl(⌘)を押しながらマウスホイールを回すと、任意の倍率で拡大・縮小できるように追加(現在の倍率を常時表示)']},
 {'version':'1.14.1','notes':['実績カレンダーの「作業重量」の定義を、前工程実績重量との差分(オフ量)ではなく、当工程の算出重量(製品となる正味重量)そのものに修正']},
 {'version':'1.14.0','notes':['「実績カレンダー」を追加。日ごとの作業実績を月間カレンダーで一覧表示し、作業重量・ロット数の切替表示と、日付選択によるロット明細確認に対応','作業重量(当工程の算出重量)は、測定した板厚・板幅の平均値と母材入力(全長・前オフ・後オフ)から算出。必要な入力が揃っていないロットは重量算出対象外として明示する']},
 {'version':'1.13.1','notes':['アプリ起動直後の初期画面を、仕掛一覧(SIKALOTNOW)が自動的に表示されるように変更']},
 {'version':'1.13.0','notes':['PC引継ぎ等の特別な場面向けに、測定データ.accdb(Web測定バックアップ)からこの端末のIndexedDBへデータを取り込む「データ引継ぎ」機能をマスタ管理に追加。既存データの上書き有無を表示した上で、確認ダイアログを経てから実行する','測定データ.accdbへの保存時、[設備]列にロットの設計設備ではなく、この端末に登録された実際の使用設備を記録するよう修正']},
 {'version':'1.12.0','notes':['列単位で一覧の表示/非表示を管理する「表示マスタ」を追加。マスタ管理の「列表示」タブから仕掛一覧・品質データそれぞれ列ごとに表示切替できる']},
 {'version':'1.11.0','notes':['オペレータマスタに作業可能設備を複数登録できるようにし、設備マスタと連携','測定画面のオペレータ選択を、使用設備で作業可能なオペレータのみに絞り込むよう変更(設備未割当のオペレータは従来通り常に表示)']},
 {'version':'1.10.1','notes':['一覧統合に合わせてメニューを整理。サイドバーと測定画面の「編集中データ一覧」「完了データ一覧」ボタンを1つの「データ一覧」ボタンに統合']},
 {'version':'1.10.0','notes':['編集中データ一覧と完了データ一覧を1つの統合リストに変更。編集中/完了それぞれ独立したトグルフィルタを追加し(既定は編集中のみON)、両方ONにすると1つのリストで両方確認できるようにした','一覧の一番左に状態(編集中/完了)バッジ列を追加']},
 {'version':'1.9.6','notes':['測定帳票: 板幅などを測定した後に別の入力内容(ラテラルボー等)に切り替えたまま保存すると、板厚/板幅の実測データが帳票に表示されない不具合を修正。保存時点の選択タブではなく、実際に測定データがあるかどうかでセクション表示を判定するようにした']},
 {'version':'1.9.5','notes':['測定画面で未保存の変更があるまま×ボタンや背景クリックで閉じようとすると、破棄してよいか確認するようにした']},
 {'version':'1.9.4','notes':['測定帳票の「丈別データ」を、丈数が多いと隣接する測定データ(板厚)の領域までテキストがはみ出す不具合を修正','丈別データ(長さ・肉厚・揃い・外観・備考)を、旧帳票(B5帳票)と同じ丈ごとに行を積む構成に戻し、データ構造(丈毎のみのデータ／丈かつ条毎のデータ)に忠実な表示に再構成']},
 {'version':'1.9.3','notes':['バージョンバッジをクリックすると、アプリ内で更新履歴の一覧を表示できるように追加','README.mdを現状のプロジェクト構成に合わせて全面更新']},
 {'version':'1.9.2','notes':['自動モードの受信状態表示を実際のフォーカス状況に忠実に戻し、フォーカスが外れた場合のみ安全に自動で受信欄へ戻すよう改善','編集中/完了データ一覧の操作ボタン(続きから再開・帳票・削除)のサイズとデザインを統一','編集中/完了データ一覧の「取引先」列を「用途名」に変更']},
 {'version':'1.9.1','notes':['帳票はサイドバーからではなく、編集中/完了データ一覧の各行から開く方式に変更し、戻るボタンを追加','編集中/完了データ一覧の列を製造材質・製造板厚の表示に変更','ロット問い合わせボタンをグリッド・一覧・測定パネル共通のモダンなデザインに刷新']},
 {'version':'1.9.0','notes':['板厚/板幅・バリの自動モードが起動直後や再フォーカス中でも維持されるよう改善','板厚/板幅入力で、次に入力される板厚・板幅それぞれのセルを同時に2箇所強調表示']},
 {'version':'1.8.1','notes':['品質データ・編集中/完了データ一覧のロット番号からもLotDsp問い合わせを開けるように追加','品質データ表示中に他画面を開くと一覧が透けて見える不具合を修正']},
 {'version':'1.8.0','notes':['板厚/板幅・バリの受信欄を「自動モード」バッジのみのシンプルな表示に変更','動作確認用の診断ログ表示(直前受信)をデフォルトで非表示に']},
 {'version':'1.7.1','notes':['測定値の図示をスウォームプロット化し、直前の値だけでなく入力済み全条の値を表示']},
 {'version':'1.7.0','notes':['編集中/完了データ一覧の各行に帳票ボタンを追加し、一覧から直接そのロットの帳票プレビューを開けるように']},
 {'version':'1.6.3','notes':['IME変換セッションが受信データのクリア後も残り、次のデータと連結される不具合を修正']},
 {'version':'1.6.2','notes':['測定画面のヘッダーにもバージョンバッジを表示','受信データの診断用ログ(直前受信)を追加']},
 {'version':'1.6.1','notes':['仕掛一覧・品質データ等のテーブルで列見出しクリックによる並び替えに対応']},
 {'version':'1.6.0','notes':['編集中/完了データ一覧をモーダルからメイン画面切替表示に変更し、メニュー文言を統一']},
 {'version':'1.5.1','notes':['多条入力で受信データが更新されない不具合を修正','仕掛一覧にロット問い合わせ・行選択・フィルタ列表示を追加']},
 {'version':'1.5.0','notes':['測定種ごとに自動転送/手動入力のモードを固定し、受信欄のフォーカス維持を改善']},
 {'version':'1.4.3','notes':['IME変換ブロックが転送データ自体を弾いていた不具合を修正し、受付状態の表示をコンパクト化']},
 {'version':'1.4.2','notes':['受信欄を成功・失敗いずれの場合もクリアし、連続入力できるように修正']},
 {'version':'1.4.1','notes':['Tab/Enterキーの検知を目視確認できるインジケータを追加']},
 {'version':'1.4.0','notes':['Tab確定がIMEに横取りされて検知できない場合のフォールバック処理を追加']},
 {'version':'1.3.2','notes':['受信欄のリアルタイム書き換えが測定器側と衝突し、文字列が壊れる不具合を修正']},
 {'version':'1.3.1','notes':['全角/半角の強制変換を自動転送時のみに限定(手動入力は自由入力のまま)']},
 {'version':'1.3.0','notes':['測定器受信欄の全角文字対策を追加']},
 {'version':'1.2.0','notes':['手動管理のバージョン番号表示を追加し、git非対応の配布環境でも常にバージョンが表示されるように']},
]

def _git_version():
 # 参考情報(ツールチップ用)。git非対応の配布環境では取得できないため
 # 失敗しても画面表示自体には影響しないようベストエフォートにする。
 try:
  rev=subprocess.check_output(['git','rev-parse','--short','HEAD'],cwd=BASE,stderr=subprocess.DEVNULL).decode().strip()
  when=subprocess.check_output(['git','log','-1','--format=%cI'],cwd=BASE,stderr=subprocess.DEVNULL).decode().strip()
  dirty=bool(subprocess.check_output(['git','status','--porcelain'],cwd=BASE,stderr=subprocess.DEVNULL).decode().strip())
  return {'commit':rev,'commit_at':when,'dirty':dirty}
 except Exception:
  return {'commit':'','commit_at':'','dirty':False}
GIT_VERSION=_git_version()
SIKA_DIR=Path(r"\\Nlmsrvngy03\Read\【New】仕掛\台帳")
DBS={
 "SIKALOTNOW":{"path":SIKA_DIR/"SIKALOTNOW.accdb","label":"仕掛（現在）","role":"readonly","preferred":"仕掛"},
 "SIKALOTDEF":{"path":SIKA_DIR/"SIKALOTDEF.accdb","label":"品質データ","role":"readonly","preferred":"仕掛"},
 "MASTER":{"path":BASE/"マスタ.accdb","label":"マスタ","role":"master","preferred":"オペレータマスタ"}}
def resolve_local_db(candidates):
 for name in candidates:
  path=BASE/name
  if path.exists():return path
 for path in BASE.glob('*.accdb'):
  if any(token.lower() in path.name.lower() for token in candidates):return path
 return BASE/candidates[0]
DBS['MASTER']['path']=resolve_local_db(['マスタ.accdb','マスタデータ.accdb','Master.accdb'])
MEAS_DB=resolve_local_db(['測定データ.accdb','Measurement.accdb']); DRIVER="Microsoft Access Driver (*.mdb, *.accdb)"

def qi(s): return '['+str(s).replace(']',']]')+']'
def connect(path,readonly=False):
 if not path.exists(): raise FileNotFoundError(f"データベースが見つかりません: {path}")
 return pyodbc.connect(f"DRIVER={{{DRIVER}}};DBQ={path};"+("READONLY=1;" if readonly else ""),autocommit=False,timeout=10)
def cols(c,t):
 cur=c.cursor();cur.execute(f"SELECT TOP 1 * FROM {qi(t)}");return [x[0] for x in cur.description]
def tables(c): return sorted({r.table_name for r in c.cursor().tables(tableType='TABLE') if r.table_name and not r.table_name.startswith(('MSys','USys','~'))},key=str.casefold)
def cfg(k):
 if k not in DBS: raise ValueError('データベース指定が不正です')
 return DBS[k]

# ========================================================================
# 更新対象者（ユーザーID）の管理
# ========================================================================
AUDIT_COLUMNS=(('登録者ID','TEXT(50)'),('更新者ID','TEXT(50)'))
def ensure_audit_columns(c,table):
 try:existing=set(cols(c,table))
 except Exception:return False
 cur=c.cursor();changed=False
 for name,typ in AUDIT_COLUMNS:
  if name not in existing:
   cur.execute(f'ALTER TABLE {qi(table)} ADD COLUMN {qi(name)} {typ}');changed=True
 if changed:c.commit()
 return changed
def request_user_id(x):
 x=x or {}
 for k in ('user_id','userId','updated_by','更新者ID'):
  v=str(x.get(k) or '').strip()
  if v:return v[:50]
 return ''

def ensure_backup_table(c):
 names=tables(c)
 if 'Web測定バックアップ' not in names:
  c.cursor().execute('CREATE TABLE [Web測定バックアップ] ([記録ID] TEXT(80), [設備] TEXT(20), [ロット番号] TEXT(40), [検査番号] TEXT(40), [鋳造番号] TEXT(40), [状態] TEXT(20), [更新日時] DATETIME, [圧縮形式] TEXT(30), [ペイロード] LONGCHAR)')
  c.commit()


EQUIPMENT_MASTER_TABLE='設備マスタ'
def ensure_equipment_master_table(c):
 names=tables(c);created=False
 if EQUIPMENT_MASTER_TABLE not in names:
  # Access SQLの互換性を優先し、制約と索引は別SQLで作成する。
  cur=c.cursor()
  cur.execute('CREATE TABLE [設備マスタ] ([設備ID] COUNTER, [設備名] TEXT(50), [表示順] INTEGER, [有効] YESNO, [登録者ID] TEXT(50), [更新者ID] TEXT(50), [登録日時] DATETIME, [更新日時] DATETIME)')
  cur.execute('CREATE UNIQUE INDEX [UX_設備マスタ_設備名] ON [設備マスタ] ([設備名])')
  c.commit();created=True
 ensure_audit_columns(c,EQUIPMENT_MASTER_TABLE)
 return created

def normalize_equipment_name(value):
 import unicodedata
 return unicodedata.normalize('NFKC',str(value or '')).strip().upper()

def equipment_master_rows(c):
 ensure_equipment_master_table(c)
 cur=c.cursor()
 # AccessのYESNO条件式差異を避け、全行取得後にPython側で有効判定する。
 cur.execute('SELECT [設備ID],[設備名],[表示順],[有効],[更新日時],[更新者ID] FROM [設備マスタ] ORDER BY [表示順],[設備名]')
 rows=[]
 for r in cur.fetchall():
  active=True if r[3] is None else bool(r[3])
  if active and str(r[1] or '').strip():rows.append(r)
 return rows

@app.get('/api/equipment-master')
def equipment_master_list():
 try:
  path=DBS['MASTER']['path']
  if not path.exists():raise FileNotFoundError(f'マスタ.accdbが見つかりません: {path}')
  with connect(path,False) as c:
   before=EQUIPMENT_MASTER_TABLE in tables(c);rows=equipment_master_rows(c)
   items=[{'id':r[0],'name':str(r[1] or '').strip(),'order':r[2] or 0,'active':True,'updated_at':r[4].isoformat() if r[4] else None,'updated_by':(str(r[5]).strip() if len(r)>5 and r[5] else '')} for r in rows]
  return jsonify(ok=True,items=items,table=EQUIPMENT_MASTER_TABLE,created=not before,empty=len(items)==0,master_path=str(path))
 except Exception as e:return jsonify(error=f'設備マスタ読込失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

@app.post('/api/equipment-master')
def equipment_master_register():
 try:
  x=request.get_json(force=True) or {};name=str(x.get('name') or '').strip();uid=request_user_id(x)
  if not name:return jsonify(error='設備名を入力してください。'),400
  path=DBS['MASTER']['path']
  if not path.exists():raise FileNotFoundError(f'マスタ.accdbが見つかりません: {path}')
  with connect(path,False) as c:
   ensure_equipment_master_table(c);cur=c.cursor();cur.execute('SELECT [設備ID],[設備名] FROM [設備マスタ]');rows=cur.fetchall();target=normalize_equipment_name(name);existing=next((r for r in rows if normalize_equipment_name(r[1])==target),None)
   if existing:
    cur.execute('UPDATE [設備マスタ] SET [有効]=-1,[更新者ID]=?,[更新日時]=Now() WHERE [設備ID]=?',[uid,existing[0]]);registered=False;stored_name=str(existing[1]).strip()
   else:
    cur.execute('SELECT Max([表示順]) FROM [設備マスタ]');maximum=cur.fetchone()[0];order=int(maximum or 0)+10
    cur.execute('INSERT INTO [設備マスタ] ([設備名],[表示順],[有効],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,-1,?,?,Now(),Now())',[name,order,uid,uid]);registered=True;stored_name=name
   c.commit()
  return jsonify(ok=True,name=stored_name,registered=registered,updated_by=uid,message=('設備マスタへ新規登録しました。次回から設備リストに表示されます。' if registered else '設備マスタの登録済み設備を使用します。'))
 except Exception as e:return jsonify(error=f'設備マスタ登録失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

@app.post('/api/equipment-master/update')
def equipment_master_update():
 try:
  x=request.get_json(force=True) or {};eid=x.get('id');name=str(x.get('name') or '').strip();uid=request_user_id(x)
  if eid is None:return jsonify(error='更新対象IDがありません。'),400
  if not name:return jsonify(error='設備名を入力してください。'),400
  path=DBS['MASTER']['path']
  if not path.exists():raise FileNotFoundError(f'マスタ.accdbが見つかりません: {path}')
  with connect(path,False) as c:
   ensure_equipment_master_table(c);cur=c.cursor();cur.execute('SELECT [設備ID],[設備名] FROM [設備マスタ]');rows=cur.fetchall();target=normalize_equipment_name(name)
   dup=next((r for r in rows if normalize_equipment_name(r[1])==target and str(r[0])!=str(eid)),None)
   if dup:return jsonify(error=f'同名の設備が既に存在するため変更できません: {str(dup[1]).strip()}'),409
   cur.execute('UPDATE [設備マスタ] SET [設備名]=?,[有効]=-1,[更新者ID]=?,[更新日時]=Now() WHERE [設備ID]=?',[name,uid,eid]);c.commit()
  return jsonify(ok=True,id=eid,name=name,updated_by=uid,message='設備名を更新しました。')
 except Exception as e:return jsonify(error=f'設備マスタ更新失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

# ========================================================================
# オペレータマスタ（一般的なオートナンバー方式）
#  - 主キーは COUNTER（オートナンバー）で人手管理不要。
#  - 有効フラグ・表示順・登録/更新日時を持ち、論理削除で履歴を保持。
#  - 読み取り（measurement_context）もこのマスタから行う。
# ========================================================================
OPERATOR_MASTER_TABLE='オペレータマスタ'
def ensure_operator_master_table(c):
 names=tables(c);created=False
 if OPERATOR_MASTER_TABLE not in names:
  # 設備マスタと同じ方針。Access SQL互換のため制約と索引は別SQLで作成する。
  cur=c.cursor()
  cur.execute('CREATE TABLE [オペレータマスタ] ([オペレータID] COUNTER, [氏名] TEXT(50), [ﾖﾐｶﾞﾅ] TEXT(50), [表示順] INTEGER, [有効] YESNO, [登録者ID] TEXT(50), [更新者ID] TEXT(50), [登録日時] DATETIME, [更新日時] DATETIME)')
  cur.execute('CREATE UNIQUE INDEX [UX_オペレータマスタ_氏名] ON [オペレータマスタ] ([氏名])')
  c.commit();created=True
 ensure_audit_columns(c,OPERATOR_MASTER_TABLE)
 return created

def normalize_operator_name(value):
 import unicodedata
 return unicodedata.normalize('NFKC',str(value or '')).strip().upper()

def ensure_operator_master(path):
 # 書き込み接続でテーブルの存在を保証する。measurement_context の前処理に使う。
 with connect(path,False) as c:
  created=ensure_operator_master_table(c)
 return created

def operator_master_rows(c):
 ensure_operator_master_table(c)
 cur=c.cursor()
 # AccessのYESNO条件式差異を避け、全行取得後にPython側で有効判定する。
 cur.execute('SELECT [オペレータID],[氏名],[表示順],[有効],[更新日時],[更新者ID] FROM [オペレータマスタ] ORDER BY [表示順],[氏名]')
 rows=[]
 for r in cur.fetchall():
  active=True if r[3] is None else bool(r[3])
  if active and str(r[1] or '').strip():rows.append(r)
 return rows

# ------------------------------------------------------------------------
# オペレータ設備マスタ（オペレータ×設備の中間テーブル、多対多）
#  - 設備マスタと同じ表記ゆれ吸収(normalize_equipment_name)で名称突合する。
#  - あるオペレータの割当が0件＝「制限なし（全設備で表示）」として扱う。
#    既存オペレータを不用意に画面から消さないための互換ポリシー。
# ------------------------------------------------------------------------
OPERATOR_EQUIPMENT_TABLE='オペレータ設備マスタ'
def ensure_operator_equipment_table(c):
 names=tables(c);created=False
 if OPERATOR_EQUIPMENT_TABLE not in names:
  cur=c.cursor()
  cur.execute('CREATE TABLE [オペレータ設備マスタ] ([ID] COUNTER, [オペレータID] LONG, [設備名] TEXT(50), [登録者ID] TEXT(50), [更新者ID] TEXT(50), [登録日時] DATETIME, [更新日時] DATETIME)')
  cur.execute('CREATE UNIQUE INDEX [UX_オペレータ設備マスタ] ON [オペレータ設備マスタ] ([オペレータID],[設備名])')
  c.commit();created=True
 ensure_audit_columns(c,OPERATOR_EQUIPMENT_TABLE)
 return created

def operator_equipment_map(c):
 # {オペレータID: [設備名, ...]} を返す。テーブル未作成の場合は空。
 ensure_operator_equipment_table(c)
 cur=c.cursor();cur.execute('SELECT [オペレータID],[設備名] FROM [オペレータ設備マスタ] ORDER BY [設備名]')
 out={}
 for oid,name in cur.fetchall():
  nm=str(name or '').strip()
  if not nm:continue
  out.setdefault(oid,[]).append(nm)
 return out

def ensure_operator_equipment(path):
 # 書き込み接続でテーブルの存在を保証する。measurement_context の前処理に使う。
 with connect(path,False) as c:
  created=ensure_operator_equipment_table(c)
 return created

def set_operator_equipment(c,oid,names,uid):
 # 指定オペレータの割当設備を names の内容に完全同期する（増分の追加・削除）。
 ensure_operator_equipment_table(c)
 cur=c.cursor()
 wanted={str(n).strip() for n in (names or []) if str(n or '').strip()}
 cur.execute('SELECT [ID],[設備名] FROM [オペレータ設備マスタ] WHERE [オペレータID]=?',[oid])
 existing={str(r[1] or '').strip():r[0] for r in cur.fetchall()}
 for nm,rid in existing.items():
  if nm not in wanted:cur.execute('DELETE FROM [オペレータ設備マスタ] WHERE [ID]=?',[rid])
 for nm in wanted:
  if nm not in existing:
   cur.execute('INSERT INTO [オペレータ設備マスタ] ([オペレータID],[設備名],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,?,Now(),Now())',[oid,nm,uid,uid])
 c.commit()

def read_operator_names(c,equipment=None):
 # 読み取り専用接続から、有効なオペレータ氏名を表示順で取得する。
 # equipment指定時は、割当設備を持つオペレータをその設備でフィルタする。
 # 割当が1件もないオペレータは「制限なし」として常に含める（互換ポリシー）。
 if OPERATOR_MASTER_TABLE not in tables(c):return []
 cur=c.cursor();cur.execute('SELECT [オペレータID],[氏名],[表示順],[有効] FROM [オペレータマスタ] ORDER BY [表示順],[氏名]')
 rows=cur.fetchall()
 target=normalize_equipment_name(equipment) if equipment else ''
 eqmap=operator_equipment_map(c) if (target and OPERATOR_EQUIPMENT_TABLE in tables(c)) else {}
 out=[];seen=set()
 for oid,nm,order,active in rows:
  active=True if active is None else bool(active);nm=str(nm or '').strip()
  if not active or not nm:continue
  if target:
   assigned=eqmap.get(oid) or []
   if assigned and not any(normalize_equipment_name(a)==target for a in assigned):continue
  if nm.casefold() not in seen:seen.add(nm.casefold());out.append(nm)
 return out

@app.get('/api/operator-master')
def operator_master_list():
 try:
  path=DBS['MASTER']['path']
  if not path.exists():raise FileNotFoundError(f'マスタ.accdbが見つかりません: {path}')
  with connect(path,False) as c:
   before=OPERATOR_MASTER_TABLE in tables(c);ensure_operator_master_table(c);rows=operator_master_rows(c);eqmap=operator_equipment_map(c)
   items=[{'id':r[0],'name':str(r[1] or '').strip(),'order':r[2] or 0,'active':True,'updated_at':r[4].isoformat() if r[4] else None,'updated_by':(str(r[5]).strip() if len(r)>5 and r[5] else ''),'equipment':eqmap.get(r[0],[])} for r in rows]
  return jsonify(ok=True,items=items,table=OPERATOR_MASTER_TABLE,created=not before,empty=len(items)==0,master_path=str(path))
 except Exception as e:return jsonify(error=f'オペレータマスタ読込失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

@app.post('/api/operator-master')
def operator_master_register():
 try:
  x=request.get_json(force=True) or {};name=str(x.get('name') or '').strip();yomi=str(x.get('yomi') or '').strip();equipment=x.get('equipment') or [];uid=request_user_id(x)
  if not name:return jsonify(error='氏名を入力してください。'),400
  path=DBS['MASTER']['path']
  if not path.exists():raise FileNotFoundError(f'マスタ.accdbが見つかりません: {path}')
  with connect(path,False) as c:
   ensure_operator_master_table(c);cur=c.cursor();cur.execute('SELECT [オペレータID],[氏名] FROM [オペレータマスタ]');rows=cur.fetchall();target=normalize_operator_name(name);existing=next((r for r in rows if normalize_operator_name(r[1])==target),None)
   if existing:
    # 既存氏名は有効化のみ。ﾖﾐｶﾞﾅは指定があるときだけ更新する（Accessの IIf/式差異を避ける）。
    if yomi:cur.execute('UPDATE [オペレータマスタ] SET [有効]=-1,[ﾖﾐｶﾞﾅ]=?,[更新者ID]=?,[更新日時]=Now() WHERE [オペレータID]=?',[yomi,uid,existing[0]])
    else:cur.execute('UPDATE [オペレータマスタ] SET [有効]=-1,[更新者ID]=?,[更新日時]=Now() WHERE [オペレータID]=?',[uid,existing[0]])
    registered=False;stored_name=str(existing[1]).strip();oid=existing[0]
   else:
    cur.execute('SELECT Max([表示順]) FROM [オペレータマスタ]');maximum=cur.fetchone()[0];order=int(maximum or 0)+10
    cur.execute('INSERT INTO [オペレータマスタ] ([氏名],[ﾖﾐｶﾞﾅ],[表示順],[有効],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,-1,?,?,Now(),Now())',[name,yomi,order,uid,uid]);registered=True;stored_name=name
    cur.execute('SELECT @@IDENTITY');oid=cur.fetchone()[0]
   c.commit();set_operator_equipment(c,oid,equipment,uid)
  return jsonify(ok=True,name=stored_name,registered=registered,updated_by=uid,message=('オペレータマスタへ新規登録しました。' if registered else 'オペレータマスタの登録済み氏名を有効化しました。'))
 except Exception as e:return jsonify(error=f'オペレータマスタ登録失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

@app.post('/api/operator-master/update')
def operator_master_update():
 try:
  x=request.get_json(force=True) or {};oid=x.get('id');name=str(x.get('name') or '').strip();yomi=str(x.get('yomi') or '').strip();equipment=x.get('equipment');uid=request_user_id(x)
  if oid is None:return jsonify(error='更新対象IDがありません。'),400
  if not name:return jsonify(error='氏名を入力してください。'),400
  path=DBS['MASTER']['path']
  if not path.exists():raise FileNotFoundError(f'マスタ.accdbが見つかりません: {path}')
  with connect(path,False) as c:
   ensure_operator_master_table(c);cur=c.cursor();cur.execute('SELECT [オペレータID],[氏名] FROM [オペレータマスタ]');rows=cur.fetchall();target=normalize_operator_name(name)
   dup=next((r for r in rows if normalize_operator_name(r[1])==target and str(r[0])!=str(oid)),None)
   if dup:return jsonify(error=f'同名の氏名が既に存在するため変更できません: {str(dup[1]).strip()}'),409
   cur.execute('UPDATE [オペレータマスタ] SET [氏名]=?,[ﾖﾐｶﾞﾅ]=?,[有効]=-1,[更新者ID]=?,[更新日時]=Now() WHERE [オペレータID]=?',[name,yomi,uid,oid]);c.commit()
   if equipment is not None:set_operator_equipment(c,oid,equipment,uid)
  return jsonify(ok=True,id=oid,name=name,updated_by=uid,message='オペレータを更新しました。')
 except Exception as e:return jsonify(error=f'オペレータマスタ更新失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

@app.post('/api/operator-master/delete')
def operator_master_delete():
 try:
  x=request.get_json(force=True) or {};oid=x.get('id');uid=request_user_id(x)
  if oid is None:return jsonify(error='削除対象IDがありません。'),400
  path=DBS['MASTER']['path']
  if not path.exists():raise FileNotFoundError(f'マスタ.accdbが見つかりません: {path}')
  with connect(path,False) as c:
   ensure_operator_master_table(c);cur=c.cursor()
   # 物理削除ではなく無効化し、履歴を残す。無効化した更新者も記録する。
   cur.execute('UPDATE [オペレータマスタ] SET [有効]=0,[更新者ID]=?,[更新日時]=Now() WHERE [オペレータID]=?',[uid,oid]);c.commit()
  return jsonify(ok=True,id=oid,updated_by=uid)
 except Exception as e:return jsonify(error=f'オペレータマスタ削除失敗: {e}'),500

# ========================================================================
# スプール種別マスタ（一般的なオートナンバー方式）
#  - 主キーは COUNTER（オートナンバー）で人手管理不要。
#  - 有効フラグ・表示順・登録/更新日時を持ち、論理削除で履歴を保持。
#  - 読み取り（measurement_context）もこのマスタから行う。
# ========================================================================
SPOOL_MASTER_TABLE='スプール種別マスタ'
def ensure_spool_master_table(c):
 names=tables(c);created=False
 if SPOOL_MASTER_TABLE not in names:
  # 設備マスタ・オペレータマスタと同じ方針。Access SQL互換のため制約と索引は別SQLで作成する。
  cur=c.cursor()
  cur.execute('CREATE TABLE [スプール種別マスタ] ([スプールID] COUNTER, [種別名] TEXT(50), [備考] TEXT(120), [表示順] INTEGER, [有効] YESNO, [登録者ID] TEXT(50), [更新者ID] TEXT(50), [登録日時] DATETIME, [更新日時] DATETIME)')
  cur.execute('CREATE UNIQUE INDEX [UX_スプール種別マスタ_種別名] ON [スプール種別マスタ] ([種別名])')
  c.commit();created=True
 ensure_audit_columns(c,SPOOL_MASTER_TABLE)
 return created

def normalize_spool_name(value):
 import unicodedata
 return unicodedata.normalize('NFKC',str(value or '')).strip().upper()

def ensure_spool_master(path):
 # 書き込み接続でテーブルの存在を保証する。measurement_context の前処理に使う。
 with connect(path,False) as c:
  created=ensure_spool_master_table(c)
 return created

def spool_master_rows(c):
 ensure_spool_master_table(c)
 cur=c.cursor()
 # AccessのYESNO条件式差異を避け、全行取得後にPython側で有効判定する。
 cur.execute('SELECT [スプールID],[種別名],[表示順],[有効],[更新日時],[更新者ID] FROM [スプール種別マスタ] ORDER BY [表示順],[種別名]')
 rows=[]
 for r in cur.fetchall():
  active=True if r[3] is None else bool(r[3])
  if active and str(r[1] or '').strip():rows.append(r)
 return rows

def read_spool_names(c):
 # 読み取り専用接続から、有効なスプール種別名を表示順で取得する。
 if SPOOL_MASTER_TABLE not in tables(c):return []
 cur=c.cursor();cur.execute('SELECT [種別名],[表示順],[有効] FROM [スプール種別マスタ] ORDER BY [表示順],[種別名]')
 out=[];seen=set()
 for r in cur.fetchall():
  active=True if r[2] is None else bool(r[2]);nm=str(r[0] or '').strip()
  if active and nm and nm.casefold() not in seen:seen.add(nm.casefold());out.append(nm)
 return out

@app.get('/api/spool-master')
def spool_master_list():
 try:
  path=DBS['MASTER']['path']
  if not path.exists():raise FileNotFoundError(f'マスタ.accdbが見つかりません: {path}')
  with connect(path,False) as c:
   before=SPOOL_MASTER_TABLE in tables(c);ensure_spool_master_table(c);rows=spool_master_rows(c)
   items=[{'id':r[0],'name':str(r[1] or '').strip(),'order':r[2] or 0,'active':True,'updated_at':r[4].isoformat() if r[4] else None,'updated_by':(str(r[5]).strip() if len(r)>5 and r[5] else '')} for r in rows]
  return jsonify(ok=True,items=items,table=SPOOL_MASTER_TABLE,created=not before,empty=len(items)==0,master_path=str(path))
 except Exception as e:return jsonify(error=f'スプール種別マスタ読込失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

@app.post('/api/spool-master')
def spool_master_register():
 try:
  x=request.get_json(force=True) or {};name=str(x.get('name') or '').strip();note=str(x.get('note') or '').strip();uid=request_user_id(x)
  if not name:return jsonify(error='種別名を入力してください。'),400
  path=DBS['MASTER']['path']
  if not path.exists():raise FileNotFoundError(f'マスタ.accdbが見つかりません: {path}')
  with connect(path,False) as c:
   ensure_spool_master_table(c);cur=c.cursor();cur.execute('SELECT [スプールID],[種別名] FROM [スプール種別マスタ]');rows=cur.fetchall();target=normalize_spool_name(name);existing=next((r for r in rows if normalize_spool_name(r[1])==target),None)
   if existing:
    # 既存種別は有効化のみ。備考は指定があるときだけ更新する（Accessの IIf/式差異を避ける）。
    if note:cur.execute('UPDATE [スプール種別マスタ] SET [有効]=-1,[備考]=?,[更新者ID]=?,[更新日時]=Now() WHERE [スプールID]=?',[note,uid,existing[0]])
    else:cur.execute('UPDATE [スプール種別マスタ] SET [有効]=-1,[更新者ID]=?,[更新日時]=Now() WHERE [スプールID]=?',[uid,existing[0]])
    registered=False;stored_name=str(existing[1]).strip()
   else:
    cur.execute('SELECT Max([表示順]) FROM [スプール種別マスタ]');maximum=cur.fetchone()[0];order=int(maximum or 0)+10
    cur.execute('INSERT INTO [スプール種別マスタ] ([種別名],[備考],[表示順],[有効],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,-1,?,?,Now(),Now())',[name,note,order,uid,uid]);registered=True;stored_name=name
   c.commit()
  return jsonify(ok=True,name=stored_name,registered=registered,updated_by=uid,message=('スプール種別マスタへ新規登録しました。' if registered else 'スプール種別マスタの登録済み種別を有効化しました。'))
 except Exception as e:return jsonify(error=f'スプール種別マスタ登録失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

@app.post('/api/spool-master/update')
def spool_master_update():
 try:
  x=request.get_json(force=True) or {};sid=x.get('id');name=str(x.get('name') or '').strip();note=str(x.get('note') or '').strip();uid=request_user_id(x)
  if sid is None:return jsonify(error='更新対象IDがありません。'),400
  if not name:return jsonify(error='種別名を入力してください。'),400
  path=DBS['MASTER']['path']
  if not path.exists():raise FileNotFoundError(f'マスタ.accdbが見つかりません: {path}')
  with connect(path,False) as c:
   ensure_spool_master_table(c);cur=c.cursor();cur.execute('SELECT [スプールID],[種別名] FROM [スプール種別マスタ]');rows=cur.fetchall();target=normalize_spool_name(name)
   dup=next((r for r in rows if normalize_spool_name(r[1])==target and str(r[0])!=str(sid)),None)
   if dup:return jsonify(error=f'同名の種別が既に存在するため変更できません: {str(dup[1]).strip()}'),409
   cur.execute('UPDATE [スプール種別マスタ] SET [種別名]=?,[備考]=?,[有効]=-1,[更新者ID]=?,[更新日時]=Now() WHERE [スプールID]=?',[name,note,uid,sid]);c.commit()
  return jsonify(ok=True,id=sid,name=name,updated_by=uid,message='スプール種別を更新しました。')
 except Exception as e:return jsonify(error=f'スプール種別マスタ更新失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

@app.post('/api/spool-master/delete')
def spool_master_delete():
 try:
  x=request.get_json(force=True) or {};sid=x.get('id');uid=request_user_id(x)
  if sid is None:return jsonify(error='削除対象IDがありません。'),400
  path=DBS['MASTER']['path']
  if not path.exists():raise FileNotFoundError(f'マスタ.accdbが見つかりません: {path}')
  with connect(path,False) as c:
   ensure_spool_master_table(c);cur=c.cursor()
   # 物理削除ではなく無効化し、履歴を残す。無効化した更新者も記録する。
   cur.execute('UPDATE [スプール種別マスタ] SET [有効]=0,[更新者ID]=?,[更新日時]=Now() WHERE [スプールID]=?',[uid,sid]);c.commit()
  return jsonify(ok=True,id=sid,updated_by=uid)
 except Exception as e:return jsonify(error=f'スプール種別マスタ削除失敗: {e}'),500

# ========================================================================
# 内径種別マスタ（一般的なオートナンバー方式）
#  - 主キーは COUNTER（オートナンバー）で人手管理不要。
#  - 有効フラグ・表示順・登録/更新日時を持ち、論理削除で履歴を保持。
#  - 読み取り（measurement_context）もこのマスタから行う。
# ========================================================================
INNER_MASTER_TABLE='内径種別マスタ'
def ensure_inner_master_table(c):
 names=tables(c);created=False
 if INNER_MASTER_TABLE not in names:
  # 設備マスタ・オペレータマスタ・スプール種別マスタと同じ方針。Access SQL互換のため制約と索引は別SQLで作成する。
  cur=c.cursor()
  cur.execute('CREATE TABLE [内径種別マスタ] ([内径ID] COUNTER, [内径種別] TEXT(50), [備考] TEXT(120), [表示順] INTEGER, [有効] YESNO, [登録者ID] TEXT(50), [更新者ID] TEXT(50), [登録日時] DATETIME, [更新日時] DATETIME)')
  cur.execute('CREATE UNIQUE INDEX [UX_内径種別マスタ_内径種別] ON [内径種別マスタ] ([内径種別])')
  c.commit();created=True
 ensure_audit_columns(c,INNER_MASTER_TABLE)
 return created

def normalize_inner_name(value):
 import unicodedata
 return unicodedata.normalize('NFKC',str(value or '')).strip().upper()

def ensure_inner_master(path):
 # 書き込み接続でテーブルの存在を保証する。measurement_context の前処理に使う。
 with connect(path,False) as c:
  created=ensure_inner_master_table(c)
 return created

def inner_master_rows(c):
 ensure_inner_master_table(c)
 cur=c.cursor()
 # AccessのYESNO条件式差異を避け、全行取得後にPython側で有効判定する。
 cur.execute('SELECT [内径ID],[内径種別],[表示順],[有効],[更新日時],[更新者ID] FROM [内径種別マスタ] ORDER BY [表示順],[内径種別]')
 rows=[]
 for r in cur.fetchall():
  active=True if r[3] is None else bool(r[3])
  if active and str(r[1] or '').strip():rows.append(r)
 return rows

def read_inner_names(c):
 # 読み取り専用接続から、有効な内径種別を表示順で取得する。
 if INNER_MASTER_TABLE not in tables(c):return []
 cur=c.cursor();cur.execute('SELECT [内径種別],[表示順],[有効] FROM [内径種別マスタ] ORDER BY [表示順],[内径種別]')
 out=[];seen=set()
 for r in cur.fetchall():
  active=True if r[2] is None else bool(r[2]);nm=str(r[0] or '').strip()
  if active and nm and nm.casefold() not in seen:seen.add(nm.casefold());out.append(nm)
 return out

@app.get('/api/inner-master')
def inner_master_list():
 try:
  path=DBS['MASTER']['path']
  if not path.exists():raise FileNotFoundError(f'マスタ.accdbが見つかりません: {path}')
  with connect(path,False) as c:
   before=INNER_MASTER_TABLE in tables(c);ensure_inner_master_table(c);rows=inner_master_rows(c)
   items=[{'id':r[0],'name':str(r[1] or '').strip(),'order':r[2] or 0,'active':True,'updated_at':r[4].isoformat() if r[4] else None,'updated_by':(str(r[5]).strip() if len(r)>5 and r[5] else '')} for r in rows]
  return jsonify(ok=True,items=items,table=INNER_MASTER_TABLE,created=not before,empty=len(items)==0,master_path=str(path))
 except Exception as e:return jsonify(error=f'内径種別マスタ読込失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

@app.post('/api/inner-master')
def inner_master_register():
 try:
  x=request.get_json(force=True) or {};name=str(x.get('name') or '').strip();note=str(x.get('note') or '').strip();uid=request_user_id(x)
  if not name:return jsonify(error='内径種別を入力してください。'),400
  path=DBS['MASTER']['path']
  if not path.exists():raise FileNotFoundError(f'マスタ.accdbが見つかりません: {path}')
  with connect(path,False) as c:
   ensure_inner_master_table(c);cur=c.cursor();cur.execute('SELECT [内径ID],[内径種別] FROM [内径種別マスタ]');rows=cur.fetchall();target=normalize_inner_name(name);existing=next((r for r in rows if normalize_inner_name(r[1])==target),None)
   if existing:
    # 既存種別は有効化のみ。備考は指定があるときだけ更新する（Accessの IIf/式差異を避ける）。
    if note:cur.execute('UPDATE [内径種別マスタ] SET [有効]=-1,[備考]=?,[更新者ID]=?,[更新日時]=Now() WHERE [内径ID]=?',[note,uid,existing[0]])
    else:cur.execute('UPDATE [内径種別マスタ] SET [有効]=-1,[更新者ID]=?,[更新日時]=Now() WHERE [内径ID]=?',[uid,existing[0]])
    registered=False;stored_name=str(existing[1]).strip()
   else:
    cur.execute('SELECT Max([表示順]) FROM [内径種別マスタ]');maximum=cur.fetchone()[0];order=int(maximum or 0)+10
    cur.execute('INSERT INTO [内径種別マスタ] ([内径種別],[備考],[表示順],[有効],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,-1,?,?,Now(),Now())',[name,note,order,uid,uid]);registered=True;stored_name=name
   c.commit()
  return jsonify(ok=True,name=stored_name,registered=registered,updated_by=uid,message=('内径種別マスタへ新規登録しました。' if registered else '内径種別マスタの登録済み種別を有効化しました。'))
 except Exception as e:return jsonify(error=f'内径種別マスタ登録失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

@app.post('/api/inner-master/update')
def inner_master_update():
 try:
  x=request.get_json(force=True) or {};iid=x.get('id');name=str(x.get('name') or '').strip();note=str(x.get('note') or '').strip();uid=request_user_id(x)
  if iid is None:return jsonify(error='更新対象IDがありません。'),400
  if not name:return jsonify(error='内径種別を入力してください。'),400
  path=DBS['MASTER']['path']
  if not path.exists():raise FileNotFoundError(f'マスタ.accdbが見つかりません: {path}')
  with connect(path,False) as c:
   ensure_inner_master_table(c);cur=c.cursor();cur.execute('SELECT [内径ID],[内径種別] FROM [内径種別マスタ]');rows=cur.fetchall();target=normalize_inner_name(name)
   dup=next((r for r in rows if normalize_inner_name(r[1])==target and str(r[0])!=str(iid)),None)
   if dup:return jsonify(error=f'同名の内径種別が既に存在するため変更できません: {str(dup[1]).strip()}'),409
   cur.execute('UPDATE [内径種別マスタ] SET [内径種別]=?,[備考]=?,[有効]=-1,[更新者ID]=?,[更新日時]=Now() WHERE [内径ID]=?',[name,note,uid,iid]);c.commit()
  return jsonify(ok=True,id=iid,name=name,updated_by=uid,message='内径種別を更新しました。')
 except Exception as e:return jsonify(error=f'内径種別マスタ更新失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

@app.post('/api/inner-master/delete')
def inner_master_delete():
 try:
  x=request.get_json(force=True) or {};iid=x.get('id');uid=request_user_id(x)
  if iid is None:return jsonify(error='削除対象IDがありません。'),400
  path=DBS['MASTER']['path']
  if not path.exists():raise FileNotFoundError(f'マスタ.accdbが見つかりません: {path}')
  with connect(path,False) as c:
   ensure_inner_master_table(c);cur=c.cursor()
   # 物理削除ではなく無効化し、履歴を残す。無効化した更新者も記録する。
   cur.execute('UPDATE [内径種別マスタ] SET [有効]=0,[更新者ID]=?,[更新日時]=Now() WHERE [内径ID]=?',[uid,iid]);c.commit()
  return jsonify(ok=True,id=iid,updated_by=uid)
 except Exception as e:return jsonify(error=f'内径種別マスタ削除失敗: {e}'),500

# ========================================================================
# 機器マスタ（一般的なオートナンバー方式）
#  - 主キーは COUNTER（オートナンバー）で人手管理不要。
#  - 測定区分（板厚/板幅 等）を1列で保持し、用途別に読み分ける。
#  - 有効フラグ・表示順・登録/更新日時を持ち、論理削除で履歴を保持。
#  - 読み取り（measurement_context）もこのマスタから行う。
# ========================================================================
DEVICE_MASTER_TABLE='機器マスタ'
def ensure_device_master_table(c):
 names=tables(c);created=False
 if DEVICE_MASTER_TABLE not in names:
  # 他マスタと同じ方針。Access SQL互換のため制約と索引は別SQLで作成する。
  # 測定区分＋機器名の複合一意（同名でも区分違いは別レコードとして許容）。
  cur=c.cursor()
  cur.execute('CREATE TABLE [機器マスタ] ([機器ID] COUNTER, [機器名] TEXT(50), [測定区分] TEXT(20), [備考] TEXT(120), [表示順] INTEGER, [有効] YESNO, [登録者ID] TEXT(50), [更新者ID] TEXT(50), [登録日時] DATETIME, [更新日時] DATETIME)')
  cur.execute('CREATE UNIQUE INDEX [UX_機器マスタ_区分名] ON [機器マスタ] ([測定区分],[機器名])')
  c.commit();created=True
 ensure_audit_columns(c,DEVICE_MASTER_TABLE)
 return created

def normalize_device_name(value):
 import unicodedata
 return unicodedata.normalize('NFKC',str(value or '')).strip().upper()

def ensure_device_master(path):
 # 書き込み接続でテーブルの存在を保証する。measurement_context の前処理に使う。
 with connect(path,False) as c:
  created=ensure_device_master_table(c)
 return created

def device_master_rows(c):
 ensure_device_master_table(c)
 cur=c.cursor()
 # AccessのYESNO条件式差異を避け、全行取得後にPython側で有効判定する。
 cur.execute('SELECT [機器ID],[機器名],[測定区分],[表示順],[有効],[更新日時],[更新者ID] FROM [機器マスタ] ORDER BY [測定区分],[表示順],[機器名]')
 rows=[]
 for r in cur.fetchall():
  active=True if r[4] is None else bool(r[4])
  if active and str(r[1] or '').strip():rows.append(r)
 return rows

def read_device_names(c,kind):
 # 読み取り専用接続から、指定測定区分の有効な機器名を表示順で取得する。
 if DEVICE_MASTER_TABLE not in tables(c):return []
 cur=c.cursor();cur.execute('SELECT [機器名],[測定区分],[表示順],[有効] FROM [機器マスタ] ORDER BY [表示順],[機器名]')
 target=normalize_device_name(kind);out=[];seen=set()
 for r in cur.fetchall():
  active=True if r[3] is None else bool(r[3]);nm=str(r[0] or '').strip();kd=normalize_device_name(r[1])
  if not active or not nm:continue
  # 測定区分が一致、または区分が板厚/板幅を含む表記の揺れも許容する。
  if kd==target or (target and target in kd):
   if nm.casefold() not in seen:seen.add(nm.casefold());out.append(nm)
 return out

@app.get('/api/device-master')
def device_master_list():
 try:
  path=DBS['MASTER']['path']
  if not path.exists():raise FileNotFoundError(f'マスタ.accdbが見つかりません: {path}')
  with connect(path,False) as c:
   before=DEVICE_MASTER_TABLE in tables(c);ensure_device_master_table(c);rows=device_master_rows(c)
   items=[{'id':r[0],'name':str(r[1] or '').strip(),'kind':str(r[2] or '').strip(),'order':r[3] or 0,'active':True,'updated_at':r[5].isoformat() if r[5] else None,'updated_by':(str(r[6]).strip() if len(r)>6 and r[6] else '')} for r in rows]
  return jsonify(ok=True,items=items,table=DEVICE_MASTER_TABLE,created=not before,empty=len(items)==0,master_path=str(path))
 except Exception as e:return jsonify(error=f'機器マスタ読込失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

@app.post('/api/device-master')
def device_master_register():
 try:
  x=request.get_json(force=True) or {};name=str(x.get('name') or '').strip();kind=str(x.get('kind') or '').strip();note=str(x.get('note') or '').strip();uid=request_user_id(x)
  if not name:return jsonify(error='機器名を入力してください。'),400
  path=DBS['MASTER']['path']
  if not path.exists():raise FileNotFoundError(f'マスタ.accdbが見つかりません: {path}')
  with connect(path,False) as c:
   ensure_device_master_table(c);cur=c.cursor();cur.execute('SELECT [機器ID],[機器名],[測定区分] FROM [機器マスタ]');rows=cur.fetchall();tn=normalize_device_name(name);tk=normalize_device_name(kind);existing=next((r for r in rows if normalize_device_name(r[1])==tn and normalize_device_name(r[2])==tk),None)
   if existing:
    # 既存（区分＋機器名一致）は有効化のみ。備考は指定があるときだけ更新する（Accessの IIf/式差異を避ける）。
    if note:cur.execute('UPDATE [機器マスタ] SET [有効]=-1,[備考]=?,[更新者ID]=?,[更新日時]=Now() WHERE [機器ID]=?',[note,uid,existing[0]])
    else:cur.execute('UPDATE [機器マスタ] SET [有効]=-1,[更新者ID]=?,[更新日時]=Now() WHERE [機器ID]=?',[uid,existing[0]])
    registered=False;stored_name=str(existing[1]).strip()
   else:
    cur.execute('SELECT Max([表示順]) FROM [機器マスタ]');maximum=cur.fetchone()[0];order=int(maximum or 0)+10
    cur.execute('INSERT INTO [機器マスタ] ([機器名],[測定区分],[備考],[表示順],[有効],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,?,-1,?,?,Now(),Now())',[name,kind,note,order,uid,uid]);registered=True;stored_name=name
   c.commit()
  return jsonify(ok=True,name=stored_name,kind=kind,registered=registered,updated_by=uid,message=('機器マスタへ新規登録しました。' if registered else '機器マスタの登録済み機器を有効化しました。'))
 except Exception as e:return jsonify(error=f'機器マスタ登録失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

@app.post('/api/device-master/update')
def device_master_update():
 try:
  x=request.get_json(force=True) or {};did=x.get('id');name=str(x.get('name') or '').strip();kind=str(x.get('kind') or '').strip();note=str(x.get('note') or '').strip();uid=request_user_id(x)
  if did is None:return jsonify(error='更新対象IDがありません。'),400
  if not name:return jsonify(error='機器名を入力してください。'),400
  path=DBS['MASTER']['path']
  if not path.exists():raise FileNotFoundError(f'マスタ.accdbが見つかりません: {path}')
  with connect(path,False) as c:
   ensure_device_master_table(c);cur=c.cursor();cur.execute('SELECT [機器ID],[機器名],[測定区分] FROM [機器マスタ]');rows=cur.fetchall();tn=normalize_device_name(name);tk=normalize_device_name(kind)
   dup=next((r for r in rows if normalize_device_name(r[1])==tn and normalize_device_name(r[2])==tk and str(r[0])!=str(did)),None)
   if dup:return jsonify(error=f'同じ測定区分・機器名が既に存在するため変更できません: {str(dup[1]).strip()}'),409
   cur.execute('UPDATE [機器マスタ] SET [機器名]=?,[測定区分]=?,[備考]=?,[有効]=-1,[更新者ID]=?,[更新日時]=Now() WHERE [機器ID]=?',[name,kind,note,uid,did]);c.commit()
  return jsonify(ok=True,id=did,name=name,kind=kind,updated_by=uid,message='機器を更新しました。')
 except Exception as e:return jsonify(error=f'機器マスタ更新失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

@app.post('/api/device-master/delete')
def device_master_delete():
 try:
  x=request.get_json(force=True) or {};did=x.get('id');uid=request_user_id(x)
  if did is None:return jsonify(error='削除対象IDがありません。'),400
  path=DBS['MASTER']['path']
  if not path.exists():raise FileNotFoundError(f'マスタ.accdbが見つかりません: {path}')
  with connect(path,False) as c:
   ensure_device_master_table(c);cur=c.cursor()
   # 物理削除ではなく無効化し、履歴を残す。無効化した更新者も記録する。
   cur.execute('UPDATE [機器マスタ] SET [有効]=0,[更新者ID]=?,[更新日時]=Now() WHERE [機器ID]=?',[uid,did]);c.commit()
  return jsonify(ok=True,id=did,updated_by=uid)
 except Exception as e:return jsonify(error=f'機器マスタ削除失敗: {e}'),500

FILTER_PRESET_TABLE='フィルタプリセットマスタ'
def ensure_filter_preset_table(c):
 names=tables(c);created=False
 if FILTER_PRESET_TABLE not in names:
  # 設備マスタと同様にAccess SQL互換を優先。条件はJSONとしてLONGCHARへ、使用回数は集計用に保持する。
  cur=c.cursor()
  cur.execute('CREATE TABLE [フィルタプリセットマスタ] ([プリセットID] COUNTER, [名称] TEXT(120), [対象DB] TEXT(40), [対象テーブル] TEXT(120), [条件JSON] LONGCHAR, [使用回数] INTEGER, [最終使用日時] DATETIME, [表示順] INTEGER, [有効] YESNO, [登録者ID] TEXT(50), [更新者ID] TEXT(50), [登録日時] DATETIME, [更新日時] DATETIME)')
  c.commit();created=True
 ensure_audit_columns(c,FILTER_PRESET_TABLE)
 return created

def filter_preset_rows(c):
 ensure_filter_preset_table(c)
 cur=c.cursor()
 # AccessのYESNO条件式差異を避け、全行取得後にPython側で有効判定する。使用回数の多い順で返す。
 cur.execute('SELECT [プリセットID],[名称],[対象DB],[対象テーブル],[条件JSON],[使用回数],[最終使用日時],[有効],[更新日時],[更新者ID] FROM [フィルタプリセットマスタ] ORDER BY [使用回数] DESC,[表示順],[名称]')
 rows=[]
 for r in cur.fetchall():
  active=True if r[7] is None else bool(r[7])
  if active and str(r[1] or '').strip():rows.append(r)
 return rows

@app.get('/api/filter-presets')
def filter_preset_list():
 try:
  db_key=str(request.args.get('db') or '').strip();table=str(request.args.get('table') or '').strip()
  path=DBS['MASTER']['path']
  if not path.exists():raise FileNotFoundError(f'マスタ.accdbが見つかりません: {path}')
  with connect(path,False) as c:
   before=FILTER_PRESET_TABLE in tables(c);rows=filter_preset_rows(c)
   items=[]
   for r in rows:
    try:filters=json.loads(r[4] or '[]')
    except Exception:filters=[]
    if not isinstance(filters,list):filters=[]
    items.append({'id':r[0],'name':str(r[1] or '').strip(),'db':str(r[2] or '').strip(),'table':str(r[3] or '').strip(),'filters':filters,'uses':int(r[5] or 0),'last_used':r[6].isoformat() if r[6] else None,'updated_at':r[8].isoformat() if r[8] else None,'updated_by':(str(r[9]).strip() if len(r)>9 and r[9] else '')})
  if db_key:items=[x for x in items if not x['db'] or x['db']==db_key]
  if table:items=[x for x in items if not x['table'] or x['table']==table]
  return jsonify(ok=True,items=items,table=FILTER_PRESET_TABLE,created=not before,master_path=str(path))
 except Exception as e:return jsonify(error=f'フィルタプリセット読込失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

@app.post('/api/filter-presets')
def filter_preset_register():
 try:
  x=request.get_json(force=True) or {};name=str(x.get('name') or '').strip();uid=request_user_id(x)
  if not name:return jsonify(error='フィルタ名を入力してください。'),400
  filters=x.get('filters') or []
  if not isinstance(filters,list) or not filters:return jsonify(error='保存する条件がありません。'),400
  db_key=str(x.get('db') or '').strip();table=str(x.get('table') or '').strip();payload=json.dumps(filters,ensure_ascii=False)
  path=DBS['MASTER']['path']
  if not path.exists():raise FileNotFoundError(f'マスタ.accdbが見つかりません: {path}')
  with connect(path,False) as c:
   ensure_filter_preset_table(c);cur=c.cursor()
   cur.execute('SELECT [プリセットID],[名称],[対象DB],[対象テーブル] FROM [フィルタプリセットマスタ]');rows=cur.fetchall()
   target=normalize_equipment_name(name)
   existing=next((r for r in rows if normalize_equipment_name(r[1])==target and str(r[2] or '')==db_key and str(r[3] or '')==table),None)
   if existing:
    cur.execute('UPDATE [フィルタプリセットマスタ] SET [条件JSON]=?,[有効]=-1,[更新者ID]=?,[更新日時]=Now() WHERE [プリセットID]=?',[payload,uid,existing[0]]);registered=False;preset_id=existing[0]
   else:
    cur.execute('SELECT Max([表示順]) FROM [フィルタプリセットマスタ]');maximum=cur.fetchone()[0];order=int(maximum or 0)+10
    cur.execute('INSERT INTO [フィルタプリセットマスタ] ([名称],[対象DB],[対象テーブル],[条件JSON],[使用回数],[表示順],[有効],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,?,0,?,-1,?,?,Now(),Now())',[name,db_key,table,payload,order,uid,uid]);registered=True
    cur.execute('SELECT Max([プリセットID]) FROM [フィルタプリセットマスタ]');preset_id=cur.fetchone()[0]
   c.commit()
  return jsonify(ok=True,name=name,id=preset_id,registered=registered,updated_by=uid,message=('フィルタマスタへ新規登録しました。' if registered else '登録済みフィルタを更新しました。'))
 except Exception as e:return jsonify(error=f'フィルタプリセット登録失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

@app.post('/api/filter-presets/use')
def filter_preset_use():
 # サジェスト順位（よく使う順）を精緻化するため、適用時に使用回数を加算する。
 try:
  x=request.get_json(force=True) or {};pid=x.get('id');uid=request_user_id(x)
  if pid is None:return jsonify(ok=True,skipped=True)
  path=DBS['MASTER']['path']
  if not path.exists():return jsonify(ok=True,skipped=True)
  with connect(path,False) as c:
   ensure_filter_preset_table(c);cur=c.cursor()
   cur.execute('UPDATE [フィルタプリセットマスタ] SET [使用回数]=Nz([使用回数],0)+1,[最終使用日時]=Now(),[更新者ID]=? WHERE [プリセットID]=?',[uid,pid]);c.commit()
  return jsonify(ok=True,id=pid,updated_by=uid)
 except Exception as e:return jsonify(error=f'使用回数更新失敗: {e}'),500

@app.post('/api/filter-presets/delete')
def filter_preset_delete():
 try:
  x=request.get_json(force=True) or {};pid=x.get('id');uid=request_user_id(x)
  if pid is None:return jsonify(error='削除対象IDがありません。'),400
  path=DBS['MASTER']['path']
  if not path.exists():raise FileNotFoundError(f'マスタ.accdbが見つかりません: {path}')
  with connect(path,False) as c:
   ensure_filter_preset_table(c);cur=c.cursor()
   # 物理削除ではなく無効化し、履歴を残す。無効化した更新者も記録する。
   cur.execute('UPDATE [フィルタプリセットマスタ] SET [有効]=0,[更新者ID]=?,[更新日時]=Now() WHERE [プリセットID]=?',[uid,pid]);c.commit()
  return jsonify(ok=True,id=pid,updated_by=uid)
 except Exception as e:return jsonify(error=f'フィルタプリセット削除失敗: {e}'),500

# ========================================================================
# 表示マスタ（列表示設定）
#  - 対象DB（仕掛一覧=SIKALOTNOW、品質データ=SIKALOTDEF等、DBS参照）ごとに、
#    どの列を一覧から非表示にするかを管理する。
#  - 行の存在＝非表示。行が無い列は既定で表示（互換ポリシー、他マスタと同じ考え方）。
#    オペレータ設備マスタと同じ「完全同期」方式で保存する。
# ========================================================================
COLUMN_DISPLAY_TABLE='表示マスタ'
def ensure_column_display_table(c):
 names=tables(c);created=False
 if COLUMN_DISPLAY_TABLE not in names:
  cur=c.cursor()
  cur.execute('CREATE TABLE [表示マスタ] ([ID] COUNTER, [対象] TEXT(20), [列名] TEXT(60), [登録者ID] TEXT(50), [更新者ID] TEXT(50), [登録日時] DATETIME, [更新日時] DATETIME)')
  cur.execute('CREATE UNIQUE INDEX [UX_表示マスタ] ON [表示マスタ] ([対象],[列名])')
  c.commit();created=True
 ensure_audit_columns(c,COLUMN_DISPLAY_TABLE)
 return created

def hidden_columns_for(c,dbkey):
 # 対象=dbkey の非表示列名の集合を返す。テーブル未作成時は空集合。
 if COLUMN_DISPLAY_TABLE not in tables(c):return set()
 cur=c.cursor();cur.execute('SELECT [列名] FROM [表示マスタ] WHERE [対象]=?',[dbkey])
 return {str(r[0] or '').strip() for r in cur.fetchall() if str(r[0] or '').strip()}

def hidden_columns_for_db(dbkey):
 # api_table() から使う簡易ヘルパー。マスタ.accdbが未整備/未接続でも
 # 一覧表示自体は継続できるよう、失敗時は空集合（＝全列表示）を返す。
 try:
  path=DBS['MASTER']['path']
  if not path.exists():return set()
  with connect(path,True) as c:
   return hidden_columns_for(c,dbkey)
 except Exception:
  return set()

def set_hidden_columns(c,dbkey,names,uid):
 # 指定対象DBの非表示列を names の内容に完全同期する（増分の追加・削除）。
 ensure_column_display_table(c)
 cur=c.cursor()
 wanted={str(n).strip() for n in (names or []) if str(n or '').strip()}
 cur.execute('SELECT [ID],[列名] FROM [表示マスタ] WHERE [対象]=?',[dbkey])
 existing={str(r[1] or '').strip():r[0] for r in cur.fetchall()}
 for nm,rid in existing.items():
  if nm not in wanted:cur.execute('DELETE FROM [表示マスタ] WHERE [ID]=?',[rid])
 for nm in wanted:
  if nm not in existing:
   cur.execute('INSERT INTO [表示マスタ] ([対象],[列名],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,?,Now(),Now())',[dbkey,nm,uid,uid])
 c.commit()

@app.get('/api/column-display-master')
def column_display_master_list():
 try:
  dbkey=str(request.args.get('db') or '').strip()
  if not dbkey:return jsonify(error='対象DBを指定してください。'),400
  cf=cfg(dbkey)
  with connect(cf['path'],cf['role']=='readonly') as c:
   a=tables(c);table=cf['preferred'] if cf['preferred'] in a else (a[0] if a else None)
   real_columns=cols(c,table) if table else []
  master=DBS['MASTER']['path'];hidden=set()
  if master.exists():
   with connect(master,True) as mc:hidden=hidden_columns_for(mc,dbkey)
  return jsonify(ok=True,db=dbkey,label=cf['label'],table=table,columns=real_columns,hidden=sorted(hidden & set(real_columns)))
 except Exception as e:return jsonify(error=f'表示マスタ読込失敗: {e}'),500

@app.post('/api/column-display-master')
def column_display_master_update():
 try:
  x=request.get_json(force=True) or {};dbkey=str(x.get('db') or '').strip();hidden=x.get('hidden');uid=request_user_id(x)
  if not dbkey:return jsonify(error='対象DBを指定してください。'),400
  if dbkey not in DBS:return jsonify(error='対象DBが不正です。'),400
  if not isinstance(hidden,list):return jsonify(error='非表示列の指定が不正です。'),400
  path=DBS['MASTER']['path']
  if not path.exists():raise FileNotFoundError(f'マスタ.accdbが見つかりません: {path}')
  with connect(path,False) as c:
   set_hidden_columns(c,dbkey,hidden,uid)
  return jsonify(ok=True,db=dbkey,hidden=hidden,updated_by=uid,message='表示設定を保存しました。')
 except Exception as e:return jsonify(error=f'表示マスタ更新失敗: {e}'),500

@app.after_request
def no_cache(response):
 response.headers['Cache-Control']='no-store, no-cache, must-revalidate, max-age=0'
 response.headers['Pragma']='no-cache'
 response.headers['Expires']='0'
 return response

@app.get('/')
def home():
 asset_files=list((BASE/'static'/'js').glob('*.js'))+[BASE/'static'/'app.css']
 token=str(max(f.stat().st_mtime_ns for f in asset_files))
 return render_template('index.html', build='current', asset_token=token)
@app.get('/api/build')
def build(): return jsonify(build='current', version=APP_VERSION, feature='measurement-workflow-current', port=5029, **GIT_VERSION)
@app.get('/api/whoami')
def whoami():
 # この端末(各測定端末)で実行しているアプリのOSログインユーザー名を返す。
 # マスタ更新記録(登録者ID)に、手入力させず自動で使うためのもの。
 try:username=os.getlogin()
 except Exception:username=os.environ.get('USERNAME') or os.environ.get('USER') or os.environ.get('LOGNAME') or ''
 return jsonify(username=str(username or '').strip())
@app.get('/api/changelog')
def changelog(): return jsonify(version=APP_VERSION, entries=CHANGELOG)
@app.get('/api/catalog')
def catalog(): return jsonify(databases=[{"key":k,"label":v['label'],"file_name":v['path'].name,"role":v['role']} for k,v in DBS.items()])
@app.get('/api/tables')
def api_tables():
 try:
  k=request.args['db'];cf=cfg(k)
  with connect(cf['path'],cf['role']=='readonly') as c: a=tables(c)
  if cf['preferred'] in a:a=[cf['preferred']]+[x for x in a if x!=cf['preferred']]
  return jsonify(tables=a)
 except Exception as e:return jsonify(error=str(e)),500
@app.get('/api/table')
def api_table():
 try:
  k=request.args['db'];t=request.args['table'];page=max(1,int(request.args.get('page',1)));size=min(500,max(50,int(request.args.get('page_size',200))));q=request.args.get('search','').strip();cf=cfg(k)
  filter_payload=request.args.get('filters','').strip()
  def safe_filters(text,columns):
   if not text:return []
   try:items=json.loads(text)
   except Exception:return []
   if not isinstance(items,list):return []
   allowed_ops={'contains','not_contains','eq','neq','starts','ends','gt','gte','lt','lte','empty','not_empty'}
   out=[]
   for item in items[:20]:
    if not isinstance(item,dict):continue
    col=str(item.get('column') or '').strip();op=str(item.get('op') or 'contains').strip();value=str(item.get('value') or '').strip()
    if col in columns and op in allowed_ops:out.append({'column':col,'op':op,'value':value})
   return out
  def build_filter_where(filters):
   parts=[];params=[]
   for f in filters:
    col=qi(f['column']);op=f['op'];value=f['value']
    if op=='contains':parts.append(f'CStr({col}) LIKE ?');params.append(f'%{value}%')
    elif op=='not_contains':parts.append(f'(CStr({col}) NOT LIKE ? OR {col} IS NULL)');params.append(f'%{value}%')
    elif op=='eq':parts.append(f'CStr({col})=?');params.append(value)
    elif op=='neq':parts.append(f'(CStr({col})<>? OR {col} IS NULL)');params.append(value)
    elif op=='starts':parts.append(f'CStr({col}) LIKE ?');params.append(f'{value}%')
    elif op=='ends':parts.append(f'CStr({col}) LIKE ?');params.append(f'%{value}')
    elif op=='empty':parts.append(f'({col} IS NULL OR CStr({col})=\'\')')
    elif op=='not_empty':parts.append(f'({col} IS NOT NULL AND CStr({col})<>\'\')')
    elif op in ('gt','gte','lt','lte'):
     sign={"gt":'>',"gte":'>=',"lt":'<',"lte":'<='}[op]
     parts.append(f'Val(CStr({col})) {sign} ?');params.append(value)
   return parts,params
  with connect(cf['path'],cf['role']=='readonly') as c:
   cs=cols(c,t);where_parts=[];params=[]
   if q:
    where_parts.append('('+' OR '.join(f'CStr({qi(x)}) LIKE ?' for x in cs)+')');params += [f'%{q}%']*len(cs)
   filters=safe_filters(filter_payload,cs);fp,filter_params=build_filter_where(filters);where_parts += fp;params += filter_params
   where=(' WHERE '+' AND '.join(where_parts)) if where_parts else ''
   sort_col=request.args.get('sort','').strip();sort_dir='DESC' if request.args.get('sort_dir','').strip().lower()=='desc' else 'ASC'
   order=f' ORDER BY {qi(sort_col)} {sort_dir}' if sort_col in cs else ''
   cur=c.cursor();cur.execute(f'SELECT COUNT(*) FROM {qi(t)}'+where,params);count=int(cur.fetchone()[0]);top=page*size;cur.execute(f'SELECT TOP {top} * FROM {qi(t)}'+where+order,params);rows=cur.fetchmany(top);start=(page-1)*size;rows=rows[start:start+size]
  # 表示マスタで非表示指定された列は、検索/絞込/並替の対象(cs)には残しつつ、
  # 返却するcolumns/rowsからのみ除外する(生の行タプルはcs全体の順序と対応するため、
  # zip自体はcs全体で行い、その後に非表示列をdictから取り除く)。
  hidden=hidden_columns_for_db(k)
  row_dicts=[dict(zip(cs,r)) for r in rows]
  visible_cs=[x for x in cs if x not in hidden] if hidden else cs
  if hidden:row_dicts=[{col:v for col,v in d.items() if col not in hidden} for d in row_dicts]
  return jsonify(columns=visible_cs,rows=row_dicts,count=count,filters_applied=len(filters))
 except Exception as e:return jsonify(error=str(e)),500

def first_existing(columns, names):
 for name in names:
  if name in columns:return name
 return None

@app.get('/api/measurement/context')
def measurement_context():
 try:
  lot=request.args.get('lot','').strip();equipment=request.args.get('equipment','').strip()
  result={'quality':[],'operators':[],'inspectors':[],'packers':[],'thickness_gauges':[],'width_gauges':[],'inner_diameters':[],'spools':[],'diagnostics':{'master_path':str(DBS['MASTER']['path']),'master_exists':DBS['MASTER']['path'].exists(),'tables':[],'matches':{}}}
  def norm(v):return str(v or '').strip()
  def matching_table(ts,aliases):
   for a in aliases:
    if a in ts:return a
   for t in ts:
    if any(a.lower() in t.lower() for a in aliases):return t
   return None
  def matching_col(cs,aliases):
   for a in aliases:
    if a in cs:return a
   for c in cs:
    if any(a.lower() in c.lower() for a in aliases):return c
   return None
  if lot and DBS['SIKALOTDEF']['path'].exists():
   with connect(DBS['SIKALOTDEF']['path'],True) as c:
    ts=tables(c);t=matching_table(ts,['仕掛','品質情報','品質','保留'])
    if t:
     cs=cols(c,t);lot_col=matching_col(cs,['ロット番号','ﾛｯﾄ番号','ロット№','LTNO'])
     if lot_col:
      cur=c.cursor();cur.execute(f'SELECT TOP 50 * FROM {qi(t)} WHERE CStr({qi(lot_col)})=?',[lot]);rows=cur.fetchall()
      for row in rows:
       d=dict(zip(cs,row));result['quality'].append({k:norm(d.get(matching_col(cs,[k]) or k)) for k in ['発生設備','登録日時','異常内容','コメント','最終処置','保留設定日','保留解除']})
  master=DBS['MASTER']['path']
  if master.exists():
   # オペレータマスタの存在を保証してから読み取る。
   try:
    created=ensure_operator_master(master);result['diagnostics']['operator_master']={'created':created}
   except Exception as _e:result['diagnostics']['operator_master_error']=str(_e)
   # オペレータ設備マスタ（オペレータ×設備の割当）の存在を保証してから読み取る。
   try:
    oe_created=ensure_operator_equipment(master);result['diagnostics']['operator_equipment_master']={'created':oe_created}
   except Exception as _e:result['diagnostics']['operator_equipment_master_error']=str(_e)
   # スプール種別マスタの存在を保証してから読み取る。
   try:
    s_created=ensure_spool_master(master);result['diagnostics']['spool_master']={'created':s_created}
   except Exception as _e:result['diagnostics']['spool_master_error']=str(_e)
   # 内径種別マスタの存在を保証してから読み取る。
   try:
    i_created=ensure_inner_master(master);result['diagnostics']['inner_master']={'created':i_created}
   except Exception as _e:result['diagnostics']['inner_master_error']=str(_e)
   # 機器マスタの存在を保証してから読み取る。
   try:
    d_created=ensure_device_master(master);result['diagnostics']['device_master']={'created':d_created}
   except Exception as _e:result['diagnostics']['device_master_error']=str(_e)
   with connect(master,True) as c:
    ts=tables(c);result['diagnostics']['tables']=ts
    def read_values(table_aliases,col_aliases,extra=None):
     table=matching_table(ts,table_aliases)
     if not table:return []
     cs=cols(c,table);column=matching_col(cs,col_aliases)
     result['diagnostics']['matches']['/'.join(table_aliases)]={'table':table,'column':column,'columns':cs}
     if not column:return []
     sql=f'SELECT DISTINCT {qi(column)} FROM {qi(table)}';params=[];where=[]
     # VBAは設備=FaciNameだが、Webでは仕掛の設備文字列が複合値の場合があるため、完全一致で0件なら全件へフォールバック
     if equipment:
      equip_col=matching_col(cs,['設備','設備名','対象設備'])
      if equip_col:where.append(f'(CStr({qi(equip_col)})=? OR CStr({qi(equip_col)}) LIKE ?)');params += [equipment,f'%{equipment}%']
     if extra:
      for aliases,value in extra:
       col=matching_col(cs,aliases)
       if col:where.append(f'CStr({qi(col)})=?');params.append(value)
     cur=c.cursor()
     query=sql+(' WHERE '+' AND '.join(where) if where else '')
     cur.execute(query,params);values=[norm(r[0]) for r in cur.fetchall() if norm(r[0])]
     if not values and where:cur.execute(sql);values=[norm(r[0]) for r in cur.fetchall() if norm(r[0])]
     return sorted(set(values),key=str.casefold)
    # 読み取りはオペレータマスタ（有効・表示順）から行う。
    # オペレータ欄のみ、対象設備（equipment）で作業可能設備によるフィルタをかける。
    # 割当が1件もないオペレータは常に表示対象（互換ポリシー）。検査員・梱包員は従来通り全件。
    people=read_operator_names(c)
    people_for_equipment=read_operator_names(c,equipment=equipment) if equipment else people
    result['diagnostics']['matches']['オペレータマスタ']={'table':OPERATOR_MASTER_TABLE,'column':'氏名','count':len(people),'filtered_by_equipment':equipment or '','filtered_count':len(people_for_equipment)}
    result['operators']=people_for_equipment;result['inspectors']=people;result['packers']=people
    # 読み取りは機器マスタ（測定区分・有効・表示順）から行う。
    thickness_gauges=read_device_names(c,'板厚');width_gauges=read_device_names(c,'板幅')
    result['diagnostics']['matches']['機器マスタ']={'table':DEVICE_MASTER_TABLE,'column':'機器名','板厚':len(thickness_gauges),'板幅':len(width_gauges)}
    result['thickness_gauges']=thickness_gauges;result['width_gauges']=width_gauges
    # 読み取りは内径種別マスタ（有効・表示順）から行う。
    inners=read_inner_names(c)
    result['diagnostics']['matches']['内径種別マスタ']={'table':INNER_MASTER_TABLE,'column':'内径種別','count':len(inners)}
    result['inner_diameters']=inners
    # 読み取りはスプール種別マスタ（有効・表示順）から行う。
    spools=read_spool_names(c)
    result['diagnostics']['matches']['スプール種別マスタ']={'table':SPOOL_MASTER_TABLE,'column':'種別名','count':len(spools)}
    result['spools']=spools
  return jsonify(result)
 except Exception as e:return jsonify(error=str(e)),500

@app.get('/api/measurement/master-diagnostics')
def master_diagnostics():
 try:
  p=DBS['MASTER']['path'];out={'path':str(p),'exists':p.exists(),'size':p.stat().st_size if p.exists() else 0,'tables':{}}
  if p.exists():
   with connect(p,True) as c:
    for t in tables(c):out['tables'][t]=cols(c,t)
  return jsonify(out)
 except Exception as e:return jsonify(error=str(e)),500

@app.post('/api/measurement/backup')
def backup():
 try:
  x=request.get_json(force=True);required=['id','lotNo','payload'];missing=[k for k in required if not x.get(k)]
  if missing:return jsonify(error='必須項目不足: '+','.join(missing)),400
  with connect(MEAS_DB) as c:
   ensure_backup_table(c);cur=c.cursor();cur.execute('DELETE FROM [Web測定バックアップ] WHERE [記録ID]=?',[x['id']]);cur.execute('INSERT INTO [Web測定バックアップ] ([記録ID],[設備],[ロット番号],[検査番号],[鋳造番号],[状態],[更新日時],[圧縮形式],[ペイロード]) VALUES (?,?,?,?,?,?,Now(),?,?)',[x['id'],x.get('equipment',''),x.get('lotNo',''),x.get('inspectionNo',''),x.get('castingNo',''),x.get('status','編集中'),x.get('codec','delimiter-v1'),x['payload']]);c.commit()
  return jsonify(ok=True,direction='IndexedDB -> 測定データ.accdb')
 except Exception as e:return jsonify(error=str(e)),500

@app.get('/api/measurement/backup/list')
def backup_list():
 # PC引継ぎ等でIndexedDBが空の端末へ、測定データ.accdb(Web測定バックアップ)から
 # インポートするための読み取り専用API。書き込みはせず、行をそのまま返す。
 # 実際のIndexedDBへの反映(JSON解凍・idbPut)はブラウザ側で行う。
 try:
  if not MEAS_DB.exists():raise FileNotFoundError(f'測定データ.accdbが見つかりません: {MEAS_DB}')
  with connect(MEAS_DB,True) as c:
   if 'Web測定バックアップ' not in tables(c):
    return jsonify(ok=True,items=[],count=0,table_exists=False,meas_path=str(MEAS_DB))
   cur=c.cursor()
   cur.execute('SELECT [記録ID],[設備],[ロット番号],[検査番号],[鋳造番号],[状態],[更新日時],[圧縮形式],[ペイロード] FROM [Web測定バックアップ] ORDER BY [更新日時] DESC')
   rows=cur.fetchall()
  items=[{'id':str(r[0] or ''),'equipment':str(r[1] or ''),'lotNo':str(r[2] or ''),'inspectionNo':str(r[3] or ''),'castingNo':str(r[4] or ''),'status':str(r[5] or ''),'updated_at':r[6].isoformat() if r[6] else None,'codec':str(r[7] or ''),'payload':str(r[8] or '')} for r in rows]
  return jsonify(ok=True,items=items,count=len(items),table_exists=True,meas_path=str(MEAS_DB))
 except Exception as e:return jsonify(error=f'測定データ読込失敗: {e}',meas_path=str(MEAS_DB)),500

# ========================================================================
# 品質データ分析 API
# - 任意カラムの件数集計
# - 文字列化された重量列の数値変換合計
# - 対象データのリスト返却
# ========================================================================
def _quality_to_text(value):
 if value is None:return ''
 try:
  if hasattr(value,'isoformat'):return value.isoformat(sep=' ')
 except TypeError:
  pass
 return str(value)

def _quality_parse_number(value):
 import re
 s=_quality_to_text(value).strip()
 if not s:return None
 s=s.translate(str.maketrans('０１２３４５６７８９．，－＋','0123456789.,-+'))
 s=s.replace(',','')
 m=re.search(r'[-+]?\d+(?:\.\d+)?',s)
 if not m:return None
 try:return float(m.group(0))
 except Exception:return None

def _quality_parse_datetime(value):
 from datetime import datetime
 s=_quality_to_text(value).strip()
 if not s:return None
 s=s.replace('T',' ').replace('/','-')
 s=s.translate(str.maketrans('０１２３４５６７８９：－／','0123456789:-/'))
 formats=('%Y-%m-%d %H:%M:%S','%Y-%m-%d %H:%M','%Y-%m-%d','%Y%m%d%H%M%S','%Y%m%d')
 for fmt in formats:
  try:return datetime.strptime(s[:len(datetime.now().strftime(fmt))],fmt)
  except Exception:pass
 return None

@app.get('/api/quality/analysis')
def quality_analysis():
 try:
  table=request.args.get('table','').strip() or DBS['SIKALOTDEF']['preferred']
  group_col=request.args.get('group_col','').strip()
  value_col=request.args.get('value_col','').strip()
  stack_col=request.args.get('stack_col','').strip()
  metric=request.args.get('metric','count').strip()
  date_col=request.args.get('date_col','').strip()
  start=request.args.get('start','').strip()
  end=request.args.get('end','').strip()
  q=request.args.get('search','').strip().casefold()
  bucket=request.args.get('bucket','day').strip() or 'day'
  dimension=request.args.get('dimension','category').strip() or 'category'
  max_rows=min(30000,max(100,int(request.args.get('max_rows',10000))))
  cf=cfg('SIKALOTDEF')
  start_dt=_quality_parse_datetime(start) if start else None
  end_dt=_quality_parse_datetime(end) if end else None
  def bucket_label(dt):
   if not dt:return '日付不明'
   if bucket=='year':return dt.strftime('%Y')
   if bucket=='month':return dt.strftime('%Y-%m')
   return dt.strftime('%Y-%m-%d')
  with connect(cf['path'],True) as c:
   available=tables(c)
   if table not in available:
    table=cf['preferred'] if cf['preferred'] in available else (available[0] if available else '')
   if not table:return jsonify(error='品質データのテーブルがありません。'),404
   cs=cols(c,table)
   if group_col not in cs:group_col=first_existing(cs,['発生設備','異常内容','登録日時']) or (cs[0] if cs else '')
   if value_col not in cs:value_col=first_existing(cs,['廃棄重量','廃却重量','ｽｸﾗｯﾌﾟ重量','スクラップ重量']) or ''
   if stack_col not in cs:stack_col=''
   if date_col not in cs:date_col=first_existing(cs,['登録日時','発生日','発生日時','保留設定日']) or ''
   cur=c.cursor();cur.execute(f'SELECT TOP {max_rows} * FROM {qi(table)}')
   raw=[dict(zip(cs,row)) for row in cur.fetchall()]
  filtered=[]
  for row in raw:
   if q and q not in ' '.join(_quality_to_text(row.get(c)).casefold() for c in cs):continue
   if date_col and (start_dt or end_dt):
    dt=_quality_parse_datetime(row.get(date_col))
    if start_dt and (not dt or dt<start_dt):continue
    if end_dt and (not dt or dt>end_dt):continue
   filtered.append(row)
  metric_key='sum' if metric=='sum' else 'count'
  agg={}; stack_map={}; stack_totals={}; series={}
  for row in filtered:
   dt=_quality_parse_datetime(row.get(date_col)) if date_col else None
   main_key=bucket_label(dt) if dimension=='time' else (_quality_to_text(row.get(group_col)).strip() or '未設定')
   num=_quality_parse_number(row.get(value_col)) if value_col else None
   item=agg.setdefault(main_key,{'label':main_key,'count':0,'sum':0.0})
   item['count']+=1
   if num is not None:item['sum']+=num
   if date_col:
    tkey=bucket_label(dt)
    s=series.setdefault(tkey,{'label':tkey,'count':0,'sum':0.0})
    s['count']+=1
    if num is not None:s['sum']+=num
   if stack_col:
    s_key=_quality_to_text(row.get(stack_col)).strip() or '未設定'
    cell=stack_map.setdefault(main_key,{}).setdefault(s_key,{'count':0,'sum':0.0})
    cell['count']+=1
    if num is not None:cell['sum']+=num
    total=stack_totals.setdefault(s_key,{'label':s_key,'count':0,'sum':0.0})
    total['count']+=1
    if num is not None:total['sum']+=num
  items=list(agg.values())
  if dimension=='time':items=sorted(items,key=lambda x:x['label'])
  else:items=sorted(items,key=lambda x:x[metric_key],reverse=True)
  stack_keys=[]
  if stack_col:
   stack_keys=[x['label'] for x in sorted(stack_totals.values(),key=lambda x:x[metric_key],reverse=True)[:12]]
   for item in items:
    raw_stacks=stack_map.get(item['label'],{})
    stacks={}; other={'count':0,'sum':0.0}
    for key,val in raw_stacks.items():
     if key in stack_keys:stacks[key]=val
     else:
      other['count']+=val.get('count',0);other['sum']+=val.get('sum',0.0)
    if other['count'] or other['sum']:
     stacks['その他']=other
     if 'その他' not in stack_keys:stack_keys.append('その他')
    item['stacks']=stacks
  preferred=['登録日時','発生設備','異常内容','廃棄重量','コメント','最終処置','保留設定日','保留解除']
  list_cols=[c for c in preferred if c in cs]
  if not list_cols:list_cols=cs[:8]
  rows=[{c:_quality_to_text(row.get(c)) for c in list_cols} for row in filtered[:1500]]
  return jsonify(ok=True,table=table,columns=cs,group_col=group_col,value_col=value_col,stack_col=stack_col,date_col=date_col,metric=metric_key,total=len(filtered),items=items[:200],series=sorted(series.values(),key=lambda x:x['label'])[:200],stack_keys=stack_keys,list_columns=list_cols,rows=rows,source_rows=len(raw),max_rows=max_rows,bucket=bucket,dimension=dimension)
 except Exception as e:return jsonify(error=f'品質データ分析失敗: {str(e)}'),500

if __name__=='__main__': app.run(host='127.0.0.1',port=5029,debug=False)
