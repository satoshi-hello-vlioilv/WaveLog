# -*- coding: utf-8 -*-
"""test_pywarn.py: 起動・停止で警告を出さない（§9.275、利用者の報告）。

利用者の報告:

  「stop.batファイル起動すると下記内容が出ます。SyntaxWarningが出ていますが
   正常でしょうか？
   backend\\paths.py:182: SyntaxWarning: "\\W" is an invalid escape sequence.」

**正常ではない。** 文字列リテラルの中の`\\W`はPythonの知らないエスケープで、
いまは「そのまま`\\W`」として通るが、**将来 SyntaxError にすると予告**されて
いる（Python 3.12 から警告が出る）。実害が出るのはまだ先でも、
**現場には「起動したら赤い文字が出た」としか見えない**（§4）。

固定するのは3つ。
 ① どの`.py`にも**知らないエスケープが1つも無い**こと
 ② この環境のPythonが出す警告（SyntaxWarning）も0であること
 ③ **網そのものが素通りしないこと**（欠陥を注いで確かめる）

**`compile()`だけに頼らないこと。** この判定はPythonの版で変わる——
検証はいま3.11で走っており、`\\W`は**3.11では警告にならない**（実際、
利用者の端末＝3.12で初めて出た）。`compile()`を並べただけの網は、
**欠陥がそのまま入っていても通る**（§9.108・`is_network_path`と同じ理由で、
「この環境では通らない道」を網が一度も通らない）。だから**判定を自前で持つ**。

**現場の運用では`.pyc`が新しいうちは出ない**（コンパイルのときだけ警告する）
ので、更新のあと1回だけ出て消える——「たまに出る」の正体もこれ。
"""
import io
import os
import pathlib
import sys
import tokenize
import warnings

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

ROOT = pathlib.Path(__file__).resolve().parent.parent
SKIP_DIRS = {'.git', '__pycache__', 'node_modules', 'db', '.venv', 'venv'}

R = []


def rec(name, ok, detail=''):
    R.append((name, ok, detail))
    print(('PASS' if ok else 'FAIL') + ': ' + name + (' -- ' + str(detail) if detail else ''))


# Pythonが認めるエスケープ（言語リファレンス「文字列およびバイト列リテラル」）。
# `\<改行>` は行継続。8進は `\0`〜`\7` で始まる。
_VALID_STR = set('\n\\\'"abfnrtv01234567xNuU')
# バイト列は `\N` `\u` `\U` を持たない。
_VALID_BYTES = _VALID_STR - set('NuU')


def bad_escapes(body, prefix):
    """リテラルの中身から**知らないエスケープ**を拾う。→ [(位置, 文字), ...]

    **生文字列（`r`付き）は対象外**——あちらはバックスラッシュをそのまま持つ
    のが仕様なので、警告そのものが出ない。
    """
    valid = _VALID_BYTES if 'b' in prefix.lower() else _VALID_STR
    out, i, n = [], 0, len(body)
    while i < n - 1:
        if body[i] == '\\':
            if body[i + 1] not in valid:
                out.append((i, body[i + 1]))
            i += 2                      # 次の1文字は「エスケープされた側」
        else:
            i += 1
    return out


def scan(path):
    """1ファイルぶん。→ [(行, 文字), ...]"""
    out = []
    try:
        with open(path, 'rb') as f:
            toks = list(tokenize.tokenize(f.readline))
    except (SyntaxError, tokenize.TokenError, UnicodeDecodeError) as e:
        return [(0, f'読めません: {e}')]
    # 3.12 以降は f文字列が FSTRING_MIDDLE へ分かれる。**両方の道を持つ**
    # ——片方だけだと、検証を回すPythonの版によって見る範囲が変わる。
    mid = getattr(tokenize, 'FSTRING_MIDDLE', None)
    for t in toks:
        if mid is not None and t.type == mid:
            for _pos, ch in bad_escapes(t.string, ''):
                out.append((t.start[0], ch))
            continue
        if t.type != tokenize.STRING:
            continue
        s = t.string
        j = 0
        while j < len(s) and s[j].isalpha():
            j += 1
        prefix, rest = s[:j], s[j:]
        if 'r' in prefix.lower():
            continue
        for q in ('"""', "'''", '"', "'"):
            if rest.startswith(q):
                body = rest[len(q):-len(q)] if rest.endswith(q) else rest[len(q):]
                for _pos, ch in bad_escapes(body, prefix):
                    out.append((t.start[0], ch))
                break
    return out


files = [p for p in sorted(ROOT.rglob('*.py'))
         if not any(part in SKIP_DIRS for part in p.relative_to(ROOT).parts)]
rec('前提: 走査するPythonファイルがある', len(files) > 40, f'{len(files)}本')

hits = []
for p in files:
    for line, ch in scan(p):
        hits.append(f'{p.relative_to(ROOT)}:{line} \\{ch}')
rec('① 知らないエスケープが1つも無い（将来SyntaxErrorになる）',
    not hits, ' / '.join(hits[:6]))

# ---- ② この環境のPythonが出す警告も0 ---------------------------------------
# **①の代わりにはならない**（版によって出ない）が、①が知らない種類の警告
# （将来足されるもの）はこちらが拾う。
warned = []
for p in files:
    src = io.open(p, encoding='utf-8').read()
    with warnings.catch_warnings(record=True) as w:
        warnings.simplefilter('always')
        try:
            compile(src, str(p), 'exec')
        except SyntaxError as e:
            warned.append(f'{p.relative_to(ROOT)}: SyntaxError {e}')
            continue
        for x in w:
            if issubclass(x.category, SyntaxWarning):
                warned.append(f'{p.relative_to(ROOT)}:{x.lineno} {x.message}')
rec('② このPythonでコンパイルしても警告が出ない',
    not warned, ' / '.join(warned[:4]) + f'（Python {sys.version_info.major}.{sys.version_info.minor}）')

# ---- ③ 網が素通りしないこと -------------------------------------------------
# **`compile()`だけでは捕まらないことを、この場で見せる**——同じ欠陥を
# 3.11 に食わせても警告は出ない。だから①の判定を自前で持っている。
probe = 'x = "%LOCALAPPDATA%\\WaveLog"\n'
with warnings.catch_warnings(record=True) as w:
    warnings.simplefilter('always')
    compile(probe, '<probe>', 'exec')
    compile_saw = any(issubclass(x.category, SyntaxWarning) for x in w)
found = bad_escapes('%LOCALAPPDATA%\\WaveLog', '')
rec('③ 自前の判定は欠陥を捕まえる', [c for _p, c in found] == ['W'], found)
ok_escapes = 'a\\nb\\\\c\\x41\\N{BULLET}\\007\\t\\v'
rec('③ 正しいエスケープは捕まえない（誤検出しない）',
    not bad_escapes(ok_escapes, ''), bad_escapes(ok_escapes, ''))
rec('③ バイト列では \\N \\u \\U も知らないエスケープ',
    [c for _p, c in bad_escapes('\\N{X}', 'b')] == ['N']
    and not bad_escapes('\\N{X}', ''))
# **`compile()`だけでは足りないことを、その場で見せる**——同じ欠陥を
# このPythonへ食わせて警告が出るかどうかは版で変わるが、①の判定は
# **どの版でも捕まえる**。「必ず通るassertion」を置かない（§CLAUDE）ので、
# 見せるのは事実の突き合わせだけにする。
rec('③ ①の判定は compile() が見逃す版でも捕まえる',
    [c for _p, c in found] == ['W'],
    f'compile()が警告した={compile_saw} / Python '
    f'{sys.version_info.major}.{sys.version_info.minor}')

ng = [x for x in R if not x[1]]
print('\n=== SUMMARY ===')
print('%d/%d passed' % (len(R) - len(ng), len(R)))
for n, _o, d in ng:
    print(' -', n, d)
sys.exit(1 if ng else 0)
