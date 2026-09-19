# -*- coding: utf-8 -*-
"""backend.launcher: 起動基盤のうち「importされるだけ」の部品。

実行契約のあるもの(app.py / start_app.py / setup_app.py /
process_manager.py)とその道具は`program/`へまとめてある(§9.404・§9.406。
リポジトリ直下に置くPythonは1本も無い)。importされるだけのserver.py・
launch_guard.pyは、その方針に沿ってここへ移した
(docs/REFACTORING_PLAN.md フェーズ4.0)。
"""
