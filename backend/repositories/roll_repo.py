# -*- coding: utf-8 -*-
"""ロールマスタ(§9.239 ⑥): 設備ごとに持つロールの諸元。

利用者の指示:

  「モーダルにタブを追加し、欠陥を発見した際にピッチがある場合、ピッチを
   入力し、当設備の対象ロールを判定する機能を実装したいです。ロールマスタが
   必要になるので、ロールマスタは『設備／入出位置／接触面／ロール径MAX／
   ロール径MIN／ロール面長／材質／硬度／本数／ロール名／ロール使用条件／
   駆動方式／基準番号／備考』という種類だけカラムを持つものとする。
   設備のカラムはマスタに親子関係を持たせ、設備単位でロールマスタを持つ
   形とする。使うデータはこのカラムのうちロール径MAXを主とし、
   ロール径MINもデータがあるものはそれも計算に用いる。」

■ 「設備の親子関係」の持ち方 ＝ **1ロール1設備**
利用者の指示（訂正）:

  「同一ロール名でも全く違う設備の全く違うものとして管理しなければいけない
   ものも多いため厳密に設備を割ってから、個別にロール管理したいです。
   したがって設備の下に子としてロールマスタが複数ある形、1ロール1設備が
   正しいです。」

`[設備名]` は**ちょうど1つの登録済み設備名**。カンマ区切り（`'A,B'`）も
`'*'`（すべての設備）も**受け付けない**——1行が複数の設備を指せると、
「どの設備のロールか」が決まらず、同名で中身の違うロールを別物として
管理できなくなる（それがこの訂正の理由そのもの）。

**設備停止マスタの書式を借りないこと。** あちらは1行で複数の設備に効くのが
仕様で、こちらは正反対。`stop_equipment_matches()` を使い回すと `'*'` の行が
全設備に出てしまう。照合は正規化した**完全一致**（`_same_eq()`）。

自然キーは **(設備名, ロール名, 接触面, ロール径MAX, ロール径MIN, 備考)**
（`KEY_LABELS`／`roll_key()`）。設備が違えば同じ名前でも別の行で、互いに
何の関係も無い。画面（`master-maint.js` の `groupBy:'equipment'`）は
設備を親、ロールを子として束ねて出す。

鍵は2度広げてある——どちらも「現場に実在する行が登録できない／取り込むと
消える」という同じ形の報告からで、**先回りでは広げない**（§9.257 ③）:
  §9.246 ⑤ … 接触面（上／下／**上下**）
  §9.257 ③ … ロール径MAX・ロール径MIN・備考
    > 「ロールマスタについて、設備＆ロール名＆接触面だけでなく、ロール径と
    >  備考の内容も区別する情報に加えてください。」

**鍵に入れた列はExcelの往復で「直す」のではなく「増える」。** 径や備考を
書き直した行は、突き合わせで別の行になるので追加になる（古い行は残る）。
下見が「追加／上書き」で押す前に言い、`replace='file'`なら古い行は消える
——画面（`master-maint.js` のロールの`hint`と取り込みの説明）にもそう書く。
だから**言われていない列は入れない**（入出位置がその例）。

綴りは**設備マスタの表記へ寄せる**（`_canonical_eq()`）——全角/半角の
ゆれで「設備Ａ」と「設備A」が別の親になると、同じ設備の下にロールが2つの
束で並ぶ（画面の束ね方が黙って壊れる）。

■ 判定に使うのは径
欠陥が長手方向に一定のピッチで出るとき、そのピッチは**そのロールの周長**
（＝π×径）に一致する。径は摩耗で減るので、MAXとMINがあれば周長は
**範囲**になる。MINが空なら「MAXの1点」——**0で埋めないこと**
（§9.114／§9.231「引けなかったら None。0にすると何を打っても弾かれる欄に
なる」）。計算そのものは画面（`defect-locator.js`）が持つ——ここは
「何を保存するか」だけを決める。

■ 語彙はここだけが持つ
入出位置・接触面・駆動方式の選択肢は `ENTRY_POSITIONS` / `CONTACT_FACES` /
`DRIVE_KINDS` にあり、GETの戻りで画面へ渡す（§9.163。画面へ書き写すと
増やしたときに2箇所直すことになる）。**知らない値も保存できる**
（現場の呼び名は選択肢で塞げない）。
"""
from ..flags import flag_of, OFF_WORDS
from ..db_access import tables
from .table_def import TableDef
from ..quiet import quiet

TABLE = 'ロールマスタ'
# 設備停止マスタが「すべての設備」に使う印。**ロールでは受け付けない**が、
# 断るときと移行のときに名指しするので綴りをここに置く（§9.163）。
ALL_EQUIPMENTS = '*'

# 入出位置・接触面・駆動方式の呼び名。**選択肢で塞がない**（現場の呼び名は
# 事前に数え切れないので、ここに無い値も保存できる）。画面はこの一覧を
# サジェストとして出すだけ。
ENTRY_POSITIONS = ('入側', '出側', '中間', 'ルーパー', '巻取', '巻出')
# 接触面は **上 / 下 / 上下** が現場の呼び名（§9.246 ⑤、利用者の指示
# 「接触面は『上』『下』だけではなく、『上下』というものも存在する」）。
# ここは**サジェスト**なので、これに無い値（旧`上面`など）も今までどおり
# 保存でき、既に入っている行はそのまま残る。
CONTACT_FACES = ('上', '下', '上下', '端面', '非接触')
DRIVE_KINDS = ('駆動', '従動', 'フリー', 'ブレーキ')

# 列の並び（§9.324 R1）。**ここが唯一の定義**——CREATE・「無ければ足す」・
# SELECT・辞書化・UPDATE・INSERTの全部が`DEF`から作られる。**新しい列は末尾へ**。
COLUMNS = (
    ('設備名', 'TEXT'), ('入出位置', 'TEXT'), ('接触面', 'TEXT'),
    ('ロール径MAX', 'REAL'), ('ロール径MIN', 'REAL'), ('ロール面長', 'REAL'),
    ('材質', 'TEXT'), ('硬度', 'TEXT'), ('本数', 'INTEGER'), ('ロール名', 'TEXT'),
    ('ロール使用条件', 'TEXT'), ('駆動方式', 'TEXT'), ('基準番号', 'TEXT'),
    ('備考', 'TEXT'), ('表示順', 'INTEGER'), ('有効', 'INTEGER'),
)
DEF = TableDef(TABLE, 'ロールID', COLUMNS, order_by='[設備名],[表示順],[ロールID]')


def _num(v):
    """空欄は None のまま（**0にしない**）。数として読めない値も None。"""
    if v in (None, ''):
        return None
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    return n if n == n else None            # NaN を弾く


def _int(v):
    n = _num(v)
    return None if n is None else int(n)


# ---------------------------------------------------------------------------
# 設備の解決（§9.239 ⑥ 訂正: 1ロール1設備）
# ---------------------------------------------------------------------------
# **語彙はここだけが持つ**（§9.163）。画面もルートも「1つだけ」「登録済み」の
# 判定を書き写さない——2箇所に置くと、画面が通す値をサーバーが弾く（または
# その逆）という食い違いが必ず生まれる。

def _norm_eq(v):
    """設備名の表記ゆれを潰す。**判定にだけ使い、保存には使わない**
    （保存するのは設備マスタの綴りそのもの。`_canonical_eq()`）。"""
    from .master_repo import normalize_equipment_name
    return normalize_equipment_name(v)


def _same_eq(a, b):
    na = _norm_eq(a)
    return bool(na) and na == _norm_eq(b)


def _norm_face(v):
    """接触面の表記ゆれを潰す（判定にだけ使う。保存するのは打った文字）。

    設備名と同じ規則（全角/半角・前後の空白）へ寄せる——`上 `と`上`が
    別のロールになると、取り込みのたびに行が増える。"""
    from .master_repo import normalize_equipment_name
    return normalize_equipment_name(v)


def _norm_dia(v):
    """径を鍵に使うための正規化（§9.257 ③）。**空欄は None のまま**
    （`_num()`と同じ約束。0にすると「未記入」と「0mm」が同じ行になる）。

    浮動小数の見た目のゆれ（`300` と `300.0` と `300.000001`）で別の行に
    なると、書き出して取り込むだけで行が増える。**6桁で丸める**——
    ロール径は mm 単位の実測値なので、これで足りる。"""
    n = _num(v)
    return None if n is None else round(n, 6)


def _norm_note(v):
    """備考を鍵に使うための正規化（§9.257 ③）。

    **設備名・接触面のような全角/半角の寄せはしない**——備考は現場が書く
    自由な文なので、`ﾒﾓ`と`メモ`を同じものへ寄せると**書いた文字と違う行**に
    当たる。落とすのは前後の空白と改行コードのゆれ（`\r\n`／`\r`→`\n`）だけ
    ——Excelの往復でそこだけが変わるため。"""
    return str(v or '').replace('\r\n', '\n').replace('\r', '\n').strip()


# 自然キーの中身。**呼び名はここだけが持つ**（§9.163）——断り文句も
# 取り込みの説明も画面も、この一覧を見て文章を組み立てる。
KEY_LABELS = ('設備名', 'ロール名', '接触面', 'ロール径MAX', 'ロール径MIN', '備考')


def _key_desc(contact_face, dia_max=None, dia_min=None, note=None):
    """断り文句のための「その行の見分け方」（§9.257 ③）。

    **空欄は「未設定」と書く**——黙って省くと、径を入れていない行と
    入れている行の区別が文章から消える（§CLAUDE 6）。"""
    v = (_norm_face(contact_face), _norm_dia(dia_max), _norm_dia(dia_min),
         _norm_note(note))
    return '／'.join('%s %s' % (lab, '未設定' if x in (None, '') else _fmt_num(x))
                     for lab, x in zip(KEY_LABELS[2:], v))


def _fmt_num(v):
    """`300.0` を `300` と書く（文章の中の数字を実物の見た目にそろえる）。"""
    if isinstance(v, float) and v == int(v):
        return str(int(v))
    return str(v)


def roll_key(equipment, name, contact_face,
             dia_max=None, dia_min=None, note=None):
    """ロール1本を見分ける自然キー。

    ■ 接触面まで（§9.246 ⑤、利用者の指示）
    > 「ロールマスタの接触面は『上』『下』だけではなく、『上下』というものも
    >  存在するので、インポート時にデータ欠損させないように修正してください」

    §9.239 ⑥／§9.240 では **(設備名, ロール名)** の2つだけだった。ところが
    実データは**同じ設備の同じロール名が接触面ちがいで複数本**あり
    （上／下／上下）、取り込むと`roll_upsert()`が最初の1本を引き当てて
    **上書きし続け、最後の1行しか残らなかった**（画面からも2本目を
    「同じ設備に同じ名前のロールを2つ置けません」で登録できなかった）。

    ■ 径と備考まで（§9.257 ③、利用者の指示）
    > 「ロールマスタについて、設備＆ロール名＆接触面だけでなく、ロール径と
    >  備考の内容も区別する情報に加えてください。」

    現場には**同じ設備・同じ名前・同じ接触面で、径だけ／備考だけが違う**
    ロールが在る。接触面までで数えていたときと同じことがそこで起きていた
    ——登録は「2つ置けません」で断られ、取り込みは最初の1本を上書きし続ける。
    径は`ロール径MAX`／`ロール径MIN`の**両方**で1つの諸元（摩耗の範囲）なので、
    片方だけを鍵に入れない。

    **入出位置は今も入れない**（利用者が挙げていない）。鍵に入れた列は
    Excelの往復で「直す」のではなく「増える」ようになるので、**言われた列だけ**
    足す——先回りで広げると、いま在る行の同一性が理由なく変わる。

    **判定はここ1箇所**——`roll_upsert()`・`import_rows()`・
    `migrate_single_equipment()`が同じ関数を通すので、片方だけ直した状態が
    作れない。
    """
    return (_norm_eq(equipment), str(name or '').strip(), _norm_face(contact_face),
            _norm_dia(dia_max), _norm_dia(dia_min), _norm_note(note))


class RollIndex:
    """在るロールを自然キーで引く索引。**引き当ての規則はここだけが持つ**
    （§9.246 ⑤）。鍵の作り方（`roll_key()`）と「どの行に当てるか」は別の
    判断なので、それぞれ1箇所に置く。

    `rows` は `(ロールID, 設備名, ロール名, 接触面, 径MAX, 径MIN, 備考)` の並び。
    `roll_upsert()` は毎回DBから作り、`import_rows()` は下見の前に1回作って
    使い回す——**下見が数えたものと、保存で実際に起きることを同じ規則に
    決めさせる**（別々に持つと「追加1・上書き2」と言いながら1行しか
    残らない、が作れる。それが §9.246 ⑤ で直した不具合そのもの）。

    ■ 「言われていない」と「空欄」は違う（§9.257 ③）
    鍵が6つに増えたので、**引数の`None`は「その列を言われていない」**
    （Excelにその列が無い／セルが空＝触らない・§9.212 ②）という意味を持つ。
    空文字の接触面・`None`の径は「空欄という値」なので、鍵の中では
    そのまま1つの値として突き合わせる。

    段は3つで、上から順に見る:
      1. **言われた列がすべて一致**する行
      2. 1で0件なら、**相手の接触面が未記入の行**を「まだ分類していない同じ
         ロール」として拾う（行を増やさない）。**径と備考は拾わない**
         ——最初から在る列なので、空欄は「値」であって未分類ではない
         （`_FILL_BLANK_AT`）
      3. どちらでも2本以上残ったら`'ambiguous'`＝**どれを直すか決められない
         ので断る**（黙って1本を上書きしない・§CLAUDE 4）
    """

    def __init__(self, rows):
        self._loose, self._exact, self._keys = {}, {}, {}
        # **元の行をそのまま覚えておく**（§9.251）。完全入替は「ファイルの
        # どの行にも当たらなかった行」が消える範囲なので、**引き当てと同じ
        # 索引に数えさせる**のが唯一の正しい答え。別に数え直すと、下見が
        # 「消える3件」と言いながら5件消える、が作れる。
        self._rows, self._taken = [], set()
        for r in rows:
            rid, eq, nm, fc = r[0], r[1], r[2], r[3]
            dmax = r[4] if len(r) > 4 else None
            dmin = r[5] if len(r) > 5 else None
            note = r[6] if len(r) > 6 else None
            k = roll_key(eq, nm, fc, dmax, dmin, note)
            self._rows.append((rid, eq, nm, fc, dmax, dmin, note))
            self._keys[rid] = k
            self._exact.setdefault(k, rid)
            self._loose.setdefault(k[:2], []).append(rid)

    # 鍵のうち「言われたかどうか」を持つのは 接触面 以降（設備名とロール名は
    # 必ず言われる＝この索引の束ね方そのもの）。
    _TOLD_AT = (2, 3, 4, 5)
    # ---------- 未記入を「まだ分類していない」と読むのは接触面だけ ----------
    # （§9.257 ③）。この段は §9.246 ⑤ で**接触面の列を後から足した**ときに
    # 置いたもの——既に在る行はどれも接触面が空なので、書き出す→面を書き足す
    # →取り込む、といういちばんありそうな往復で行がちょうど二重になる。
    #
    # **径と備考へは広げないこと。** どちらも最初から在る列なので、空欄は
    # 「まだ分類していない」ではなく**「そう書いてある」という値**。広げると、
    # 備考の無いロールに「予備」と書いた行を取り込んだとき、**別のロールを
    # 足したつもりが元の行の書き換えになる**——利用者が「備考の内容も区別する
    # 情報に加えてください」と言ったことが、そこだけ効かなくなる
    # （実際に`tests/test_roll.js`が捕まえた）。
    _FILL_BLANK_AT = (2,)

    def _hits(self, k, told, fill_blank=False):
        """`told` の位置だけを突き合わせて、当たった行IDを返す。

        `fill_blank` は「相手が**接触面**を未記入なら当たったことにする」。"""
        out = []
        for rid in self._loose.get(k[:2]) or []:
            rk = self._keys.get(rid)
            if rk is None:
                continue
            ok = True
            for i in told:
                if rk[i] == k[i]:
                    continue
                if fill_blank and i in self._FILL_BLANK_AT and rk[i] in (None, ''):
                    continue
                ok = False
                break
            if ok:
                out.append(rid)
        return out

    def find(self, equipment, name, contact_face,
             dia_max=None, dia_min=None, note=None):
        """`(ロールID or None, 理由)` を返す。

        理由:
          `'exact'`     言われた列がすべて一致した
          `'blank'`     相手の接触面が未記入の行を「まだ分類していない同じ
                        ロール」と見て拾った。**行は増やさない**
          `'loose'`     接触面より後を1つも言われておらず、(設備, 名前) で
                        1本だけ当たった
          `'ambiguous'` 言われた範囲では1本に絞れない
                        ——**どれを直すか決められないので断る**（§CLAUDE 4）
          `None`        無い（＝追加）
        """
        raw = (equipment, name, contact_face, dia_max, dia_min, note)
        k = roll_key(*raw)
        if not (self._loose.get(k[:2]) or []):
            return (None, None)
        told = [i for i in self._TOLD_AT if raw[i] is not None]
        for fill in (False, True):
            hits = self._hits(k, told, fill_blank=fill)
            if len(hits) == 1:
                return (hits[0], ('exact' if told else 'loose') if not fill else 'blank')
            if len(hits) > 1:
                return (None, 'ambiguous')
        return (None, None)

    def same(self, equipment, name, contact_face,
             dia_max=None, dia_min=None, note=None):
        """**6つとも同じ行**のIDだけを返す（無ければ None）。

        `find()`の段（未記入を拾う・絞り切れなければ断る）は「どの行を直すか」
        の判断で、こちらは「もう同じ行が在るか」の判断——**別の問い**なので
        分けてある。混ぜると、備考が空の別の行を拾って
        「同じロールが登録済みです」と**在りもしない重複で断る**。"""
        return self._exact.get(roll_key(equipment, name, contact_face,
                                        dia_max, dia_min, note))

    def take(self, equipment, name, contact_face,
             dia_max=None, dia_min=None, note=None):
        """`find()` と同じ規則で引き、**拾った行を使い済みにする**。

        未記入の行は1本しか無いので、2行目も「上書き」と数えると下見の
        「追加 N件」が実際と食い違う（下見の意味が無くなる）。
        """
        rid, why = self.find(equipment, name, contact_face, dia_max, dia_min, note)
        if rid is None:
            return (rid, why)
        self._taken.add(rid)
        # 拾った行は**この呼び出しで書かれる値**を持つことになるので、鍵を
        # 書き換える。言われていない列は今の値のまま（`roll_upsert()`の
        # `keep()`と同じ約束）。
        old = self._keys.get(rid) or roll_key(equipment, name, contact_face)
        raw = (equipment, name, contact_face, dia_max, dia_min, note)
        new = roll_key(*raw)
        k = tuple(new[i] if (i < 2 or raw[i] is not None) else old[i]
                  for i in range(len(new)))
        if self._exact.get(old) == rid:
            self._exact.pop(old, None)
        self._keys[rid] = k
        self._exact[k] = rid
        return (rid, why)

    def rest(self):
        """**どの行にも当たらなかった行**を `(ロールID, 設備名, ロール名,
        接触面, 径MAX, 径MIN, 備考)` で返す（§9.251）。完全入替で消える
        候補そのもの。

        `find()` は数えない——数えると、下見のあとに保存で引き直したときに
        「もう当たっている」ことになって消える範囲が変わる。数えるのは
        `take()`（＝実際にその行を使った）だけ。"""
        return [x for x in self._rows if x[0] not in self._taken]


def _split_eq(raw):
    """カンマ区切り（全角読点も）を分解する。**移行と、断るときの説明にだけ**
    使う——通常の保存経路はそもそも複数を受け付けない。"""
    return [x.strip() for x in str(raw or '').replace('、', ',').split(',') if x.strip()]


def _canonical_eq(c, raw):
    """ちょうど1つの**登録済み**設備名へ解決する（§9.239 ⑥ 訂正）。

    **断る理由を名指しで返す**（§CLAUDE 4／§6）——「保存できません」だけでは
    設備を消したのか綴りが違うのか複数書いたのかが分からない。

    戻すのは**設備マスタの綴り**。打った文字をそのまま保存すると、全角/半角の
    ゆれで同じ設備が2つの親として並ぶ（画面の束ねが黙って壊れる）。"""
    from .master_repo import equipment_master_rows
    raw = str(raw or '').strip()
    if not raw:
        raise ValueError('設備を選んでください。ロールは設備ごとに管理します'
                         '（同じロール名でも設備が違えば別のロールです）。')
    # **全角の ＊ も同じ意味に読む**（NFKCで寄せてから見る）。素の比較だと
    # `＊` が「設備マスタに無い名前」として別の断り方になり、同じ操作なのに
    # 説明が変わる。
    if _norm_eq(raw) == ALL_EQUIPMENTS:
        raise ValueError('「すべての設備」は指定できません。ロールは設備ごとに'
                         '実物が違うので、設備を1つだけ選んでください。')
    parts = _split_eq(raw)
    if len(parts) > 1:
        raise ValueError(f'設備は1つだけ選んでください（「{raw}」のように複数は'
                         f'指定できません）。同じロールが複数の設備にあるときは、'
                         f'設備ごとに1本ずつ登録してください。')
    want = parts[0]
    known = [str(r[1] or '').strip() for r in equipment_master_rows(c)]
    for name in known:
        if _same_eq(name, want):
            return name                       # 設備マスタの綴りへ寄せる
    if not known:
        raise ValueError('設備マスタに1件も登録がありません。先に「設備」タブで'
                         '設備を登録してから、そのロールを足してください。')
    raise ValueError(f'設備マスタに「{want}」がありません。先に「設備」タブで'
                     f'登録するか、登録済みの設備から選んでください。')


def ensure_table(c):
    if TABLE not in tables(c):
        DEF.create(c)                      # 列は`DEF`の1つの定義から（§9.324 R1）
        return True
    # 既存DBへの追加は他マスタと同じ「無ければ足す」方式。**足すのは
    # `add_missing_columns()`の1箇所**（§9.315。同時に走っても壊れない。
    # 監査列も`DEF`が一緒に見る）。
    DEF.add_missing(c)
    _migrate_once(c)
    return False


# 移行はプロセスに1回だけ試す。目印はDBに残る（他の端末・次の起動のため）が、
# **毎回パス設定マスタを読みに行かない**——`ensure_table()`はどの入口からも
# 通るので、1リクエストで何度も呼ばれる。
_migrated_this_process = False


def _migrate_once(c):
    global _migrated_this_process
    if _migrated_this_process:
        return
    _migrated_this_process = True
    try:
        migrate_single_equipment(c)
    except Exception as _e:
        # **移行に失敗してもロールマスタは開けること**（fail-open）。
        # 割れなかった行は「設備なし」として画面に出るので、気づいて直せる。
        quiet('1度きりの移行を試せない（次に開いたときに試す）',_e)


def _row(d):
    """`DEF.fetch()`の1行（列名→値）を画面の形へ。**位置では読まない**（§9.324 R1）。"""
    return {'id': d['ロールID'],
            'equipment': str(d['設備名'] or '').strip(),
            'entryPos': str(d['入出位置'] or '').strip(),
            'contactFace': str(d['接触面'] or '').strip(),
            'diaMax': _num(d['ロール径MAX']), 'diaMin': _num(d['ロール径MIN']),
            'faceLen': _num(d['ロール面長']),
            'material': str(d['材質'] or '').strip(),
            'hardness': str(d['硬度'] or '').strip(),
            'count': _int(d['本数']),
            'name': str(d['ロール名'] or '').strip(),
            'useCond': str(d['ロール使用条件'] or '').strip(),
            'driveKind': str(d['駆動方式'] or '').strip(),
            'refNo': str(d['基準番号'] or '').strip(),
            'note': str(d['備考'] or ''),
            'order': d['表示順'],
            # [有効] が NULL の行は**有効**として扱う（列を足したときに
            # 既存の行が勝手に消えないように。他マスタと同じ約束）。
            'enabled': True if d['有効'] is None else bool(d['有効'])}


def roll_rows(c, include_disabled=False):
    ensure_table(c)
    out = []
    for d in DEF.fetch(c):
        x = _row(d)
        if not x['enabled'] and not include_disabled:
            continue
        out.append(x)
    return out


def rolls_for_equipment(c, equipment, include_disabled=False):
    """**その設備のロールだけ**（1ロール1設備。§9.239 ⑥ 訂正）。

    照合は正規化した完全一致で、**設備停止マスタの `stop_equipment_matches()`
    を借りないこと**——あちらは `'*'` を「すべての設備」として通すので、
    1本のロールが全設備の判定に混ざる。ロールは設備ごとに実物が違うので、
    混ざった瞬間に「当設備の対象ロールを判定する」という機能の意味が消える。

    **設備が空なら1本も返さない**（全部返す方が親切に見えるが、他の設備の
    ロールを候補に出すのはこの機能では嘘になる）。"""
    eq = str(equipment or '').strip()
    if not eq:
        return []
    return [x for x in roll_rows(c, include_disabled) if _same_eq(x['equipment'], eq)]


def roll_upsert(c, uid, equipment=None, name=None, entry_pos=None, contact_face=None,
                dia_max=None, dia_min=None, face_len=None, material=None, hardness=None,
                count=None, use_cond=None, drive_kind=None, ref_no=None, note=None,
                order=None, enabled=None, roll_id=None):
    """1行を書く。**渡していない項目は今の値をそのまま残す**（§9.212 ②）。

    全置換にすると、呼ぶ側が1項目でも渡し忘れたときにその設定だけが黙って
    消える（計算式・並べ替え・幅固定で3回起きている形）。"""
    ensure_table(c)
    name = str(name or '').strip() if name is not None else None
    cur = c.cursor()
    # **在るロールの索引は1回だけ作って使い回す**（§9.246 ⑤）。前段の
    # 引き当てと後段の重複判定が**同じ写し**を見ることが要点——別々に
    # SELECTすると、同じ行が2度目で別扱いになりうる。
    cur.execute(f'SELECT [ロールID],[設備名],[ロール名],[接触面],'
                f'[ロール径MAX],[ロール径MIN],[備考] FROM [{TABLE}]')
    index = RollIndex(cur.fetchall())
    prev = None
    if roll_id is not None:
        prev = DEF.get(c, roll_id)
        if prev is None:
            raise ValueError('更新対象のロールが見つかりません。')
    # **自然キーで引き当てるのは`prev`を読む前**（§9.240 の追補）。
    # 以前はここが値を組み立てた**あと**に在ったため、IDを渡さない経路
    # （Excelの取り込み・登録API）では`prev`が`None`のままで`keep()`が効かず、
    # **送っていない列がNULLで上書きされた**（入出位置が消えた。
    # `tests/test_rollio.py`が捕まえた）。「渡していない項目は今の値を残す」
    # はIDを渡したときだけの約束ではない。
    if prev is None and roll_id is None and name and equipment is not None:
        want_eq = _norm_eq(equipment)
        if want_eq:
            # **接触面まで見て引き当てる**（§9.246 ⑤）。ここが(設備,名前)だけ
            # だったため、接触面ちがいの同名ロール（上／下／上下）を取り込むと
            # **同じ行を上書きし続け、最後の1行しか残らなかった**。
            #
            # **引き当ての規則は`RollIndex`の1箇所**。ここへインラインで
            # 比較を書くと、同じ規則が`import_rows()`にも要る＝2箇所になる。
            hit, why = index.find(equipment, name, contact_face,
                                  dia_max, dia_min, note)
            if why == 'ambiguous':
                # 言われた範囲では1本に絞れない。**黙ってどれかを上書き
                # しない**（§CLAUDE 4）——それが §9.246 ⑤ で直した欠損。
                # **何を足せば絞れるかを言う**（§CLAUDE 6）。
                raise ValueError('%s の「%s」は %s のどれかが違う行が複数'
                                 '登録されています。どれを直すか決められないので、'
                                 'そこまで指定してください。'
                                 % (equipment, name, '・'.join(KEY_LABELS[2:])))
            roll_id = hit
            if roll_id is not None:
                prev = DEF.get(c, roll_id)
    keep = lambda col, v: (prev.get(col) if (v is None and prev is not None) else v)

    # 設備は**ちょうど1つの登録済み設備**（§9.239 ⑥ 訂正）。
    # **触っていないときは確かめ直さない**——設備マスタからその設備が消えた
    # あとでも、そのロールの備考や径は直せるべき（確かめ直すと、消えた設備の
    # ロールが編集も削除もできない行として残る＝§CLAUDE 4）。
    eq = str(equipment or '').strip() if equipment is not None else None
    if prev is None:
        eq = _canonical_eq(c, eq)
        if not name:
            raise ValueError('ロール名を入力してください。')
    else:
        if eq is None or _same_eq(eq, prev.get('設備名')):
            eq = keep('設備名', None)          # 設備は触っていない＝そのまま
        else:
            eq = _canonical_eq(c, eq)          # 付け替えたときだけ確かめる
        name = keep('ロール名', name)
        if not str(name or '').strip():
            raise ValueError('ロール名を入力してください。')

    dmax = _num(dia_max) if dia_max is not None else None
    dmin = _num(dia_min) if dia_min is not None else None
    dmax = keep('ロール径MAX', dmax)
    dmin = keep('ロール径MIN', dmin)
    # **入れ替えない。断る。** どちらが正か決められないので、黙って直すと
    # 「入れた値と違う値が保存されている」になる（§4／§6）。
    if dmax is not None and dmin is not None and dmin > dmax:
        raise ValueError('ロール径MINがMAXより大きくなっています。値を確かめてください。')

    vals = {
        '設備名': eq,
        '入出位置': keep('入出位置', None if entry_pos is None else str(entry_pos).strip()),
        '接触面': keep('接触面', None if contact_face is None else str(contact_face).strip()),
        'ロール径MAX': dmax,
        'ロール径MIN': dmin,
        'ロール面長': keep('ロール面長', _num(face_len) if face_len is not None else None),
        '材質': keep('材質', None if material is None else str(material).strip()),
        '硬度': keep('硬度', None if hardness is None else str(hardness).strip()),
        '本数': keep('本数', _int(count) if count is not None else None),
        'ロール名': name,
        'ロール使用条件': keep('ロール使用条件', None if use_cond is None else str(use_cond).strip()),
        '駆動方式': keep('駆動方式', None if drive_kind is None else str(drive_kind).strip()),
        '基準番号': keep('基準番号', None if ref_no is None else str(ref_no).strip()),
        '備考': keep('備考', None if note is None else str(note)),
        '表示順': keep('表示順', _int(order) if order is not None else None),
        '有効': keep('有効', None if enabled is None else (-1 if enabled else 0)),
    }
    if vals['有効'] is None:
        vals['有効'] = -1

    # 自然キーは **(設備名, ロール名)**（§9.239 ⑥ 訂正）。同じ設備に同じ
    # 名前のロールを2本置かない——どちらの径が効くのか決められなくなる
    # （§9.113）。**逆に、設備が違えば同じ名前でも別の行**にする。
    # それがこの訂正の要件そのものなので、ロール名だけで探さないこと。
    # 照合は**正規化つき**——移行で入った行は綴りが設備マスタと
    # 揃っていないことがあり、素の`=`だと同じ設備に2本できる。
    #
    # **更新のときも見ること。** 以前は新規のときしか照合しておらず、
    # 既存の行の設備や名前を**既に在る組み合わせへ書き換えられた**
    # （画面からは「保存できた」ように見えて、次に開くと同じ設備に同名が
    # 2本並ぶ。ピッチ判定に同じロールが別々の径で二重に出る）。
    # **接触面まで含めて1本**（§9.246 ⑤）。ここが(設備,名前)だけだったため、
    # 現場にある「同じロール名の上／下／上下」を**登録すらできなかった**。
    face_now = vals['接触面']
    # **「もう同じ行が在るか」は6つとも見る**（§9.257 ③）。`find()`の段
    # （未記入を拾う・絞り切れなければ断る）は「どの行を直すか」の判断なので、
    # ここで使うと備考が空の別の行を拾って**在りもしない重複で断る**。
    hit_id = index.same(eq, name, face_now,
                        vals['ロール径MAX'], vals['ロール径MIN'], vals['備考'])
    if prev is None:
        if hit_id is not None:
            roll_id = hit_id          # 同じ組み合わせ＝上書き（取り込みもここを通る）
    elif hit_id is not None and hit_id != roll_id:
        # **断る理由に「何が同じだから断るのか」を出す**（§CLAUDE 6）——
        # 「同じ名前」だけだと、どれかを変えれば置けることに気づけない。
        raise ValueError('「%s」（%s）は %s に登録済みです。同じ設備に'
                         '%s がすべて同じロールを2つ置けません'
                         '（どちらの径で判定するか決まりません）。'
                         '別のロールなら、接触面・ロール径・備考のどれかを'
                         '分けてください。'
                         % (name, _key_desc(face_now, vals['ロール径MAX'],
                                            vals['ロール径MIN'], vals['備考']),
                            eq, '・'.join(KEY_LABELS)))
    if roll_id is None:
        return DEF.insert(c, vals, uid)
    DEF.update(c, roll_id, vals, uid)
    return roll_id


def roll_delete(c, roll_id, uid=''):
    ensure_table(c)
    cur = c.cursor()
    cur.execute(f'DELETE FROM [{TABLE}] WHERE [ロールID]=?', [roll_id])
    n = cur.rowcount
    c.commit()
    return n


# ---------------------------------------------------------------------------
# まとめて消す（§9.251、利用者の指示「ロールマスタの全削除機能
# （ロールマスタの完全入替機能）を実装してください」）
# ---------------------------------------------------------------------------
# ここまでのロールマスタは**行を消すのは1件ずつ**だけだった（取り込みも
# 「足す・上書きするが消さない」・§9.240）。設備のロールを丸ごと入れ替える
# ——古い一覧を捨てて、いま持っているExcelの内容そのものにする——という
# 現場の作業がそれでは何十回の削除になる。
#
# **範囲は「すべて」か「設備を1つ」の2つだけ**（§9.239 ⑥「1ロール1設備」）。
# ロールは設備の子なので、この2つで現場の言う「全削除」は言い切れる。
# **既定を持たせないこと**——「消す」に既定の範囲があると、押し間違いが
# そのまま全消しになる（画面はどちらも選ばれていない状態から始める）。
DELETE_SCOPES = ('all', 'equipment')
# 下見・確認で名前を挙げる件数。**全部は挙げない**（数百行を並べても読めない）
# が、**挙げなかった件数は必ず言う**（§CLAUDE 4。「ほか N件」）。
NAME_SAMPLE = 30


def _delete_ids(c, ids):
    """IDの並びをまとめて消す。**SQLの変数の上限があるので刻んで投げる**
    （SQLiteの既定は999。数百本のロールで普通に超える）。"""
    cur = c.cursor()
    n = 0
    ids = [x for x in ids]
    for i in range(0, len(ids), 400):
        part = ids[i:i + 400]
        marks = ','.join('?' * len(part))
        cur.execute(f'DELETE FROM [{TABLE}] WHERE [ロールID] IN ({marks})', part)
        n += cur.rowcount if cur.rowcount and cur.rowcount > 0 else 0
    c.commit()
    return n


def _count_by_equipment(rows):
    """設備ごとの件数。**出てくる順を保つ**（`equipments()`と同じ並びで
    画面に出したいので、名前で並べ直さない）。設備が空の行も落とさない
    ——隠すと直す手立てごと消える（§CLAUDE 4）。"""
    out, seen = [], {}
    for x in rows:
        eq = str(x.get('equipment') or '')
        if eq not in seen:
            seen[eq] = len(out)
            out.append({'equipment': eq, 'count': 0})
        out[seen[eq]]['count'] += 1
    return out


def delete_plan(c, scope='', equipment=None):
    """まとめて消す範囲を決めて数える（§9.251）。**消す側もここを通る**
    ——下見と実際に消えるものを別々に決めさせない（§9.240 の`RollIndex`と
    同じ理由。「12件消えます」と言って15件消えるのが最悪の壊れ方）。

    `scope='equipment'` の `equipment` は**空文字も意味を持つ**（＝設備の
    入っていない行。移行し損ねた古い行がそれで、画面では「設備なし」として
    出ている）。だから「選んでいない」は `None` で表す——空文字を
    「選んでいない」と読むと、設備なしの行を名指しで消せなくなる。"""
    ensure_table(c)
    scope = str(scope or '').strip()
    if scope not in DELETE_SCOPES:
        raise ValueError('消す範囲を選んでください（「すべての設備」か、'
                         '設備を1つ選ぶかのどちらかです）。')
    rows = roll_rows(c, True)
    if scope == 'all':
        hit, label = list(rows), 'すべての設備'
    else:
        if equipment is None:
            raise ValueError('どの設備のロールを消すのかを選んでください。')
        want = _norm_eq(equipment)
        hit = [x for x in rows if _norm_eq(x.get('equipment')) == want]
        label = str(equipment or '').strip() or '設備の入っていない行'
    names = ['%s／%s%s' % (x.get('equipment') or '（設備なし）', x.get('name') or '',
                          ('（%s）' % x['contactFace']) if x.get('contactFace') else '')
             for x in hit[:NAME_SAMPLE]]
    return {'scope': scope,
            'equipment': ('' if scope == 'all' else str(equipment or '')),
            'label': label, 'count': len(hit), 'total': len(rows),
            'byEquipment': _count_by_equipment(rows),
            'names': names, 'more': max(0, len(hit) - len(names)),
            'ids': [x['id'] for x in hit]}


def delete_all(c, uid='', scope='', equipment=None, dry_run=True):
    """範囲を決めてまとめて消す。**既定は下見**（§9.193／§9.240）——
    取り消せない操作なので、書き込む前に「何件・どの設備が消えるか」を返す。

    **`byEquipment`は範囲に関わらず全体の内訳**を返す（画面はこれで
    「どの設備を選べるか」を組み立てる。設備の一覧を画面が別に数えると、
    削除の範囲と選択肢が別々の数え方になる）。"""
    plan = delete_plan(c, scope, equipment)
    ids = plan.pop('ids')
    plan['dryRun'] = bool(dry_run)
    if dry_run:
        return plan
    plan['deleted'] = _delete_ids(c, ids) if ids else 0
    return plan


def equipments(c):
    """ロールが登録されている設備名。画面の束ね方（親）の材料。

    **`'*'` は出てこない**（1ロール1設備なので存在しない）。設備が空の行は
    移行し損ねた古い行なので、**黙って隠さず** `''` のまま返して画面に
    「設備なし」として見せる——隠すと直す手立てごと消える（§CLAUDE 4）。"""
    seen = []
    for x in roll_rows(c, True):
        eq = x['equipment']
        if eq not in seen:
            seen.append(eq)
    return seen


# ---------------------------------------------------------------------------
# 多設備で保存された行を1設備ずつへ割る（§9.239 ⑥ 訂正の移行）
# ---------------------------------------------------------------------------
MIGRATE_KEY = '__roll_single_equipment_split__'
# 保留にした行の備考へ残す一言。**なぜ止まっているか・何をすれば直るか**を
# 書く（§CLAUDE 4／§6）。「移行しました」だけでは打つ手が分からない。
MIGRATE_NOTE = ('【移行】以前は「すべての設備」でしたが、ロールは設備ごとに'
                '1本ずつ持つ形に変わりました。設備を選び直してから'
                '「有効」に戻してください。')


def migrate_single_equipment(c, uid='migrate:roll'):
    """`'A,B'` / `'*'` の行を、1ロール1設備の形へ直す（§9.239 ⑥ 訂正）。

    **1度だけ**走らせる（目印はパス設定マスタ。§9.232 の
    `seed_mother_builtins` と同じ作法）——「多設備の行があれば直す」を毎回
    やる作りにすると、利用者が意図して直した綴りを繰り返し書き換える。

    ■ `'A,B'`（設備を名指ししたカンマ区切り）は**割る**
    利用者が設備を名指ししている以上、設備ごとの1行へ展開するのは解釈では
    なく忠実な読み替え。1本目は元の行を書き換え、2本目以降は複製する
    （消してから作り直すと、途中で落ちたときにロールが丸ごと消える）。
    **割った先に同じ (設備名, ロール名) が既に在れば作らない**——作ると
    同じ設備に同名が2本並び、ピッチ判定に同じロールが別々の径で二重に出る
    （§9.113 を移行そのものが破る）。

    ■ `'*'`（すべての設備）は**展開しない**
    設備マスタの全設備へコピーすると、利用者が一度も入力していない径・材質を
    **N台ぶんの現物の諸元として**書き込むことになる（ロールは特定の機械に
    付いている物なので、コピーは事実の捏造）。しかも移行後に増えた設備には
    付かないので、結局あとから手で足すことになる。
    かといって `'*'` のまま残すと、新しい照合ではどの設備にも当たらず
    **異常位置判定から黙って消える**（§CLAUDE 4）。
    だから**設備を空にし、無効にし、理由を備考へ残す**——「設備が未設定」の
    群として一覧に見えたまま止まるので、利用者が設備を選び直せる。

    **直し切れないうちは目印を書かない。** 戻り値は
    (割った元の行数, 作った行数, 保留にした行数, 衝突で飛ばした行数)。"""
    from ..db_access import path_config_rows, set_path_config
    try:
        if path_config_rows(c).get(MIGRATE_KEY):
            return (0, 0, 0, 0)
    except Exception as _e:
        quiet('移行済みの目印を読めない（もう一度移行を試す）',_e)
    cur = c.cursor()
    cur.execute(f'SELECT [ロールID],[設備名],[ロール名],[接触面],'
                f'[ロール径MAX],[ロール径MIN],[備考] FROM [{TABLE}]')
    rows = cur.fetchall()
    # いま在る自然キー。割った先の衝突を見るのに使う。**鍵の作り方を
    # 2種類残さない**（§9.246 ⑤／§9.257 ③）——`roll_key()`の1箇所を通す。
    seen = {roll_key(e, n, f, x, y, nt) for _i, e, n, f, x, y, nt in rows}
    split_from = made = held = clash = 0
    for rid, raw, rname, rface, rmax, rmin, rnote in rows:
        raw = str(raw or '').strip()
        rname = str(rname or '').strip()
        if _norm_eq(raw) == ALL_EQUIPMENTS:
            cur.execute(
                f'UPDATE [{TABLE}] SET [設備名]=?,[有効]=0,'
                f'[備考]=?,[更新者ID]=?,[更新日時]=Now() WHERE [ロールID]=?',
                ['', (MIGRATE_NOTE + '\n' + _note_of(cur, rid)).strip(), uid, rid])
            held += 1
            continue
        targets = _split_eq(raw)
        if len(targets) <= 1:
            continue              # 既に1設備（または空）＝触らない
        base = DEF.get(c, rid)
        if base is None:
            continue
        cur.execute(f'UPDATE [{TABLE}] SET [設備名]=?,[更新者ID]=?,[更新日時]=Now() '
                    f'WHERE [ロールID]=?', [targets[0], uid, rid])
        seen.discard(roll_key(raw, rname, rface, rmax, rmin, rnote))
        seen.add(roll_key(targets[0], rname, rface, rmax, rmin, rnote))
        split_from += 1
        for eq in targets[1:]:
            key = roll_key(eq, rname, rface, rmax, rmin, rnote)
            if key in seen:
                clash += 1        # その設備には同名が既に在る＝作らない
                continue
            vals = {k: v for k, v in base.items() if k != 'ロールID'}
            vals['設備名'] = eq
            vals['更新者ID'] = uid
            keys = ','.join(f'[{k}]' for k in vals)
            marks = ','.join('?' for _ in vals)
            cur.execute(f'INSERT INTO [{TABLE}] ({keys}) VALUES ({marks})',
                        list(vals.values()))
            seen.add(key)
            made += 1
    # 割り残しが無くなってから目印を書く（`'*'` は保留にした時点で片付いている）。
    left = 0
    cur.execute(f'SELECT [設備名] FROM [{TABLE}]')
    for (raw,) in cur.fetchall():
        raw = str(raw or '').strip()
        if _norm_eq(raw) == ALL_EQUIPMENTS or len(_split_eq(raw)) > 1:
            left += 1
    c.commit()
    if not left:
        try:
            set_path_config(c, MIGRATE_KEY, 'done', uid)
        except Exception as _e:
            quiet('移行済みの目印を書けない（次にもう一度試す）',_e)
    return (split_from, made, held, clash)


def _note_of(cur, rid):
    cur.execute(f'SELECT [備考] FROM [{TABLE}] WHERE [ロールID]=?', [rid])
    hit = cur.fetchone()
    return str((hit[0] if hit else '') or '')


# ---------------------------------------------------------------------------
# Excel の持ち出し・取り込み（§9.240、利用者の指示）
# ---------------------------------------------------------------------------
# 「ロールマスタについて EXCELでのインポート＆エクスポート機能を実装して
#  ください。」
#
# **列の並びと見出しはここ1つが持つ**（§9.163）。画面にもテストにも
# 書き写さない——書き写すと、列を1本足したときに書き出しと取り込みで
# 食い違う（見出しで突き合わせているので、片方だけ直すと黙って空になる）。
#
# **突き合わせは自然キー (設備名, ロール名)**（§9.239 ⑥ 訂正）。同じ設備に
# 同じ名前があれば上書き、無ければ追加。**IDの列は持ち出さない**——IDは
# 端末ごとの連番なので、別のPCで取り込むと無関係な行を書き換える（§9.171
# 「印はIDでなく名前で運ぶ」と同じ理由）。
IO_COLUMNS = (
    # (見出し, 鍵, 型, 列幅の目安)
    ('設備名',         'equipment',   'text', 18),
    ('ロール名',       'name',        'text', 22),
    ('入出位置',       'entryPos',    'text', 12),
    ('接触面',         'contactFace', 'text', 10),
    ('ロール径MAX',    'diaMax',      'num',  12),
    ('ロール径MIN',    'diaMin',      'num',  12),
    ('ロール面長',     'faceLen',     'num',  12),
    ('材質',           'material',    'text', 12),
    ('硬度',           'hardness',    'text', 10),
    ('本数',           'count',       'int',  8),
    ('ロール使用条件', 'useCond',     'text', 20),
    ('駆動方式',       'driveKind',   'text', 10),
    ('基準番号',       'refNo',       'text', 14),
    ('備考',           'note',        'text', 30),
    ('表示順',         'order',       'int',  8),
    ('有効',           'enabledText', 'text', 8),
)
IO_HEADER = tuple(x[0] for x in IO_COLUMNS)

# 取り込みが組み立てる鍵は**画面と同じ camelCase**（`_row()` が返す形）だが、
# `roll_upsert()` の引数は snake_case。**ここで1回だけ寄せる**——呼ぶ側で
# 綴りを2通り持つと、列を1本足したときに「取り込んでも1列だけ入らない」が
# 起きる（実際に `entryPos` で落ちた）。
_UPSERT_KW = {'entryPos': 'entry_pos', 'contactFace': 'contact_face',
              'diaMax': 'dia_max', 'diaMin': 'dia_min', 'faceLen': 'face_len',
              'useCond': 'use_cond', 'driveKind': 'drive_kind', 'refNo': 'ref_no'}


def export_bytes(c, equipment=''):
    """いまのロールを .xlsx の bytes で返す（§9.240）。

    **無効な行も出す**（`[有効]` 列で分かる）——出さないと、書き出して
    直して取り込む往復で**無効にした行が消える**。
    `equipment` を渡すとその設備だけ。"""
    from ..xlsx_io import write_sheet
    eq = str(equipment or '').strip()
    rows = rolls_for_equipment(c, eq, True) if eq else roll_rows(c, True)
    out = []
    for x in rows:
        line = []
        for _label, key, kind, _w in IO_COLUMNS:
            if key == 'enabledText':
                line.append('有効' if x.get('enabled', True) else '無効')
                continue
            v = x.get(key)
            if v is None or v == '':
                line.append('')
            elif kind in ('num', 'int'):
                line.append(v)              # 数はセルも数（Excelで計算できる）
            else:
                line.append(str(v))
        out.append(line)
    name = ('ロール_' + eq) if eq else 'ロール'
    return write_sheet(IO_HEADER, out,
                       widths=[x[3] for x in IO_COLUMNS], sheet_name=name)


def _num_or_none(v):
    """空欄は None。数として読めなければ `'NG'`（**0にしない**。§9.114）。"""
    v = str(v or '').strip().replace(',', '')
    if not v:
        return None
    try:
        return float(v)
    except ValueError:
        return 'NG'


REPLACE_MODES = ('', 'file', 'all')
# 完全入替で「取り込めない行」があったときの断り文句。**判定も文言も1箇所**
# ——画面が同じ理由を書き写すと、条件を直したときに片方だけ古くなる。
REPLACE_BLOCKED = ('取り込めない行があるうちは入れ替えられません。'
                   '「入れ替える」は**このファイルが全部です**という意味なので、'
                   '読めない行が1行でもあると、その行にあたるロールを'
                   '**消してよいのか決められません**。'
                   '下の理由を直してから、もう一度選んでください'
                   '（いま取り込むだけなら「足す・上書きする」で進められます）。')


def _io_positions(rows):
    """見出しの行から、列の鍵→列番号（無ければ -1）。"""
    head = [str(x or '').strip() for x in rows[0]]
    # **見出しは名前で探す**（列の順番を変えても取り込める。§9.171）。
    pos = {}
    for label, key, _kind, _w in IO_COLUMNS:
        pos[key] = head.index(label) if label in head else -1
    return pos


def _io_cell(r, pos, key):
    i = pos[key]
    return str(r[i]).strip() if 0 <= i < len(r) and r[i] is not None else ''


def _io_read_row(c, r, i, pos):
    """ファイルの1行を読んで検める。`(値, None)` か、飛ばすときは `(None, 理由)`（§CLAUDE 4）。"""
    eq_raw, name = _io_cell(r, pos, 'equipment'), _io_cell(r, pos, 'name')
    if not name:
        return None, {'row': i, 'why': 'ロール名が空です'}
    try:
        eq = _canonical_eq(c, eq_raw)
    except ValueError as e:
        return None, {'row': i, 'why': str(e), 'name': name}
    vals = {'equipment': eq, 'name': name}
    bad = None
    for label, key, kind, _w in IO_COLUMNS:
        if key in ('equipment', 'name'):
            continue
        raw = _io_cell(r, pos, key)
        if key == 'enabledText':
            # 読み方は`flags.flag_of`の1箇所（§9.324 R4）。**空欄は「入」**
            # ——書き出しは無効な行も出すので、往復で空欄になるのは
            # 列そのものが無かったときだけ（§9.240）。
            vals['enabled'] = flag_of(raw, off=tuple(w for w in OFF_WORDS if w != ''))
            continue
        if pos[key] < 0 or raw == '':
            vals[key] = None          # 列が無い／空欄＝触らない（§9.212 ②）
            continue
        if kind in ('num', 'int'):
            n = _num_or_none(raw)
            if n == 'NG':
                bad = '%s が数として読めません（%s）' % (label, raw)
                break
            vals[key] = int(n) if (kind == 'int' and n is not None) else n
        else:
            vals[key] = raw
    if bad:
        return None, {'row': i, 'why': bad, 'name': name}
    dmax, dmin = vals.get('diaMax'), vals.get('diaMin')
    if dmax is not None and dmin is not None and dmin > dmax:
        return None, {'row': i, 'name': name,
                      'why': 'ロール径MINがMAXより大きくなっています'}
    return vals, None


def _io_plan(c, rows, pos, index):
    """ファイルの行を読み、既存の行と突き合わせる。`(plans, add, update, skipped)`。"""
    # 同じファイルの中で同じキーが2度出てきたら、**2度目は黙って上書きしない**
    # （§CLAUDE 4）。上書きすると1行ぶんが消えるのに「取り込みました」としか
    # 出ないので、**行番号を添えて飛ばす**。
    seen_rows = {}

    add = update = 0
    skipped = []
    plans = []
    for i, r in enumerate(rows[1:], start=2):
        if not any(str(v or '').strip() for v in r):
            continue                      # 空行は黙って飛ばす（Excelの末尾に必ず出る）
        vals, skip = _io_read_row(c, r, i, pos)
        if skip:
            skipped.append(skip)
            continue
        eq, name = vals['equipment'], vals['name']
        key = roll_key(eq, name, vals.get('contactFace'),
                       vals.get('diaMax'), vals.get('diaMin'), vals.get('note'))
        if key in seen_rows:
            skipped.append({'row': i, 'name': name,
                            'why': '同じ（%s）の行が%d行目にもあります。'
                                   'どちらの値で保存するか決められないので飛ばしました'
                                   '（接触面・ロール径・備考のどれかを分けるか、'
                                   '片方を消してください）。'
                                   % ('・'.join(KEY_LABELS), seen_rows[key])})
            continue
        seen_rows[key] = i
        # **`take()`は拾った行を使い済みにする**——未記入の行は1本しか無いので、
        # 2行目も「上書き」と数えると下見の件数が実際と食い違う。
        rid, why = index.take(eq, name, vals.get('contactFace'),
                              vals.get('diaMax'), vals.get('diaMin'), vals.get('note'))
        if why == 'ambiguous':
            # 鍵の列が欠けているシートを、その列で割った後のマスタへ取り込んだ
            # 場合（接触面の無いシート／径の無いシート）。**どれを直すか
            # 決められないので断る**（黙って1本を上書きしない）。
            skipped.append({'row': i, 'name': name,
                            'why': 'この設備の「%s」は %s のどれかが違う行が'
                                   '複数登録されています。その列をシートに足して、'
                                   'どれを直すかを決めてください。'
                                   % (name, '・'.join(KEY_LABELS[2:]))})
            continue
        if rid is not None:
            update += 1
        else:
            add += 1
        plans.append(vals)
    return plans, add, update, skipped


def _io_replace_scope(index, plans, replace, skipped, result):
    """完全入替で消える範囲（§9.251）を `result` へ書き、消す行を返す。"""
    remove, kept_blank = [], 0
    # **索引に残っている行＝ファイルのどの行にも当たらなかった行**。
    # 引き当てと同じ索引が答えるので、下見と保存が食い違わない。
    rest = index.rest()
    if replace == 'file':
        eqs = {_norm_eq(v['equipment']) for v in plans}
        remove = [x for x in rest if _norm_eq(x[1]) in eqs]
    else:
        for x in rest:
            if _norm_eq(x[1]):
                remove.append(x)
            else:
                kept_blank += 1       # 設備の入っていない行は残す（上の説明）
    result['remove'] = [{'equipment': x[1] or '', 'name': x[2] or '',
                         'contactFace': x[3] or '',
                         'diaMax': _norm_dia(x[4]), 'diaMin': _norm_dia(x[5]),
                         'note': _norm_note(x[6])} for x in remove[:NAME_SAMPLE]]
    result['removeCount'] = len(remove)
    result['removeMore'] = max(0, len(remove) - len(result['remove']))
    result['keptNoEquipment'] = kept_blank
    if skipped:
        # **読めない行があるうちは入れ替えない**（§CLAUDE 4）。進めると、
        # その行にあたるロールが「ファイルに無い」として消える——利用者は
        # 打ち間違えただけなのに、直そうとした行が先に消えている。
        result['blocked'] = REPLACE_BLOCKED
    return remove


def _io_save(c, uid, plans, remove, skipped, result):
    """読めた行を書き、入れ替えで消える行を消して、`result` を仕上げる。"""
    saved = 0
    for v in plans:
        try:
            roll_upsert(c, uid, **{_UPSERT_KW.get(k, k): val for k, val in v.items()})
            saved += 1
        except ValueError as e:
            skipped.append({'row': '-', 'name': v.get('name'), 'why': str(e)})
    # **消すのは書いたあと**——途中で落ちたときに「余分な行が残る」ほうが
    # 「要る行が消えている」より直しやすい（消えた行はファイルからしか戻せない）。
    result['removed'] = _delete_ids(c, [x[0] for x in remove]) if remove else 0
    result['saved'] = saved
    result['skipped'] = skipped
    return result


def import_rows(c, uid, data, dry_run=True, replace=''):
    """Excelから取り込む（§9.240）。**下見（dry_run）ができる**。

    §9.193 のクエリ結合と同じ作法で、**保存する前に何が起きるかを見せる**
    ——何件が追加で何件が上書きか、どの行がなぜ飛ばされるかを返す。

    **飛ばした行は必ず理由つきで返すこと**（§CLAUDE 4）。黙って減らすと
    「取り込んだのに増えていない」としか分からない。

    ■ `replace`（§9.251、利用者の指示「ロールマスタの完全入替機能」）
    §9.240 では「**行の削除はしない**」と決めていた。**その決めは取り消す**
    ——設備のロールを丸ごと入れ替える（古い一覧を捨てて、いま持っている
    ファイルの内容そのものにする）現場の作業が、それでは1件ずつの削除に
    なるため。ただし**既定は今までどおり消さない**（`''`）ので、何も選ばずに
    取り込んでいる現場の動きは1つも変わらない。

      `''`     足す・上書きする（消さない。**既定**）
      `'file'` **ファイルに出てくる設備だけ**入れ替える
      `'all'`  全設備を入れ替える（ファイルに1行も無い設備のロールも消える）

    **範囲をファイルに答えさせる**のが`'file'`の値打ち——1設備ぶんを
    書き出して直して戻す、といういちばんありそうな往復で、**他の設備の
    ロールを巻き添えにしない**。

    **消える範囲は`RollIndex.rest()`が答える**（§9.246 ⑤と同じ理由）——
    「どの行にも当たらなかった行」は引き当てそのものなので、別に数えると
    下見と食い違う。

    **設備の入っていない行は`'all'`でも消さない**——取り込みは空の設備名を
    受け付けない（`_canonical_eq()`）ので、その行は**ファイルでは表せない**。
    表せないものに「ファイルが全部」という主張は届かない。消したいときは
    `delete_all()`（全削除）で名指しする。**残したことは必ず数えて返す**。
    """
    from ..xlsx_io import read_sheet, XlsxError
    replace = str(replace or '').strip()
    if replace not in REPLACE_MODES:
        raise XlsxError('取り込み方が分かりません（「足す・上書きする」か'
                        '「入れ替える」のどちらかです）。')
    book = read_sheet(data)
    rows = book['rows']
    if not rows:
        raise XlsxError('シートが空です。1行目に見出し（%s …）を置いてください。'
                        % '／'.join(IO_HEADER[:3]))
    pos = _io_positions(rows)
    missing = [lab for lab, key, _k, _w in IO_COLUMNS
               if key in ('equipment', 'name') and pos[key] < 0]
    if missing:
        raise XlsxError('見出しに %s がありません。1行目を見出しの行にして'
                        'ください（書き出したファイルをそのまま直すのが確実です）。'
                        % '・'.join(missing))
    # いま在る行（自然キー→ID）。**正規化して突き合わせる**——設備名の
    # 全角/半角ゆれで「同じロールが2本」になるのを防ぐ。
    # **引き当ての規則は`RollIndex`の1箇所**（§9.246 ⑤）。下見が数えたものと
    # 保存で実際に起きることを同じ規則に決めさせる——別々に持つと
    # 「追加1・上書き2」と言いながら1行しか残らない、が作れる。
    index = RollIndex([(x['id'], x['equipment'], x['name'], x['contactFace'],
                        x['diaMax'], x['diaMin'], x['note'])
                       for x in roll_rows(c, True)])
    plans, add, update, skipped = _io_plan(c, rows, pos, index)
    result = {'total': len(rows) - 1, 'add': add, 'update': update,
              'skipped': skipped, 'sheet': book['sheet'], 'dryRun': bool(dry_run),
              'replace': replace}
    # ---- 完全入替で消える範囲（§9.251） ----
    remove = _io_replace_scope(index, plans, replace, skipped, result) if replace else []
    if dry_run:
        # **下見では3件だけ見せる**（§9.193。1件では「たまたま」と区別が付かない）
        result['sample'] = plans[:3]
        return result
    if result.get('blocked'):
        # 下見で断った理由は保存でも同じ。**画面が押せてしまった場合の最後の砦**
        # （押せなくするのは画面の仕事だが、口が通してしまうと守るものが無い）。
        raise XlsxError(result['blocked'])
    return _io_save(c, uid, plans, remove, skipped, result)
