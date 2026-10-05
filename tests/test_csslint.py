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

# ---- 1b) 使っているレイヤ名は、宣言した8つの中にある（§9.427） ----
# **宣言に無い名前を書くと、そこは「全部の後ろ」の別レイヤになる**——
# `!important`より静かで、`!important`より強い。実際に`72-bladeset.css`が
# `@layer components`（複数形）と書いており、刃組画面では`state`レイヤの
# 「選ばれた札の見た目」（§9.353）が**1つも効いていなかった**
# （表示の入切4つが全部「入」なのに点が白いまま。利用者の報告
# 「ONOFFの状態がバッジから読み取れません」）。
# 上の 3) は「レイヤの外に書いていないか」を見るが、**名前が正しいか**は
# 見ていない——綴り違いは「レイヤの中」なので素通りする。
bad_layer=[]
for name in CSS_ORDER:
    for mm in re.finditer(r'@layer\s+([A-Za-z][\w-]*)\s*\{',
                          re.sub(r'/\*[\s\S]*?\*/','',(CSS_DIR/name).read_text(encoding='utf-8'))):
        if mm.group(1) not in EXPECTED:
            bad_layer.append(f'{name}: @layer {mm.group(1)}')
rec('使っているレイヤ名が宣言した並びの中にある（綴り違いは全部の後ろへ回る）',
    not bad_layer,'; '.join(bad_layer[:4]))

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

# ---- 2c) コメントが早く閉じて散文がCSSとして読まれていない（§9.237） ----
# 上の `**/` は**綴りが1つだけ**の網で、`.rp-*/.df-*` のような
# 「`*` の直後の `/`」は素通りする。実際にそれで `--radius-xs:4px;` が
# パーサに捨てられ、**12ファイル128箇所の角丸が全部0**になっていた
# （`var()`が未定義だと宣言ごと無効になる。ブラウザで実測して確認）。
# **綴りを増やして追いかけない**——コメントを潰したあとに残るのは
# CSSの構文だけのはずなので、**そこに日本語（散文）が残っていたら
# どこかでコメントが早く閉じている**。文字列リテラル(`content:"変更"`)は
# 正当なので先に抜く。この網は綴りに依らず、この種の事故を全部拾う。
# **見るのは日本語の「約物」**——`。`『、』「」——（）。クラス名には
# 日本語を使うことがある（§9.227の`.op-look-既定`など）ので、文字そのもので
# 見ると誤検知する。約物は識別子には現れないので、残っていれば散文が漏れている。
_nostr=re.sub(r'"[^"\n]*"|\'[^\'\n]*\'','""',CODE)
_lines=CSS.split('\n')
cjk=[f'L{i+1} {_lines[i].strip()[:70]}' for i,l in enumerate(_nostr.split('\n'))
     if re.search(r'[。、「」（）]|——',l)]
rec('コメントを外したCSSに散文が残っていない（早く閉じたコメントが無い）',
    not cjk,'; '.join(cjk[:4]))

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
ALLOW={'static/js/master/master-maint.js'}     # display切替のみ。hidden属性へ移すのは別途
bad=[]
# 領域フォルダ（§9.334）なので **rglob**。`glob`のままだと3-9以降**0本**しか
# 見ずに素通りする（数え落としは緩む側に壊れる・§9.335）。
for p in sorted((ROOT/'static/js').rglob('*.js')):
    rel=p.relative_to(ROOT).as_posix()
    if rel in ALLOW: continue
    for i,l in enumerate(p.read_text(encoding='utf-8').split('\n')):
        if BAN.search(l): bad.append(f'{rel}:{i+1}')
rec('JSが見た目のプロパティをインラインで直書きしていない',not bad,'; '.join(bad[:6]))

# ---- 6) 帳票の拡大率がカスタムプロパティ経由 ----
rp=(ROOT/'static/js/report/report-dashboard.js').read_text(encoding='utf-8')
rec('帳票の拡大率は--rp-scaleで渡している',
    '--rp-scale' in rp and 'style.transform=' not in rp)

# ---- 7) リテラルの文字サイズは印刷物と見本だけ(既存の約束の再確認) ----
# 紙(rp-=帳票 / df-=異常位置判定 / sp-=作業予定表§9.115 / os-=操業データ表§9.241 ②)は
# 表示サイズ倍率へ追随させない——追随させると画面の拡大率で紙の行数が変わる。
stray_fs=[]
for i,l in enumerate(CSS.split('\n')):
    if not re.search(r'font-size:\s*[0-9.]+px',l): continue
    if re.search(r'\.(rp|df|sp|os)-',l) or 'ui-size-swatch' in l: continue
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

# ---- 10) 同じセレクタの同じプロパティを2ファイルが宣言していない(§9.324 R6) ----
# 同じ`@layer`の中で同じセレクタ（結合子なし＝同じ詳細度）が同じプロパティを
# 別のファイルで宣言すると、**後に読まれる側だけが効き、先の側は死んだ写し**
# になる。直したつもりの1行が効かない（§9.129の`.work-time-item`）、別の画面の
# 枠が漏れる（`.cl-search`＝更新履歴の検索欄にリンクマスタの枠と高さが付いて
# いた）、の2つを実際に踏んだ。**目で数えない**——15件あった。
# `@media`/`@container`の中は「幅で上書きする」ための意図した重ねなので除く。
def _conflicts():
    decls={}   # (selector,layer) -> file -> {prop: value}
    for name in CSS_ORDER:
        src=re.sub(r'/\*[\s\S]*?\*/','',(CSS_DIR/name).read_text(encoding='utf-8'))
        ctx=[];buf=''
        for ch in src:
            if ch=='{':
                sel=buf.strip();buf=''
                ctx.append(sel if sel.startswith('@') else ('S',sel))
            elif ch=='}':
                if ctx:
                    top=ctx.pop()
                    if isinstance(top,tuple):
                        body=buf;buf=''
                        if any(isinstance(c,str) and (c.startswith('@media') or c.startswith('@container')) for c in ctx):
                            continue
                        layer=[c for c in ctx if isinstance(c,str) and c.startswith('@layer')]
                        layer=layer[-1] if layer else ''
                        for part in top[1].split(','):
                            part=part.strip()
                            if not re.fullmatch(r'([.#][\w-]+)+',part):continue
                            slot=decls.setdefault((part,layer),{}).setdefault(name,{})
                            for d in body.split(';'):
                                if ':' not in d:continue
                                prop,val=d.split(':',1);slot[prop.strip()]=val.strip()
                buf=''
            else:
                buf+=ch
    out=[]
    for (sel,layer),byf in decls.items():
        if len(byf)<2:continue
        props={}
        for f,pv in byf.items():
            for prop in pv:props.setdefault(prop,[]).append(f)
        dup={prop:fs for prop,fs in props.items() if len(fs)>=2}
        if dup:out.append(f'{sel} '+', '.join(f'{prop}({"/".join(fs)})' for prop,fs in dup.items()))
    return sorted(out)
_dup=_conflicts()
rec('同じセレクタの同じプロパティを2ファイルが宣言していない（後勝ちで片方が死ぬ）',
    not _dup,'; '.join(_dup[:6]))
# 見張りが実際に数えられること——同じ形を注ぎ込んで1件になるか（網の網・§9.200）
_saved=(CSS_DIR/'95-boot.css').read_text(encoding='utf-8')
try:
    (CSS_DIR/'95-boot.css').write_text(_saved+'\n@layer component{.mm-btn-primary{font-weight:800}}\n',encoding='utf-8')
    _probe=_conflicts()
finally:
    (CSS_DIR/'95-boot.css').write_text(_saved,encoding='utf-8')
rec('見張りは同じ形を注ぎ込むと数える',any(x.startswith('.mm-btn-primary ') for x in _probe),'; '.join(_probe[:3]))

# ---- 11) 色のリテラルはトークン定義行だけ(§9.350、REVIEW 3-18) ----
# 規則（CLAUDE.md「色と文字サイズは:rootのトークンから選ぶ」）はあったが網が無く、
# 非トークン行の色リテラルが実測 1,517（398種）あった。398種は「同じ意味に違う色」が
# 混ざっていることの現れ（4-1 ①で色が逆に付いていた）。ここでは**増えないこと**を
# ファイルごとの上限（tests/fixtures/color_baseline.json）で固め、下げる方向だけ動かす
# （python3 tests/test_csslint.py --update）。白（#fff）は数えない。
_COLOR=re.compile(r'#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\)|\bhsla?\([^)]*\)')
def _color_literals(code):
    """トークン定義（`--x:`）でない宣言の中の色リテラルを数える。コメントは呼ぶ側で潰す。"""
    n=0
    for m in _COLOR.finditer(code):
        if m.group(0).lower() in ('#fff','#ffffff'): continue
        j=max(code.rfind(';',0,m.start()),code.rfind('{',0,m.start()),code.rfind('}',0,m.start()))
        seg=code[j+1:m.start()]; k=seg.find(':')
        if k>=0 and seg[:k].strip().startswith('--'): continue
        n+=1
    return n
_CB=ROOT/'tests/fixtures/color_baseline.json'
_now={n:_color_literals(re.sub(r'/\*[\s\S]*?\*/','',(CSS_DIR/n).read_text(encoding='utf-8'))) for n in CSS_ORDER}
_now={k:v for k,v in _now.items() if v}
import json as _json
_base=_json.loads(_CB.read_text(encoding='utf-8')) if _CB.exists() else {}
_over=[f'{k} {_base.get(k,0)}→{v}' for k,v in _now.items() if v>_base.get(k,0)]
_under=[f'{k} {_base.get(k,0)}→{v}' for k,v in _now.items() if v<_base.get(k,0)]+[f'{k} {b}→0' for k,b in _base.items() if k not in _now and b]
if '--update' in sys.argv:
    if _over and _base: print('!! 上限を上げる更新はしません: '+'; '.join(_over[:8]))
    else:
        _CB.write_text(_json.dumps(_now,ensure_ascii=False,indent=1,sort_keys=True)+'\n',encoding='utf-8')
        print(f'baseline を書き直しました: {_CB} ({len(_now)} files)')
rec('色のリテラルがファイルごとの上限を超えていない（トークン定義行と白は数えない。増えたら落ちる）',
    not _over,'; '.join(_over[:8]) or f'いま {sum(_now.values())}箇所 / {len(_now)}ファイル')
if _under: print('   注: 上限を下げられます（python3 tests/test_csslint.py --update）: '+'; '.join(_under[:6]))
_selfref=[f'L{i+1} {l.strip()[:60]}' for i,l in enumerate(CODE.split('\n')) if re.search(r'--([a-z0-9-]+)\s*:\s*var\(--\1\)',l)]
rec('トークンが自分自身を参照していない（--x:var(--x) は循環でトークンが無効になる。置換の道具が実際に作った）',not _selfref,'; '.join(_selfref[:4]))
rec('色の見張りは同じ形を注ぎ込むと数える（トークン行・白・コメントは数えない）',
    _color_literals('.a{color:#60747b;--x:#173842;background:#fff;border:1px solid rgba(0,0,0,.2)}')==2)

# ---- 12) 選ばれた札の見た目は1箇所（§9.353、REVIEW 3-19） ----
# 「選んだ札のほうが濃い」（§9.229 ③）を、以前は**同じ3行を23族が各自書いて**いた
# （実測: 選択中の規則168・族110・宣言セット109）。1つ直すと残りとずれる。
# 束ねた型（`90-state.css` の `@layer state`）と**同じ宣言セット**を族が自前で書いたら
# 落とす——足すときは束ね規則へセレクタを1つ足す。
_ON = re.compile(r'(\.(?:active|is-active|is-on|is-selected|current|selected)\b|\[aria-selected="?true"?\])')
# 束ねた型。増やすときは 90-state.css と**両方**へ書く（片方だけだと網が緩む）。
_BUNDLED = {
    ('background:var(--teal)', 'border-color:var(--teal)', 'color:#fff'),
    ('background:var(--teal)', 'color:#fff'),
    ('background:var(--teal)', 'border-color:var(--teal)'),
    ('background:var(--nav)', 'border-color:var(--nav)', 'color:#fff'),
    ('background:var(--nav)', 'color:#fff'),
    ('background:var(--pale)', 'border-color:var(--teal)', 'color:var(--teal-dark)'),
    ('background:var(--pale)', 'border-color:var(--teal)'),
    ('color:#fff',),
    ('color:var(--teal-dark)',),
}


def _on_rules(text):
    """(セレクタ, 宣言セット) の並び。コメントは呼ぶ側で潰す。"""
    out = []
    for m in re.finditer(r'([^{}]+)\{([^{}]*)\}', text):
        sel, body = m.group(1).strip(), m.group(2)
        if not _ON.search(sel) or '@' in sel:
            continue
        ds = tuple(sorted(' '.join(d.split()) for d in body.split(';') if d.strip()))
        out.append((' '.join(sel.split()), ds))
    return out


# 束ねない族（§9.353 追補）。**値が同じでも、束ねると規則の位置が変わる**——元は
# component 層の自分の場所に居て「後ろの規則に上書きされる」前提だったものが、state 層へ
# 移ると上書きされなくなる。カスタム色（`--opf-hue` 等）で塗り分ける族がそれで、実際に
# `test_opblanktint` が「カードの地が別の色になった」で落ちた。**理由が書けるものだけ**。
_SKIP_PREFIX = ('.opf-', '.op-btint', '.op-look-', '.fc-alert-color', '.sc-row-cat', '.sc-row-line',
                '.col-head-menu')
_state_css = re.sub(r'/\*[\s\S]*?\*/', '', (CSS_DIR / '90-state.css').read_text(encoding='utf-8'))
_bundle_sels = {sel for sel, ds in _on_rules(_state_css) if ds in _BUNDLED}
_dup = []
for _n in CSS_ORDER:
    _txt = re.sub(r'/\*[\s\S]*?\*/', '', (CSS_DIR / _n).read_text(encoding='utf-8'))
    for _sel, _ds in _on_rules(_txt):
        if _ds in _BUNDLED and _sel not in _bundle_sels \
                and not any(p.strip().startswith(_SKIP_PREFIX) for p in _sel.split(',')):
            _dup.append(f'{_n} {_sel[:50]}')
rec('選ばれた札の見た目を族が自前で書いていない（束ねた規則へセレクタを足す・§9.353）',
    not _dup, '; '.join(_dup[:5]) or f'束ねた型 {len(_BUNDLED)}・束ね規則 {len(_bundle_sels)}本')
rec('束ねた規則が `@layer state` の1ファイルに揃っている',
    len(_bundle_sels) >= 8, f'{len(_bundle_sels)}本')
_probe = [s for s, d in _on_rules('.zz-x.is-on{background:var(--teal);border-color:var(--teal);color:#fff}')
          if d in _BUNDLED]
rec('見張りは同じ形を注ぎ込むと数える（束ねた型と同じ3行）', _probe == ['.zz-x.is-on'], str(_probe))


# ---- 字の太さは3段のトークンから（§9.562） ----
# Windows の日本語の字体（Yu Gothic UI）が描き分けられるのは 400/600/700 だけ。500 は 400 と同じに、800・900 は
# 英数字（Segoe UI）だけ Black になる。太さは --fw-body／--fw-ui／--fw-strong の3つから選ぶ。
def _weight_literals(code):
    code = re.sub(r'/\*[\s\S]*?\*/', '', code)
    return [m.group(0) for m in re.finditer(r'(?<![-\w])font-weight\s*:\s*([^;}]+)', code)
            if not re.match(r'\s*(var\(--fw-(body|ui|strong)\)|inherit|normal)\s*$', m.group(1))]
_wl = [f'{_n}: {x}' for _n in CSS_ORDER for x in _weight_literals((CSS_DIR / _n).read_text(encoding='utf-8'))]
rec('字の太さは3段のトークン（--fw-body／--fw-ui／--fw-strong）から選ぶ（§9.562）', not _wl, '; '.join(_wl[:6]))
rec('太さの見張りは同じ形を注ぎ込むと数える', _weight_literals('.x{font-weight:800}.y{font-weight:var(--fw-ui)}') == ['font-weight:800'])
_base = (CSS_DIR / '00-base.css').read_text(encoding='utf-8')
rec('太さのトークンは 400／600／700 の3つ・<b> は 700 に止める（既定の bolder は 900 になる）',
    all(t in _base for t in ('--fw-body:400', '--fw-ui:600', '--fw-strong:700', 'b,strong{font-weight:var(--fw-strong)}')))


# ---- 字の灰色は3段のトークンから（§9.564） ----
# --ink（本文）／--ink-2（副）／--muted（補足）。直書きの灰色は約45種あり、--ink-2 と --ink-3 は明るさが 5 しか違わず、
# --ink-soft は白地で 3.4:1（小さな字に要る 4.5:1 に届かない）だった。紙・濃い地・使えない状態は別の決まり。
_GRAY_SKIP = (':disabled', '::placeholder', '.nav-group-label', '.os-', '.df-', '.rp-page', '.rp-stat')
def _gray_literals(code):
    code = re.sub(r'/\*[\s\S]*?\*/', '', code)
    out = []
    for m in re.finditer(r'([^{}]+)\{([^{}]*)\}', code):
        sel = ' '.join(m.group(1).split())
        if any(x in sel for x in _GRAY_SKIP):
            continue
        for c in re.finditer(r'(?<![-\w])color\s*:\s*#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b', m.group(2)):
            h = c.group(1) if len(c.group(1)) == 6 else ''.join(ch * 2 for ch in c.group(1))
            r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
            y = sum(w * ((v / 255) / 12.92 if v / 255 <= 0.03928 else ((v / 255 + 0.055) / 1.055) ** 2.4)
                    for w, v in ((0.2126, r), (0.7152, g), (0.0722, b)))
            lstar = 116 * y ** (1 / 3) - 16 if y > 0.008856 else 903.3 * y
            if max(r, g, b) - min(r, g, b) <= 45 and b >= r and g >= r - 4 and lstar < 70:
                out.append(f'{sel[-40:]} #{c.group(1)}')
    return out
_gl = [f'{_n}: {x}' for _n in CSS_ORDER for x in _gray_literals((CSS_DIR / _n).read_text(encoding='utf-8'))]
rec('字の灰色は3段のトークン（--ink／--ink-2／--muted）から選ぶ（直書きの灰色が無い・§9.564）', not _gl, '; '.join(_gl[:6]))
rec('灰色の見張りは同じ形を注ぎ込むと数える', _gray_literals('.x{color:#526970}.y{color:var(--muted)}.z:disabled{color:#888}') == ['.x #526970'])
_all_css = ''.join((CSS_DIR / _n).read_text(encoding='utf-8') for _n in CSS_ORDER)
_old = [t for t in ('var(--ink-3)', 'var(--ink-soft)') if t in re.sub(r'/\*[\s\S]*?\*/', '', _all_css)]
rec('まとめた灰色のトークン（--ink-3／--ink-soft）を使っていない', not _old, str(_old))

# ---- 影は役割のトークンから（§9.569）: 浮き＝--elev-*／焦点の輪＝二重の輪（--ring-gap・--ring-w）
def _shadow_parts(v):
    out, dep, cur = [], 0, ''
    for ch in v:
        dep += (ch == '(') - (ch == ')')
        if ch == ',' and dep == 0:
            out.append(cur.strip()); cur = ''
        else:
            cur += ch
    return out + [cur.strip()]


def _shadow_issues(src):
    """浮きの影を字面で書いた所・焦点の輪が二重の輪でない所 → ['セレクタ 値']。@keyframes の中は絵なので見ない。"""
    src = re.sub(r'/\*[\s\S]*?\*/', '', src)
    src = re.sub(r'@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}', '', src)
    out = []
    for sel, body in re.findall(r'([^{}]+)\{([^{}]*)\}', src):
        for v in re.findall(r'box-shadow:\s*([^;]+)', body):
            for part in _shadow_parts(v):
                if 'inset' in part or 'var(' in part.split(' ')[0]:
                    continue
                nums = re.findall(r'(-?[\d.]+)(?:px)?(?=[\s,]|$)', re.sub(r'rgba?\([^)]*\)|color-mix\(.*\)|#[0-9a-fA-F]+', '', part))
                if len(nums) >= 3 and float(nums[2]) > 0:
                    out.append(f'{sel.strip()[-40:]} 浮きの影を字面で: {part[:40]}')
            if ':focus' in sel and re.match(r'\s*0 0 0 ', v) and 'var(--ring-w)' not in v:
                out.append(f'{sel.strip()[-40:]} 焦点の輪が二重の輪でない: {v[:40]}')
    return out
_sh = [f'{_n}: {x}' for _n in CSS_ORDER for x in _shadow_issues((CSS_DIR / _n).read_text(encoding='utf-8'))]
rec('影は役割のトークンから選ぶ（浮き＝--elev-*・焦点＝二重の輪・§9.569）', not _sh, '; '.join(_sh[:6]))
rec('影の見張りは同じ形を注ぎ込むと数える',
    len(_shadow_issues('.a{box-shadow:0 4px 12px #0003}.b:focus{box-shadow:0 0 0 2px #087c89}'
                       '.c{box-shadow:var(--elev-pop)}.d:focus{box-shadow:0 0 0 var(--ring-gap) var(--surface),0 0 0 var(--ring-w) var(--teal)}'
                       '.e{box-shadow:inset 0 7px 9px -9px #0002}@keyframes k{0%{box-shadow:0 0 8px #f00}}')) == 2)


# ---- 使っているトークンが定義されている（§9.569）: 定義の無い var(--x) は値ごと無効になり、黙って何も効かない。
#      影のトークンの定義を落としたとき、影が全部消えたのに網はどれも通った（踏んだ）。代わりの値を持つ var(--x,…) は数えない。
def _undefined_tokens(css, others=''):
    css = re.sub(r'/\*[\s\S]*?\*/', '', css)
    defined = set(re.findall(r'(--[\w-]+)\s*:', css + others)) | set(re.findall(r"setProperty\(\s*['\"`](--[\w-]+)", others))
    return sorted(set(re.findall(r'var\(\s*(--[\w-]+)\s*\)', css)) - defined)
_js_html = ''.join(p.read_text(encoding='utf-8') for d in ('static/js', 'templates') for p in (ROOT / d).rglob('*')
                   if p.suffix in ('.js', '.html'))
_und = _undefined_tokens(_all_css, _js_html)
rec('CSS が使うトークンはどれも定義されている（定義の無い var() は黙って効かない）', not _und, str(_und[:10]))
rec('トークンの見張りは同じ形を注ぎ込むと数える',
    _undefined_tokens(':root{--a:1px}.x{width:var(--a);height:var(--b);top:var(--c,0)}') == ['--b'])

# ---- 使えない・外した物の薄さは --op-disabled の1つ（§9.570）
_OFF_SEL = re.compile(r':disabled|\[disabled\]|aria-disabled="true"|\.is-off\b|\.is-disabled\b|-dead\b|-locked\b|view-mode')
def _opacity_issues(src):
    """使えない・外した物の透明度を字面で書いた所 → ['セレクタ 値']。動き（@keyframes）・掴んでいる物は見ない。"""
    src = re.sub(r'/\*[\s\S]*?\*/', '', src)
    src = re.sub(r'@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}', '', src)
    out = []
    for sel, body in re.findall(r'([^{}]+)\{([^{}]*)\}', src):
        sel = ' '.join(sel.split())
        if not _OFF_SEL.search(sel) or re.search(r'drag|ghost|col-resize', sel):
            continue
        for v in re.findall(r'(?<![\w-])opacity:\s*([^;]+)', body):
            if v.strip() not in ('0', '1', 'var(--op-disabled)'):
                out.append(f'{sel[-50:]} {v.strip()}')
    return out
_op = [f'{_n}: {x}' for _n in CSS_ORDER for x in _opacity_issues((CSS_DIR / _n).read_text(encoding='utf-8'))]
rec('使えない・外した物の薄さは --op-disabled の1つ（§9.570）', not _op, '; '.join(_op[:6]))
rec('薄さの見張りは同じ形を注ぎ込むと数える',
    _opacity_issues('.a:disabled{opacity:.4}.b.is-off{opacity:var(--op-disabled)}.c.is-dragging{opacity:.4}'
                    '.d:hover{opacity:.7}.e[disabled]{opacity:0}') == ['.a:disabled .4'])

ng=[x for x in R if not x[1]]
print('\n=== SUMMARY ===')
print(f'{len(R)-len(ng)}/{len(R)} passed')
for n,_,d in ng: print(' -',n,d)
sys.exit(1 if ng else 0)
