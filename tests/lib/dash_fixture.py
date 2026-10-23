"""tests/lib/dash_fixture.py: ダッシュボードの集計の網が使う試験用のデータ（§9.628。LotScope の tests/lotlist_fixture.py の作業実績・仕掛）。

乱数の種を固定して毎回同じ中身を作る。作業実績は設備ごとの SQLite（表「実績」・作業開始の日時・分割した作業は同じ作業開始の 2〜4 行）、
仕掛は 1 行 1 ロット（残仕掛設備ｺｰｽ の先頭が次の設備・空欄・知らない設備・全角のゆれ）。
"""
import random
import sqlite3
from datetime import date, datetime, timedelta

TODAY = date(2026, 10, 2)      # 「〜日以内」の基準日（問い合わせに today として渡す）
EQUIPMENT = ["L-1", "L-2", "TLV", "LS3", "DL2", "CR1", "ＣＲ２", "ﾛｰﾙ1"]
DEFECTS = ["汚れ", "キズ", "ロール跡", "異物", "ﾍｺﾐ", "打痕", "", None]
COLUMNS = ["ロット番号", "発生日", "設備", "不良名", "重量", "板厚", "板幅", "合金", "調質", "客先", "検査日", "入力日時",
           "数量", "備考", "工程", "担当", "長さ", "比重", "鋳造番号", "検査番号"]


def _date_text(d, kind):
    return [d.strftime("%Y/%m/%d"), d.isoformat() + " 10:00", d.strftime("%Y%m%d"), d.strftime("%y/%m/%d 23:48:54"),
            f"{d.year}年{d.month}月{d.day}日", "", None, "不明", f"{d.year}.{d.month}.{d.day}"][kind]


WORK_COLUMNS = ["ロット番号", "BOX実績_作業開始_日付", "作業日", "開始", "終了", "作業区分", "作業者", "入側板厚", "出側板厚", "板幅", "重量", "速度",
                "合金", "調質", "備考", "BOX実績_作業終了_日付"]


def make_work(path, equipment, n=400, seed=11):
    """作業実績の試験用データ（設備ごとの実績 SQLite。表「実績」）。本物の列は分からないので、画面を確かめるための作り物。
    BOX実績_作業開始_日付 は作業開始の日時（Access の日時の書き方: 2026/10/01 8:15:00）。4 回に 1 回ほどの作業は幅・丈で分割して、
    同じ作業開始の行が 2〜4 行（別のロット番号）になる（作業実績の「作業でまとめる」で 1 作業と数える）。"""
    r = random.Random(f"{seed}-{equipment}")
    c = sqlite3.connect(path)
    c.execute("DROP TABLE IF EXISTS 実績")
    c.execute("CREATE TABLE 実績 (" + ",".join(f"[{x}]" for x in WORK_COLUMNS) + ")")
    rows = []
    # 作業終了（版 3.46.0。ガントチャート・稼働率・換算係数）: 作業開始から、板厚と重量で決まる作業時間の後。乱数を使わない（ほかの列の値を変えない）
    def end_of(d, start, th, weight):
        t = datetime(d.year, d.month, d.day) + timedelta(minutes=start + round(12 + weight / 70 * (1 + 1 / th)))
        return f"{t:%Y/%m/%d} {t.hour}:{t.minute:02d}:00"
    while len(rows) < n:
        d = TODAY - timedelta(days=r.randint(0, 120))
        start = r.randint(0, 24 * 60 - 1)
        t0, t1 = f"{start // 60:02d}:{start % 60:02d}", f"{(start + 40) // 60 % 24:02d}:{(start + 40) % 60:02d}"
        stamp = f"{d:%Y/%m/%d} {start // 60}:{start % 60:02d}:00"
        th = r.choice([0.3, 0.5, 1.0, 2.0, 3.0])
        lot, kind, who = r.randint(1, 900), r.choice(["通常", "通常", "通常", "再処理", "試作"]), r.choice(["作業者A", "作業者B", "作業者C"])
        for k in range(r.choice([1, 1, 1, 2, 2, 3, 4]) if r.random() < 0.35 else 1):
            row = [f"L{lot:04d}C{(r.randint(0, 9) + k) % 10}", stamp, d.strftime("%Y/%m/%d"), t0, t1, kind, who, th,
                   round(th * r.uniform(0.5, 0.95), 3), r.randint(800, 1600), round(r.uniform(500, 6000), 1), r.randint(80, 600),
                   r.choice(["A1100", "A5052", "A3004"]), r.choice(["H14", "O", "H24"]), r.choice(["", "", "", "速度落とし", "ロール替え後", None])]
            rows.append(row + [end_of(d, start, th, row[10])])
    c.executemany("INSERT INTO 実績 VALUES (" + ",".join("?" * len(WORK_COLUMNS)) + ")", rows[:n])
    c.commit()
    c.close()


def make_work_box(path, equipment="ANF", seed=17, now=None):
    """焼鈍炉（BOX）の作業実績の試験用データ（版 3.47.0。ガント・換算係数の「出ない設備」を画面で撮るため。本物の列の名前に合わせた作り物）。
    1 回の作業（炉に入れて出すまで）が 20〜50 時間・1 回に 3〜6 ロット（作業開始が同じ）。作業開始_日付 は日時、作業終了_日付 は日付だけで、
    時刻まで持つのは 年月日時分秒 の列（14 桁）。2 回は作業終了の書き忘れ（空）・いちばん新しい作業は、いま炉の中（作業終了がまだ無い）。
    ほかの列はほかの設備と同じ（WORK_COLUMNS。計算列・ほかのパネルがその列を使う）"""
    r = random.Random(f"{seed}-{equipment}")
    now = now or datetime.combine(TODAY + timedelta(days=1), datetime.min.time()).replace(hour=10)
    cols = WORK_COLUMNS + ["BOX実績_作業開始_年月日時分秒", "BOX実績_作業終了_年月日時分秒"]      # ほかの設備と同じ列（計算列・ほかのパネルが使う）＋ 14 桁の列
    c = sqlite3.connect(path)
    c.execute("DROP TABLE IF EXISTS 実績")
    c.execute("CREATE TABLE 実績 (" + ",".join(f"[{x}]" for x in cols) + ")")
    rows, t, k, lot, forgot = [], now - timedelta(days=60), 0, 0, False
    while t < now:
        dur = timedelta(hours=r.randint(20, 50))
        miss = k == 7 or (not forgot and t.date() >= TODAY - timedelta(days=1))   # 7 回目と、前日ごろに入れた 1 回は書き忘れ。最後はいま炉の中
        forgot = forgot or miss and k != 7
        end = t + dur if t + dur < now and not miss else None
        alloy, temper = r.choice(["A1100", "A5052", "A3004", "A8079"]), r.choice(["O", "H24"])
        th, kind, who = r.choice([0.3, 0.5, 1.0]), r.choice(["通常", "通常", "再処理"]), r.choice(["作業者A", "作業者B"])     # 1 回の作業の中では同じ
        for _ in range(r.randint(3, 6)):
            lot += 1
            v = {"ロット番号": f"B{lot:05d}", "BOX実績_作業開始_日付": f"{t:%Y/%m/%d} {t.hour}:{t.minute:02d}:00", "作業日": f"{t:%Y/%m/%d}",
                 "開始": f"{t:%H:%M}", "終了": f"{end:%H:%M}" if end else "", "作業区分": kind, "作業者": who,
                 "入側板厚": th, "出側板厚": th, "板幅": r.randint(800, 1600), "重量": round(r.uniform(2000, 9000), 1), "速度": 0,
                 "合金": alloy, "調質": temper, "備考": "", "BOX実績_作業終了_日付": f"{end:%Y/%m/%d}" if end else "",
                 "BOX実績_作業開始_年月日時分秒": f"{t:%Y%m%d%H%M%S}", "BOX実績_作業終了_年月日時分秒": f"{end:%Y%m%d%H%M%S}" if end else ""}
            rows.append([v[x] for x in cols])
        t = t + dur + timedelta(minutes=r.randint(40, 180))
        k += 1
    c.executemany("INSERT INTO 実績 VALUES (" + ",".join("?" * len(cols)) + ")", rows)
    c.commit()
    c.close()


# 仕掛（WaveLog の仕掛 SIKALOTNOW と同じ 34 列の頭。本物は 200 列ほど）。残仕掛設備ｺｰｽ は「次の設備 その次 …」（空白区切り）で、
# 先頭が今その設備に仕掛かっている（WaveLog の作業可否と同じ決まり）。設備名は作業実績の試験用の設備と同じ
WIP_COLUMNS = ["ロット番号", "鋳造番号", "製造材質", "製造調質", "用途名", "BOX設計_設備名", "検査番号", "オーダー番号", "取引先", "納入先",
               "設計_設備ｺｰｽ", "実績_設備ｺｰｽ", "残仕掛設備ｺｰｽ", "ｺﾝﾏ5本ｶｰﾄﾞ区分"] + [f"親子管理_子カード{i}" for i in range(1, 11)] \
    + [f"コンマ5本分割_切断巾{i}" for i in range(1, 11)] + ["仕掛区分"]
# 仕掛区分（版 3.37.0。ダッシュボードの仕掛区分ごとの数。本物の列の名前・値は確かめていない作り物）。ほかの列の値を変えないよう、乱数ではなく行の番号で決める
WIP_CLASSES = ["生産", "生産", "生産", "保留", "検査待ち", "生産", "出荷待ち", "生産", "再処理", "保留", "生産"]
WIP_EQUIPMENT = ["CR1", "CR2", "L-1", "L-2", "TLV", "LS3", "DL2", "CAL", "ANF", "HOT", "SL1"]


def make_wip(path, n=1200, seed=5):
    """仕掛の試験用データ（表「仕掛」。1 行 1 ロット）。設備ごとの仕掛の数がばらつくように、先頭の設備は重みを付けて選ぶ。
    数行は残仕掛設備ｺｰｽ が空（もう流れ終わった）・知らない設備（XYZ）・全角（ＣＲ１）。"""
    r = random.Random(seed)
    c = sqlite3.connect(path)
    c.execute("DROP TABLE IF EXISTS 仕掛")
    c.execute("CREATE TABLE 仕掛 (" + ",".join(f"[{x}]" for x in WIP_COLUMNS) + ")")
    weights = [9, 4, 12, 6, 3, 8, 5, 2, 7, 1, 3]
    rows = []
    for i in range(n):
        route = r.sample(WIP_EQUIPMENT, r.randint(3, 6))
        k = r.randint(0, len(route) - 1)
        head = r.choices(WIP_EQUIPMENT, weights)[0]
        rest = [head] + [x for x in route[k + 1:] if x != head]
        course = " ".join(rest)
        if i % 97 == 0:
            course = ""
        elif i % 89 == 0:
            course = "XYZ " + course
        elif i % 83 == 0:
            course = course.replace("CR1", "ＣＲ１")
        rows.append([f"W{i + 1:05d}", f"C{r.randint(1, 999):03d}", r.choice(["A1100", "A5052", "A3004"]), r.choice(["H14", "O", "H24", "H34"]),
                     r.choice(["一般用材", "缶材", "箔地"]), route[0], f"K{i + 1:05d}", f"J{r.randint(1, 99)}", r.choice(["取引先A", "取引先B", "ﾄﾘﾋｷｻｷC"]),
                     r.choice(["納入先A", "納入先B"]), " ".join(route), " ".join(route[:k]), course, r.choice(["", "", "1", None])]
                    + [None] * 20 + [WIP_CLASSES[(i * 7 + i // 13) % len(WIP_CLASSES)]])
    c.executemany("INSERT INTO 仕掛 VALUES (" + ",".join("?" * len(WIP_COLUMNS)) + ")", rows)
    c.commit()
    c.close()
