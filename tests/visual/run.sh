#!/bin/bash
# 画面キャプチャ(見た目の基準づくり)
# ============================================================
# 使い方:
#   tests/visual/run.sh base        … 基準を撮る   → tests/visual/shots/base/
#   tests/visual/run.sh head        … 変更後を撮る → tests/visual/shots/head/
#   tests/visual/run.sh compare     … base と head を1画素ずつ突き合わせる
#
# run_all.sh と同じく、パス設定マスタの退避→検証用フィクスチャへ差し替え→
# 復元まで面倒を見る(復元忘れは実際に起きた事故なので、手作業に頼らない)。
# 撮る前に必ず make_fixture.py で種データへ戻すので、撮り比べが成立する。
# ============================================================
cd "$(dirname "$0")"
HERE="$(pwd)"
ROOT="$(cd ../.. && pwd)"
SHOTS="$HERE/shots"

NODE="${WAVELOG_NODE:-/opt/node22/bin/node}"
export NODE_PATH="${NODE_PATH:-/opt/node22/lib/node_modules}"
API=http://127.0.0.1:5029
FIXTURE="$ROOT/db/test_fixture"

TARGET="${1:-}"
case "$TARGET" in
  base|head) ;;
  compare)
    python3 "$HERE/pngdiff.py" "$SHOTS/base" "$SHOTS/head" --out "$SHOTS/diff"
    exit $?;;
  *) echo "使い方: $0 {base|head|compare}" >&2; exit 2;;
esac

mode(){ curl -s -X POST $API/api/access-mode -H 'Content-Type: application/json' -d "{\"mode\":\"$1\"}" >/dev/null; }
server_up(){ curl -s -m 3 -o /dev/null "$API/" 2>/dev/null; }
reap_browsers(){ pkill -f -- '--user-data-dir=/tmp/playwright_chromiumdev_profile' >/dev/null 2>&1; true; }
# 止め方・起こし方は run_all.sh と同じ（開発と網の入口 program/app.py・§9.548。止めるのは /api/shutdown）。
stop_server(){
  curl -s -m 3 -X POST "$API/api/shutdown" >/dev/null 2>&1
  for _ in $(seq 1 20); do server_up || return 0; sleep 0.5; done
  pkill -f -- 'program/app.py' >/dev/null 2>&1; sleep 1; true
}
restart_server(){
  stop_server
  ( cd "$ROOT" || exit 1; nohup python3 -u program/app.py >"$ROOT/tests/server.log" 2>&1 & )
  for _ in $(seq 1 30); do server_up && return 0; sleep 1; done
  echo "!! サーバーを起動できませんでした ($ROOT/tests/server.log)" >&2
  return 1
}

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
body={k:v.get(k,'') for k in keys}; body['user_id']='visual'
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

# 撮り比べが成立するには、両方の実行が**同じデータ**から始まる必要がある。
#  1) 種データを作り直してから作業用コピーを取る。逆順にすると、前回の実行が
#     残した「作業中」「完了」の行を引き継いだまま撮ってしまい、行が1本増減した
#     だけでその帯が丸ごと差分になる(実測で5画面が6〜8%相違)。
#  2) 測定バックアップ(db/records.sqlite3)も空にする。キャプチャ自身が測定画面を
#     開くので1件増え、次の実行の「データ引継ぎ」タブの行数が変わる。
python3 "$ROOT/tests/make_fixture.py" >/dev/null 2>&1
python3 - <<'PY'
import pathlib,sqlite3
p=pathlib.Path('/home/user/WaveLog/db/records.sqlite3')
if p.exists():
    c=sqlite3.connect(p)
    for (t,) in c.execute("select name from sqlite_master where type='table'"):
        try:c.execute(f'delete from "{t}"')
        except Exception:pass
    c.commit();c.close()
PY
#  3) 端末の控え（§9.545 の terminal_store）も空にする。測った記録とこの端末の設定（メニューの畳み等）を
#     持っていて、空にしないと前回の撮影の最後の状態（メニュー畳み込み）から次が始まる（実測で54枚すべて相違）。
python3 "$ROOT/tests/reset_terminal.py" >/dev/null
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

DEST="$SHOTS/$TARGET"
rm -rf "$DEST"; mkdir -p "$DEST"
echo "--- キャプチャ: $TARGET ---"
"$NODE" "$HERE/capture.js" "$DEST"
rc=$?
reap_browsers
exit $rc
