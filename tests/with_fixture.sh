#!/bin/bash
# 検証用フィクスチャの中で任意のコマンドを1回だけ動かす
# ============================================================
# 使い方: tests/with_fixture.sh <コマンド> [引数...]
#   例) tests/with_fixture.sh /opt/node22/bin/node tests/audit_scale.js out.json
#
# run_all.sh / visual/run.sh と同じ「パス設定マスタを退避 → 検証用DBへ
# 差し替え → 必ず戻す」を、回帰テスト以外の一回限りの調査でも使えるように
# 切り出したもの。**手でパスを戻す運用にしない**ことがこの仕掛けの目的で、
# 戻し忘れは実際に事故になっている(以降の起動が検証用DBを読み続ける)。
#
# 退避値は tests/.saved_paths.json にも書く。trapはプロセスが死ぬときしか
# 走らないので、コンテナごと落ちる終わり方では復元されない。次回の実行が
# そのファイルを見つけたら「前回は復元前に終わった」と判断して優先する。
# ============================================================
cd "$(dirname "$0")"
ROOT="$(cd .. && pwd)"
API=http://127.0.0.1:5029
FIXTURE="$ROOT/db/test_fixture"

[ $# -gt 0 ] || { echo "使い方: $0 <コマンド> [引数...]" >&2; exit 2; }

mode(){ curl -s -X POST $API/api/access-mode -H 'Content-Type: application/json' -d "{\"mode\":\"$1\"}" >/dev/null; }
server_up(){ curl -s -m 3 -o /dev/null "$API/" 2>/dev/null; }
reap_browsers(){ pkill -f -- '--user-data-dir=/tmp/playwright_chromiumdev_profile' >/dev/null 2>&1; true; }
restart_server(){
  ( cd "$ROOT" && python3 process_manager.py stop >/dev/null 2>&1 )
  sleep 1
  ( cd "$ROOT" && nohup python3 -u start_app.py >"$ROOT/tests/server.log" 2>&1 & )
  for _ in $(seq 1 30); do server_up && return 0; sleep 1; done
  echo "!! サーバーを起動できませんでした ($ROOT/tests/server.log)" >&2
  return 1
}

# 回帰テストと同時に走らせない(先に終わった方が実行中のもう一方の足元で
# パスを本番へ戻してしまう。run_all.sh と同じロックを共有する)。
LOCK="$ROOT/tests/.run_all.lock"
if [ -e "$LOCK" ] && kill -0 "$(cat "$LOCK" 2>/dev/null)" 2>/dev/null; then
  echo "!! すでにテスト/調査が動いています (PID $(cat "$LOCK"))。" >&2
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
    echo "!! 前回が復元前に終了していました。退避ファイルの値で復元します" >&2
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
apply_paths(){
  mode edit
  WL_PAYLOAD="$1" python3 - <<'PY'
import json,os,urllib.request
v=json.loads(os.environ['WL_PAYLOAD'])
keys=['sikalot_source','sikalotnow_path','sikalotdef_path','records_backup_export_path',
      'schedule_share_path','rne_extract_enabled','rne_extract_interval_sec',
      'schedule_lock_ttl_sec','schedule_lock_verify_delay_ms']
body={k:v.get(k,'') for k in keys}; body['user_id']='audit'
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
python3 "$ROOT/tests/make_fixture.py" >/dev/null 2>&1
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
echo "検証用フィクスチャへ切り替えました"
restart_server || exit 1
mode edit

export NODE_PATH="${NODE_PATH:-/opt/node22/lib/node_modules}"
( cd "$ROOT" && "$@" )
rc=$?
reap_browsers
exit $rc
