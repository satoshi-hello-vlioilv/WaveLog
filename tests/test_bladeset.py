"""test_bladeset.py: 刃組マスタと設備停止の連携機能（§9.377）

固定するのは5つ:
  1. **6枚の表が`TableDef`から作られ**、読み書きが往復する（部分更新で他の列が消えない）
  2. **ゴムリングは「同じ色は同じ外径」**——外径を直すとその色ぜんぶがそろい、
     色名から外径を**起こさない**（研磨で径が減っても呼び名は変わらない）
  3. **基準値は「既定はコード・上書きだけがDB」**——登録が無い設備でも値が出る
  4. **初期セットは足し算にならない**（2度押しても増えない）
  5. 設備停止マスタの`[連携機能]`が**保存され、知らない鍵は「なし」へ倒れる**
     ——そして**画面に綴りを書き写していない**（語彙はサーバーの1箇所）

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
# 1. 6枚の表
# ---------------------------------------------------------------------------
c = fresh()
made = bs.ensure_tables(c)
rec('まっさらなDBで6枚できる', len(made) == 6, str(made))
have = set(tables(c))
rec('表の名前が定義どおり',
    {d.table for d in (bs.BLADE_DEF, bs.SPACER_DEF, bs.RING_DEF, bs.FINGER_DEF,
                       bs.STANDARD_DEF, bs.HISTORY_DEF)} <= have,
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
rec('ゴムリングは色×幅で数える',
    first['ring'] == len(bs.RING_COLOR_CYCLE) * len(bs.SEED_RING_WIDTHS), str(first['ring']))
before = len(bs.spacer_rows(c4, True, EQ))
again = bs.seed_standard_parts(c4, 'u', EQ)
rec('2度押しても増えない', sum(again.values()) == 0
    and len(bs.spacer_rows(c4, True, EQ)) == before, str(again))
swap = bs.seed_standard_parts(c4, 'u', EQ, replace=True)
rec('入れ替えなら作り直す', sum(swap.values()) == sum(first.values()), str(swap))
rec('別の設備へは混ざらない', not bs.spacer_rows(c4, True, 'テスト設備B'))
ctx = bs.context(c4, EQ)
rec('1往復で1画面ぶんが揃う',
    {'standard', 'blades', 'spacers', 'rings', 'fingers', 'history',
     'bladeStatus', 'spacerUses', 'ringColors'} <= set(ctx), str(sorted(ctx)))
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

# ---- 自己確認: 網が素通りしていない ----
rec('自己確認: 断る網は、断らない呼び出しでは真にならない',
    not _reject(lambda: bs.blade_upsert(c, 'u', equipment=EQ, name='自己確認')))

ng = [n for n, ok in R if not ok]
print(f'\n== {len(R) - len(ng)}/{len(R)} PASS ==')
sys.exit(1 if ng else 0)
