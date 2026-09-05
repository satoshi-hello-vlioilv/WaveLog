"""textnorm.py: 名前の表記ゆれを吸収する（どの層からも読める最下層）。

**設備の同一判定はアプリ全体で1つ**（§9.239 ⑥）。以前はこの関数が
`repositories/master_repo.py` にあり、`db_access` は関数の中から遅延import
して呼んでいた——`master_repo` は `db_access` を読む側なので、頭でimportすると
輪になるためだった（§9.329）。判定そのものは2行の純粋な関数で、マスタも接続も
要らない。ここへ置けば誰でも頭からimportできる。

`master_repo` からは今までどおり `normalize_equipment_name` を読めるよう
再公開してある（既存の呼び出しを書き換えないため）。
"""
import unicodedata


def normalize_equipment_name(value):
 return unicodedata.normalize('NFKC',str(value or '')).strip().upper()
