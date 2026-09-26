#!/usr/bin/env python3
"""test_roleperm.py: 権限区分「設備作業者」とマスタ編集の段（§9.322）。

============================================================
なぜ要るか
------------------------------------------------------------
利用者の指示は4つ。

 A. 権限区分に**設備作業者**を足す。測定の実績登録はできるが、マスタ類は
    表示せず触れない。ただし**測定画面からの間接登録は許す**。
 B. **マスタ編集**（非表示／閲覧のみ／部分的編集可／編集可）を足す。
 C. **権限区分以上の権限は付与できない**（上限＝キャップ）。
 D. 区分の変更は**より上位の人から**だけ。**自分の区分は自分で触れない**。

ここで固定するのは次の9つ。

 1. 区分は4つで、**上下関係と上限を答えるのは`master_repo`の1箇所**
 2. 保存値が上限を超えていても、**効くのは上限まで**（区分を下げたら段も下がる）
 3. マスタ編集の段は「開く／現場のマスタへ書く／管理のマスタへ書く」を言い分ける
 4. **画面の見せ方（列・絞り込み・並べ替え）は段の対象外**——閉じると
    閲覧のみの端末で列幅ひとつ直せなくなる
 5. **測定画面からの間接登録だけは段を素通りする**（利用者の指示）
 6. 網はBlueprintごと（＝新しいマスタを足しても**黙って穴が空かない**）
 7. 区分の変更は上位からだけ／**自分の行は触れない**／管理者が居ないうちは通す
 8. **消すことも区分の変更**——自分の行を消して制限を外す抜け道を塞ぐ
 9. ルートが実際にこの判定を通っている（**判定関数だけを見る網は素通りする**）
10. **表示列の編集**（§9.512・変更不可／自分の分だけ／編集可）。既定は編集可、
    段はマスタ編集と別の軸、帳票の紙（`report:`）には掛けない、ルートが実際に断る
============================================================
"""
import pathlib, sqlite3, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import apppath  # noqa: F401 `program/` を探索先へ（§9.404）
import app as flask_app                                    # noqa: E402
from backend import access_mode as am, db_access           # noqa: E402
from backend.repositories import master_repo as mr         # noqa: E402

R = []
def rec(name, ok, detail=''):
    R.append((name, ok, detail))
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + detail) if detail else ''))

client = flask_app.app.test_client()
D, M, U, O = mr.ROLE_DEVELOPER, mr.ROLE_MAINTAINER, mr.ROLE_USER, mr.ROLE_OPERATOR
HIDE, VIEW, PART, FULL = (mr.MASTER_EDIT_HIDDEN, mr.MASTER_EDIT_VIEW,
                          mr.MASTER_EDIT_PARTIAL, mr.MASTER_EDIT_FULL)
PREFIX = 'RT_ROLE_'
_orig = (am.current_login_id, am.current_pc_name, am._permission_flags, am._mode)


def purge():
    """検証で作った行を**物理的に**消す（削除APIは論理削除・§9.121）。

    マスタDBはランナーのフィクスチャ差し替えの対象外で毎回同じものを使うので、
    残すと次の実行の`has_admin_role_row()`が変わって**判定そのものがずれる**。"""
    try:
        conn = sqlite3.connect(db_access.DBS['MASTER']['path'])
        conn.execute("DELETE FROM [アクセス権限マスタ] WHERE [ログインID] LIKE ?", (PREFIX + '%',))
        conn.commit(); conn.close()
    except Exception:
        pass


def actor(login, pc='PC-RT'):
    am.current_login_id = lambda: login
    am.current_pc_name = lambda: pc


def rows():
    r = client.get('/api/access-permission-master').get_json() or {}
    return {x['loginId']: x for x in (r.get('items') or [])}, r


def post(url, body):
    return client.post(url, json=dict(body, user_id='test'))


try:
    purge()
    am._mode = 'edit'

    # ==== 1. 区分の上下と上限（A・C） ====================================
    rec('① 区分は4つで、設備作業者がいちばん下',
        mr.ROLES == (D, M, U, O) and mr.role_rank(O) < mr.role_rank(U) < mr.role_rank(M) < mr.role_rank(D),
        str(mr.ROLES))
    rec('① 知らない綴り・空欄は一般ユーザー',
        mr.normalize_role('') == U and mr.normalize_role('工長') == U)
    rec('① 設備作業者の上限は「非表示」（マスタ類は出さない）',
        mr.master_edit_cap(O) == HIDE and mr.master_edit_options(O) == [HIDE],
        f'{mr.master_edit_cap(O)} / {mr.master_edit_options(O)}')
    rec('① 残る3区分の上限は「編集可」（触っていない端末の見え方を変えない）',
        all(mr.master_edit_cap(r) == FULL for r in (D, M, U)))
    rec('② 保存値が上限を超えても効くのは上限まで',
        mr.master_edit_effective(O, FULL) == HIDE and mr.master_edit_effective(U, PART) == PART,
        f'{mr.master_edit_effective(O, FULL)}')
    rec('② 空欄の保存値は「編集可」（登録の無い端末と同じ）',
        mr.master_edit_effective(U, '') == FULL and mr.MASTER_EDIT_DEFAULT == FULL)

    # ==== 2. 段が何を許すか（B） ========================================
    want = {HIDE: (False, False, False), VIEW: (True, False, False),
            PART: (True, True, False), FULL: (True, True, True)}
    got = {lv: (mr.master_edit_can(lv, 'open'), mr.master_edit_can(lv, 'write', 'field'),
                mr.master_edit_can(lv, 'write', 'admin')) for lv in mr.MASTER_EDIT_LEVELS}
    rec('③ 4段が「開く／現場へ書く／管理へ書く」を言い分ける', got == want, str(got))

    # ==== 3. 書込ガードが見る範囲（B・6） ================================
    ok_field, _ = mr.master_write_check(U, PART, 'masters', 'masters.operation_item_register')
    ng_admin, why = mr.master_write_check(U, PART, 'masters', 'masters.access_permission_master_update')
    rec('③ 部分的編集可は現場のマスタだけ書ける', ok_field and not ng_admin, why[:40])
    rec('③ 共通設定・データ接続・掃除・生データは管理のマスタ',
        all(mr.master_write_scope(bp, bp + '.x') == 'admin'
            for bp in ('path_config', 'master_tables', 'cleanup', 'rne')))
    exempt = ['masters.column_layout_master_save', 'masters.display_rule_master_save',
              'masters.filter_preset_register', 'masters.sort_preset_register',
              'masters.list_view_master_save', 'masters.schedule_content_master_save']
    rec('④ 画面の見せ方は段の対象外（閲覧のみでも列は直せる）',
        all(mr.master_write_check(U, VIEW, 'masters', e)[0] for e in exempt))
    rec('⑤ 測定画面からの間接登録だけは段を素通りする',
        mr.master_write_check(O, HIDE, 'masters', 'masters.operation_choice_register')[0]
        and not mr.master_write_check(O, HIDE, 'masters', 'masters.operation_choice_delete')[0])
    rec('⑥ 網はBlueprintごと（知らないマスタも既定で塞がる）',
        not mr.master_write_check(U, VIEW, 'masters', 'masters.this_endpoint_does_not_exist')[0])
    rec('⑥ マスタ以外のBlueprintには掛からない（測定・作業予定）',
        mr.master_write_check(O, HIDE, 'measurement', 'measurement.backup')[0]
        and mr.master_write_check(O, HIDE, 'schedule', 'schedule.plan_add')[0])
    rec('① 設備作業者でも測定画面からの間接登録は許される',
        mr.role_can(O, 'choice:inline-add'))
    rec('① 設備作業者には接続状況を出さない',
        not mr.role_can(O, 'presence:view') and all(mr.role_can(r, 'presence:view') for r in (D, M, U)))

    # ==== 4. 上限を超える付与は断る（C） ==================================
    ok, why = mr.master_edit_check(O, FULL)
    rec('⑦ 設備作業者に「編集可」は与えられない（理由を書く）',
        (not ok) and '上限' in why, why[:50])
    rec('⑦ 上限までなら通る', mr.master_edit_check(O, HIDE)[0] and mr.master_edit_check(U, FULL)[0])

    # ==== 5. 誰が区分を変えられるか（D） ==================================
    rec('⑦ 与えられるのは自分より下位だけ（同格は不可）',
        mr.role_can(U, 'role:grant', O) and not mr.role_can(U, 'role:grant', U)
        and not mr.role_can(M, 'role:grant', M) and mr.role_can(M, 'role:grant', U))
    rec('⑦ 開発者だけは制限なし（開発者の行を誰も直せない行き止まりを作らない）',
        mr.role_can(D, 'role:grant', D))
    rec('⑦ 設備作業者は誰の区分も変えられない',
        not any(mr.role_can(O, 'role:grant', r) for r in mr.ROLES))

    # ==== 6. 「最初の1人」の道（D） ======================================
    # **空のマスタで見ること**——本番のマスタには既に開発者が居ることがあり、
    # そこで見ても「管理者が居ないうちは通す」の道を一度も通らない。
    import tempfile
    tdb = pathlib.Path(tempfile.mkdtemp(prefix='wl-roleperm-')) / 'm.sqlite3'
    with db_access.connect(tdb, False) as tc:
        mr.ensure_access_permission_table(tc)
        rec('⑦ 管理者が1人も居なければ、最初の開発者を作れる',
            mr.role_change_check(tc, 'nobody', 'PC-X', U, D, row_id=None,
                                 row_login='someone', row_pc='PC-Y')[0]
            and not mr.has_admin_role_row(tc))
        tc.execute("INSERT INTO [アクセス権限マスタ] ([ログインID],[PC名],[編集可否],[有効],[権限区分]) VALUES ('boss','PC-BOSS',1,-1,?)", [D])
        tc.commit()
        ok, why = mr.role_change_check(tc, 'nobody', 'PC-X', U, D, row_id=None,
                                       row_login='someone', row_pc='PC-Y')
        rec('⑦ 管理者が1人でも居れば、その道は閉じる',
            mr.has_admin_role_row(tc) and not ok, why[:40])

    # ==== 7. ルートが実際にこの判定を通っているか（9） ====================
    # 区分の持ち主は**行で決まる**ので、確かめる側も行を用意する。
    # **ルートを通さずSQLで置く**——ルートで作ろうとすると、まさにいま
    # 確かめたい門に自分で引っかかる。
    conn = sqlite3.connect(db_access.DBS['MASTER']['path'])
    for login, pc, role in ((PREFIX + '管理', 'PC-ADMIN', D), (PREFIX + '保守', 'PC-MNT', M),
                            (PREFIX + '一般', 'PC-GEN', U)):
        conn.execute("INSERT INTO [アクセス権限マスタ] ([ログインID],[PC名],[編集可否],[有効],[権限区分],[マスタ編集]) VALUES (?,?,1,-1,?,?)",
                     (login, pc, role, FULL))
    conn.commit(); conn.close()

    _, meta = rows()
    rec('② 上限つきの候補はサーバーが答える（画面へ写さない）',
        (meta.get('masterEditByRole') or {}).get(O) == [HIDE]
        and len((meta.get('masterEditByRole') or {}).get(U) or []) == 4,
        str(meta.get('masterEditByRole'))[:80])

    actor(PREFIX + '保守', 'PC-MNT')
    r = post('/api/access-permission-master',
             {'loginId': PREFIX + 'C', 'pcName': 'PC-C', 'canEdit': '編集可', 'role': O,
              'masterEdit': HIDE})
    rec('⑨ メンテナンス者は設備作業者を作れる（自分より下位）', r.status_code == 200,
        f'{r.status_code} {str(r.get_json())[:70]}')
    r = post('/api/access-permission-master',
             {'loginId': PREFIX + 'B', 'pcName': 'PC-B', 'canEdit': '編集可', 'role': D})
    rec('⑨ メンテナンス者は開発者を作れない（ルートが断る）',
        r.status_code == 403 and '与えられません' in str((r.get_json() or {}).get('error')),
        f'{r.status_code} {str(r.get_json())[:80]}')
    r = post('/api/access-permission-master',
             {'loginId': PREFIX + 'D', 'pcName': 'PC-D', 'canEdit': '編集可', 'role': O,
              'masterEdit': FULL})
    rec('⑨ 上限を超えるマスタ編集はルートが断る',
        r.status_code == 403 and '上限' in str((r.get_json() or {}).get('error')),
        f'{r.status_code} {str(r.get_json())[:80]}')
    r = post('/api/access-permission-master',
             {'loginId': PREFIX + 'A', 'pcName': 'PC-A', 'canEdit': '編集可', 'role': U})
    rec('⑨ 区分を変えない登録は今までどおり通る（既定の一般ユーザー）',
        r.status_code == 200, f'{r.status_code} {str(r.get_json())[:70]}')

    items, _ = rows()
    rec('② 一覧は保存値と効いている段の両方を返す',
        items.get(PREFIX + 'C', {}).get('masterEdit') == HIDE
        and items.get(PREFIX + 'C', {}).get('masterEditEffective') == HIDE,
        str(items.get(PREFIX + 'C'))[:90])
    cid = items[PREFIX + 'C']['id']

    # 一般ユーザーは設備作業者を引き上げられない（自分と同格へは与えられない）
    actor(PREFIX + '一般', 'PC-GEN')
    r = post('/api/access-permission-master/update',
             {'id': cid, 'loginId': PREFIX + 'C', 'pcName': 'PC-C', 'canEdit': '編集可', 'role': U})
    rec('⑨ 一般ユーザーは自分と同格へ引き上げられない',
        r.status_code == 403, f'{r.status_code} {str(r.get_json())[:80]}')

    # 自分の区分は自分で触れない（D）
    # **マスタ編集が通る端末で見ること**——設備作業者の端末で試すと、手前の
    # 「マスタは変更できません」で断られ、**自分の行の門を一度も通らない**
    # （実際にそう書いて素通りした）。ここは一般ユーザー（編集可）の行で見る。
    gid = items[PREFIX + '一般']['id']
    actor(PREFIX + '一般', 'PC-GEN')
    r = post('/api/access-permission-master/update',
             {'id': gid, 'loginId': PREFIX + '一般', 'pcName': 'PC-GEN', 'canEdit': '編集可', 'role': O})
    rec('⑦ 自分の区分は自分では変更できない（降格も含めて）',
        r.status_code == 403 and '自分' in str((r.get_json() or {}).get('error')),
        f'{r.status_code} {str(r.get_json())[:80]}')
    # **消すことも区分の変更**（§9.322）。区分が既定と違う行を自分で消すと
    # 既定（一般ユーザー）へ戻る＝自己昇格になるので、同じ門で断る。
    mid = items[PREFIX + '保守']['id']
    actor(PREFIX + '保守', 'PC-MNT')
    r = post('/api/access-permission-master/delete', {'id': mid})
    rec('⑧ 自分の行を消して区分を既定へ戻すことはできない',
        r.status_code == 403 and '自分' in str((r.get_json() or {}).get('error')),
        f'{r.status_code} {str(r.get_json())[:80]}')
    # 上位からなら消せる（行き止まりにしない）
    actor(PREFIX + '管理', 'PC-ADMIN')
    r = post('/api/access-permission-master/delete', {'id': mid})
    rec('⑧ 上位（開発者）からなら消せる', r.status_code == 200,
        f'{r.status_code} {str(r.get_json())[:80]}')
    actor(PREFIX + '一般', 'PC-GEN')
    # 自分の行でも、区分に触らなければ今までどおり直せる
    r = post('/api/access-permission-master/update',
             {'id': gid, 'loginId': PREFIX + '一般', 'pcName': 'PC-GEN', 'canEdit': '編集可',
              'role': U, 'masterEdit': FULL, 'canSchedule': '可'})
    rec('⑦ 自分の行でも区分に触らない変更は通る', r.status_code == 200,
        f'{r.status_code} {str(r.get_json())[:80]}')

    # 上位の人からなら通る
    actor(PREFIX + '管理', 'PC-ADMIN')
    r = post('/api/access-permission-master/update',
             {'id': cid, 'loginId': PREFIX + 'C', 'pcName': 'PC-C', 'canEdit': '編集可',
              'role': U, 'masterEdit': PART})
    rec('⑦ 上位（開発者）からの変更は通る', r.status_code == 200,
        f'{r.status_code} {str(r.get_json())[:80]}')
    items, _ = rows()
    rec('② 変更後の段が保存されている', items.get(PREFIX + 'C', {}).get('masterEdit') == PART,
        str(items.get(PREFIX + 'C'))[:90])

    # 区分を触らない更新は下位からでも通る（巻き添えにしない）
    actor(PREFIX + '一般', 'PC-GEN')
    r = post('/api/access-permission-master/update',
             {'id': cid, 'loginId': PREFIX + 'C', 'pcName': 'PC-C', 'canEdit': '閲覧のみ',
              'role': U, 'masterEdit': PART})
    rec('⑨ 区分に触らない更新は巻き添えにしない', r.status_code == 200,
        f'{r.status_code} {str(r.get_json())[:80]}')

    # ==== 7. 書込ガードが実際に段を見ているか（9） ========================
    def flags(role, level):
        return dict(canEdit=True, canSchedule=False, canFieldReorder=False,
                    fieldReorderEquipment='', role=role, masterEdit=level,
                    masterEditStored=level, matchedId=None)

    am._permission_flags = lambda: flags(O, FULL)   # 設備作業者＝保存値によらず非表示
    r = post('/api/equipment-master', {'name': PREFIX + 'EQ'})
    rec('⑨ 設備作業者はマスタへ書けない（書込ガードが断る）',
        r.status_code == 403 and 'マスタは変更できません' in str((r.get_json() or {}).get('error')),
        f'{r.status_code} {str(r.get_json())[:80]}')
    r = client.post('/api/column-layout-master',
                    json={'target': 'list:RT:RT', 'widths': {}, 'user_id': 'test'})
    rec('④ 見せ方（列レイアウト）は設備作業者でも保存できる', r.status_code != 403,
        f'{r.status_code} {str(r.get_json())[:70]}')

    am._permission_flags = lambda: flags(U, PART)
    r = post('/api/access-permission-master', {'loginId': PREFIX + 'X', 'pcName': 'PC-X',
                                               'canEdit': '編集可', 'role': U})
    rec('⑨ 部分的編集可は管理のマスタへ書けない',
        r.status_code == 403 and '管理のマスタ' in str((r.get_json() or {}).get('error')),
        f'{r.status_code} {str(r.get_json())[:80]}')

    am._permission_flags = lambda: flags(U, FULL)
    r = post('/api/access-permission-master', {'loginId': PREFIX + 'Y', 'pcName': 'PC-Y',
                                               'canEdit': '編集可', 'role': U})
    rec('⑨ 編集可なら今までどおり通る（触っていない端末を巻き添えにしない）',
        r.status_code == 200, f'{r.status_code} {str(r.get_json())[:70]}')

    # ==== 8. 列が足りない古いマスタでも読める ============================
    with db_access.connect(db_access.DBS['MASTER']['path'], False) as c:
        f = mr.permission_flags(c, PREFIX + 'C', 'PC-C')
    rec('② 効いている段と、どの行が効いているかを返す',
        f['masterEdit'] == PART and f['role'] == U and f['matchedId'] == cid, str(f))

    # ==== 10. 表示列の編集（§9.512） ===================================
    CN, CS, CF = mr.COLUMN_EDIT_NONE, mr.COLUMN_EDIT_SELF, mr.COLUMN_EDIT_FULL
    rec('⑩ 表示列の編集は3段で、既定（空欄・知らない綴り）は編集可',
        mr.COLUMN_EDIT_LEVELS == (CN, CS, CF) and mr.normalize_column_edit('') == CF
        and mr.normalize_column_edit('?') == CF, str(mr.COLUMN_EDIT_LEVELS))
    rec('⑩ 段が許すこと: 変更不可＝何も／自分の分だけ＝自分の分／編集可＝みんなの分も',
        [(mr.column_edit_can(l, 'own'), mr.column_edit_can(l, 'common')) for l in (CN, CS, CF)]
        == [(False, False), (True, False), (True, True)])
    rec('⑩ 帳票の紙（report:）には段を掛けない（同じマスタに住むが表示列ではない）',
        mr.column_edit_check(CN, '', 'report:A')[0] is True
        and mr.column_edit_check(CN, '', 'list:A:B')[0] is False)
    rec('⑩ 登録の無い端末の既定は編集可（今までの見え方を変えない）',
        mr._DEFAULT_PERMISSION_FLAGS['columnEdit'] == CF and am._FALLBACK_FLAGS['columnEdit'] == CF)
    T = 'list:RT:CE'

    def cflags(level):
        return dict(flags(U, FULL), columnEdit=level)
    am._permission_flags = lambda: cflags(CN)
    r = client.post('/api/column-layout-master', json={'target': T, 'widths': {'A': 80}, 'user_id': 'test'})
    rec('⑩ 変更不可の端末は表示列を保存できない（ルートが断り、理由を言う）',
        r.status_code == 403 and '変更不可' in str((r.get_json() or {}).get('error')),
        f'{r.status_code} {str(r.get_json())[:70]}')
    g = client.get('/api/column-layout-master?target=' + T + '&user=test').get_json() or {}
    rec('⑩ 読むときに「何を保存してよいか」を返す（画面は受け取るだけ）',
        g.get('columnEdit') == CN and g.get('canEditOwnColumns') is False, str({k: g.get(k) for k in ('columnEdit', 'canEditOwnColumns', 'canEditCommonColumns')}))
    am._permission_flags = lambda: cflags(CS)
    r = client.post('/api/column-layout-master', json={'target': T, 'widths': {'A': 80}, 'user_id': 'test'})
    rec('⑩ 自分の分だけの端末は、みんなと同じ表示列を保存できない',
        r.status_code == 403 and '自分の分だけ' in str((r.get_json() or {}).get('error')), f'{r.status_code}')
    r1 = client.post('/api/column-layout-master/scope', json={'target': T, 'scope': 'personal', 'user_id': 'test'})
    r2 = client.post('/api/column-layout-master', json={'target': T, 'widths': {'A': 90}, 'user_id': 'test'})
    rec('⑩ 自分の分だけの端末でも、自分だけへ切り替えれば保存できる',
        r1.status_code == 200 and r2.status_code == 200 and (r2.get_json() or {}).get('scope') == 'personal',
        f'{r1.status_code}/{r2.status_code}')
    am._permission_flags = lambda: cflags(CN)
    r = client.post('/api/column-layout-master', json={'target': 'report:RT_CE', 'widths': {'A': 1}, 'user_id': 'test'})
    rec('⑩ 変更不可でも帳票の紙（report:）は保存できる',r.status_code == 200, f'{r.status_code}')
    r = client.post('/api/schedule-column-master', json={'equipment': PREFIX + 'EQ', 'columns': [], 'user_id': 'test'})
    rec('⑩ 作業スケジュールの設備の列（みんなで1つ）も段が掛かる',
        r.status_code == 403, f'{r.status_code}')
    am._permission_flags = lambda: flags(U, VIEW)
    r = client.post('/api/column-layout-master', json={'target': T, 'widths': {'A': 70}, 'user_id': 'test'})
    rec('⑩ マスタ編集が閲覧のみでも、表示列の編集が編集可なら保存できる（別の軸）',
        r.status_code == 200, f'{r.status_code}')

finally:
    try:
        conn = sqlite3.connect(db_access.DBS['MASTER']['path'])
        conn.execute("DELETE FROM [列レイアウトマスタ] WHERE [対象] IN ('list:RT:CE','report:RT_CE')")
        conn.execute("DELETE FROM [列レイアウト個人設定マスタ] WHERE [対象]='list:RT:CE'")
        conn.commit(); conn.close()
    except Exception as e:
        print('後片付けに失敗: ' + str(e))
    purge()
    try:
        conn = sqlite3.connect(db_access.DBS['MASTER']['path'])
        conn.execute("DELETE FROM [設備マスタ] WHERE [設備名] LIKE ?", (PREFIX + '%',))
        conn.execute("DELETE FROM [列レイアウトマスタ] WHERE [対象]='list:RT:RT'")
        conn.commit(); conn.close()
    except Exception:
        pass
    (am.current_login_id, am.current_pc_name, am._permission_flags, am._mode) = _orig

ng = [n for n, ok, _ in R if not ok]
print(f'\n{len(R) - len(ng)}/{len(R)} PASS')
sys.exit(1 if ng else 0)
