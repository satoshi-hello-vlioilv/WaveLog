"""lot_equipment.py: ロットの設計設備と、入れようとする予定の設備が合っているか（§9.637）。

------------------------------------------------------------------------
利用者の指示:「スケジュールされたデータが使用設備のデータになっているか完全にチェック
できていないので、使用設備のスケジュールを組むときに使用設備外の対象のデータが組み込まれ
ないようにエラー対策を実装してください」

**答えはここ1箇所。** 予定へロットが入る道（1件の追加・まとめ書込の追加・子ロット）は
`routes/schedule.py`の`_apply_plan_op()`の1本を通り、そこがこの`add_issue()`を聞く。
予定の応答（`plan_list`）が「すでに入っているほかの設備のロット」を名指すのも同じ答え（`plan_warning()`）。

決めごと:
 ・設計設備は**いまの仕掛の行**が先（画面の明細は送った側の写しで、書かない・偽ることもできる）。
   仕掛に無い（もう流れた・読めない）ときだけ明細の写しを読む。
 ・**分からないことを止める理由にしない**——仕掛にも明細にも設計設備が無いロットは通す
   （測定画面の関門`requireEquipmentBeforeMeasurement()`と同じ倒し方）。
 ・比べ方は書き方のゆれ（全角・半角・大小・空白）を同じと読み、**設計設備の字に予定の設備名が
   含まれるか**。測定画面の関門と画面の先回り（`WL.base.equipmentIsInDesignCourse()`）と同じ決まり
   （片方だけ変えると、画面は通すのにサーバーが断る・測定は開けるのに予定に入らない）。
------------------------------------------------------------------------
"""
import unicodedata

from . import actual_match

# 仕掛の設計設備の列（`source_capability`の`equipment`と同じ並び）。
DESIGN_COLUMNS = ('BOX設計_設備名', '設備')
# 予定の明細（画面の`buildScheduleDetail()`の写し）で設計設備を持つ鍵。生の列名が先・呼び名が後。
DETAIL_KEYS = ('BOX設計_設備名', 'equipment', '設備')
# ロットを持つ種別。設備停止・申し送り・枠はロットを持たないので関門に掛けない。
LOT_KINDS = ('作業',)


def norm(value):
    """設備名の書き方のゆれを同じと読む（NFKC・大文字・空白を落とす）。画面の`normalizeCourseText()`と同じ。"""
    t = unicodedata.normalize('NFKC', str(value if value is not None else '')).upper()
    return ''.join(t.split())


def matches(equipment, design):
    """設計設備`design`が予定の設備`equipment`を指すか（どちらかが空なら False）。"""
    ne, nd = norm(equipment), norm(design)
    return bool(ne) and bool(nd) and ne in nd


def _first(row, keys):
    for k in keys:
        v = (row or {}).get(k)
        if v is not None and str(v).strip():
            return str(v).strip()
    return ''


def design_of(lot_no, detail=None, casting_no=''):
    """ロットの設計設備と出どころ（'work'＝いまの仕掛／'detail'＝予定の明細／''＝分からない）。"""
    detail = detail if isinstance(detail, dict) else {}
    plan = {'lotNo': lot_no, 'castingNo': casting_no}
    row = actual_match.work_row(detail, plan) or actual_match.lot_row(lot_no or detail.get('ロット番号'))
    name = _first(row, DESIGN_COLUMNS) if row else ''
    if name:
        return name, 'work'
    name = _first(detail, DETAIL_KEYS)
    return (name, 'detail') if name else ('', '')


def mismatch(equipment, lot_no, detail=None, casting_no=''):
    """ほかの設備のロットならその設計設備、合っている・分からないなら ''。"""
    design, _src = design_of(lot_no, detail, casting_no)
    return '' if not design or matches(equipment, design) else design


def issue(equipment, lot_no, detail=None, casting_no=''):
    """このロットを`equipment`の予定に置いてよいか。よければ ''、だめなら理由の1文。"""
    design = mismatch(equipment, lot_no, detail, casting_no)
    if not design:
        return ''
    lot = str(lot_no or (detail or {}).get('lotNo') or '').strip() or '（番号なし）'
    return (f'ロット {lot} の設計設備は「{design}」です。「{equipment}」の予定には入れられません'
            f'（{design}の予定へ入れてください）。')


def add_issue(equipment, kind, lot_no, detail=None, casting_no='', children=None):
    """予定へ1件入れる前の関門。親と子ロットを全部見て、だめな物の理由をつないで返す（よければ ''）。"""
    if str(kind or '').strip() not in LOT_KINDS:
        return ''
    whys = [issue(equipment, lot_no, detail, casting_no)]
    for ch in (children or []):
        whys.append(issue(equipment, ch.get('lotNo'), ch.get('detail'), ch.get('castingNo') or ''))
    return '／'.join(w for w in whys if w)


def plan_warning(equipment, entries):
    """予定の行のうち、ほかの設備のロットに理由を付け（行の`equipmentIssue`）、注意の1文を返す（無ければ ''）。
    済んだ行（完了・取消）は数えない——済んだことは直せず、注意にしても打つ手が無い。ロットは5件まで名前を出す。"""
    flagged = []
    for e in entries or []:
        if e.get('kind') not in LOT_KINDS or e.get('state') in ('完了', '取消'):
            continue
        design = mismatch(equipment, e.get('lotNo'), e.get('detail'), e.get('castingNo') or '')
        if design:
            e['equipmentIssue'] = issue(equipment, e.get('lotNo'), e.get('detail'), e.get('castingNo') or '')
            flagged.append((e, design))
    if not flagged:
        return ''
    names = [f"{e.get('lotNo') or '?'}（設計設備 {d}）" for e, d in flagged[:5]]
    more = f' ほか{len(flagged) - 5}件' if len(flagged) > 5 else ''
    return (f'{equipment}の予定に、ほかの設備のロットが{len(flagged)}件あります: ' + '・'.join(names) + more
            + '。外すか、設計設備の予定へ入れ直してください。')
