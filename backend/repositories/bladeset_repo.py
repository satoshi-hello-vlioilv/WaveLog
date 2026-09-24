"""bladeset_repo.py: 刃組（ナイフセット）の部材マスタと基準値（§9.377）。

利用者の指示（要約）:
  「設備停止マスタに連携機能の欄を1つ増やし、そこに刃組ガイダンスを
    結び付けたい。刃組に必要なデータは元コイル幅・ロット毎の切断幅・板厚で、
    追加すべきマスタは刃マスタ・スペーサーマスタ・ゴムリングマスタ・
    フィンガーマスタなど。計算ロジックも含めて移植してほしい」

------------------------------------------------------------------
何を持つか（5枚 ＋ 1枚）
------------------------------------------------------------------
  `刃マスタ`          … 刃（ナイフ）1種類＝径・刃厚・枚数・研磨の記録
  `スペーサーマスタ`  … スペーサー（現場の別名はライナー）1寸法＝枚数
  `ゴムリングマスタ`  … ゴムリング1種類＝色（＝外径）×幅の枚数
  `フィンガーマスタ`  … 板押さえ1種類＝幅・本数・適用板厚の上限
  `刃組基準値マスタ`  … 1設備＝1行。アーバー有効長・判定帯などの設備諸元
  `刃組履歴マスタ`    … 刃組を終えた記録（台車ごとの差分を出すための控え）

**どれも設備ごと**（1行1設備・ロールマスタと同じ照合。`_same_eq()`）。
設備停止マスタの `'*'`（すべての設備）は**受け付けない**——部材は設備ごとに
実物が違うので、1本が全設備の所要に混ざった瞬間に数が嘘になる
（`roll_repo` が同じ理由で断っているのと同じ）。

------------------------------------------------------------------
ゴムリングの「同じ色は同じ外径」をどこで守るか
------------------------------------------------------------------
ゴムリングは**外周研磨で径が変わり、研磨は色の単位で行う**。つまり
「色」と「外径」は1対1で、**1本は（色, 幅）の2つで決まる**（在庫も色×幅）。

表は1行＝（色, 幅）の平らな形にしてある——マスタ管理の汎用の一覧に
そのまま載るのはこの形だけだからだ。そのぶん**外径が行ごとにばらけうる**
ので、**揃えるのは `ring_upsert()` の1箇所**にする（同じ設備の同じ色名の行は、
保存のたびに外径・内径・色コードを書いたものへ揃える）。判定を2箇所に
置かないための約束で、画面はこの不変条件を知らなくてよい。

------------------------------------------------------------------
基準値は「既定はコード・上書きだけがDB」
------------------------------------------------------------------
`刃組基準値マスタ` に行が無い設備でも画面は開けること。`standard_for()` は
`STANDARD_DEFAULTS` に保存行を重ねて返すので、**何も登録していない設備でも
計算は成り立つ**（登録していない設備で画面ごと止めると、直す手立ても
一緒に消える・§CLAUDE 4）。**既定値を黙ってDBへ書かない**——共有の
マスタへ勝手に行を作ると、他の端末からは「誰かが登録した」と読める。

部材（刃・スペーサー・ゴムリング・フィンガー）は現物の在庫なので既定を
持たない。代わりに `seed_standard_parts()` が「図面の製作数どおりの1式」を
**明示的に押したときだけ**登録する（マスタ管理の「初期セットを登録」）。
"""
import json

from ..db_access import tables
from ..flags import flag_of, OFF_WORDS
from .master_repo import normalize_equipment_name
from .table_def import TableDef

# ---------------------------------------------------------------------------
# 設備の照合（1行1設備。`roll_repo` と同じ約束）
# ---------------------------------------------------------------------------
# 設備停止マスタが「すべての設備」に使う印。**刃組では受け付けない**が、
# 断るときに名指しするので綴りをここに置く（§9.163）。
ALL_EQUIPMENTS = '*'


def _norm_eq(v):
    """設備名の表記ゆれを潰す。**判定にだけ使い、保存には使わない**。"""
    return normalize_equipment_name(v)


def _same_eq(a, b):
    na = _norm_eq(a)
    return bool(na) and na == _norm_eq(b)


def _num(v):
    """空欄は None のまま（**0にしない**・§9.231）。数として読めない値も None。"""
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


def _txt(v):
    return str(v or '').strip()


def _alive(v):
    """[有効] が NULL の行は**有効**（列を足したときに既存行が消えないように）。"""
    return True if v is None else bool(v)


def _enabled_pair(v):
    """真偽と**呼び名**の両方。マスタ管理の汎用フォームは選択欄しか持たないので、
    `enabledText` を返さないと編集窓が必ず「有効」を選んだ姿で開く
    （`report_block_repo` と同じ作法）。"""
    on = _alive(v)
    return on, ('有効' if on else '無効')


# ---------------------------------------------------------------------------
# 1 刃マスタ
# ---------------------------------------------------------------------------
# 刃は「径」と「刃厚」の2つで別物（同じ径でも刃厚が違えば所要は別に数える）。
# 研磨は刃ごとに進むので、研磨日・回数は**刃が持つ**（セットではない）。
BLADE_TABLE = '刃マスタ'
BLADE_COLUMNS = (
    ('設備名', 'TEXT'), ('名称', 'TEXT'), ('組', 'TEXT'), ('刃厚', 'REAL'),
    ('現状径', 'REAL'), ('保有枚数', 'INTEGER'), ('下限枚数', 'INTEGER'),
    ('研磨日', 'TEXT'), ('研磨回数', 'INTEGER'), ('状態', 'TEXT'),
    ('備考', 'TEXT'), ('表示順', 'INTEGER'), ('有効', 'INTEGER'),
)
BLADE_DEF = TableDef(BLADE_TABLE, '刃ID', BLADE_COLUMNS,
                     order_by='[設備名],[表示順],[刃ID]')
# 刃の状態。**語彙はここだけが持つ**（§9.163。画面へ写さない）。
#
# 3つしか無いのは、**状態が答えるのは「選ばれるか」の1点だけ**だから
# （§9.379、利用者の指示2）。以前は 使用中／研磨中／待機／使用不可 の4つで、
# 「いま軸に載っているか」と「選んでよいか」が混ざっていた——載っているかは
# 刃組履歴（台車）が答えるので、状態が二重に持つ必要はない。
#
#   一般        … ふつうはこれが選ばれる（既定）
#   メンテナンス中 … 研磨・修理などで**選ばれない**
#   専用        … `刃選択マスタ` の条件に当たったときだけ選ばれる
BLADE_GENERAL = '一般'
BLADE_MAINT = 'メンテナンス中'
BLADE_SPECIAL = '専用'
BLADE_STATUS = (BLADE_GENERAL, BLADE_MAINT, BLADE_SPECIAL)


# ---------------------------------------------------------------------------
# 2 スペーサーマスタ（現場の別名はライナー）
# ---------------------------------------------------------------------------
# 軸方向の寸法を作るのはこちら。ゴムリングはその上に被る別の層で、
# 軸方向の寸法には効かない（リング内径 241 ＞ スペーサー外径 240）。
# **ここに登録した寸法の組み合わせだけで区間を埋める**ので、刃組表・刃組図・
# 所要のすべてがこの寸法に直結する。
SPACER_TABLE = 'スペーサーマスタ'
SPACER_COLUMNS = (
    ('設備名', 'TEXT'), ('寸法', 'REAL'), ('保有枚数', 'INTEGER'),
    ('下限枚数', 'INTEGER'), ('用途', 'TEXT'), ('備考', 'TEXT'),
    ('表示順', 'INTEGER'), ('有効', 'INTEGER'),
)
SPACER_DEF = TableDef(SPACER_TABLE, 'スペーサーID', SPACER_COLUMNS,
                      order_by='[設備名],[寸法] DESC,[スペーサーID]')
# 用途は現場の呼び方をそのまま持つ。**サジェスト**なので、ここに無い値も保存できる。
SPACER_USES = ('基準用', '基準微調整用', '巾設定用', '軽量形')


# ---------------------------------------------------------------------------
# 3 ゴムリングマスタ
# ---------------------------------------------------------------------------
# 1行＝1本の種類＝（色, 幅）。同じ色名の行は外径・内径・色コードを
# `ring_upsert()` が揃える（冒頭の説明）。
RING_TABLE = 'ゴムリングマスタ'
RING_COLUMNS = (
    ('設備名', 'TEXT'), ('色名', 'TEXT'), ('色コード', 'TEXT'),
    ('外径', 'REAL'), ('内径', 'REAL'), ('幅', 'REAL'),
    ('保有本数', 'INTEGER'), ('下限本数', 'INTEGER'),
    # 潤滑リング（§9.455、利用者の指示「ゴムリングマスタに潤滑リングフラグを立てて、
    # ゴムリングのサイズや在庫数を決めるのと同じように潤滑リングの設定もできるように」）。
    # 形も材質もゴムリングで、寸法と役目だけが違う——**同じ表の1行**として持ち、
    # 幅・外径・内径・在庫は同じ欄で決める。真＝潤滑リング。
    ('潤滑リング', 'INTEGER'),
    ('備考', 'TEXT'), ('表示順', 'INTEGER'), ('有効', 'INTEGER'),
)
RING_DEF = TableDef(RING_TABLE, 'ゴムリングID', RING_COLUMNS,
                    order_by='[設備名],[外径] DESC,[幅] DESC,[ゴムリングID]')

# 外径 1mm ごとの色の周期。マスタに無い外径でも、この周期で色が決まる
# （現場は色で呼ぶので、名前の無い径を画面に出さないため）。
# 肉厚＝(外径−内径)/2 で、内径 241 のとき 赤 40.5 … ピンク 36.0 になる。
RING_COLOR_CYCLE = (
    ('赤', '#d93a34'), ('青', '#1f6fc4'), ('黄', '#e8b400'),
    ('緑', '#2e9e4f'), ('茶', '#8a5a2b'), ('灰', '#9aa0a6'),
    ('橙', '#f08a1c'), ('黒', '#2b3038'), ('水', '#33bff0'),
    ('ピンク', '#f0a882'),
)
RING_COLOR_TOP_OD = 322          # 周期の先頭（新品時の外径）


def ring_color_of(od):
    """外径から色名・色コードを引く。**マスタに無い径でも必ず答える**。"""
    n = _num(od)
    if n is None:
        return {'color': '', 'hex': '#8d97a6'}
    i = int(round(RING_COLOR_TOP_OD - n)) % len(RING_COLOR_CYCLE)
    name, hexv = RING_COLOR_CYCLE[i]
    return {'color': name, 'hex': hexv}


# ---------------------------------------------------------------------------
# 4 フィンガーマスタ（板押さえ）
# ---------------------------------------------------------------------------
# 板が薄いとゴムリングでは保持できない。そのときは板押さえ（フィンガー）で
# 保持し、軸はスペーサーだけで構成する。**適用板厚上限**が空の行は
# 基準値の`フィンガー切替板厚`に従う（行ごとに違う上限を持てるようにしてある）。
#
# **形は図面 N2-10689-1 / DK4-0300 LS-4（布入ベークライト）**（§9.379、利用者の
# 添付）。1本ぶんの寸法は4つで決まる:
#   幅     … W寸法。**軸方向の寸法**なので、模式図の横幅はこれで決まる
#   全長   … 560。軸から板へ差し出す向きの長さ（真横から見た図には出ない）
#   厚み   … 20±0.3。**板を押さえる向きの厚み**なので、模式図の縦はこれ
#   研削長・研削量 … 両端を上下両面から削る量（20×6＝片側16.7°／挟角33.4°）。
#                    先端ランド＝厚み−研削量×2、平行部＝全長−研削長×2
# 幅ちがいで本数が変わるので、**在庫は幅ごとに1行**（スペーサーと同じ持ち方）。
FINGER_TABLE = 'フィンガーマスタ'
FINGER_COLUMNS = (
    ('設備名', 'TEXT'), ('名称', 'TEXT'), ('幅', 'REAL'),
    ('保有本数', 'INTEGER'), ('下限本数', 'INTEGER'), ('適用板厚上限', 'REAL'),
    ('全長', 'REAL'), ('厚み', 'REAL'), ('研削長', 'REAL'), ('研削量', 'REAL'),
    ('備考', 'TEXT'), ('表示順', 'INTEGER'), ('有効', 'INTEGER'),
)
# 図面の既定値（改造後＝赤字）。**登録が無い行はこれで描く**——寸法が空だと
# 図が描けず、現場には「フィンガーだけ出ない」としか見えない（§9.231）。
FINGER_SHAPE = {'length': 560.0, 'thickness': 20.0, 'grindRun': 20.0,
                'grindDrop': 6.0}
FINGER_DEF = TableDef(FINGER_TABLE, 'フィンガーID', FINGER_COLUMNS,
                      order_by='[設備名],[表示順],[幅] DESC,[フィンガーID]')


# ---------------------------------------------------------------------------
# 5 刃組基準値マスタ
# ---------------------------------------------------------------------------
# 1行＝1設備。**既定はコード・上書きだけがDB**（冒頭の説明）。
STANDARD_TABLE = '刃組基準値マスタ'
STANDARD_COLUMNS = (
    ('設備名', 'TEXT'),
    # 「基準面」の列は §9.470 で外した（基準面は駆動側の DS に固定）。すでに在る DB の列は
    # 残るが読み書きしない（消すと古い版へ戻したときに列が無くなる）。
    ('アーバー有効長', 'REAL'), ('板の中心', 'REAL'),
    ('フローティングシート押さえ代', 'REAL'),
    ('軸外径', 'REAL'),
    ('スペーサー外径', 'REAL'), ('リング内径', 'REAL'),
    ('刃使用限界径', 'REAL'), ('研磨周期日', 'INTEGER'),
    ('フィンガー切替板厚', 'REAL'), ('刃間隙間上限', 'REAL'),
    ('押上目標', 'REAL'), ('押上下限', 'REAL'), ('押上上限', 'REAL'),
    ('押上不適下限', 'REAL'), ('押上不適上限', 'REAL'),
    ('ニップ下限', 'REAL'), ('ニップ上限', 'REAL'),
    ('ニップ不適下限', 'REAL'), ('ニップ不適上限', 'REAL'),
    ('上下左右差許容', 'REAL'), ('上下左右差不適', 'REAL'),
    ('クリアランス既定', 'REAL'), ('クリアランス率', 'REAL'),
    ('ラップ既定', 'REAL'), ('刃厚既定', 'REAL'),
    ('中抜き可', 'INTEGER'), ('屑条幅既定', 'REAL'), ('寸法刻み', 'REAL'),
    ('ゴムリング空き下限', 'REAL'), ('ゴムリング空き上限', 'REAL'),
    ('フィンガー空き下限', 'REAL'), ('フィンガー空き上限', 'REAL'),
    ('図の基準原点の位置', 'TEXT'), ('OSの呼び方', 'TEXT'), ('DSの呼び方', 'TEXT'),
    ('備考', 'TEXT'), ('表示順', 'INTEGER'), ('有効', 'INTEGER'),
)
STANDARD_DEF = TableDef(STANDARD_TABLE, '刃組基準ID', STANDARD_COLUMNS,
                        order_by='[設備名],[刃組基準ID]')

# 既定値。出どころは添付の刃組ガイダンス（設備図面 SL-1458-01S のライン）。
# **画面へ書き写さないこと**——`/api/bladeset/context` がそのまま届ける（§9.163）。
STANDARD_DEFAULTS = {
    'arborLen': 1599.6,
    # 基準面は**駆動側（DS）に固定**（§9.470、利用者の指示「基準面をOSに切り替えるという
    # 機能は不要」）。§9.461 で入れた切り替え（`datumSide`）は外した。答えは画面の
    # `datumOf()`の1箇所。
    # 板の中心（**基準面からの距離**・§9.456／§9.461、利用者の指示「基準原点を変更したら、
    # 中心位置の測り方も連動して変更」）。
    # **空（None）なら有効長の中央**——数を書き写すと、有効長を直したときに置き去りになる。
    'centerFromDatum': None,
    # フローティングシートの押さえ代（§9.457、利用者の回答と図面）。DS端はスペーサーを
    # 粗く積み、残りをこの量までフローティングシートが吸う。既定は図面の
    # 「F.P.ストローク 0.95mm×18本（1個所使用時）」——加圧ピストンのストローク 21mm は
    # ねじ側の量で、板を押さえる側（輪の横から出るピストン）が出るのは 0.95mm。
    'floatSeatStroke': 0.95,
    'shaftDia': 200.0,
    'spacerOD': 240.0, 'ringBore': 241.0,
    'minDia': 305.0, 'grindCycleDays': 60,
    'fingerMax': 0.6, 'gapMax': 5.0,
    'pushTarget': 0.5, 'pushMin': 0.4, 'pushMax': 0.9,
    'pushHardMin': 0.3, 'pushHardMax': 1.0,
    'nipMin': 0.5, 'nipMax': 1.0, 'nipHardMin': 0.3, 'nipHardMax': 1.3,
    'offsetTol': 0.05, 'offsetHardTol': 0.10,
    # クリアランスは**板厚に対する率**で持つ（§9.378、利用者の指示「実際の
    # クリアランスは、作業ロットの板厚と材質に合わせて変更になる可能性が若干
    # あります。目安として板厚の10％としておいてもらい、将来的には材質の条件も
    # 増える可能性がありますがマスタ化するなどでクリアランスマスタから
    # クリアランスが常に取れるようにするつもりです」）。
    # **いまは率の1本だけ**。材質ごとの値が要るようになったら、ここを
    # `クリアランスマスタ`（板厚×材質）へ差し替える——画面は率を直に読まず
    # `context` が届けた値を使うので、差し替えの影響はこの1箇所に留まる。
    'clearance': 0.15, 'clearanceRate': 0.1, 'overlap': 0.2, 'bladeThickness': 10.0,
    'canNakanuki': True, 'scrapWidth': 30.0, 'sizeStep': 0.05,
    # ゴムリングの組み方（§9.454、利用者の指示「ゴムリングは刃のあいだに
    # 収めますが、刃の間の寸法よりも0.2～0.5㎜小さくなるようにセットします。
    # この値は設備ごとに設定を持てるように」）。
    # **既定は2〜5mm**（§9.463、利用者の指示「ゴムリングの空きの適正範囲は
    # 2㎜～5㎜を規定値に変更してください（今設定している10倍）」）。
    'ringGapMin': 2.0, 'ringGapMax': 5.0,
    # フィンガーの空き（§9.462、利用者の指示「板押さえの適正な空きスペースの
    # 管理範囲を設定できるように」）。**現場の値はまだ聞いていないので0＝判定しない**
    # （勝手な数で埋めない・§9.231）。0のあいだは今までどおり区間いっぱいを狙う。
    'fingerGapMin': 0.0, 'fingerGapMax': 0.0,
    # 図の向き（§9.463、利用者の指示「段取り向きとか図面向きというのをやめて、
    # 基準原点を左、基準原点を右といった形で迷いの少ない呼び方に…既定は基準原点を
    # 右側に表示して、呼び方もマスタから変更できるように」）。
    # **OS・DS の呼び方**（§9.472、利用者の指示「切り替えボタンのラベルだけでなく、図の中の
    # ラベルや、右表のラベルもすべて連動させて」）。§9.463 の「向きの札の呼び方（左／右）」は
    # 札の字しか変えず、図・表・説明は OS／DS のまま残った——**名前を持つのは札ではなく端**。
    # 既存の列「向きの呼び方左／右」は読み書きしない（消すと古い版へ戻したとき列が無くなる）。
    'viewDatumPos': '右', 'sideNameOS': 'OS', 'sideNameDS': 'DS',
    # 潤滑リングの寸法と在庫は**ゴムリングマスタの行**が持つ（§9.455。§9.454 で
    # ここに置いた幅・外径・内径は移した——置き場を2つにしない）。
}
# DBの列名 ↔ 画面の鍵。**対応はここだけ**（§9.324 R1 と同じ考え方）。
_STANDARD_MAP = (
    ('アーバー有効長', 'arborLen', 'num'),
    ('板の中心', 'centerFromDatum', 'num'),
    ('フローティングシート押さえ代', 'floatSeatStroke', 'num'),
    ('軸外径', 'shaftDia', 'num'),
    ('スペーサー外径', 'spacerOD', 'num'), ('リング内径', 'ringBore', 'num'),
    ('刃使用限界径', 'minDia', 'num'), ('研磨周期日', 'grindCycleDays', 'int'),
    ('フィンガー切替板厚', 'fingerMax', 'num'), ('刃間隙間上限', 'gapMax', 'num'),
    ('押上目標', 'pushTarget', 'num'), ('押上下限', 'pushMin', 'num'),
    ('押上上限', 'pushMax', 'num'), ('押上不適下限', 'pushHardMin', 'num'),
    ('押上不適上限', 'pushHardMax', 'num'),
    ('ニップ下限', 'nipMin', 'num'), ('ニップ上限', 'nipMax', 'num'),
    ('ニップ不適下限', 'nipHardMin', 'num'), ('ニップ不適上限', 'nipHardMax', 'num'),
    ('上下左右差許容', 'offsetTol', 'num'), ('上下左右差不適', 'offsetHardTol', 'num'),
    ('クリアランス既定', 'clearance', 'num'),
    ('クリアランス率', 'clearanceRate', 'num'),
    ('ラップ既定', 'overlap', 'num'),
    ('刃厚既定', 'bladeThickness', 'num'), ('中抜き可', 'canNakanuki', 'flag'),
    ('屑条幅既定', 'scrapWidth', 'num'), ('寸法刻み', 'sizeStep', 'num'),
    ('ゴムリング空き下限', 'ringGapMin', 'num'),
    ('ゴムリング空き上限', 'ringGapMax', 'num'),
    ('フィンガー空き下限', 'fingerGapMin', 'num'),
    ('フィンガー空き上限', 'fingerGapMax', 'num'),
    ('図の基準原点の位置', 'viewDatumPos', 'pos'),
    ('OSの呼び方', 'sideNameOS', 'text'), ('DSの呼び方', 'sideNameDS', 'text'),
)
# 図の基準原点の位置（§9.463）。**綴りはここ1箇所**。
VIEW_POSITIONS = ('右', '左')


def view_pos(v, fallback='右'):
    """図の基準原点の位置を '右'／'左' へ。読めなければ`fallback`（保存では None）。"""
    t = _txt(v)
    t = {'RIGHT': '右', 'LEFT': '左'}.get(t.upper(), t)
    return t if t in VIEW_POSITIONS else fallback


# ---------------------------------------------------------------------------
# 6 条設計マスタ（条の設計を**測定より前に**決めておく控え）
# ---------------------------------------------------------------------------
# 利用者の指示（§9.378）:「測定時のロット情報の扱いと同じで、作業スケジュールの
# 次のタイミングで作業するロットの情報から読み取り、測定メイン画面で行う
# 『条の設計』を事前に行う。記録しておき、測定作業の際は読み込んで使える
# ようにする。この『条の設計』を行ったロットの条の並びで刃組を行う。」
#
# **1設備＋1親ロットで1行**（同じロットの設計は上書き）——2行あると、刃組と
# 測定がどちらを見ればよいか決まらない。明細（どの子ロットの条を何本、どの順で）
# は**ロットごとに形が変わるのでJSONのまま**持つ（刃組履歴マスタと同じ理由）。
# 条数・元コイル幅・板厚だけは**引いて見るもの**なので列に出す。
DESIGN_TABLE = '条設計マスタ'
DESIGN_COLUMNS = (
    ('設備名', 'TEXT'), ('親ロット番号', 'TEXT'), ('条数', 'INTEGER'),
    ('元コイル幅', 'REAL'), ('板厚', 'REAL'),
    ('明細JSON', 'TEXT'), ('摘要', 'TEXT'), ('記録日時', 'TEXT'), ('有効', 'INTEGER'),
)
DESIGN_DEF = TableDef(DESIGN_TABLE, '条設計ID', DESIGN_COLUMNS,
                      order_by='[設備名],[親ロット番号],[条設計ID] DESC')


# ---------------------------------------------------------------------------
# 7 刃選択マスタ（「専用」の刃を選ぶ条件）
# ---------------------------------------------------------------------------
# ふつうは「一般」の刃が選ばれる。**そこから外れる作業だけ**をここに書く
# （§9.379、利用者の指示2）。1行＝1つの決まりで、上から順に見て
# **最初に当たった1行**が効く（表示ルールマスタと同じ作法）。
#
# 条件は行ごとに数が変わるので **JSONの配列**で持つ（列にできない）。
# 形は `[{'field':'thickness','op':'ge','value':'1.6'}, ...]` で、
# **同じ行の条件は全部満たしたときだけ**当たる（AND）。
# 「または」は行を分けて書く——1行の中に AND と OR を混ぜると、
# 読む側が優先順位を推測することになる。
BLADEPICK_TABLE = '刃選択マスタ'
BLADEPICK_COLUMNS = (
    ('設備名', 'TEXT'), ('名称', 'TEXT'), ('条件JSON', 'TEXT'),
    ('刃の組', 'TEXT'), ('備考', 'TEXT'), ('表示順', 'INTEGER'), ('有効', 'INTEGER'),
)
BLADEPICK_DEF = TableDef(BLADEPICK_TABLE, '刃選択ID', BLADEPICK_COLUMNS,
                         order_by='[設備名],[表示順],[刃選択ID]')

# 条件に使える項目。**語彙はここだけが持つ**（画面は聞いて出す・§9.163）。
# `kind` は画面が入力欄の形を決めるためのもの。増やすときは、
# `pick_context()` が同じ鍵で値を作れることを確かめること。
BLADEPICK_FIELDS = (
    ('thickness', '板厚', 'num'),
    ('coilWidth', '元コイル幅', 'num'),
    ('strips', '条数', 'num'),
    ('minWidth', '条幅（いちばん狭い）', 'num'),
    ('maxWidth', '条幅（いちばん広い）', 'num'),
    ('material', '材質', 'text'),
    ('lotNo', 'ロット番号', 'text'),
)
# 比べ方。**表示ルールマスタと同じ綴り**を使う（1つのアプリに2つの
# 演算子の語彙を作らない）。右辺を持たないものはここには置かない——
# 「空かどうか」で刃を選ぶことはないため。
BLADEPICK_OPS = (
    ('eq', '＝'), ('ne', '≠'), ('ge', '≧'), ('gt', '＞'),
    ('le', '≦'), ('lt', '＜'), ('between', '範囲'), ('contains', '含む'),
)
BLADEPICK_OPS_2 = ('between',)      # 右辺を2つ取るもの


def normalize_pick_conditions(raw):
    """保存できる条件の配列へ整える。**壊れた条件は1件だけ落とす**
    （表示ルールマスタと同じ理由——1つの入力ミスで行ごと消えると、
    利用者からは「保存したのに戻っている」としか見えない）。"""
    if not isinstance(raw, list):
        return []
    fields = {f for f, _l, _k in BLADEPICK_FIELDS}
    ops = {o for o, _l in BLADEPICK_OPS}
    out = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        field = _txt(item.get('field'))
        op = _txt(item.get('op'))
        if field not in fields or op not in ops:
            continue
        cond = {'field': field, 'op': op,
                'value': _txt(item.get('value'))[:120]}
        if op in BLADEPICK_OPS_2:
            cond['value2'] = _txt(item.get('value2'))[:120]
        out.append(cond)
    return out


def _pick_row(d):
    try:
        conds = json.loads(d['条件JSON'] or '[]')
    except (ValueError, TypeError):
        conds = []
    return {'id': d['刃選択ID'], 'equipment': _txt(d['設備名']),
            'name': _txt(d['名称']), 'conditions': normalize_pick_conditions(conds),
            'group': _txt(d['刃の組']), 'note': _txt(d['備考']),
            'order': _int(d['表示順']), 'enabled': _alive(d['有効'])}


def pick_rows(c, include_disabled=False, equipment=None):
    return _rows(c, BLADEPICK_DEF, _pick_row, include_disabled, equipment)


def _cmp_num(left, op, a, b):
    """数の比べ方。**読めない値は「当たらない」**——0として比べると、
    空欄の条件が全部の作業に当たってしまう。"""
    ln, an = _num(left), _num(a)
    if ln is None or an is None:
        return False
    if op == 'eq':
        return abs(ln - an) < 1e-9
    if op == 'ne':
        return abs(ln - an) >= 1e-9
    if op == 'ge':
        return ln >= an - 1e-9
    if op == 'gt':
        return ln > an + 1e-9
    if op == 'le':
        return ln <= an + 1e-9
    if op == 'lt':
        return ln < an - 1e-9
    if op == 'between':
        bn = _num(b)
        if bn is None:
            return False
        lo, hi = (an, bn) if an <= bn else (bn, an)
        return lo - 1e-9 <= ln <= hi + 1e-9
    return False


def cond_hits(cond, ctx):
    """条件1つ。**文脈にその項目が無ければ当たらない**（§9.231
    「引けなかった値を0にしない」）。"""
    field = cond.get('field')
    if field not in ctx:
        return False
    left = ctx.get(field)
    if left is None or left == '':
        return False
    op = cond.get('op')
    kind = next((k for f, _l, k in BLADEPICK_FIELDS if f == field), 'text')
    if kind == 'num':
        return _cmp_num(left, op, cond.get('value'), cond.get('value2'))
    ls, rs = str(left), str(cond.get('value') or '')
    if op == 'eq':
        return ls == rs
    if op == 'ne':
        return ls != rs
    if op == 'contains':
        return bool(rs) and rs in ls
    return False


def pick_group(rules, ctx):
    """その作業で使う「専用」の刃の組。**当たらなければ空**＝「一般」を使う。

    上から順に見て**最初に当たった1行**を返す（表示ルールマスタと同じ）。
    条件が1つも無い行は当たらない扱いにする——「いつでも当たる行」を
    書けてしまうと、「一般」が既定であるという約束が静かに崩れる。
    """
    for r in (rules or []):
        conds = r.get('conditions') or []
        if not conds or not r.get('group'):
            continue
        if all(cond_hits(x, ctx) for x in conds):
            return {'group': r['group'], 'rule': r.get('name') or '',
                    'id': r.get('id')}
    return None


def pick_upsert(c, uid, row_id=None, equipment=None, name=None,
                conditions=None, group=None, note=None, order=None,
                enabled=None):
    """1行を足す／直す。条件は必ず `normalize_pick_conditions()` を通す。"""
    vals = {}
    if equipment is not None:
        vals['設備名'] = _txt(equipment)
    if name is not None:
        vals['名称'] = _txt(name)
    if conditions is not None:
        vals['条件JSON'] = json.dumps(normalize_pick_conditions(conditions),
                                      ensure_ascii=False)
    if group is not None:
        vals['刃の組'] = _txt(group)
    if note is not None:
        vals['備考'] = _txt(note)
    if order is not None:
        vals['表示順'] = _int(order)
    if enabled is not None:
        vals['有効'] = 1 if flag_of(enabled) else 0
    return _put(c, BLADEPICK_DEF, row_id, vals, uid, _txt(equipment))


def pick_delete(c, row_id):
    _delete(c, BLADEPICK_DEF, int(row_id))


# ---------------------------------------------------------------------------
# 9 台車マスタ（§9.424、利用者の指示）
# ---------------------------------------------------------------------------
# 利用者の言葉:「台車マスタは、A台車、B台車を登録しておいてください。設備ごと
# ですがスリッターがない設備もあるので。」「刃組ガイダンス使う設備＝台車マスタ必要」
#
# **台車は設備の持ち物**（何台あるか・何と呼ぶか）で、設備によって台数が違う。
# 以前は画面のHTMLに `A`/`B` を直に書いていたので、**3台目のあるラインを
# 登録できず**、呼び名も変えられなかった。
#
# **行を持つのは刃組ガイダンスを使う設備だけ。** スリッターの無い設備には
# 1行も作らない——「全設備に2台ある」ことにすると、無い物の差分を出せる
# 画面ができてしまう。入れ方は初期セット（`seed_standard_parts`）で、
# 部材と同じ1回の操作にまとめる（別々に覚えさせない・§CLAUDE 2）。
CARRIAGE_TABLE = '台車マスタ'
CARRIAGE_COLUMNS = (
    ('設備名', 'TEXT'), ('台車名', 'TEXT'), ('備考', 'TEXT'),
    ('表示順', 'INTEGER'), ('有効', 'INTEGER'),
)
CARRIAGE_DEF = TableDef(CARRIAGE_TABLE, '台車ID', CARRIAGE_COLUMNS,
                        order_by='[設備名],[表示順],[台車ID]')
# 初期セットで入れる顔ぶれ。**呼び名はここ1箇所**（画面へ書き写さない）。
CARRIAGE_SEED = ('A台車', 'B台車')
# 台車を使わないラインの呼び名（§9.424、利用者の指示「ごくまれにスリッターが
# ある設備でも、台車なしというパターンがありました。自動で組み込む必要は
# ないですが、スケジュール上の選択肢として使えるようにしてください」）。
# **初期セットでは入れない**——めったに無い形なので、既定で2台＋1行にすると
# ふつうのラインの札が3つになる。台車マスタへ1行足せばそのまま選べるので、
# **綴りだけをここが持つ**（画面はこれを案内に出し、利用者が打ち間違えない）。
CARRIAGE_NONE = '台車なし'


def _carriage_row(d):
    return {'id': d['台車ID'], 'equipment': _txt(d['設備名']),
            'name': _txt(d['台車名']), 'note': _txt(d['備考']),
            'order': _int(d['表示順']), 'enabled': _alive(d['有効'])}


def carriage_rows(c, include_disabled=False, equipment=None):
    return _rows(c, CARRIAGE_DEF, _carriage_row, include_disabled, equipment)


def carriage_upsert(c, uid, row_id=None, equipment=None, name=None,
                    note=None, order=None, enabled=None):
    """1台ぶん。**設備名と台車名は必須**——どちらが欠けても、その行は
    どの設備のどの台車か言えない（§9.377「部材は設備ごと」と同じ）。"""
    eq = _txt(equipment)
    nm = _txt(name)
    if row_id is None and (not eq or not nm):
        raise ValueError('設備名と台車名を入れてください。')
    vals = {}
    if equipment is not None:
        vals['設備名'] = eq
    if name is not None:
        vals['台車名'] = nm
    if note is not None:
        vals['備考'] = _txt(note)
    if order is not None:
        vals['表示順'] = _int(order)
    if enabled is not None:
        vals['有効'] = 1 if flag_of(enabled) else 0
    return _put(c, CARRIAGE_DEF, row_id, vals, uid, eq)


def carriage_delete(c, row_id):
    _delete(c, CARRIAGE_DEF, int(row_id))


def seed_carriages(c, uid, equipment):
    """その設備に A台車・B台車 を用意する。**2度押しても増えない**
    （§9.377 初期セットは足し算にならない）——同じ名前が在れば何もしない。"""
    eq = _txt(equipment)
    if not eq:
        return 0
    have = {r['name'] for r in carriage_rows(c, True, eq)}
    made = 0
    for i, nm in enumerate(CARRIAGE_SEED):
        if nm in have:
            continue
        carriage_upsert(c, uid, None, equipment=eq, name=nm, note='',
                        order=(i + 1) * 10, enabled=True)
        made += 1
    return made


# ---------------------------------------------------------------------------
# 8 刃組履歴マスタ
# ---------------------------------------------------------------------------
# ラインは2台の台車を交互に使う。直前の刃組はラインで稼働中なので、
# いま組み替える台車に載っているのは「2回前」の構成。その差分を出すための控え。
# 明細は部材の顔ぶれごとに形が変わるので **JSONのまま持つ**（列にできない）。
HISTORY_TABLE = '刃組履歴マスタ'
HISTORY_COLUMNS = (
    ('設備名', 'TEXT'), ('台車', 'TEXT'), ('記録日時', 'TEXT'),
    ('摘要', 'TEXT'), ('明細JSON', 'TEXT'), ('有効', 'INTEGER'),
)
HISTORY_DEF = TableDef(HISTORY_TABLE, '刃組履歴ID', HISTORY_COLUMNS,
                       order_by='[設備名],[記録日時] DESC,[刃組履歴ID] DESC')
HISTORY_KEEP = 20        # 1設備あたり残す件数（古いものから捨てる）


# ---------------------------------------------------------------------------
# 表を作る・足す
# ---------------------------------------------------------------------------
_ALL_DEFS = (BLADE_DEF, SPACER_DEF, RING_DEF, FINGER_DEF, STANDARD_DEF,
             HISTORY_DEF, DESIGN_DEF, BLADEPICK_DEF, CARRIAGE_DEF)


def ensure_tables(c):
    """9枚をまとめて用意する。**足すのは `add_missing()` の1箇所**（§9.315）。"""
    have = tables(c)
    created = []
    for d in _ALL_DEFS:
        if d.table not in have:
            d.create(c)
            created.append(d.table)
        else:
            d.add_missing(c)
    return created


def _ensure(c, d):
    if d.table not in tables(c):
        d.create(c)
    else:
        d.add_missing(c)


# ---------------------------------------------------------------------------
# 読む
# ---------------------------------------------------------------------------
def _blade_row(d):
    return {'id': d['刃ID'], 'equipment': _txt(d['設備名']),
            'name': _txt(d['名称']), 'group': _txt(d['組']),
            'thickness': _num(d['刃厚']), 'currentDia': _num(d['現状径']),
            'qty': _int(d['保有枚数']), 'minQty': _int(d['下限枚数']),
            'lastGrind': _txt(d['研磨日']), 'grindCount': _int(d['研磨回数']),
            'status': _txt(d['状態']), 'note': _txt(d['備考']),
            'order': d['表示順'], 'enabled': _alive(d['有効']),
            'enabledText': _enabled_pair(d['有効'])[1]}


def _spacer_row(d):
    return {'id': d['スペーサーID'], 'equipment': _txt(d['設備名']),
            'size': _num(d['寸法']), 'qty': _int(d['保有枚数']),
            'minQty': _int(d['下限枚数']), 'use': _txt(d['用途']),
            'note': _txt(d['備考']), 'order': d['表示順'],
            'enabled': _alive(d['有効']),
            'enabledText': _enabled_pair(d['有効'])[1]}


# 「種類」の呼び名（§9.455）。**綴りはここ1箇所**——画面の選択肢も送り返しも同じ字。
RING_KIND_RUBBER = 'ゴムリング'
RING_KIND_LUBE = '潤滑リング'


def ring_is_lube(v):
    """画面・APIから来る「種類」を真偽へ。`None`は「送っていない」。
    判定は`flags.flag_of()`の1箇所（§9.324 R4）へ、`ゴムリング`を「切」の側として渡す。"""
    return flag_of(v, off=OFF_WORDS + (RING_KIND_RUBBER,))


def _ring_row(d):
    od = _num(d['外径'])
    auto = ring_color_of(od)
    lube = bool(d['潤滑リング'])
    return {'id': d['ゴムリングID'], 'equipment': _txt(d['設備名']),
            # 色名・色コードは**空なら外径から起こす**（§9.163。画面で推測させない）。
            # **潤滑リングは外径の色の周期を当てない**——周期はゴムリングの色で、
            # 潤滑リングは「どのゴムリングとも違う色」（画面のトークン）で出す。
            'color': _txt(d['色名']) or ('潤滑' if lube else auto['color']),
            'hex': _txt(d['色コード']) or ('' if lube else auto['hex']),
            'lube': lube, 'lubeText': RING_KIND_LUBE if lube else RING_KIND_RUBBER,
            'od': od, 'bore': _num(d['内径']), 'width': _num(d['幅']),
            'qty': _int(d['保有本数']), 'minQty': _int(d['下限本数']),
            'note': _txt(d['備考']), 'order': d['表示順'],
            'enabled': _alive(d['有効']),
            'enabledText': _enabled_pair(d['有効'])[1]}


def _finger_row(d):
    return {'id': d['フィンガーID'], 'equipment': _txt(d['設備名']),
            'name': _txt(d['名称']), 'width': _num(d['幅']),
            'qty': _int(d['保有本数']), 'minQty': _int(d['下限本数']),
            'maxThickness': _num(d['適用板厚上限']),
            # 形は「空なら図面の既定」（§9.231 引けなかった値を0にしない）
            'length': _num(d['全長']) or FINGER_SHAPE['length'],
            'thickness': _num(d['厚み']) or FINGER_SHAPE['thickness'],
            'grindRun': _num(d['研削長']) or FINGER_SHAPE['grindRun'],
            'grindDrop': _num(d['研削量']) or FINGER_SHAPE['grindDrop'],
            'note': _txt(d['備考']),
            'order': d['表示順'], 'enabled': _alive(d['有効']),
            'enabledText': _enabled_pair(d['有効'])[1]}


def _standard_row(d):
    out = {'id': d['刃組基準ID'], 'equipment': _txt(d['設備名']),
           'note': _txt(d['備考']), 'order': d['表示順'],
           'enabled': _alive(d['有効']),
           'enabledText': _enabled_pair(d['有効'])[1]}
    for col, key, kind in _STANDARD_MAP:
        v = d[col]
        if kind == 'int':
            out[key] = _int(v)
        elif kind == 'pos':
            out[key] = view_pos(v, None)
        elif kind == 'text':
            out[key] = _txt(v) or None
        elif kind == 'flag':
            on = None if v is None else bool(v)
            out[key] = on
            # **呼び名も返す**（上の`enabledText`と同じ理由）。既定は
            # 「登録が無い＝基準値の既定に従う」なので、そのときは既定の側を出す。
            fallback = bool(STANDARD_DEFAULTS.get(key))
            out[key + 'Text'] = 'できる' if (fallback if on is None else on) else 'できない'
        else:
            out[key] = _num(v)
    return out


def _history_row(d):
    try:
        detail = json.loads(d['明細JSON'] or '{}')
    except (ValueError, TypeError):
        detail = {}
    return {'id': d['刃組履歴ID'], 'equipment': _txt(d['設備名']),
            'carriage': _txt(d['台車']), 'at': _txt(d['記録日時']),
            'note': _txt(d['摘要']), 'detail': detail,
            'enabled': _alive(d['有効'])}


def _design_row(d):
    """条の設計1件。**明細は読めなければ空**——壊れたJSONで画面ごと止めない
    （黙って捨てずに理由を残すのは `quiet` の役目だが、ここは repo なので
    空へ倒し、件数で気づけるようにする）。"""
    try:
        groups = json.loads(d['明細JSON'] or '[]')
    except (ValueError, TypeError):
        groups = []
    if not isinstance(groups, list):
        groups = []
    return {'id': d['条設計ID'], 'equipment': _txt(d['設備名']),
            'lot': _txt(d['親ロット番号']), 'strips': _int(d['条数']) or 0,
            'coilWidth': _num(d['元コイル幅']), 'thickness': _num(d['板厚']),
            'groups': groups, 'note': _txt(d['摘要']), 'at': _txt(d['記録日時']),
            'enabled': _alive(d['有効'])}


def _rows(c, d, to_row, include_disabled=False, equipment=None):
    _ensure(c, d)
    out = []
    for raw in d.fetch(c):
        x = to_row(raw)
        if not x['enabled'] and not include_disabled:
            continue
        if equipment is not None and not _same_eq(x['equipment'], equipment):
            continue
        out.append(x)
    return out


def blade_rows(c, include_disabled=False, equipment=None):
    return _rows(c, BLADE_DEF, _blade_row, include_disabled, equipment)


def spacer_rows(c, include_disabled=False, equipment=None):
    return _rows(c, SPACER_DEF, _spacer_row, include_disabled, equipment)


def ring_rows(c, include_disabled=False, equipment=None):
    return _rows(c, RING_DEF, _ring_row, include_disabled, equipment)


def finger_rows(c, include_disabled=False, equipment=None):
    return _rows(c, FINGER_DEF, _finger_row, include_disabled, equipment)


def standard_rows(c, include_disabled=False, equipment=None):
    return _rows(c, STANDARD_DEF, _standard_row, include_disabled, equipment)


def history_rows(c, include_disabled=False, equipment=None):
    return _rows(c, HISTORY_DEF, _history_row, include_disabled, equipment)


def standard_for(c, equipment):
    """その設備の基準値。**登録が無ければ既定値**（冒頭の説明）。

    戻りは `{'values':{...}, 'stored':bool, 'id':None|int}`——画面は
    「いま効いている値」と「それが登録によるものか」の両方を出す
    （出どころを画面に出す・§CLAUDE 6）。"""
    values = dict(STANDARD_DEFAULTS)
    rows = standard_rows(c, False, equipment)
    row = rows[0] if rows else None
    if row:
        for _col, key, _kind in _STANDARD_MAP:
            v = row.get(key)
            if v is not None:
                values[key] = v
    return {'values': values, 'stored': bool(row),
            'id': row['id'] if row else None}


# ---------------------------------------------------------------------------
# 書く
# ---------------------------------------------------------------------------
def design_rows(c, include_disabled=False, equipment=None):
    return _rows(c, DESIGN_DEF, _design_row, include_disabled, equipment)


def design_for(c, equipment, lot):
    """その設備・その親ロットの条の設計。**無ければ None**（既定を作らない
    ——「設計していない」と「こう設計した」を混ぜない）。"""
    key = _txt(lot)
    if not key:
        return None
    for x in design_rows(c, False, equipment):
        if x['lot'] == key:
            return x
    return None


def design_upsert(c, uid, equipment=None, lot=None, strips=None,
                  coil_width=None, thickness=None, groups=None, note=None,
                  at=None):
    """条の設計を書く。**1設備1ロット1行**——同じロットの2行目は作らせない
    （刃組と測定でどちらが効くのか決まらなくなる）。"""
    eq = _check_equipment(equipment)
    key = _txt(lot)
    if not key:
        raise ValueError('親ロット番号を渡してください。')
    if not isinstance(groups, list) or not groups:
        raise ValueError('条の設計が空です。条を1本以上決めてください。')
    _ensure(c, DESIGN_DEF)
    hit = design_for(c, eq, key)
    vals = {'設備名': eq, '親ロット番号': key,
            '条数': _int(strips), '元コイル幅': _num(coil_width),
            '板厚': _num(thickness),
            '明細JSON': json.dumps(groups, ensure_ascii=False),
            '摘要': _txt(note) or None, '記録日時': _txt(at) or None, '有効': -1}
    return _put(c, DESIGN_DEF, hit['id'] if hit else None, _only(vals), uid, eq)


def design_delete(c, design_id):
    _delete(c, DESIGN_DEF, int(design_id))


def _check_equipment(equipment):
    eq = _txt(equipment)
    if not eq:
        raise ValueError('設備を選んでください。')
    if eq == ALL_EQUIPMENTS:
        raise ValueError('刃組の部材は設備ごとに実物が違うため、'
                         '「すべての設備」では登録できません。設備を1つ選んでください。')
    return eq


def _equipment_for(row_id, equipment):
    """保存する設備名。**新規は必須、更新は渡されたときだけ書く**（§9.212 ②）。

    受け方を各 upsert に書き写すと「更新のときだけ空でも通る」という
    同じ条件が5箇所に散る。ここ1箇所で決める。"""
    if row_id is None or equipment not in (None, ''):
        return _check_equipment(equipment)
    return None


def _next_order(c, d, equipment):
    """その設備の中での表示順の最大+10（設備ごとの並びを保つ）。"""
    _ensure(c, d)
    top = 0
    for raw in d.fetch(c):
        if not _same_eq(_txt(raw['設備名']), equipment):
            continue
        try:
            top = max(top, int(raw['表示順'] or 0))
        except (TypeError, ValueError):
            continue
    return top + 10


def _put(c, d, row_id, vals, uid, equipment):
    """`vals` の鍵だけを書く（**渡していない列は今の値のまま**・§9.212 ②）。"""
    _ensure(c, d)
    if row_id is not None:
        if d.get(c, row_id) is None:
            raise ValueError('指定の行が見つかりません。')
        d.update(c, row_id, vals, uid)
        return int(row_id), False
    vals = dict(vals)
    # **その表に無い列は足さない**——`表示順` を持たない表（条設計マスタのように
    # 並びが設備＋ロットで決まるもの）へ既定を入れると `TableDef` が弾く。
    if '表示順' in d.names:
        vals.setdefault('表示順', _next_order(c, d, equipment))
    vals.setdefault('有効', -1)
    return d.insert(c, vals, uid), True


def _only(vals):
    """`None` の項目は「渡していない」として落とす（§9.212 ②）。"""
    return {k: v for k, v in vals.items() if v is not None}


def blade_upsert(c, uid, equipment=None, name=None, group=None, thickness=None,
                 current_dia=None, qty=None, min_qty=None, last_grind=None,
                 grind_count=None, status=None, note=None, order=None,
                 enabled=None, blade_id=None):
    bid = int(blade_id) if str(blade_id or '').strip() else None
    eq = _equipment_for(bid, equipment)
    nm = _txt(name)
    if bid is None and not nm:
        raise ValueError('刃の名称を入力してください。')
    vals = _only({'設備名': eq, '名称': nm or None, '組': _txt(group) or None,
                  '刃厚': _num(thickness), '現状径': _num(current_dia),
                  '保有枚数': _int(qty), '下限枚数': _int(min_qty),
                  '研磨日': _txt(last_grind) or None, '研磨回数': _int(grind_count),
                  '状態': _txt(status) or None, '備考': _txt(note) or None,
                  '表示順': _int(order),
                  '有効': None if enabled is None else (-1 if enabled else 0)})
    return _put(c, BLADE_DEF, bid, vals, uid, eq or _txt(equipment))


def spacer_upsert(c, uid, equipment=None, size=None, qty=None, min_qty=None,
                  use=None, note=None, order=None, enabled=None, spacer_id=None):
    sid = int(spacer_id) if str(spacer_id or '').strip() else None
    eq = _equipment_for(sid, equipment)
    sz = _num(size)
    if sid is None and (sz is None or sz <= 0):
        raise ValueError('スペーサーの寸法（mm）を入力してください。')
    vals = _only({'設備名': eq, '寸法': sz, '保有枚数': _int(qty),
                  '下限枚数': _int(min_qty), '用途': _txt(use) or None,
                  '備考': _txt(note) or None, '表示順': _int(order),
                  '有効': None if enabled is None else (-1 if enabled else 0)})
    return _put(c, SPACER_DEF, sid, vals, uid, eq or _txt(equipment))


def ring_color_state(c, equipment, color):
    """その設備の「その色」がいま何ミリか。登録が無ければ None。

    色は**現物に塗ってある目印**で、外径は研磨で減る値。1対1なので、
    色さえ分かれば外径は引ける——**同じ色の2本目を足すときに外径を
    もう一度打たせない**ための引き口（思い出させない・§CLAUDE 冒頭）。"""
    name = _txt(color)
    if not name:
        return None
    for x in ring_rows(c, True, equipment):
        if x['color'] == name and x['od'] is not None:
            return {'od': x['od'], 'bore': x['bore'], 'hex': x['hex']}
    return None


def ring_upsert(c, uid, equipment=None, color=None, hex_code=None, od=None,
                bore=None, width=None, qty=None, min_qty=None, note=None,
                order=None, enabled=None, ring_id=None, lube=None):
    """ゴムリングを1本（＝色×幅）書く。

    ■ 色と外径の関係（冒頭の説明）
    ゴムリングは**外周研磨で径が変わり、研磨は色の単位**で行う。だから
    「同じ色なのに外径が違う行」は現物として在り得ない。守り方は2つ:

      ・**外径を渡さなければ、その色の今の外径を引き継ぐ**
        （同じ色の幅ちがいを足すとき、径を打ち直さなくてよい）
      ・**外径を渡したら、その色ぜんぶをその値へそろえる**
        （研磨したときの入力は1行で済む。`_align_ring_color()`）

    **色名から外径を起こさないこと**——`ring_color_of()` の周期は
    「まだ名前の無い径を画面に出すとき」の言い換えで、保存の規則ではない。"""
    rid = int(ring_id) if str(ring_id or '').strip() else None
    eq = _equipment_for(rid, equipment)
    w = _num(width)
    name, tint = _txt(color), _txt(hex_code)
    # 潤滑リングの行は色名が空なら「潤滑」（§9.455）。**渡していなければ触らない**。
    if lube and not name and rid is None:
        name = '潤滑'
    if rid is None:
        if w is None or w <= 0:
            raise ValueError('ゴムリングの幅（mm）を入力してください。')
        if not name:
            raise ValueError('ゴムリングの色名を入力してください'
                             '（現場はこの色で1本を見分けます）。')
    # 色の現況。**設備は保存する側の綴りで引く**（更新で設備を渡していない
    # ときは、その行が今属している設備を見る）。
    lookup_eq = eq or (_txt(RING_DEF.get(c, rid)['設備名'])
                       if rid is not None and RING_DEF.get(c, rid) else '')
    lookup_name = name or (_txt(RING_DEF.get(c, rid)['色名'])
                           if rid is not None and RING_DEF.get(c, rid) else '')
    known = ring_color_state(c, lookup_eq, lookup_name) if lookup_name else None
    diameter, inner = _num(od), _num(bore)
    if known:
        # 渡していない項目は、その色の今の値を引き継ぐ（打ち直させない）。
        if diameter is None:
            diameter = known['od']
        if inner is None:
            inner = known['bore']
        if not tint:
            tint = known['hex']
    elif not tint and diameter is not None and not lube:
        # まだ登録の無い色。**色コードだけ**は周期から当てて画面に色を出す
        # （呼び名は利用者が書いたものを使う）。
        tint = ring_color_of(diameter)['hex']
    vals = _only({'設備名': eq, '色名': name or None, '色コード': tint or None,
                  '外径': diameter, '内径': inner, '幅': w,
                  '保有本数': _int(qty), '下限本数': _int(min_qty),
                  '備考': _txt(note) or None, '表示順': _int(order),
                  '潤滑リング': None if lube is None else (-1 if lube else 0),
                  '有効': None if enabled is None else (-1 if enabled else 0)})
    new_id, created = _put(c, RING_DEF, rid, vals, uid, eq or _txt(equipment))
    aligned = _align_ring_color(c, new_id, uid)
    return new_id, created, aligned


def _align_ring_color(c, ring_id, uid):
    """同じ（設備, 色名）の行を、いま書いた行の外径・内径・色コードへ揃える。

    ゴムリングは**外周研磨で径が変わり、研磨は色の単位**で行う。だから
    「同じ色なのに外径が違う行」は現物として在り得ない。行ごとに直させると
    必ず1行だけ直し忘れるので、**保存のたびにここで揃える**。"""
    row = RING_DEF.get(c, ring_id)
    if not row:
        return 0
    eq, name = _txt(row['設備名']), _txt(row['色名'])
    if not name:
        return 0
    od, bore, tint = _num(row['外径']), _num(row['内径']), _txt(row['色コード'])
    n = 0
    for raw in RING_DEF.fetch(c):
        if raw['ゴムリングID'] == ring_id:
            continue
        if not _same_eq(_txt(raw['設備名']), eq) or _txt(raw['色名']) != name:
            continue
        if _num(raw['外径']) == od and _num(raw['内径']) == bore \
                and _txt(raw['色コード']) == tint:
            continue
        RING_DEF.update(c, raw['ゴムリングID'],
                        {'外径': od, '内径': bore, '色コード': tint}, uid)
        n += 1
    return n


def finger_upsert(c, uid, equipment=None, name=None, width=None, qty=None,
                  min_qty=None, max_thickness=None, note=None, order=None,
                  enabled=None, finger_id=None):
    fid = int(finger_id) if str(finger_id or '').strip() else None
    eq = _equipment_for(fid, equipment)
    nm = _txt(name)
    if fid is None and not nm:
        raise ValueError('フィンガーの名称を入力してください。')
    vals = _only({'設備名': eq, '名称': nm or None, '幅': _num(width),
                  '保有本数': _int(qty), '下限本数': _int(min_qty),
                  '適用板厚上限': _num(max_thickness), '備考': _txt(note) or None,
                  '表示順': _int(order),
                  '有効': None if enabled is None else (-1 if enabled else 0)})
    return _put(c, FINGER_DEF, fid, vals, uid, eq or _txt(equipment))


def standard_upsert(c, uid, equipment=None, values=None, note=None,
                    standard_id=None):
    """基準値を書く。**1設備1行**——同じ設備の2行目は作らせない
    （どちらの値が効くのか決まらなくなる）。"""
    sid = int(standard_id) if str(standard_id or '').strip() else None
    eq = _check_equipment(equipment)
    _ensure(c, STANDARD_DEF)
    if sid is None:
        for raw in STANDARD_DEF.fetch(c):
            if _same_eq(_txt(raw['設備名']), eq):
                sid = raw['刃組基準ID']
                break
    src = values if isinstance(values, dict) else {}
    vals = {'設備名': eq}
    for col, key, kind in _STANDARD_MAP:
        if key not in src:
            continue
        v = src[key]
        if kind == 'flag':
            vals[col] = None if v in (None, '') else (-1 if _flagged(v) else 0)
        elif kind == 'pos':
            vals[col] = view_pos(v, None)
        elif kind == 'text':
            vals[col] = (_txt(v) or None) if v is not None else None
        elif kind == 'int':
            vals[col] = _int(v)
        else:
            vals[col] = _num(v)
    if note is not None:
        vals['備考'] = _txt(note) or None
    return _put(c, STANDARD_DEF, sid, vals, uid, eq)


def _flagged(v):
    """画面から来る「入/切」を真偽へ。判定は`flags.flag_of()`の1箇所（§9.324 R4）。"""
    got = flag_of(v)
    return True if got is None else got


def history_add(c, uid, equipment=None, carriage=None, at=None, note=None,
                detail=None):
    """刃組を終えた記録を1件足す。**古いものは捨てる**（`HISTORY_KEEP`）。"""
    eq = _check_equipment(equipment)
    car = _txt(carriage)
    if not car:
        raise ValueError('台車を選んでください。')
    _ensure(c, HISTORY_DEF)
    new_id = HISTORY_DEF.insert(c, {
        '設備名': eq, '台車': car, '記録日時': _txt(at),
        '摘要': _txt(note),
        '明細JSON': json.dumps(detail if isinstance(detail, dict) else {},
                               ensure_ascii=False),
        '有効': -1}, uid)
    for old in history_rows(c, False, eq)[HISTORY_KEEP:]:
        _delete(c, HISTORY_DEF, old['id'])
    return new_id


def _delete(c, d, row_id):
    """1行を消す。**論理削除ではなく実削除**——部材マスタは「持っていない物」を
    残す意味が無い（設備停止マスタのように予定から参照されることもない）。"""
    _ensure(c, d)
    cur = c.cursor()
    cur.execute('DELETE FROM [%s] WHERE [%s]=?' % (d.table, d.key), [row_id])
    n = cur.rowcount
    c.commit()
    return n


def blade_delete(c, blade_id):
    return _delete(c, BLADE_DEF, blade_id)


def spacer_delete(c, spacer_id):
    return _delete(c, SPACER_DEF, spacer_id)


def ring_delete(c, ring_id):
    return _delete(c, RING_DEF, ring_id)


def finger_delete(c, finger_id):
    return _delete(c, FINGER_DEF, finger_id)


def standard_delete(c, standard_id):
    return _delete(c, STANDARD_DEF, standard_id)


def carriage_state(c, equipment):
    """その設備の台車が、いまどの刃組で組まれているか。**判定はここ1箇所**。

    利用者の言葉（§9.378）:「台車で準備されているかどうかで作業スケジュール上に
    刃組待ちができるかどうかが決まるので、スケジュール上でもその設備で登録中の
    台車がどの刃のセット状態かわかるように」。

    ふつうは2台の台車を交互に使う。
      直前の刃組 … ラインで**稼働中**（その部材は外せない）
      その次に見つかる別の台車 … いま**組み替える**台車に載っている構成
    画面が履歴を数え直さなくて済むよう、役割まで付けて返す。

    **何台あるかは台車マスタが決める**（§9.424）——ここに 2 を書いていたので、
    3台のラインでは3台目が出ず、台車を使わないライン（`台車なし` の1行）では
    無い2台目を探し続けていた。登録が無いときだけ、履歴に出てくる顔ぶれで
    数える（古い記録しか無い設備でも、今までどおり見える）。
    """
    rows = history_rows(c, False, equipment)     # 新しい順
    known = [r['name'] for r in carriage_rows(c, False, equipment) if r['name']]
    limit = len(known) if known else 2
    out, seen = [], set()
    for r in rows:
        car = r['carriage']
        if not car or car in seen:
            continue
        seen.add(car)
        d = r.get('detail') or {}
        out.append({
            'carriage': car,
            'role': '稼働中' if len(out) == 0 else '組み替え対象',
            'at': r['at'], 'note': r['note'],
            'set': _txt(d.get('set')),
            'cond': d.get('cond') if isinstance(d.get('cond'), dict) else None,
        })
        if len(out) >= limit:
            break
    return out


def history_delete(c, history_id):
    return _delete(c, HISTORY_DEF, history_id)


# ---------------------------------------------------------------------------
# 初期セット（図面の製作数どおりの1式）
# ---------------------------------------------------------------------------
# 出どころは添付の刃組ガイダンス。**押したときだけ登録する**——共有の
# マスタへ黙って行を作らない（冒頭の説明）。
# 用途は現場での呼び方をそのまま持つ:
#   基準用       … 10.025（2枚だけ。基準を作るための1枚）
#   基準微調整用 … 10.05〜10.90（0.05／0.1 刻みで基準を追い込む）
#   巾設定用     … 6〜30（条幅そのものを作る）
#   軽量形       … 50・100（外周に逃がしが入った厚物）
SEED_SPACERS = (
    (100, 30, '軽量形'), (50, 50, '軽量形'), (30, 50, '巾設定用'),
    (20, 60, '巾設定用'), (15, 60, '巾設定用'), (14, 60, '巾設定用'),
    (13, 60, '巾設定用'), (12, 60, '巾設定用'), (11, 60, '巾設定用'),
    (10.9, 40, '基準微調整用'), (10.8, 40, '基準微調整用'),
    (10.75, 40, '基準微調整用'), (10.7, 40, '基準微調整用'),
    (10.6, 40, '基準微調整用'), (10.5, 40, '基準微調整用'),
    (10.4, 40, '基準微調整用'), (10.3, 42, '基準微調整用'),
    (10.2, 42, '基準微調整用'), (10.1, 42, '基準微調整用'),
    (10.05, 22, '基準微調整用'), (10.025, 2, '基準用'),
    (10, 60, '巾設定用'), (9, 60, '巾設定用'), (8, 60, '巾設定用'),
    (7, 60, '巾設定用'), (6, 60, '巾設定用'),
)
# ゴムリングの幅と本数（色ごとに同じ顔ぶれで持つ）。
SEED_RING_WIDTHS = ((50, 50), (30, 40), (20, 40), (15, 30), (10, 30))
# 潤滑リング（§9.455）。寸法は利用者の指示（幅10・外径270・内径240）。
# **本数は図面に無い**ので、40条の刃組（広い側の区間ごとに2本＝80本）が
# 1回組める数を置く。現物の本数はマスタで直す。
SEED_LUBE = {'color': '潤滑', 'width': 10.0, 'od': 270.0, 'bore': 240.0, 'qty': 80}
# 刃は 5mm と 10mm の2種類を3組（A・B・C）、各 70 枚。
SEED_BLADE_GROUPS = ('A', 'B', 'C')
SEED_BLADE_THICKNESS = (10, 5)
SEED_BLADE_QTY = 70
SEED_BLADE_DIA = 318.2
# フィンガー（板押さえ）。板厚 0.6 未満で使う。
# **図面 N2-10689-1 の製作表そのまま**（§9.379、利用者の添付。合計 790 本）。
# 幅の刻みが 20〜30 に1mmずつあるのは、条幅に合わせて選ぶため——ここを
# 間引くと、選べる幅が無くて区間を埋められない条が出る。
SEED_FINGERS = (
    ('フィンガー 10', 10.0, 60), ('フィンガー 20', 20.0, 60),
    ('フィンガー 21', 21.0, 60), ('フィンガー 22', 22.0, 60),
    ('フィンガー 23', 23.0, 60), ('フィンガー 24', 24.0, 60),
    ('フィンガー 25', 25.0, 60), ('フィンガー 26', 26.0, 60),
    ('フィンガー 27', 27.0, 60), ('フィンガー 28', 28.0, 60),
    ('フィンガー 29', 29.0, 60), ('フィンガー 30', 30.0, 50),
    ('フィンガー 50', 50.0, 50), ('フィンガー 100', 100.0, 30),
)


def seed_standard_parts(c, uid, equipment, replace=False):
    """その設備へ「図面どおりの1式」を登録する。

    **既に1件でもあれば足さない**（`replace=False`）——押し間違いで在庫が
    倍になるのを防ぐ。入れ替えたいときは `replace=True` で今の行を消してから
    入れる（押す前に何が起きるかは画面が言う・§CLAUDE 4）。
    戻りは登録した件数の内訳。"""
    eq = _check_equipment(equipment)
    ensure_tables(c)
    made = {'blade': 0, 'spacer': 0, 'ring': 0, 'finger': 0, 'carriage': 0}
    existing = {'blade': blade_rows(c, True, eq), 'spacer': spacer_rows(c, True, eq),
                'ring': ring_rows(c, True, eq), 'finger': finger_rows(c, True, eq)}
    if replace:
        for x in existing['blade']:
            blade_delete(c, x['id'])
        for x in existing['spacer']:
            spacer_delete(c, x['id'])
        for x in existing['ring']:
            ring_delete(c, x['id'])
        for x in existing['finger']:
            finger_delete(c, x['id'])
        existing = {k: [] for k in existing}
    order = 0
    if not existing['blade']:
        for g in SEED_BLADE_GROUPS:
            for tk in SEED_BLADE_THICKNESS:
                order += 10
                BLADE_DEF.insert(c, {
                    '設備名': eq, '名称': '%dmm %s' % (tk, g), '組': g,
                    '刃厚': float(tk), '現状径': SEED_BLADE_DIA,
                    '保有枚数': SEED_BLADE_QTY, '下限枚数': 0,
                    '状態': BLADE_GENERAL,
                    '表示順': order, '有効': -1}, uid)
                made['blade'] += 1
    if not existing['spacer']:
        order = 0
        for sz, qty, use in SEED_SPACERS:
            order += 10
            SPACER_DEF.insert(c, {
                '設備名': eq, '寸法': float(sz), '保有枚数': int(qty),
                '下限枚数': 0, '用途': use, '表示順': order, '有効': -1}, uid)
            made['spacer'] += 1
    if not existing['ring']:
        order = 0
        for i, (color, tint) in enumerate(RING_COLOR_CYCLE):
            od = float(RING_COLOR_TOP_OD - i)
            for width, qty in SEED_RING_WIDTHS:
                order += 10
                RING_DEF.insert(c, {
                    '設備名': eq, '色名': color, '色コード': tint,
                    '外径': od, '内径': float(STANDARD_DEFAULTS['ringBore']),
                    '幅': float(width), '保有本数': int(qty), '下限本数': 0,
                    '潤滑リング': 0, '表示順': order, '有効': -1}, uid)
                made['ring'] += 1
        order += 10
        RING_DEF.insert(c, {
            '設備名': eq, '色名': SEED_LUBE['color'], '色コード': None,
            '外径': SEED_LUBE['od'], '内径': SEED_LUBE['bore'],
            '幅': SEED_LUBE['width'], '保有本数': SEED_LUBE['qty'], '下限本数': 0,
            '潤滑リング': -1, '表示順': order, '有効': -1}, uid)
        made['ring'] += 1
    if not existing['finger']:
        order = 0
        for name, width, qty in SEED_FINGERS:
            order += 10
            FINGER_DEF.insert(c, {
                '設備名': eq, '名称': name, '幅': float(width),
                '保有本数': int(qty), '下限本数': 0,
                '適用板厚上限': float(STANDARD_DEFAULTS['fingerMax']),
                '全長': FINGER_SHAPE['length'],
                '厚み': FINGER_SHAPE['thickness'],
                '研削長': FINGER_SHAPE['grindRun'],
                '研削量': FINGER_SHAPE['grindDrop'],
                '表示順': order, '有効': -1}, uid)
            made['finger'] += 1
    # 台車（§9.424、利用者の指示）。**刃組ガイダンスを使う設備＝台車が要る**ので、
    # 部材と同じ1回の操作で A台車・B台車 を用意する。`replace` では消さない
    # ——部材を入れ替えても台車そのものは同じ物で、記録（`刃組履歴マスタ.台車`）が
    # 名前で結び付いている。2度押しても増えない（同じ名前が在れば何もしない）。
    made['carriage'] = seed_carriages(c, uid, eq)
    c.commit()
    return made


# ---------------------------------------------------------------------------
# 画面へ渡すひとまとまり（§9.163: 判定と語彙はサーバーが持つ）
# ---------------------------------------------------------------------------
def context(c, equipment):
    """刃組ガイダンス1画面ぶんの材料を**1往復で**返す。

    画面は6本のAPIを順に叩かない——開くたびに6往復すると、共有フォルダー
    越しでは目に見えて遅い（§9.198「遅いときはどこが遅いかを画面に出す」の
    前に、そもそも往復を減らす）。"""
    eq = _txt(equipment)
    std = standard_for(c, eq)
    return {
        'equipment': eq,
        'standard': std['values'], 'standardStored': std['stored'],
        'standardId': std['id'], 'standardDefaults': dict(STANDARD_DEFAULTS),
        'blades': blade_rows(c, False, eq),
        'spacers': spacer_rows(c, False, eq),
        'rings': ring_rows(c, False, eq),
        'fingers': finger_rows(c, False, eq),
        'history': history_rows(c, False, eq),
        'picks': pick_rows(c, False, eq),
        # 台車（§9.424）。**行が無い設備は「台車の登録がない」と言う**
        # ——画面が勝手に A/B を作ると、無い台車の差分を出せてしまう。
        'carriages': carriage_rows(c, False, eq),
        'carriageSeed': list(CARRIAGE_SEED),
        'carriageNone': CARRIAGE_NONE,
        # 条の設計（§9.381）。**測定が読むのと同じ行**を画面へも渡す
        # ——「記録済みか」を別の口で数えると、答えが2つに割れる。
        'designs': design_rows(c, False, eq),
        # 語彙（画面へ書き写さない）
        'bladeStatus': list(BLADE_STATUS),
        'bladeGeneral': BLADE_GENERAL,
        'bladeSpecial': BLADE_SPECIAL,
        'bladeMaint': BLADE_MAINT,
        'fingerShape': dict(FINGER_SHAPE),
        'pickFields': [{'field': f, 'label': l, 'kind': k}
                       for f, l, k in BLADEPICK_FIELDS],
        'pickOps': [{'op': o, 'label': l, 'two': o in BLADEPICK_OPS_2}
                    for o, l in BLADEPICK_OPS],
        'spacerUses': list(SPACER_USES),
        'ringColors': [{'color': c0, 'hex': h,
                        'od': float(RING_COLOR_TOP_OD - i)}
                       for i, (c0, h) in enumerate(RING_COLOR_CYCLE)],
    }


def equipments(c):
    """刃組の部材が登録されている設備名（画面の束ね方の材料）。"""
    seen = []
    for rows in (blade_rows(c, True), spacer_rows(c, True), ring_rows(c, True),
                 finger_rows(c, True), standard_rows(c, True)):
        for x in rows:
            if x['equipment'] and x['equipment'] not in seen:
                seen.append(x['equipment'])
    return seen
