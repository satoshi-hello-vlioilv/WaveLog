"""body.py: 画面から来るJSONの読み方を1つの型に（§9.330、REVIEW 3-3）。

`TableDef`（§9.324 R1）が「マスタ1表の列定義は1箇所」でやったことを、
**リクエスト本文**でやる。ルートは

    x = body({'name': str, 'enabled': flag, 'span': int, 'items': list})

と**受け取る鍵と型を先に宣言**し、あとは `x.name` / `x.span` で読む。

------------------------------------------------------------
なぜ要るか
------------------------------------------------------------
以前は 100 本のルートが `request.get_json(force=True) or {}` を書き写し、
そこから `str(x.get('name') or '').strip()` を **416 箇所**で手で組み立てて
いた。同じ変換が散っていると、

 * **送っていない（`None`）と、空で送った（`''`）が混ざる。**
   `x.get('k') or ''` は両方を `''` にするので、repo 側で「渡した鍵だけ書く」
   （§9.212 ②）を作っても**入口で潰れている**。設定が保存のたびに消える
   不具合が8度起きているのは、いつもこの形。
 * **綴りの間違いが黙って捨てられる。** `x.get('enabld')` は例外を出さず
   `None` を返すだけで、画面もサーバーも何も言わない。
 * 真偽の読み方（§9.324 R4）・数の読み方が、ルートごとに少しずつ違う。

------------------------------------------------------------
約束
------------------------------------------------------------
 * **`None` は「送っていない」。** 型変換しても `None` は `None` のまま。
   「送った鍵だけ」は `x.given()`、1つの鍵は `x.sent('k')` で見る。
 * **知らない鍵は既定では断らない。** 断るのは `strict=True` と書いた
   ルートだけ。理由は、**この画面は読んだ行をそのまま送り返す**から
   ——マスタ管理の汎用フォーム（`submitMaint`）は GET が返した1行を丸ごと
   POST するので、本文にはサーバーが計算して返した項目（`active`・
   `capability`・`loaded`・`plannedPath`…）が必ず混ざる。断る側を既定に
   すると**全部のマスタ画面が保存できなくなる**（実際に `test_dsrestart` が
   「知らない項目です: active、activeLabel、…」で落ちた）。
   だから `strict=True` は、**画面が用途ごとに組み立てて送る本文**
   （切断の`key`、掃除の`categories`…）にだけ付ける。
   なお strict のときも**「誰が・どの端末で」の鍵は通す**（`IDENTITY_KEYS`。
   `request_user_id`／`request_pc_name` が読むので、全部の spec へ
   書かせると 150 箇所の写しになる）。
 * **`Body` は辞書のように読める**（`x['k']` / `x.get('k')` / `'k' in x`）
   ——`request_user_id(x)` のように**辞書を受け取る既存の関数へそのまま
   渡せる**ことが、書き換えを1行に留める鍵。
 * **壊れたJSONの受け方は今までどおり**——`silent=False`（既定）は
   Flask が 400 を返し（`get_json(force=True)`）、`silent=True` は空として
   続ける（`get_json(silent=True) or {}`）。ここを揃えると、揃えた側の
   ルートの断り方が黙って変わる（§9.132）。

------------------------------------------------------------
型（spec の値）
------------------------------------------------------------
 `str`    文字。`str()` して前後の空白を落とす
 `int`    整数。数として読めなければ断る（空文字は `None`）
 `float`  実数。同上
 `flag`   入/切。呼び名（`無効`・`出さない`…）も読む（§9.324 R4）
 `list`   並び。並びでなければ断る
 `dict`   まとまり。まとまりでなければ断る
 `any`    そのまま（型を決めない・決められないもの）
"""
from flask import request

from ..flags import flag_of

# 型の印。`str`/`int`/`float`/`list`/`dict` は組み込みの型をそのまま使う
# （読む人が調べずに分かる）。組み込みに無い2つだけ名前を持つ。
flag = 'flag'
any_ = 'any'

# 「誰が・どの端末で」（§9.180）。`request_user_id`／`request_pc_name` が
# 本文から読むので、spec に書かれていなくても通す。
IDENTITY_KEYS = ('user_id', 'userId', 'updated_by', '更新者ID',
                 'pc_name', 'pcName', '端末名')


def _one(key, kind, v):
 """1つの値を型へ。**`None` は `None` のまま**（送っていない）。"""
 if v is None:
  return None
 if kind is str:
  return str(v).strip()
 if kind is int or kind is float:
  if isinstance(v, str) and not v.strip():
   return None
  try:
   return int(v) if kind is int else float(v)
  except (TypeError, ValueError):
   raise ValueError(f'{key} は数で指定してください（受け取った値: {v!r}）')
 if kind == flag:
  return flag_of(v)
 if kind is list:
  if not isinstance(v, list):
   raise ValueError(f'{key} は並びで指定してください（受け取った値: {type(v).__name__}）')
  return v
 if kind is dict:
  if not isinstance(v, dict):
   raise ValueError(f'{key} はまとまりで指定してください（受け取った値: {type(v).__name__}）')
  return v
 return v


class Body:
 """spec どおりに読んだ本文。辞書のようにも、属性でも読める。"""

 def __init__(self, spec, raw, strict=False):
  self.spec = dict(spec or {})
  self.raw = dict(raw or {})
  self.strict = strict
  if strict:
   unknown = [k for k in self.raw
              if k not in self.spec and k not in IDENTITY_KEYS]
   if unknown:
    raise ValueError('知らない項目です: ' + '、'.join(sorted(str(k) for k in unknown)))
  self._v = {}
  for k, kind in self.spec.items():
   self._v[k] = _one(k, kind, self.raw.get(k))

 # ---- 辞書として読む（既存の関数へそのまま渡せるように） ----
 def get(self, key, default=None):
  if key in self._v:
   v = self._v[key]
   return default if v is None else v
  v = self.raw.get(key)
  return default if v is None else v

 def __getitem__(self, key):
  return self.get(key)

 def __contains__(self, key):
  # **辞書と同じ「本文に在ったか」**（`in` を「値が空でない」に変えると、
  # 「送った鍵だけ書く」（§9.212 ②）の判定が空文字で崩れる）。
  return key in self.raw

 def __iter__(self):
  return iter(self.raw)

 def keys(self):
  return self.raw.keys()

 # ---- 宣言した鍵は属性でも読める ----
 def __getattr__(self, key):
  v = self.__dict__.get('_v')
  if v is not None and key in v:
   return v[key]
  raise AttributeError(f'{key} は spec に宣言されていません')

 # ---- 「送ったか」を見る ----
 def sent(self, key):
  """その鍵が本文に在ったか（値が空でも True）。"""
  return key in self.raw

 def given(self):
  """**送った鍵だけ**を型変換して返す（§9.212 ②の「渡した鍵だけ書く」）。"""
  return {k: self._v[k] for k in self.spec if k in self.raw}

 # ---- よく使う読み方 ----
 def text(self, key, default=''):
  """文字として。送っていなければ `default`。"""
  v = self.get(key)
  return default if v is None else str(v).strip()

 def num(self, key, default=None):
  v = self.get(key)
  return default if v is None else v

 def flag(self, key, default=False):
  v = self.get(key)
  return default if v is None else bool(v)

 def items_of(self, key):
  """並びとして。送っていなければ空の並び。"""
  v = self.get(key)
  return v if isinstance(v, list) else []


def body(spec, silent=False, strict=False):
 """いまのリクエストの本文を spec どおりに読む。

 `silent=False`（既定）は壊れたJSONで Flask が 400 を返す
 （`get_json(force=True)`）、`silent=True` は空として続ける。
 **どちらにするかは今までの書き方に合わせる**（§9.132）。

 `strict=True` は「知らない鍵を断る」——**画面が用途ごとに組み立てて送る
 本文**にだけ付ける（上の「約束」を読むこと）。"""
 raw = request.get_json(silent=True) if silent else request.get_json(force=True)
 return Body(spec, raw or {}, strict=strict)
