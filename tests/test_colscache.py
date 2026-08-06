# -*- coding: utf-8 -*-
"""cols()のキャッシュが接続先ごとに正しく分かれているかの検証(§9.66)。

同じ名前のテーブルを持つ別DBを続けて開いたとき、先に開いた方の列名が
返ると dict(zip(列名,行)) で値が別の列名へ紐づく(品質データの一覧で
ロット№欄に日時が出た不具合)。列数が違えばzipで末尾が黙って落ちる。
"""
import sys,os,json,sqlite3,tempfile,urllib.request,urllib.parse
_ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0,_ROOT)
os.chdir(_ROOT)
from pathlib import Path
from backend import db_access

R=[]
def rec(n,ok,d=''):
    R.append(ok);print(('PASS' if ok else 'FAIL')+': '+n+(' -- '+str(d) if d else ''))

d=tempfile.mkdtemp()
a=Path(d)/'A.sqlite3';b=Path(d)/'B.sqlite3'
COLS_A=['ロット番号','鋳造番号','製造材質']
COLS_B=['検査日時','設備','ロット番号','検査結果','備考']
for p,cs,vals in [(a,COLS_A,('L0001','C1','A5052')),
                  (b,COLS_B,('2026-07-23 05:05:25','L-3','N4471A0','OK','x'))]:
    c=sqlite3.connect(str(p))
    c.execute('CREATE TABLE "T"('+','.join(f'"{x}" TEXT' for x in cs)+')')
    c.execute('INSERT INTO "T" VALUES('+','.join('?'*len(cs))+')',vals)
    c.commit();c.close()

db_access.invalidate_cols_cache()
with db_access.connect(a,True) as c: ga=db_access.cols(c,'T',source=a)
with db_access.connect(b,True) as c: gb=db_access.cols(c,'T',source=b)
rec('同名テーブルの別DBでも自分の列名が返る(1回目)',ga==COLS_A and gb==COLS_B,f'{ga} / {gb}')
with db_access.connect(a,True) as c: ga2=db_access.cols(c,'T',source=a)
with db_access.connect(b,True) as c: gb2=db_access.cols(c,'T',source=b)
rec('キャッシュ経由でも取り違えない(2回目)',ga2==COLS_A and gb2==COLS_B,f'{ga2} / {gb2}')

# 実際にdict(zip())したとき、値が正しい列名へ紐づくか
with db_access.connect(b,True) as c:
    cs=db_access.cols(c,'T',source=b)
    row=c.execute('SELECT * FROM "T"').fetchone()
    dd=dict(zip(cs,row))
rec('日時がロット番号欄へ入らない',dd['ロット番号']=='N4471A0',json.dumps(dd,ensure_ascii=False))
rec('列が1つも欠落しない(zipで末尾が落ちない)',len(dd)==len(COLS_B),f'{len(dd)}/{len(COLS_B)}')

# sourceを渡さなければキャッシュしない(=取り違えようがない)
db_access.invalidate_cols_cache()
with db_access.connect(a,True) as c: na=db_access.cols(c,'T')
with db_access.connect(b,True) as c: nb=db_access.cols(c,'T')
rec('source未指定でもキャッシュせず正しい列を返す',na==COLS_A and nb==COLS_B,f'{na} / {nb}')

# APIレベル: 各DBが返すcolumnsが、そのDBの実スキーマと一致するか
B='http://127.0.0.1:5029'
def get(u):
    with urllib.request.urlopen(B+u,timeout=30) as r:return json.loads(r.read())
try:
    for key in ('SIKALOTNOW','SIKALOTDEF'):
        cfg=db_access.DBS[key]
        t=get(f'/api/tables?db={key}')['tables'][0]
        api=get(f'/api/table?db={key}&table={urllib.parse.quote(t)}&page=1&page_size=50&include_hidden=1')
        with sqlite3.connect(str(cfg['path'])) as sc:
            real=[x[0] for x in sc.execute(f'SELECT * FROM "{t}" LIMIT 1').description]
        rec(f'{key}: APIのcolumnsが実スキーマと一致',api['columns']==real,
            f"api={api['columns'][:4]} real={real[:4]}")
        rows=api.get('rows') or []
        if rows:
            rec(f'{key}: 行のキーが実スキーマの範囲に収まる',
                set(rows[0].keys())<=set(real),
                str(sorted(set(rows[0].keys())-set(real))[:4]))
            rec(f'{key}: 列が欠落していない',len(rows[0])==len(real),f'{len(rows[0])}/{len(real)}')
except Exception as e:
    rec('APIレベルの確認',False,repr(e))

print()
print(f'== {sum(R)}/{len(R)} PASS ==')
sys.exit(0 if all(R) else 1)
