#!/usr/bin/env python3
"""test_changelog.py: 更新履歴の書き方と、印の解き方が1箇所であることを固定する。
   ============================================================
   §9.286 ⑦（利用者の報告「更新履歴の<b>みたいなタグが出ているので修正を
   お願いします」）。

   説明文は `esc()` を通してから画面へ入る（§9.222 ⑧。順番が逆だと、
   マスタや更新履歴へ書いた文字列の中のHTMLがそのまま効く）。だから
   **生のHTMLタグを書くと字のまま画面に出る**——実測で `<b>` が186個、
   `<code>` が29個、そのまま並んでいた。

   直すのは書くほうの綴りで、印は `**強調**` とバッククォート囲みの2つだけ。
   解くのは `WL.markup()` の**1箇所**（§9.163。`hintHtml()` も同じここを
   通る）。ブラウザを起動しないので速い。
   ============================================================
"""
import ast,pathlib,re,sys

ROOT=pathlib.Path(__file__).resolve().parent.parent
SRC=(ROOT/'backend/changelog_data.py').read_text(encoding='utf-8')
TREE=ast.parse(SRC)

def _const(name):
    for n in TREE.body:
        if isinstance(n,ast.Assign) and getattr(n.targets[0],'id','')==name:
            return ast.literal_eval(n.value)
    return None

APP_VERSION=_const('APP_VERSION')
CHANGELOG=_const('CHANGELOG') or []

R=[]
def rec(name,ok,detail=''):
    R.append((name,ok,detail))
    print(('PASS' if ok else 'FAIL')+': '+name+((' -- '+detail) if detail else ''))

NOTES=[(e.get('version',''),n) for e in CHANGELOG for n in (e.get('notes') or [])]
rec('更新履歴を読める',bool(CHANGELOG) and bool(NOTES),
    f'{len(CHANGELOG)}版 / {len(NOTES)}件')

# ---- 1) 生のHTMLタグが無い ----
# `esc()`が字のまま出すのが正しい（値の中のHTMLを効かせない）ので、
# タグを書いた側が間違い。**目で数えないこと**——186個あった。
TAG=re.compile(r'</?[a-zA-Z][a-zA-Z0-9]*(\s[^<>]*)?/?>')
# バッククォート囲みの中は**字として引用しているもの**なので数えない
# （`WL.markup()`は先にエスケープするので、`<b>`と書けば`<code>&lt;b&gt;</code>`
#  になる＝安全で、しかも意図どおり）。剥がしてから見る。
_CODE=re.compile(r'`[^`]*`')
bad=[(v,n[:60]) for v,n in NOTES if TAG.search(_CODE.sub('',n))]
rec('更新履歴の本文に生のHTMLタグが無い',not bad,
    '; '.join(f'VER{v} {t}' for v,t in bad[:4]))

# ---- 2) 印が閉じている ----
# `**`が奇数個だと、強調がそこから先を全部飲み込む（あるいは1つも効かない）。
# バッククォートも同じ。**片方だけを見ないこと。**
odd=[(v,n[:60]) for v,n in NOTES if n.count('**')%2 or n.count('`')%2]
rec('強調・コードの印が閉じている',not odd,
    '; '.join(f'VER{v} {t}' for v,t in odd[:4]))

# ---- 3) いま動いている版が先頭にある ----
# 画面のバッジは`APP_VERSION`を出し、窓は先頭の版に「いま動いている版」の
# 印を付ける。食い違うと、印が付かないか別の版に付く。
rec('APP_VERSION が更新履歴の先頭と一致する',
    bool(CHANGELOG) and CHANGELOG[0].get('version')==APP_VERSION,
    f'APP_VERSION={APP_VERSION} / 先頭={CHANGELOG[0].get("version") if CHANGELOG else None}')

# 版が重複していない（同じ版が2つあるとレールの跳び先が決まらない）。
vers=[e.get('version') for e in CHANGELOG]
dup=sorted({v for v in vers if vers.count(v)>1})
rec('同じ版が2つ無い',not dup,f'{dup[:4]}')

# ---- 4) 印を解くのは1箇所 ----
BASE=(ROOT/'static/js/core/base.js').read_text(encoding='utf-8')
MM=(ROOT/'static/js/master/master-maint.js').read_text(encoding='utf-8')
LV=(ROOT/'static/js/list/list-view.js').read_text(encoding='utf-8')
rec('WL.markup() が base.js にある','WL.markup=' in BASE)
rec('WL.markup() は先にエスケープしてから印を戻す',
    bool(re.search(r'WL\.markup=t=>esc\(t\)',BASE)))
rec('強調とコードの2つを解く',
    '<b>$1</b>' in BASE and '<code>$1</code>' in BASE)
# hintHtml が自前で解き直していないこと（2つあると片方だけ直した状態が作れる）。
hint=re.search(r'function hintHtml\(t\)\{(.*?)\n }',MM,re.S)
rec('hintHtml() は WL.markup() へ委譲している',
    bool(hint) and 'WL.markup(' in hint.group(1) and '<b>$1</b>' not in hint.group(1),
    (hint.group(1).strip()[:80] if hint else 'hintHtml が見つからない'))
rec('更新履歴も WL.markup() を通す','WL.markup(n)' in LV)

# ---- 5) 開発の記録の分け方（§9.336、REVIEW 3-12） ----
# 現場の人が開く画面に、テストの名前・§番号・中のファイル名が並ぶのをやめた。
# **判定はここ1箇所**（画面へ写さない・§9.163）で、**宣言が無ければ利用者向け**
# （伏せる側へ倒すと、宣言を忘れた版が黙って現場から消える）。
sys.path.insert(0,str(ROOT))
from backend.changelog_data import is_dev  # noqa: E402  判定は本体の1箇所を呼ぶ
# （`changelog_data` は何もimportしない素のデータなので、読み込みの副作用が無い）
dev=[e for e in CHANGELOG if is_dev(e)]
rec('開発の記録の版を分けられている',5<=len(dev)<len(CHANGELOG),
    f'{len(dev)} / 全{len(CHANGELOG)}版')
rec('宣言の無い版は利用者向けへ倒れる',not is_dev({'version':'x','notes':['a']}))
rec('宣言した版だけが開発の記録になる',
    all(e.get('dev') is True for e in dev))
# **不具合を直した版に付けていないこと。** 内部の話に見えても「直った」ことは
# 利用者に見える変更（VER2.206.0 は「作業スケジュールが開けない」、
# VER2.214.0 は「タブの中身が入れ替わる」を直した版）。
for v in ('2.206.0','2.214.0'):
    e=next((x for x in CHANGELOG if x.get('version')==v),None)
    rec(f'VER{v}（不具合修正）を開発の記録にしていない', e is not None and not is_dev(e))
# 構造の改善の版には付いていること（付け忘れると現場の履歴が汚れる）
for v in ('2.218.0','2.217.0','2.216.0'):
    e=next((x for x in CHANGELOG if x.get('version')==v),None)
    rec(f'VER{v}（構造の改善）を開発の記録にしている', e is not None and is_dev(e))
# APIが判定を返していること（画面が自分で判定し直さないための材料）
CORE=(ROOT/'backend/routes/core.py').read_text(encoding='utf-8')
rec('/api/changelog が dev と件数を返す',
    'dev=is_dev(e)' in CORE and 'devCount=' in CORE)
rec('画面のJSに判定を書き写していない',
    'is_dev' not in LV and 'e.dev' in LV)

ng=[x for x in R if not x[1]]
print(f'\n{len(R)-len(ng)} PASS / {len(ng)} FAIL')
sys.exit(1 if ng else 0)
