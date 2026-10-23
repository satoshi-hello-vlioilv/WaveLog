"""shifts.py: 作業日（現場歴／太陽暦）と直（§9.628）。

決め方は作業スケジュールと同じ `schedule_calc.resolve_shift_info()` の1箇所（勤務体系マスタ・勤務区分マスタ・日付補正 §9.195）。
ここは集計のために、日時の字 → (作業日, 直の番号) を答える係（`Clock`）を設備ごとに作るだけ。
"""
from datetime import date, datetime, timedelta

from .. import schedule_calc as sc

OUTSIDE=-1     # どの直にも入らない時刻
NO_TIME=-2     # 時刻の無い値


class Clock:
 """勤務区分の行（`schedule_repo.shift_rows()`の形）→ 日時から（作業日, 直の番号）。segments は直の並び（名前・開始・終了）。"""

 def __init__(self,rows):
  self.rows=list(rows or [])
  self.segments=[{'name':str(r[2]),'start':str(r[3] or ''),'end':str(r[4] or '')} for r in self.rows]
  self._index={s['name']:i for i,s in enumerate(self.segments)}

 def place(self,stamp,basis='work'):
  """'YYYY-MM-DD[ HH:MM:SS]' → (日付 'YYYY-MM-DD', 直の番号か OUTSIDE／NO_TIME)。basis="work" は現場歴（日付補正を当てる）、
     "cal" は太陽暦（暦の日付のまま。直は同じ）。読めなければ ("", NO_TIME)。"""
  if not stamp:return '',NO_TIME
  day=stamp[:10]
  if len(stamp)<16:return day,NO_TIME
  if not self.rows:return day,OUTSIDE
  dt=datetime(int(day[:4]),int(day[5:7]),int(day[8:10]),int(stamp[11:13]),int(stamp[14:16]))
  name,off=sc.resolve_shift_info(self.rows,[],dt)
  if name is None:return day,OUTSIDE
  if off and basis=='work':day=(date.fromisoformat(day)+timedelta(days=off)).isoformat()
  return day,self._index.get(str(name),OUTSIDE)
