#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""tests/pick_tests.py の対応表が腐っていないかを見る(§9.103)。

対応表は人が書くものなので、放っておけば必ず現実とずれる。ずれ方は3つ:

  1. **消えたテストを名指ししたまま** → `run_all.sh` へ渡しても何も走らない。
     絞り込んだつもりが、その分だけ穴になる。
  2. **新しいテストがどの規則からも呼ばれない** → 変更しても選ばれず、
     コミット前の通し実行までずっと回らない。テストを足した意味が薄れる。
  3. **新しいソースがどの規則にも当たらない** → `pick_tests.py` は
     安全側(全部回す)へ倒すので見落としはしないが、絞り込みが効かなくなる。
     気づけないまま道具だけが役に立たなくなるので、ここで落とす。

**「安全側へ倒れるから放置してよい」ではない。** 倒れたことに誰も
気づかないのが問題なので、倒れた瞬間に落とす。
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tests'))
import pick_tests as P  # noqa: E402

R = []


def rec(name, ok, detail=''):
    R.append((name, ok, detail))
    print(('PASS' if ok else 'FAIL') + ': ' + name + (' -- ' + detail if detail else ''))


def named_tests():
    out = set(P.ALWAYS)
    for _pat, tests in P.RULES + P.FALLBACKS:
        out.update(t for t in tests if t != P.ALL)
    return out


def main():
    files = set(P.all_test_names())

    # 1. 名指ししているテストは実在するか。
    ghost = sorted(named_tests() - files)
    rec('対応表が名指しするテストはすべて実在する', not ghost,
        '実体なし: ' + ' '.join(ghost) if ghost else f'{len(named_tests())}本')

    # 2. どの規則からも呼ばれないテストが無いか。
    orphan = sorted(files - named_tests())
    rec('すべてのテストがどこかの規則から呼ばれる', not orphan,
        '呼ばれない: ' + ' '.join(orphan) if orphan else f'{len(files)}本')

    # 3. 監視対象のソースは必ずどれかの規則に当たるか。
    watched = []
    watched += sorted(str(p.relative_to(ROOT)) for p in (ROOT / 'backend').rglob('*.py'))
    watched += sorted(str(p.relative_to(ROOT)) for p in (ROOT / 'static/js').glob('*.js'))
    watched += sorted(str(p.relative_to(ROOT)) for p in (ROOT / 'static/css').glob('*.css'))
    watched += sorted(str(p.relative_to(ROOT)) for p in (ROOT / 'templates').glob('*.html'))
    watched += sorted(str(p.relative_to(ROOT)) for p in ROOT.glob('*.py'))
    watched = [w for w in watched if '__pycache__' not in w]
    miss = [w for w in watched
            if not any(P._match(w, pat) for pat, _t in P.RULES + P.FALLBACKS)]
    rec('監視対象のソースはすべてどれかの規則に当たる', not miss,
        '当たらない: ' + ' '.join(miss[:6]) if miss else f'{len(watched)}ファイル')

    # 4. 知らないファイルは「全部」へ倒れる(黙って0件にしない)。
    names, why = P.pick(['config/なにか新しいもの.json'])
    rec('規則に無いファイルは全部回す側へ倒れる', names == set() and why[-1][1] == '当たる規則なし',
        f'{len(names)}本 / {why[-1][1] if why else "?"}')

    # 5. 常設の静的検査は必ず混ざる。
    names, _ = P.pick(['docs/ARCHITECTURE.md'])
    rec('常設の静的検査は選ばれた集合に必ず入る',
        set(P.ALWAYS) <= names, ' '.join(sorted(names)))

    # 6. 代表的な変更で、その変更が壊しうるテストが選ばれるか。
    #    **数ではなく名前で見る**——本数だけ見ていると、規則を書き換えて
    #    中身が入れ替わっても気づけない。
    cases = [
        ('backend/routes/logs.py', ['test_logs', 'test_logview']),
        ('static/js/core/log-view.js', ['test_logview', 'test_logs']),
        ('backend/watchdog.py', ['test_tabclose']),
        ('backend/schedule_calc.py', ['test_sccat', 'test_scbalance', 'test_scsplit']),
        ('static/css/70-schedule.css', ['test_fit', 'test_sccols']),
        ('backend/repositories/master_repo.py', ['test_master', 'test_crudroutes']),
        ('static/js/list/list-columns.js', ['test_collayout', 'test_lcpanel', 'test_colsort']),
        ('backend/access_mode.py', ['test_modeguard', 'test_noaccess']),
    ]
    bad = []
    for path, want in cases:
        got, _ = P.pick([path])
        lack = [w for w in want if w not in got]
        if lack:
            bad.append(f'{path}→{",".join(lack)}が漏れ')
    rec('代表的な変更で、関係するテストが選ばれる', not bad,
        ' / '.join(bad) if bad else f'{len(cases)}件')

    # 7. 土台を触ったら全部回す(base.js / index.html / app.py)。
    bad = [p for p in ('static/js/core/base.js', 'templates/index.html', 'app.py',
                       'backend/config.py', 'tests/run_all.sh')
           if P.pick([p])[0] != set()]
    rec('土台を触ったときは全部回す', not bad, ' '.join(bad) if bad else '5件')

    # 8. テストそのものを直したら、そのテストが選ばれる。
    got, _ = P.pick(['tests/test_sccat.js'])
    rec('テスト本体を直したらそのテストが選ばれる', 'test_sccat' in got,
        ' '.join(sorted(got)))

    # 9. 絞り込みが実際に効いているか(全部より少ないこと)。
    got, _ = P.pick(['backend/routes/logs.py'])
    rec('絞り込みが効いている(全件より少ない)', 0 < len(got) < len(files),
        f'{len(got)}/{len(files)}本')

    # 10. 受け皿(FALLBACKS)は名指しのある file へは足さない。
    #     足し合わせにすると`backend/`の受け皿が全backendへ乗り、
    #     `routes/logs.py`を直しただけで起動まわりまで付いてくる。
    #     一度そう書いて17本になった(受け皿を分けて9本)。
    over = [t for t in ('test_boot', 'test_assetcache', 'test_tabclose') if t in got]
    rec('受け皿は名指しのあるファイルへ足さない', not over,
        '混ざった: ' + ' '.join(over) if over else f'{len(got)}本')

    # 11. 受け皿しか当たらないファイルは、その受け皿ぶんだけ選ばれる。
    got4, _ = P.pick(['backend/__init__.py'])            # 受け皿しか当たらない
    rec('受け皿しか当たらないファイルも0件にならない',
        len(got4) > len(P.ALWAYS), f'{len(got4)}本')

    print('\n=== SUMMARY ===')
    ng = [r for r in R if not r[1]]
    print(f'{len(R) - len(ng)}/{len(R)} passed')
    for n, _ok, d in ng:
        print(' -', n, d)
    return 1 if ng else 0


if __name__ == '__main__':
    sys.exit(main())
