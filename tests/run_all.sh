#!/bin/bash
# WaveLog 回帰テスト一括実行
# ============================================================
# 使い方: tests/run_all.sh              全部回す(**利用者が指示したときだけ**)
#         tests/run_all.sh test_sccat   名前を並べるとそれだけ
#         tests/run_all.sh --changed    変更ファイルに関係するものだけ(§9.103)
#         tests/run_all.sh --pure       サーバー不要の網だけ・並列(§9.337)
#         tests/run_all.sh --smoke      起動・一覧・スケジュール・測定 各1本
#
# このランナーが保証すること(手作業だった前後処理をここへ集約):
#  1. パス設定マスタ(仕掛/品質/共有スケジュールの接続先)を実行前に退避し、
#     検証用フィクスチャ(db/test_fixture)へ切り替えてサーバーを再起動する。
#  2. 実行後、退避した値へ必ず戻してサーバーを再起動する(異常終了・Ctrl+Cでも)。
#     **戻し忘れると以降の起動が検証用DBを読み続ける**ため、CLAUDE.mdでも
#     注意事項として明記されていた運用。人間の記憶ではなくここで担保する。
#  3. テストごとに必要なアクセスモードを揃える(モードは端末の権限で決まるので、
#     アクセス権限マスタは全許可のまま /api/access-mode で切り替える)。
#
# 環境依存の上書き(未設定なら開発サンドボックスの既定値):
#   WAVELOG_PLAYWRIGHT  playwrightモジュールのパス
#   WAVELOG_CHROMIUM    Chromium実行ファイルのパス
#   WAVELOG_NODE        nodeのパス
# ============================================================
cd "$(dirname "$0")"
ROOT="$(cd .. && pwd)"

NODE="${WAVELOG_NODE:-/opt/node22/bin/node}"
export NODE_PATH="${NODE_PATH:-/opt/node22/lib/node_modules}"
API=http://127.0.0.1:5029
FIXTURE="$ROOT/db/test_fixture"

# ---- --changed: 変更ファイルから絞り込む(§9.103) ---------------------
# **フィクスチャへ差し替える前に決めること。** 差し替えの副産物(共有DBの
# 作業用コピー・退避ファイル)まで「変更」と読むと、規則に当たらないので
# 毎回「分からない＝全部」へ倒れ、絞り込みが一度も効かなくなる。
# 選ばれたものが空なら SELECT も空＝全件(pick_tests.py の安全側の答え)。
if [ "$1" = "--changed" ]; then
  shift
  PICKED="$(python3 "$ROOT/tests/pick_tests.py" "$@")"
  if [ -z "$PICKED" ]; then
    echo "変更が広い(または規則に無いファイル)ため、全件を実行します"
  else
    echo "変更に関係するテストだけ実行します: $PICKED"
    echo "  ※ 絞り込みは手掛かりです。**コミット前は引数なしで通しを回すこと。**"
  fi
  set -- $PICKED
fi

# ---- 層（§9.337、REVIEW 3-13） ---------------------------------------
# 通しは39分かかり、直したいものと関係のない網まで毎回待つことになる。
# **サーバーを立てずに回る網**を1段目として切り出し、並列で回せるようにした。
#
#   tests/run_all.sh --pure    サーバー不要の網だけ（並列。実測22秒）
#   tests/run_all.sh --smoke   煙テスト（起動・一覧・スケジュール・測定 各1本）
#   tests/run_all.sh           全件（**利用者が指示したときだけ**・CLAUDE.md A）
#
# **1段目に載せてよいのは「まっさらな取得（DBも設定もサーバーも無い）で
# そのまま通る」ものだけ。** 決めるのは注意書きではなく**CIそのもの**——
# サーバーを要るものを載せれば、まっさらな取得で回す1段目が落ちる。
# 互いの状態を触らないことが「純粋」の定義なので、並列にしてよい。
# **`--pure` はパス設定の差し替えも見せ方の戻しもしない**（差し替えが要る
# 網は、そもそもここに載っていない）。
PURE_TESTS="test_apiguard test_assetcache test_atomicio test_body test_bootopen test_bladeset \
test_changelog test_cleanup test_csslint test_dblayer test_dbmirror \
test_dbopen test_ddllint test_displayrule test_docindex test_dskeylint \
test_eqstd test_lfpoints test_error test_eslint test_faststart test_flags \
test_globallint test_hintlint test_layers test_loadorder test_localwork test_logs \
test_mastershare test_noaccess test_patchlint test_pcname test_pick \
test_presence test_printcore test_pyflakes test_pywarn test_quietlint \
test_recmirror test_recsplit test_routesplit test_savechip \
test_scsnapread test_scwatch test_shortcut test_sortpipe test_storage test_tabclose \
test_tabledef test_workdate test_waitlint test_importlint test_funclen test_stopsub test_schedhist"
# **`test_tablequery`は1段目に入れない**（§9.369）。サーバーは要らないが
# **仕掛の実データが要る**——まっさらな取得では読み込み先が既定の共有パス
# （`\\Nlmsrvngy03\...`）に落ちるので必ず落ちる。1段目の約束は
# 「DBも設定もサーバーも無い取得でそのまま通る」ことなので、ここには置けない。
# 2段目。**全部の代わりではなく「動いていること」の確認**なので各1本だけ。
SMOKE_TESTS="test_boot test_bootui test_flows test_sccat test_mcore"

if [ "$1" = "--pure" ]; then
  JOBS="${WAVELOG_TEST_JOBS:-8}"
  echo "--- 純粋な網（サーバー不要・並列 $JOBS） ---"
  T0=$(date +%s)
  PURE_OUT="$(mktemp -d)"; export PURE_OUT
  trap 'rm -rf "$PURE_OUT"' EXIT
  # **並列で回していることを本へ伝える**（§9.369）。共有の`db/`を見る網は、
  # 隣の本が作ったファイルを自分のせいにできない——測れないことを
  # 「変わっていない」とも「変えた」とも言わせないため、印を1つ渡す。
  export WAVELOG_PARALLEL=1
  printf '%s\n' $PURE_TESTS | xargs -P "$JOBS" -I@ sh -c \
    'timeout 300 python3 "@.py" >"$PURE_OUT/@.log" 2>&1; echo $? >"$PURE_OUT/@.rc"'
  TOT=0; NG=0; RAN=0
  for t in $PURE_TESTS; do
    # **`grep -c` は0件でも数を出して終了コード1を返す。** `|| echo 0` を
    # 添えると "0\n0" になり、`$(( ))` が構文エラーで止まる——しかも
    # **終了コード0のまま「合計 0/0 PASS」と出た**（緑に見えている壊れた
    # 網は赤より悪い・§9.200）。数を取るのに `||` を使わない。
    rc=1; [ -f "$PURE_OUT/$t.rc" ] && rc=$(cat "$PURE_OUT/$t.rc")
    p=0; f=0
    if [ -f "$PURE_OUT/$t.log" ]; then
      p=$(grep -c '^PASS' "$PURE_OUT/$t.log"); f=$(grep -c '^FAIL' "$PURE_OUT/$t.log")
      RAN=$((RAN+1))
    fi
    # 途中で落ちたものを「全部PASS」と数えない（§9.200）。終了コードで見る。
    bad=$f; [ "$rc" -ne 0 ] && [ "$f" -eq 0 ] && bad=1
    TOT=$((TOT+p+f)); NG=$((NG+bad))
    printf '%-24s %3d PASS / %d FAIL%s\n' "$t.py" "$p" "$f" \
      "$([ "$rc" -ne 0 ] && [ "$f" -eq 0 ] && echo '  [FATAL exit '"$rc"']')"
    [ "$bad" -gt 0 ] && grep -E '^FAIL|FATAL|Error' "$PURE_OUT/$t.log" | head -4 | sed 's/^/      /'
  done
  # **1本も回っていないのに緑を出さない。** 名前を打ち間違えた・xargsが
  # 動かなかった、を「異常なし」と読ませない（§9.200）。
  N=$(printf '%s\n' $PURE_TESTS | wc -l)
  if [ "$RAN" -ne "$N" ]; then
    echo "FATAL: $N 本のうち $RAN 本しか回っていません"; NG=$((NG+1))
  fi
  echo
  echo "=================================================="
  echo "  純粋な網 $((TOT-NG))/$TOT PASS  (FAIL/FATAL: $NG)  $RAN/$N 本  所要 $(( $(date +%s) - T0 ))秒"
  echo "=================================================="
  exit $([ $NG -gt 0 ] && echo 1 || echo 0)
fi

if [ "$1" = "--smoke" ]; then shift; set -- $SMOKE_TESTS "$@"; fi

# いまの群のモードを控える（落ちた本を単独で回し直すとき、**その本が走ったモードへ戻す**ため。§9.533）。
CUR_MODE=""
mode(){ CUR_MODE="$1"; curl -s -X POST $API/api/access-mode -H 'Content-Type: application/json' -d "{\"mode\":\"$1\"}" >/dev/null; }
# 「見せ方」の設定(内容欄の項目・列レイアウト)を検証用設備ぶんだけ白紙へ戻す。
# **これらはマスタDBに残り、実行をまたいで生き延びる。** 共有スケジュールDBは
# 作業用コピーを作り直す・作業予定は1本ごとにreseedする、と手当てがあるのに
# ここだけ素通しだったため、後片付け前に落ちたテストや手元の確認スクリプトが
# 残した設定を**次の実行が丸ごと引き継いだ**。しかも壊れ方が遠い——
# `timeline:テスト設備A` で lotNo が非表示のまま残っていたせいで、内容欄とは
# 何の関係も無い test_orphan が「実績がスケジュールに出ない」で3件落ちた
# (行の題名はロット番号を出す内容セルなので、隠すと探せなくなる)。
# 実行のたびに結果が変わるのでは安全網にならないので、**開始時に必ず戻す**。
resetcontent(){
  curl -s -X POST $API/api/schedule-content-master -H 'Content-Type: application/json' \
    -d '{"equipment":"テスト設備A","items":[],"user_id":"test"}' >/dev/null
  # 列レイアウトマスタは「送った項目だけ書く」(§9.212 ②)ので、まっさらに
  # 戻すときは**`clear:true`**を付ける。**付け忘れると送っていない設定だけが
  # 生き延びる**——前の実行の置き土産が次の実行へ残る(§9.121)。
  # `report:<設備>`も戻す（§9.219 ②）。既定の帳票ブロックがマスタに載った
  # ので、幅・行数・出す/出さないを触ったテストの置き土産がここに残る。
  # `report:スリッター1号`は**見本のロットの設備**（§9.253）。test_rbcellsが
  # 「一度配置を保存した紙」を作るので、戻さないと次の実行が引き継ぐ。
  for tg in 'timeline:テスト設備A' 'print:テスト設備A' 'report:テスト設備A' 'report:共通' 'report:スリッター1号'; do
    curl -s -X POST $API/api/column-layout-master -H 'Content-Type: application/json' \
      -d "{\"target\":\"$tg\",\"clear\":true,\"order\":[],\"hidden\":[],\"widths\":{},\"names\":{},\"formats\":{},\"rules\":{},\"formulas\":{},\"locks\":[],\"sorts\":{},\"user_id\":\"test\"}" >/dev/null
  done
  # 既定の帳票ブロックの`[内容]`の後片付けは**`tests/make_fixture.py`の
  # `fix_master()`が持つ**（§9.285 ②）。以前はここでも消していたが、
  # `contentEditable`が偽の塊だけを対象にしていたため、§9.285 ②で
  # `寸法（オーダー／製造）`等が編集できるようになった瞬間に**その4つの
  # 置き土産だけが残る**ようになった。**同じ後片付けを2箇所に置かない**
  # （§CLAUDE 8）——`reseed`は1本ごとに走るので、あちらのほうが強い。
}

# 測定の実績（`db/records.sqlite3`）も**実行をまたいで生き延びる**（§9.356）。
# 作業予定は`reseed`、見せ方は`resetcontent`で戻していたが、ここだけ素通しだった。
# 残った実績は**計画外実績として予定表に現れ**（§9.33）、行数・作業可否・
# 「作業中」の有無を変える——後片付けを忘れた1本が、無関係な網を落とす。
# 壊れ方が遠いので、落ちた側を見ても原因に辿り着けない（実測: 6件残っていた）。
# **1本ごとに空へ戻す**（§9.121 と同じ理由。開始時に1回では前の本の分が渡る）。
# 実績を前提にする網は**自分で置いて自分で消す**（§9.351）。
# **道は絶対で書く。** ランナーは`cd tests`してから走るので、`db/records.sqlite3`
# のような相対の道は`tests/db/...`を指し、**存在しないので何も起きない**——
# 例外にもならないので、`resetrecords`は入れた日から一度も動いていなかった
# （§9.360の指紋が`Web測定バックアップ ±1`を名指しして初めて分かった。
# `tests/state_fp.py`も同じ形で黙って0行を読んでいた）。
# **黙って何もしない後片付けは、無い後片付けより悪い**（あるつもりになる）。
resetrecords(){
  WAVELOG_RECORDS_DB="$ROOT/db/records.sqlite3" python3 - <<'PYEOF'
import sqlite3, os, pathlib
p = pathlib.Path(os.environ['WAVELOG_RECORDS_DB'])
if not p.exists():
    print('!! 実績DBが見つかりません: %s' % p)
else:
    try:
        c = sqlite3.connect(p, timeout=5)
        n = c.execute('SELECT COUNT(*) FROM "Web測定バックアップ"').fetchone()[0]
        if n:
            c.execute('DELETE FROM "Web測定バックアップ"')
            c.commit()
        c.close()
    except Exception as e:
        print('!! 実績を空へ戻せませんでした: ' + str(e)[:80])
PYEOF
}

# ============================================================
# 共有状態を「丸ごと」戻す／汚した本を名指しする（§9.360）
# ============================================================
# **なぜ要るか**: `reseed`(= make_fixture.py の fix_master) は**知っている行しか
# 戻さない**。テストが増えるたびに戻し漏れの行が増え、片付け損ねた1本が以降
# ぜんぶを巻き添えにする。しかも落ちるのは**被害者のほう**なので、直すべき本に
# 辿り着けない——「毎回ちがう数本が赤／単独では緑」を繰り返した原因がこれで、
# §9.121・§9.284・§9.356 はどれも**対症療法**だった（戻す行を1つずつ足していた）。
#
# **やり方**: マスタDB(360KB)を開始時に1枚控え、**1本ごとにファイルごと戻す**。
# 知っている行かどうかに関係なく白紙へ帰るので、戻し漏れが原理的に無くなる。
# `journal_mode=delete`(WAL無し)なのでファイル差し替えで安全。テストの合間は
# 通信が無いので、開いた接続の下で差し替わることもない。
MASTER_DB="$ROOT/db/master.sqlite3"
MASTER_SNAP="$ROOT/tests/.master_snapshot.sqlite3"
snap_master(){
  rm -f "$MASTER_DB-journal"
  cp -f "$MASTER_DB" "$MASTER_SNAP" 2>/dev/null \
    || echo "!! マスタを控えられませんでした（このあとは reseed 頼みになります）" >&2
}
restore_master(){
  [ -f "$MASTER_SNAP" ] || return 0
  rm -f "$MASTER_DB-journal"
  cp -f "$MASTER_SNAP" "$MASTER_DB" 2>/dev/null || echo "!! マスタを戻せませんでした" >&2
}
# 共有状態の指紋(表ごとの行数)。**汚した本をその場で名指しする**ために使う。
# 戻すのは restore_master がやるので、これは「誰が汚したか」を言うだけ。
fingerprint(){
  python3 "$ROOT/tests/state_fp.py" 2>/dev/null
}
server_up(){ curl -s -m 3 -o /dev/null "$API/" 2>/dev/null; }

# テストが異常終了するとPlaywrightのChromiumが残る。残った画面は設備の
# 編集セッションを掴んだままハートビートを打ち続けるため、後続のスケジュール
# 系テストが「編集中です」で連鎖的に落ちる(実際に1本のFATALから8本が落ちた)。
# 各テストは自分でfinallyで閉じるが、取りこぼしに備えてランナー側でも掃除する。
# --user-data-dirで絞るので、Playwrightが起動したものだけが対象。
reap_browsers(){ pkill -f -- '--user-data-dir=/tmp/playwright_chromiumdev_profile' >/dev/null 2>&1; true; }
restart_server(){
  ( cd "$ROOT" && python3 program/process_manager.py stop >/dev/null 2>&1 )
  sleep 1
  ( cd "$ROOT" && nohup python3 -u program/start_app.py >"$ROOT/tests/server.log" 2>&1 & )
  for _ in $(seq 1 30); do server_up && return 0; sleep 1; done
  echo "!! サーバーを起動できませんでした ($ROOT/tests/server.log を確認)" >&2
  return 1
}

# ---- パス設定の退避 / 差し替え / 復元 -------------------------------
# 退避した値はディスクにも書く。trapはプロセスが死ぬときにしか走らないので、
# コンテナごと落ちるような終わり方では復元されないまま残る。その状態で次の
# 実行が「今の値」を退避すると、退避されるのは検証用フィクスチャのパスで、
# 本来の設定が上書きで永久に失われる(実際に起きた)。ファイルが残っていたら
# 前回が復元前に終わった証拠なので、そちらを真とする。
# ---- 二重起動の禁止 -------------------------------------------------
# 2本同時に走ると、先に終わった方のtrapが**実行中のもう1本の足元で**
# パス設定を本番へ戻してサーバーを再起動する。走っている方はそこから
# 本番の共有パスを読みに行って全部500になり、ブラウザも落とされて
# FATALが連鎖する(実際に起きた)。原因が分かりにくいのでここで止める。
LOCK="$ROOT/tests/.run_all.lock"
if [ -e "$LOCK" ] && kill -0 "$(cat "$LOCK" 2>/dev/null)" 2>/dev/null; then
  echo "!! すでに tests/run_all.sh が動いています (PID $(cat "$LOCK"))。" >&2
  echo "   終わってから実行してください。強制解除するなら $LOCK を消します。" >&2
  exit 2
fi
echo $$ > "$LOCK"
release_lock(){ [ "$(cat "$LOCK" 2>/dev/null)" = "$$" ] && rm -f "$LOCK"; }
# 全体の所要時間（§9.324 R5）。本ごとの秒数だけでは「ランナーの固定費」が
# 見えない——実測: 固定費は約9秒、1本あたり約0.3秒。残りは本の中の固定待ち。
T_START=$(date +%s)

SAVED_PATHS=""
SAVED_FILE="$ROOT/tests/.saved_paths.json"
save_paths(){
  server_up || restart_server || exit 1
  mode edit
  if [ -s "$SAVED_FILE" ]; then
    SAVED_PATHS=$(cat "$SAVED_FILE")
    echo "!! 前回の実行が復元前に終了していました。退避ファイルの値で復元します: $SAVED_FILE" >&2
    return 0
  fi
  SAVED_PATHS=$(python3 - <<'PY'
import json,urllib.request
d=json.loads(urllib.request.urlopen('http://127.0.0.1:5029/api/path-config-master',timeout=20).read())
print(json.dumps(d.get('values') or {},ensure_ascii=False))
PY
)
  [ -n "$SAVED_PATHS" ] || { echo '!! パス設定を退避できませんでした' >&2; exit 1; }
  printf '%s' "$SAVED_PATHS" > "$SAVED_FILE"
  echo "パス設定を退避しました"
}
apply_paths(){   # $1 = JSON(値の辞書)
  mode edit
  WL_PAYLOAD="$1" python3 - <<'PY'
import json,os,urllib.request
v=json.loads(os.environ['WL_PAYLOAD'])
keys=['sikalot_source','sikalotnow_path','sikalotdef_path','sikalotact_path',
      'records_backup_export_path',
      'schedule_share_path','rne_extract_enabled','rne_extract_interval_sec',
      'schedule_lock_ttl_sec','schedule_lock_verify_delay_ms',
      # RNE資材・接続情報の置き場(§9.79)。テストが書き換えるので退避対象に含める。
      'rne_assets_dir','rne_conf_path']
body={k:v.get(k,'') for k in keys}; body['user_id']='tests'
req=urllib.request.Request('http://127.0.0.1:5029/api/path-config-master',
  data=json.dumps(body).encode(),headers={'Content-Type':'application/json'})
urllib.request.urlopen(req,timeout=30).read()
PY
}
restore_paths(){
  reap_browsers
  [ -n "$SAVED_PATHS" ] || return 0
  server_up || restart_server || return 1
  apply_paths "$SAVED_PATHS" && { echo "パス設定を元へ戻しました"; rm -f "$SAVED_FILE"; }
  SAVED_PATHS=""
  restart_server >/dev/null 2>&1
}
# 指紋などの一時ファイルの置き場。**後始末は既存の trap へ畳み込む**——
# `trap ... EXIT` をもう1つ書くと**前のものを上書きする**（パス設定を戻す・
# ロックを外すが動かなくなる。実際に一度そう書いて気づいた。§9.360）。
WL_TMP="${TMPDIR:-/tmp}/wavelog_run_$$"; mkdir -p "$WL_TMP"
trap 'restore_paths; release_lock; rm -rf "$WL_TMP"' EXIT INT TERM

save_paths
# 共有スケジュールDBはテストが書き換える(予定の追加・並べ替え・ロック)ので、
# gitが持つ原本ではなく作業用コピーを使う。原本を直接使うと、テストを回すたびに
# 追跡ファイルが変わり `git status` が汚れ続け、意味のないバイナリ差分が
# コミットに混ざる。仕掛/品質データは読み取り専用なので原本のままでよい。
WORK="$FIXTURE/work"
rm -rf "$WORK"; mkdir -p "$WORK"
cp "$FIXTURE/share/schedule.sqlite3" "$WORK/schedule.sqlite3"
export WAVELOG_FIXTURE_SHARE="$WORK/schedule.sqlite3"
apply_paths "$(python3 - <<PY
import json
print(json.dumps({'sikalotnow_path':'$FIXTURE/sikalotnow_test.sqlite3',
                  'sikalotdef_path':'$FIXTURE/sikalotdef_test.sqlite3',
                  # 役割「実績」(§9.364)。仕掛に居ないロットを3件だけ持つ。
                  'sikalotact_path':'$FIXTURE/sikalotact_test.sqlite3',
                  'schedule_share_path':'$WORK/schedule.sqlite3'},ensure_ascii=False))
PY
)"
echo "検証用フィクスチャへ切り替えました: $FIXTURE (共有DBは $WORK の作業用コピー)"
restart_server || exit 1

# ---- 実行 ------------------------------------------------------------
# 引数を渡すと、そのテストだけ実行する(拡張子は省略可)。前後のパス退避・
# 復元はそのまま効くので、1本だけ直したいときの再現に使える。
#   tests/run_all.sh test_screport test_sccat
SELECT="$*"
want(){
  [ -z "$SELECT" ] && return 0
  n="${1%.*}"
  for s in $SELECT; do [ "${s%.*}" = "$n" ] && return 0; done
  return 1
}

# テストごとに作業予定を種データへ戻す。テストは共有フィクスチャを書き換える
# ので、戻さないと「前のテストが並べ替えた順」「後片付け前に落ちたテストが
# 残したロック」を次のテストが引き継ぐ。行を位置で掴むテストが、単体では
# 通るのに通しで回すと落ちる原因になっていた(実際に3本が落ちた)。
# 実行のたびに結果が変わるのでは安全網にならないので、1本ごとに揃える。
# **失敗を握り潰さないこと。** 以前は `>/dev/null 2>&1` で捨てていたため、
# 共有DBがロックされていて種入れが失敗しても気づけず、前のテストが残した
# 予定のまま次が走っていた(通しで回したときだけ test_audit/test_nav が
# 「索引が仕掛の全件をカバーする」で落ちる、という再現しにくい形で出た)。
# 1度だけ待って再試行し、それでも駄目なら画面に出す。
reseed(){
  local out
  out=$(python3 "$ROOT/tests/make_fixture.py" 2>&1) && return 0
  sleep 1
  out=$(python3 "$ROOT/tests/make_fixture.py" 2>&1) && return 0
  echo "!! 種データを戻せませんでした(このあとのテストは前の状態を引き継ぎます)" >&2
  echo "$out" | tail -3 | sed 's/^/   /' >&2
  return 1
}

TOT=0; NG=0; RETRY=""; DIRTY=""
# 所要時間も出す。**遅いテストは「固定待ち」を書いている**ことが多く、
# 削るか直すかを決めるのに数字が要る(docs/REFACTORING_PLAN.md フェーズF)。
# 秒数はマシンで変わるので、判断に使うのは**本数あたりの秒数**。
TIMES=""
run(){
  want "$2" || return 0
  reseed
  # **1本ごとにサーバーの生存を確かめる。** VER2.12.0でタブを閉じてから
  # 終了するまでが90秒→8秒になったため、テストがブラウザを閉じてから次の
  # テストが画面を開くまでに8秒以上あくと、その隙にアプリが自分で終了する
  # (「開いているタブが0件」の正しい振る舞い)。以前は90秒あったので偶然
  # 間に合っていただけで、テストを1本足すだけで崩れる。curl 1回で防ぐ。
  server_up || restart_server || echo "!! サーバーを起動できないまま $2 を実行します" >&2
  # **見せ方の設定は1本ごとに戻す**（§9.303 ③の追補）。紙の配置は
  # 「触ったら裏で保存」になったので、**組み換えを開いて何か触ったテストは
  # 必ず`report:<設備>`を残す**——以前は「やめる」で下書きが捨てられたので
  # 残らなかった。開始時に1回だけ戻す形では、前のテストの置き土産が次の
  # テストへそのまま渡る（実測: `test_rbcatalog`が別の塊の紙を読んで4件落ち、
  # `test_rpblocks`が組み換えの待ちで落ちた）。**実行のたびに結果が変わるので
  # は安全網にならない**ので、1本ごとに白紙から始める（§9.121）。
  # **マスタは丸ごと戻す**（§9.360）。`reseed`は知っている行しか戻さないので、
  # 戻し漏れが1つでもあると以降の本を巻き添えにする。ファイルごと差し替える。
  restore_master
  resetcontent
  resetrecords
  # 共有状態の指紋を控える（**汚した本を名指しする**ため。§9.360）。
  FP_BEFORE="$WL_TMP/fp_before"; FP_AFTER="$WL_TMP/fp_after"
  fingerprint > "$FP_BEFORE" 2>/dev/null
  t0=$(date +%s)
  out=$($1 "$2" 2>&1); rc=$?
  # 1本ぶんの生ログを残したいときだけ（既定は残さない）。落ちた場所を
  # 探すのに要る——要約だけでは「どのPASSまで進んだか」が分からない。
  if [ -n "$WAVELOG_TEST_LOGDIR" ]; then printf '%s\n' "$out" > "$WAVELOG_TEST_LOGDIR/$2.log"; fi
  dt=$(( $(date +%s) - t0 ))
  p=$(echo "$out" | grep -c '^PASS'); f=$(echo "$out" | grep -c '^FAIL')
  fatal=$(echo "$out" | grep -c 'FATAL')
  # **途中で落ちたテストを「全部PASS」と数えない。** Pythonのテストが
  # 例外で止まると、そこまでのPASSだけが出力に残り FAIL も 'FATAL' の字も
  # 出ない——実際に `test_opdata.py` が NameError で止まったまま
  # 「59 PASS / 0 FAIL」と表示された。**赤いまま残っている網は網ではないが、
  # 緑に見えている壊れた網はもっと悪い**（§9.200）。終了コードで見る。
  if [ "$rc" -ne 0 ] && [ "$f" -eq 0 ] && [ "$fatal" -eq 0 ]; then
    fatal=1
    out="$out
FATAL: 途中で終了しました (exit $rc)。最後のPASSの直後を見てください。"
  fi
  # 落ちた本を控える。通しの最後に**単独で回し直して切り分ける**（§9.356）——
  # 「通しでだけ落ちる（順番・状態への依存）」と「単独でも落ちる（本物）」は
  # 直し方がまるで違うのに、今までは通しをもう一度回さないと分からなかった。
  if [ $((f+fatal)) -gt 0 ]; then RETRY="$RETRY$1 $2 $CUR_MODE
"; fi
  # **共有状態を残した本をその場で名指しする**（§9.360）。戻すのは次の本の
  # `restore_master`がやるので実害は無いが、**後片付けを忘れた本**はここでしか
  # 分からない——今までは「無関係な本が落ちる」形でしか現れず、被害者のほうを
  # 直していた。`WAVELOG_NO_FP=1`で止められる。
  if [ -z "$WAVELOG_NO_FP" ]; then
    fingerprint > "$FP_AFTER" 2>/dev/null
    # **名指しは「差の中身」があるときだけ**。ファイルを丸ごと比べると、サーバーが初めて使う表を
    # 0行で作っただけでも名指しされ、**内訳が空の名指し**になっていた（片付けようが無い・
    # `sqlite_sequence`を数えないのと同じ理由。差の数え方は`state_fp.py`の1箇所）。
    if ! cmp -s "$FP_BEFORE" "$FP_AFTER"; then
      fpdiff=$(python3 "$ROOT/tests/state_fp.py" "$FP_BEFORE" "$FP_AFTER")
      [ -n "$fpdiff" ] && DIRTY="$DIRTY$2|$fpdiff
"
    fi
  fi
  TOT=$((TOT+p+f)); NG=$((NG+f+fatal))
  TIMES="$TIMES$dt $((p+f)) $2\n"
  printf '%-24s %3d PASS / %d FAIL  %4ds%s\n' "$2" "$p" "$f" "$dt" "$([ $fatal -gt 0 ] && echo ' [FATAL]')"
  echo "$out" | grep -E '^FAIL|FATAL' | head -4 | sed 's/^/      /'
  # **待ちが成立しなかった事実を添える**（§9.360）。失敗の表明だけを見ると
  # 「値が合わない」に見えるが、実際は**待ちが timeout して古い値のまま
  # 比べていた**ことが多い。原因が要約の中で読めるようにする。
  if [ $((f+fatal)) -gt 0 ]; then
    echo "$out" | grep -E '^WAIT-TIMEOUT' | head -3 | sed 's/^/      ↳ /'
  fi
  reap_browsers
}

echo "--- 起動(サーバーを再起動する) ---"
# 前の実行の置き土産(内容欄の項目・列レイアウト)をここで落とす。1本だけ
# 実行するとき(`run_all.sh test_orphan`)も同じ白紙から始められるように、
# テストを選ぶより前に置く。
resetcontent
# **控える前に、マスタの表を作らせる**（§9.370）。`bootstrap()`が作るのは
# `データソースマスタ`・`パス設定マスタ`・`クエリ結合マスタ`の3つだけで、
# 残りは**画面が最初に触ったときに作られる**。まっさらな取得ではその前に
# ここへ来るので、`reseed`が「表が無い」で種を1件も入れられず、しかも
# **その不完全なマスタを`snap_master`が「あるべき姿」として控えて**、
# 1本ごとに戻していた——`テスト設備A`が最後まで現れず、`test_sccat`が
# `.sc-board-row`を10秒待って落ちた（CIの2段目でだけ出た。開発機の`db/`は
# 何度も動かした結果なので、表がそろっている）。
# **口は製品のものを使う**（DDLをここへ書き写さない・§9.216）。
warm_master(){
  for u in /api/equipment-master /api/operation-item-master \
           /api/operation-choice-master /api/choice-link-master \
           /api/report-block-master /api/display-rule-master \
           /api/list-view-master /api/column-preset-master \
           /api/access-permission-master /api/roll-master \
           /api/filter-presets /api/sort-presets \
           /api/schedule/shift-pattern-master /api/schedule/stop-category-master \
           /api/schedule/stop-reason-master /api/schedule/row-style-master; do
    curl -s "$API$u" >/dev/null
  done
}
warm_master
# **この端末の名乗りをフィクスチャへ渡す**（§9.370）。`アクセス権限マスタ`が
# 空だと既定は「編集可・スケジュール不可」なので、まっさらな取得では
# スケジュールモードへ入れず、俯瞰ボードが最後まで出ない。誰の・どの端末かに
# 答えるのは`current_login_id()`／`current_pc_name()`の1箇所なので、
# **推測せず製品に聞く**（`make_fixture.py`は`backend`をimportしない）。
WAVELOG_FIXTURE_LOGIN=$(curl -s "$API/api/access-mode" | python3 -c \
  "import sys,json;print((json.load(sys.stdin).get('loginId') or ''))" 2>/dev/null)
WAVELOG_FIXTURE_PC=$(curl -s "$API/api/access-mode" | python3 -c \
  "import sys,json;print((json.load(sys.stdin).get('pcName') or ''))" 2>/dev/null)
export WAVELOG_FIXTURE_LOGIN WAVELOG_FIXTURE_PC
# **白紙のマスタを1枚控える**（§9.360）。ここから先、1本ごとにこれへ戻す。
# 控えるのは`reseed`(種データ)と`resetcontent`(見せ方)を通した**直後**——
# ここが「あるべき姿」で、以降どの本が何を足しても必ずここへ帰る。
reseed
# **種が入ったことを確かめる**（§9.370）。入っていないまま控えると、以降
# ぜんぶの本が「設備が1つも無い」画面を見る——しかも落ちるのは
# 30秒待った先なので、原因が遠い。**黙って進まない。**
if ! WAVELOG_MASTER_DB="$MASTER_DB" python3 - <<'PYCHK'
import sqlite3, sys, os, pathlib
p = pathlib.Path(os.environ['WAVELOG_MASTER_DB'])
if not p.exists():
    print('!! マスタDBがありません: %s' % p); sys.exit(1)
c = sqlite3.connect(p)
have = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
if '設備マスタ' not in have:
    print('!! 設備マスタの表がありません（warm_master が効いていません）'); sys.exit(1)
n = c.execute('SELECT COUNT(*) FROM [設備マスタ] WHERE [設備名] LIKE ?', ['テスト設備%']).fetchone()[0]
if n < 2:
    print('!! 検証用の設備が入っていません（%d件）。このあとの本は設備の無い画面を見ます' % n); sys.exit(1)
PYCHK
then
  echo "   種データを入れ直せないので、ここで止めます（黙って進むと原因の遠い赤が並びます）" >&2
  exit 1
fi
# **「入れた」ではなく「効いた」で確かめる**（§9.370）。権限は行を書くだけでは
# 済まない——マスタを読むのはリクエストのたびなので、**実際に切り替えて**
# 200が返ることを見る。403のまま進むと、スケジュール系の網が全部
# 「編集モードの画面」を見ることになり、落ちるのは10〜30秒待った先になる。
if [ "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/api/access-mode" \
        -H 'Content-Type: application/json' -d '{"mode":"schedule"}')" != "200" ]; then
  echo "!! この端末はスケジュールモードへ切り替えられません（アクセス権限マスタの" >&2
  echo "   [スケジュール可否]が入っていない）。名乗り: '$WAVELOG_FIXTURE_LOGIN' / '$WAVELOG_FIXTURE_PC'" >&2
  exit 1
fi
mode edit
snap_master
run python3 test_boot.py
sleep 3

echo "--- 一般UI (editモード) ---"
mode edit
for t in test_stopcat test_stopsubui test_workable test_wkbg test_mcore test_burr test_ngcard test_ngdone test_devdigits test_recvalues test_reclayout test_ctxfail test_msteps test_orphan test_audit test_sub test_maint test_setpage test_nav test_navwords test_popmenu test_uiux test_histdel test_uisize test_master test_mmtable test_shift test_measstore test_waiting \
         test_listcache test_ttlcache test_flows test_dbequip test_course test_tolscale test_defect test_theme test_scale test_fit test_bootui test_density test_filter test_adhoc test_stopeq test_mmswitch test_eqkind test_eqfeature test_equse test_lfui test_measitems test_bootflash test_dsnav test_opui test_collayout test_colformat test_colrule test_colsort test_typescale test_lcpanel test_colmenu test_colpreset test_colsrcfx test_formula test_share test_listperf test_allrows test_logview test_bootreport test_headbar test_gridhead test_reccols test_rpblocks test_rpprint test_rpdefect test_rptext test_rplayout test_rpsave test_rppack test_rpmaster test_filterio test_filteruser test_filteractive test_colio test_multidrag test_sortcustom test_filterkeep test_filterlock test_dsrestart test_qjoinui test_modalkeep test_opchoice test_recdel test_blockbuild test_rbmodal test_rbsample test_rlmaster test_oppad test_oplimit test_oprange test_opmother test_opunit test_opauto test_opformula test_opblank test_opinline test_opwidget test_mround test_colkeep test_eqscope test_coltint test_gridchild test_roll test_mmfold test_actuals test_opsheet test_rollload test_rollwipe test_eqsetup test_colscopeui test_storageui test_presenceui test_savechip test_rbcells test_rbcatalog test_changelogui test_filtergroup test_opblanktint test_opparent test_choicelinkui test_roleui test_bladeui test_bladepick test_holdpick test_bladesets test_ringboard test_bladeboard test_screenprint test_partboards test_listbar test_lotdsplink; do run $NODE $t.js; done

echo "--- スケジュール (テスト側でモードを切り替える) ---"
for t in test_screport test_startwork test_scsync test_sccat test_scbalance test_scbatch \
         test_screorder test_scperm test_scperf test_wkfast test_scsplit test_splitlive test_scprint test_scdrop test_scpick test_sccontent test_recperm test_sctimecols test_scinsert test_audittrail test_scstop test_stopflow test_stoppos test_scscrap test_scsubtotal test_sccolpanel test_schistui test_sctimes test_sctimesedit test_scwarm test_scundecided test_scwatchui test_sccomment test_scframe test_scrowstyle test_schistory test_scbar test_scsave test_scwho test_scmodecols test_wipgone test_lotcopy test_scfail test_feedback test_scdragscroll test_srcsync test_plandup test_defectlink test_appquit; do run $NODE $t.js; done

echo "--- スケジュール (scheduleモード固定) ---"
mode schedule
resetcontent
for t in test_cols test_listmodal test_split_layout test_sccols; do
  run $NODE $t.js; resetcontent; done

echo "--- サーバー側 ---"
mode schedule
for t in test_sclock test_scsession test_scwritespeed test_colscache test_colsripple test_colsave test_opdata test_choicelink test_modeguard test_noaccess test_pcname \
         test_csslint test_dbopen test_error test_datasource test_dscap test_dskeylint test_dbmirror test_atomicio test_localwork test_displayrule test_eqstd test_lfpoints test_actualmatch test_finishjoin test_crudroutes test_tablequery test_patchlint test_globallint test_assetcache test_tabclose test_logs test_docindex test_sortpipe test_scwatch test_scowner test_qjoin test_workdate test_scload test_faststart test_bootopen test_rollio test_cleanup test_rawmaster test_recsplit test_colscope test_mastershare test_storage test_recmirror test_srcread test_presence test_roleperm test_savechip test_rbcells test_pywarn test_hintlint test_ddllint test_changelog test_pick test_flags test_apiguard test_tabledef test_loadorder test_scsnapread test_pyflakes test_eslint test_quietlint test_dblayer test_body test_printcore test_routesplit test_layers test_waitlint test_importlint test_funclen test_bladeset test_stopsub test_shortcut test_schedhist; do run python3 $t.py; done

# ---- 落ちた本を単独で回し直して切り分ける（§9.356） -------------------
# 「通しでだけ落ちる」と「単独でも落ちる」は**直し方がまるで違う**:
#   前者 … 順番・前の本の置き土産・サーバーの状態への依存（網かランナーを直す）
#   後者 … 本物（製品か、その網の期待そのもの）
# 今までは切り分けるのに**通しをもう一度回して**いた（1回32分）。落ちた本だけ
# なら数十秒で済むので、通しの最後に自動でやる。**状態は白紙へ戻してから**
# 回す——戻さずに回すと「単独」の意味が無い。
# `WAVELOG_NO_RETRY=1` で止められる（切り分けたくないときだけ）。
# ---- 共有状態を残した本を名指しする（§9.360） ------------------------
# **落ちた本ではなく、汚した本を出す。** 実害は`restore_master`が消している
# ので、ここに出た本が落ちているとは限らない——むしろ**落ちるのは次以降の
# 無関係な本**で、今まではそちらを直していた。
if [ -n "$DIRTY" ]; then
  echo
  echo "-- 共有状態を残したまま終わった本（後片付けを足すこと） --"
  printf '%s' "$DIRTY" | while IFS='|' read -r who what; do
    [ -z "$who" ] && continue
    printf '   %-24s %s\n' "$who" "$what"
  done
fi

if [ -n "$RETRY" ] && [ -z "$WAVELOG_NO_RETRY" ]; then
  echo
  echo "-- 落ちた本を単独で回し直す（順番・状態への依存かを切り分ける） --"
  ONLY_ORDER=""; REAL=""
  printf '%s' "$RETRY" | while read -r cmd name m; do
    [ -z "$name" ] && continue
    # **その本が走ったモードへ戻す**（§9.533）。戻さないと最後の群のモード（schedule）のまま回り、
    # editモードの群の本はマスタ管理のタブに辿り着けず、どれも「単独でも必ず落ちる」と出ていた。
    [ -n "$m" ] && mode "$m"
    resetcontent
    resetrecords
    reseed
    server_up || restart_server
    # **単独で2回回す**（§9.360）。1回で緑だと「順番のせい」と読んでしまうが、
    # 実際には**単独でも落ちたり落ちなかったりする本**がある（実測:
    # `test_opunit` は単独で3回に1回落ちていた）。1回だけ見て「順番依存」と
    # 決めつけたせいで、通しのたびに顔ぶれの違う赤が出続けた。3つに分ける。
    ng=0
    for _try in 1 2; do
      out=$($cmd "$name" 2>&1); rc=$?
      f=$(echo "$out" | grep -c '^FAIL'); fatal=$(echo "$out" | grep -c 'FATAL')
      [ "$rc" -ne 0 ] && [ "$f" -eq 0 ] && [ "$fatal" -eq 0 ] && fatal=1
      [ $((f+fatal)) -gt 0 ] && ng=$((ng+1)) && last="$out"
      reap_browsers
    done
    if [ "$ng" -eq 2 ]; then
      printf '   %-24s 単独でも必ず落ちる（本物）\n' "$name"
      echo "$last" | grep -E '^FAIL|FATAL' | head -2 | sed 's/^/        /'
      echo "$last" | grep -E '^WAIT-TIMEOUT' | head -2 | sed 's/^/        ↳ /'
    elif [ "$ng" -eq 1 ]; then
      printf '   %-24s 単独でも落ちたり落ちなかったり（不安定・網かレースを直す）\n' "$name"
      echo "$last" | grep -E '^FAIL|FATAL' | head -2 | sed 's/^/        /'
      echo "$last" | grep -E '^WAIT-TIMEOUT' | head -2 | sed 's/^/        ↳ /'
    else
      printf '   %-24s 単独では緑（順番・状態への依存）\n' "$name"
    fi
  done
fi

echo
echo "-- 時間のかかったテスト(上位10) --"
printf '%b' "$TIMES" | sort -rn | head -10 | while read -r sec n name; do
  [ -z "$name" ] && continue
  [ "${n:-0}" -gt 0 ] 2>/dev/null && per=$(( sec * 10 / n )) || per=0
  printf '   %4ds  %3d件  1件あたり%s.%s秒  %s\n' "$sec" "$n" "$((per/10))" "$((per%10))" "$name"
done
echo
echo "=================================================="
echo "  合計 $((TOT-NG))/$TOT PASS  (FAIL/FATAL: $NG)  所要 $(( $(date +%s) - T_START ))秒"
echo "=================================================="
exit $([ $NG -gt 0 ] && echo 1 || echo 0)
