"""equip_match.py: 列の値 → 設備名（§9.628。LotScope の data_sources.EquipmentMatcher）。

データソースの行が「設備の列」と「設備の取り出し方」を持つ（`データソースマスタ`）。ダッシュボードの設備の段・設備で絞る・スライサーが読む。
    そのまま … 値そのもの（前後の空白を除く。知っている設備名と NFKC・大文字で同じなら、その書き方へそろえる）
    前方一致 … 値が設備名で始まる物（長い名前を先に当てる。CR と CR2 なら CR2）。仕掛の 残仕掛設備ｺｰｽ「CR1 L-1 LS3」の先頭が次の設備
どれにも当たらない値は、最初の空白までを設備名とみなす（名前の分からない設備も数から落とさない）。
"""
from ..textnorm import normalize_equipment_name as normalize_part

EQUIP_MODES=('そのまま','前方一致')


def _s(v):
 return ('' if v is None else str(v)).strip()


class EquipmentMatcher:
 def __init__(self,names,mode='そのまま'):
  self.mode=mode if mode in EQUIP_MODES else 'そのまま'
  seen,self.names=set(),[]
  for n in sorted((_s(x) for x in names or []),key=lambda x:-len(normalize_part(x))):
   k=normalize_part(n)
   if k and k not in seen:
    seen.add(k);self.names.append((k,n))
  self._cache={}

 def __call__(self,value):
  v=_s(value)
  if v in self._cache:return self._cache[v]
  out=v
  if self.mode=='前方一致' and v:
   k=normalize_part(v)
   hit=next((n for nk,n in self.names if k.startswith(nk)),None)
   out=hit if hit is not None else v.split()[0]
  elif v:
   k=normalize_part(v)
   out=next((n for nk,n in self.names if nk==k),v)
  self._cache[v]=out
  return out
