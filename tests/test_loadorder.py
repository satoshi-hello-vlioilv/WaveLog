"""test_loadorder.py: アプリのJSの読み込み順は `core.py` の `JS_FILES` の1箇所（§9.324 R3）

起動ローダー（templates/index.html）は以前、17→28本のファイル名を自分で並べて
いた。マスタ管理を5本に分けた（§9.324 R3）ことで**順番に意味のある組**
（定義 → 盤 → 専用画面）が増えたので、一覧を `backend/routes/core.py` へ移し、
テンプレートはそれを描くだけにした。ここで固定するのは4つ:
  1. `static/js` の全部が **1度ずつ** 載っている（足したのに読まれない／2度読む、を作らない）
  2. 順の約束——`base.js` が先頭・`access-mode.js` が末尾・マスタ管理は
     `master-defs.js` → `master-maint.js` → 専用画面の3本
  3. テンプレートは一覧を書き写していない（`js_files` を描いている）
  4. 専用画面（`special:`）の鍵が**全部登録簿へ名乗っている**——盤の`if`を
     消して登録簿にした以上、名乗り忘れた画面は開けない（機械で突き合わせる）
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.routes.core import JS_FILES  # noqa: E402

R = []


def rec(name, ok, detail=''):
    R.append((name, ok))
    print(('PASS: ' if ok else 'FAIL: ') + name + (f' -- {detail}' if detail else ''))


# ---- 1. static/js と1対1 ----
on_disk = sorted(p.name for p in (ROOT / 'static' / 'js').glob('*.js'))
dup = sorted({f for f in JS_FILES if JS_FILES.count(f) > 1})
rec('JS_FILES に重複が無い', not dup, str(dup))
rec('static/js の全部が JS_FILES に載っている', set(on_disk) <= set(JS_FILES),
    str(sorted(set(on_disk) - set(JS_FILES))))
rec('JS_FILES に実体の無いファイルが無い', set(JS_FILES) <= set(on_disk),
    str(sorted(set(JS_FILES) - set(on_disk))))

# ---- 2. 順の約束 ----
idx = {f: i for i, f in enumerate(JS_FILES)}
rec('base.js が先頭', JS_FILES[0] == 'base.js')
rec('access-mode.js が末尾', JS_FILES[-1] == 'access-mode.js')
master = ['master-defs.js', 'master-maint.js', 'master-report.js', 'master-data.js', 'master-opdata.js']
rec('マスタ管理は 定義 → 盤 → 専用画面 の順',
    all(f in idx for f in master) and idx[master[0]] < idx[master[1]] < min(idx[f] for f in master[2:]),
    str([idx.get(f) for f in master]))

# ---- 3. テンプレートは書き写していない ----
html = (ROOT / 'templates' / 'index.html').read_text(encoding='utf-8')
rec('index.html は js_files を描くだけ', 'for f in js_files' in html)
literal = re.findall(r"^\s*'([a-z0-9-]+\.js)',?\s*$", html, re.M)
rec('index.html にファイル名の一覧を書き写していない', not literal, str(literal[:5]))

# ---- 4. special: の鍵は全部登録簿へ名乗っている ----
defs_js = (ROOT / 'static' / 'js' / 'master-defs.js').read_text(encoding='utf-8')
specials = sorted(set(re.findall(r"special:'([a-z-]+)'", defs_js)))
registered = set()
for f in master:
    registered |= set(re.findall(r"registerSpecial\('([a-z-]+)'", (ROOT / 'static' / 'js' / f).read_text(encoding='utf-8')))
rec('MASTER_DEFS の special: を全部拾えた', len(specials) >= 10, str(len(specials)))
rec('special: の鍵は全部 registerSpecial で名乗っている',
    set(specials) <= registered, str(sorted(set(specials) - registered)))
rec('名乗っているのに定義に無い鍵が無い', registered <= set(specials), str(sorted(registered - set(specials))))
# 盤に `def.special==='…'` の分岐が戻っていないこと（登録簿を迂回する写し）
maint_js = (ROOT / 'static' / 'js' / 'master-maint.js').read_text(encoding='utf-8')
back = re.findall(r"special===?'([a-z-]+)'", maint_js)
rec('盤に special ごとの if が戻っていない', not back, str(back[:5]))

ng = [n for n, ok in R if not ok]
print(f'\n== {len(R) - len(ng)}/{len(R)} PASS ==')
sys.exit(1 if ng else 0)
