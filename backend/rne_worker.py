"""rne_worker.py: rne_scheduler.pyから起動されるサブプロセスのエントリポイント。

Navigator API/COMセッションはプロセス間で安全に共有できないため、抽出1件
ごとに独立したPythonプロセスとして実行する(rne_extract.extract_oneを
1回呼ぶだけ)。起動は `python -m backend.rne_worker <payload.json> <result.json>`
の形を想定し、cwdはプロジェクトルート(相対importが解決できるよう)。

payload.jsonは {'job':{...}, 'conf':{...}, 'work_dir':'...'} の形。
結果はresult.jsonへアトミック書き込み(os.replace)する。呼び出し元
(rne_scheduler)はこのファイルの出現をもって完了を検知する。
"""
from __future__ import annotations
import json
import os
import sys
import traceback
from pathlib import Path


def atomic_json(path, data):
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + '.tmp')
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
    os.replace(tmp, p)


def main():
    payload_path, result_path = sys.argv[1], sys.argv[2]
    payload = json.loads(Path(payload_path).read_text(encoding='utf-8'))
    from .rne_extract import extract_one
    result = extract_one(payload['job'], payload['conf'], payload['work_dir'])
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
