"""rne_worker.py: rne_scheduler.pyから起動されるサブプロセスのエントリポイント。

Navigator API/COMセッションはプロセス間で安全に共有できないため、抽出1件
ごとに独立したPythonプロセスとして実行する(rne_extract.extract_oneを
1回呼ぶだけ)。起動は `python -m backend.rne_worker <payload.json> <result.json>`
の形を想定し、cwdはプロジェクトルート(相対importが解決できるよう)。

payload.jsonは {'job':{...}, 'conf':{...}, 'work_dir':'...'} の形。
結果はresult.jsonへアトミック書き込み(os.replace)する。呼び出し元
(rne_scheduler)はこのファイルの出現をもって完了を検知する。

自己タイムアウト: Navigator APIの呼び出し(ctypes経由のDLL呼び出し)は
ネットワーク不調時などに応答が返らず無期限にブロックし得る。呼び出し元
(rne_scheduler._run_job)にもsubprocess.run(timeout=...)があるが、外側から
強制終了(kill)されると、このプロセス自身のfinally節(rne_extract.extract_one
のNavigatorセッション/カタログclose、作業フォルダ削除)が一切実行されない
まま消える。さらに、rne_scheduler自体がアプリのシャットダウンと同時に
終了した場合(親が死んだ場合)は外側のタイムアウトも働かず、このプロセスが
孤児として無期限に生き残りかねない。そのため呼び出し元と同じ長さの
タイマーを自前でも持ち、時間内にメイン処理が終わらなければ自分自身を
強制終了する(os._exit。別スレッドからのsys.exit()はそのスレッドが
終わるだけでメインスレッドのブロックしたDLL呼び出しは止められないため、
watchdog.pyの_exit()と同じ理由でos._exitを使う)。
"""
from __future__ import annotations
import json
import os
import sys
import threading
import traceback
from pathlib import Path
from .quiet import quiet

_DEFAULT_SELF_TIMEOUT_SEC = 600


def atomic_json(path, data):
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + '.tmp')
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
    os.replace(tmp, p)


def _self_timeout_exit(result_path, job_name):
    try:
        atomic_json(result_path, {'ok': False, 'job': job_name, 'error': '自己タイムアウトにより強制終了しました(Navigator APIの呼び出しが応答しませんでした)'})
    except Exception as _e:
        quiet('自己タイムアウトの理由を書き残せない（そのまま終了する）',_e)
    os._exit(3)


def main():
    payload_path, result_path = sys.argv[1], sys.argv[2]
    payload = json.loads(Path(payload_path).read_text(encoding='utf-8'))
    job_name = (payload.get('job') or {}).get('name', '')
    try:
        timeout_sec = int(os.environ.get('NAVI_WORKER_TIMEOUT_SEC') or _DEFAULT_SELF_TIMEOUT_SEC)
    except (TypeError, ValueError):
        timeout_sec = _DEFAULT_SELF_TIMEOUT_SEC
    timer = threading.Timer(timeout_sec, _self_timeout_exit, args=(result_path, job_name))
    timer.daemon = True
    timer.start()
    try:
        from .rne_extract import extract_one
        result = extract_one(payload['job'], payload['conf'], payload['work_dir'])
    finally:
        timer.cancel()
    atomic_json(result_path, result)
    return 0 if result.get('ok') else 2


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as e:
        if len(sys.argv) > 2:
            atomic_json(sys.argv[2], {'ok': False, 'job': '', 'error': str(e), 'traceback': traceback.format_exc()})
        raise
