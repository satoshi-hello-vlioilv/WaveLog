#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""変更したファイルから、関係のある回帰テストを選ぶ(§9.103)。

    tests/run_all.sh --changed        # 変更ファイルに関係するものだけ回す
    python3 tests/pick_tests.py       # 選ばれたテスト名を並べて出す
    python3 tests/pick_tests.py --why # どのファイルがどの規則で何を呼んだか
    python3 tests/pick_tests.py backend/routes/logs.py static/js/core/log-view.js

**これは絞り込みの手掛かりであって、フルスイートの代わりではない。**
通しを回すかどうかは利用者が決める（CLAUDE.md「作業の進め方」A。
「コミット前は必ず通す」は撤回した）。ここは「関係ない」と判断できる根拠が
下の表(人が書いたもの)しかない道具で、表が間違っていれば見落とす。
**絞り込みで回したことと、通していないことを報告に書く。**

設計:
 ・**分からないものは全部回す**(`ALL`)。当たる規則が無いファイルを
   「関係なし」と読むと、道具が黙って安全網を外すことになる。
 ・**安い静的検査は常に回す**(`ALWAYS`)。1本1秒以下で、しかも
   「グローバルを増やした」「索引を更新し忘れた」のような、変更した
   ファイルからは辿れない種類の崩れを見る。
 ・表の腐りは `tests/test_pick.py` が見る——存在しないテスト名、
   どの規則からも呼ばれないテスト、どの規則にも当たらないソース。
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TESTS = ROOT / 'tests'

# 常に回す静的検査(サーバーもブラウザも要らない安い網)。
# §9.275: どの`.py`を触っても走らせる（知らないエスケープは、書いた本人の
# Pythonでは警告にならないことがある——利用者の端末で初めて出た）。
# §9.276 ④: 説明文の生タグも同じ——**画面を開いて回らないと見えない**ので、
# 開き忘れた1つが永久に残る。字を見るだけの網なら新しいマスタも自動で対象。
ALWAYS = ['test_patchlint', 'test_globallint', 'test_dskeylint', 'test_csslint',
          'test_docindex', 'test_pywarn', 'test_hintlint',
          # §9.315: 後から足した列を「無ければ足す」のは1箇所。マスタを1つ
          # 足した人がここを通さずに書くと、同じ不具合が別の列で戻る。
          'test_ddllint',
          # §9.324 R4: 真偽の読み方の写しが残っていないか（1秒未満）
          'test_flags',
          # §9.324 R2: ルートの失敗の受け方は api_guard の1箇所（写しを機械で数える）
          'test_apiguard',
          # §9.337: テストの層（純粋/煙/全件）が崩れていないか。**ここが崩れると
          # CIの1段目が静かに減る**ので、どのファイルを触っても見る（1秒未満）。
          'test_layers',
          # §9.324 R1: 列定義は TableDef の1箇所（位置読みの写しを機械で数える・数秒）
          'test_tabledef',
          # §9.326: 標準の静的解析（pyflakes／eslint）。どの .py/.js を触っても数秒で回る
          'test_pyflakes', 'test_eslint', 'test_routesplit', 'test_quietlint',
          # §9.522 REVIEW 3-22: 長い関数の本数・超過行数が増えていないか（数秒）
          'test_funclen',
          # §9.329 REVIEW 3-2: db_access の層と、読み込みの副作用（1秒未満）
          'test_dblayer',
          'test_body',
          # §9.332: 紙まわりの写しが増えていないこと
          'test_printcore',
          # §9.324 R3: JSの読み込み順は core.py の JS_FILES の1箇所（static/js と突き合わせる）
          'test_loadorder',
          # §9.347 REVIEW 3-15: 固定待ちとハーネスの写しが増えていないか（1秒未満）
          'test_waitlint',
          # §9.349 REVIEW 3-21: 関数の中の import が増えていないか（輪を隠す道）
          'test_importlint']

# 束ねた呼び名。右辺は実際のテスト名。
G = {}
G['一覧'] = ['test_nav', 'test_navwords', 'test_popmenu', 'test_listcache', 'test_listperf', 'test_allrows',
             'test_filterio', 'test_filteruser', 'test_filteractive', 'test_filterkeep',
             'test_filterlock', 'test_adhoc',
             'test_cols', 'test_headbar', 'test_dsnav', 'test_dsrestart', 'test_listmodal', 'test_filter',
             'test_audit', 'test_sub', 'test_uisize', 'test_ttlcache',
             # §9.239 ⑤: 子ロットの畳み込みと列の一時的な色
             'test_gridchild', 'test_coltint',
             # §9.468: 一覧の道具の帯は2段（すぐ使う操作／常に見る状態）・「☰ 表示」
             'test_listbar']
# 操業データ(§9.215)は測定画面のカード。マスタ管理からも触るので「マスタ」群。
G['操業データ'] = ['test_opdata', 'test_opui', 'test_msteps', 'test_maint', 'test_crudroutes',
                   'test_opchoice', 'test_oplimit', 'test_opmother', 'test_opunit',
                   # §9.242 ④: ③「記録した値」も操業データ項目マスタの行から作る
                   'test_opauto', 'test_recvalues',
                   # §9.243: 「記録した値」の配置をD&Dで組む専用のマスタ
                   'test_reclayout',
                   # §9.246 ①: 「空欄の札」は組み込みの選択欄でも効く
                   'test_opblank',
                   # §9.323 ①: 測定画面からマスタへ間接登録する経路
                   'test_opinline',
                   # §9.247 ①: トグルの作り直しと、足した2つの選ばせ方
                   'test_opwidget',
                   # §9.305 ①: 入力値の丸め（測定項目マスタ）
                   'test_mround',
                   # §9.306: 選択肢の親子（リンクマスタ）。サーバーは
                   # `test_choicelink`、**測定画面で実際に絞られるか**は
                   # `test_opparent`——どちらか片方だけでは、サーバーが
                   # 正しく答えていても画面が引かない実装が素通りする。
                   'test_choicelink', 'test_opparent',
                   # §9.306-B: リンクマスタの盤（押す道・掴む道・断り）
                   'test_choicelinkui']
# 異常位置判定と条の設計の連携(§9.226 ④)。どちらを触っても両方を回す。
# §9.319-C: 紙の異常位置判定とピッチ判定（塊を分ける・文字を本文並みに）
G['異常位置'] = ['test_defect', 'test_defectlink', 'test_splitlive', 'test_scsplit',
                 'test_rpdefect',
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
           # §9.489: 元データの列にも「この列の作り方」の式（4画面）
           'test_colsrcfx',
           'test_rpmaster',
           'test_colio', 'test_multidrag', 'test_sortcustom', 'test_sortpipe',
           # §9.253: 見本のロットで帳票を見る・試し印刷
           'test_rbsample',
           # §9.254 (3): 帳票レイアウトマスタ（列レイアウトマスタの report: を触る）
           'test_rlmaster',
           # §9.274: 帳票ブロックの中身を「セル」で持つ（マトリクス・書式・見出し）
           'test_rbcells',
           # §9.285 ②③④: 引ける範囲（品質等級・母材・仕掛の生データ）と書式
           'test_rbcatalog',
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
                     # §9.389: 設備停止を入れる手順（内容→内訳→時間）と耳屑幅の列
                     'test_stopflow', 'test_stoppos', 'test_sctimesedit', 'test_scscrap', 'test_scsubtotal', 'test_sccolpanel', 'test_schistui',
                     'test_scwatchui', 'test_scwatch', 'test_sccomment',
                     'test_scowner', 'test_scrowstyle', 'test_scload', 'test_scbar', 'test_scsave',
                     # §9.366: さかのぼりの起点と2段の選び方
                     'test_schistory',
                     # §9.368: 外したロットは仕掛に無ければ一覧へ戻さない／ICASコピー
                     'test_wipgone', 'test_lotcopy',
                     # §9.372: 書込が失敗したら必ず理由を言う（黙って巻き戻さない）
                     'test_scfail',
                     # §9.438: 応答が届かなかった追加を、再送で二重に入れない
                     'test_plandup',
                     # §9.373: 失敗を開発へ報告できる形で残す（コピー1手）
                     'test_feedback',
                     # §9.374: 掴んだまま表を送る／色と濃さの意味
                     'test_scdragscroll',
                     # §9.375: 元データ（仕掛）が変わったら予定へ取り込む
                     'test_srcsync',
                     'test_scsession', 'test_scwho']
# 実績データリストと操業データ表（§9.241 ②③）。**一覧が紙の材料を渡す**ので、
# どちらを触っても両方回す。
# §9.248 ⑥: 見せる範囲を「実施した設備」で絞る（データ一覧・実績データ）
G['実績'] = ['test_actuals', 'test_opsheet', 'test_eqscope']
# 刃組（§9.377）。**部材マスタ・ガイダンス・設備停止の連携**は1つの仕事なので、
# どれを触っても3本まとめて回す（計算はサーバー不要の1本、画面は1本）。
G['刃組'] = ['test_bladeset', 'test_bladeui', 'test_bladepick', 'test_holdpick', 'test_bladesets', 'test_ringboard', 'test_bladeboard', 'test_screenprint', 'test_stopeq', 'test_partboards']
G['マスタ'] = ['test_master', 'test_maint', 'test_stopcat', 'test_stopeq', 'test_eqkind',
               # §9.389: 設備停止の内訳（サブカテゴリ）と時間の選択肢
               'test_stopsub', 'test_stopsubui',
               'test_shift', 'test_dbequip', 'test_crudroutes', 'test_setpage', 'test_eqstd',
               'test_workdate', 'test_measstore', 'test_roll', 'test_rollio',
               # §9.241 ①: 束ねた見出しの開閉／④: ロールの読み込み経路
               'test_mmfold', 'test_rollload',
               # §9.251: ロールの全削除・完全入替
               'test_rollwipe',
               # §9.331: タブを切り替えたとき、前のタブの応答が今の画面を上書きしない
               'test_mmswitch',
               # §9.250 ①②③⑥⑦: 一覧の折りたたみ・移行済みの削除・並べ替え/列幅
               'test_mmtable',
               # §9.253: 帳票ブロックマスタから見本のロットで帳票を見る
               'test_rbsample',
               # §9.274: セルの組み立て盤・説明の量・紙からマスタへの配線
               'test_rbcells',
               # §9.285 ②③④: 既定の中身を写す・書式・候補に無い道の印
               'test_rbcatalog',
               # §9.302: 設備の有効・無効を機能別に（測定・作業予定・帳票）
               'test_eqfeature',
               # §9.392: 設備ごとに使う入力内容
               'test_measitems']
G['測定'] = ['test_course', 'test_tolscale', 'test_defect', 'test_share', 'test_flows',
             # §9.392: 設備ごとに使う入力内容（選択肢とチップから伏せる）
             'test_measitems',
             # §9.286 ⑥: 未入力・未選択の配色と、増やした色
             'test_opblanktint',
             'test_master', 'test_waiting', 'test_mcore', 'test_msteps',
             # §9.242 ③: バリの2段（1回目の受付・2回目の計算式）
             # §9.242 ⑤⑥: 公差／基準の言い分けと、確認カードの強調・NGの記録
             # §9.242 ④: ③「記録した値」は操業データ項目マスタが決める
             # §9.319: 公差外・基準外があっても測定を完了できる
             # §9.320-C: 測定器で桁が変わる（マイクロメータ／ノギス／コンベックス）
             # §9.320-D: フラットネスの全〇
             # §9.320-G: レールの2つのボタンを消し、DBへは裏で書く
             'test_burr', 'test_ngcard', 'test_ngdone', 'test_devdigits',
             'test_recvalues', 'test_reclayout',
             # §9.317: 参照データ（品質など）が読めなくても測定は始められる
             'test_ctxfail']
G['見た目'] = ['test_theme', 'test_scale', 'test_fit', 'test_typescale', 'test_density',
               'test_uiux', 'test_headbar', 'test_uisize', 'test_bootui',
               'test_gridhead']
G['起動'] = ['test_boot', 'test_bootui', 'test_bootflash', 'test_assetcache', 'test_tabclose',
             # §9.318: 待機画面が見えなくてもアプリへ辿り着ける（保険・置き場の判定）
             'test_faststart', 'test_bootopen',
             # §9.410: デスクトップの起動ショートカットとアイコン（入口を作る側）
             'test_shortcut']
G['接続'] = ['test_mastershare', 'test_storage', 'test_storageui', 'test_recmirror', 'test_dbopen', 'test_dbmirror', 'test_datasource', 'test_tablequery',
             'test_atomicio', 'test_localwork', 'test_dscap',
             'test_qjoin', 'test_qjoinui',
             # §9.258: 測定データは設備ごとに1ファイル（置き場の解決）
             'test_recsplit',
             # §9.317: 読み取り専用のデータソースは写しから読む（cfg()を通す）
             'test_srcread']
G['権限'] = ['test_modeguard', 'test_noaccess', 'test_scperm', 'test_recperm', 'test_pcname',
             # §9.272: 権限区分（開発者/メンテナンス者/一般ユーザー）と接続の管理
             'test_presence', 'test_presenceui',
             # §9.322: 設備作業者とマスタ編集の段（上限・自分の行・書込ガード）。
             # **サーバーと画面の両方**——片方だけでは、サーバーが正しく
             # 答えていても画面が引かない状態を素通りさせる。
             'test_roleperm', 'test_roleui']
# §9.286 ①: 登録フィルタの群・プリセット中心のバー
G['フィルタ'] = ['test_filter', 'test_adhoc', 'test_filterio', 'test_filteruser',
                 'test_filteractive', 'test_filterkeep', 'test_filterlock',
                 'test_filtergroup', 'test_listbar']
# §9.316: 起動の状況をアプリから取れる（`/api/boot-report`＋ログ・診断の帯）。
# 置き場は`paths`が解決した実物を出すので、起動まわりを触ったら一緒に回す。
G['ログ'] = ['test_logs', 'test_logview', 'test_error', 'test_bootreport']
# §9.286 ⑦: 更新履歴の書き方（印は `**`／バッククォート）と窓の作り。
# 説明文の印を解くのは `WL.markup()` の1箇所なので、マスタの説明文を
# 出す画面（test_hintlint / test_maint）も一緒に回す。
G['更新履歴'] = ['test_changelog', 'test_changelogui', 'test_hintlint']
# §9.273: 遅い書き込みに「保存しています…」を出す（api()と保存の帯）
G['保存の帯'] = ['test_savechip']

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
    ('static/js/core/base.js', [ALL]),
    # index.html は全画面のマークアップと起動ローダーを1枚で持っている。
    ('templates/index.html', [ALL]),
    # app.py はアプリの組み立て(Blueprint登録・キャッシュ方針・書込ガード)。
    # 直接実行する4本は`program/`（§9.404）。
    ('program/app.py', [ALL]),
    ('backend/config.py', [ALL]),

    # --- 画面(JS) ----------------------------------------------------
    ('static/js/list/list-view.js', g('一覧', '列', 'test_fit', 'test_uiux', '更新履歴')),
    ('static/js/list/list-columns.js', g('列', 'test_sccontent',
                                    'test_sccols', 'test_cols', 'test_lcpanel')),
    ('static/js/list/list-rules.js', g('列')),
    # §9.256 式で作る自動値も同じ評価器を使う（片方だけ直した状態を作らない）
    ('static/js/list/list-formula.js', g('test_formula', 'test_colpreset', 'test_lcpanel',
                                    'test_opformula')),
    ('static/js/list/filters.js', g('モーダル', 'フィルタ',
                               'test_listcache', 'test_allrows', 'test_nav')),
    # §9.302: 設備の使える機能で予定の設備の候補を絞る
    # §9.502: 段「履歴」の画面
    ('static/js/schedule/schedule-history.js', g('test_schistui', 'test_scale', 'test_theme')),
    ('static/js/schedule/schedule-view.js', g('スケジュール', 'モーダル', 'test_listmodal',
                                     'test_eqfeature')),
    ('static/js/schedule/schedule-print.js', g('モーダル', 'test_scprint')),
    # §9.514: 実際の時刻を手で入れる小窓（予定の画面と段「履歴」が呼ぶ）
    ('static/js/schedule/schedule-times.js', g('test_sctimes', 'test_sctimesedit', 'test_schistui')),
    # 実績データリストは列の設定パネル・帳票・アクセスモードへつながる。
    ('static/js/report/actuals-view.js', g('実績', 'モーダル', '列', 'test_recperm', 'test_nav')),
    ('static/js/report/opsheet-print.js', g('実績', 'モーダル', '列')),
    ('backend/actuals.py', g('実績', 'test_workdate', 'test_modeguard')),
    ('static/js/measure/lot-split.js', g('異常位置', 'test_orphan', 'test_sub')),
    ('static/js/master/master-maint.js', g('マスタ', 'モーダル', '操業意匠', 'test_rawmaster',
                                    'test_headbar', 'test_datasource',
                                     'test_qjoinui', 'test_dscap', 'test_blockbuild', 'test_rbmodal',
                                     # §9.254 (3): 帳票レイアウトマスタ（親子の行き来）
                                     'test_rlmaster',
                                     # §9.286 (7): 説明文の印は WL.markup() の1箇所
                                     '更新履歴')),
    # §9.324 R3: マスタ管理の分割ファイル（盤と同じ網で見る）
    ('static/js/master/master-defs.js', g('マスタ', 'モーダル', '操業意匠', 'test_rawmaster',
                                    'test_headbar', 'test_datasource',
                                     'test_qjoinui', 'test_dscap', 'test_blockbuild', 'test_rbmodal',
                                     # §9.254 (3): 帳票レイアウトマスタ（親子の行き来）
                                     'test_rlmaster',
                                     # §9.286 (7): 説明文の印は WL.markup() の1箇所
                                     '更新履歴')),
    # §9.324 R3: マスタ管理の分割ファイル（盤と同じ網で見る）
    ('static/js/master/master-report.js', g('マスタ', 'モーダル', '操業意匠', 'test_rawmaster',
                                    'test_headbar', 'test_datasource',
                                     'test_qjoinui', 'test_dscap', 'test_blockbuild', 'test_rbmodal',
                                     # §9.254 (3): 帳票レイアウトマスタ（親子の行き来）
                                     'test_rlmaster',
                                     # §9.286 (7): 説明文の印は WL.markup() の1箇所
                                     '更新履歴')),
    # §9.324 R3: マスタ管理の分割ファイル（盤と同じ網で見る）
    ('static/js/master/master-data.js', g('マスタ', 'モーダル', '操業意匠', 'test_rawmaster',
                                    'test_headbar', 'test_datasource',
                                     'test_qjoinui', 'test_dscap', 'test_blockbuild', 'test_rbmodal',
                                     # §9.254 (3): 帳票レイアウトマスタ（親子の行き来）
                                     'test_rlmaster',
                                     # §9.286 (7): 説明文の印は WL.markup() の1箇所
                                     '更新履歴')),
    # §9.324 R3: マスタ管理の分割ファイル（盤と同じ網で見る）
    ('static/js/master/master-opdata.js', g('マスタ', 'モーダル', '操業意匠', 'test_rawmaster',
                                    'test_headbar', 'test_datasource',
                                     'test_qjoinui', 'test_dscap', 'test_blockbuild', 'test_rbmodal',
                                     # §9.254 (3): 帳票レイアウトマスタ（親子の行き来）
                                     'test_rlmaster',
                                     # §9.286 (7): 説明文の印は WL.markup() の1箇所
                                     '更新履歴')),
    # §9.537: ロールマスタの表の計算の列（1周の長さ・見分けにくい相手）。
    ('static/js/master/master-roll.js', g('test_roll', 'test_rollio', 'test_rollwipe')),
    # §9.538: アクセス権限マスタの見張りのタブと行の「できること」。
    ('static/js/master/master-access.js', g('test_roleui', 'test_roleperm')),
    ('static/js/schedule/calendar-view.js', g('test_uisize', 'test_histdel', 'test_headbar')),
    # 帳票の塊の組み換え(§9.169)は列レイアウトマスタに載るので列の網も回す。
    ('static/js/report/report-dashboard.js', g('モーダル', 'test_screport', 'test_headbar', 'test_uisize',
                                        'test_rpblocks', 'test_rplayout', 'test_rpmaster',
                                        # §9.312: 触ったら裏で保存（往復中に触ったぶんを捨てない）
                                        'test_rpsave',
                                        # §9.313: 紙の余白は横と縦の別の軸
                                        'test_rppack',
                                        # §9.319-C: 異常位置判定とピッチ判定を分ける
                                        # §9.320-E/F: 半自動の塊のカスタム・ピッチ判定の狭幅
                                        'test_rpdefect', 'test_rptext',
                                        # §9.302: 設備の候補（ロットの無い設備だけ絞る）
                                        'test_eqfeature',
                                        # §9.254 (3): 帳票レイアウトマスタの口（WL.reportLayout）
                                        'test_rlmaster',
                                        # §9.242 ⑦⑧: 刷るときの紙の箱・品質情報の枠
                                        'test_rpprint',
                                        # §9.253: 見本のロットで帳票を見る
                                        'test_rbsample',
                                        'test_collayout', 'test_actuals')),
    ('static/js/list/quality-analysis.js', g('test_uiux', 'test_headbar', 'test_fit', 'test_theme', 'test_flows', 'test_screenprint')),
    ('static/js/measure/defect-locator.js', g('モーダル', '異常位置')),
    # ロールマスタ（§9.239 ⑥）。マスタの4本セットと判定の両方に効く。
    ('backend/repositories/roll_repo.py', g('マスタ', '異常位置')),
    # 刃組（§9.377）。部材マスタ・ガイダンス・設備停止の連携。
    ('backend/repositories/bladeset_repo.py', g('刃組', 'マスタ')),
    ('backend/routes/masters/bladeset.py', g('刃組', 'test_crudroutes')),
    ('backend/routes/masters/bladeset_parts.py', g('刃組', 'test_crudroutes')),
    # 設備停止の内訳・時間（§9.389）。設備停止マスタの隣なので「スケジュール」も回す。
    # §9.400: 停止内容の複製（`/duplicate`）もここ。画面は設備停止の一覧から呼ぶ。
    ('backend/routes/masters/stop_detail.py', g('マスタ', 'スケジュール', 'test_crudroutes', 'test_scstop')),
    ('static/js/bladeset/blade-core.js', g('刃組')),
    ('static/js/bladeset/blade-pick.js', g('刃組', 'マスタ')),
    ('static/js/bladeset/hold-pick.js', g('刃組', 'マスタ')),
    ('static/js/bladeset/blade-board.js', g('刃組', 'マスタ')),
    ('static/js/bladeset/board-kit.js', g('刃組', 'マスタ')),
    ('static/js/bladeset/rule-table.js', g('刃組', 'マスタ')),
    ('static/js/bladeset/ring-board.js', g('刃組', 'マスタ')),
    ('static/js/bladeset/stock-board.js', g('刃組', 'マスタ')),
    ('static/js/bladeset/standard-board.js', g('刃組', 'マスタ')),
    ('static/js/bladeset/standard-figs.js', g('刃組', 'マスタ')),
    ('static/js/bladeset/blade-3d.js', g('刃組')),
    ('static/js/bladeset/blade-view.js', g('刃組', 'test_scale', 'test_theme')),
    ('static/css/72-bladeset.css', g('刃組', 'test_scale', 'test_theme')),
    # Excelの読み書き（§9.240）。ロールマスタの入出力が唯一の使い手。
    ('backend/xlsx_io.py', g('test_rollio', 'test_roll')),
    ('static/js/core/log-view.js', g('ログ')+['test_feedback']),
    # §9.373: 失敗を開発へ報告できる形で残す（土台なので、知らせを出す画面も見る）
    ('static/js/core/feedback.js', ['test_feedback', 'test_scfail', 'test_uiux']),
    ('static/js/core/pop-menu.js', g('一覧', 'モーダル', 'スケジュール',
                                  'test_recdel', 'test_popmenu')),
    ('static/js/core/access-mode.js', g('権限', 'test_nav')),
    ('static/js/core/wl-window.js', g('test_lcpanel', 'test_listmodal', 'test_split_layout',
                                 'test_scsplit')),
    ('static/js/measure/measure-progress.js', g('test_waiting', 'test_mcore',
                                        'test_msteps')),
    ('static/js/measure/measure-steps.js', g('測定', '見た目')),   # 段の枠は測定画面全体に効く
    # データ一覧の表示列(§9.162)も持つので、列の網も回す。
    ('static/js/measure/records-store.js', g('モーダル', 'test_share', 'test_flows', 'test_master',
                                     'test_recperm', 'test_reccols', 'test_lcpanel',
                                     # §9.302: 使用設備の候補を「測定」で絞る
                                     'test_eqfeature',
                                     # §9.392: 設備ごとに使う入力内容
                                     'test_measitems',
                                     'test_audittrail', 'test_recdel',
                                     # §9.317: 参照データが読めなくても測定は始められる
                                     'test_ctxfail',
                                     # §9.248 ⑥: 見せる範囲を設備で絞る
                                     'test_eqscope',
                                     # §9.257 ②: 使用設備の設定モーダル（作りはここ1箇所）
                                     'test_eqsetup',
                                     # §9.485・§9.521: ③ロット問い合わせのログイン（LotData-Link の有無・入れ方）
                                     'test_lotdsplink')),
    # 測定画面は test_scale(寸法の網)の巡回にも入っている(§9.127)ので見た目も回す。
    # §9.334で `measurement-*` は `measure-*` へそろえ、`measure/` へ移した。
    # 上で名指ししていない残り（view / input / tolerance / worklog）をここが受ける。
    ('static/js/measure/measure-', g('測定', '見た目', 'モーダル')),

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
                                    'test_blockbuild', 'test_rbcells', 'test_rbcatalog')),
    ('static/css/60-report.css', g('見た目', 'test_screport', 'test_rpblocks', 'test_rplayout',
                                   'test_rpprint',
                                   # §9.319-C: 判定の文字を本文並みに・図を最大化
                                   'test_rpdefect',
                                   # §9.320-D/F: 表の文字を本文並みに・ピッチ判定の狭幅
                                   'test_rptext',
                                   # §9.313: 余白の横・縦は別の変数（掛け算）
                                   'test_rppack',
                                   # §9.274: 見出しのマス・ラベル無しのマス・紙への入口
                                   'test_rbcells')),
    ('static/css/62-actuals.css', g('見た目', '実績')),
    ('backend/repositories/report_block_repo.py', g('test_rpmaster', 'test_rpblocks', 'test_rbmodal',
                                                    'test_rplayout', 'test_crudroutes',
                                                    # §9.320-E: 半自動の塊にも既定セルを持たせる
                                                    'test_rptext',
                                                    'test_blockbuild', 'test_opdata',
                                                    # §9.253: 見本のロット1件
                                                    'test_rbsample',
                                                    # §9.274: セルの読み書き（画面と同じ約束）
                                                    'test_rbcells',
                                                    # §9.285 ②④: 候補・既定の中身・生の列
                                                    'test_rbcatalog')),
    # §9.274: サーバーと画面が同じ例を通る（片方だけ直さないための突き合わせ）
    ('tests/fixtures/report_cells.json', g('test_rbcells')),
    ('static/css/88-logs.css', g('見た目', 'test_logview')),

    # --- サーバー(ルート) --------------------------------------------
    ('backend/routes/tables.py', g('一覧', '接続', '列', 'test_colscache', 'test_colsripple',
                                   'test_modeguard')),
    # §9.333で段（`equipment.py`/`operation.py`…）へ分けた。**末尾の`/`で丸ごと**
    # 見る——段ごとに書き分けると、段を1つ足したときだけ当たらずに全件へ倒れる。
    ('backend/routes/masters/', g('マスタ', '列', 'test_modeguard', 'test_apiguard',
                                  'test_mastershare', 'test_body')),
    ('backend/routes/common.py', g('マスタ', 'test_modeguard', 'test_crudroutes', 'test_error')),
    # §9.324 R1: 表の列定義（CREATE・足す・読む・書く）の器。3つのRepoが乗る。
    ('backend/repositories/table_def.py', g('マスタ', '操業データ', '異常位置', 'test_rpmaster',
                                              'test_rpblocks', 'test_rbmodal', 'test_rollio')),
    ('backend/routes/schedule.py', g('スケジュール', 'test_modeguard', 'test_crudroutes')),
    # §9.502: 作業スケジュールの過去履歴（読むだけの口・組み立て）
    ('backend/routes/schedule_history.py', g('test_schedhist', 'test_schistui', 'test_routesplit')),
    ('backend/schedule_history.py', g('test_schedhist', 'test_schistui')),
    ('backend/routes/measurement.py', g('測定', 'test_modeguard', 'test_measstore',
                                        # §9.317: 参照データが読めなくても測定は始められる
                                        'test_recsplit', 'test_srcread', 'test_ctxfail')),
    ('backend/routes/quality.py', g('test_uiux', 'test_headbar', 'test_tablequery',
                                    'test_modeguard', 'test_srcread')),
    ('backend/routes/logs.py', g('ログ', 'test_modeguard')),
    ('backend/routes/path_config.py', g('test_setpage', 'test_datasource', 'test_dbopen',
                                        'test_crudroutes', 'test_modeguard', 'test_dscap',
                                        # §9.267: 置き場を1枚で見せて、その場で直す
                                        'test_storage', 'test_storageui')),
    # §9.267: 置き場の判定は1箇所（storage_layout）。`config/local.json`の
    # 書き換えもここが持つので、起動時の解決を見る網も一緒に回す。
    ('backend/storage_layout.py', g('test_storage', 'test_storageui', 'test_setpage',
                                    'test_measstore', 'test_localwork', 'test_mastershare')),
    ('backend/routes/rne.py', g('test_datasource', 'test_setpage', 'test_modeguard')),
    ('backend/routes/core.py', g('起動', 'test_error', 'test_nav')),

    # --- サーバー(その他) --------------------------------------------
    ('backend/access_mode.py', g('権限', '保存の帯', 'test_nav', 'test_crudroutes', 'test_colscope',
                                 'test_mastershare')),
    ('backend/db_access.py', g('接続', '一覧', 'test_setpage')),
    # データソースの「できること」の判定(§9.163)。列名の別名解決も
    # ここが持つので、品質結合(/api/table)の網も回す。
    # §9.365: 完了突合もこのエンジンに乗る（用途・完了日時列・スケジュール利用）。
    ('backend/query_join.py', g('接続', '列', 'test_dsnav', 'test_sccontent',
                                'test_finishjoin', 'test_actualmatch')),
    ('backend/source_capability.py', g('test_dscap', 'test_datasource', 'test_dsnav',
                                       'test_tablequery', 'test_uiux',
                                       # §9.285 ④: 仕掛の生の列を帳票の候補へ
                                       'test_rbcatalog')),
    ('backend/db_mirror.py', g('test_dbmirror', 'test_dbopen', 'test_listcache',
                               'test_atomicio', 'test_cleanup', 'test_srcread')),
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
    # 権限区分・マスタ編集の判定もここが持つ（§9.272/§9.322）ので「権限」ごと。
    ('backend/repositories/master_repo.py', g('マスタ', '列', '権限', 'test_workable', 'test_oplimit')),
    ('backend/repositories/operation_repo.py', g('操業データ', '操業意匠', 'test_msteps', 'test_mcore')),
    # 操業データの入力欄（§9.215）。測定画面①の中身なので測定一式へ。
    ('static/js/measure/measure-opdata.js', g('操業データ', '測定', '見た目', 'モーダル', '操業意匠')),
    # §9.325: 読む側は写しに書かない（1秒未満のサーバー側の網）
    ('backend/repositories/schedule_repo.py', g('スケジュール', 'test_stopeq', 'test_stopsub', 'test_workdate', 'test_scsnapread')),
    ('backend/schedule_calc.py', g('スケジュール', 'test_eqstd', 'test_workdate',
                                   'test_actualmatch', 'test_finishjoin')),
    # 仕掛から消えたロットの突合（§9.364・§9.365）。
    ('backend/actual_match.py', g('test_actualmatch', 'test_finishjoin',
                                  'test_datasource', 'test_dscap')),
    ('backend/sort_order.py', g('列', 'test_tablequery')),
    ('backend/schedule_watch.py', g('スケジュール')),
    # 共有スケジュールの持ち主(§9.192)。書込の入口(routes/schedule.py)と
    # 書込ガード(access_mode.py)の両方に手が入るので、権限の網も回す。
    ('backend/schedule_owner.py', g('test_scowner', 'test_modeguard', 'test_appquit',
                                    'スケジュール')),
    ('tests/fixtures/sort_cases.json', g('test_sortpipe', 'test_sortcustom')),
    ('backend/schedule_sync.py', g('test_sclock', 'test_scsync', 'test_scwritespeed',
                                   'test_screorder', 'test_atomicio', 'test_scsession',
                                   'test_scwho', 'test_scowner')),
    ('backend/load_factor.py', g('test_scbalance', 'test_sccat', 'test_screport', 'test_eqstd')),
    ('backend/records_export.py', g('test_share', 'test_flows', 'test_measstore',
                                    'test_recsplit')),
    ('backend/logging_setup.py', g('ログ')),
    ('backend/boot_status.py', g('起動')),
    # デスクトップの起動ショートカットとアイコン（§9.410）。設定の画面は
    # 共通設定の「この端末」の章なので、そちらの網も一緒に回す。
    # 盤はヘッダーの「表示」の節（§9.445）。共通設定は「状態と行き先」だけなので、
    # あちらの網（test_setpage）と「表示」の網（test_uisize）の両方を回す。
    ('backend/desktop_shortcut.py', g('test_shortcut', 'test_setpage', 'test_uisize')),
    ('backend/app_icon.py', g('test_shortcut')),
    # 終わる前の片付けと終了ボタン（§9.301 ②）も watchdog が持つ。
    ('backend/watchdog.py', g('test_tabclose', 'test_boot', 'test_presence',
                              'test_appquit', 'test_scowner')),
    # 在席（§9.272）。権限区分の判定は master_repo 側にあるので「権限」ごと。
    ('backend/presence.py', g('権限')),
    ('backend/routes/presence.py', g('権限')),
    ('backend/errors.py', g('test_error')),
    ('backend/paths.py', g('test_setpage', 'test_dbopen', 'test_datasource',
                           'test_localwork', 'test_dbmirror', 'test_cleanup', '起動')),
    ('backend/changelog_data.py', g('test_docindex', 'test_boot', '更新履歴')),
    ('backend/rne_', g('test_datasource', 'test_setpage', 'test_atomicio')),
    ('backend/navigator_api.py', g('test_datasource')),
    ('backend/launcher/', g('起動')),

    # --- 起動まわりの直接実行スクリプト --------------------------------
    # `program/`（§9.404）。受け皿の`program/`は**この下**に置く——`hit`は
    # 当たった規則を全部足すので、`program/app.py`は[ALL]のまま残る。
    ('program/start_app.py', g('起動', 'test_bootreport')),
    ('program/setup_app.py', g('起動')),
    ('program/update.bat', g('起動')),
    ('program/loading.html', g('起動')),
    ('program/process_manager.py', g('起動')),
    ('program/requirements.txt', g('起動', 'test_noaccess')),
    ('program/', g('起動')),

    # --- ドキュメント --------------------------------------------------
    ('docs/', ['test_docindex']),
    ('CLAUDE.md', ['test_docindex']),
    ('.claude/rules/', ['test_docindex']),   # 規則の本体（§9.414）
    ('README.md', ['test_docindex']),

    # --- 検証用データ --------------------------------------------------
    # フィクスチャが変われば全部の前提が変わる。
    ('db/', [ALL]),

    # --- テスト自身 ----------------------------------------------------
    # `tests/test_*.py|js` は表を引くまでもないので pick() が先に拾う。
    # ここに書くのは**テスト以外**の、tests/ の下にあるもの。
    # **`tests/` の受け皿は置かない**——書いていないものは
    # 「当たる規則なし」＝全部回す側へ倒れるのが正しい。
    # 層の宣言（PURE_TESTS/SMOKE_TESTS）を持つので test_layers も回るが、
    # ランナー自体を触ったら通しへ倒す（全部の網の回り方が変わる）。
    ('tests/run_all.sh', [ALL]),
    ('.github/', g('test_layers')),
    ('tests/make_fixture.py', [ALL]),
    ('tests/setperm.py', [ALL]),
    # `import app` の探索先の答え（§9.404）。18本が読むので全部へ倒す。
    ('tests/apppath.py', [ALL]),
    ('tests/make_split_fixture.py', g('test_scsplit')),
    ('tests/orphan_lot.js', g('test_audit', 'test_nav', 'test_orphan')),
    ('tests/audit_scale.js', g('test_audit')),
    ('tests/pick_tests.py', ['test_pick']),
    # §9.326: lint の設定と上限は網そのもの
    ('eslint.config.mjs', ['test_eslint']),
    ('tests/fixtures/eslint_baseline.json', ['test_eslint']),
    ('tests/fixtures/color_baseline.json', ['test_csslint']),
    ('tests/fixtures/import_baseline.json', ['test_importlint']),
    ('tests/fixtures/funclen_baseline.json', ['test_funclen']),
    ('tests/fixtures/wait_baseline.json', ['test_waitlint']),
    ('program/requirements-dev.txt', ['test_pyflakes']),
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
