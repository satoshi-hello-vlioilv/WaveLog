"""safe_regex.py: 利用者が書いた正規表現のうち、照合が止まらなくなる形を断る（§9.629）。

Python の`re`には時間の上限が無く、`(a+)+$`のような**入れ子の繰り返し**は、当たらない字が
1文字増えるたびに照合の時間がおよそ倍になる（25文字で 1〜2 秒、30文字で数十秒〜1分ほど）。その間、
その端末のアプリは応答しない。表示ルール・ダッシュボードの式・設備グループの決まりは共有のマスタに置くので、
1人が書いた式で全員の端末が固まる。

見分け方は「中に繰り返しを持つかっこを、さらに繰り返す」形（`(a+)+`・`(a*)*`・`(\\w+\\s?)+`・
`(.*a){12}`）。画面の`WL.formula.regexRisk()`（list/list-formula.js）と**同じ決まり**で、網（test_saferegex）が両方を
同じ見本で突き合わせる。依存を足さない（`program/requirements.txt`は flask だけ・§9.268）。
"""
import re

NESTED = '入れ子の繰り返し（例: (a+)+）は、照合が止まらなくなることがあるので使えません'


def _quant(p, i):
    """p[i] から始まる繰り返しの長さと、2回以上くり返せるか → (長さ, 繰り返すか)。繰り返しでなければ (0, False)。"""
    if i >= len(p):
        return 0, False
    ch = p[i]
    if ch in '+*':
        n = 1
    elif ch == '?':
        return (2, False) if i + 1 < len(p) and p[i + 1] in '+?' else (1, False)
    elif ch == '{':
        m = re.match(r'\{(\d*)(,?)(\d*)\}', p[i:])
        if not m:
            return 0, False
        lo, comma, hi = m.group(1), m.group(2), m.group(3)
        n = len(m.group(0))
        many = bool(comma and not hi) or int(hi or lo or 0) >= 2
        if i + n < len(p) and p[i + n] in '?+':
            n += 1
        return n, many
    else:
        return 0, False
    if i + n < len(p) and p[i + n] in '?+':
        n += 1
    return n, True


def risk(pattern):
    """照合が止まらなくなる形なら理由の字、安全なら ''。書けない正規表現かどうかは見ない（`re`が言う）。"""
    p = str(pattern or '')
    stack = [False]          # かっこごとに「中に繰り返しがあるか」
    i = 0
    while i < len(p):
        ch = p[i]
        if ch == '\\':
            i += 2
        elif ch == '[':
            j = i + 1
            if j < len(p) and p[j] == '^':
                j += 1
            if j < len(p) and p[j] == ']':
                j += 1
            while j < len(p) and p[j] != ']':
                j += 2 if p[j] == '\\' else 1
            i = j + 1
        elif ch == '(':
            stack.append(False)
            i += 1
            if i < len(p) and p[i] == '?':       # (?:…)・(?=…)・(?P<名>…) の頭は繰り返しではない
                m = re.match(r'\?(?:P?<[^>]*>|[:=!]|<[=!])', p[i:])
                i += len(m.group(0)) if m else 1
            continue
        elif ch == ')':
            inner = stack.pop() if len(stack) > 1 else False
            n, many = _quant(p, i + 1)
            if inner and many:
                return NESTED
            if inner or many:
                stack[-1] = True
            i += 1 + n
            continue
        else:
            i += 1
        n, many = _quant(p, i)
        if many:
            stack[-1] = True
        i += n
    return ''


def compile_safe(pattern, flags=0):
    """断る形でも書けない形でもなければ compile した物、そうでなければ None（呼ぶ側は「当たらない」として扱う）。"""
    if risk(pattern):
        return None
    try:
        return re.compile(pattern, flags)
    except re.error:
        return None
