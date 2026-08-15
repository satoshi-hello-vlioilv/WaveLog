#!/bin/bash
# WaveLog 回帰テスト一括実行
# ============================================================
# 使い方: tests/run_all.sh              全部回す(コミット前はこれ)
#         tests/run_all.sh test_sccat   名前を並べるとそれだけ
#         tests/run_all.sh --changed    変更ファイルに関係するものだけ(§9.103)
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

mode(){ curl -s -X POST $API/api/access-mode -H 'Content-Type: application/json' -d "{\"mode\":\"$1\"}" >/dev/null; }
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
  # 列レイアウトマスタは全置換なので、空を送れば対象の行が消える(§9.113)。
  for tg in 'timeline:テスト設備A' 'print:テスト設備A'; do
    curl -s -X POST $API/api/column-layout-master -H 'Content-Type: application/json' \
      -d "{\"target\":\"$tg\",\"order\":[],\"hidden\":[],\"widths\":{},\"names\":{},\"formats\":{},\"rules\":{},\"formulas\":{},\"locks\":[],\"user_id\":\"test\"}" >/dev/null
  done
}

server_up(){ curl -s -m 3 -o /dev/null "$API/" 2>/dev/null; }

# テストが異常終了するとPlaywrightのChromiumが残る。残った画面は設備の
# 編集セッションを掴んだままハートビートを打ち続けるため、後続のスケジュール
# 系テストが「編集中です」で連鎖的に落ちる(実際に1本のFATALから8本が落ちた)。
# 各テストは自分でfinallyで閉じるが、取りこぼしに備えてランナー側でも掃除する。
# --user-data-dirで絞るので、Playwrightが起動したものだけが対象。
reap_browsers(){ pkill -f -- '--user-data-dir=/tmp/playwright_chromiumdev_profile' >/dev/null 2>&1; true; }
restart_server(){
  ( cd "$ROOT" && python3 process_manager.py stop >/dev/null 2>&1 )
  sleep 1
  ( cd "$ROOT" && nohup python3 -u start_app.py >"$ROOT/tests/server.log" 2>&1 & )
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
keys=['sikalot_source','sikalotnow_path','sikalotdef_path','records_backup_export_path',
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
trap 'restore_paths; release_lock' EXIT INT TERM

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

TOT=0; NG=0
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
  t0=$(date +%s)
  out=$($1 "$2" 2>&1)
  dt=$(( $(date +%s) - t0 ))
  p=$(echo "$out" | grep -c '^PASS'); f=$(echo "$out" | grep -c '^FAIL')
  fatal=$(echo "$out" | grep -c 'FATAL')
  TOT=$((TOT+p+f)); NG=$((NG+f+fatal))
  TIMES="$TIMES$dt $((p+f)) $2\n"
  printf '%-24s %3d PASS / %d FAIL  %4ds%s\n' "$2" "$p" "$f" "$dt" "$([ $fatal -gt 0 ] && echo ' [FATAL]')"
  echo "$out" | grep -E '^FAIL|FATAL' | head -4 | sed 's/^/      /'
  reap_browsers
}

echo "--- 起動(サーバーを再起動する) ---"
# 前の実行の置き土産(内容欄の項目・列レイアウト)をここで落とす。1本だけ
# 実行するとき(`run_all.sh test_orphan`)も同じ白紙から始められるように、
# テストを選ぶより前に置く。
resetcontent
run python3 test_boot.py
sleep 3

echo "--- 一般UI (editモード) ---"
mode edit
for t in test_stopcat test_workable test_wkbg test_mcore test_msteps test_orphan test_audit test_sub test_maint test_setpage test_nav test_navdyn test_hdctx test_uiux test_histdel test_uisize test_p11 test_p11c test_master test_shift test_waiting \
         test_calscale test_hdr test_listcache test_ttlcache test_flows test_dbequip test_course test_tolscale test_defect test_theme test_scale test_fit test_bootui test_density test_filter test_stopeq test_eqkind test_bootflash test_dsnav test_collayout test_colformat test_colrule test_colsort test_typescale test_lcpanel test_colmenu test_colpreset test_formula test_share test_listperf test_allrows test_logview test_headbar test_gridhead; do run $NODE $t.js; done

echo "--- スケジュール (テスト側でモードを切り替える) ---"
for t in test_screport test_startwork test_scsync test_sccat test_scbalance test_scbatch \
         test_screorder test_scperm test_scperf test_wkfast test_scsplit test_splitlive test_scprint test_scdrop test_sccontent test_recperm; do run $NODE $t.js; done

echo "--- スケジュール (scheduleモード固定) ---"
mode schedule
resetcontent
for t in test_cols test_listmodal test_split_layout test_sccols; do
  run $NODE $t.js; resetcontent; done

echo "--- サーバー側 ---"
mode schedule
for t in test_sclock test_scwritespeed test_colscache test_colsripple test_modeguard test_noaccess \
         test_csslint test_dbopen test_error test_datasource test_dskeylint test_dbmirror test_atomicio test_localwork test_displayrule test_eqstd test_crudroutes test_tablequery test_patchlint test_globallint test_assetcache test_tabclose test_logs test_docindex test_pick; do run python3 $t.py; done

echo
echo "-- 時間のかかったテスト(上位10) --"
printf '%b' "$TIMES" | sort -rn | head -10 | while read -r sec n name; do
  [ -z "$name" ] && continue
  [ "${n:-0}" -gt 0 ] 2>/dev/null && per=$(( sec * 10 / n )) || per=0
  printf '   %4ds  %3d件  1件あたり%s.%s秒  %s\n' "$sec" "$n" "$((per/10))" "$((per%10))" "$name"
done
echo
echo "=================================================="
echo "  合計 $((TOT-NG))/$TOT PASS  (FAIL/FATAL: $NG)"
echo "=================================================="
exit $([ $NG -gt 0 ] && echo 1 || echo 0)
