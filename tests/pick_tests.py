#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""変更したファイルから、関係のある回帰テストを選ぶ(§9.103)。

    tests/run_all.sh --changed        # 変更ファイルに関係するものだけ回す
    python3 tests/pick_tests.py       # 選ばれたテスト名を並べて出す
    python3 tests/pick_tests.py --why # どのファイルがどの規則で何を呼んだか
    python3 tests/pick_tests.py backend/routes/logs.py static/js/log-view.js

**これは絞り込みの手掛かりであって、フルスイートの代わりではない。**
コミット前は `tests/run_all.sh` を通しで回すこと。535件が20分かかるから
途中で回しにくい、という問題だけを解く道具で、「関係ない」と判断できる
根拠は下の表(人が書いたもの)しかない。表が間違っていれば見落とす。

設計:
 ・**分からないものは全部回す**(`ALL`)。当たる規則が無いファイルを
   「関係なし」と読むと、道具が黙って安全網を外すことになる。
 ・**安い静的検査は常に回す**(`ALWAYS`)。1本1秒以下で、しかも
   「グローバルを増やした」「索引を更新し忘れた」のような、変更した
   ファイルからは辿れない種類の崩れを見る。
 ・表の腐りは `tests/test_pick.py` が見る——存在しないテスト名、
   どの規則からも呼ばれないテスト、どの規則にも当たらないソース。
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TESTS = ROOT / 'tests'

# 常に回す静的検査(サーバーもブラウザも要らない安い網)。
ALWAYS = ['test_patchlint', 'test_globallint', 'test_dskeylint', 'test_csslint', 'test_docindex']

# 束ねた呼び名。右辺は実際のテスト名。
G = {}
G['一覧'] = ['test_nav', 'test_navdyn', 'test_listcache', 'test_listperf', 'test_allrows',
             'test_filterio', 'test_filteruser', 'test_filteractive',
             'test_cols', 'test_hdctx', 'test_dsnav', 'test_listmodal', 'test_filter',
             'test_audit', 'test_sub', 'test_uisize', 'test_ttlcache']
G['列'] = ['test_collayout', 'test_colformat', 'test_colrule', 'test_colsort', 'test_lcpanel',
           'test_colscache', 'test_colsripple', 'test_displayrule', 'test_colmenu',
           'test_colpreset', 'test_formula', 'test_reccols', 'test_rpblocks',
           'test_colio', 'test_multidrag']
G['スケジュール'] = ['test_screport', 'test_startwork', 'test_scsync', 'test_sccat',
                     'test_scbalance', 'test_scbatch', 'test_screorder', 'test_scperm',
                     'test_scperf', 'test_wkfast', 'test_scsplit', 'test_scprint', 'test_scdrop', 'test_scpick', 'test_sccontent', 'test_workable',
                     'test_wkbg', 'test_orphan', 'test_histdel', 'test_sclock',
                     'test_scwritespeed', 'test_split_layout', 'test_sccols',
                     'test_sctimecols', 'test_scinsert', 'test_audittrail']
G['マスタ'] = ['test_master', 'test_maint', 'test_stopcat', 'test_stopeq', 'test_eqkind',
               'test_shift', 'test_dbequip', 'test_crudroutes', 'test_setpage', 'test_eqstd']
G['測定'] = ['test_course', 'test_tolscale', 'test_defect', 'test_share', 'test_flows',
             'test_p11', 'test_p11c', 'test_waiting', 'test_mcore', 'test_msteps']
G['見た目'] = ['test_theme', 'test_scale', 'test_fit', 'test_typescale', 'test_density',
               'test_uiux', 'test_hdr', 'test_headbar', 'test_calscale', 'test_bootui',
               'test_gridhead']
G['起動'] = ['test_boot', 'test_bootui', 'test_bootflash', 'test_assetcache', 'test_tabclose']
G['接続'] = ['test_dbopen', 'test_dbmirror', 'test_datasource', 'test_tablequery',
             'test_atomicio', 'test_localwork', 'test_dscap']
G['権限'] = ['test_modeguard', 'test_noaccess', 'test_scperm', 'test_recperm']
G['ログ'] = ['test_logs', 'test_logview', 'test_error']

ALL = '*'  # 「全部回す」を表す印


def g(*names):
    """束ねた呼び名とテスト名を混ぜて並べる。"""
    out = []
    for n in names:
        out.extend(G[n] if n in G else [n])
    return out


# ---- 対応表 ------------------------------------------------------------
# 上から順に見て、**当たったものすべて**を足す(最初の1つで止めない)。
# 左は `fnmatch` ではなく単純な前方一致/完全一致で、`/` 終わりはフォルダ。
# 迷ったら広い方へ倒すこと——余計に回しても遅いだけだが、足りなければ
# 見落とす。
RULES = [
    # --- 全部に効くもの ---------------------------------------------
    ('templates/', [ALL]),
    # base.js は全画面が読む土台(WL名前空間・起動・ハートビート・キャッシュ)。
    ('static/js/base.js', [ALL]),
    # index.html は全画面のマークアップと起動ローダーを1枚で持っている。
    ('templates/index.html', [ALL]),
    # app.py はアプリの組み立て(Blueprint登録・キャッシュ方針・書込ガード)。
    ('app.py', [ALL]),
    ('backend/config.py', [ALL]),

    # --- 画面(JS) ----------------------------------------------------
    ('static/js/list-view.js', g('一覧', '列', 'test_fit', 'test_uiux')),
    ('static/js/list-columns.js', g('列', 'test_sccontent',
                                    'test_sccols', 'test_cols', 'test_lcpanel')),
    ('static/js/list-rules.js', g('列')),
    ('static/js/list-formula.js', g('test_formula', 'test_colpreset', 'test_lcpanel')),
    ('static/js/filters.js', g('test_filter', 'test_filterio', 'test_filteruser', 'test_listcache', 'test_allrows', 'test_nav')),
    ('static/js/schedule-view.js', g('スケジュール', 'test_listmodal')),
    ('static/js/schedule-print.js', g('test_scprint')),
    ('static/js/lot-split.js', g('test_scsplit', 'test_orphan', 'test_sub', 'test_splitlive')),
    ('static/js/master-maint.js', g('マスタ', 'test_headbar', 'test_datasource')),
    ('static/js/calendar-view.js', g('test_calscale', 'test_histdel', 'test_headbar')),
    # 帳票の塊の組み換え(§9.169)は列レイアウトマスタに載るので列の網も回す。
    ('static/js/report-dashboard.js', g('test_screport', 'test_hdr', 'test_calscale',
                                        'test_rpblocks', 'test_collayout')),
    ('static/js/quality-analysis.js', g('test_uiux', 'test_hdr', 'test_fit', 'test_theme')),
    ('static/js/defect-locator.js', g('test_defect')),
    ('static/js/log-view.js', g('ログ')),
    ('static/js/access-mode.js', g('権限', 'test_nav')),
    ('static/js/wl-window.js', g('test_lcpanel', 'test_listmodal', 'test_split_layout',
                                 'test_scsplit')),
    ('static/js/measure-progress.js', g('test_waiting', 'test_mcore',
                                        'test_msteps')),
    ('static/js/measure-steps.js', g('測定', '見た目')),   # 段の枠は測定画面全体に効く
    # データ一覧の表示列(§9.162)も持つので、列の網も回す。
    ('static/js/records-store.js', g('test_share', 'test_flows', 'test_p11', 'test_recperm',
                                     'test_reccols', 'test_lcpanel', 'test_audittrail')),
    # 測定画面は test_scale(寸法の網)の巡回にも入っている(§9.127)ので見た目も回す。
    ('static/js/measurement-', g('測定', '見た目')),   # measurement-*.js

    # --- 見た目(CSS) -------------------------------------------------
    # CSSは1枚に閉じない(トークンは:rootで共有し、@layerで順序が決まる)。
    # だから個別に割らず、寸法・溢れを見る網をまとめて回す。
    ('static/css/20-shell.css', g('見た目', '一覧', 'test_gridhead', 'test_lcpanel')),
    ('static/css/30-measure.css', g('見た目', '一覧', '測定', 'test_gridhead')),
    ('static/css/95-boot.css', g('見た目', '起動')),
    ('static/css/70-schedule.css', g('見た目', 'test_sccols', 'test_split_layout',
                                      'test_scbalance', 'test_scprint')),
    ('static/css/35-split.css', g('見た目', 'test_splitlive', 'test_split_layout')),
    ('static/css/40-records.css', g('見た目', 'test_recperm', 'test_reccols')),
    ('static/css/50-master.css', g('見た目', 'マスタ', 'test_dscap')),
    ('static/css/60-report.css', g('見た目', 'test_screport', 'test_rpblocks')),
    ('static/css/88-logs.css', g('見た目', 'test_logview')),

    # --- サーバー(ルート) --------------------------------------------
    ('backend/routes/tables.py', g('一覧', '接続', '列', 'test_colscache', 'test_colsripple',
                                   'test_modeguard')),
    ('backend/routes/masters.py', g('マスタ', '列', 'test_modeguard')),
    ('backend/routes/schedule.py', g('スケジュール', 'test_modeguard', 'test_crudroutes')),
    ('backend/routes/measurement.py', g('測定', 'test_modeguard')),
    ('backend/routes/quality.py', g('test_uiux', 'test_hdr', 'test_tablequery',
                                    'test_modeguard')),
    ('backend/routes/logs.py', g('ログ', 'test_modeguard')),
    ('backend/routes/path_config.py', g('test_setpage', 'test_datasource', 'test_dbopen',
                                        'test_crudroutes', 'test_modeguard', 'test_dscap')),
    ('backend/routes/rne.py', g('test_datasource', 'test_setpage', 'test_modeguard')),
    ('backend/routes/core.py', g('起動', 'test_error', 'test_nav')),

    # --- サーバー(その他) --------------------------------------------
    ('backend/access_mode.py', g('権限', 'test_nav', 'test_crudroutes')),
    ('backend/db_access.py', g('接続', '一覧', 'test_setpage')),
    # データソースの「できること」の判定(§9.163)。列名の別名解決も
    # ここが持つので、品質結合(/api/table)の網も回す。
    ('backend/source_capability.py', g('test_dscap', 'test_datasource', 'test_dsnav',
                                       'test_tablequery', 'test_uiux')),
    ('backend/db_mirror.py', g('test_dbmirror', 'test_dbopen', 'test_listcache',
                               'test_atomicio')),
    # 置き換えの粘り(§9.108)は写し・共有JSON・RNE公開の全部が通る土台。
    ('backend/atomic_io.py', g('test_atomicio', 'test_dbmirror', 'test_sclock',
                               'test_scsync', 'test_datasource')),
    ('backend/repositories/master_repo.py', g('マスタ', '列', 'test_workable')),
    ('backend/repositories/schedule_repo.py', g('スケジュール', 'test_stopeq')),
    ('backend/schedule_calc.py', g('スケジュール', 'test_eqstd')),
    ('backend/schedule_sync.py', g('test_sclock', 'test_scsync', 'test_scwritespeed',
                                   'test_screorder', 'test_atomicio')),
    ('backend/load_factor.py', g('test_scbalance', 'test_sccat', 'test_screport', 'test_eqstd')),
    ('backend/records_export.py', g('test_share', 'test_flows')),
    ('backend/logging_setup.py', g('ログ')),
    ('backend/boot_status.py', g('起動')),
    ('backend/watchdog.py', g('test_tabclose', 'test_boot')),
    ('backend/errors.py', g('test_error')),
    ('backend/paths.py', g('test_setpage', 'test_dbopen', 'test_datasource',
                           'test_localwork', 'test_dbmirror', '起動')),
    ('backend/changelog_data.py', g('test_docindex', 'test_boot')),
    ('backend/rne_', g('test_datasource', 'test_setpage', 'test_atomicio')),
    ('backend/navigator_api.py', g('test_datasource')),
    ('backend/launcher/', g('起動')),

    # --- 起動まわりの直接実行スクリプト --------------------------------
    ('start_app.py', g('起動')),
    ('process_manager.py', g('起動')),
    ('_pycache_bootstrap.py', g('起動')),

    # --- ドキュメント --------------------------------------------------
    ('docs/', ['test_docindex']),
    ('CLAUDE.md', ['test_docindex']),
    ('README.md', ['test_docindex']),

    # --- 検証用データ --------------------------------------------------
    # フィクスチャが変われば全部の前提が変わる。
    ('db/', [ALL]),

    # --- テスト自身 ----------------------------------------------------
    # `tests/test_*.py|js` は表を引くまでもないので pick() が先に拾う。
    # ここに書くのは**テスト以外**の、tests/ の下にあるもの。
    # **`tests/` の受け皿は置かない**——書いていないものは
    # 「当たる規則なし」＝全部回す側へ倒れるのが正しい。
    ('tests/run_all.sh', [ALL]),
    ('tests/make_fixture.py', [ALL]),
    ('tests/setperm.py', [ALL]),
    ('tests/make_split_fixture.py', g('test_scsplit')),
    ('tests/orphan_lot.js', g('test_audit', 'test_nav', 'test_orphan')),
    ('tests/audit_scale.js', g('test_audit')),
    ('tests/pick_tests.py', ['test_pick']),
    ('tests/README.md', ['test_docindex']),
]

# 受け皿。**上のRULESにひとつも当たらなかったファイルだけ**が、ここの
# 上から順に見て最初に当たったものを取る。
# **足し合わせにしないこと**——`backend/`の受け皿を全backendへ足すと、
# `routes/logs.py`を直しただけで起動まわりのテストまで付いてきて、
# 絞り込みが名ばかりになる(実際に一度そう書いた。17本→9本の差)。
FALLBACKS = [
    ('backend/routes/', g('権限', 'test_crudroutes')),
    ('backend/', g('起動', '権限')),
    ('static/js/', g('一覧', '見た目')),
    ('static/css/', g('見た目')),
]


def all_test_names():
    return sorted(p.stem for p in TESTS.glob('test_*.py')) + \
           sorted(p.stem for p in TESTS.glob('test_*.js'))


def _match(path, pat):
    return path == pat or (pat.endswith('/') and path.startswith(pat)) or \
           (not pat.endswith('/') and '.' not in Path(pat).name and path.startswith(pat))


def pick(paths):
    """変更ファイルの一覧から (テスト名の集合, 理由の一覧) を返す。"""
    names = set(ALWAYS)
    why = []
    known = set(all_test_names())
    for p in paths:
        p = p.replace('\\', '/').lstrip('./')
        if not p:
            continue
        # テストそのものを直したなら、そのテストを回す。
        stem = Path(p).stem
        if p.startswith('tests/') and stem in known:
            names.add(stem)
            why.append((p, 'テスト本体', [stem]))
            continue
        hit = [(pat, tests) for pat, tests in RULES if _match(p, pat)]
        if not hit:
            # 名指しが無ければ受け皿を1つだけ(上から最初に当たったもの)。
            hit = [(pat, tests) for pat, tests in FALLBACKS if _match(p, pat)][:1]
        if not hit:
            # **分からないものは全部回す。** ここで黙って0件にしない。
            why.append((p, '当たる規則なし', [ALL]))
            return set(), why
        for pat, tests in hit:
            if ALL in tests:
                why.append((p, pat, [ALL]))
                return set(), why
            names.update(tests)
            why.append((p, pat, tests))
    return names, why


def changed_files():
    """git から変更ファイルを拾う(未コミット + 追跡外)。"""
    out = []
    for cmd in (['git', 'diff', '--name-only', 'HEAD'],
                ['git', 'ls-files', '--others', '--exclude-standard']):
        try:
            r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, timeout=30)
            if r.returncode == 0:
                out.extend(x for x in r.stdout.splitlines() if x.strip())
        except (OSError, subprocess.SubprocessError):
            pass
    return sorted(set(out))


def main(argv):
    why = '--why' in argv
    args = [a for a in argv if not a.startswith('-')]
    paths = args or changed_files()
    if not paths:
        # 変更が無いなら回すのは常設の静的検査だけ。
        print(' '.join(ALWAYS))
        return 0
    names, reasons = pick(paths)
    if why:
        for p, pat, tests in reasons:
            print(f'{p}\n    {pat} -> ' + ('全部' if ALL in tests else ' '.join(sorted(tests))),
                  file=sys.stderr)
        print(f'--- 変更 {len(paths)}件 -> ' +
              ('全部' if not names else f'{len(names)}本'), file=sys.stderr)
    if not names:
        print('')   # 空 = 全部(run_all.sh の SELECT が空なら全件)
        return 0
    print(' '.join(sorted(names)))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
