#!/usr/bin/env python3
"""test_csslint.py: CSSの「優先順位の決め方」を固定する。
   ============================================================
   このアプリのCSSは長く「ファイルの末尾に書いた方が勝つ」が事実上の
   優先順位だった。詳細度が同点のまま同じプロパティを二重指定している箇所が
   実測で2403件あり、新機能を末尾へ足すたびに既存のどこかが静かに変わっていた
   (実例: 実績カレンダーの2択で選択中が薄く見えていた不具合)。

   VER1.83.0 で @layer へ移し、優先順位はレイヤ順だけで決めることにした。
   その約束が破られていないかをここで見る。ブラウザを起動しないので速い。
   ============================================================
"""
import re,sys,pathlib

ROOT=pathlib.Path(__file__).resolve().parent.parent
# CSSは static/css/ 配下へ分割してある(§9.72)。@layer の中では今も
# 「後に書いたほうが勝つ」が効くので、**読み込み順＝カスケードの順序**。
# ここでは読み込み順に連結したものを1枚のCSSとして検査する。
# 並びの唯一の定義は backend/routes/core.py の CSS_FILES(そこが連結して配信する)。
# ここでも同じものを読み、ディスクの中身と食い違っていないかを見る。
# 配信は2本立て(§9.86)。起動オーバーレイを最初の描画で出すための小さな
# BOOT_CSS_FILES(描画をブロックする)と、残りの BODY_CSS_FILES(ブロックしない)。
# カスケードの順序は「起動用 → 本体」なので、この順に連結して検査する。
_core=(ROOT/'backend/routes/core.py').read_text(encoding='utf-8')
def _css_list(name):
    m=re.search(name+r'=\[(.*?)\]',_core,re.S)
    return re.findall(r"'([\w.-]+\.css)'",m.group(1)) if m else []
BOOT_CSS_ORDER=_css_list('BOOT_CSS_FILES')
BODY_CSS_ORDER=_css_list('BODY_CSS_FILES')
CSS_ORDER=BOOT_CSS_ORDER+BODY_CSS_ORDER
CSS_DIR=ROOT/'static/css'
CSS='\n'.join((CSS_DIR/n).read_text(encoding='utf-8') for n in CSS_ORDER)
# コメントは対象外。ただし行番号は元のまま報告したいので、改行だけ残して潰す。
CODE=re.sub(r'/\*[\s\S]*?\*/',lambda m:re.sub(r'[^\n]',' ',m.group(0)),CSS)

R=[]
def rec(name,ok,detail=''):
    R.append((name,ok,detail))
    print(('PASS' if ok else 'FAIL')+': '+name+((' -- '+detail) if detail else ''))

# component から layout を更に切り出すことは、いまはしていない。
# 一度試したが `.right-pane.layout-mother .work-tabs{display:none}` のような
# 「部品を器で絞り込んだ」ルールまで器側と見なしてしまい、部品側の
# `.work-tabs{display:flex}` に負けて隠れていたタブが出た(45画面中20枚が相違)。
# 切り出すならセレクタの主語(右端)で判定し、1件ずつ画面で確かめること。
EXPECTED=['reset','tokens','base','component','state','mode','print','utility']

# ---- 1) レイヤ宣言があり、順序が意図どおり ----
m=re.search(r'@layer\s+([^;{]+);',CODE)
rec('レイヤの並びを1箇所で宣言している',bool(m))
if m:
    got=[x.strip() for x in m.group(1).split(',')]
    rec('レイヤの順序が設計どおり',got==EXPECTED,f'{got}')

# ---- 2) !important が無い ----
imp=[(i+1,l.strip()[:110]) for i,l in enumerate(CODE.split('\n')) if '!important' in l]
rec('!important が1つも無い',not imp,'; '.join(f'L{n} {t}' for n,t in imp[:6]))

# ---- 2b) コメントの中に `**/` を書いていない ----
# このリポジトリのCSSコメントは強調に `**…**` を使う。直後が `/` だと
# **そこでコメントが閉じ**、以降の本文が壊れたCSSとして読み飛ばされて
# **すぐ後ろのルールごと消える**。ブラウザもこのテストの除去regexも同じ
# 読み方をするので、**除去したあとでは検出できない**——生の文字列で見る。
# 2回起きている（タイムラインのグリッド定義／群の見出しの規格）ので機械で見る。
starstar=[(i+1,l.strip()[:110]) for i,l in enumerate(CSS.split('\n')) if '**/' in l]
rec('コメントの中に `**/` が無い（そこで閉じてルールが消える）',
    not starstar,'; '.join(f'L{n} {t}' for n,t in starstar[:4]))

# ---- 3) すべてのルールがレイヤの中にある ----
# レイヤの外に書かれたルールは**全レイヤに勝つ**ので、1本でもあると
# 「レイヤ順で決まる」という前提が崩れる。
def top_blocks(src):
    out=[];i=0;n=len(src);buf=''
    while i<n:
        if src[i]=='{':
            depth=1;j=i+1
            while j<n and depth:
                if src[j]=='{':depth+=1
                elif src[j]=='}':depth-=1
                j+=1
            out.append((buf.strip(),src[i:j]));buf='';i=j;continue
        if src[i]==';' and buf.strip().startswith('@'):
            out.append((buf.strip(),';'));buf='';i+=1;continue
        buf+=src[i];i+=1
    return out
stray=[pre[:90] for pre,_ in top_blocks(CODE)
       if pre and not pre.startswith('@layer') and not pre.startswith('@charset')]
rec('レイヤの外に書かれたルールが無い',not stray,'; '.join(stray[:5]))

# ---- 4) 期待した全レイヤが実在する ----
present=set(re.findall(r'@layer\s+([\w-]+)\s*\{',CODE))
missing=[l for l in EXPECTED if l not in present]
rec('宣言した全レイヤに中身がある',not missing,f'空: {missing}')

# ---- 5) インラインstyleで「見た目」を直接書いていない ----
# インラインはどのレイヤより強いので、CSS側から打ち消せなくなる
# (打ち消すために !important が生まれる元凶)。位置やサイズの計算結果は
# カスタムプロパティで渡し、使い方はCSSに残す。
BAN=re.compile(r"\.style\.(background|backgroundColor|color|fontSize|display|transform)\s*=")
ALLOW={'static/js/master-maint.js'}     # display切替のみ。hidden属性へ移すのは別途
bad=[]
for p in sorted((ROOT/'static/js').glob('*.js')):
    rel=f'static/js/{p.name}'
    if rel in ALLOW: continue
    for i,l in enumerate(p.read_text(encoding='utf-8').split('\n')):
        if BAN.search(l): bad.append(f'{rel}:{i+1}')
rec('JSが見た目のプロパティをインラインで直書きしていない',not bad,'; '.join(bad[:6]))

# ---- 6) 帳票の拡大率がカスタムプロパティ経由 ----
rp=(ROOT/'static/js/report-dashboard.js').read_text(encoding='utf-8')
rec('帳票の拡大率は--rp-scaleで渡している',
    '--rp-scale' in rp and 'style.transform=' not in rp)

# ---- 7) リテラルの文字サイズは印刷物と見本だけ(既存の約束の再確認) ----
# 紙(rp-=帳票 / df-=異常位置判定 / sp-=作業予定表§9.115)は表示サイズ倍率へ
# 追随させない——追随させると画面の拡大率で紙の行数が変わる。
stray_fs=[]
for i,l in enumerate(CSS.split('\n')):
    if not re.search(r'font-size:\s*[0-9.]+px',l): continue
    if re.search(r'\.(rp|df|sp)-',l) or 'ui-size-swatch' in l: continue
    stray_fs.append(f'L{i+1} {l.strip()[:70]}')
rec('文字サイズのリテラルpxは印刷物とサイズ見本だけ',not stray_fs,'; '.join(stray_fs[:5]))

# ---- 8) 箱のスケールもトークンから選ぶ(§9.71) ----
# 文字サイズはトークン化済みだったのに「揃って見えない」原因は箱の側だった。
# 実測で角丸28種・コントロールの高さ15種・横余白11種が使われており、
# 同じ役割のカードやボタンが画面ごとに1〜2px違う形で並んでいた。
missing_tok=[t for t in ['--radius-xs','--radius-sm','--radius-md','--radius-lg','--radius-pill',
                         '--radius-round','--ctl-pad-x-xs','--ctl-pad-x-sm','--ctl-pad-x']
             if f'{t}:' not in CODE]
rec('箱のスケール(角丸・コントロール余白)のトークンが揃っている',not missing_tok,f'不足: {missing_tok}')

stray_rad=[]
for i,l in enumerate(CSS.split('\n')):
    if not re.search(r'border-radius:\s*[^;}]*[0-9]',l): continue
    if re.search(r'border-radius:\s*0(\s|;|\}|$)',l.strip()): continue
    if 'var(--radius' in l: continue
    # A4帳票(.rp-page/.df-page配下)だけは用紙の割り付けのためpx固定が正しい。
    # `block`＝帳票の塊（§9.169）。**紙の中**の部品なので他と同じくpx固定でよい
    # （紙の外に置いた組み換えの帯`.rp-arrange-*`はトークンを使う）。
    # `ghost`＝落とし先の枠（§9.217）。**紙のグリッドの子**なので、他の
    # 塊と同じ寸法の言語（px）で書くのが正しい。
    if re.search(r'\.(rp|df)-(page|report|section|field|dim|grade|info|note|wide|product|label|defect|strip|table|head|answer|foot|print|block|blocks|ghost)',l): continue
    stray_rad.append(f'L{i+1} {l.strip()[:70]}')
rec('角丸のリテラルpxは帳票だけ',not stray_rad,'; '.join(stray_rad[:5]))

# 役割ごとの寸法をまとめたブロックが残っていること(消すと元の15種類へ戻る)
rec('役割ごとの寸法を1箇所で決めるブロックがある',
    '0. 役割ごとの寸法' in CSS and '文字の役割（見出し・要約・バッジ）' in CSS)

# ---- 9) 分割したCSSの読み込み順(§9.72) ----
# 順番が変わるとカスケードが変わる。テンプレートの<link>の並びが
# CSS_ORDER と一致していること、余計なCSSが混ざっていないことを見る。
rec('CSSの読み込み順が1箇所(core.pyのCSS_FILES)で定義されている',len(CSS_ORDER)>=10,
    f'{len(CSS_ORDER)}件')
html=(ROOT/'templates/index.html').read_text(encoding='utf-8')
# 分割したCSSは実行時にまとめて返す(<link>を分割数ぶん並べると、
# 1ページ表示ごとに往復が増えて起動直後の一覧取得と競合する。実測で
# テストが13件落ちた)。テンプレートが個別ファイルを直接読んでいないこと。
# **2本だけ**: 起動用(描画をブロック)と本体(ブロックしない)。§9.86
rec('CSSはまとめて2本で読み込む(起動用と本体)',
    "url_for('core.boot_css')" in html and "url_for('core.app_css')" in html
    and "filename='css/" not in html)
# 起動用は「最初の描画で起動オーバーレイを出す」ための最小限。ここへ画面の
# CSSを足すと、また白い画面が戻る(小さいほど白が短い)。
rec('起動用CSSは最小限(トークンと起動オーバーレイだけ)',
    BOOT_CSS_ORDER==['00-base.css','95-boot.css'],f'{BOOT_CSS_ORDER}')
# 本体CSSは描画をブロックしない形で読み、読み終わってからJSを動かす。
rec('本体CSSは描画をブロックしない形で読み込む',
    'id="appCss"' in html and 'media="print"' in html)
on_disk=sorted(p.name for p in CSS_DIR.glob('*.css'))
rec('static/css の中身と読み込み一覧が一致している',on_disk==sorted(CSS_ORDER),
    f'disk={on_disk}')
rec('分割前の app.css は残っていない',not (ROOT/'static/app.css').exists())
# 各ファイルは「レイヤの中」だけを持つ。00-base 以外がレイヤを宣言し直すと
# 並びが二重定義になるので禁止。
redecl=[n for n in CSS_ORDER[1:]
        if re.search(r'@layer\s+[\w-]+\s*,',(CSS_DIR/n).read_text(encoding='utf-8'))]
rec('レイヤの並びを宣言しているのは00-base.cssだけ',not redecl,f'{redecl}')

ng=[x for x in R if not x[1]]
print('\n=== SUMMARY ===')
print(f'{len(R)-len(ng)}/{len(R)} passed')
for n,_,d in ng: print(' -',n,d)
sys.exit(1 if ng else 0)
