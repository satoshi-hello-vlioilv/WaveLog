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
ICON_VERSION=1

# ---------------------------------------------------------------------------
# 絵（`loading.html`の`<svg viewBox="0 0 64 64">`と同じ）
#   ・角丸の四角     rx=14   #0f2c35
#   ・波の折れ線     太さ4   #2ec9c0（3本の3次ベジェ）
#   ・右上の丸       r=5     #f5a30a  中心(50,20)
# 曲線はSVGの`c`/`s`をそのまま展開したもの（`s`は前の制御点の反射）。
# ---------------------------------------------------------------------------
MARK={
 'box':(0,0,64,64),'radius':14,'bg':(0x0f,0x2c,0x35),
 'wave':[((10,40),(16,24),(20,48),(26,34)),
         ((26,34),(32,20),(36,44),(42,30)),
         ((42,30),(48,16),(50,34),(54,28))],
 'wave_width':4,'wave_color':(0x2e,0xc9,0xc0),
 'dot':(50,20,5),'dot_color':(0xf5,0xa3,0x0a),
}


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


def _round_rect_coverage(x,y,w,h,r):
 """角丸四角の内側なら1、境目なら0..1（符号付き距離で滑らかにする）。"""
 # 中心から測った距離で、角だけ丸くする（いわゆる角丸のSDF）。
 cx,cy=w/2.0,h/2.0
 dx=abs(x-cx)-(w/2.0-r);dy=abs(y-cy)-(h/2.0-r)
 if dx<0:dx=0.0
 if dy<0:dy=0.0
 d=(dx*dx+dy*dy)**0.5-r
 return max(0.0,min(1.0,0.5-d))


def _stamp(dst,size,px,py,radius,color):
 """丸い筆を1回押す（境目は覆い率で滑らかにする）。"""
 x0=max(0,int(px-radius-1));x1=min(size-1,int(px+radius+1))
 y0=max(0,int(py-radius-1));y1=min(size-1,int(py+radius+1))
 for y in range(y0,y1+1):
  for x in range(x0,x1+1):
   d=(((x+0.5)-px)**2+((y+0.5)-py)**2)**0.5
   cov=max(0.0,min(1.0,radius-d+0.5))
   if cov>0:_blend(dst,(y*size+x)*4,color,cov)


def render(size):
 """1辺`size`画素のRGBA（`bytearray`）を作る。"""
 s=size/64.0
 buf=bytearray(size*size*4)
 bg=MARK['bg'];r=MARK['radius']*s
 for y in range(size):
  for x in range(size):
   cov=_round_rect_coverage(x+0.5,y+0.5,size,size,r)
   if cov>0:_blend(buf,(y*size+x)*4,bg,cov)
 # 波。**点で描かずに線で描く**——点の間隔を筆の半径より細かくすれば、
 # 折れ線でも継ぎ目は出ない（丸い筆＝丸い端と角）。
 radius=MARK['wave_width']*s/2.0
 steps=max(8,int(24*s)+8)
 for seg in MARK['wave']:
  pts=_bezier(*[(p[0]*s,p[1]*s) for p in seg],steps=steps)
  for (px,py) in pts:
   _stamp(buf,size,px,py,radius,MARK['wave_color'])
 dx,dy,dr=MARK['dot']
 _stamp(buf,size,dx*s,dy*s,dr*s,MARK['dot_color'])
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
    高さはAND маскのぶんも数えて2倍で書く（`.ico`の決まり）。"""
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
