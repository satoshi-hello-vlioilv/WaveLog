#!/usr/bin/env python3
"""test_saferegex.py: 照合が止まらなくなる正規表現を断る（§9.629・評価関数）。

利用者が書く正規表現（表示ルール・ダッシュボードの式・設備グループの決まり・判定表の条件）は共有のマスタに置く。
入れ子の繰り返し（`(a+)+$` など）は、当たらない字が1文字増えるたびに照合の時間がおよそ倍になる。
直す前は、25 文字の字で 6 つの見本のうち 5 つが 0.6〜2.3 秒かかった（30 文字では数十秒〜1分ほどの見込み）。
ここで見ること:
- サーバーの`safe_regex.risk()`が危ない形を断り、ふつうの形は通す
- 画面の`WL.formula.regexRisk()`（list-formula.js）がサーバーと同じ答えを出す（同じ見本で突き合わせる）
- 表示ルールの照合（sort_order）・ダッシュボードの式・設備グループの決まりで、危ない形はすぐ「当たらない／断る」になる
"""
import json
import pathlib
import shutil
import subprocess
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from backend import safe_regex, sort_order  # noqa: E402
from backend.dashboard import formula as F  # noqa: E402
from backend.dashboard import equip_groups  # noqa: E402

NODE = shutil.which('node') or '/opt/node22/bin/node'
R = []


def rec(name, ok, detail=''):
    R.append(ok)
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + str(detail)) if detail else ''))


BAD = [r'(a+)+$', r'(a*)*b', r'([a-z]+)*$', r'(\w+\s?)+$', r'(.*a){12}$', r'((ab)*)+', r'(?:a+)+', r'(a+){2,}',
       r'(x+x+)+y', r'(?P<n>a+)+', r'(?<n>\d+)*', r'(a+?)+']
GOOD = [r'^L-\d+$', r'(ab)+', r'[a-z]+\d*', r'(a|b)+', r'a{2,5}', r'(\d+)-\1', r'\(a+\)+', r'[(a+)]+', r'^(L|M)-\d{3}$',
        r'(a?)+', r'(ab){3}', r'C(\d)', r'\w+$', r'[^]]+', r'(?:x)?y', r'[A-Z]{2,}', r'a{2}', r'(a){1}']

bad_missed = [p for p in BAD if not safe_regex.risk(p)]
rec(f'危ない形（入れ子の繰り返し）は {len(BAD)} 個とも断る', not bad_missed, bad_missed)
good_refused = [p for p in GOOD if safe_regex.risk(p)]
rec(f'ふつうの形 {len(GOOD)} 個は通す', not good_refused, good_refused)

# 画面の判定と同じ答え（list-formula.js を node の中で読む・式の網 formula_parity.js と同じ読み方）
js = r"""
const fs=require('fs'),vm=require('vm');const ctx={console};ctx.window=ctx;ctx.WL={};vm.createContext(ctx);
vm.runInContext(fs.readFileSync(process.argv[1],'utf8'),ctx);
const pats=JSON.parse(fs.readFileSync(0,'utf8'));
process.stdout.write(JSON.stringify(pats.map(p=>ctx.WL.formula.regexRisk(p))));
"""
pats = BAD + GOOD
out = subprocess.run([NODE, '-e', js, str(ROOT / 'static' / 'js' / 'list' / 'list-formula.js')], input=json.dumps(pats),
                     capture_output=True, text=True, encoding='utf-8')
try:
    js_ans = json.loads(out.stdout)
except ValueError:
    js_ans = None
diff = [(p, bool(safe_regex.risk(p)), bool(j)) for p, j in zip(pats, js_ans or [])
        if bool(safe_regex.risk(p)) != bool(j)] if js_ans else ['画面の判定を読めない: ' + out.stderr[-300:]]
rec('画面（WL.formula.regexRisk）とサーバー（safe_regex.risk）が同じ答え', js_ans is not None and not diff, diff)
rec('断る理由は同じ字（画面とサーバー）', js_ans is not None and {j for j in js_ans if j} == {safe_regex.NESTED})

# 照合の時間（直す前は 1 本で 0.6〜2.3 秒・30 文字ならさらに 30 倍以上）
# 表示ルールの照合（sort_order.rule_test・一覧の並べ替えが行ごとに呼ぶ）で測る
s = 'a' * 30 + '!'
ms, hit = [], []
for p in BAD:
    t = time.perf_counter()
    hit.append(sort_order.rule_test({'op': 'regex', 'left': {'kind': 'self'}, 'right': {'kind': 'value', 'value': p}}, {'c': s}, 'c'))
    ms.append((time.perf_counter() - t) * 1000)
rec('表示ルールの危ない形はすぐ「当たらない」（30 文字の字・1 本 50ms 未満）', max(ms) < 50 and not any(hit), f'最大 {max(ms):.1f}ms・当たり {hit}')
rec('表示ルールのふつうの形は今までどおり当たる',
    sort_order.rule_test({'op': 'regex', 'left': {'kind': 'self'}, 'right': {'kind': 'value', 'value': r'^L-\d+$'}}, {'c': 'L-123'}, 'c'))
rec('ふつうの形は今までどおり照合する', safe_regex.compile_safe(r'^L-\d+$').search('L-123') is not None
    and safe_regex.compile_safe('(') is None)

# ダッシュボードの式の正規表現（js_regex）は断る理由を返す
try:
    F.js_regex(r'(a+)+$')
    why = ''
except F.FormulaError as e:
    why = str(e)
rec('ダッシュボードの式は危ない正規表現を断る（理由つき）', why == safe_regex.NESTED, why)

# 設備グループの決まりは保存の前に断る
try:
    equip_groups.clean_rules([{'op': 'regex', 'value': r'(a+)+$'}])
    gwhy = ''
except equip_groups.GroupError as e:
    gwhy = str(e)
except Exception as e:  # 決まりの字の読み方が違うときはそのまま見せる
    gwhy = 'その他: ' + repr(e)
rec('設備グループの決まりは危ない正規表現を断る', '入れ子の繰り返し' in gwhy, gwhy)

ok = sum(1 for x in R if x)
print(f'\n== {ok}/{len(R)} PASS ==')
sys.exit(0 if ok == len(R) else 1)
