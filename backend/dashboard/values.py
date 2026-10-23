"""values.py: 集計が値を読む小さな決まり（§9.628。LotScope の services/work_summary.py の一部）。

    num          … 数に読める値 → float（読めなければ None）。**一覧の並べ替え・絞り込みの`sort_order.num_of()`と同じ**（§9.581）
    start_column … 作業開始の列（選んだ列 → 既定の名前 → 「作業開始」を含む日付・日時の列）
    time_column  … 作業開始の時刻が別の列にあるときの列（〜日付 → 〜時刻・〜時間）
    work_key     … 1 作業の鍵（同じ作業開始の行は 1 作業＝1 ロット）
"""
from ..datetext import to_datetime
from ..sort_order import num_of

START_CANDIDATES=('BOX実績_作業開始_日付','作業開始日時','作業開始')
num=num_of


def start_column(cs,preferred=''):
 if preferred and preferred in cs:return preferred
 for c in START_CANDIDATES:
  if c in cs:return c
 return next((c for c in cs if '作業開始' in c and ('日付' in c or '日時' in c)),'')


def time_column(cs,start):
 if not start.endswith('日付'):return ''
 return next((start[:-2]+x for x in ('時刻','時間') if start[:-2]+x in cs),'')


def work_key(v,t=None):
 """日時と読めれば 'YYYY-MM-DD[ HH:MM:SS]'、読めなければ字（前後の空白を除く）、空なら ""（まとめない）。"""
 stamp=to_datetime(v,t)
 if stamp:return stamp
 raw='' if v is None else str(v).strip()
 return f"?{raw}|{'' if t is None else str(t).strip()}" if raw else ''
