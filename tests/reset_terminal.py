#!/usr/bin/env python3
"""reset_terminal.py: 回帰のサーバーが使う「端末の控え」（§9.545）を白紙へ戻す。

控えは**同じ端末のブラウザどうしで設定と記録を揃える**仕組みなので、網が新しい
ブラウザを開くたびに、前の網が残した設定（列の並び・畳み・使用設備…）と記録が
その新しいブラウザへ当たる。網はそれぞれ「まっさらなブラウザ」を前提に書かれて
いるので、1本ごとに白紙へ戻す（実績を`resetrecords`で空へ戻すのと同じ・§9.362）。

製品には消す口を作らない（控えは共有へ送れていない記録の、唯一の控えになりうる）。
ここはサーバーと同じ環境から置き場を引いて、ファイルを直に消す。
"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend import terminal_store  # noqa: E402

p = terminal_store.store_path()
for q in (p, p.with_name(p.name + '-journal'), p.with_name(p.name + '-wal'), p.with_name(p.name + '-shm')):
    try:
        q.unlink()
    except FileNotFoundError:
        pass
    except OSError as e:
        print(f'!! 端末の控えを消せませんでした: {q}（{e}）')
