# -*- coding: utf-8 -*-
"""backend.launcher: 起動基盤のうち「importされるだけ」の部品。

実行契約のあるもの(app.py / setup_app.py / sidecar.py)とその道具は`program/`へ
まとめてある(§9.404・§9.406。リポジトリ直下に置くPythonは1本も無い)。
ブラウザ版の起動の道（start_app.py・process_manager.py・guard.py）は§9.548で外した。
"""
