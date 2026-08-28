#!/usr/bin/env python3
"""test_colscope.py: 列の見せ方を「みんなと同じ／自分だけ」で選ぶ（§9.259）。

============================================================
なぜ要るか
------------------------------------------------------------
利用者の指示「列の表示の部分については、こだわりが強い人もいるので、
表示する一覧表毎に共通のものを使うか、個別ID単位のものを使うか選べるように」。

列レイアウトマスタは今まで全員で1つだった。こだわりのある人が並びを直すと
**全員の見え方が変わる**ので、直したい人も直せない。かといって全部を個人の
ものにすると、決めた並びを配れなくなる。**一覧ごと・人ごとに選べる**のが答え。

ここで固定するのは次の7つ。
 1. 既定は共通。今までの行はそのまま共通の設定として効き続ける
 2. 個人にすると、いま見えている共通の設定が写る（白紙から始めない）
 3. 個人の設定を変えても共通は1バイトも変わらない／その逆も同じ
 4. 他の人は共通のまま（自分の好みが他人に当たらない）
 5. 共通へ戻しても個人の行は消えない（また個人へ戻せば続きから）
 6. 利用者IDが分からなければ必ず共通（IDを名乗れない端末どうしが
    同じ「個人設定」を共有してしまわないように）
 7. 持ち出し(§9.178)は共通ぶんだけ（誰かの好みが全員に配られない）
============================================================
"""
import pathlib, shutil, sqlite3, sys, tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend.db_access import connect  # noqa: E402
from backend.repositories import master_repo as m  # noqa: E402

R = []
def rec(name, ok, detail=''):
    R.append((name, ok, detail))
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + detail) if detail else ''))


T = 'list:X:仕掛'
tmp = pathlib.Path(tempfile.mkdtemp(prefix='wl-colscope-'))
try:
    db = tmp / 'master.sqlite3'
    with connect(db, False) as c:
        m.ensure_column_layout_table(c)
        # 共通の設定（管理者が全員のために決めた並び）
        m.set_column_layout(c, T, ['A', 'B', 'C'], {'A': 100}, 'admin', hidden=['C'])

        # ---- 1. 既定は共通 ---------------------------------------------
        rec('既定では誰でも共通の設定を見る',
            m.column_layout_owner(c, T, 'satoshi') == '' and m.column_layout_owner(c, T, 'taro') == '',
            repr(m.column_layout_owner(c, T, 'satoshi')))
        rec('個人へ切り替える前は個人設定を持たない',
            m.column_layout_is_personal(c, T, 'satoshi') is False)

        # ---- 2. 個人にすると、いまの見え方が写る ------------------------
        m.column_layout_scope_set(c, T, 'satoshi', True)
        own = m.column_layout_owner(c, T, 'satoshi')
        rec('個人へ切り替えると持ち主が自分になる', own == 'satoshi', repr(own))
        mine = m.column_layout_for(c, T, own)
        rec('切り替えた時点では共通と同じ見え方（白紙から始めない）',
            mine['order'] == ['A', 'B', 'C'] and mine['widths'] == {'A': 100}
            and mine['hidden'] == ['C'], str(mine['order']) + str(mine['widths']))

        # ---- 3. 個人を変えても共通は無傷 --------------------------------
        # まず個人だけ「隠す列」を共通と**違う値**にしておく。こうしないと、
        # 次の部分保存で残す値を共通から取る欠陥を見分けられない
        # （どちらから取っても同じ答えになってしまう）。
        m.set_column_layout(c, T, ['A', 'B', 'C'], {'A': 100}, 'satoshi',
                            owner=own, hidden=['A'], fields={'hidden'})
        rec('個人の隠す列だけを変えられる',
            m.column_layout_for(c, T, own)['hidden'] == ['A']
            and m.column_layout_for(c, T, '')['hidden'] == ['C'],
            str(m.column_layout_for(c, T, own)['hidden']) + ' / '
            + str(m.column_layout_for(c, T, '')['hidden']))
        # 並びと幅だけを送る部分保存。触っていない[hidden]は**個人の値**が残る。
        m.set_column_layout(c, T, ['C', 'B', 'A'], {'C': 300}, 'satoshi',
                            owner=own, fields={'order', 'widths'})
        mine = m.column_layout_for(c, T, own)
        common = m.column_layout_for(c, T, '')
        rec('個人の並びだけが変わる', mine['order'] == ['C', 'B', 'A'], str(mine['order']))
        rec('共通の並びは変わらない', common['order'] == ['A', 'B', 'C'], str(common['order']))
        rec('共通の幅も変わらない', common['widths'] == {'A': 100}, str(common['widths']))
        rec('共通の非表示も変わらない', common['hidden'] == ['C'], str(common['hidden']))
        # 触っていない項目は**同じ持ち主の行**から残す（共通で塗り替えない）。
        # 共通から取ると ['C'] になるので、ここで初めて見分けが付く。
        rec('個人の触っていない設定は個人の値が残る（共通で塗り替えない）',
            mine['hidden'] == ['A'], str(mine['hidden']))

        # 逆向き: 共通を変えても個人は無傷
        m.set_column_layout(c, T, ['B', 'A', 'C'], {}, 'admin', fields={'order'})
        rec('共通を変えても個人は変わらない',
            m.column_layout_for(c, T, own)['order'] == ['C', 'B', 'A'],
            str(m.column_layout_for(c, T, own)['order']))

        # ---- 4. 他の人は共通のまま --------------------------------------
        rec('他の人の持ち主は共通のまま', m.column_layout_owner(c, T, 'taro') == '')
        rec('他の人には共通の並びが見える',
            m.column_layout_for(c, T, m.column_layout_owner(c, T, 'taro'))['order'] == ['B', 'A', 'C'])

        # ---- 5. 共通へ戻しても個人の行は消えない ------------------------
        m.column_layout_scope_set(c, T, 'satoshi', False)
        rec('共通へ戻すと持ち主が共通になる', m.column_layout_owner(c, T, 'satoshi') == '')
        rec('個人の行は消えていない',
            m.column_layout_for(c, T, 'satoshi')['order'] == ['C', 'B', 'A'],
            str(m.column_layout_for(c, T, 'satoshi')['order']))
        rec('共通へ戻すと個人設定の一覧から外れる',
            m.column_layout_personal_targets(c, 'satoshi') == [],
            str(m.column_layout_personal_targets(c, 'satoshi')))
        m.column_layout_scope_set(c, T, 'satoshi', True)
        rec('もう一度個人にすると続きから使える',
            m.column_layout_for(c, T, m.column_layout_owner(c, T, 'satoshi'))['order'] == ['C', 'B', 'A'])
        rec('個人設定を使っている一覧を数えられる',
            m.column_layout_personal_targets(c, 'satoshi') == [T],
            str(m.column_layout_personal_targets(c, 'satoshi')))

        # ---- 6. 利用者IDが空なら必ず共通 --------------------------------
        rec('利用者IDが空なら持ち主は共通', m.column_layout_owner(c, T, '') == '')
        rec('利用者IDが空では個人へ切り替えられない',
            m.column_layout_scope_set(c, T, '', True) is False)
        rec('空のIDで切り替えを試しても共通のまま',
            m.column_layout_owner(c, T, '') == '' and
            m.column_layout_for(c, T, '')['order'] == ['B', 'A', 'C'])

        # ---- 7. 持ち出しは共通ぶんだけ ----------------------------------
        m.set_column_layout(c, T + ':personal-only', ['Z'], {}, 'satoshi', owner='satoshi')
        tg = m.column_layout_targets(c)
        rec('持ち出しの対象一覧に個人設定だけの対象は出ない',
            T in tg and (T + ':personal-only') not in tg, str(tg))

    # ---- 8. 古いDBからの移行 -------------------------------------------
    # 所有者ID の無い、鍵が(対象,列名)だけの表を作って開く。
    old = tmp / 'old.sqlite3'
    oc = sqlite3.connect(str(old))
    oc.execute('CREATE TABLE [列レイアウトマスタ] ([ID] INTEGER PRIMARY KEY AUTOINCREMENT, '
               '[対象] TEXT, [列名] TEXT, [表示名] TEXT, [表示順] INTEGER, [幅] INTEGER, [表示] INTEGER, '
               '[書式種別] TEXT, [書式パターン] TEXT, [小数桁] INTEGER, [桁区切り] INTEGER, '
               '[単位前] TEXT, [単位後] TEXT, [読み替えルール] TEXT, '
               '[登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
    oc.execute('CREATE UNIQUE INDEX [UX_列レイアウトマスタ] ON [列レイアウトマスタ] ([対象],[列名])')
    oc.execute("INSERT INTO [列レイアウトマスタ] ([対象],[列名],[表示順],[幅]) VALUES ('list:Y:旧','P',1,80)")
    oc.commit(); oc.close()
    with connect(old, False) as c:
        m.ensure_column_layout_table(c)
        got = m.column_layout_for(c, 'list:Y:旧')
        rec('古い行はそのまま共通の設定として読める',
            got['order'] == ['P'] and got['widths'] == {'P': 80}, str(got['order']))
        idx = {r[1] for r in c.cursor().execute('PRAGMA index_list([列レイアウトマスタ])')}
        rec('鍵が(対象,列名,所有者ID)へ張り直されている',
            'UX_列レイアウトマスタ_所有者' in idx and 'UX_列レイアウトマスタ' not in idx, str(idx))
        # 張り直しが効いていれば、同じ列の個人設定を足せる
        m.column_layout_scope_set(c, 'list:Y:旧', 'satoshi', True)
        m.set_column_layout(c, 'list:Y:旧', ['P'], {'P': 400}, 'satoshi', owner='satoshi',
                            fields={'order', 'widths'})
        rec('同じ列の個人設定を足せる（鍵が張り直されている証拠）',
            m.column_layout_for(c, 'list:Y:旧', 'satoshi')['widths'] == {'P': 400}
            and m.column_layout_for(c, 'list:Y:旧', '')['widths'] == {'P': 80},
            str(m.column_layout_for(c, 'list:Y:旧', 'satoshi')['widths']))
        # 所有者IDにNULLが残っていないこと（NULL同士は一意索引で「違う」と見られる）
        n = c.cursor().execute('SELECT COUNT(*) FROM [列レイアウトマスタ] WHERE [所有者ID] IS NULL').fetchone()[0]
        rec('所有者IDにNULLが残らない', int(n) == 0, f'{n}件')
    # ---- 9. 紙の割り付けには個人設定を出さない -------------------------
    # 同じ名前の紙を2人が刷って中身が違う、を作らない。**印の書き忘れは
    # 画面を開かないと気づけない**ので、ここで機械的に見る。
    src = (ROOT / 'static' / 'js' / 'opsheet-print.js').read_text(encoding='utf-8')
    rec('操業データ表(紙)の口は personalScope:false を宣言している',
        'personalScope:false' in src.replace(' ', ''))
    # もう片側——表示する一覧の口は宣言しない（＝既定で切り替えられる）。
    for f in ('list-columns.js', 'records-store.js', 'schedule-view.js', 'actuals-view.js'):
        t = (ROOT / 'static' / 'js' / f).read_text(encoding='utf-8').replace(' ', '')
        rec(f'{f} は個人設定を塞いでいない', 'personalScope:false' not in t)
finally:
    shutil.rmtree(tmp, ignore_errors=True)

ng = [x for x in R if not x[1]]
print('\n=== SUMMARY ===')
print(f'{len(R)-len(ng)}/{len(R)} passed')
for n, _, d in ng:
    print(' -', n, d)
sys.exit(1 if ng else 0)
