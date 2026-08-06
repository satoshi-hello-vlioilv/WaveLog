# -*- coding: utf-8 -*-
"""backend.launcher: 起動基盤のうち「importされるだけ」の部品。

リポジトリ直下に残すのは実行契約のあるもの(app.py / start_app.py /
process_manager.py / _pycache_bootstrap.py)だけにする方針のため、
importされるだけのserver.py・launch_guard.pyをここへ移した
(docs/REFACTORING_PLAN.md フェーズ4.0)。
"""
