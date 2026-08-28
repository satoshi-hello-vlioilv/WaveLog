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
G['一覧'] = ['test_nav', 'test_listcache', 'test_listperf', 'test_allrows',
             'test_filterio', 'test_filteruser', 'test_filteractive', 'test_filterkeep',
             'test_filterlock', 'test_adhoc',
             'test_cols', 'test_headbar', 'test_dsnav', 'test_dsrestart', 'test_listmodal', 'test_filter',
             'test_audit', 'test_sub', 'test_uisize', 'test_ttlcache',
             # §9.239 ⑤: 子ロットの畳み込みと列の一時的な色
             'test_gridchild', 'test_coltint']
# 操業データ(§9.215)は測定画面のカード。マスタ管理からも触るので「マスタ」群。
G['操業データ'] = ['test_opdata', 'test_opui', 'test_msteps', 'test_maint', 'test_crudroutes',
                   'test_opchoice', 'test_oplimit', 'test_opmother', 'test_opunit',
                   # §9.242 ④: ③「記録した値」も操業データ項目マスタの行から作る
                   'test_opauto', 'test_recvalues',
                   # §9.243: 「記録した値」の配置をD&Dで組む専用のマスタ
                   'test_reclayout',
                   # §9.246 ①: 「空欄の札」は組み込みの選択欄でも効く
                   'test_opblank',
                   # §9.247 ①: トグルの作り直しと、足した2つの選ばせ方
                   'test_opwidget']
# 異常位置判定と条の設計の連携(§9.226 ④)。どちらを触っても両方を回す。
G['異常位置'] = ['test_defect', 'test_defectlink', 'test_splitlive', 'test_scsplit',
                 # §9.239 ⑥: ピッチ→ロール判定とロールマスタ
                 'test_roll', 'test_mmfold',
                 # §9.241 ④⑤: ロールの読み込み経路と、入力の取り消し
                 'test_rollload',
                 # §9.251: 全削除・完全入替（ロールが1本も無くなる形を通る）
                 'test_rollwipe']
# 操業データの意匠・設定窓・空きの群（§9.227）
G['操業意匠'] = ['test_oppad', 'test_opui', 'test_opdata', 'test_msteps', 'test_oplimit',
                 # §9.256: 式で作る自動値
                 'test_opformula',
                 'test_opmother', 'test_opunit', 'test_opauto', 'test_reclayout',
                 # §9.247 ①: 選ばせ方そのもの（トグル・メニュー・切替・角丸の踏襲）
                 'test_opwidget']
G['列'] = ['test_collayout', 'test_colformat', 'test_colrule', 'test_colsort', 'test_lcpanel',
           'test_colscache', 'test_colsripple', 'test_colsave', 'test_displayrule', 'test_colmenu',
           'test_colpreset', 'test_formula', 'test_reccols', 'test_rpblocks', 'test_rplayout',
           'test_rpmaster',
           'test_colio', 'test_multidrag', 'test_sortcustom', 'test_sortpipe',
           # §9.253: 見本のロットで帳票を見る・試し印刷
           'test_rbsample',
           # §9.254 (3): 帳票レイアウトマスタ（列レイアウトマスタの report: を触る）
           'test_rlmaster',
           # §9.239 ④⑤: 揃えと列の一時的な色
           'test_coltint', 'test_gridchild',
           # §9.248 ③④: 表示列が消えない／表示中・非表示中の札
           'test_colkeep',
           # §9.259: 列の見せ方を「みんなと同じ／自分だけ」で選ぶ
           'test_colscope', 'test_colscopeui']
# モーダルの閉じ方(§9.221 ①)はどの画面にも掛かる横断の約束。
G['モーダル'] = ['test_modalkeep', 'test_maint', 'test_master', 'test_opui', 'test_opchoice',
                 # §9.257 ②: 使用設備の設定（窓の作りは1箇所・選んでも動かない）
                 'test_eqsetup']
G['スケジュール'] = ['test_screport', 'test_startwork', 'test_scsync', 'test_sccat',
                     'test_scbalance', 'test_scbatch', 'test_screorder', 'test_scperm',
                     'test_scperf', 'test_wkfast', 'test_scsplit', 'test_scprint', 'test_scdrop', 'test_scpick', 'test_sccontent', 'test_workable',
                    'test_scframe',
                     'test_wkbg', 'test_orphan', 'test_histdel', 'test_sclock',
                     'test_scwritespeed', 'test_split_layout', 'test_sccols',
                     'test_sctimecols', 'test_scinsert', 'test_audittrail',
                     # §9.246 ②: 表示列はモードで変わらない
                     'test_scmodecols',
                     'test_scstop', 'test_scwarm', 'test_scundecided',
                     'test_scwatchui', 'test_scwatch', 'test_sccomment',
                     'test_scowner', 'test_scrowstyle', 'test_scload', 'test_scbar', 'test_scsave',
                     'test_scsession', 'test_scwho']
# 実績データリストと操業データ表（§9.241 ②③）。**一覧が紙の材料を渡す**ので、
# どちらを触っても両方回す。
# §9.248 ⑥: 見せる範囲を「実施した設備」で絞る（データ一覧・実績データ）
G['実績'] = ['test_actuals', 'test_opsheet', 'test_eqscope']
G['マスタ'] = ['test_master', 'test_maint', 'test_stopcat', 'test_stopeq', 'test_eqkind',
               'test_shift', 'test_dbequip', 'test_crudroutes', 'test_setpage', 'test_eqstd',
               'test_workdate', 'test_measstore', 'test_roll', 'test_rollio',
               # §9.241 ①: 束ねた見出しの開閉／④: ロールの読み込み経路
               'test_mmfold', 'test_rollload',
               # §9.251: ロールの全削除・完全入替
               'test_rollwipe',
               # §9.250 ①②③⑥⑦: 一覧の折りたたみ・移行済みの削除・並べ替え/列幅
               'test_mmtable',
               # §9.253: 帳票ブロックマスタから見本のロットで帳票を見る
               'test_rbsample']
G['測定'] = ['test_course', 'test_tolscale', 'test_defect', 'test_share', 'test_flows',
             'test_master', 'test_waiting', 'test_mcore', 'test_msteps',
             # §9.242 ③: バリの2段（1回目の受付・2回目の計算式）
             # §9.242 ⑤⑥: 公差／基準の言い分けと、確認カードの強調・NGの記録
             # §9.242 ④: ③「記録した値」は操業データ項目マスタが決める
             'test_burr', 'test_ngcard', 'test_recvalues', 'test_reclayout']
G['見た目'] = ['test_theme', 'test_scale', 'test_fit', 'test_typescale', 'test_density',
               'test_uiux', 'test_headbar', 'test_uisize', 'test_bootui',
               'test_gridhead']
G['起動'] = ['test_boot', 'test_bootui', 'test_bootflash', 'test_assetcache', 'test_tabclose',
             'test_faststart']
G['接続'] = ['test_pcshare', 'test_dbopen', 'test_dbmirror', 'test_datasource', 'test_tablequery',
             'test_atomicio', 'test_localwork', 'test_dscap',
             'test_qjoin', 'test_qjoinui',
             # §9.258: 測定データは設備ごとに1ファイル（置き場の解決）
             'test_recsplit']
G['権限'] = ['test_modeguard', 'test_noaccess', 'test_scperm', 'test_recperm', 'test_pcname']
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
    # §9.256 式で作る自動値も同じ評価器を使う（片方だけ直した状態を作らない）
    ('static/js/list-formula.js', g('test_formula', 'test_colpreset', 'test_lcpanel',
                                    'test_opformula')),
    ('static/js/filters.js', g('モーダル', 'test_filter', 'test_filterio', 'test_filteruser',
                               'test_listcache', 'test_allrows', 'test_nav', 'test_adhoc')),
    ('static/js/schedule-view.js', g('スケジュール', 'モーダル', 'test_listmodal')),
    ('static/js/schedule-print.js', g('モーダル', 'test_scprint')),
    # 実績データリストは列の設定パネル・帳票・アクセスモードへつながる。
    ('static/js/actuals-view.js', g('実績', 'モーダル', '列', 'test_recperm', 'test_nav')),
    ('static/js/opsheet-print.js', g('実績', 'モーダル', '列')),
    ('backend/actuals.py', g('実績', 'test_workdate', 'test_modeguard')),
    ('static/js/lot-split.js', g('異常位置', 'test_orphan', 'test_sub')),
    ('static/js/master-maint.js', g('マスタ', 'モーダル', '操業意匠', 'test_rawmaster',
                                    'test_headbar', 'test_datasource',
                                     'test_qjoinui', 'test_dscap', 'test_blockbuild', 'test_rbmodal',
                                     # §9.254 (3): 帳票レイアウトマスタ（親子の行き来）
                                     'test_rlmaster')),
    ('static/js/calendar-view.js', g('test_uisize', 'test_histdel', 'test_headbar')),
    # 帳票の塊の組み換え(§9.169)は列レイアウトマスタに載るので列の網も回す。
    ('static/js/report-dashboard.js', g('モーダル', 'test_screport', 'test_headbar', 'test_uisize',
                                        'test_rpblocks', 'test_rplayout', 'test_rpmaster',
                                        # §9.254 (3): 帳票レイアウトマスタの口（WL.reportLayout）
                                        'test_rlmaster',
                                        # §9.242 ⑦⑧: 刷るときの紙の箱・品質情報の枠
                                        'test_rpprint',
                                        # §9.253: 見本のロットで帳票を見る
                                        'test_rbsample',
                                        'test_collayout', 'test_actuals')),
    ('static/js/quality-analysis.js', g('test_uiux', 'test_headbar', 'test_fit', 'test_theme')),
    ('static/js/defect-locator.js', g('モーダル', '異常位置')),
    # ロールマスタ（§9.239 ⑥）。マスタの4本セットと判定の両方に効く。
    ('backend/repositories/roll_repo.py', g('マスタ', '異常位置')),
    # Excelの読み書き（§9.240）。ロールマスタの入出力が唯一の使い手。
    ('backend/xlsx_io.py', g('test_rollio', 'test_roll')),
    ('static/js/log-view.js', g('ログ')),
    ('static/js/access-mode.js', g('権限', 'test_nav')),
    ('static/js/wl-window.js', g('test_lcpanel', 'test_listmodal', 'test_split_layout',
                                 'test_scsplit')),
    ('static/js/measure-progress.js', g('test_waiting', 'test_mcore',
                                        'test_msteps')),
    ('static/js/measure-steps.js', g('測定', '見た目')),   # 段の枠は測定画面全体に効く
    # データ一覧の表示列(§9.162)も持つので、列の網も回す。
    ('static/js/records-store.js', g('モーダル', 'test_share', 'test_flows', 'test_master',
                                     'test_recperm', 'test_reccols', 'test_lcpanel',
                                     'test_audittrail', 'test_recdel',
                                     # §9.248 ⑥: 見せる範囲を設備で絞る
                                     'test_eqscope',
                                     # §9.257 ②: 使用設備の設定モーダル（作りはここ1箇所）
                                     'test_eqsetup')),
    # 測定画面は test_scale(寸法の網)の巡回にも入っている(§9.127)ので見た目も回す。
    ('static/js/measurement-', g('測定', '見た目', 'モーダル')),   # measurement-*.js

    # --- 見た目(CSS) -------------------------------------------------
    # CSSは1枚に閉じない(トークンは:rootで共有し、@layerで順序が決まる)。
    # だから個別に割らず、寸法・溢れを見る網をまとめて回す。
    # モーダルの弾み・×の案内(§9.221 ①)はここが持つ。
    ('static/css/20-shell.css', g('見た目', '一覧', 'モーダル', 'test_gridhead', 'test_lcpanel')),
    ('static/css/30-measure.css', g('見た目', '一覧', '測定', '操業意匠', 'test_gridhead')),
    ('static/css/95-boot.css', g('見た目', '起動')),
    ('static/css/70-schedule.css', g('見た目', 'test_sccols', 'test_split_layout',
                                      'test_scbalance', 'test_scprint')),
    ('static/css/35-split.css', g('見た目', '異常位置', 'test_split_layout')),
    ('static/css/40-records.css', g('見た目', 'test_recperm', 'test_reccols', 'test_recdel',
                                     'test_eqscope')),
    ('static/css/50-master.css', g('見た目', 'マスタ', '操業意匠', 'test_rbmodal',
                                   'test_dscap', 'test_qjoinui',
                                    'test_blockbuild')),
    ('static/css/60-report.css', g('見た目', 'test_screport', 'test_rpblocks', 'test_rplayout',
                                   'test_rpprint')),
    ('static/css/62-actuals.css', g('見た目', '実績')),
    ('backend/repositories/report_block_repo.py', g('test_rpmaster', 'test_rpblocks', 'test_rbmodal',
                                                    'test_rplayout', 'test_crudroutes',
                                                    'test_blockbuild', 'test_opdata',
                                                    # §9.253: 見本のロット1件
                                                    'test_rbsample')),
    ('static/css/88-logs.css', g('見た目', 'test_logview')),

    # --- サーバー(ルート) --------------------------------------------
    ('backend/routes/tables.py', g('一覧', '接続', '列', 'test_colscache', 'test_colsripple',
                                   'test_modeguard')),
    ('backend/routes/masters.py', g('マスタ', '列', 'test_modeguard')),
    ('backend/routes/schedule.py', g('スケジュール', 'test_modeguard', 'test_crudroutes')),
    ('backend/routes/measurement.py', g('測定', 'test_modeguard', 'test_measstore',
                                        'test_recsplit')),
    ('backend/routes/quality.py', g('test_uiux', 'test_headbar', 'test_tablequery',
                                    'test_modeguard')),
    ('backend/routes/logs.py', g('ログ', 'test_modeguard')),
    ('backend/routes/path_config.py', g('test_setpage', 'test_datasource', 'test_dbopen',
                                        'test_crudroutes', 'test_modeguard', 'test_dscap',
                                        # §9.260: 共有の置き場を1枚で見せる
                                        'test_pcshare')),
    ('backend/routes/rne.py', g('test_datasource', 'test_setpage', 'test_modeguard')),
    ('backend/routes/core.py', g('起動', 'test_error', 'test_nav')),

    # --- サーバー(その他) --------------------------------------------
    ('backend/access_mode.py', g('権限', 'test_nav', 'test_crudroutes', 'test_colscope')),
    ('backend/db_access.py', g('接続', '一覧', 'test_setpage')),
    # データソースの「できること」の判定(§9.163)。列名の別名解決も
    # ここが持つので、品質結合(/api/table)の網も回す。
    ('backend/query_join.py', g('接続', '列', 'test_dsnav', 'test_sccontent')),
    ('backend/source_capability.py', g('test_dscap', 'test_datasource', 'test_dsnav',
                                       'test_tablequery', 'test_uiux')),
    ('backend/db_mirror.py', g('test_dbmirror', 'test_dbopen', 'test_listcache',
                               'test_atomicio', 'test_cleanup')),
    # 不要ファイルの掃除(§9.249 (1))。置き場の判定を触ると対象が変わるので、
    # 写し・置き場の網も一緒に回す。
    ('backend/file_cleanup.py', g('test_cleanup', 'test_dbmirror', 'test_localwork',
                                  'test_modeguard')),
    ('backend/routes/cleanup.py', g('test_cleanup', 'test_modeguard', 'test_crudroutes')),
    # 専用タブを持たないマスタの編集(§9.249 (2))。対応表がタブのキーを指すので、
    # マスタ管理の画面(master-maint.js)を触ったときも回す。
    ('backend/routes/master_tables.py', g('test_rawmaster', 'test_modeguard',
                                          'test_crudroutes', 'test_maint', 'test_mmtable')),
    # 置き換えの粘り(§9.108)は写し・共有JSON・RNE公開の全部が通る土台。
    ('backend/atomic_io.py', g('test_atomicio', 'test_dbmirror', 'test_sclock',
                               'test_scsync', 'test_datasource', 'test_cleanup')),
    ('backend/repositories/master_repo.py', g('マスタ', '列', 'test_workable', 'test_oplimit')),
    ('backend/repositories/operation_repo.py', g('操業データ', '操業意匠', 'test_msteps', 'test_mcore')),
    # 操業データの入力欄（§9.215）。測定画面①の中身なので測定一式へ。
    ('static/js/measure-opdata.js', g('操業データ', '測定', '見た目', 'モーダル', '操業意匠')),
    ('backend/repositories/schedule_repo.py', g('スケジュール', 'test_stopeq', 'test_workdate')),
    ('backend/schedule_calc.py', g('スケジュール', 'test_eqstd', 'test_workdate')),
    ('backend/sort_order.py', g('列', 'test_tablequery')),
    ('backend/schedule_watch.py', g('スケジュール')),
    # 共有スケジュールの持ち主(§9.192)。書込の入口(routes/schedule.py)と
    # 書込ガード(access_mode.py)の両方に手が入るので、権限の網も回す。
    ('backend/schedule_owner.py', g('test_scowner', 'test_modeguard', 'スケジュール')),
    ('tests/fixtures/sort_cases.json', g('test_sortpipe', 'test_sortcustom')),
    ('backend/schedule_sync.py', g('test_sclock', 'test_scsync', 'test_scwritespeed',
                                   'test_screorder', 'test_atomicio', 'test_scsession',
                                   'test_scwho')),
    ('backend/load_factor.py', g('test_scbalance', 'test_sccat', 'test_screport', 'test_eqstd')),
    ('backend/records_export.py', g('test_share', 'test_flows', 'test_measstore',
                                    'test_recsplit')),
    ('backend/logging_setup.py', g('ログ')),
    ('backend/boot_status.py', g('起動')),
    ('backend/watchdog.py', g('test_tabclose', 'test_boot')),
    ('backend/errors.py', g('test_error')),
    ('backend/paths.py', g('test_setpage', 'test_dbopen', 'test_datasource',
                           'test_localwork', 'test_dbmirror', 'test_cleanup', '起動')),
    ('backend/changelog_data.py', g('test_docindex', 'test_boot')),
    ('backend/rne_', g('test_datasource', 'test_setpage', 'test_atomicio')),
    ('backend/navigator_api.py', g('test_datasource')),
    ('backend/launcher/', g('起動')),

    # --- 起動まわりの直接実行スクリプト --------------------------------
    ('start_app.py', g('起動')),
    ('setup_app.py', g('起動')),
    ('setup.bat', g('起動')),
    ('loading.html', g('起動')),
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
