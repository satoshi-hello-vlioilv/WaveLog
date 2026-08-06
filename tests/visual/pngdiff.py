#!/usr/bin/env python3
"""PNGの画素比較。標準ライブラリ(zlib)だけで完結させる。
   ------------------------------------------------------------
   見た目を変えないリファクタリング(CSSのレイヤ化・分割など)の前後で、
   同じ画面が1画素も動いていないことを機械的に確かめるために使う。
   Pillow/pixelmatch を入れると実機(Windows)の検証環境にも同じ依存が要る
   ため、外部パッケージは使わない。

   対応: 8bit の RGB/RGBA/グレースケール、非インターレース(Playwrightの
   スクリーンショットはこの形式)。それ以外が来たら明示的に落とす。

   使い方:
     python3 tests/visual/pngdiff.py 基準ディレクトリ 比較ディレクトリ [--out 差分の出力先]
   終了コード: 0=全て一致 / 1=差分あり / 2=比較できなかった
"""
import sys,zlib,struct,pathlib,argparse

# ---------- PNG読み込み ----------
def _unfilter(raw,w,h,bpp):
    """PNGの行フィルタを戻す。1行 = フィルタ種別1byte + 画素データ。"""
    stride=w*bpp
    out=bytearray(stride*h)
    prev=bytearray(stride)
    pos=0
    for y in range(h):
        ft=raw[pos];pos+=1
        line=bytearray(raw[pos:pos+stride]);pos+=stride
        if ft==0:
            pass
        elif ft==1:                      # Sub
            for i in range(bpp,stride): line[i]=(line[i]+line[i-bpp])&0xff
        elif ft==2:                      # Up
            for i in range(stride): line[i]=(line[i]+prev[i])&0xff
        elif ft==3:                      # Average
            for i in range(stride):
                a=line[i-bpp] if i>=bpp else 0
                line[i]=(line[i]+((a+prev[i])>>1))&0xff
        elif ft==4:                      # Paeth
            for i in range(stride):
                a=line[i-bpp] if i>=bpp else 0
                b=prev[i]
                c=prev[i-bpp] if i>=bpp else 0
                p=a+b-c
                pa,pb,pc=abs(p-a),abs(p-b),abs(p-c)
                pr=a if (pa<=pb and pa<=pc) else (b if pb<=pc else c)
                line[i]=(line[i]+pr)&0xff
        else:
            raise ValueError(f'未知のフィルタ種別 {ft}')
        out[y*stride:(y+1)*stride]=line
        prev=line
    return bytes(out)

def read_png(path):
    """→ (幅, 高さ, 1画素のバイト数, 画素バイト列)"""
    data=pathlib.Path(path).read_bytes()
    if data[:8]!=b'\x89PNG\r\n\x1a\n': raise ValueError('PNGではない: '+str(path))
    pos=8;idat=[];w=h=depth=ctype=None;interlace=0
    while pos<len(data):
        ln,typ=struct.unpack('>I4s',data[pos:pos+8]);pos+=8
        body=data[pos:pos+ln];pos+=ln+4          # +4 = CRC を読み飛ばす
        if typ==b'IHDR':
            w,h,depth,ctype,_,_,interlace=struct.unpack('>IIBBBBB',body)
        elif typ==b'IDAT': idat.append(body)
        elif typ==b'IEND': break
    if depth!=8: raise ValueError(f'8bit以外は未対応 (depth={depth})')
    if interlace: raise ValueError('インターレースPNGは未対応')
    bpp={0:1,2:3,4:2,6:4}.get(ctype)
    if bpp is None: raise ValueError(f'カラータイプ {ctype} は未対応(パレットPNG等)')
    return w,h,bpp,_unfilter(zlib.decompress(b''.join(idat)),w,h,bpp)

# ---------- PNG書き出し(差分画像用) ----------
def write_png(path,w,h,rgb):
    raw=bytearray()
    for y in range(h):
        raw.append(0)                              # フィルタなし
        raw+=rgb[y*w*3:(y+1)*w*3]
    def chunk(typ,body):
        return struct.pack('>I',len(body))+typ+body+struct.pack('>I',zlib.crc32(typ+body)&0xffffffff)
    png=b'\x89PNG\r\n\x1a\n'
    png+=chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,2,0,0,0))
    png+=chunk(b'IDAT',zlib.compress(bytes(raw),6))
    png+=chunk(b'IEND',b'')
    pathlib.Path(path).write_bytes(png)

# ---------- 比較 ----------
def compare(a,b,tol=0,diff_out=None):
    """→ dict。tol は 1チャンネルあたりの許容差(0=完全一致を要求)。"""
    wa,ha,ba,pa=read_png(a)
    wb,hb,bb,pb=read_png(b)
    if (wa,ha)!=(wb,hb):
        return {'ok':False,'reason':f'サイズ違い {wa}x{ha} vs {wb}x{hb}',
                'diff':None,'total':0,'ratio':1.0,'bbox':None}
    n=wa*ha
    diff=0;x0=y0=10**9;x1=y1=-1
    out=bytearray(n*3) if diff_out else None
    for i in range(n):
        oa=i*ba; ob=i*bb
        if ba>=3:
            r1,g1,b1=pa[oa],pa[oa+1],pa[oa+2]
            r2,g2,b2=pb[ob],pb[ob+1],pb[ob+2]
        else:
            r1=g1=b1=pa[oa]; r2=g2=b2=pb[ob]
        d=max(abs(r1-r2),abs(g1-g2),abs(b1-b2))
        if d>tol:
            diff+=1
            x,y=i%wa,i//wa
            if x<x0:x0=x
            if x>x1:x1=x
            if y<y0:y0=y
            if y>y1:y1=y
            if out: out[i*3]=255;out[i*3+1]=0;out[i*3+2]=0
        elif out:
            # 一致部分は薄く残して、どこが変わったか位置が分かるようにする
            g=(r1+g1+b1)//3
            g=200+(g*55)//255
            out[i*3]=out[i*3+1]=out[i*3+2]=g
    if out: write_png(diff_out,wa,ha,bytes(out))
    return {'ok':diff==0,'reason':'','diff':diff,'total':n,
            'ratio':diff/n if n else 0.0,
            'bbox':None if x1<0 else (x0,y0,x1,y1)}

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('base');ap.add_argument('head')
    ap.add_argument('--out',default=None,help='差分画像の出力ディレクトリ')
    ap.add_argument('--tol',type=int,default=0,help='1チャンネルあたりの許容差')
    a=ap.parse_args()
    base=pathlib.Path(a.base);head=pathlib.Path(a.head)
    outdir=pathlib.Path(a.out) if a.out else None
    if outdir: outdir.mkdir(parents=True,exist_ok=True)
    names=sorted(p.name for p in base.glob('*.png'))
    if not names:
        print('基準画像がありません:',base);return 2
    ng=0;missing=0
    print(f'{"画面":38} {"判定":6} {"差分画素":>10} {"割合":>8}  変化した範囲')
    for nm in names:
        hp=head/nm
        if not hp.exists():
            print(f'{nm:38} {"欠落":6}');missing+=1;ng+=1;continue
        try:
            r=compare(base/nm,hp,a.tol,str(outdir/nm) if outdir else None)
        except Exception as e:
            print(f'{nm:38} {"エラー":6} {e}');ng+=1;continue
        if r['ok']:
            print(f'{nm:38} {"一致":6} {0:>10} {"0.000%":>8}')
        else:
            ng+=1
            if r['reason']:
                print(f'{nm:38} {"相違":6} {r["reason"]}')
            else:
                x0,y0,x1,y1=r['bbox']
                print(f'{nm:38} {"相違":6} {r["diff"]:>10} {r["ratio"]*100:7.3f}%  '
                      f'({x0},{y0})-({x1},{y1})')
    extra=[p.name for p in head.glob('*.png') if p.name not in names]
    print()
    print(f'  基準 {len(names)}枚 / 一致 {len(names)-ng}枚 / 相違 {ng-missing}枚 / 欠落 {missing}枚'
          + (f' / 基準に無い新規 {len(extra)}枚' if extra else ''))
    for e in extra: print('    新規:',e)
    return 0 if ng==0 else 1

if __name__=='__main__':
    sys.exit(main())
