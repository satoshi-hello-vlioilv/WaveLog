#!/usr/bin/env python3
"""test_dscap.py: データソースの読み込み先の汎用化と「この設定でできること」（§9.163）。

============================================================
なぜ要るか
------------------------------------------------------------
① **読み込み先の設定が「固定の2件」に縛られていた。**
   パス設定の欄も「いま効いている値」も、**プロセス起動時のスナップショット**
   から作っていたため、
     ・データソースを足した直後はその欄が画面に無く、再起動するまで
       読み込み先を設定すらできない
     ・3件目以降は現在値が空欄のままなので、画面の「保存値≠現在値＝
       再起動待ち」という印が**再起動しても永久に点いたまま**になる
   という形で出ていた。今マスタにある行から作れば両方消える。

② **役割を選んだだけでは、その一覧で何ができるかが決まらない。**
   測定・予定投入・品質結合は、行にロット番号や設備名の列が無ければ画面が
   **黙って機能を出さない**（必須列を決め打ちしない方針の裏返し）。登録した
   本人からは「登録したのにボタンが出ない」としか見えないので、できること／
   できない理由をサーバーが答える。

ここで固定するのは、
 1. 別名解決の定義が1箇所であること（画面の言うことと実際が食い違わない）
 2. 既定の2件の判定が正しいこと（作業＝測定/予定、品質＝結合）
 3. 増やした3件目が**すぐ**パス設定に現れ、未反映だと分かること
 4. できない理由が必ず文章で入ること（「できません」だけにしない）
============================================================
"""
import pathlib, sqlite3, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import app as flask_app                                    # noqa: E402
from backend import db_access, query_join, source_capability  # noqa: E402
from backend.routes import tables as tables_route          # noqa: E402

R = []
def rec(name, ok, detail=''):
    R.append((name, ok, detail))
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + detail) if detail else ''))

client = flask_app.app.test_client()
KEY = 'PROBE_CAP'


def purge():
    """検証で作った行を**物理的に**消す。削除APIは論理削除(有効=0)なので
    行が残り、2回目の実行で「既にあります」になる（test_datasourceと同じ罠）。
    マスタDBはフィクスチャ差し替えの対象外で毎回同じものを使う。"""
    try:
        conn = sqlite3.connect(db_access.DBS['MASTER']['path'])
        conn.execute("DELETE FROM [データソースマスタ] WHERE [キー] LIKE 'PROBE_CAP%'")
        conn.execute("DELETE FROM [パス設定マスタ] WHERE [設定キー] LIKE 'probe_cap%'")
        conn.commit()
        conn.close()
    except Exception:
        pass


purge()
try:
    # ---- 1) 別名解決の定義は1箇所 ----
    # 結合の実処理は backend/query_join.py へ移した（§9.193）。**別名解決の
    # 定義が1箇所であること**は変わらない——2つ持つと「結合できると書いて
    # あるのに結合されない」という食い違いになる。
    rec('列名の別名解決は1箇所（クエリ結合も同じ関数を借りる）',
        query_join.find_column is source_capability.find_column
        and query_join.norm_name is source_capability.norm_name)
    rec('一覧APIの列の一意化もクエリ結合の1箇所を借りる',
        tables_route._unique_columns is query_join.unique_columns)
    rec('別名解決は全角/半角のゆれを吸収する',
        source_capability.find_column(['ﾛｯﾄ番号'], source_capability.FEATURE_ALIASES['lotNo']) == 'ﾛｯﾄ番号'
        and source_capability.find_column(['ロット番号'], source_capability.FEATURE_ALIASES['lotNo']) == 'ロット番号')
    rec('読み込み先の上書きキーはデータソースのキーから機械的に作る',
        db_access.source_override_key('FOO_BAR') == 'foo_bar_path'
        and db_access.source_override_key('SIKALOTNOW') == 'sikalotnow_path')

    # ---- 2) 既定の2件の判定 ----
    d = client.get('/api/data-source-master').get_json() or {}
    items = {x['key']: x for x in d.get('items', [])}
    rec('データソース一覧に「できること」が付いてくる',
        all('capability' in x for x in d.get('items', [])),
        '/'.join(items))

    work = items.get(db_access.WORK_DB_KEY or '')
    qual = items.get(db_access.QUALITY_DB_KEY or '')
    if work:
        f = work['capability']['features']
        rec('作業のデータソース: 一覧として見られる', f['list']['ok'] is True, f['list']['note'])
        rec('作業のデータソース: 測定を開ける', f['measure']['ok'] is True, f['measure']['note'])
        rec('作業のデータソース: スケジュールへ投入できる', f['plan']['ok'] is True, f['plan']['note'])
        rec('作業のデータソース: 品質としては結合しない（役割は1件だけ）',
            f['quality']['ok'] is False, f['quality']['note'])
        rec('できない理由は必ず文章で入る', bool(f['quality']['note'].strip()))
        rec('どの列をロット番号として使うかを名指しで書く',
            '「' in f['measure']['note'], f['measure']['note'])
    else:
        rec('作業のデータソースがある', False, 'WORK_DB_KEY が未設定')

    if qual:
        f = qual['capability']['features']
        rec('品質のデータソース: 結合できる', f['quality']['ok'] is True, f['quality']['note'])
        rec('品質のデータソース: 測定は開けない（理由付き）',
            f['measure']['ok'] is False and bool(f['measure']['note'].strip()),
            f['measure']['note'])
    else:
        rec('品質のデータソースがある', False, 'QUALITY_DB_KEY が未設定')

    # ---- 3) 増やした3件目がすぐパス設定に現れる ----
    before = client.get('/api/path-config-master').get_json() or {}
    n0 = len(before.get('sources', []))
    r = client.post('/api/data-source-master', json={
        'key': KEY, 'label': '検証ソースCAP', 'rne': '', 'table': '仕掛',
        'output': 'probe_cap.sqlite3', 'share': 'PROBE_CAP.sqlite3',
        'preferred': '仕掛', 'order': 950, 'purpose': 'その他', 'user_id': 'test'})
    rec('データソースを増やせる', r.status_code == 200 and (r.get_json() or {}).get('ok'),
        str(r.get_json())[:80])

    after = client.get('/api/path-config-master').get_json() or {}
    srcs = {s['key']: s for s in after.get('sources', [])}
    rec('増やした直後に、パス設定へ読み込み先の欄が現れる（再起動を待たない）',
        KEY in srcs, f"{n0}→{len(after.get('sources', []))}件")
    new = srcs.get(KEY) or {}
    rec('まだこの端末が読んでいないことを loaded で示す', new.get('loaded') is False,
        str(new.get('loaded')))
    rec('再起動したらどこを読むかを先に出す（打ち間違いに気づける）',
        new.get('planned', '').endswith('PROBE_CAP.sqlite3'), new.get('planned', ''))
    rec('「いま効いている値」にも増やしたぶんの行がある（3件目が永久に再起動待ちにならない）',
        new.get('valueKey') in (after.get('active') or {}),
        '/'.join(k for k in (after.get('active') or {}) if k.endswith('_path')))

    # 読み込み先の個別上書きが、増やしたばかりのデータソースでも保存できること
    r = client.post('/api/path-config-master', json={
        new['valueKey']: 'C:/probe/cap.sqlite3', 'user_id': 'test'})
    rec('増やしたばかりのデータソースの読み込み先を保存できる', r.status_code == 200,
        str(r.get_json())[:80])
    saved = client.get('/api/path-config-master').get_json() or {}
    rec('保存した読み込み先が読み出せる',
        (saved.get('values') or {}).get(new['valueKey']) == 'C:/probe/cap.sqlite3',
        str((saved.get('values') or {}).get(new['valueKey'])))

    # ---- 4) まだ読み込んでいないデータソースの「できること」 ----
    d2 = client.get('/api/data-source-master').get_json() or {}
    probe = next((x for x in d2.get('items', []) if x['key'] == KEY), None)
    cap = (probe or {}).get('capability') or {}
    rec('未反映のデータソースは、その旨を理由として返す',
        bool(cap.get('error')) and all(not v['ok'] and v['note'].strip()
                                       for v in (cap.get('features') or {}).values()),
        cap.get('error', '')[:60])

    # ---- 5) 保存が、送っていない設定を巻き添えにしない ----
    # **固定キーの側も同じ**(§9.192)。以前は`schedule_share_path`等を
    # 「送られてこなければ空文字」で必ず書いており、一部だけを送るこの
    # 保存が**共有スケジュールの置き場を消していた**（以降その端末では
    # スケジュール機能が「未設定」になる。検証の通しで実際に踏んだ）。
    keep = (saved.get('values') or {}).get('sikalotnow_path', '')
    keep_share = (saved.get('values') or {}).get('schedule_share_path', '')
    client.post('/api/path-config-master', json={'user_id': 'test'})   # 何も送らない保存
    after2 = client.get('/api/path-config-master').get_json() or {}
    rec('データソースの読み込み先を送らない保存で、既存の設定が消えない',
        (after2.get('values') or {}).get('sikalotnow_path', '') == keep,
        f"{keep!r} → {(after2.get('values') or {}).get('sikalotnow_path','')!r}")
    rec('共有スケジュールの置き場も、送らない保存で消えない',
        (after2.get('values') or {}).get('schedule_share_path', '') == keep_share,
        f"{keep_share!r} → {(after2.get('values') or {}).get('schedule_share_path','')!r}")
finally:
    purge()

ok = sum(1 for _, o, _ in R if o)
print(f"\n== {ok}/{len(R)} PASS ==")
sys.exit(0 if ok == len(R) else 1)
