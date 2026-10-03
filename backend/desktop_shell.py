"""desktop_shell.py: いま動いている窓（デスクトップ版の exe）と、配ってある exe の答え（§9.552）。

窓（Rust・`desktop/`）は Python を起こすとき、**自分が何から作られたか**を環境変数で渡す:
  `WAVELOG_SHELL`        … `desktop`（窓から起こされた）。開発と網の HTTP の入口では空
  `WAVELOG_SHELL_COMMIT` … exe を作ったコミット（CI が作るときに埋める・手元で作った exe は空）
  `WAVELOG_SHELL_EXE`    … いま動いている exe の場所（手元へ写した版ごとのフォルダの中）

配ってある exe は`program/WaveLog.build.json`（main へ置くときに CI が書く・§9.548）が名乗る。

**窓だけ古い**ことが起こりうる——窓は中身（Python）が止まると起こし直すので（sidecar.rs）、
ZIP で更新が届いたあとに起こし直された Python は新しく、窓は古い exe のまま動き続ける。
このとき`.py`の更新時刻では「再起動が要る」と言えない（Python は更新の後に起きている）。
答えは`stale()`の1箇所（`/api/build`の再起動の知らせと、接続状況が読む）。
"""
import json
import os

from .paths import PROGRAM_DIR
from .quiet import quiet

BUILD_INFO = PROGRAM_DIR / 'WaveLog.build.json'
SHORT = 7


def short(commit):
    """人が見る形（先頭7字・git の短い形と同じ）。"""
    return str(commit or '')[:SHORT]


def running():
    """この Python を起こした窓。窓の外（開発・網）では`kind`が空。"""
    kind = os.environ.get('WAVELOG_SHELL', '')
    return {'kind': kind,
            'commit': os.environ.get('WAVELOG_SHELL_COMMIT', '') if kind else '',
            'exe': os.environ.get('WAVELOG_SHELL_EXE', '') if kind else ''}


def placed():
    """配ってある exe（`WaveLog.build.json`）。**読むたびに読み直す**——ZIP の更新で変わる。
    無い・読めないなら None（「分からない」。古いとも新しいとも言わない）。"""
    try:
        if not BUILD_INFO.is_file():
            return None
        info = json.loads(BUILD_INFO.read_text(encoding='utf-8'))
    except Exception as _e:
        quiet('配ってある exe の名乗り（WaveLog.build.json）を読めない（窓の版は比べない）', _e)
        return None
    return info if isinstance(info, dict) else None


def stale(run=None, put=None):
    """いま動いている窓が、配ってある exe より古いか。True／False／None（比べられない）。

    比べるのは**作ったコミット**（同じ exe なら同じ・publish は自己診断を通った exe と
    そのコミットを組で置く）。窓の外・コミットを名乗らない古い exe・名乗りの無い配布は None。"""
    run = running() if run is None else run
    if not run.get('kind') or not run.get('commit'):
        return None
    put = placed() if put is None else put
    if not put or not put.get('commit'):
        return None
    return str(run['commit']) != str(put['commit'])


def summary():
    """`/api/build`へ載せる形（画面は字を組み立てない・読むだけ）。"""
    run, put = running(), placed()
    return {'shell': run['kind'], 'shellCommit': short(run['commit']),
            'shellPlaced': short((put or {}).get('commit')), 'shellStale': stale(run, put)}
