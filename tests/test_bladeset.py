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
bid, created = bs.blade_upsert(c, 'u', equipment=EQ, name='10mm A', group='A',
                               thickness=10, current_dia=318.2, qty=70)
rec('刃を登録できる', created and bid)
bs.blade_upsert(c, 'u', blade_id=bid, current_dia=317.9)
row = [x for x in bs.blade_rows(c, True, EQ) if x['id'] == bid][0]
rec('部分更新で他の列が消えない',
    row['currentDia'] == 317.9 and row['name'] == '10mm A' and row['qty'] == 70,
    str(row))
rec('設備は「すべての設備」を受け付けない（理由つきで断る）',
    _reject(lambda: bs.blade_upsert(c, 'u', equipment='*', name='x')))
rec('設備が空なら断る', _reject(lambda: bs.blade_upsert(c, 'u', equipment='', name='x')))
rec('刃の名称が空なら断る', _reject(lambda: bs.blade_upsert(c, 'u', equipment=EQ, name='')))
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
lid, _c, _a = bs.ring_upsert(c4, 'u', equipment=EQ, color='潤滑B', od=268, bore=240,
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
# 6. 刃選択マスタ（「専用」の刃を選ぶ条件・§9.379）
# ---------------------------------------------------------------------------
# 固定するのは「既定は一般」と「当たったときだけ専用」の2点。ここが崩れると、
# 現場は気づかないまま違う刃で組むことになる。
rec('状態は3つ（一般／メンテナンス中／専用）',
    bs.BLADE_STATUS == ('一般', 'メンテナンス中', '専用'), str(bs.BLADE_STATUS))

CTX = {'thickness': 1.8, 'coilWidth': 1200, 'strips': 6,
       'minWidth': 65.0, 'maxWidth': 120.0, 'material': 'SPCC', 'lotNo': 'L-1'}
rec('決まりが1行も無ければ「一般」（None を返す）', bs.pick_group([], CTX) is None)

pid, pmade = bs.pick_upsert(c, 'u', equipment=EQ, name='厚板は専用',
                            conditions=[{'field': 'thickness', 'op': 'ge', 'value': '1.6'}],
                            group='X')
rec('刃選択の決まりを足せる', pmade and pid)
rules = bs.pick_rows(c, False, EQ)
rec('条件が往復する',
    len(rules) == 1 and rules[0]['conditions'] == [
        {'field': 'thickness', 'op': 'ge', 'value': '1.6'}], str(rules))
hit = bs.pick_group(rules, CTX)
rec('条件に当たると専用の組を返す', hit and hit['group'] == 'X', str(hit))
rec('当たらなければ「一般」（板厚 1.2 は 1.6 未満）',
    bs.pick_group(rules, dict(CTX, thickness=1.2)) is None)
rec('引けない値は当てない（板厚が空なら当たらない）',
    bs.pick_group(rules, dict(CTX, thickness=None)) is None)

# 同じ行の条件は**全部**満たしたときだけ当たる（AND）
bs.pick_upsert(c, 'u', row_id=pid, conditions=[
    {'field': 'thickness', 'op': 'ge', 'value': '1.6'},
    {'field': 'strips', 'op': 'eq', 'value': '6'}])
rules = bs.pick_rows(c, False, EQ)
rec('同じ行の条件はANDで見る（両方そろえば当たる）',
    (bs.pick_group(rules, CTX) or {}).get('group') == 'X')
rec('片方だけでは当たらない',
    bs.pick_group(rules, dict(CTX, strips=4)) is None)

# 範囲・文字
bs.pick_upsert(c, 'u', row_id=pid, conditions=[
    {'field': 'minWidth', 'op': 'between', 'value': '60', 'value2': '70'}])
rec('範囲で当たる', (bs.pick_group(bs.pick_rows(c, False, EQ), CTX) or {}).get('group') == 'X')
bs.pick_upsert(c, 'u', row_id=pid, conditions=[
    {'field': 'material', 'op': 'contains', 'value': 'PC'}])
rec('文字は「含む」で当たる',
    (bs.pick_group(bs.pick_rows(c, False, EQ), CTX) or {}).get('group') == 'X')

# **条件の無い行は当たらない**（「いつでも当たる行」を書けないこと）
bs.pick_upsert(c, 'u', row_id=pid, conditions=[])
rec('条件が空の行は当たらない（既定が静かに崩れない）',
    bs.pick_group(bs.pick_rows(c, False, EQ), CTX) is None,
    str(bs.pick_rows(c, False, EQ)))

# 壊れた条件は1件だけ落とす（行ごと消さない）
rec('知らない項目・比べ方は1件だけ落とす',
    bs.normalize_pick_conditions([
        {'field': '居ない項目', 'op': 'eq', 'value': '1'},
        {'field': 'thickness', 'op': '知らない', 'value': '1'},
        {'field': 'strips', 'op': 'eq', 'value': '6'}])
    == [{'field': 'strips', 'op': 'eq', 'value': '6'}])

# 上から順に見て**最初に当たった1行**
bs.pick_upsert(c, 'u', row_id=pid, conditions=[
    {'field': 'thickness', 'op': 'ge', 'value': '1.0'}], order=1)
p2, _ = bs.pick_upsert(c, 'u', equipment=EQ, name='あとの行', conditions=[
    {'field': 'thickness', 'op': 'ge', 'value': '1.0'}], group='Y', order=2)
rec('先に並ぶ行が勝つ',
    (bs.pick_group(bs.pick_rows(c, False, EQ), CTX) or {}).get('group') == 'X',
    str([(r['order'], r['group']) for r in bs.pick_rows(c, False, EQ)]))
bs.pick_delete(c, pid)
bs.pick_delete(c, p2)
rec('消すと決まりが残らない', bs.pick_rows(c, True, EQ) == [])

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

# ---------------------------------------------------------------------------
# 7. 刃セット・フィンガー材質・刃選択の4項目（§9.526、利用者の指示）
# ---------------------------------------------------------------------------
c7 = fresh()
bs.blade_upsert(c7, 'u', equipment=EQ, name='S1', group='S', thickness=10, current_dia=300, status='専用')
bs.blade_upsert(c7, 'u', equipment=EQ, name='S2', group='S', thickness=15, current_dia=300, status='一般')
bs.blade_upsert(c7, 'u', equipment=EQ, name='G1', group='G', thickness=10, current_dia=300, status='メンテナンス中')
bs.blade_upsert(c7, 'u', equipment=EQ, name='N1', group='N', thickness=10, current_dia=300)
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
    == {('N1', '専用刃', '研磨中')})
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

# 刃選択の条件: 選べるのは4項目。前の項目で書いた決まりも読んで効かせる。
rec('刃選択: 選べる項目は板押さえ方式・板厚・材質・調質',
    [f['label'] for f in ctx7['pickFields']] == ['板押さえ方式', '板厚', '材質', '調質'], str(ctx7['pickFields']))
rec('刃選択: 板押さえ方式は候補から選ぶ（保持方式の顔ぶれ）',
    ctx7['pickFields'][0].get('kind') == 'choice' and ctx7['pickFields'][0].get('options') == list(bs.HOLD_METHODS))
rec('刃選択: 前の項目（条数など）の条件も保存で落とさない',
    bs.normalize_pick_conditions([{'field': 'strips', 'op': 'eq', 'value': '6'},
                                  {'field': 'hold', 'op': 'eq', 'value': 'フィンガー'},
                                  {'field': 'temper', 'op': 'eq', 'value': 'H'}])
    == [{'field': 'strips', 'op': 'eq', 'value': '6'}, {'field': 'hold', 'op': 'eq', 'value': 'フィンガー'},
        {'field': 'temper', 'op': 'eq', 'value': 'H'}])
rec('刃選択: 板押さえ方式・調質で当たる（字として比べる）',
    (bs.pick_group([{'conditions': [{'field': 'hold', 'op': 'eq', 'value': 'フィンガー'},
                                    {'field': 'temper', 'op': 'eq', 'value': 'H'}], 'group': 'S', 'enabled': True}],
                   {'hold': 'フィンガー', 'temper': 'H'}) or {}).get('group') == 'S')

# ---- 自己確認: 網が素通りしていない ----
rec('自己確認: 断る網は、断らない呼び出しでは真にならない',
    not _reject(lambda: bs.blade_upsert(c, 'u', equipment=EQ, name='自己確認')))

ng = [n for n, ok in R if not ok]
print(f'\n== {len(R) - len(ng)}/{len(R)} PASS ==')
sys.exit(1 if ng else 0)
