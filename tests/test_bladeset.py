"""test_bladeset.py: 刃組マスタと設備停止の連携機能（§9.377）

固定するのは6つ:
  1. **8枚の表が`TableDef`から作られ**、読み書きが往復する（部分更新で他の列が消えない）
  2. **ゴムリングは「同じ色は同じ外径」**——外径を直すとその色ぜんぶがそろい、
     色名から外径を**起こさない**（研磨で径が減っても呼び名は変わらない）
  3. **基準値は「既定はコード・上書きだけがDB」**——登録が無い設備でも値が出る
  4. **初期セットは足し算にならない**（2度押しても増えない）
  5. 設備停止マスタの`[連携機能]`が**保存され、知らない鍵は「なし」へ倒れる**
     ——そして**画面に綴りを書き写していない**（語彙はサーバーの1箇所）
  6. 刃は**既定で「一般」**が選ばれ、`刃選択マスタ`の条件に当たったときだけ
     「専用」になる（条件の無い行は当たらない＝既定が静かに崩れない）
  7. 刃セット（設備＋組）の**カテゴリ・使用状態**（§9.526）——登録が無い組は刃の`状態`から
     起こした初期値・送った項目だけ書く・語彙外は断る。フィンガーは**名称を持たず材質**
     （既定ベークライト・設備＋幅＋材質で1本）。刃選択の条件は4項目＋前の項目も読む

サーバーは要らない（1段目・§9.337）。
"""
import re
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.db_access import connect, cols, tables            # noqa: E402
from backend.repositories import bladeset_repo as bs           # noqa: E402
from backend.repositories import schedule_repo as sr           # noqa: E402

R = []


def rec(name, ok, detail=''):
    R.append((name, ok))
    print(('PASS: ' if ok else 'FAIL: ') + name + (f' -- {detail}' if detail else ''))


def fresh():
    return connect(Path(tempfile.mkdtemp()) / 'm.sqlite3', False, 'sqlite')


def _reject(fn):
    """断ることを確かめる。**断り文句が空でないこと**まで見る（§CLAUDE 4）。"""
    try:
        fn()
    except ValueError as e:
        return bool(str(e).strip())
    return False


EQ = 'テスト設備A'

# ---------------------------------------------------------------------------
# 1. 8枚の表
# ---------------------------------------------------------------------------
c = fresh()
made = bs.ensure_tables(c)
rec('まっさらなDBで11枚できる（§9.526で刃セットマスタを足した）', len(made) == 11, str(made))
have = set(tables(c))
rec('表の名前が定義どおり',
    {d.table for d in (bs.BLADE_DEF, bs.SPACER_DEF, bs.RING_DEF, bs.FINGER_DEF,
                       bs.STANDARD_DEF, bs.HISTORY_DEF, bs.DESIGN_DEF,
                       bs.BLADEPICK_DEF, bs.CARRIAGE_DEF)} <= have,
    str(sorted(have)))
# CREATE に全列が入っている（§9.324 R1。後から足す口に頼らない）
for d in (bs.BLADE_DEF, bs.SPACER_DEF, bs.RING_DEF, bs.FINGER_DEF, bs.STANDARD_DEF):
    got = set(cols(c, d.table, use_cache=False))
    rec(f'{d.table} は最初の1回から全列そろっている', set(d.all_names()) <= got,
        str(sorted(set(d.all_names()) - got)))
rec('2度目の`ensure`は何も作らない', bs.ensure_tables(c) == [])

# 往復（渡した鍵だけ書く・§9.212 ②）
bid, created = bs.blade_upsert(c, 'u', equipment=EQ, group='A',
                               thickness=10, current_dia=318.2, qty=70)
rec('刃を登録できる（名称は要らない・§9.529）', created and bid)
bs.blade_upsert(c, 'u', blade_id=bid, current_dia=317.9)
row = [x for x in bs.blade_rows(c, True, EQ) if x['id'] == bid][0]
rec('部分更新で他の列が消えない・呼び名はセット＋刃厚から作る',
    row['currentDia'] == 317.9 and row['name'] == 'A 10mm' and row['qty'] == 70 and row['group'] == 'A',
    str(row))
rec('設備は「すべての設備」を受け付けない（理由つきで断る）',
    _reject(lambda: bs.blade_upsert(c, 'u', equipment='*', group='A', thickness=5)))
rec('設備が空なら断る', _reject(lambda: bs.blade_upsert(c, 'u', equipment='', group='A', thickness=5)))
# §9.529: 鍵は設備＋セット（A〜Z）＋刃厚の3つ
rec('§9.529 同じ設備・同じセット・同じ刃厚の2行目は断る',
    _reject(lambda: bs.blade_upsert(c, 'u', equipment=EQ, group='A', thickness=10, current_dia=300)))
rec('§9.529 セット名は A〜Z の1字だけ（「あ」「AB」は断る）',
    _reject(lambda: bs.blade_upsert(c, 'u', equipment=EQ, group='あ', thickness=5))
    and _reject(lambda: bs.blade_upsert(c, 'u', equipment=EQ, group='AB', thickness=5)))
rec('§9.529 セット名が無い・刃厚が無いなら断る',
    _reject(lambda: bs.blade_upsert(c, 'u', equipment=EQ, thickness=5))
    and _reject(lambda: bs.blade_upsert(c, 'u', equipment=EQ, group='A')))
b2, _m = bs.blade_upsert(c, 'u', equipment=EQ, group='ａ', thickness=5, current_dia=318)
rec('§9.529 全角・小文字のセット名は A〜Z へ読む（ａ→A）・同じセットの別の刃厚は登録できる',
    [x for x in bs.blade_rows(c, True, EQ) if x['id'] == b2][0]['group'] == 'A')
rec('§9.529 直すときも別の行と同じ3つにはできない（5mm→10mm は断る）',
    _reject(lambda: bs.blade_upsert(c, 'u', blade_id=b2, thickness=10)))
bs.blade_delete(c, b2)
rec('スペーサーの寸法が空なら断る',
    _reject(lambda: bs.spacer_upsert(c, 'u', equipment=EQ, size=None)))
rec('ゴムリングの色名が空なら断る',
    _reject(lambda: bs.ring_upsert(c, 'u', equipment=EQ, width=10)))
rec('ゴムリングの幅が空なら断る',
    _reject(lambda: bs.ring_upsert(c, 'u', equipment=EQ, color='赤')))

# `enabledText`（呼び名）を返す——返さないとマスタ管理の編集窓が必ず「有効」で開く
rec('行は呼び名（enabledText）も返す', row.get('enabledText') == '有効', str(row.get('enabledText')))
bs.blade_upsert(c, 'u', blade_id=bid, enabled=False)
off = [x for x in bs.blade_rows(c, True, EQ) if x['id'] == bid][0]
rec('無効にすると呼び名も「無効」', off['enabledText'] == '無効' and off['enabled'] is False)
rec('無効の行は既定の一覧に出ない',
    all(x['id'] != bid for x in bs.blade_rows(c, False, EQ)))
bs.blade_upsert(c, 'u', blade_id=bid, enabled=True)

# ---------------------------------------------------------------------------
# 2. ゴムリングの「同じ色は同じ外径」
# ---------------------------------------------------------------------------
c2 = fresh()
for w in (50, 30, 20):
    bs.ring_upsert(c2, 'u', equipment=EQ, color='赤', od=322, bore=241, width=w, qty=5)
reds = [x for x in bs.ring_rows(c2, True, EQ) if x['color'] == '赤']
rec('同じ色の幅ちがいを3本登録できる', len(reds) == 3, str(len(reds)))
rec('2本目からは外径を打たなくても引き継ぐ', {x['od'] for x in reds} == {322.0},
    str(sorted({x['od'] for x in reds})))
# 研磨: どれか1行の外径を直すと、その色ぜんぶがそろう
_id, _created, aligned = bs.ring_upsert(c2, 'u', ring_id=reds[0]['id'], od=318)
reds2 = [x for x in bs.ring_rows(c2, True, EQ) if x['color'] == '赤']
rec('外径を直すと同じ色がそろう（研磨は色の単位）',
    {x['od'] for x in reds2} == {318.0} and aligned == 2,
    f'ods={sorted({x["od"] for x in reds2})} aligned={aligned}')
rec('そろえた件数を返す（黙って他の行を書き換えない）', aligned == 2, str(aligned))
rec('外径を直しても色名は変わらない（色は現物の目印）',
    len(reds2) == 3 and all(x['color'] == '赤' for x in reds2),
    str(sorted({x['color'] for x in bs.ring_rows(c2, True, EQ)})))
# 色の周期は「まだ名前の無い径」のための言い換え
rec('周期は外径から色を引ける', bs.ring_color_of(322)['color'] == '赤'
    and bs.ring_color_of(318)['color'] == '茶', str(bs.ring_color_of(318)))
rec('周期は10mmで一周する', bs.ring_color_of(312)['color'] == bs.ring_color_of(322)['color'])

# ---------------------------------------------------------------------------
# 3. 基準値は「既定はコード・上書きだけがDB」
# ---------------------------------------------------------------------------
c3 = fresh()
std = bs.standard_for(c3, EQ)
rec('登録が無くても基準値は出る', std['values']['arborLen'] == bs.STANDARD_DEFAULTS['arborLen']
    and std['stored'] is False, str(std['stored']))
rec('既定値を黙ってDBへ書かない', not bs.standard_rows(c3, True, EQ))
bs.standard_upsert(c3, 'u', equipment=EQ, values={'arborLen': 1600.0, 'canNakanuki': False})
std2 = bs.standard_for(c3, EQ)
rec('上書きした値が効く', std2['values']['arborLen'] == 1600.0 and std2['stored'] is True)
rec('渡していない項目は既定のまま',
    std2['values']['ringBore'] == bs.STANDARD_DEFAULTS['ringBore'])
rec('真偽の上書きが効く（「できない」を保存できる）',
    std2['values']['canNakanuki'] is False, str(std2['values']['canNakanuki']))
srow = bs.standard_rows(c3, True, EQ)[0]
rec('真偽も呼び名で返す', srow.get('canNakanukiText') == 'できない', str(srow.get('canNakanukiText')))
bs.standard_upsert(c3, 'u', equipment=EQ, values={'ringBore': 242.0})
rec('あとから別の項目を足しても、前の上書きが消えない',
    bs.standard_for(c3, EQ)['values']['arborLen'] == 1600.0)
rec('同じ設備の2行目を作らない', len(bs.standard_rows(c3, True, EQ)) == 1,
    str(len(bs.standard_rows(c3, True, EQ))))
# §9.470: 基準面の切り替え（§9.461 の`datumSide`）は外した。既定値にも無く、送っても保存しない。
std = bs.standard_for(c3, EQ)
rec('基準面の切り替えの鍵は無い（§9.470・DSに固定）', 'datumSide' not in std['values'], str(sorted(std['values'])[:5]))
bs.standard_upsert(c3, 'u', equipment=EQ, values={'datumSide': 'OS'})
rec('基準面を送っても保存しない（§9.470）', 'datumSide' not in bs.standard_for(c3, EQ)['values'])
# §9.472: OS・DS の呼び方は刃組基準値が持つ（既定は OS／DS）。§9.463 の札の呼び方（左／右）は外した。
rec('OS・DS の呼び方の既定は OS／DS（札の呼び方の鍵は無い）',
    std['values'].get('sideNameOS') == 'OS' and std['values'].get('sideNameDS') == 'DS'
    and 'viewLabelLeft' not in std['values'] and 'viewLabelRight' not in std['values'],
    str({k: std['values'].get(k) for k in ('sideNameOS', 'sideNameDS', 'viewLabelLeft')}))
bs.standard_upsert(c3, 'u', equipment=EQ, values={'sideNameOS': '操作側', 'sideNameDS': '駆動側'})
got = bs.standard_for(c3, EQ)['values']
rec('OS・DS の呼び方を保存して読み返せる', (got.get('sideNameOS'), got.get('sideNameDS')) == ('操作側', '駆動側'),
    str((got.get('sideNameOS'), got.get('sideNameDS'))))
bs.standard_upsert(c3, 'u', equipment=EQ, values={'sideNameOS': '', 'sideNameDS': ''})
got = bs.standard_for(c3, EQ)['values']
rec('呼び方を空にすると既定（OS／DS）へ戻る', (got.get('sideNameOS'), got.get('sideNameDS')) == ('OS', 'DS'),
    str((got.get('sideNameOS'), got.get('sideNameDS'))))
rec('中心の鍵は「基準面から」の名前（OSから、の鍵は残さない）',
    'centerFromDatum' in bs.STANDARD_DEFAULTS and 'centerFromOS' not in bs.STANDARD_DEFAULTS)
bs.standard_delete(c3, srow['id'])
rec('消すと既定値へ戻るだけ（画面は開ける）',
    bs.standard_for(c3, EQ)['values']['arborLen'] == bs.STANDARD_DEFAULTS['arborLen'])
# 「できない」が切の語彙に載っている（載せ忘れると保存できない欄になる）
from backend.flags import OFF_WORDS, flag_of                    # noqa: E402
rec('「できない」は切の語彙に載っている', 'できない' in OFF_WORDS and flag_of('できない') is False)

# ---------------------------------------------------------------------------
# 4. 初期セットは足し算にならない
# ---------------------------------------------------------------------------
c4 = fresh()
first = bs.seed_standard_parts(c4, 'u', EQ)
rec('初期セットが4種そろって入る',
    first['blade'] and first['spacer'] and first['ring'] and first['finger'], str(first))
# ゴムリングは色×幅、**潤滑リングは1行**（§9.455。同じ表の、種類が違う行）。
rec('ゴムリングは色×幅で数える（＋潤滑リング1行）',
    first['ring'] == len(bs.RING_COLOR_CYCLE) * len(bs.SEED_RING_WIDTHS) + 1, str(first['ring']))
lubes4 = [x for x in bs.ring_rows(c4, True, EQ) if x['lube']]
rec('初期セットの潤滑リングは幅10・外径270・内径240（利用者の指示の寸法）',
    len(lubes4) == 1 and (lubes4[0]['width'], lubes4[0]['od'], lubes4[0]['bore']) == (10.0, 270.0, 240.0)
    and lubes4[0]['lubeText'] == bs.RING_KIND_LUBE, str(lubes4))
rec('潤滑リングには外径の色の周期を当てない（画面の色は空＝紫のトークン）',
    lubes4 and lubes4[0]['hex'] == '', str(lubes4[0]['hex'] if lubes4 else None))
# ---- 種類（§9.455）: 画面の呼び名で書ける・送らなければ触らない ----
# 2つ目の潤滑リングは**別の色**を持つ（§9.529: 色コードが空だと1つ目の潤滑リングと同じ紫に見えるので断る）。
rec('§9.529 2つ目の潤滑リングを色コード空で足すと、1つ目と同じ紫として断る',
    _reject(lambda: bs.ring_upsert(c4, 'u', equipment=EQ, color='潤滑B', od=268, bore=240,
                                   width=12, qty=5, lube=True)))
lid, _c, _a = bs.ring_upsert(c4, 'u', equipment=EQ, color='潤滑C', hex_code='#e25a9e', od=268, bore=240,
                             width=12, qty=5, lube=bs.ring_is_lube('潤滑リング'))
got = [x for x in bs.ring_rows(c4, True, EQ) if x['id'] == lid][0]
rec('種類「潤滑リング」で書いた行は潤滑リングとして読める', got['lube'] is True, str(got))
bs.ring_upsert(c4, 'u', ring_id=lid, qty=6, lube=bs.ring_is_lube(None))
got = [x for x in bs.ring_rows(c4, True, EQ) if x['id'] == lid][0]
rec('種類を送らない更新では種類を変えない', got['lube'] is True and got['qty'] == 6, str(got))
bs.ring_upsert(c4, 'u', ring_id=lid, lube=bs.ring_is_lube('ゴムリング'))
got = [x for x in bs.ring_rows(c4, True, EQ) if x['id'] == lid][0]
rec('種類「ゴムリング」へ戻せる', got['lube'] is False and got['lubeText'] == bs.RING_KIND_RUBBER, str(got))
bs.ring_delete(c4, lid)
rec('潤滑リングの寸法は刃組基準値に置かない（置き場は1つ）',
    not any(k in bs.STANDARD_DEFAULTS for k in ('lubeWidth', 'lubeOD', 'lubeBore')),
    str([k for k in bs.STANDARD_DEFAULTS if k.startswith('lube')]))
before = len(bs.spacer_rows(c4, True, EQ))
again = bs.seed_standard_parts(c4, 'u', EQ)
rec('2度押しても増えない', sum(again.values()) == 0
    and len(bs.spacer_rows(c4, True, EQ)) == before, str(again))
swap = bs.seed_standard_parts(c4, 'u', EQ, replace=True)
PARTS = ('blade', 'spacer', 'ring', 'finger')
rec('入れ替えなら部材を作り直す',
    sum(swap[k] for k in PARTS) == sum(first[k] for k in PARTS), str(swap))
# ---- 台車マスタ（§9.424、利用者の指示） ----
# **初期セットで A台車・B台車 が入る**（刃組ガイダンスを使う設備＝台車が要る）。
rec('初期セットで台車が入る', first['carriage'] == len(bs.CARRIAGE_SEED), str(first))
rec('入れた台車の名前は CARRIAGE_SEED のとおり',
    [x['name'] for x in bs.carriage_rows(c4, True, EQ)] == list(bs.CARRIAGE_SEED),
    str([x['name'] for x in bs.carriage_rows(c4, True, EQ)]))
# **`replace` は台車を消さない**——部材を入れ替えても台車そのものは同じ物で、
# 記録（`刃組履歴マスタ.台車`）が名前で結び付いている。消すと差分の相手を失う。
rec('入れ替えでも台車は消えない・増えない',
    swap['carriage'] == 0
    and [x['name'] for x in bs.carriage_rows(c4, True, EQ)] == list(bs.CARRIAGE_SEED),
    str(swap['carriage']))
rec('台車も設備ごと（別の設備へは混ざらない）',
    not bs.carriage_rows(c4, True, 'テスト設備B'))
rec('設備名か台車名が空なら断る',
    _reject(lambda: bs.carriage_upsert(c4, 'u', None, equipment=EQ, name=''))
    and _reject(lambda: bs.carriage_upsert(c4, 'u', None, equipment='', name='C台車')))
# **「台車なし」は自動で入れない**（利用者の指示「自動で組み込む必要はないですが、
# スケジュール上の選択肢として使えるように」）。綴りはサーバーが持ち、
# 1行足せばそのまま選べる。
rec('「台車なし」は初期セットに入らない',
    bs.CARRIAGE_NONE not in [x['name'] for x in bs.carriage_rows(c4, True, EQ)],
    bs.CARRIAGE_NONE)
rec('別の設備へは混ざらない', not bs.spacer_rows(c4, True, 'テスト設備B'))
ctx = bs.context(c4, EQ)
rec('1往復で1画面ぶんが揃う',
    {'standard', 'blades', 'spacers', 'rings', 'fingers', 'history',
     'carriages', 'carriageSeed', 'carriageNone',
     'bladeStatus', 'spacerUses', 'ringColors'} <= set(ctx), str(sorted(ctx)))
rec('台車も1往復で届く（画面が別の口を叩かない）',
    [x['name'] for x in ctx['carriages']] == list(bs.CARRIAGE_SEED)
    and ctx['carriageNone'] == bs.CARRIAGE_NONE,
    str([x['name'] for x in ctx['carriages']]))
rec('語彙もサーバーが届ける',
    ctx['bladeStatus'] and ctx['spacerUses'] and ctx['ringColors'])
# 履歴は設備ごと・新しい順
bs.history_add(c4, 'u', equipment=EQ, carriage='A', at='2026-01-01 10:00', note='1',
               detail={'spacer': {'10': 4}})
bs.history_add(c4, 'u', equipment=EQ, carriage='B', at='2026-01-02 10:00', note='2',
               detail={'spacer': {'20': 2}})
h = bs.history_rows(c4, False, EQ)
rec('履歴は新しい順', len(h) == 2 and h[0]['carriage'] == 'B', str([x['carriage'] for x in h]))
rec('履歴の明細はそのまま戻る', h[1]['detail'] == {'spacer': {'10': 4}}, str(h[1]['detail']))
rec('履歴は台車が空なら断る',
    _reject(lambda: bs.history_add(c4, 'u', equipment=EQ, carriage='')))

# ---------------------------------------------------------------------------
# 5. 設備停止マスタの連携機能
# ---------------------------------------------------------------------------
c5 = fresh()
sr.ensure_stop_reason_table(c5)
rec('設備停止マスタに[連携機能]がある', '連携機能' in cols(c5, sr.STOP_REASON_TABLE, use_cache=False))
sid, _ = sr.stop_reason_upsert(c5, EQ, '刃組み', 'u', standard_minutes=60,
                               link_key=sr.STOP_LINK_BLADESET)
got = [r for r in sr.stop_reason_rows(c5, EQ) if r[0] == sid][0]
rec('連携機能が保存される', got[10] == sr.STOP_LINK_BLADESET, str(got[10]))
rec('呼び名も答える', sr.stop_link_label(sr.STOP_LINK_BLADESET) == '刃組ガイダンス')
rec('知らない鍵は「なし」へ倒れる', sr.stop_link_key('ありえない鍵') == sr.STOP_LINK_NONE)
rec('「なし」の呼び名は「なし」', sr.stop_link_label('') == 'なし')
# 渡さない更新では消えない（§9.212 ②）
sr.stop_reason_upsert(c5, EQ, '刃組み', 'u', standard_minutes=90, stop_reason_id=sid)
got2 = [r for r in sr.stop_reason_rows(c5, EQ) if r[0] == sid][0]
rec('連携機能を渡さない更新で消えない', got2[10] == sr.STOP_LINK_BLADESET, str(got2[10]))
sr.stop_reason_upsert(c5, EQ, '刃組み', 'u', stop_reason_id=sid, link_key='')
got3 = [r for r in sr.stop_reason_rows(c5, EQ) if r[0] == sid][0]
rec('「なし」へ戻せる', got3[10] == sr.STOP_LINK_NONE, str(got3[10]))
# 古いDB（列が無い）へ足せる
c6 = fresh()
cur = c6.cursor()
cur.execute('CREATE TABLE [設備停止マスタ] ([停止理由ID] INTEGER PRIMARY KEY AUTOINCREMENT,'
            '[設備名] TEXT,[分類] TEXT,[名称] TEXT,[標準所要分] REAL,[色キー] TEXT,'
            '[表示順] INTEGER,[有効] INTEGER)')
c6.commit()
sr.ensure_stop_reason_table(c6)
rec('古いDBにも「無ければ足す」で入る', '連携機能' in cols(c6, sr.STOP_REASON_TABLE, use_cache=False))

# ---- 語彙を画面へ書き写していない（§9.163） ----
defs_js = (ROOT / 'static/js/master/master-defs.js').read_text(encoding='utf-8')
rec('マスタ定義に連携機能の鍵を書き写していない（札はサーバーの語彙から）',
    "source:{key:'linkFeatures'}" in defs_js and 'bladeset' not in
    re.sub(r'/\*[\s\S]*?\*/', '', defs_js).split("k:'linkKey'")[1].split('},')[0],
    'master-defs.js')
sc_js = (ROOT / 'static/js/schedule/schedule-view.js').read_text(encoding='utf-8')
rec('予定の画面は行き先の**開き方**だけを持つ（呼び名はサーバーの戻り）',
    'SC_LINK_TARGETS' in sc_js and 'linkLabel' in sc_js, 'schedule-view.js')
rec('連携機能の語彙はサーバーの1箇所',
    len(sr.STOP_LINK_FEATURES) >= 2
    and all({'key', 'label', 'note'} <= set(f) for f in sr.STOP_LINK_FEATURES),
    str([f['key'] for f in sr.STOP_LINK_FEATURES]))

# ---------------------------------------------------------------------------
# 条の設計（§9.378）。**1設備1ロット1行**で、空の設計は受け付けない。
# ---------------------------------------------------------------------------
G1 = [{'lot': 'C1', 'count': 2, 'width': 65.0},
      {'lot': 'C2', 'count': 3, 'width': 50.0}]
did, made1 = bs.design_upsert(c, 'u', equipment=EQ, lot='P1', strips=5,
                              coil_width=1200, thickness=1.6, groups=G1)
rec('条の設計を記録できる', made1 and did > 0, f'id={did} made={made1}')
got = bs.design_for(c, EQ, 'P1')
rec('記録した設計をロットで引ける',
    got and got['strips'] == 5 and got['coilWidth'] == 1200
    and [g['lot'] for g in got['groups']] == ['C1', 'C2'], str(got))
G2 = [{'lot': 'C1', 'count': 5, 'width': 65.0}]
did2, made2 = bs.design_upsert(c, 'u', equipment=EQ, lot='P1', strips=5,
                               coil_width=1200, thickness=1.6, groups=G2)
rec('同じロットの2行目を作らない（上書き）', did2 == did and not made2,
    f'id={did2} made={made2}')
rec('上書きが効いている',
    [g['count'] for g in bs.design_for(c, EQ, 'P1')['groups']] == [5],
    str(bs.design_for(c, EQ, 'P1')['groups']))
rec('設計していないロットは None（既定を作らない）',
    bs.design_for(c, EQ, '居ないロット') is None)
rec('空の条の設計は受け付けない',
    _reject(lambda: bs.design_upsert(c, 'u', equipment=EQ, lot='P9', groups=[])))
rec('親ロット番号なしは受け付けない',
    _reject(lambda: bs.design_upsert(c, 'u', equipment=EQ, lot='', groups=G1)))
rec('「すべての設備」は受け付けない',
    _reject(lambda: bs.design_upsert(c, 'u', equipment='*', lot='P1', groups=G1)))
bs.design_delete(c, did)
rec('消すと引けなくなる', bs.design_for(c, EQ, 'P1') is None)

# ---------------------------------------------------------------------------
# 6. 刃選択マスタ（刃のカテゴリと刃厚の2つの判定表・§9.529）
# ---------------------------------------------------------------------------
# 判定（上から最初に当たった行）は`blade-core.js`の`firstRule()`の1本（網は test_bladesets.js）。
# ここで固定するのは**置き方**: 未登録は今までの選び方の種／保存は表ごとに丸ごと／既定の行は最後に1つ／
# 答えの整え方／旧い「専用刃の決まり」をカテゴリの表として読むこと。
rec('状態は3つ（一般／メンテナンス中／専用）——旧い刃の行を読むためだけに残す',
    bs.BLADE_STATUS == ('一般', 'メンテナンス中', '専用'), str(bs.BLADE_STATUS))
T0 = bs.pick_tables(c, EQ)
rec('§9.529 未登録の2つの表は今までの選び方（通常刃／いちばん厚い刃）',
    not T0['category']['stored'] and T0['category']['rows'] == [{'conditions': [], 'answer': '通常刃', 'group': '', 'note': ''}]
    and not T0['thickness']['stored'] and T0['thickness']['rows'][0]['answer'] == bs.PICK_THICKEST, str(T0))
n = bs.pick_replace(c, 'u', EQ, 'category', [
    {'conditions': [{'field': 'thickness', 'op': 'ge', 'value': '1.6'}], 'answer': '専用刃', 'group': 'B', 'note': '厚板'},
    {'conditions': [{'field': 'hold', 'op': 'eq', 'value': 'フィンガー'}], 'answer': '通常刃', 'group': 'B'},
    {'conditions': [{'field': 'category', 'op': 'eq', 'value': '専用刃'}], 'answer': '専用刃'},
    {'conditions': [], 'answer': '知らない'}])
T1 = bs.pick_tables(c, EQ)['category']
rec('§9.529 カテゴリの表を丸ごと保存できる（既定の行は最後に1つ）',
    n == 3 and T1['stored'] and [len(r['conditions']) for r in T1['rows']] == [1, 1, 0], str(T1['rows']))
rec('§9.529 専用刃はセットまで持つ・通常刃はセットを持たない・知らない答えは通常刃',
    [(r['answer'], r['group']) for r in T1['rows']] == [('専用刃', 'B'), ('通常刃', ''), ('通常刃', '')], str(T1['rows']))
rec('§9.529 前の表の答え（板押さえ方式）はカテゴリの表で使える／同じ表の答え（刃のカテゴリ）は使えない（落とす）',
    T1['rows'][1]['conditions'][0]['field'] == 'hold'
    and not any(c0['field'] == 'category' for r in T1['rows'] for c0 in r['conditions']), str(T1['rows']))
bs.pick_replace(c, 'u', EQ, 'thickness', [
    {'conditions': [{'field': 'category', 'op': 'eq', 'value': '専用刃'}], 'answer': '5'},
    {'conditions': [], 'answer': '10.0'}])
T2 = bs.pick_tables(c, EQ)['thickness']
rec('§9.529 刃厚の表はカテゴリの答えも条件に使え、答えは刃厚の数（10.0→10）',
    [(r['conditions'][0]['field'] if r['conditions'] else '', r['answer']) for r in T2['rows']] == [('category', '5'), ('', '10')],
    str(T2['rows']))
rec('§9.529 2つの表は別々に置かれる（カテゴリを保存しても刃厚は消えない）',
    bs.pick_tables(c, EQ)['category']['stored'] and T2['stored'])
rec('§9.529 表の名前が違えば断る', _reject(lambda: bs.pick_replace(c, 'u', EQ, 'x', [])))
rec('§9.529 設備が無ければ断る', _reject(lambda: bs.pick_replace(c, 'u', '', 'category', [])))
rec('§9.529 未登録に戻すとその表だけ種へ戻る',
    bs.pick_reset(c, EQ, 'thickness') == 2 and not bs.pick_tables(c, EQ)['thickness']['stored']
    and bs.pick_tables(c, EQ)['category']['stored'])
bs.pick_reset(c, EQ, 'category')
# 旧い「専用刃の決まり」（§9.379〜§9.526: [表]が空・[名称]つき）はカテゴリの表の行として読む。
bs.BLADEPICK_DEF.insert(c, {'設備名': EQ, '名称': '厚板は専用', '刃の組': 'X', '表示順': 10, '有効': -1,
                            '条件JSON': '[{"field":"thickness","op":"ge","value":"1.6"}]'}, 'u')
bs.BLADEPICK_DEF.insert(c, {'設備名': EQ, '名称': '条件なし', '刃の組': 'Y', '表示順': 20, '有効': -1,
                            '条件JSON': '[]'}, 'u')
T3 = bs.pick_tables(c, EQ)['category']
rec('§9.529 旧い決まりはカテゴリの表の行（専用刃・そのセット・名前は備考）として読む',
    T3['stored'] and [(r['answer'], r['group'], r['note']) for r in T3['rows']] == [('専用刃', 'X', '厚板は専用'), ('通常刃', '', '')],
    str(T3['rows']))
rec('§9.529 条件の無い旧い決まりは読まない（1度も当たらなかった行を既定の行と取り違えない）',
    not any(r['group'] == 'Y' for r in T3['rows']))
bs.pick_replace(c, 'u', EQ, 'category', T3['rows'])
rec('§9.529 保存し直すと旧い行は新しい形で書き直される（旧い行は残らない）',
    all(r['table'] == 'category' and not r['legacy'] for r in bs.pick_rows(c, True, EQ)), str(bs.pick_rows(c, True, EQ)))
bs.pick_reset(c, EQ, 'category')
rec('消すと決まりが残らない', bs.pick_rows(c, True, EQ) == [])
rec('知らない項目・比べ方は1件だけ落とす',
    bs.normalize_pick_conditions([
        {'field': '居ない項目', 'op': 'eq', 'value': '1'},
        {'field': 'thickness', 'op': '知らない', 'value': '1'},
        {'field': 'strips', 'op': 'eq', 'value': '6'}])
    == [{'field': 'strips', 'op': 'eq', 'value': '6'}])
rec('§9.529 表ごとに使える項目: 保持方式＝材料だけ／カテゴリ＝＋板押さえ方式・フィンガー材質／刃厚＝＋刃のカテゴリ',
    [[f['field'] for f in bs.pick_fields_for(o) if f['group'] == 'answer'] for _k, _l, o in bs.PICK_TABLES]
    == [[], ['hold', 'fingerMaterial'], ['hold', 'fingerMaterial', 'category']])

# ---- 保持方式マスタ（§9.524） ----
# 登録が無い設備は**今までの決め方の種**（板厚 < 切替板厚 → フィンガー／既定 → ゴムリング）。
fm = bs.standard_for(c, EQ)['values']['fingerMax']
got = bs.hold_rows(c, EQ)
rec('保持方式: 登録が無ければ、切替板厚から作った種（未登録）',
    not got['stored'] and got['rows'] == bs.hold_seed(fm), str(got))
# 保存は丸ごと。**条件の無い行は最後の1つだけが既定**・既定が無ければゴムリングで足す・知らない方式はゴムリング。
n = bs.hold_replace(c, 'u', EQ, [
    {'conditions': [], 'hold': 'フィンガー'},
    {'conditions': [{'field': 'strips', 'op': 'ge', 'value': '20'}], 'hold': 'フィンガー'},
    {'conditions': [{'field': 'source.製造材質', 'op': 'eq', 'value': 'SUS'}], 'hold': '知らない'}])
got = bs.hold_rows(c, EQ)
rec('保持方式: 保存すると登録になり、既定の行は最後に1つ',
    n == 3 and got['stored'] and [(len(r['conditions']), r['hold']) for r in got['rows']]
    == [(1, 'フィンガー'), (1, 'ゴムリング'), (0, 'フィンガー')], str(got['rows']))
bs.hold_replace(c, 'u', EQ, [{'conditions': [{'field': 'thickness', 'op': 'lt', 'value': '1'}], 'hold': 'フィンガー'}])
rec('保持方式: 既定の行が無ければゴムリングで足す',
    [r['hold'] for r in bs.hold_rows(c, EQ)['rows']] == ['フィンガー', 'ゴムリング'])
rec('保持方式: 仕掛の列は source.<列名> で書ける（字の形だけ見る）',
    bs.normalize_pick_conditions([{'field': 'source.製造材質', 'op': 'eq', 'value': 'SUS'},
                                  {'field': 'source.', 'op': 'eq', 'value': 'x'},
                                  {'field': 'source.a]b', 'op': 'eq', 'value': 'x'}])
    == [{'field': 'source.製造材質', 'op': 'eq', 'value': 'SUS'}])
rec('保持方式: 未登録に戻すと行が消え、種へ戻る',
    bs.hold_reset(c, EQ) == 2 and not bs.hold_rows(c, EQ)['stored'])
bs.hold_replace(c, 'u', EQ, [
    {'conditions': [{'field': 'thickness', 'op': 'lt', 'value': '1'}], 'hold': 'フィンガー', 'material': 'アルミニウム'},
    {'conditions': [{'field': 'strips', 'op': 'ge', 'value': '9'}], 'hold': 'フィンガー', 'material': '鉄'},
    {'conditions': [], 'hold': 'ゴムリング', 'material': 'アルミニウム'}])
rec('保持方式: 行ごとにフィンガー材質を持つ（§9.527）。知らない字は空欄＝既定・ゴムリングの行は持たない',
    [r['material'] for r in bs.hold_rows(c, EQ)['rows']] == ['アルミニウム', '', ''],
    str([(r['hold'], r['material']) for r in bs.hold_rows(c, EQ)['rows']]))
rec('保持方式: 種の行も材質は空欄（既定）', all(r['material'] == '' for r in bs.hold_seed(0.6)))
bs.hold_reset(c, EQ)
rec('保持方式: 設備が無ければ保存を断る', _reject(lambda: bs.hold_replace(c, 'u', '', [])))
# §9.530 列の並びは表の設定として残す（条件の出てくる順から起こさない）
bs.hold_replace(c, 'u', EQ, [{'conditions': [{'field': 'strips', 'op': 'ge', 'value': '20'}], 'hold': 'フィンガー'},
                             {'conditions': [{'field': 'thickness', 'op': 'lt', 'value': '1'}], 'hold': 'フィンガー'}],
                cols=['thickness', 'coilWidth', 'strips', 'hold', 'thickness', 'source.製造材質'])
rec('§9.530 保持方式: 保存した列の並び（条件の無い列も・重ねない・この表で使えない列は落とす）で返る',
    bs.hold_rows(c, EQ)['cols'] == ['thickness', 'coilWidth', 'strips', 'source.製造材質'], str(bs.hold_rows(c, EQ)['cols']))
bs.hold_replace(c, 'u', EQ, [{'conditions': [{'field': 'strips', 'op': 'ge', 'value': '20'}], 'hold': 'フィンガー'}])
rec('§9.530 列の並びを送らない保存（前の版）は、条件にある列から並びを起こす',
    bs.hold_rows(c, EQ)['cols'] == ['strips'], str(bs.hold_rows(c, EQ)['cols']))
bs.hold_reset(c, EQ)
bs.pick_replace(c, 'u', EQ, 'thickness', [{'conditions': [{'field': 'thickness', 'op': 'lt', 'value': '2'}], 'answer': '5'}],
                cols=['category', 'thickness'])
rec('§9.530 刃選択: 表ごとに列の並びを残す（刃のカテゴリの列は条件が無くても残る）',
    bs.pick_tables(c, EQ)['thickness']['cols'] == ['category', 'thickness'], str(bs.pick_tables(c, EQ)['thickness']))
bs.pick_reset(c, EQ, 'thickness')

# ---------------------------------------------------------------------------
# 7. 刃セット・フィンガー材質・刃選択の4項目（§9.526、利用者の指示）
# ---------------------------------------------------------------------------
c7 = fresh()
# 旧い刃の行（`状態`つき・§9.379）は表へ直に入れる——保存の口はもう`状態`を書かない（§9.529）。
bs.ensure_tables(c7)
for g0, t0, st0 in (('S', 10, '専用'), ('S', 15, '一般'), ('G', 10, 'メンテナンス中'), ('N', 10, None)):
    bs.BLADE_DEF.insert(c7, {'設備名': EQ, '組': g0, '刃厚': float(t0), '現状径': 300.0, '状態': st0,
                             '表示順': 10, '有効': -1}, 'u')
sets = {x['group']: x for x in bs.blade_sets(c7, EQ)}
rec('刃セット: 刃の組から作る（3組・枚数と刃厚を添える）',
    sorted(sets) == ['G', 'N', 'S'] and sets['S']['blades'] == 2 and sorted(sets['S']['thicknesses']) == [10.0, 15.0],
    str(sets))
rec('刃セット: 登録が無い組は刃の「状態」から起こす（専用→専用刃／全部メンテナンス中→研磨中／他→通常刃・使用中）',
    (sets['S']['category'], sets['S']['use'], sets['G']['use'], sets['N']['category'], sets['N']['use'])
    == ('専用刃', '使用中', '研磨中', '通常刃', '使用中') and not any(x['stored'] for x in sets.values()),
    str({k: (v['category'], v['use']) for k, v in sets.items()}))
got = bs.blade_set_update(c7, 'u', EQ, 'N', use='研磨中')
rec('刃セット: 使用状態だけ送ると、カテゴリはそのまま（送った項目だけ書く）',
    got == {'category': '通常刃', 'use': '研磨中', 'stored': True}, str(got))
got = bs.blade_set_update(c7, 'u', EQ, 'N', category='専用刃')
rec('刃セット: 続けてカテゴリを変えても使用状態は残る', got == {'category': '専用刃', 'use': '研磨中', 'stored': True}, str(got))
rec('刃セット: 同じ組は1行（2度書いても増えない）',
    sum(1 for r in bs.BLADESET_DEF.fetch(c7) if r['組'] == 'N') == 1)
rec('刃セット: 刃の行もセットのカテゴリ・使用状態を名乗る',
    {(x['name'], x['category'], x['use']) for x in bs.blade_rows(c7, False, EQ) if x['group'] == 'N'}
    == {('N 10mm', '専用刃', '研磨中')})
rec('刃セット: 語彙の外のカテゴリは断る', _reject(lambda: bs.blade_set_update(c7, 'u', EQ, 'N', category='一般')))
rec('刃セット: 語彙の外の使用状態は断る', _reject(lambda: bs.blade_set_update(c7, 'u', EQ, 'N', use='メンテナンス中')))
rec('刃セット: 設備が無ければ断る', _reject(lambda: bs.blade_set_update(c7, 'u', '', 'N', use='使用中')))
rec('刃セット: 初期値へ戻すと登録が消え、刃の「状態」から起こした値に戻る',
    bs.blade_set_reset(c7, EQ, 'N') == 1 and bs.blade_set_of(c7, EQ, 'N') == {'category': '通常刃', 'use': '使用中', 'stored': False}
    and bs.blade_set_reset(c7, EQ, 'N') == 0)
bs.blade_set_update(c7, 'u', EQ, 'N', use='研磨中')
ctx7 = bs.context(c7, EQ)
rec('刃セット: ガイダンスの材料に一覧と語彙が載る',
    len(ctx7['bladeSets']) == 3 and ctx7['bladeCatSpecial'] == '専用刃' and ctx7['bladeUseGrind'] == '研磨中')

# フィンガー: 名称を持たず材質（既定ベークライト）。1本＝設備＋幅＋材質。
f1, _m = bs.finger_upsert(c7, 'u', equipment=EQ, width=20, qty=10)
row = [x for x in bs.finger_rows(c7, True, EQ) if x['id'] == f1][0]
rec('フィンガー: 材質を送らなければ既定のベークライト・呼び名は材質＋幅',
    row['material'] == 'ベークライト' and row['name'] == 'ベークライト 20', str(row))
f2, _m = bs.finger_upsert(c7, 'u', equipment=EQ, width=20, qty=4, material='アルミニウム')
rec('フィンガー: 同じ幅でも材質が違えば別の1本', f2 and f2 != f1)
rec('フィンガー: 同じ幅・材質の2行目は断る（本数はその行で直す）',
    _reject(lambda: bs.finger_upsert(c7, 'u', equipment=EQ, width=20, material='ベークライト')))
rec('フィンガー: 語彙の外の材質は断る', _reject(lambda: bs.finger_upsert(c7, 'u', equipment=EQ, width=30, material='鉄')))
rec('フィンガー: 幅が無ければ断る', _reject(lambda: bs.finger_upsert(c7, 'u', equipment=EQ, qty=1)))
bs.finger_upsert(c7, 'u', finger_id=f2, qty=6)
row = [x for x in bs.finger_rows(c7, True, EQ) if x['id'] == f2][0]
rec('フィンガー: 本数だけ直しても材質は変わらない', row['material'] == 'アルミニウム' and row['qty'] == 6, str(row))
rec('フィンガー: 材質の語彙はベークライト・アルミニウム（既定が先頭）',
    bs.FINGER_MATERIALS == ('ベークライト', 'アルミニウム') and ctx7['fingerMaterials'] == list(bs.FINGER_MATERIALS))

# 刃セットの作る・字を変える・消す（§9.529）
got = bs.blade_set_create(c7, 'u', EQ, 'k', category='専用刃', use='使用中',
                          blades=[{'thickness': 10, 'currentDia': 318, 'qty': 5}, {'thickness': 5, 'qty': 3}])
rec('§9.529 セットを刃厚の行ごと作れる（小文字は A〜Z へ・カテゴリも書く）',
    got['category'] == '専用刃' and sorted(x['thickness'] for x in bs.blade_rows(c7, True, EQ) if x['group'] == 'K') == [5.0, 10.0])
rec('§9.529 あるセットの字では作れない・刃厚の無いセットは作れない・同じ刃厚が2つは断る',
    _reject(lambda: bs.blade_set_create(c7, 'u', EQ, 'K', blades=[{'thickness': 3}]))
    and _reject(lambda: bs.blade_set_create(c7, 'u', EQ, 'L', blades=[]))
    and _reject(lambda: bs.blade_set_create(c7, 'u', EQ, 'L', blades=[{'thickness': 3}, {'thickness': 3.0}])))
bs.pick_replace(c7, 'u', EQ, 'category', [{'conditions': [{'field': 'thickness', 'op': 'ge', 'value': '2'}],
                                           'answer': '専用刃', 'group': 'K'}])
n = bs.blade_set_rename(c7, 'u', EQ, 'K', 'm')
rec('§9.529 セットの字を変えると刃の行・セットの行・刃選択の名指しが同じ字へ',
    n == 2 and not [x for x in bs.blade_rows(c7, True, EQ) if x['group'] == 'K']
    and bs.blade_set_of(c7, EQ, 'M')['category'] == '専用刃'
    and bs.pick_tables(c7, EQ)['category']['rows'][0]['group'] == 'M')
rec('§9.529 あるセットの字へは変えられない', _reject(lambda: bs.blade_set_rename(c7, 'u', EQ, 'M', 'N')))
rec('§9.529 刃選択が名指ししているセットは消さない（理由を言う）', _reject(lambda: bs.blade_set_delete(c7, EQ, 'M')))
bs.pick_reset(c7, EQ, 'category')
rec('§9.529 セットを消すと刃の行もセットの行も消える',
    bs.blade_set_delete(c7, EQ, 'M') == 2 and not [x for x in bs.blade_rows(c7, True, EQ) if x['group'] == 'M']
    and bs.blade_set_of(c7, EQ, 'M')['stored'] is False)

# ---------------------------------------------------------------------------
# 8. ゴムリングの色（§9.528、利用者の指示「色ごとに外径内径は共通に」「登録した色と被らないように」）
# ---------------------------------------------------------------------------
c8 = fresh()
bs.seed_standard_parts(c8, 'u', EQ)
cols8 = bs.ring_colors(c8, EQ)
rec('色ごと: 初期セットは10色＋潤滑リング1（潤滑は後ろ・外径の大きい順）',
    [g['color'] for g in cols8] == [n for n, _h in bs.RING_COLOR_CYCLE] + ['潤滑'] and cols8[-1]['lube'],
    str([g['color'] for g in cols8]))
rec('色ごと: 1色に幅5種・合計本数を添える', len(cols8[0]['widths']) == 5 and cols8[0]['total'] == 190, str(cols8[0]))
cf = bs.ring_color_conflicts(c8, EQ, '赤', '#d93a34', 322)
rec('被り: 同じ色名・同じ色・同じ外径はどれも断る', sorted(x['why'] for x in cf['hard']) == ['hex', 'name', 'od'], str(cf))
cf = bs.ring_color_conflicts(c8, EQ, '紅', '#d83b35', 330)
rec('被り: 見分けにくいほど近い色は注意（断らない）', not cf['hard'] and cf['near'] and cf['near'][0]['color'] == '赤', str(cf))
rec('被り: 標準の10色どうしは注意にならない（最小の色差は閾値より大きい）',
    all(not bs.ring_color_conflicts(c8, EQ, 'x' + n, h, 400, current=n)['near'] for n, h in bs.RING_COLOR_CYCLE))
rec('被り: 潤滑リングはゴムリングと外径が同じでも断らない（外径で引かない）',
    not [x for x in bs.ring_color_conflicts(c8, EQ, '潤滑2', '', 322, lube=True)['hard'] if x['why'] == 'od'])
# §9.529 ①（利用者の指摘「色の被り判定の中に潤滑リングが入っていません」）——潤滑リングは色コードが空でも
# 画面では紫（`RING_LUBE_HEX`）で見えているので、その色で比べる。
rec('§9.529 被り: 潤滑リングの見えている色（紫）と同じ色のゴムリングは断る',
    [x['color'] for x in bs.ring_color_conflicts(c8, EQ, '回帰_紫', bs.RING_LUBE_HEX, 299)['hard'] if x['why'] == 'hex'] == ['潤滑'])
rec('§9.529 被り: 潤滑リングに近い色は注意に出る（色差 < 20）',
    [x['color'] for x in bs.ring_color_conflicts(c8, EQ, '回帰_紫', '#7552c8', 299)['near']] == ['潤滑'])
rec('§9.529 被り: 新しい潤滑リング（色コード空）は既にある潤滑リングと同じ色として断る',
    any(x['why'] == 'hex' for x in bs.ring_color_conflicts(c8, EQ, '潤滑2', '', 268, lube=True)['hard']))
rec('§9.529 色ごとの一覧は見えている色（tone）を返す（潤滑リングは紫）',
    [g['tone'] for g in bs.ring_colors(c8, EQ) if g['lube']] == [bs.RING_LUBE_HEX])
css = (ROOT / 'static/css/00-base.css').read_text(encoding='utf-8')
rec('§9.529 RING_LUBE_HEX は画面の --look-violet と同じ値（被り判定と見えている色を食い違わせない）',
    re.search(r'--look-violet:\s*(#[0-9a-fA-F]{6})', css).group(1).lower() == bs.RING_LUBE_HEX)
rec('被り: 自分自身（直している色）とは比べない', not bs.ring_color_conflicts(c8, EQ, '赤', '#d93a34', 322, current='赤')['hard'])
rec('被り: 1行ずつの保存（今までの窓）も同じ判定で断る',
    _reject(lambda: bs.ring_upsert(c8, 'u', equipment=EQ, color='新色', hex_code='#010203', od=321, bore=241, width=50)))
got = bs.ring_color_save(c8, 'u', EQ, '朱', hex_code='#e0452b', od=330, bore=241, current='赤')
rows = [r for r in bs.ring_rows(c8, True, EQ) if r['color'] == '朱']
rec('色の保存: 名前・色・外径を直すと、その色の行ぜんぶが変わる',
    got['rows'] == 5 and len(rows) == 5 and all(r['od'] == 330 and r['hex'] == '#e0452b' for r in rows)
    and not [r for r in bs.ring_rows(c8, True, EQ) if r['color'] == '赤'], str(got))
got = bs.ring_color_save(c8, 'u', EQ, '紫', hex_code='#7b3fb0', od=312, bore=241,
                         widths=[{'width': 50, 'qty': 4}, {'width': 20, 'qty': 6, 'minQty': 2}])
g = [x for x in bs.ring_colors(c8, EQ) if x['color'] == '紫'][0]
rec('色の保存: 新しい色は幅と本数で作る（外径・内径は幅ぜんぶで共通）',
    got['created'] == 2 and [w['width'] for w in g['widths']] == [50, 20] and g['total'] == 10 and g['od'] == 312, str(g))
rec('色の保存: 幅が無ければ断る', _reject(lambda: bs.ring_color_save(c8, 'u', EQ, '緋', hex_code='#aa0011', od=305, bore=241)))
rec('色の保存: 同じ幅が2つなら断る',
    _reject(lambda: bs.ring_color_save(c8, 'u', EQ, '緋', hex_code='#aa0011', od=305, bore=241, widths=[{'width': 10}, {'width': 10}])))
rec('色の保存: 内径が外径以上なら断る', _reject(lambda: bs.ring_color_save(c8, 'u', EQ, '緋', hex_code='#aa0011', od=240, bore=241, widths=[{'width': 10}])))
rec('色の保存: 色コードが読めなければ断る', _reject(lambda: bs.ring_color_save(c8, 'u', EQ, '緋', hex_code='あか', od=305, bore=241, widths=[{'width': 10}])))
rec('幅: 同じ色の同じ幅の2行目は断る', _reject(lambda: bs.ring_upsert(c8, 'u', equipment=EQ, color='紫', width=50, qty=1)))
lid, _c, _a = bs.ring_upsert(c8, 'u', equipment=EQ, color='潤滑', width=12, qty=3)
rec('幅: 潤滑リングの色に幅を足すと種類も引き継ぐ', [r['lube'] for r in bs.ring_rows(c8, True, EQ) if r['id'] == lid] == [True])
L8 = [r for r in bs.ring_rows(c8, True, EQ) if r['lube']][0]
bs.ring_upsert(c8, 'u', ring_id=L8['id'], lube=False)
bs.ring_upsert(c8, 'u', ring_id=L8['id'], lube=True)
rec('種類: 潤滑リング→ゴムリング→潤滑リングと戻せる（外径から当てた周期の色を引き継いで黄と被らない）',
    [r['lube'] for r in bs.ring_rows(c8, True, EQ) if r['id'] == L8['id']] == [True])
rec('色を消す: その色の行をぜんぶ消す', bs.ring_color_delete(c8, EQ, '紫') == 2 and not [x for x in bs.ring_colors(c8, EQ) if x['color'] == '紫'])
sug = bs.ring_color_suggest(c8, EQ)
rec('候補: 名前・色・外径のどれも使っていない最初の標準色（赤は名前が空いたので赤）',
    sug['color'] == '赤' and sug['od'] == 322, str(sug))

# ---- §9.531 スペーサー一体型（ゴムリングの種類・保持方式の答え） ----
rec('§9.531 種類の呼び名は3つ（ゴムリング／潤滑リング／スペーサー一体型）',
    bs.RING_KINDS == ('ゴムリング', '潤滑リング', 'スペーサー一体型'))
rec('§9.531 種類の呼び名を（潤滑, 一体型）へ直す・送っていなければ触らない',
    bs.ring_kind_flags('スペーサー一体型') == (False, True) and bs.ring_kind_flags('潤滑リング') == (True, False)
    and bs.ring_kind_flags('') == (None, None))
rec('§9.531 知らない種類は断る（黙ってゴムリングにしない）', _reject(lambda: bs.ring_kind_flags('一体')))
rec('§9.531 保持方式の答えに「スペーサー一体型」がある', bs.HOLD_INTEG in bs.HOLD_METHODS)
got = bs.ring_color_save(c8, 'u', EQ, '一体緑', hex_code='#1f6b4f', od=340, bore=241, integ=True,
                         widths=[{'width': 50, 'qty': 8}, {'width': 10.05, 'qty': 4}])
g = [x for x in bs.ring_colors(c8, EQ) if x['color'] == '一体緑'][0]
rec('§9.531 一体型の色を幅と本数で作れる（幅は細かい寸法も持てる）・色は種類を名乗る',
    g['integ'] and g['kind'] == 'スペーサー一体型' and not g['lube'] and [w['width'] for w in g['widths']] == [50, 10.05], str(g))
iid, _c, _a = bs.ring_upsert(c8, 'u', equipment=EQ, color='一体緑', width=20, qty=2)
rec('§9.531 一体型の色に幅を足すと種類も引き継ぐ', [r['integ'] for r in bs.ring_rows(c8, True, EQ) if r['id'] == iid] == [True])
rec('§9.531 一体型もゴムリングと外径で被らせない（刃組は色を外径で引く）',
    any(x['why'] == 'od' for x in bs.ring_color_conflicts(c8, EQ, '新しい', '#0a0b0c', 340)['hard']))
bs.ring_color_delete(c8, EQ, '一体緑')

# ---- 自己確認: 網が素通りしていない ----
rec('自己確認: 断る網は、断らない呼び出しでは真にならない',
    not _reject(lambda: bs.blade_upsert(c, 'u', equipment=EQ, group='Q', thickness=7)))

ng = [n for n, ok in R if not ok]
print(f'\n== {len(R) - len(ng)}/{len(R)} PASS ==')
sys.exit(1 if ng else 0)
