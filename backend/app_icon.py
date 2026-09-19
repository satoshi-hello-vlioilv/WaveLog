"""app_icon.py: デスクトップのショートカットに付けるアイコンを作る（§9.410）。

===========================================================================
なぜ画像を同梱せずコードで描くか
---------------------------------------------------------------------------
このアプリのマークは**起動待機画面（`program/loading.html`）のSVG**が原本で、
同じ絵が既に1つ在る。`.ico`を別途リポジトリへ置くと、**同じ絵が2箇所**になり
片方だけ直した状態が作れる（色を直しても古い`.ico`が残る）。ここでは同じ形・
同じ色を**コードで描いて**`.ico`へ書き出す。

依存は増やさない（`program/requirements.txt`は`flask`だけ・§9.268）。
使うのは`zlib`と`struct`＝標準ライブラリだけで、PNGもICOも自分で組み立てる。

出来上がりは端末ごとの`runtime_dir()`へ置く（アプリ本体は共有に置かれる
運用があるので、そこへ書くと全台が1つを取り合う・§9.225と同じ理由）。

**絵の形は`MARK`が持つ**。色を変えるときはここだけを直す。
===========================================================================
"""
import struct
import zlib

from .paths import runtime_dir
from .quiet import quiet

ICON_FILENAME='wavelog.ico'
# `.ico`に入れる大きさ。Windowsが使うのは 16/32/48/256 だが、拡大の粗を
# 避けたい中間（64/128）も入れておく（合計で20KB程度にしかならない）。
SIZES=(16,24,32,48,64,128,256)
# 作りを変えたら上げること。**上げないと古い絵が残る**（作り直しの判定に使う）。
ICON_VERSION=2

# ---------------------------------------------------------------------------
# 絵（`loading.html`の`<svg viewBox="0 0 64 64">`と同じ・§9.411で「J4」へ改めた）
#   予定表の枠＝スケジュール、中の折れ線＝測定、琥珀の丸＝測った点。
#
# **SVGの`stroke`は「線の中心」に太さの半分ずつ乗る**ので、ここでは
# 塗りつぶしだけで同じ絵を作る——枠線は「太い角丸を塗って、内側を白で抜く」。
# 曲線はSVGの`c`/`s`をそのまま展開したもの（`s`は前の制御点の反射）。
#
# 描く順はSVGと同じ（後のものが上に乗る）。**形を変えるときはここだけ**を直し、
# `loading.html`／`templates/index.html`のSVGと`ICON_VERSION`も一緒に動かすこと。
# ---------------------------------------------------------------------------
EDGE=(0xbc,0xd8,0xdb); FACE=(0xea,0xf3,0xf4); WHITE=(0xff,0xff,0xff)
TEAL=(0x08,0x7c,0x89); TEAL_D=(0x09,0x6b,0x75); AMBER=(0xf5,0xa3,0x0a)
MARK=(
 ('rrect', 0,    0,    64,   64,   13,   EDGE),   # 外枠（stroke 2 の外側）
 ('rrect', 1,    1,    62,   62,   12,   FACE),   # 地
 ('rrect', 8.25, 10.25,47.5, 43.5, 7.75, TEAL),   # 予定表の枠（stroke 3.5）
 ('rrect', 11.75,13.75,40.5, 36.5, 4.25, WHITE),  # 枠の中
 ('rrect', 10,   21.25,44,   3.5,  0,    TEAL),   # 見出しの帯（M10 23h44）
 ('line',  22,   8,    22,   12,   4,    TEAL_D), # 綴じ（M22 12v-4）
 ('line',  42,   8,    42,   12,   4,    TEAL_D), # 綴じ（M42 12v-4）
 ('curve', (17,41),(22,31),(25,46),(29,37), 4, TEAL_D),   # 測定の折れ線
 ('curve', (29,37),(33,28),(36,44),(40,35), 4, TEAL_D),
 ('dot',   46,   33,   4.5,  AMBER),              # 測った点
)


def _bezier(p0,p1,p2,p3,steps):
 """3次ベジェを点列にする。"""
 out=[]
 for i in range(steps+1):
  t=i/steps;u=1-t
  a,b,c,d=u*u*u,3*u*u*t,3*u*t*t,t*t*t
  out.append((a*p0[0]+b*p1[0]+c*p2[0]+d*p3[0],
              a*p0[1]+b*p1[1]+c*p2[1]+d*p3[1]))
 return out


def _blend(dst,i,color,cov):
 """1画素へ色を重ねる（`cov`は0..1の覆い率）。"""
 if cov<=0:return
 if cov>1:cov=1.0
 for k in range(3):
  dst[i+k]=int(round(dst[i+k]*(1-cov)+color[k]*cov))
 dst[i+3]=int(round(dst[i+3]+(255-dst[i+3])*cov))


def _round_rect_coverage(px,py,x,y,w,h,r):
 """角丸四角の内側なら1、境目なら0..1（符号付き距離で滑らかにする）。"""
 # 中心から測った距離で、角だけ丸くする（いわゆる角丸のSDF）。
 cx,cy=x+w/2.0,y+h/2.0
 qx=abs(px-cx)-(w/2.0-r);qy=abs(py-cy)-(h/2.0-r)
 # **内側を負にする項（`min(max(qx,qy),0)`）を落とさないこと。**
 # これが無いと、内側でも`qx`/`qy`が0に潰れて距離が`-r`止まりになり、
 # **角丸半径0の四角が半分の濃さでしか塗れない**（見出しの帯で実際に踏んだ）。
 d=(max(qx,0.0)**2+max(qy,0.0)**2)**0.5+min(max(qx,qy),0.0)-r
 return max(0.0,min(1.0,0.5-d))


def _fill_rrect(dst,size,x,y,w,h,r,color,s):
 """角丸四角を塗る。**その四角の周りだけ**を走る（毎回全画素は要らない）。"""
 x0=max(0,int(x*s)-1);x1=min(size-1,int((x+w)*s)+1)
 y0=max(0,int(y*s)-1);y1=min(size-1,int((y+h)*s)+1)
 for py in range(y0,y1+1):
  for px in range(x0,x1+1):
   cov=_round_rect_coverage(px+0.5,py+0.5,x*s,y*s,w*s,h*s,r*s)
   if cov>0:_blend(dst,(py*size+px)*4,color,cov)


def _stamp(dst,size,px,py,radius,color):
 """丸い筆を1回押す（境目は覆い率で滑らかにする）。"""
 x0=max(0,int(px-radius-1));x1=min(size-1,int(px+radius+1))
 y0=max(0,int(py-radius-1));y1=min(size-1,int(py+radius+1))
 for y in range(y0,y1+1):
  for x in range(x0,x1+1):
   d=(((x+0.5)-px)**2+((y+0.5)-py)**2)**0.5
   cov=max(0.0,min(1.0,radius-d+0.5))
   if cov>0:_blend(dst,(y*size+x)*4,color,cov)


def _draw_line(dst,size,x0,y0,x1,y1,width,color,s):
 """丸い筆で線を引く。**点で描かずに線で描く**——点の間隔を筆の半径より
    細かくすれば、継ぎ目は出ない（丸い筆＝丸い端と角）。"""
 radius=width*s/2.0
 n=max(2,int(((x1-x0)**2+(y1-y0)**2)**0.5*s)+2)
 for i in range(n+1):
  t=i/n
  _stamp(dst,size,(x0+(x1-x0)*t)*s,(y0+(y1-y0)*t)*s,radius,color)


def render(size):
 """1辺`size`画素のRGBA（`bytearray`）を作る。**`MARK`の順に重ねるだけ**。"""
 s=size/64.0
 buf=bytearray(size*size*4)
 for op in MARK:
  kind=op[0]
  if kind=='rrect':
   _,x,y,w,h,r,color=op
   _fill_rrect(buf,size,x,y,w,h,r,color,s)
  elif kind=='line':
   _,x0,y0,x1,y1,width,color=op
   _draw_line(buf,size,x0,y0,x1,y1,width,color,s)
  elif kind=='curve':
   _,p0,p1,p2,p3,width,color=op
   radius=width*s/2.0
   pts=_bezier(*[(p[0]*s,p[1]*s) for p in (p0,p1,p2,p3)],steps=max(8,int(24*s)+8))
   for (px,py) in pts:
    _stamp(buf,size,px,py,radius,color)
  elif kind=='dot':
   _,cx,cy,r,color=op
   _stamp(buf,size,cx*s,cy*s,r*s,color)
  else:
   raise ValueError('知らない描き方: %r'%(kind,))
 return buf


def _png(size,rgba):
 """PNG（フィルタなし）。**大きい絵ぶんだけ**使う。"""
 raw=bytearray()
 for y in range(size):
  raw.append(0)
  raw+=rgba[y*size*4:(y+1)*size*4]
 def chunk(tag,data):
  return (struct.pack('>I',len(data))+tag+data
          +struct.pack('>I',zlib.crc32(tag+data)&0xffffffff))
 return (b'\x89PNG\r\n\x1a\n'
         +chunk(b'IHDR',struct.pack('>IIBBBBB',size,size,8,6,0,0,0))
         +chunk(b'IDAT',zlib.compress(bytes(raw),9))
         +chunk(b'IEND',b''))


def _dib(size,rgba):
 """32bitのDIB（BMP）。**小さい絵はこちら**——古いシェルはPNG入りの
    `.ico`を小さい寸法で読まないことがあり、そこだけ絵が出なくなる。
    高さはAND マスクのぶんも数えて2倍で書く（`.ico`の決まり）。"""
 head=struct.pack('<IiiHHIIiiII',40,size,size*2,1,32,0,size*size*4,0,0,0,0)
 body=bytearray()
 for y in range(size-1,-1,-1):        # 下から上へ
  for x in range(size):
   i=(y*size+x)*4
   body+=bytes((rgba[i+2],rgba[i+1],rgba[i],rgba[i+3]))   # BGRA
 # AND マスク（全部0＝透けない。実際の透け方はアルファが持つ）
 stride=((size+31)//32)*4
 mask=bytes(stride*size)
 return head+bytes(body)+mask


def png(size):
 """1辺`size`画素のPNG。画面の**見本**がこれを読む（絵を書き写さない・§9.374）。"""
 return _png(size,render(size))


def build():
 """`.ico`の中身（bytes）を組み立てる。"""
 imgs=[]
 for size in SIZES:
  rgba=render(size)
  imgs.append((size,_png(size,rgba) if size>=128 else _dib(size,rgba)))
 out=bytearray(struct.pack('<HHH',0,1,len(imgs)))
 offset=6+16*len(imgs)
 for size,data in imgs:
  out+=struct.pack('<BBBBHHII',0 if size>=256 else size,0 if size>=256 else size,
                   0,0,1,32,len(data),offset)
  offset+=len(data)
 for _size,data in imgs:
  out+=data
 return bytes(out)


def icon_path():
 """既定のアイコンの置き場（端末ごと）。"""
 return runtime_dir()/ICON_FILENAME


def ensure(force=False):
 """既定のアイコンを用意して置き場を返す。作れなければ`None`。

 **作り直すのは作りを変えたときだけ**（`ICON_VERSION`）——毎回描くと、
 ショートカットの画面を開くたびに数百msかかる。"""
 path=icon_path()
 mark=path.with_suffix('.ver')
 want=f'{ICON_VERSION}'
 try:
  if not force and path.exists() and mark.exists() and mark.read_text(encoding='utf-8').strip()==want:
   return path
 except Exception as _e:
  quiet('アイコンの刻印を読めない（作り直す）',_e)
 try:
  path.parent.mkdir(parents=True,exist_ok=True)
  path.write_bytes(build())
  mark.write_text(want,encoding='utf-8')
  return path
 except Exception as _e:
  quiet('アイコンを作れない（既定の絵なしでショートカットを作る）',_e)
  return None
