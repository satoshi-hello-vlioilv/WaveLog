# -*- coding: utf-8 -*-
"""test_modalwords.py: 窓の言葉の見張り（§9.604・ステップ6）。

窓（`confirmModal`／`alertModal`／`promptModal`）は呼び出しが150か所あり、画面の網で全部を開いて回るのは遅く、
**開き忘れた1つは永久に見られない**。字を読むだけの網で、新しい呼び出しを足した瞬間から見張る:

  ① 英字の小見出し（`eyebrow:'DELETE ALL'` のような大文字の英字）を渡さない——小見出しは**いる画面の名前**
     （`whereName()`）が既定。前は 132／152 の呼び出しで英字の決まり文句（CONFIRMATION・NOTICE・INPUT…）が出ていた
  ② 確かめる窓（`confirmModal`）は**決めるボタンの字**（`confirmLabel`・何が起きるかの動詞）を必ず渡す。
     前は 45 か所が「OK」だった（何が起きるかを言わない）
  ③ 窓の土台の既定値に英字を戻さない（`base.js`）
  ④ 画面の字（HTML の小見出し）に大文字の英字の札を書かない
  ⑥ 同じ操作は同じ言葉: 削除の決めるボタンは「削除する」の1つ（前は「消す」14か所・「削除する」21か所に分かれていた）、
     やめる側は既定の「キャンセル」（前は「やめる」を19か所で渡していた）
  ⑦ 保存していない変更を捨てるかを聞く窓は`WL.mm.confirmDiscard()`の1つ（前は3か所が別の題・別のボタン・赤と灰で聞いていた）
"""
import re
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
R = []


def rec(name, ok, detail=''):
    R.append((name, ok))
    print(('PASS' if ok else 'FAIL') + ': ' + name + (' -- ' + str(detail) if detail else ''))


def calls(text, fn):
    """`fn(` の呼び出しの引数の字を返す（括弧の深さで終わりを決める）。関数の定義そのものは除く。"""
    for m in re.finditer(r'(?<![\w.])%s\(' % fn, text):
        if text[max(0, m.start() - 9):m.start()].endswith('function '):
            continue
        i, depth = m.end(), 1
        while i < len(text) and depth:
            depth += {'(': 1, ')': -1}.get(text[i], 0)
            i += 1
        yield text.count('\n', 0, m.start()) + 1, text[m.end():i - 1]


ENG = re.compile(r"eyebrow\s*:\s*['\"`]([A-Z][A-Z0-9 &/()-]{2,})['\"`]")


def scan(files):
    eng, nolabel, n = [], [], 0
    for p in files:
        s = p.read_text(encoding='utf-8')
        rel = p.relative_to(ROOT) if ROOT in p.parents else p.name
        for fn in ('confirmModal', 'alertModal', 'promptModal'):
            for line, arg in calls(s, fn):
                n += 1
                for m in ENG.finditer(arg):
                    eng.append('%s:%d %s' % (rel, line, m.group(1)))
                # 土台の中の受け渡し（`{...o,…}` や `o`）は呼ぶ側の字をそのまま運ぶので数えない
                if fn == 'confirmModal' and not re.search(r'confirmLabel\s*:', arg) \
                        and not arg.strip().startswith(('o', '{...o')):
                    nolabel.append('%s:%d' % (rel, line))
    return eng, nolabel, n


FILES = sorted(p for p in (ROOT / 'static/js').rglob('*.js') if 'vendor' not in p.parts)
eng, nolabel, n = scan(FILES)
rec('前提: 窓の呼び出しを実際に拾えている', n > 120, '%d か所' % n)
rec('① 英字の小見出しを渡さない（小見出しはいる画面の名前）', not eng, ' / '.join(eng[:6]))
rec('② 確かめる窓は決めるボタンの字（動詞）を必ず渡す（「OK」にしない）', not nolabel, ' / '.join(nolabel[:8]))

base = (ROOT / 'static/js/core/base.js').read_text(encoding='utf-8')
rec('③ 土台の既定の小見出しはいる画面の名前（英字の決まり文句を戻さない）',
    'function whereName(' in base and "'CONFIRMATION'" not in base and "'NOTICE'" not in base and "'INPUT'" not in base)
rec('③ 1行入力の「やめる」の既定は「キャンセル」（ほかの窓と同じ字）', "cancelLabel:o.cancelLabel||'キャンセル'" in base)

UPPER = re.compile(r'<(small|span|b)[^>]*>([A-Z][A-Z0-9 &/()-]{4,})</\1>')
labels = []
for p in FILES + [ROOT / 'templates/index.html']:
    for m in UPPER.finditer(p.read_text(encoding='utf-8')):
        labels.append('%s %s' % (p.name, m.group(2)))
rec('④ 画面の小見出しに大文字の英字の札を書かない', not labels, ' / '.join(labels[:6]))

# 同じ操作の言い換え（窓の呼び出しの中だけを見る。ほかの字の「消す」は数えない）
SYNONYMS = [(re.compile(r"confirmLabel\s*:\s*['\"`]消す['\"`]"), '削除の決めるボタンは「削除する」'),
            (re.compile(r"cancelLabel\s*:\s*['\"`]やめる['\"`]"), 'やめる側は既定の「キャンセル」')]


def synonyms(files):
    out = []
    for p in files:
        s = p.read_text(encoding='utf-8')
        rel = p.relative_to(ROOT) if ROOT in p.parents else p.name
        for fn in ('confirmModal', 'alertModal', 'promptModal'):
            for line, arg in calls(s, fn):
                out += ['%s:%d %s' % (rel, line, why) for rx, why in SYNONYMS if rx.search(arg)]
    return out


syn = synonyms(FILES)
rec('⑥ 同じ操作は同じ言葉（削除は「削除する」・やめる側は「キャンセル」）', not syn, ' / '.join(syn[:6]))

DISCARD = re.compile(r"confirmLabel\s*:\s*['\"`][^'\"`]*捨て")


def discards(files):
    out = []
    for p in files:
        s = p.read_text(encoding='utf-8')
        rel = p.relative_to(ROOT) if ROOT in p.parents else p.name
        for line, arg in calls(s, 'confirmModal'):
            if DISCARD.search(arg):
                out.append('%s:%d' % (rel, line))
    return out


dis = discards(FILES)
base_maint = (ROOT / 'static/js/master/master-maint.js').read_text(encoding='utf-8')
rec('⑦ 捨てるかを聞く窓は confirmDiscard() の1つ（ほかの呼び出しは捨てるボタンを書かない）',
    len(dis) == 1 and dis[0].startswith('static/js/master/master-maint.js:') and 'function confirmDiscard(' in base_maint, dis)

# ---- ⑤ 網が素通りしないこと（欠陥を食わせて捕まえる） ----
# 試しのファイルは一時の置き場へ（本物の置き場へ書かない・§9.504）
with tempfile.TemporaryDirectory() as tmp:
    probe = Path(tmp) / 'probe.js'
    probe.write_text("confirmModal({title:'x',eyebrow:'DELETE ALL'});\nconfirmModal('消しますか？');\n"
                     "confirmModal({message:'y',confirmLabel:'消す'});\nalertModal({eyebrow:'NOTICE',message:'z'});\n", encoding='utf-8')
    e2, n2, c2 = scan([probe])
    probe.write_text("confirmModal({message:'a',confirmLabel:'消す',cancelLabel:'やめる'});\nconfirmModal({message:'b',confirmLabel:'削除する'});\n", encoding='utf-8')
    s2 = synonyms([probe])
    probe.write_text("confirmModal({title:'x',confirmLabel:'捨てて移る'});\n", encoding='utf-8')
    d2 = discards([probe])
rec('⑤ 英字の小見出しを入れれば捕まえる（2つ）', len(e2) == 2, e2)
rec('⑤ 決めるボタンの字が無い確かめる窓を捕まえる（1・2行目の2つ・字のある窓とお知らせは数えない）', n2 == ['probe.js:1', 'probe.js:2'], n2)
rec('⑤ 言い換えを入れれば捕まえる（1行目の2つ・「削除する」は数えない）', len(s2) == 2 and all(x.startswith('probe.js:1 ') for x in s2), s2)
rec('⑤ 自前の「捨てる」窓を入れれば捕まえる', d2 == ['probe.js:1'], d2)

ok = all(x for _, x in R)
print('%d/%d PASS' % (sum(1 for _, x in R if x), len(R)))
sys.exit(0 if ok else 1)
