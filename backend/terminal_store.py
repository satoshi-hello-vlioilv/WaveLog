"""terminal_store.py: 端末の控え（§9.545・docs/DESKTOP_MIGRATION_DESIGN.md §8）。

============================================================
なぜ要るか
------------------------------------------------------------
測定の記録は、まず**ブラウザの保存領域**（IndexedDB と localStorage の写し）へ
入り、そこから共有へ送る（§9.202）。共有へ送れていない記録は**ブラウザの中に
しか無い**。ところがブラウザの保存領域は「どこから開いたか（オリジン）」と
「どのブラウザか」で分かれている。

  ・ブラウザ版   …… Edge で `http://127.0.0.1:5029/`
  ・デスクトップ版 …… WebView2 で `http://wavelog.localhost/`

WebView2 と Edge は保存領域そのもの（ユーザーデータのフォルダ）が別なので、
アドレスを揃えても互いの中身は見えない。両方から届くのは **Python だけ**。

だから端末の記録と、端末にしか無い設定を、Python が**端末の手元**へ控える。
画面は保存のたびにここへも書き、開いたときに記録IDごとに新しいほうを採る。
**1回きりの引き継ぎではない**——移行のあいだは同じ PC で両方を行き来する
（利用者の答え③「併存」）ので、写し続けないと片方で直した記録が見えない。

置き場の決まり:
  ・`%TEMP%`には置かない（ディスクの整理が消す。共有へ送れていない記録は
    ここにしか無くなる）。
  ・`db/`（Box の上）にも置かない（他の PC へ同期され、端末の持ち物が混ざる）。
  ・`paths.local_root()/terminal/`。読み書きするのは Python だけ。窓（Rust）は
    Start.vbs と同じ Python を使うので、Microsoft Store 版でも同じ写しを見る。
  ・掃除（`file_cleanup`）の対象にしない——**作り直せない**ので。

新しいほうの決め方: 記録はレコード自身の`updatedAt`（UTC の ISO・桁がそろうので
文字列で比べてよい・§9.208 ⑤と同じ物差し）。消した記録は**消した時刻**を残し、
それより古い記録を受け付けない（消したものが別の窓から戻らない）。設定は
書くたびに1つ増える通し番号（`rev`）で、画面は「最後に見た番号より後」だけを取る。
============================================================
"""
import json
import threading
from datetime import datetime, timezone

from . import paths
from .sqlite_io import connect, qi

RECORDS = '端末の測定記録'
SETTINGS = '端末の設定'
META = '端末の控えメタ'
ORIGINS = '控えを使った画面'
FILE_NAME = 'terminal.sqlite3'
# 1つの設定の値の上限。大きな物（記録の写し・一覧の取り置き）は画面の側で
# 送らない決まりだが、間違えて送られても控えを膨らませない。
MAX_SETTING_BYTES = 512 * 1024

_lock = threading.Lock()


def store_path():
    return paths.local_root() / 'terminal' / FILE_NAME


def _now_iso():
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def _open():
    c = connect(store_path())
    c.execute(f"CREATE TABLE IF NOT EXISTS {qi(RECORDS)} ([記録ID] TEXT PRIMARY KEY, [更新時刻ISO] TEXT NOT NULL DEFAULT '', "
              f"[削除時刻ISO] TEXT NOT NULL DEFAULT '', [記録JSON] TEXT, [控えた日時] TEXT)")
    c.execute(f'CREATE TABLE IF NOT EXISTS {qi(SETTINGS)} ([名前] TEXT PRIMARY KEY, [値] TEXT, [通し番号] INTEGER NOT NULL)')
    c.execute(f'CREATE TABLE IF NOT EXISTS {qi(META)} ([名前] TEXT PRIMARY KEY, [値] TEXT)')
    c.execute(f'CREATE TABLE IF NOT EXISTS {qi(ORIGINS)} ([画面] TEXT PRIMARY KEY, [初めて] TEXT, [最後] TEXT, '
              f'[送った記録] INTEGER NOT NULL DEFAULT 0, [送った設定] INTEGER NOT NULL DEFAULT 0)')
    return c


def _record_time(rec):
    return str((rec or {}).get('updatedAt') or '')[:40]


# ------------------------------------------------------------------
# 記録
# ------------------------------------------------------------------
def put_records(records):
    """記録を控える。**控えのほうが新しい（または同じ）ものは書かない**。
    → {'stored': 書いた数, 'kept': 控えのほうが新しかった数, 'refused': 消した後の古い記録の数}"""
    out = {'stored': 0, 'kept': 0, 'refused': 0}
    now = _now_iso()
    with _lock:
        c = _open()
        try:
            for rec in records or []:
                if not isinstance(rec, dict) or not str(rec.get('id') or '').strip():
                    continue
                rid, at = str(rec['id']).strip(), _record_time(rec)
                row = c.execute(f'SELECT [更新時刻ISO],[削除時刻ISO] FROM {qi(RECORDS)} WHERE [記録ID]=?', [rid]).fetchone()
                if row and row[1] and at <= row[1]:
                    out['refused'] += 1          # 消したあとに届いた古い記録（消したものを戻さない）
                    continue
                if row and not row[1] and at <= row[0]:
                    out['kept'] += 1
                    continue
                c.execute(f'INSERT OR REPLACE INTO {qi(RECORDS)} ([記録ID],[更新時刻ISO],[削除時刻ISO],[記録JSON],[控えた日時]) '
                          'VALUES (?,?,?,?,?)', [rid, at, '', json.dumps(rec, ensure_ascii=False), now])
                out['stored'] += 1
            c.commit()
        finally:
            c.close()
    return out


def delete_records(ids, deleted_at=''):
    """消した印を残す（記録の中身は捨てる）。消した時刻は呼んだ側の時刻（無ければいま）。"""
    at = str(deleted_at or '')[:40] or _now_iso()
    n = 0
    with _lock:
        c = _open()
        try:
            for rid in ids or []:
                rid = str(rid or '').strip()
                if not rid:
                    continue
                row = c.execute(f'SELECT [更新時刻ISO],[削除時刻ISO] FROM {qi(RECORDS)} WHERE [記録ID]=?', [rid]).fetchone()
                if row and row[1] and row[1] >= at:
                    continue
                c.execute(f'INSERT OR REPLACE INTO {qi(RECORDS)} ([記録ID],[更新時刻ISO],[削除時刻ISO],[記録JSON],[控えた日時]) '
                          'VALUES (?,?,?,?,?)', [rid, row[0] if row else '', at, None, _now_iso()])
                n += 1
            c.commit()
        finally:
            c.close()
    return n


def index():
    """控えの見出し（中身なし）。→ [{'id','updatedAt','deletedAt'}]
    画面は開くたびにこれと突き合わせる。**中身は運ばない**——記録は1件で数十KBあり、
    全件を毎回運ぶと開くたびに数MBを読むことになる。中身は要る記録だけ`records(ids)`で取る。"""
    with _lock:
        c = _open()
        try:
            rows = c.execute(f'SELECT [記録ID],[更新時刻ISO],[削除時刻ISO] FROM {qi(RECORDS)} ORDER BY [記録ID]').fetchall()
        finally:
            c.close()
    return [{'id': rid, 'updatedAt': at or '', 'deletedAt': dat or ''} for rid, at, dat in rows]


def records(ids):
    """指定した記録の中身。→ [{'id','updatedAt','deletedAt','record'}]（消した物・読めない物は record が None）"""
    want = [str(i) for i in (ids or []) if str(i or '').strip()]
    out = []
    with _lock:
        c = _open()
        try:
            for k in range(0, len(want), 500):
                part = want[k:k + 500]
                out += c.execute(f'SELECT [記録ID],[更新時刻ISO],[削除時刻ISO],[記録JSON] FROM {qi(RECORDS)} '
                                 f'WHERE [記録ID] IN ({",".join("?" * len(part))})', part).fetchall()
        finally:
            c.close()
    items = []
    for rid, at, dat, raw in out:
        try:
            rec = json.loads(raw) if raw else None
        except ValueError:
            rec = None                         # 読めない行は「中身なし」として返す（突き合わせで端末側が勝つ）
        items.append({'id': rid, 'updatedAt': at or '', 'deletedAt': dat or '', 'record': rec})
    return items


# ------------------------------------------------------------------
# 端末にしか無い設定（localStorage の名前と値）
# ------------------------------------------------------------------
def _rev(c):
    row = c.execute(f"SELECT [値] FROM {qi(META)} WHERE [名前]='settings_rev'").fetchone()
    return int(row[0]) if row and str(row[0]).isdigit() else 0


def put_settings(values):
    """{名前: 値（文字列）| None（消した）} を重ねる。**送った名前だけ**書く（丸ごと置き換えない
    ——2つの窓が同時に開いているとき、片方の古い全体がもう片方の新しい変更を消さない）。→ いまの通し番号"""
    with _lock:
        c = _open()
        try:
            rev = _rev(c)
            for k, v in (values or {}).items():
                k = str(k or '')
                if not k or (v is not None and not isinstance(v, str)):
                    continue
                if v is not None and len(v.encode('utf-8')) > MAX_SETTING_BYTES:
                    continue
                cur = c.execute(f'SELECT [値] FROM {qi(SETTINGS)} WHERE [名前]=?', [k]).fetchone()
                if cur is not None and cur[0] == v:
                    continue                   # 同じ値なら番号を進めない（相手の窓に無駄な取り直しをさせない）
                rev += 1
                c.execute(f'INSERT OR REPLACE INTO {qi(SETTINGS)} ([名前],[値],[通し番号]) VALUES (?,?,?)', [k, v, rev])
            c.execute(f"INSERT OR REPLACE INTO {qi(META)} ([名前],[値]) VALUES ('settings_rev',?)", [str(rev)])
            c.commit()
            return rev
        finally:
            c.close()


def settings(since=0):
    """通し番号が since より後の設定。→ {'rev': いまの番号, 'values': {名前: 値|None}, 'revs': {名前: 番号}}

    `revs`は画面が「最後に見た番号より後に変わった名前」だけを当てるのに使う。"""
    with _lock:
        c = _open()
        try:
            rows = c.execute(f'SELECT [名前],[値],[通し番号] FROM {qi(SETTINGS)} WHERE [通し番号]>? ORDER BY [通し番号]',
                             [int(since or 0)]).fetchall()
            return {'rev': _rev(c), 'values': {k: v for k, v, _r in rows}, 'revs': {k: r for k, _v, r in rows}}
        finally:
            c.close()


# ------------------------------------------------------------------
# どの画面が控えを使ったか（引き継ぎの印）
# ------------------------------------------------------------------
def note_origin(origin, records_sent=0, settings_sent=0):
    origin = str(origin or '')[:200]
    if not origin:
        return
    now = _now_iso()
    with _lock:
        c = _open()
        try:
            c.execute(f'INSERT OR IGNORE INTO {qi(ORIGINS)} ([画面],[初めて],[最後]) VALUES (?,?,?)', [origin, now, now])
            c.execute(f'UPDATE {qi(ORIGINS)} SET [最後]=?, [送った記録]=[送った記録]+?, [送った設定]=[送った設定]+? '
                      'WHERE [画面]=?', [now, int(records_sent or 0), int(settings_sent or 0), origin])
            c.commit()
        finally:
            c.close()


def status():
    """控えの様子（画面・窓・網が読む）。"""
    with _lock:
        c = _open()
        try:
            live, gone = c.execute(f"SELECT SUM([削除時刻ISO]=''), SUM([削除時刻ISO]<>'') FROM {qi(RECORDS)}").fetchone()
            origins = [{'origin': o, 'first': f, 'last': la, 'records': r, 'settings': s}
                       for o, f, la, r, s in c.execute(f'SELECT * FROM {qi(ORIGINS)} ORDER BY [初めて]').fetchall()]
            return {'path': str(store_path()), 'records': int(live or 0), 'deleted': int(gone or 0),
                    'settingsRev': _rev(c), 'origins': origins}
        finally:
            c.close()
