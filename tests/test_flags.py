"""test_flags.py: 画面から来る「入/切」の読み方は1箇所（§9.324 R4）

以前は帳票ブロック・選択肢・ロール・手打ちの登録の4箇所が、それぞれ
別の語彙で `v.strip() not in ('無効', …)` を書いていた。**同じ罠を4回踏んだ**
のは、書く場所が4つあったから。ここで固定するのは3つ:
  1. 呼び名の切（無効・出さない・登録しない…）が全部Falseに読めること
  2. `None`は`None`のまま（「送っていない」を「切」に倒さない・§9.212 ②）
  3. **ルートのソースに `strip() not in ('無効'` の写しが1つも残っていない**こと
     （目で数えない。5つ目が書かれた瞬間に落ちる）
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.flags import flag_of, text_or, OFF_WORDS  # noqa: E402

R = []


def rec(name, ok, detail=''):
    R.append((name, ok))
    print(('PASS: ' if ok else 'FAIL: ') + name + (f' -- {detail}' if detail else ''))


# ---- 1. 切の語彙 ----
for w in ('無効', '出さない', '登録しない', 'しない', 'false', '0', '', '  無効  '):
    rec(f'「{w.strip() or "(空)"}」は切', flag_of(w) is False, repr(flag_of(w)))
for w in ('有効', '出す', 'その場で登録できる', 'true', '1', 'x'):
    rec(f'「{w}」は入', flag_of(w) is True, repr(flag_of(w)))

# ---- 2. None と真偽・数 ----
rec('Noneは「送っていない」のまま', flag_of(None) is None)
rec('True/Falseはそのまま', flag_of(True) is True and flag_of(False) is False)
rec('数は0だけ切', flag_of(0) is False and flag_of(-1) is True and flag_of(2) is True)

# ---- 3. 空欄を「入」と読む呼び出し（Excel取り込み） ----
no_blank = tuple(w for w in OFF_WORDS if w != '')
rec('off=で空文字を外すと空欄は入', flag_of('', off=no_blank) is True)
rec('外しても「無効」は切のまま', flag_of('無効', off=no_blank) is False)

# ---- 4. 呼び名優先 ----
rec('Textが来ていればそれ', text_or({'enabledText': '無効', 'enabled': True}, 'enabled') == '無効')
rec('Textが無ければ素の鍵', text_or({'enabled': False}, 'enabled') is False)
rec('どちらも無ければNone', text_or({}, 'enabled') is None)

# ---- 5. 写しが残っていない（機械で数える・§9.96） ----
pat = re.compile(r"strip\(\)\s*not\s+in\s*\(\s*'(無効|出さない|登録しない)")
left = []
for p in list((ROOT / 'backend').rglob('*.py')):
    if p.name == 'flags.py':
        continue
    for i, line in enumerate(p.read_text(encoding='utf-8').splitlines(), 1):
        if pat.search(line):
            left.append(f'{p.relative_to(ROOT)}:{i}')
rec('切の語彙の写しが backend に残っていない', not left, '; '.join(left[:5]))

ng = [n for n, ok in R if not ok]
print(f'\n== {len(R) - len(ng)}/{len(R)} PASS ==')
sys.exit(1 if ng else 0)
