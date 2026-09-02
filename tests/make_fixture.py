# -*- coding: utf-8 -*-
"""tests/make_fixture.py: 検証用フィクスチャを既知の状態へ作り直す。

    python3 tests/make_fixture.py          # 作業予定を種データへ戻す
    python3 tests/make_fixture.py --show   # 今の中身を表示するだけ

なぜ要るか
----------
テストは共有スケジュールDB(db/test_fixture/share/schedule.sqlite3)へ
作業予定を追加する。後始末を入れる前の実行が残した分が積み上がり、
実測で1003件まで増えていた。増えると:

  * 予定の描画・実績突合が遅くなり、固定待ちのテストが時間切れで落ちる
    (実際にtest_cols/test_split_layout/test_histdelが落ちた)
  * 「先頭の予定行」を見るテストが、どの行を掴むか実行ごとに変わる
    (test_content_applyが落ちた)

安全網が実行のたびに変わるのでは安全網にならないので、既知の状態へ
戻せるようにする。仕掛(SIKALOTNOW)・品質(SIKALOTDEF)は読み取り専用で
テストが書き換えないため作り直さない。
"""
from __future__ import annotations
import os
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# 既定はgitが持つ原本。ランナーは原本を汚さないよう作業用コピーを作り、
# その置き場所を WAVELOG_FIXTURE_SHARE で渡してくる。
SHARE = Path(os.environ.get('WAVELOG_FIXTURE_SHARE')
             or ROOT / 'db' / 'test_fixture' / 'share' / 'schedule.sqlite3')
NOW = ROOT / 'db' / 'test_fixture' / 'sikalotnow_test.sqlite3'

# 種データの量。テストが必要とする最低限より少し多めに置く:
#  - 並べ替え・一括追加・分割表示の各テストが複数行を前提にする
#  - 作業可否フラグの検証で「可」と「不可」の両方が要る
SEED_A = 40   # テスト設備A(主役。ほとんどのテストがこの設備を見る)
SEED_B = 6    # テスト設備B(俯瞰ボードで2設備以上あることの確認用)


def show(conn: sqlite3.Connection) -> None:
    for (name,) in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"):
        n = conn.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0]
        print(f'  {name}: {n}件')
    print('  -- 作業予定の設備別 --')
    for eq, n in conn.execute(
            'SELECT 設備名,COUNT(*) FROM 作業予定 GROUP BY 設備名 ORDER BY 設備名'):
        print(f'     {eq}: {n}')


def lots(limit: int, offset: int = 0):
    """仕掛フィクスチャから、残仕掛設備ｺｰｽ付きのロットを順に取る。
    実データと同じ形(detailに残仕掛設備ｺｰｽを持つ)で予定を作るため。"""
    with sqlite3.connect(f'file:{NOW}?mode=ro', uri=True) as c:
        c.row_factory = sqlite3.Row
        return [dict(r) for r in c.execute(
            'SELECT * FROM 仕掛 ORDER BY ロット番号 LIMIT ? OFFSET ?', [limit, offset])]


def seed(conn: sqlite3.Connection) -> None:
    import json
    conn.execute('DELETE FROM 作業予定')
    conn.execute("DELETE FROM sqlite_sequence WHERE name='作業予定'")
    order = 0
    for equipment, count, offset in (('テスト設備A', SEED_A, 0),
                                     ('テスト設備B', SEED_B, SEED_A)):
        for row in lots(count, offset):
            order += 1
            # 画面から投入したときと同じ形にする(§9.67: 残仕掛設備ｺｰｽを
            # 予定側に持たせ、作業可否フラグを往復ゼロで判定できるように)。
            detail = {
                'lotNo': row['ロット番号'], 'castingNo': row['鋳造番号'],
                'mfgMaterial': row['製造材質'], 'mfgTemper': row['製造調質'],
                'purposeName': row['用途名'],
                'residualCourse': row['残仕掛設備ｺｰｽ'],
                '残仕掛設備ｺｰｽ': row['残仕掛設備ｺｰｽ'],
            }
            conn.execute(
                'INSERT INTO 作業予定 ([設備名],[表示順],[種別],[ロット番号],[検査番号],'
                '[鋳造番号],[予定名称],[明細JSON],[状態],[有効],[登録者ID],[更新者ID],'
                '[登録日時],[更新日時]) '
                # 状態・有効は schedule_repo.plan_add と同じ値にする。
                # 状態は PLAN_REORDERABLE_STATE('予定')、有効はAccess由来の
                # 真値 -1。ここを外すと行は出るのに「予定」扱いされず、
                # 開始ボタンや並べ替えの検証が静かに落ちる(実際に落ちた)。
                "VALUES (?,?,'作業',?,?,?,'',?,'予定',-1,'fixture','fixture',"
                "datetime('now'),datetime('now'))",
                [equipment, order, row['ロット番号'], row['検査番号'],
                 row['鋳造番号'], json.dumps(detail, ensure_ascii=False)])
    conn.commit()


# ---------------------------------------------------------------------------
# マスタDB(db/master.sqlite3)を既知の状態へ戻す（§9.284）
# ---------------------------------------------------------------------------
# **なぜここでやるか。** 共有スケジュールDBと違い、マスタDBは
# git が持っていない（`.gitignore`で`*.sqlite3`）。テストは全員この1つを
# 共有して書き換えるので、**壊した1本が以降ずっと全部を巻き添えにする**。
# 実測では、通しを何度か回しただけで
#   * データソースの表示順が両方0になり、左メニューの先頭が「品質データ」に
#     なった（`aside [data-db-key]`の先頭を押すテストが全部そちらを開き、
#     「分割」「測定」の列も L9000 の分割ロットも無い一覧を見ていた）
#   * 勤務体系「交替勤務(1,2,3直)」が無効になり、どの設備にも紐づかなくなった
#     （直が引けず、現場日の補正・実績データ表・枠の直の候補が全部落ちた）
#   * 操業データ選択肢の「オペレータ」「スプール」「板厚/板幅測定器」が
#     消えた（旧マスタは§9.255 ③で作り直さないので、二度と戻らない）
# という状態になっていた。**足りない行を戻し、テストが作った屑は片付ける。**
# 触っていない行は消さない（テストが自分で作った行はそのテストのもの）。
MASTER = ROOT / 'db' / 'master.sqlite3'

# 左メニューの並び。`db_access._DEFAULT_DATA_SOURCES`の`order`と同じ値。
# `RNEファイル`が空だと`rne_scheduler.jobs()`が1件も返さず、「今すぐ抽出」が
# できない状態（`canRun=false`）になる。テストが空で上書きしていた。
# **抽出テーブル・既定テーブルは触らない**——フィクスチャのDBが持つ表の名前
# （`仕掛`／`品質データ`）はここでは分からず、書き換えると一覧が開けなくなる。
_SOURCE_FIX = (
    ('SIKALOTNOW', 10, '仕掛', 'SIKALOTNOW.RNE', 'sikalotnow.sqlite3',
     'SIKALOTNOW.sqlite3'),
    ('SIKALOTDEF', 20, '品質', 'SIKALOTDEF.RNE', 'sikalotdef.sqlite3',
     'SIKALOTDEF.sqlite3'),
)
# 3直。`日付補正`は§9.195（跨いだ後の時間帯にだけ当てる）。
_SHIFT_NAME = '交替勤務(1,2,3直)'
_SHIFT_SEGMENTS = (('1直', '07:00', '15:00', 10, None),
                   ('2直', '15:00', '23:00', 20, None),
                   ('3直', '23:00', '07:00', 30, -1))
_SHIFT_EQUIPMENT = ('テスト設備A', 'テスト設備B', 'テスト設備C', 'テスト設備D')
# 旧マスタから移した選択肢（§9.221 ②）。旧マスタはもう作られないので、
# 消えたら戻せるのはここだけ。**件数はテストが数える**（test_msteps）。
_CHOICES = {
    'オペレータ': ['作業者%02d' % i for i in range(1, 30)],
    'スプール': ['大', '中', '小'],
    '板厚測定器': ['マイクロメータ', 'ノギス', '非接触'],
    '板幅測定器': ['ノギス', 'スケール', '非接触'],
}
# テストが作って片付けなかった行。**名前で見分けられるものだけ**片付ける
# （反復のたびに増え、実測で設備131件・勤務体系140件まで育っていた）。
_JUNK_EQUIPMENT = ("設備名 LIKE 'RT%新設備'", "設備名 LIKE 'RT%消える設備'",
                   "設備名 LIKE '回帰_%'")
_JUNK_SHIFT = ("名称 LIKE '回帰_%'", "名称 LIKE '複数設備テスト%'")


def _tables(c) -> set:
    return {r[0] for r in c.execute(
        "SELECT name FROM sqlite_master WHERE type='table'")}


def _builtin_item_groups() -> dict:
    """組み込みの操業データ項目の**群**（組み込みキー → 群名）。

    **`backend`をimportしないこと**（§9.285 の追補）——`_builtin_block_seeds()`
    と同じ理由で、ソースの`BUILTIN_SEEDS`を構文木で読む。種は
    `(組み込みキー, 群, 項目名, 列幅, 必須, 置き場, 群折りたたみ, 表示条件)`で、
    要るのは0・1番目（どちらも素の文字列）。**形が変わったら読み飛ばす**。"""
    import ast
    src_path = ROOT / 'backend' / 'repositories' / 'operation_repo.py'
    try:
        tree = ast.parse(src_path.read_text(encoding='utf-8'))
    except Exception:
        return {}
    out = {}
    for node in tree.body:
        if not isinstance(node, ast.Assign):
            continue
        if not any(getattr(t, 'id', '') == 'BUILTIN_SEEDS' for t in node.targets):
            continue
        if not isinstance(node.value, ast.Tuple):
            continue
        for el in node.value.elts:
            if not isinstance(el, ast.Tuple) or len(el.elts) < 2:
                continue
            try:
                key = ast.literal_eval(el.elts[0])
                grp = ast.literal_eval(el.elts[1])
            except Exception:
                continue
            if isinstance(key, str) and isinstance(grp, str) and key:
                out[key] = grp
    return out


def _builtin_block_seeds() -> dict:
    """既定の帳票ブロックの種（組み込みキー → (`[内容]`, `[内訳列数]`)）。

    **`backend`をimportしないこと**（§9.285 の追補）——`backend.db_access`は
    **import しただけで**`config/local.json`の移行や接続先の解決といった
    処理を走らせる（モジュールの一番下で`_migrate_legacy_path_config()`を
    呼んでいる）。`fix_master()`は**マスタDBへの書き込みトランザクションを
    開いたまま**走るので、そこへ別の接続が割り込むと**検証用の設定が
    中途半端な状態になり、左メニューから仕掛のボタンが消える**（実測:
    `test_maint`が`[data-db-key="SIKALOTNOW"]`を30秒待って落ちた）。

    そこで**ソースの`BUILTIN_SEEDS`を構文木で読む**。種は
    `(組み込みキー, 幅, 行数, 内訳列数, 内容, 種別, 文字)`の並びで、
    ここで要るのは0・3・4番目——どれも素のリテラルなので`ast`で取れる
    （5番目の`AREA_KIND`は名前なので`literal_eval`では読めない。**要る所だけ**
    読むこと）。**形が変わったら黙って読み飛ばす**——間違った位置を読んで
    別の値を書き戻すより、何もしないほうが安全。"""
    import ast
    src_path = ROOT / 'backend' / 'repositories' / 'report_block_repo.py'
    try:
        tree = ast.parse(src_path.read_text(encoding='utf-8'))
    except Exception:
        return {}
    out = {}
    for node in tree.body:
        if not isinstance(node, ast.Assign):
            continue
        if not any(getattr(t, 'id', '') == 'BUILTIN_SEEDS' for t in node.targets):
            continue
        for row in getattr(node.value, 'elts', []):
            elts = getattr(row, 'elts', [])
            if len(elts) != 7:
                continue
            try:
                key = ast.literal_eval(elts[0])
                cols = ast.literal_eval(elts[3])
                content = ast.literal_eval(elts[4])
            except Exception:
                continue
            if isinstance(key, str) and isinstance(cols, int) and isinstance(content, str):
                out[key] = (content, cols)
    return out


def fix_master(quiet: bool = False) -> None:
    """マスタDBの「テストが当てにしている行」を戻す。**冪等**。"""
    if not MASTER.exists():
        return
    note = (lambda *a: None) if quiet else print
    with sqlite3.connect(MASTER) as c:
        have = _tables(c)
        # 1) 左メニューの並び（先頭が「仕掛」であること）
        if 'データソースマスタ' in have:
            for key, order, purpose, rne, out, share in _SOURCE_FIX:
                c.execute('UPDATE [データソースマスタ] SET [表示順]=?,[有効]=-1,'
                          '[一覧表示]=-1,[役割]=?,[RNEファイル]=?,[出力ファイル]=?,'
                          '[共有パス]=?,[読み方]=? WHERE [キー]=?',
                          [order, purpose, rne, out, share, '', key])
        # 2) 設備（テストが主役に使う4つ）と、屑の片付け
        if '設備マスタ' in have:
            for nm in _SHIFT_EQUIPMENT:
                if not c.execute('SELECT 1 FROM [設備マスタ] WHERE [設備名]=?',
                                 [nm]).fetchone():
                    c.execute('INSERT INTO [設備マスタ] ([設備名],[表示順],[有効],'
                              '[登録者ID],[更新者ID],[登録日時],[更新日時]) '
                              "VALUES (?,10,-1,'fixture','fixture',"
                              "datetime('now'),datetime('now'))", [nm])
                else:
                    c.execute('UPDATE [設備マスタ] SET [有効]=-1 WHERE [設備名]=?', [nm])
            for w in _JUNK_EQUIPMENT:
                c.execute('DELETE FROM [設備マスタ] WHERE ' + w)
        # 3) 勤務体系＋勤務区分＋設備の紐づけ
        if {'勤務体系マスタ', '勤務区分マスタ'} <= have:
            for w in _JUNK_SHIFT:
                c.execute('DELETE FROM [勤務区分マスタ] WHERE [勤務体系ID] IN '
                          '(SELECT [勤務体系ID] FROM [勤務体系マスタ] WHERE ' + w + ')')
                if '勤務体系設備マスタ' in have:
                    c.execute('DELETE FROM [勤務体系設備マスタ] WHERE [勤務体系ID] IN '
                              '(SELECT [勤務体系ID] FROM [勤務体系マスタ] WHERE ' + w + ')')
                c.execute('DELETE FROM [勤務体系マスタ] WHERE ' + w)
            # 同じ名前の体系が何本も積まれるので、**区分を持つ1本だけ残す**。
            rows = [r[0] for r in c.execute(
                'SELECT [勤務体系ID] FROM [勤務体系マスタ] WHERE [名称]=? '
                'ORDER BY [勤務体系ID]', [_SHIFT_NAME])]
            keep = None
            for pid in rows:
                n = c.execute('SELECT COUNT(*) FROM [勤務区分マスタ] WHERE [勤務体系ID]=?',
                              [pid]).fetchone()[0]
                if n >= len(_SHIFT_SEGMENTS):
                    keep = pid
                    break
            if keep is None and rows:
                keep = rows[0]
            if keep is None:
                c.execute('INSERT INTO [勤務体系マスタ] ([適用設備],[名称],[表示順],[有効],'
                          '[登録者ID],[更新者ID],[登録日時],[更新日時]) '
                          "VALUES ('',?,10,-1,'fixture','fixture',"
                          "datetime('now'),datetime('now'))", [_SHIFT_NAME])
                keep = c.execute('SELECT last_insert_rowid()').fetchone()[0]
            for pid in rows:
                if pid != keep:
                    c.execute('DELETE FROM [勤務区分マスタ] WHERE [勤務体系ID]=?', [pid])
                    if '勤務体系設備マスタ' in have:
                        c.execute('DELETE FROM [勤務体系設備マスタ] WHERE [勤務体系ID]=?', [pid])
                    c.execute('DELETE FROM [勤務体系マスタ] WHERE [勤務体系ID]=?', [pid])
            c.execute('UPDATE [勤務体系マスタ] SET [有効]=-1 WHERE [勤務体系ID]=?', [keep])
            for nm, st, ed, od, off in _SHIFT_SEGMENTS:
                hit = c.execute('SELECT [勤務区分ID] FROM [勤務区分マスタ] '
                                'WHERE [勤務体系ID]=? AND [名称]=?', [keep, nm]).fetchone()
                if hit:
                    c.execute('UPDATE [勤務区分マスタ] SET [開始時刻]=?,[終了時刻]=?,'
                              '[表示順]=?,[有効]=-1,[日付補正]=? WHERE [勤務区分ID]=?',
                              [st, ed, od, off, hit[0]])
                else:
                    c.execute('INSERT INTO [勤務区分マスタ] ([勤務体系ID],[名称],[開始時刻],'
                              '[終了時刻],[表示順],[有効],[日付補正],[登録者ID],[更新者ID],'
                              '[登録日時],[更新日時]) '
                              "VALUES (?,?,?,?,?,-1,?,'fixture','fixture',"
                              "datetime('now'),datetime('now'))",
                              [keep, nm, st, ed, od, off])
            if '勤務体系設備マスタ' in have:
                for nm in _SHIFT_EQUIPMENT:
                    if not c.execute('SELECT 1 FROM [勤務体系設備マスタ] '
                                     'WHERE [勤務体系ID]=? AND [設備名]=?',
                                     [keep, nm]).fetchone():
                        c.execute('INSERT INTO [勤務体系設備マスタ] ([勤務体系ID],[設備名],'
                                  '[登録者ID],[更新者ID],[登録日時],[更新日時]) '
                                  "VALUES (?,?,'fixture','fixture',"
                                  "datetime('now'),datetime('now'))", [keep, nm])
        # 4) 旧マスタから移した選択肢（消えたら戻せるのはここだけ）
        if '操業データ選択肢マスタ' in have:
            for name, values in _CHOICES.items():
                n = c.execute('SELECT COUNT(*) FROM [操業データ選択肢マスタ] '
                              'WHERE [選択肢名]=? AND [有効]=-1', [name]).fetchone()[0]
                if n:
                    continue
                for i, v in enumerate(values, 1):
                    c.execute('INSERT INTO [操業データ選択肢マスタ] ([選択肢名],[値],[表示順],'
                              '[有効],[対象設備],[登録者ID],[更新者ID],[登録日時],[更新日時]) '
                              "VALUES (?,?,?,-1,'','fixture','fixture',"
                              "datetime('now'),datetime('now'))", [name, v, i * 10])
                note(f'  選択肢「{name}」を{len(values)}件戻しました')
        # 4b) 組み込みの欄に焼き付いた役割の置き土産（§9.300 ③）
        # 設定窓の役割の`<select>`は**効いている役割**（＝組み込みキー由来の
        # 暫定値）を選んだ状態で開くので、組み込みの欄を1回開いて保存した
        # 回のぶんだけ`[役割]`が明示として残る。明示になった暫定は
        # `role_holders()`で二度と下がらないので、**test_opuiの4件が
        # 実行をまたいで永久に落ち続けていた**（実測: オペレータ・スプール・
        # コイル止め・縦割数の4行が`更新者ID='opui-<pid>'`で汚れていた）。
        # 本体は`stored_role()`で塞いだが、**既に汚れたマスタは戻す**。
        if '操業データ項目マスタ' in have:
            n = c.execute('UPDATE [操業データ項目マスタ] SET [役割]=NULL '
                          "WHERE [組み込みキー] IS NOT NULL AND [組み込みキー]<>'' "
                          'AND [役割]=[組み込みキー]').rowcount
            if n:
                note('  組み込みの欄へ焼き付いた役割を%d件戻しました' % n)
        # 5) 「みんなのもの／自分だけ」の置き土産（§9.259・§9.274 追補）
        # **行が有る＝その人はその一覧で個人設定を使う**ので、1行残るだけで
        # 以降の全テストが「保存したのにマスタに入っていない」を見ることに
        # なる（実測: `root`の`list:SIKALOTNOW:仕掛`が残っていて、
        # test_collayout の7件・test_lcpanel の8件がそれで落ちていた）。
        # **丸ごと空にする**——ここは「どちらを使うか」の覚えだけで、
        # 中身（列の並び・幅）は列レイアウトマスタが持つ。
        if '列レイアウト個人設定マスタ' in have:
            c.execute('DELETE FROM [列レイアウト個人設定マスタ]')
        # 6) 列の見せ方そのものの置き土産（§9.121）
        # ランナーの`resetcontent`は`timeline:`／`print:`／`report:`だけを
        # 戻していて、**一覧（`list:<DB>:<表>`）が抜けていた**。test_collayout は
        # 毎回「2列目を非表示にする」ので、**回すたびに1列ずつ隠れていき**、
        # やがて見出しが3つを切って`waitForFunction`が時間切れになる
        # （実測: 10件まで進んで FATAL）。**保存は全置換なので消せば既定へ戻る。**
        if '列レイアウトマスタ' in have:
            c.execute("DELETE FROM [列レイアウトマスタ] WHERE [対象] LIKE 'list:%' "
                      "OR [対象]='records:list' OR [対象] LIKE 'timeline:%' "
                      "OR [対象] LIKE 'print:%' OR [対象] LIKE 'report:%'")
        # 7) 既定の帳票ブロックの中身の置き土産（§9.285 ②）
        # 塊の`[内容]`は**種の値へ戻す**。ランナーの`resetcontent`は
        # `contentEditable`が偽の塊だけを空にしていたので、§9.285 ②で
        # `寸法（オーダー／製造）`等が編集できるようになった瞬間に
        # **その4つの置き土産だけが残る**ようになった（実際に残り、盤を
        # 開くといきなり18マス入っていた）。**「触ってよいか」ではなく
        # 「種は何か」で戻すこと**——判定はサーバーの1箇所が持つ。
        # 8) 登録フィルタの置き土産（§9.286 ①）
        # フィルタ系のテストは自分で作った登録を`finally`で消すが、**途中で
        # 落ちた回のぶんは残る**（実測: `fumtctis6m-S1`のような屑が絞り込み
        # バーの札として毎回並んでいた）。フィクスチャは登録フィルタを
        # **1件も持たない**のが正しい姿——どのテストも要るものは自分で作る。
        # **個人設定（印）も一緒に消す**（残すと消えた登録の印だけが残る）。
        for t in ('フィルタプリセットマスタ', 'フィルタ個人設定マスタ'):
            if t in have:
                c.execute(f'DELETE FROM [{t}]')
        # 4c) 群が空になった組み込みの操業データ項目（§9.305 ①の追補）
        # 盤は掴んで群を移せるので、**途中で落ちた回のぶんは群が空のまま残る**。
        # 群が空の項目は測定画面で「その他」に落ちるので、**見出しの並びが
        # 1つずれる**——実測: `スプール`の群が空になっていて、test_msteps の
        # 「見出しの先頭は誰が→形→機材→いつもと同じの順」が落ちた
        # （壊れ方が遠く、原因はマスタの1セル。§9.284と同じ形）。
        # **戻すのは組み込みの項目だけ**——現場が作った項目の群まで
        # 決め打ちで書くと、意図して空にした行を上書きしてしまう。
        if '操業データ項目マスタ' in have:
            for key, grp in _builtin_item_groups().items():
                c.execute("UPDATE [操業データ項目マスタ] SET [群]=? "
                          "WHERE [組み込みキー]=? AND COALESCE([群],'')=''",
                          [grp, key])
        # 8c) 選択肢の親子（§9.306）。**フィクスチャは親子を1本も持たない**
        # のが正しい姿——要るものは各テストが自分で張って`finally`で外す。
        # 1本残ると、その子のまとまりを使う欄の候補が**全テストで絞られた
        # まま**になり、しかも落ちるのは選択肢と無関係な網（§9.284と同じ形）。
        if '選択肢リンクマスタ' in have:
            c.execute('DELETE FROM [選択肢リンクマスタ]')
        # 8b) 入力値の丸め（§9.307）。**測定項目マスタは廃止した**
        # ——操業データ項目マスタの「刻み」と重複していた（利用者の指摘
        # 「『入力値の丸め』マスタが『操業データ項目』マスタと被っており…
        # 今のままなら特に必要ないです」）。検証用のDBには作られた表が
        # 残っているので落とす——生の表の一覧に出ると、**もう読まない
        # マスタを直せるように見える**（§4）。
        if '測定項目マスタ' in have:
            c.execute('DROP TABLE [測定項目マスタ]')
        # 8d) 行・列の出し方（§9.309）。既定へ戻す。
        if '帳票ブロックマスタ' in have:
            try:
                c.execute("UPDATE [帳票ブロックマスタ] SET [最大表示]=''")
            except Exception:
                pass
        # 9) 自作の帳票ブロックの置き土産（§9.304）
        # 塊が1つ残るだけで**紙の中身がまるごと変わる**——並びに載っていない
        # 自作の塊は末尾へ回るので、紙がA4を超えて2枚ぶんに伸びる（実測:
        # 手元の確認スクリプトが残した`fbprobe847936`が row40/span5 に居座り、
        # test_rpprint の「刷る紙はぴったりA4」が210×329.8mmで落ちていた）。
        # しかも**壊れ方が遠い**——落ちるのは印刷の網で、原因はマスタの1行。
        # `resetcontent`が戻すのは`report:<設備>`（どう並べるか）だけで、
        # **何が在るか**はここにしか無い。テストは自分で作った塊を`finally`で
        # 消すが、途中で落ちた回と**手元の確認スクリプト**のぶんは残る
        # （§9.121。今回の元凶がまさにそれ）。
        # **見分けは`[組み込みキー]`**——空＝自作。フィクスチャのマスタは
        # 自作の塊を**1件も持たない**のが正しい姿で、要るものは各テストが
        # 自分で作る（`fix_master()`は1本ごとに走るので、走っている最中の
        # テストが作った塊は巻き添えにならない）。
        if '帳票ブロックマスタ' in have:
            c.execute("DELETE FROM [帳票ブロックマスタ] "
                      "WHERE COALESCE([組み込みキー],'')=''")
        if '帳票ブロックマスタ' in have:
            for key, (content, cols) in _builtin_block_seeds().items():
                c.execute('UPDATE [帳票ブロックマスタ] SET [内容]=?,[内訳列数]=? '
                          'WHERE [組み込みキー]=? AND ([内容] IS NOT ? OR '
                          'COALESCE([内訳列数],0) IS NOT ?)',
                          [content, cols, key, content, cols])
        c.commit()


def main() -> int:
    if not SHARE.exists():
        print(f'!! フィクスチャがありません: {SHARE}', file=sys.stderr)
        return 1
    with sqlite3.connect(SHARE) as conn:
        if '--show' in sys.argv:
            print(f'{SHARE}:')
            show(conn)
            return 0
        print('作り直す前:')
        show(conn)
        seed(conn)
        print('作り直した後:')
        show(conn)
    fix_master()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
