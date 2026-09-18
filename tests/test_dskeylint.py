#!/usr/bin/env python3
"""test_dskeylint.py: データソースのキーを決め打ちしていないこと（§9.87）。

============================================================
なぜ要るか
------------------------------------------------------------
データソースマスタの「キー」は利用者が自由に付けられる識別子で、
マスタ管理画面から変更できる。ところがコードのあちこちに
'SIKALOTNOW' / 'SIKALOTDEF' という**文字列そのものが埋め込まれて**
いたため、既定から変えた端末では次のように壊れた（実機で発生）。

  ・左メニューに古いキーのボタンが残り「データベース指定が不正です」
  ・同じ名前の項目が2つ並ぶ
  ・測定・予定の列、品質データ結合、条割の再検索が黙って消える
  ・DBS['SIKALOTDEF'] は **KeyError** で測定画面ごと開けなくなる

VER2.0.0 で役割（作業／品質／その他）による判定へ移したが、置き換えを
grep で拾うときに `!==` 形・`selectDb('...')` 形・セレクタ形を取りこぼし、
**スケジュールモードの仕掛一覧だけが直っていない**という形で再発した。
人間の grep は漏れる。ここで機械的に見る。

判定はこう:
  ・コメント・文字列中の説明文（「仕掛(SIKALOTNOW)」等）は対象外
  ・**実行されるコードに現れるキー文字列**だけを見つける
  ・意図して持ってよい場所（既定値の定義・移行の対応表）は明示的に許す
============================================================
"""
import pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
KEYS = ('SIKALOTNOW', 'SIKALOTDEF')

R = []
def rec(name, ok, detail=''):
    R.append((name, ok, detail))
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + detail) if detail else ''))

# キーを持っていてよい場所。
#   db_access.py       既定の2件の定義と、役割へ移行するときの対応表そのもの
#   changelog_data.py  更新履歴の本文（過去の記録なので書き換えない）
#   master-maint.js    入力欄の例示（「例: SIKALOTNOW」）
#   rne_extract.py 等  モジュールの説明
ALLOW_FILES = {
    'backend/db_access.py',
    'backend/changelog_data.py',
    'backend/rne_extract.py',
    'backend/rne_scheduler.py',
}
# 上のファイル以外でも、この行にキーがあってよいもの（例示のヒント文）
ALLOW_LINE = re.compile(r'例:\s*SIKALOT|例）|hint:')

def strip_comments_py(text):
    """Pythonの # コメントと docstring を空白へ潰す（行番号は保つ）。"""
    out = re.sub(r'("""|\'\'\')[\s\S]*?\1',
                 lambda m: re.sub(r'[^\n]', ' ', m.group(0)), text)
    return re.sub(r'#[^\n]*', lambda m: ' ' * len(m.group(0)), out)

def strip_comments_js(text):
    """JSの // と /* */ を空白へ潰す（行番号は保つ）。"""
    out = re.sub(r'/\*[\s\S]*?\*/',
                 lambda m: re.sub(r'[^\n]', ' ', m.group(0)), text)
    return re.sub(r'//[^\n]*', lambda m: ' ' * len(m.group(0)), out)

def scan(paths, stripper):
    hits = []
    for p in paths:
        rel = str(p.relative_to(ROOT))
        if rel in ALLOW_FILES:
            continue
        code = stripper(p.read_text(encoding='utf-8'))
        for i, line in enumerate(code.split('\n')):
            if not any(k in line for k in KEYS):
                continue
            if ALLOW_LINE.search(line):
                continue
            hits.append(f'{rel}:{i+1} {line.strip()[:80]}')
    return hits

# ---- 1) フロント ----
js = sorted((ROOT / 'static' / 'js').rglob('*.js'))
hits = scan(js, strip_comments_js)
rec('画面のコードがデータソースのキーを決め打ちしていない', not hits,
    ' / '.join(hits[:6]))

# ---- 2) サーバー ----
py = sorted(set(list((ROOT / 'backend').rglob('*.py')) + [ROOT / 'program' / 'app.py']))
hits = scan(py, strip_comments_py)
rec('サーバーのコードがデータソースのキーを決め打ちしていない', not hits,
    ' / '.join(hits[:6]))

# ---- 3) テンプレート ----
tpl = sorted((ROOT / 'templates').glob('*.html'))
hits = []
for p in tpl:
    text = re.sub(r'<!--[\s\S]*?-->', lambda m: re.sub(r'[^\n]', ' ', m.group(0)),
                  p.read_text(encoding='utf-8'))
    for i, line in enumerate(text.split('\n')):
        if any(k in line for k in KEYS):
            hits.append(f'{p.relative_to(ROOT)}:{i+1}')
rec('HTMLがデータソースのキーを決め打ちしていない', not hits, ' / '.join(hits[:6]))

# ---- 4) 判定の入口が1箇所に集まっている ----
# ここが消えると、また各所でキー比較を書き始めることになる。
db_access = (ROOT / 'backend' / 'db_access.py').read_text(encoding='utf-8')
rec('サーバー側の判定の入口がある（WORK_DB_KEY / QUALITY_DB_KEY）',
    'WORK_DB_KEY=' in db_access and 'QUALITY_DB_KEY=' in db_access)
base_js = (ROOT / 'static' / 'js' / 'core' / 'base.js').read_text(encoding='utf-8')
rec('画面側の判定の入口がある（WL.dataSource）',
    'window.WL.dataSource=' in base_js
    and all(f'{n}:' in base_js for n in ('isWork', 'isQuality', 'workKey')))

# ---- 5) 左メニューはカタログから作り直す ----
list_js = (ROOT / 'static' / 'js' / 'list' / 'list-view.js').read_text(encoding='utf-8')
rec('左メニューはカタログに無いボタンを消す',
    'renderDbNav' in list_js and 'wanted.has' in list_js and '.remove()' in list_js)

ng = [x for x in R if not x[1]]
print('\n=== SUMMARY ===')
print(f'{len(R)-len(ng)}/{len(R)} passed')
for n, _, d in ng:
    print(' -', n, d)
sys.exit(1 if ng else 0)
