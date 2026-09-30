"""test_loadorder.py: アプリのJSの読み込み順は `core.py` の `JS_FILES` の1箇所（§9.324 R3）

起動ローダー（templates/index.html）は以前、17→28本のファイル名を自分で並べて
いた。マスタ管理を5本に分けた（§9.324 R3）ことで**順番に意味のある組**
（定義 → 盤 → 専用画面）が増えたので、一覧を `backend/routes/core.py` へ移し、
テンプレートはそれを描くだけにした。ここで固定するのは5つ:
  1. `static/js` の全部が **1度ずつ** 載っている（足したのに読まれない／2度読む、を作らない）
  2. 順の約束——`core/base.js` が先頭・`core/access-mode.js` が末尾・マスタ管理は
     `master-defs.js` → `master-maint.js` → 専用画面の3本
  3. テンプレートは一覧を書き写していない（`js_files` を描いている）
  4. 専用画面（`special:`）の鍵が**全部登録簿へ名乗っている**——盤の`if`を
     消して登録簿にした以上、名乗り忘れた画面は開けない（機械で突き合わせる）
  5. **領域フォルダの約束**（§9.334、REVIEW 3-9）——`static/js` の直下に
     `.js` を置かない・領域は6つだけ・`measure/` の中は `measure-*` か
     その領域固有の名前。**平らに戻るのは1回の判断ではなく小さな判断の
     積み上がり**なので、注意書きではなく網で止める。
  6. **画面の骨組み**（§9.522、REVIEW 3-7）——`WL.template('名前')` で呼ぶ骨組みは
     index.html の `<template id="tpl-名前">` と過不足なく対応する（呼んでいるのに無い／
     置いてあるのに誰も呼ばない、を作らない）。index.html は **Jinja が読める**こと
     （骨組みの説明に Jinja の構文の字を書くと、起動画面ごと出なくなる。実際にやった）。
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
JS_DIR = ROOT / 'static' / 'js'
on_disk = sorted(p.relative_to(JS_DIR).as_posix() for p in JS_DIR.rglob('*.js'))
dup = sorted({f for f in JS_FILES if JS_FILES.count(f) > 1})
rec('JS_FILES に重複が無い', not dup, str(dup))
rec('static/js の全部が JS_FILES に載っている', set(on_disk) <= set(JS_FILES),
    str(sorted(set(on_disk) - set(JS_FILES))))
rec('JS_FILES に実体の無いファイルが無い', set(JS_FILES) <= set(on_disk),
    str(sorted(set(JS_FILES) - set(on_disk))))

# ---- 2. 順の約束 ----
idx = {f: i for i, f in enumerate(JS_FILES)}
rec('base.js が先頭', JS_FILES[0] == 'core/base.js')
rec('access-mode.js が末尾', JS_FILES[-1] == 'core/access-mode.js')
master = ['master/master-defs.js', 'master/master-maint.js', 'master/master-report.js',
          'master/master-data.js', 'master/master-opdata.js']
rec('マスタ管理は 定義 → 盤 → 専用画面 の順',
    all(f in idx for f in master) and idx[master[0]] < idx[master[1]] < min(idx[f] for f in master[2:]),
    str([idx.get(f) for f in master]))

# ---- 3. テンプレートは書き写していない ----
html = (ROOT / 'templates' / 'index.html').read_text(encoding='utf-8')
rec('index.html は js_files を描くだけ', 'for f in js_files' in html)
literal = re.findall(r"^\s*'([a-z0-9-]+\.js)',?\s*$", html, re.M)
rec('index.html にファイル名の一覧を書き写していない', not literal, str(literal[:5]))

# ---- 4. special: の鍵は全部登録簿へ名乗っている ----
defs_js = (JS_DIR / 'master' / 'master-defs.js').read_text(encoding='utf-8')
specials = sorted(set(re.findall(r"special:'([a-z-]+)'", defs_js)))
# **読み込まれる全部を見る**（§9.380）。以前は master の5本しか見ておらず、
# 専用画面を別の領域（`bladeset/blade-pick.js`）へ置いたときに「名乗っていない」
# と誤って落ちた。**本当に見たいのは「宙に浮いた special: が無い」こと**なので、
# 実際に配られるファイルを全部見るほうが正しく、しかも取りこぼしが減る。
# ただし `WL.mm.registerSpecial` は盤が作るので、**盤より後で読まれること**まで
# 見る——先に読まれると名乗れないまま素通りする（数え落としは緩む側に壊れる）。
registered = set()
late = set()
for f in JS_FILES:
    keys = set(re.findall(r"registerSpecial\('([a-z-]+)'", (JS_DIR / f).read_text(encoding='utf-8')))
    if not keys:
        continue
    registered |= keys
    if idx[f] > idx['master/master-maint.js']:
        late |= keys
rec('専用画面は盤（master-maint.js）より後で読まれる',
    registered == late, str(sorted(registered - late)))
rec('MASTER_DEFS の special: を全部拾えた', len(specials) >= 10, str(len(specials)))
rec('special: の鍵は全部 registerSpecial で名乗っている',
    set(specials) <= registered, str(sorted(set(specials) - registered)))
rec('名乗っているのに定義に無い鍵が無い', registered <= set(specials), str(sorted(registered - set(specials))))
# 盤に `def.special==='…'` の分岐が戻っていないこと（登録簿を迂回する写し）
maint_js = (JS_DIR / 'master' / 'master-maint.js').read_text(encoding='utf-8')
back = re.findall(r"special===?'([a-z-]+)'", maint_js)
rec('盤に special ごとの if が戻っていない', not back, str(back[:5]))

# ---- 5. 領域フォルダの約束（§9.334、REVIEW 3-9） ----
# **領域はここの1箇所**。増やすときは理由を添えて1行足す——気軽に増やすと
# 「どこに置くか」を毎回考え直すことになり、平らな32本と同じ状態へ戻る。
AREAS = {
    'core':     '土台とアプリ自身のこと（base / 浮き窓 / 紙の共通核 / 権限 / ログ）',
    'list':     '一覧（仕掛・品質データ分析）と、その列・絞り込み・計算式',
    'measure':  '測定画面（入力・公差・条割・異常位置・記録の保存）',
    'master':   'マスタ管理（定義・盤・専用画面）',
    'schedule': '作業スケジュールとカレンダー',
    'report':   '紙にする画面（帳票・実績データ表）',
    # 刃組ガイダンス（§9.377）。**測定でも一覧でもスケジュールでもない**——
    # 元コイル幅・切断幅・板厚から刃とスペーサーの組み方を出す独立した仕事で、
    # 入口が2つ（左メニューと、設備停止の行の連携機能）ある。計算（core）と
    # 画面（view）の2本で閉じており、他の領域からは `WL.bladeGuide.open()` の
    # 1つだけを呼ぶ。
    'bladeset': '刃組ガイダンス（刃・スペーサー・ゴムリング・フィンガーの組み方）',
}
flat = sorted(p.name for p in JS_DIR.glob('*.js'))
rec('static/js の直下に .js を置かない（領域フォルダへ入れる）', not flat, str(flat))
dirs = sorted(d.name for d in JS_DIR.iterdir() if d.is_dir())
rec('領域は宣言した%d つだけ'%len(AREAS), set(dirs) == set(AREAS), str(sorted(set(dirs) ^ set(AREAS))))
rec('領域に説明が書いてある', all(len(v.strip()) >= 10 for v in AREAS.values()))
# 接頭辞の不揃い（§9.334）——`measure-*` と `measurement-*` が同じ領域に
# 混ざっていた。**綴りは1つ**にそろえたので、片方が戻れば落ちる。
stray = sorted(p.name for p in (JS_DIR / 'measure').glob('measurement-*.js'))
rec('measure/ に measurement-* が戻っていない', not stray, str(stray))

# ---- 6. テストが開く／取りに行く static/js の道（§9.334 の追補） ----
# 領域フォルダにしたとき、**テスト側の道を直し切れていなかった**。フルスイートで
# 4件が落ちて分かった（`test_formula` は `require` が MODULE_NOT_FOUND、
# `test_rbcells`/`test_colscope` は `open`/`read_text` が FileNotFoundError、
# `test_bootflash` は一覧を0本と数えた）。**さらに悪いのが3件**——
# `fetch('/js/master-defs.js')` は 404 のHTMLを返すだけなので、
# 「画面のJSに◯◯を書き写していない」を見る網が**空の材料で必ず通って**いた
# （緩む側に壊れるので、通ったこと自体が証拠にならない・§9.335）。
#
# 見るのは**道を組み立てている場所だけ**——`'static','js'`（`,`でも`/`でも）の
# 連結と、`/js/`・`/static/js/` への fetch。名前を鍵として並べているだけの
# 一覧（`test_globallint`の`LEGACY_FILES`・`test_patchlint`の`ALLOWED`など）は
# **対象外**（`path.name`と突き合わせる正しい書き方なので、混ぜると誤検知になる）。
PATH_CTX = re.compile(r"""['"]static['"]\s*[,/]\s*['"]js['"]|fetch\([^)]*['"]/(?:static/)?js/['"]""")
AREA_RE = '|'.join(AREAS)
stems = {p.stem for p in JS_DIR.rglob('*.js')}
jsnames = {p.name for p in JS_DIR.rglob('*.js')}
stale = []
for f in sorted(list((ROOT / 'tests').glob('*.js')) + list((ROOT / 'tests').glob('*.py'))):
    ls = f.read_text(encoding='utf-8').split('\n')
    for i, line in enumerate(ls):
        if not PATH_CTX.search(line):
            continue
        ctx = '\n'.join(ls[max(0, i - 3):i + 2])   # 名前は fetch の前の行に並ぶ
        for m in re.finditer(r"""['"]([A-Za-z0-9_-]+)(\.js)?['"]""", ctx):
            tok = m.group(1)
            if tok in ('static', 'js') or re.fullmatch(AREA_RE, tok):
                continue
            if tok not in stems and (tok + '.js') not in jsnames:
                continue
            if (re.search(r"""['"](?:%s)['"]\s*[,/]\s*['"]%s""" % (AREA_RE, re.escape(tok)), ctx)
                    or re.search(r'(?:%s)/%s' % (AREA_RE, re.escape(tok)), ctx)):
                continue                              # 領域が付いている
            stale.append(f'{f.name}:{i + 1} {tok}')
rec('テストが開く static/js の道に領域が付いている', not stale,
    ', '.join(sorted(set(stale))[:6]) + (f'（計{len(set(stale))}）' if stale else ''))

# ---- 6. 画面の骨組み（§9.522、REVIEW 3-7） ----
TPL_CALL = re.compile(r"""WL\.template\(\s*['"]([\w-]+)['"]\s*\)""")
called = {m.group(1) for p in JS_DIR.rglob('*.js') for m in TPL_CALL.finditer(p.read_text(encoding='utf-8'))}
placed = re.findall(r'<template id="tpl-([\w-]+)"', html)
rec('骨組みの id に重複が無い', len(placed) == len(set(placed)), str(placed))
rec('WL.template で呼ぶ骨組みは全部 index.html に在る', called <= set(placed), str(sorted(called - set(placed))))
rec('index.html の骨組みは全部どこかが呼んでいる', set(placed) <= called, str(sorted(set(placed) - called)))
rec('骨組みを1つ以上 HTML に置いている（網が空振りしていない）', len(placed) >= 1, str(placed))
try:
    import jinja2
    jinja2.Environment().parse(html)
    rec('index.html を Jinja が読める（骨組みの説明に構文の字を書いていない）', True)
except Exception as e:  # 読めない＝起動画面ごと出ない
    rec('index.html を Jinja が読める（骨組みの説明に構文の字を書いていない）', False, repr(e)[:200])

ng = [n for n, ok in R if not ok]
print(f'\n== {len(R) - len(ng)}/{len(R)} PASS ==')
sys.exit(1 if ng else 0)
