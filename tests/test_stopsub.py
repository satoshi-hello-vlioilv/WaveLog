"""test_stopsub.py: 設備停止の内訳（サブカテゴリ）と時間の選択肢（§9.389）

利用者の指示:
  「設備停止マスタにサブカテゴリを登録できるようにしてください。例えば、
   刃組待ちだったら、ゴムリングとフィンガーと刃出しの3種類があります。
   そのような種類の違いも後でわかるようにしたいが同じ刃組というグループには
   入れておきたい」
  「設備停止マスタから、時間を切り離して、設備停止時間マスタに分割し…
   そうした方が集計の時にすっきり集計しやすくなる」

固定するのは7つ:
  1. **3階層が成り立つ**——サブは`[停止理由ID]`で親を指し、
     **親が違えば同じ名前のサブが両立する**（「刃組待ち>刃出し」と
     「段取り待ち>刃出し」は別物）。親の無いIDでは登録できない。
  2. **削除は論理削除で、同じ名前を入れ直すと元の行が戻る**
     （設備停止マスタと同じ挙動。IDが増え続けない）。
  3. **既定の分は「サブ → 親 → 無し」の3段**（`stop_default_minutes`の
     1箇所が答える）。サブの標準所要分が空なら親の値が出る。
  4. 時間マスタは**種が入り、0以下と重複を断り、分の小さい順**で返る。
  5. **スライダーの範囲は選択肢そのものから**作る（別の設定値にしない）。
     選択肢が1件以下なら`None`＝画面はスライダーを出さない。
  6. `stop_reason_id_of()`が**(対象設備,名称)で親を引ける**——予定の行は
     停止理由IDを持たず名称の写ししか無いので、ここが唯一の親探し。
     全設備（`'*'`）の行も引ける。
  7. `plan_set_stop_sub()`は**設備停止の行だけ**を触る（作業の行の明細JSONは
     仕掛の写しで、別物を入れると写しが消えたようにしか見えない）。

サーバーは要らない（1段目・§9.337）。
"""
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.db_access import connect, cols                    # noqa: E402
from backend.repositories import schedule_repo as sr           # noqa: E402

R = []


def rec(name, ok, detail=''):
    R.append((name, ok))
    print(('PASS: ' if ok else 'FAIL: ') + name + (f' -- {detail}' if detail else ''))


def fresh():
    return connect(Path(tempfile.mkdtemp()) / 'm.sqlite3', False, 'sqlite')


def refused(fn):
    """断られたか。**理由の文字も返す**——「別の理由で止まった」を
    「断れた」と数えないため（§9.387の追補）。"""
    try:
        fn()
    except ValueError as e:
        return True, str(e)
    except Exception as e:                                      # noqa: BLE001 何で落ちたかを出す
        return False, f'ValueError以外: {type(e).__name__}: {e}'
    return False, '通ってしまった'


# ---------------------------------------------------------------------------
# 1. 3階層（親が違えば同じ名前のサブが両立する）
# ---------------------------------------------------------------------------
c = fresh()
sr.ensure_config_master_tables(c)
have = set(cols(c, '設備停止サブカテゴリマスタ'))
rec('サブカテゴリの表に必要な列がある',
    {'サブカテゴリID', '停止理由ID', '名称', '標準所要分', '表示順', '有効'} <= have,
    sorted(have))

blade, _ = sr.stop_reason_upsert(c, 'テスト設備A', '刃組待ち', 'u', category='待ち', standard_minutes=60)
setup, _ = sr.stop_reason_upsert(c, 'テスト設備A', '段取り待ち', 'u', category='待ち', standard_minutes=30)

s_ring, created1 = sr.stop_sub_upsert(c, blade, 'ゴムリング', 'u')
s_fing, _ = sr.stop_sub_upsert(c, blade, 'フィンガー', 'u')
s_out, _ = sr.stop_sub_upsert(c, blade, '刃出し', 'u', standard_minutes=90)
s_out2, created2 = sr.stop_sub_upsert(c, setup, '刃出し', 'u')

rec('新規は created=True', created1 and created2)
rec('同じ親の3件が並ぶ（刃組待ちの内訳）',
    [r[2] for r in sr.stop_sub_rows(c, blade)] == ['ゴムリング', 'フィンガー', '刃出し'],
    [r[2] for r in sr.stop_sub_rows(c, blade)])
rec('親が違えば同じ名前が両立する（刃出しが2件・別ID）',
    s_out != s_out2 and len(sr.stop_sub_rows(c)) == 4, f'{s_out} vs {s_out2}')
rec('同じ親に同じ名前を入れ直すと同じ行（増えない）',
    sr.stop_sub_upsert(c, blade, 'ゴムリング', 'u') == (s_ring, False))

ok, why = refused(lambda: sr.stop_sub_upsert(c, 999999, 'ゴムリング', 'u'))
rec('親の無いIDでは登録できない', ok and '設備停止が見つかりません' in why, why)
ok, why = refused(lambda: sr.stop_sub_upsert(c, blade, '   ', 'u'))
rec('名前が空のサブは作れない', ok and 'サブカテゴリ名' in why, why)
ok, why = refused(lambda: sr.stop_sub_upsert(c, None, 'x', 'u'))
rec('親を選ばずには作れない', ok and 'どの設備停止' in why, why)
# 改名で別の内訳とぶつかる（同じ親に同名が2つできない）
ok, why = refused(lambda: sr.stop_sub_upsert(c, blade, 'フィンガー', 'u', sub_id=s_ring))
rec('改名で同じ親の同名とはぶつかる', ok and '既に登録' in why, why)

rec('内訳の件数を親ごとに数えられる（一覧が1度で見分けられる）',
    sr.stop_sub_counts(c) == {blade: 3, setup: 1}, sr.stop_sub_counts(c))

# ---------------------------------------------------------------------------
# 1b. もう1階層（§9.390、利用者の指示「内訳はもう1階層増やせるように」）
# ---------------------------------------------------------------------------
have2 = set(cols(c, '設備停止サブカテゴリマスタ'))
rec('内訳の表が親の列を持つ', '親サブカテゴリID' in have2, sorted(have2))
k_ring, _ = sr.stop_sub_upsert(c, blade, '交換', 'u', parent_sub_id=s_ring)
k_fing, _ = sr.stop_sub_upsert(c, blade, '交換', 'u', parent_sub_id=s_fing)
rec('親が違えば同じ名前の「内訳の内訳」が両立する',
    k_ring != k_fing, f'{k_ring} vs {k_fing}')
ok, why = refused(lambda: sr.stop_sub_upsert(c, blade, '交換', 'u', parent_sub_id=s_ring))
rec('同じ親の下の同名は増えない（既存の行が戻る）',
    not ok and sr.stop_sub_upsert(c, blade, '交換', 'u', parent_sub_id=s_ring) == (k_ring, False),
    why)
ok, why = refused(lambda: sr.stop_sub_upsert(c, blade, 'さらに下', 'u', parent_sub_id=k_ring))
rec('段は2つまで（内訳の内訳を、さらに分けられない）', ok and '2段' in why, why)
ok, why = refused(lambda: sr.stop_sub_upsert(c, setup, 'よそ', 'u', parent_sub_id=s_ring))
rec('別の設備停止の内訳は親にできない', ok and '別の設備停止' in why, why)

order = [(r[2], int(r[8] or 0)) for r in sr.stop_sub_rows(c, blade)]
rec('並びは「親 → その子」（画面が木を組み直さずに描ける）',
    order.index(('交換', s_ring)) == order.index(('ゴムリング', 0)) + 1, order)
rec('1段目だけを数える（3件のまま。2段目を足しても増えない）',
    sr.stop_sub_counts(c) == {blade: 3, setup: 1}, sr.stop_sub_counts(c))
rec('親をたどれる', (sr.stop_sub_parent_of(c, k_ring) or [None] * 3)[2] == 'ゴムリング')
rec('1段目の親は None', sr.stop_sub_parent_of(c, s_ring) is None)

# 予定へ写す形。**1段目は`stopSub`のまま**（集計は名称と1段目で束ねられる）。
d1 = sr.stop_sub_detail(sr.stop_sub_row(c, s_ring))
d2 = sr.stop_sub_detail(sr.stop_sub_row(c, k_ring), sr.stop_sub_row(c, s_ring))
rec('1段目の写しは stopSub だけ', d1.get('stopSub') == 'ゴムリング' and 'stopSub2' not in d1, d1)
rec('2段目の写しは stopSub＝親／stopSub2＝自分',
    d2.get('stopSub') == 'ゴムリング' and d2.get('stopSub2') == '交換', d2)

# 消すと子も消える（どこにもぶら下がらない内訳を選択肢に残さない）。
sr.stop_sub_delete(c, s_fing, 'u')
rec('親を消すと子も消える',
    not any(int(r[0]) in (s_fing, k_fing) for r in sr.stop_sub_rows(c, blade)),
    [r[2] for r in sr.stop_sub_rows(c, blade)])
sr.stop_sub_upsert(c, blade, 'フィンガー', 'u')   # 戻す（下の 2. が使う）
sr.stop_sub_delete(c, k_ring, 'u')

# ---------------------------------------------------------------------------
# 2. 削除は論理削除、入れ直すと戻る
# ---------------------------------------------------------------------------
sr.stop_sub_delete(c, s_fing, 'u')
rec('消したサブは一覧から外れる',
    [r[2] for r in sr.stop_sub_rows(c, blade)] == ['ゴムリング', '刃出し'],
    [r[2] for r in sr.stop_sub_rows(c, blade)])
rec('消した行も stop_sub_row では読める（予定が指している名前を出すため）',
    (sr.stop_sub_row(c, s_fing) or [None] * 6)[2] == 'フィンガー')
again, created3 = sr.stop_sub_upsert(c, blade, 'フィンガー', 'u')
rec('同じ名前を入れ直すと元の行が戻る（IDが増えない）',
    again == s_fing and not created3, f'{again} / {s_fing}')

# ---------------------------------------------------------------------------
# 2b. 既定の内訳（§9.397、利用者の指示「内訳は1つしかない場合はそれを既定に。
#     2つ以上あっても既定のものを設定して登録できるようにしてください」）
# ---------------------------------------------------------------------------
have3 = set(cols(c, '設備停止サブカテゴリマスタ'))
rec('内訳の表が既定の列を持つ', '既定' in have3, sorted(have3))
# 「刃組待ち」は3件（ゴムリング／刃出し／フィンガー）＝印が無ければ既定なし。
rec('2件以上あって印が無ければ既定なし（推測で選ばない）',
    sr.stop_default_sub(c, blade) is None, sr.stop_default_sub(c, blade))
# 「段取り待ち」は1件だけ＝**印を付けなくてもそれが既定**。
rec('1件しかなければ印が無くてもそれが既定',
    sr.stop_default_sub(c, setup) == s_out2, f"{sr.stop_default_sub(c, setup)} / {s_out2}")
# **標準所要分は一緒に渡すこと**——`stop_sub_upsert`は渡した値をそのまま書くので、
# 省くと`None`（空欄＝親に任せる）で上書きされる。画面（`ssbSave`）も今の値を
# 必ず載せている。ここを省いたせいで下の「3.」が2件落ちた（実測）。
sr.stop_sub_upsert(c, blade, '刃出し', 'u', standard_minutes=90, sub_id=s_out, is_default=True)
rec('印を付ければ2件以上でもそれが既定', sr.stop_default_sub(c, blade) == s_out,
    sr.stop_default_sub(c, blade))
sr.stop_sub_upsert(c, blade, 'ゴムリング', 'u', sub_id=s_ring, is_default=True)
flags = {r[2]: bool(r[9]) for r in sr.stop_sub_rows(c, blade)}
rec('印は兄弟のうち1つだけ（立てると他は降りる）',
    sum(1 for v in flags.values() if v) == 1 and flags.get('ゴムリング'), flags)
# **鍵が来ていなければ触らない**（§9.212 ②）。名前を直しただけで既定が
# 落ちると、直した人には何が起きたか分からない。
sr.stop_sub_upsert(c, blade, 'ゴムリング2', 'u', sub_id=s_ring)
rec('名前を直しても既定は落ちない（送らない鍵は触らない）',
    sr.stop_default_sub(c, blade) == s_ring, sr.stop_default_sub(c, blade))
sr.stop_sub_upsert(c, blade, 'ゴムリング', 'u', sub_id=s_ring, is_default=False)
rec('印は外せる（外すと既定なしへ戻る）', sr.stop_default_sub(c, blade) is None,
    sr.stop_default_sub(c, blade))
# 2段目にも同じ規則が効く（親ごとに1つ）。
kid_a, _ = sr.stop_sub_upsert(c, blade, '交換', 'u', parent_sub_id=s_ring)
kid_b, _ = sr.stop_sub_upsert(c, blade, '増し締め', 'u', parent_sub_id=s_ring)
rec('2段目も2件なら既定なし', sr.stop_default_sub(c, blade, s_ring) is None,
    sr.stop_default_sub(c, blade, s_ring))
sr.stop_sub_upsert(c, blade, '増し締め', 'u', sub_id=kid_b, parent_sub_id=s_ring, is_default=True)
rec('2段目の既定は親ごとに持てる', sr.stop_default_sub(c, blade, s_ring) == kid_b,
    sr.stop_default_sub(c, blade, s_ring))
rec('1段目の既定は2段目の印に引きずられない', sr.stop_default_sub(c, blade) is None,
    sr.stop_default_sub(c, blade))
m = sr.stop_default_sub_map(c)
rec('まとめて答える表も同じ答えを返す（画面が数え直さない）',
    m.get('%d:%d' % (blade, s_ring)) == kid_b and ('%d:0' % blade) not in m
    and m.get('%d:0' % setup) == s_out2, m)
sr.stop_sub_delete(c, kid_a, 'u')
sr.stop_sub_delete(c, kid_b, 'u')

# ---------------------------------------------------------------------------
# 3. 既定の分は「サブ → 親 → 無し」の3段
# ---------------------------------------------------------------------------
rec('サブに標準所要分があればそれ', sr.stop_default_minutes(c, blade, s_out) == 90.0,
    sr.stop_default_minutes(c, blade, s_out))
# 2段目（§9.390）。**下から順に見る**——自分が空なら親の内訳、それも空なら停止内容。
deep_a, _ = sr.stop_sub_upsert(c, blade, '粗出し', 'u', standard_minutes=45, parent_sub_id=s_out)
deep_b, _ = sr.stop_sub_upsert(c, blade, '仕上げ', 'u', parent_sub_id=s_out)
rec('2段目に値があればそれ', sr.stop_default_minutes(c, blade, deep_a) == 45.0,
    sr.stop_default_minutes(c, blade, deep_a))
rec('2段目が空なら1段目（90分）', sr.stop_default_minutes(c, blade, deep_b) == 90.0,
    sr.stop_default_minutes(c, blade, deep_b))
sr.stop_sub_delete(c, deep_a, 'u')
sr.stop_sub_delete(c, deep_b, 'u')
rec('サブが空欄なら親の標準所要分', sr.stop_default_minutes(c, blade, s_ring) == 60.0,
    sr.stop_default_minutes(c, blade, s_ring))
rec('サブを選んでいなければ親の標準所要分', sr.stop_default_minutes(c, blade) == 60.0)
none_id, _ = sr.stop_reason_upsert(c, 'テスト設備A', '未設定の停止', 'u')
rec('どちらも空なら None（0にしない）', sr.stop_default_minutes(c, none_id) is None,
    sr.stop_default_minutes(c, none_id))

# ---------------------------------------------------------------------------
# 4-5. 時間マスタとスライダー
# ---------------------------------------------------------------------------
vals = sr.stop_minutes_values(c)
rec('種が入っている（よくある刻み）', vals == [float(m) for m in sr.STOP_MINUTES_SEEDS], vals)

ok, why = refused(lambda: sr.stop_minutes_upsert(c, 0, 'u'))
rec('0分は断る', ok and '0より大きい' in why, why)
ok, why = refused(lambda: sr.stop_minutes_upsert(c, -30, 'u'))
rec('負の時間は断る', ok and '0より大きい' in why, why)
ok, why = refused(lambda: sr.stop_minutes_upsert(c, 'あ', 'u'))
rec('数でないものは断る', ok and '数値' in why, why)
rec('同じ分を入れても増えない', sr.stop_minutes_upsert(c, 30, 'u')[1] is False)

sr.stop_minutes_upsert(c, 7, 'u')
rec('分の小さい順に返る（表示順で並べ替えさせない）',
    sr.stop_minutes_values(c) == sorted(sr.stop_minutes_values(c)),
    sr.stop_minutes_values(c))

sl = sr.stop_minutes_slider(c)
rec('スライダーの範囲は選択肢そのもの（最小〜最大）',
    sl and sl['min'] == min(sr.stop_minutes_values(c)) and sl['max'] == max(sr.stop_minutes_values(c))
    and sl['step'] == float(sr.STOP_MINUTES_STEP), sl)

c2 = fresh()
sr.ensure_stop_minutes_table(c2)
for r in sr.stop_minutes_rows(c2)[1:]:
    sr.stop_minutes_delete(c2, r[0], 'u')
rec('選択肢が1件ならスライダーは出さない（動かせない目盛りを置かない）',
    sr.stop_minutes_slider(c2) is None, sr.stop_minutes_slider(c2))

# ---------------------------------------------------------------------------
# 6. 親探しは (対象設備,名称) の1箇所
# ---------------------------------------------------------------------------
rec('名称と設備から親IDを引ける', sr.stop_reason_id_of(c, 'テスト設備A', '刃組待ち') == blade)
rec('別の設備からは引けない', sr.stop_reason_id_of(c, 'テスト設備B', '刃組待ち') is None)
all_id, _ = sr.stop_reason_upsert(c, '*', '全設備の停止', 'u')
rec('全設備（*）の行はどの設備からも引ける',
    sr.stop_reason_id_of(c, 'テスト設備B', '全設備の停止') == all_id)
sr.stop_reason_delete(c, blade, 'u')
rec('消した停止は親として引けない', sr.stop_reason_id_of(c, 'テスト設備A', '刃組待ち') is None)

# ---------------------------------------------------------------------------
# 7. 予定の内訳を直せるのは設備停止の行だけ
# ---------------------------------------------------------------------------
share = fresh()
sr.ensure_plan_table(share)
cur = share.cursor()
cur.execute("INSERT INTO [作業予定] ([設備名],[表示順],[種別],[予定名称],[明細JSON],[有効]) "
            "VALUES (?,?,?,?,?,-1)", ['テスト設備A', 1, '作業', '', '{"lotNo":"L1"}'])
work_id = cur.lastrowid
cur.execute("INSERT INTO [作業予定] ([設備名],[表示順],[種別],[予定名称],[明細JSON],[有効]) "
            "VALUES (?,?,?,?,?,-1)", ['テスト設備A', 2, '設備停止', '刃組待ち', ''])
stop_id = cur.lastrowid
share.commit()

ok, why = refused(lambda: sr.plan_set_stop_sub(share, work_id, 'u', ''))
rec('作業の行には内訳を入れられない（仕掛の写しを潰さない）',
    ok and '設備停止の行だけ' in why, why)
cur.execute('SELECT [明細JSON] FROM [作業予定] WHERE [予定ID]=?', [work_id])
rec('断られた作業の行の明細JSONは1文字も変わっていない',
    cur.fetchone()[0] == '{"lotNo":"L1"}')

n = sr.plan_set_stop_sub(share, stop_id, 'u', '')
cur.execute('SELECT [明細JSON] FROM [作業予定] WHERE [予定ID]=?', [stop_id])
rec('設備停止の行は「内訳なし」へ戻せる', n == 1 and (cur.fetchone()[0] or '') == '')

ok, why = refused(lambda: sr.plan_set_stop_sub(share, 999999, 'u', ''))
rec('無い予定は断る', ok and '予定が見つかりません' in why, why)

bad = sum(1 for _n, ok in R if not ok)
print(f'\n{len(R) - bad} PASS / {bad} FAIL')
sys.exit(1 if bad else 0)
