import json, html
M = __file__.rsplit('/', 1)[0]
L1 = [('ロット番号',0,4),('作業開始',4,2),('作業終了',6,2),('実働(分)',8,2),('運転方式',10,3),('設定張力 アンコイラ',13,3),('設定張力 MD',16,3),('リール径(mm)',19,2),('オペレータ',21,3)]
L2 = [('検査番号',0,4),('スリット 刃厚',4,2),('スリット 刃径(mm)',6,2),('クリアランス',8,2),('実ラップ',10,3),('縦割数',13,3),('横割数',16,3),('内径',19,2),('検査員',21,3)]
DATA = [
 {'ロット番号':'R26-10-0412','作業開始':'08:12','作業終了':'08:47','実働(分)':'35','運転方式':'連続','設定張力 アンコイラ':'1.20','設定張力 MD':'0.85','リール径(mm)':'508','オペレータ':'佐藤','検査番号':'K-55120','スリット 刃厚':'1.5','スリット 刃径(mm)':'250','クリアランス':'0.05','実ラップ':'0.40','縦割数':'6','横割数':'1','内径':'508','検査員':'鈴木'},
 {'ロット番号':'R26-10-0413','作業開始':'08:52','作業終了':'09:31','実働(分)':'39','運転方式':'連続','設定張力 アンコイラ':'1.25','設定張力 MD':'0.90','リール径(mm)':'508','オペレータ':'佐藤','検査番号':'K-55121','スリット 刃厚':'1.5','スリット 刃径(mm)':'250','クリアランス':'0.05','実ラップ':'0.42','縦割数':'8','横割数':'1','内径':'508','検査員':'鈴木'},
 {'ロット番号':'R26-10-0414','作業開始':'09:40','作業終了':'10:22','実働(分)':'42','運転方式':'寸動','設定張力 アンコイラ':'1.10','設定張力 MD':'0.80','リール径(mm)':'610','オペレータ':'田中','検査番号':'K-55122','スリット 刃厚':'2.0','スリット 刃径(mm)':'260','クリアランス':'0.06','実ラップ':'0.45','縦割数':'4','横割数':'2','内径':'610','検査員':'高橋'},
]
NUM = {'作業開始','作業終了','実働(分)','設定張力 アンコイラ','設定張力 MD','リール径(mm)','スリット 刃厚','スリット 刃径(mm)','クリアランス','実ラップ','縦割数','横割数','内径'}
e = html.escape

def aligned(rows=3, units=24, hl=None):
    """配置どおりの2段組（横位置と幅は24マスの目盛り）。"""
    out = [f'<div class="out" style="grid-template-columns:repeat({units},1fr)">']
    for line, L in ((1, L1), (2, L2)):
        for k, s, w in L:
            cls = 'c h' + (' hl' if hl == k else '')
            out.append(f'<div class="{cls}" style="grid-column:{s+1}/span {w}">{e(k)}</div>')
    for i, d in enumerate(DATA[:rows]):
        for line, L in ((1, L1), (2, L2)):
            for k, s, w in L:
                cls = 'c' + (' num' if k in NUM else '') + (' rec2' if line == 2 else '') + (' alt' if i % 2 else '')
                out.append(f'<div class="{cls}" style="grid-column:{s+1}/span {w}">{e(d[k])}</div>')
    out.append('</div>')
    return ''.join(out)

def drifted(rows=3):
    """段ごとに幅が決まる（縦がそろわない）2段組。"""
    w1 = [118, 54, 54, 50, 72, 120, 92, 82, 70]; w2 = [96, 88, 120, 80, 64, 56, 56, 48, 64]
    def line(L, ws, d, head, last, alt):
        g = ' '.join(f'{w}px' for w in ws)
        cells = ''.join(f'<div class="c{" h" if head else ""}{" num" if (not head and k in NUM) else ""}{" rec2" if last else ""}{" alt" if alt else ""}">{e(k if head else d[k])}</div>' for (k, _, _), w in zip(L, ws))
        return f'<div style="display:grid;grid-template-columns:{g}">{cells}</div>'
    out = ['<div class="out" style="display:block">']
    out.append(line(L1, w1, None, True, False, False)); out.append(line(L2, w2, None, True, False, False))
    for i, d in enumerate(DATA[:rows]):
        out.append(line(L1, w1, d, False, False, i % 2)); out.append(line(L2, w2, d, False, True, i % 2))
    out.append('</div>')
    return ''.join(out)

def page(no, title, sub, body):
    return f'''<!doctype html><html lang="ja"><head><meta charset="utf-8"><link rel="stylesheet" href="common.css"><style>.hl{{outline:2px solid var(--violet);outline-offset:-2px}}</style></head>
<body><div class="app"><div class="top"><b>案{no}　{e(title)}</b><small>{e(sub)}</small><span class="tag">見本（案{no}）</span></div>
<div class="wrap">{body}</div></div></body></html>'''

FIELDS = [k for k, _, _ in L1] + [k for k, _, _ in L2]
UNUSED = ['鋳造番号', '状態', 'スプール', '巻出方向', 'バリ揃え', 'コイル止め', '板厚測定器', '作業人数']

# ---- 案1 列リストに段の札 ----
rows1 = ''.join(f'''<div style="display:grid;grid-template-columns:24px 26px 1fr 170px 90px;align-items:center;gap:8px;padding:4px 6px;border-bottom:1px solid var(--line-soft)">
<span class="note">⋮⋮</span><input type="checkbox" {"checked" if k in FIELDS else ""}><span>{e(k)}</span>
<span class="seg"><span class="{'on' if k not in FIELDS[:9]+FIELDS[9:] else ''}">自動</span><span class="{'on' if k in FIELDS[:9] else ''}">上段</span><span class="{'on' if k in FIELDS[9:] else ''}">下段</span></span>
<span class="note">幅 {80+(i*7)%60}px</span></div>''' for i, k in enumerate(FIELDS[:12] + UNUSED[:3]))
b1 = f'''<div class="row" style="flex:1;min-height:0">
<div class="card" style="width:640px;overflow:hidden"><h3>載せる列（今の「表示列」の窓に段の札を足す）<i>並べ替えはつまみ・段は札・幅は数で</i></h3>{rows1}</div>
<div class="card" style="flex:1"><h3>この案で決められること</h3><ul class="note" style="line-height:1.9;margin:0;padding-left:18px">
<li>使う／使わない・並び・段（上段・下段）・幅</li><li><span class="warn">下段の項目を上段の特定の項目の真下へ置けない</span>（段ごとに幅を足していくので、縦がずれる）</li>
<li>どう見えるかは窓を閉じて一覧／プレビューで確かめる</li></ul></div></div>
<div class="card"><h3>できあがり（一覧の2段組）<i>上段と下段の境目がそろわない</i></h3>{drifted()}</div>'''

# ---- 案2 上段・下段の2本の並べ替えリスト ----
def lane(name, items):
    li = ''.join(f'<div class="chip" style="display:flex;justify-content:space-between;margin:3px 0"><span>⋮⋮ {e(k)}</span><span class="note">{70+(len(k)*9)%70}px</span></div>' for k in items)
    return f'<div class="card" style="flex:1"><h3>{name}</h3>{li}</div>'
pal = ''.join(f'<div class="chip" style="margin:3px 0;display:flex">{e(k)}</div>' for k in UNUSED)
b2 = f'''<div class="row" style="flex:1;min-height:0">
<div class="card" style="width:220px"><h3>使っていない項目<i>掴んで右へ</i></h3>{pal}</div>
{lane('上段（左から順）', FIELDS[:9])}{lane('下段（左から順）', FIELDS[9:])}
<div class="card" style="width:300px"><h3>この案で決められること</h3><ul class="note" style="line-height:1.9;margin:0;padding-left:18px">
<li>使う項目・段・並び・幅（px）</li><li><span class="warn">縦にそろえる手段が無い</span>（2本のリストは別々に左から詰める）</li><li>リストが縦、出来上がりが横なので頭の中で向きを変える</li></ul></div></div>
<div class="card"><h3>できあがり（一覧の2段組）<i>段ごとに左から詰めるだけ</i></h3>{drifted()}</div>'''

# ---- 案3 縦積みスロット表 ----
slots = list(zip(L1, L2))
cols = ''.join(f'''<div style="border:1px solid var(--line);border-radius:6px;padding:6px;min-width:0;background:var(--surface-2)">
<div class="lbl">枠{i+1}</div><div class="chip" style="width:100%;margin:4px 0">上 ▾ {e(a[0])}</div><div class="chip" style="width:100%;margin-bottom:4px">下 ▾ {e(b[0])}</div>
<div class="note">幅 {a[2]}マス</div></div>''' for i, (a, b) in enumerate(slots))
b3 = f'''<div class="card" style="flex:1"><h3>枠の表（1枠＝上下2つの項目を縦に積む）<i>枠ごとにプルダウンで項目を選び、枠の幅を決める</i></h3>
<div style="display:grid;grid-template-columns:repeat(9,1fr);gap:6px">{cols}</div>
<p class="note" style="margin:10px 0 0">決められること: 使う項目・段（上下）・並び・幅（枠の単位）。<span class="warn">1項目を2枠にまたがせる／上段だけ広い枠にする、はできない</span>（上下は必ず同じ幅）。項目が増えると枠が横へ伸びて、プルダウンを1つずつ開くことになる。</p></div>
<div class="card"><h3>できあがり（一覧の2段組）<i>上下はそろう（同じ枠に積むので）</i></h3>{aligned()}</div>'''

# ---- 案4 配置の盤 ----
def board():
    cells = []
    for line, L in ((1, L1), (2, L2)):
        for k, s, w in L:
            sel = k == '検査番号'
            st = f'grid-column:{s+1}/span {w};grid-row:{line}'
            cls = 'bchip' + (' sel' if sel else '')
            cells.append(f'<div class="{cls}" style="{st}"><span>{e(k)}</span><i class="hd"></i></div>')
    grid = ''.join(f'<div class="tick" style="grid-column:{i+1};grid-row:1/span 2"></div>' for i in range(24))
    return f'''<div class="board">{grid}{"".join(cells)}</div>'''
palette = ''.join(f'<label class="pl"><input type="checkbox" {"checked" if k in FIELDS else ""}>{e(k)}<i>{"置いた" if k in FIELDS else ""}</i></label>' for k in (FIELDS[:4] + UNUSED[:4] + FIELDS[9:12]))
b4 = f'''<style>
.board{{display:grid;grid-template-columns:repeat(24,1fr);grid-template-rows:42px 42px;gap:4px 2px;position:relative;padding:6px;background:repeating-linear-gradient(90deg,transparent 0,transparent calc(100%/24 - 1px),var(--line-soft) calc(100%/24 - 1px),var(--line-soft) calc(100%/24));border:1px dashed var(--line);border-radius:6px}}
.tick{{}}
.bchip{{position:relative;display:flex;align-items:center;padding:0 8px;background:var(--pale);border:1px solid var(--teal);border-radius:5px;font-size:12px;font-weight:700;color:var(--teal-d);overflow:hidden;white-space:nowrap;cursor:grab}}
.bchip .hd{{position:absolute;right:0;top:0;bottom:0;width:6px;background:var(--teal);opacity:.35;cursor:ew-resize}}
.bchip.sel{{background:#efeaff;border-color:var(--violet);color:var(--violet);box-shadow:0 0 0 2px #d8cdfa}}
.lanes{{display:flex;flex-direction:column;justify-content:space-around;font-size:11px;font-weight:800;color:var(--ink-3);padding:6px 0;width:42px}}
.pl{{display:flex;align-items:center;gap:6px;padding:4px 2px;border-bottom:1px solid var(--line-soft);font-size:12px}}.pl i{{margin-left:auto;font-style:normal;color:var(--teal);font-size:11px}}
.insp dl{{display:grid;grid-template-columns:72px 1fr;gap:6px 8px;margin:0;font-size:12px}}.insp dt{{color:var(--ink-3)}}
</style>
<div class="row" style="height:330px">
<div class="card" style="width:250px;overflow:hidden"><h3>使うデータ<i>チェックで盤へ置く</i></h3><div class="chip" style="width:100%;margin-bottom:6px">🔍 項目を探す</div>
<div class="lbl">基本情報</div>{palette}</div>
<div class="card" style="flex:1"><h3>1件ぶんの配置（24マスの盤）<i>掴んで動かす・右端を引いて幅・↑↓で段・←→で1マス</i></h3>
<div style="display:flex;gap:6px"><div class="lanes"><span>上段</span><span>下段</span></div><div style="flex:1">{board()}</div></div>
<p class="note" style="margin:8px 0 0">紫の枠＝選んだ項目。上の段と同じ縦線にそろうので、<b>検査番号はロット番号の真下</b>に置ける。空いたマスは空欄のまま（詰めない）。</p></div>
<div class="card insp" style="width:240px"><h3>選んだ項目</h3><dl><dt>項目</dt><dd><b>検査番号</b></dd><dt>段</dt><dd><span class="seg"><span>上段</span><span class="on">下段</span></span></dd>
<dt>位置</dt><dd>1マス目から</dd><dt>幅</dt><dd>4マス（紙 約45mm）</dd><dt>揃え</dt><dd><span class="seg"><span class="on">左</span><span>中</span><span>右</span></span></dd></dl>
<p class="note">同じ盤を<b>紙</b>と<b>一覧の2段組</b>が読む。</p></div></div>
<div class="card"><h3>できあがり（いまの盤そのまま）<span style="float:right"><span class="seg"><span class="on">一覧</span><span>紙（A4横）</span></span></span></h3>{aligned(hl='検査番号')}</div>'''

# ---- 案5 実物の上で直接編集 ----
b5 = f'''<style>.out .h{{outline:1px dashed var(--teal);outline-offset:-3px;cursor:grab}}.ghost{{position:absolute;left:520px;top:206px;padding:3px 8px;background:#efeaff;border:1px solid var(--violet);color:var(--violet);border-radius:5px;font-weight:700;box-shadow:0 4px 10px rgba(0,0,0,.18)}}</style>
<div class="card" style="position:relative"><h3>一覧そのものの見出しを掴んで動かす（編集のモード）<i>見出しを掴んで上段／下段・左右へ。見出しの右端を引いて幅</i></h3>
<div class="row" style="gap:8px;margin-bottom:8px"><span class="chip on">✎ 段組を編集中</span><span class="chip">＋ 項目を足す…</span><span class="chip">元に戻す</span><span class="chip">保存</span></div>
{aligned(hl='検査番号')}<div class="ghost">⋮⋮ 検査番号</div>
<p class="note" style="margin:10px 0 0">決められること: 段・並び・幅（見出しの境目を引く）。<span class="warn">どのマスに置いたかが目に見えない</span>（目盛りが無いので、真下にそろえたつもりが数pxずれる）。使っていない項目は別の窓から足す。<span class="warn">紙の割り付けは一覧の幅と別物</span>（mmへ換算すると折り返しが変わる）。</p></div>
<div class="card"><h3>紙（A4横）にすると</h3>{drifted(2)}</div>'''

for no, t, s, b in ((1, '列リストに段の札', '今の「表示列」の窓へ 自動／上段／下段 を足す', b1),
                    (2, '上段・下段の2本の並べ替えリスト', '段ごとのリストへ項目を入れ、並べ替える', b2),
                    (3, '縦積みの枠の表', '1枠に上下2項目を積み、枠の幅を決める', b3),
                    (4, '配置の盤（24マスに札を置く）', '使うデータを選び、盤の上で段・位置・幅を決める。紙と一覧が同じ盤を読む', b4),
                    (5, '一覧の上で直接編集', '見出しを掴んで動かす（編集のモード）', b5)):
    open(f'{M}/case{no}.html', 'w', encoding='utf-8').write(page(no, t, s, b))
print('ok')
