# -*- coding: utf-8 -*-
"""test_eslint.py: JSの標準lint（eslint）を網にする（§9.326、REVIEW 3-1）。

============================================================
なぜ要るか
------------------------------------------------------------
`tests/test_patchlint.py`が守っているのは「別ファイルからの全置換」だけで、
**同じファイルの中で同じ関数を2度定義する**形は素通りしていた。実測で
`report-dashboard.js`の`fmtMin`が同じIIFEの中に2つあり、先の定義
（`H時間M分`）は**一度も実行されない死んだコード**だった（宣言は巻き上げで
後の側が勝つ）。eslintの`no-redeclare`なら1分で出る。

規則は`eslint.config.mjs`の1箇所が持つ（網とエディタが同じものを見る）。
この網が固定するのは2つ:
 ① 'error' の規則（二重定義・到達しない文・危ない書き方）が**0件**
 ② 'warn' の規則（使っていない局所変数・空のブロック）が
    **ファイルごとに今の件数を超えない**（`tests/fixtures/eslint_baseline.json`）。
    減ったら上限も下げる——`python3 tests/test_eslint.py --update`で書き直す
    （黙って下がると次に増えたとき気づけない）。**上限を上げる更新はしない**
    （`--update`も増えた側は断る）。

------------------------------------------------------------
約束
------------------------------------------------------------
 * eslint が無い環境では**落とす**（黙って通さない・§CLAUDE 4）。探す順は
   `WAVELOG_ESLINT` → PATH の `eslint` → `WAVELOG_NODE` と同じ場所の `eslint`。
   入れ方は `npm i -g eslint`（v9以上・flat config）。
 * 網そのものが素通りしないことを確かめる（二重定義を1つ注いで1件になる）。
 * 見張る先は `static/js` と `tests`（同梱の`static/vendor`は他人のCSS/JSなので
   対象外・§9.298）。
============================================================
"""
import json
import os
import pathlib
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
BASELINE = ROOT / 'tests' / 'fixtures' / 'eslint_baseline.json'
TARGETS = ['static/js', 'tests']
CAPPED = ('no-unused-vars', 'no-empty')
R = []


def rec(name, ok, detail=''):
    R.append(ok)
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + str(detail)) if detail else ''))


def eslint_cmd():
    cands = [os.environ.get('WAVELOG_ESLINT'), shutil.which('eslint')]
    node = os.environ.get('WAVELOG_NODE') or '/opt/node22/bin/node'
    cands.append(str(pathlib.Path(node).parent / 'eslint'))
    for c in cands:
        if c and pathlib.Path(c).exists():
            return [c]
    return None


def run(cmd, targets):
    """eslint を JSON で回し、{rel_path: [(rule, severity, line, msg)]} に。"""
    r = subprocess.run(cmd + ['-f', 'json', '--no-error-on-unmatched-pattern'] + targets,
                       capture_output=True, text=True, cwd=str(ROOT), timeout=600)
    try:
        data = json.loads(r.stdout)
    except Exception:
        raise RuntimeError('eslint の出力が読めません: ' + (r.stderr or r.stdout)[:400])
    out = {}
    for f in data:
        rel = os.path.relpath(f['filePath'], str(ROOT)).replace(os.sep, '/')
        out[rel] = [(m.get('ruleId') or '?', m['severity'], m['line'], m['message'])
                    for m in f['messages']]
    return out


def counts(found):
    """{rel: {rule: n}}（上限つきの規則だけ）。0件のファイルは載せない。"""
    c = {}
    for rel, msgs in found.items():
        d = {}
        for rule, sev, _, _ in msgs:
            if rule in CAPPED:
                d[rule] = d.get(rule, 0) + 1
        if d:
            c[rel] = dict(sorted(d.items()))
    return dict(sorted(c.items()))


def main(update=False):
    cmd = eslint_cmd()
    rec('eslint が使える（無ければ npm i -g eslint）', bool(cmd))
    if not cmd:
        return
    found = run(cmd, TARGETS)
    errors = [(rel, rule, ln, msg) for rel, msgs in found.items()
              for rule, sev, ln, msg in msgs if sev == 2]
    rec("'error' の規則（二重定義・到達しない文・危ない書き方）が0件", not errors,
        '; '.join(f'{rel}:{ln} {rule} {msg}' for rel, rule, ln, msg in errors[:20]))
    now = counts(found)
    base = json.loads(BASELINE.read_text(encoding='utf-8')) if BASELINE.exists() else {}
    over, under = [], []
    for rel, d in now.items():
        for rule, n in d.items():
            b = base.get(rel, {}).get(rule, 0)
            if n > b:
                over.append(f'{rel} {rule} {b}→{n}')
            elif n < b:
                under.append(f'{rel} {rule} {b}→{n}')
    for rel, d in base.items():
        for rule, b in d.items():
            if now.get(rel, {}).get(rule, 0) == 0 and b > 0:
                under.append(f'{rel} {rule} {b}→0')
    if update:
        if over and base:  # 最初の1回（baseline が無い）だけは書き下ろせる
            print('!! 上限を上げる更新はしません: ' + '; '.join(over))
        else:
            BASELINE.write_text(json.dumps(now, ensure_ascii=False, indent=1) + '\n',
                                encoding='utf-8')
            print(f'baseline を書き直しました: {BASELINE} ({len(now)} files)')
    total = {r: sum(d.get(r, 0) for d in now.values()) for r in CAPPED}
    rec("'warn' の規則がファイルごとの上限を超えていない（増えたら落ちる）", not over,
        '; '.join(over[:20]) or f'いま {total}')
    if under:
        print('   注: 上限を下げられます（python3 tests/test_eslint.py --update）: '
              + '; '.join(under[:10]) + (' …' if len(under) > 10 else ''))
    # 素通りしないこと: 二重定義を1つ注いで数えられるか
    probe = ROOT / 'tests' / '_eslint_probe.js'
    try:
        probe.write_text('function a(){return 1}\nfunction a(){return 2}\na();\n',
                         encoding='utf-8')
        f2 = run(cmd, ['tests/_eslint_probe.js'])
        rules = [rule for msgs in f2.values() for rule, sev, _, _ in msgs if sev == 2]
        rec('網そのものが素通りしない（注いだ二重定義を no-redeclare で数える）',
            rules == ['no-redeclare'], rules)
    finally:
        try:
            probe.unlink()
        except FileNotFoundError:
            pass

    # ---- 画面のJSは「呼んでいるのに無い」を落とす（§9.354、REVIEW 3-17） ----
    # globals は `eslint.config.mjs` が**実物から作る**（どのファイルのトップレベルに
    # 何があるか）。だから**IIFE で閉じた瞬間にその名前は globals から外れ**、外から
    # 呼んでいれば `no-undef` が出る——5本を1本ずつ閉じる 3-17 を機械が守る。
    # 実測（この仕組みを入れたとき）: `toast(...)`（正しくは `showToast`）が1件。
    # `typeof` で囲ってあったので例外にならず、**断りの一言が一度も出ていなかった**。
    probe2 = ROOT / 'static' / 'js' / '_undef_probe.js'
    try:
        probe2.write_text('function zzProbe(){ return zzNoSuchGlobal(1) }\nzzProbe();\n',
                          encoding='utf-8')
        f3 = run(cmd, ['static/js/_undef_probe.js'])
        rules2 = [rule for msgs in f3.values() for rule, sev, _, _ in msgs if sev == 2]
        rec('無い名前の呼び出しを no-undef で数える（閉じたファイルの中身を外から呼んだら落ちる）',
            rules2 == ['no-undef'], rules2)
    finally:
        try:
            probe2.unlink()
        except FileNotFoundError:
            pass
    # 閉じたファイル（IIFE）が globals へ漏れていないこと——漏れると網が黙る
    probe3 = ROOT / 'static' / 'js' / '_wrapped_probe.js'
    probe4 = ROOT / 'static' / 'js' / '_caller_probe.js'
    try:
        probe3.write_text('(function(){\nfunction zzInside(){return 1}\nzzInside();\n})();\n',
                          encoding='utf-8')
        probe4.write_text('function zzOutside(){ return zzInside() }\nzzOutside();\n',
                          encoding='utf-8')
        f4 = run(cmd, ['static/js/_caller_probe.js'])
        rules3 = [rule for msgs in f4.values() for rule, sev, _, _ in msgs if sev == 2]
        rec('IIFE で閉じたファイルの中身は globals へ出ない（外から呼ぶと落ちる）',
            rules3 == ['no-undef'], rules3)
    finally:
        for x in (probe3, probe4):
            try:
                x.unlink()
            except FileNotFoundError:
                pass


if __name__ == '__main__':
    try:
        main(update='--update' in sys.argv)
    except Exception as e:  # 途中で止まっても件数を偽らない（§9.244）
        rec('例外で止まらない', False, repr(e))
    n_ok = sum(1 for x in R if x)
    print(f'\n{n_ok} PASS / {len(R) - n_ok} FAIL')
    sys.exit(0 if all(R) else 1)
