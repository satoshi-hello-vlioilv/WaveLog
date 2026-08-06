#!/bin/bash
# WaveLog 回帰テスト一括実行
# ============================================================
# 使い方: tests/run_all.sh
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

mode(){ curl -s -X POST $API/api/access-mode -H 'Content-Type: application/json' -d "{\"mode\":\"$1\"}" >/dev/null; }
resetcontent(){ curl -s -X POST $API/api/schedule-content-master -H 'Content-Type: application/json' \
  -d '{"equipment":"テスト設備A","items":[],"user_id":"test"}' >/dev/null; }

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
      'schedule_lock_ttl_sec','schedule_lock_verify_delay_ms']
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
trap restore_paths EXIT INT TERM

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
reseed(){ python3 "$ROOT/tests/make_fixture.py" >/dev/null 2>&1; }

TOT=0; NG=0
run(){
  want "$2" || return 0
  reseed
  out=$($1 "$2" 2>&1)
  p=$(echo "$out" | grep -c '^PASS'); f=$(echo "$out" | grep -c '^FAIL')
  fatal=$(echo "$out" | grep -c 'FATAL')
  TOT=$((TOT+p+f)); NG=$((NG+f+fatal))
  printf '%-24s %3d PASS / %d FAIL%s\n' "$2" "$p" "$f" "$([ $fatal -gt 0 ] && echo ' [FATAL]')"
  echo "$out" | grep -E '^FAIL|FATAL' | head -4 | sed 's/^/      /'
  reap_browsers
}

echo "--- 起動(サーバーを再起動する) ---"
run python3 test_boot.py
sleep 3

echo "--- 一般UI (editモード) ---"
mode edit
for t in test_stopcat test_workable test_wkbg test_orphan test_audit test_sub test_maint test_setpage test_nav test_navdyn test_hdctx test_uiux test_histdel test_uisize test_p11 test_p11c test_master test_shift test_waiting test_waiting2 \
         test_calscale test_hdr test_listcache test_ttlcache; do run $NODE $t.js; done

echo "--- スケジュール (テスト側でモードを切り替える) ---"
for t in test_screport test_startwork test_sccat test_scbalance test_scbatch \
         test_screorder test_scperm test_scperf test_wkfast; do run $NODE $t.js; done

echo "--- スケジュール (scheduleモード固定) ---"
mode schedule
resetcontent
for t in test_cols test_content_ui test_content_apply test_listmodal test_split_layout; do
  run $NODE $t.js; resetcontent; done

echo "--- サーバー側 ---"
mode schedule
for t in test_sclock test_scwritespeed test_colscache test_colsripple test_modeguard; do run python3 $t.py; done

echo
echo "=================================================="
echo "  合計 $((TOT-NG))/$TOT PASS  (FAIL/FATAL: $NG)"
echo "=================================================="
exit $([ $NG -gt 0 ] && echo 1 || echo 0)
