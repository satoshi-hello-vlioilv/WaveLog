# -*- coding: utf-8 -*-
"""xlsx_io.py: Excel(.xlsx)の読み書き。**追加のライブラリを使わない**。

利用者の指示（§9.240）:

  「追加実装した、ロールマスタについて EXCELでのインポート＆エクスポート機能を
   実装してください。」

■ なぜ openpyxl を入れないのか
`requirements.txt` は `flask` だけの世界で、現場のWindows端末は**社内で閉じて
動く**（CLAUDE.md「外部のアイコンフォントは取りに行けない」のと同じ前提）。
端末を1台増やすたびに pip が通る保証は無いので、**入れた瞬間に「その端末では
起動しない」を作れる**。`.xlsx` は ZIP + XML なので、`zipfile` と
`xml.etree` だけで書けるし読める——実証済み（`tests/test_xlsxio.py`）。

■ CSVにしない理由
利用者が**Excelで作ったファイルを取り込む**のがこの機能の主目的なので、
読めなければ意味が無い。CSVだと毎回「名前を付けて保存 → CSV」を挟ませる
ことになるうえ、Excelは開いた時点で先頭ゼロを落とし日付へ化けさせる。

■ 書く側の決めごと
- **文字列は必ず `inlineStr`**。共有文字列表(`sharedStrings.xml`)を持たない
  ぶん少しファイルが大きくなるが、**先頭ゼロ（`007`）が数値へ落ちない**し、
  部品が1つ減る。ロールの基準番号は先頭ゼロを持ちうる。
- 見出し行は固定（freeze pane）、列幅は指定できる。**中身の長さから決める**
  のは呼ぶ側の仕事（§CLAUDE 11）。

■ 読む側の決めごと
**Excelが吐く形をそのまま受ける**こと。手で作った素直なXMLしか読めない
実装にすると、利用者の実ファイルで必ず落ちる。具体的には:
- 文字列は `sharedStrings.xml` 経由（`t="s"`）で来る。`inlineStr` も `str`
  （数式の結果）も来る。
- **空セルは要素ごと省略される。** `r="D4"` の座標から列位置を復元しないと、
  Bが空の行で**値が1つ左へずれる**（気づけない壊れ方。数値の列に文字が
  入って「取り込んだら別のロールになっていた」になる）。
- 行番号も飛ぶ。1枚目のシートは `worksheets/sheet1.xml` とは限らない
  （`workbook.xml` の並び順 → rels → 実体、と辿る）。
- **壊れたファイルは例外ではなく理由を返す**（§CLAUDE 4）。「取り込めません」
  だけでは、ファイルが違うのかシートが空なのか分からない。
"""
import re
import zipfile
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape

NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
_M = '{%s}' % NS_MAIN
_R = '{%s}' % NS_REL

# Excelの上限。これを超えると Excel 自身が開けないので、書く前に断る。
MAX_ROWS = 1048576
MAX_COLS = 16384


class XlsxError(ValueError):
    """読み書きの失敗。**文面はそのまま画面に出す**ので、日本語で理由を書く。"""


def col_letter(n):
    """1 -> A, 27 -> AA。"""
    s = ''
    while n > 0:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def col_index(ref):
    """'C5' -> 3。座標が読めなければ None。"""
    m = re.match(r'([A-Za-z]+)', str(ref or ''))
    if not m:
        return None
    n = 0
    for ch in m.group(1).upper():
        n = n * 26 + (ord(ch) - 64)
    return n


# XMLに入れられない制御文字（Excelが開けなくなる）。**黙って落とす**——
# ここで例外にすると、1文字のゴミで書き出しごとできなくなる。
_BAD_CHARS = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f]')


def _text(v):
    return _BAD_CHARS.sub('', str(v))


def _is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def write_sheet(header, rows, widths=None, sheet_name='Sheet1'):
    """1枚のシートだけの .xlsx を bytes で返す。

    `header` は文字列の並び、`rows` は値の並びの並び。値は
    **数値ならセルも数値**、それ以外は文字列（`None`/`''` は空セル）。
    `widths` は文字数の目安（Excelの列幅の単位）。
    """
    header = list(header or [])
    rows = list(rows or [])
    ncol = max([len(header)] + [len(r) for r in rows] + [1])
    if ncol > MAX_COLS:
        raise XlsxError('列が多すぎてExcelで開けません（%d列）。' % ncol)
    if len(rows) + 1 > MAX_ROWS:
        raise XlsxError('行が多すぎてExcelで開けません（%d行）。' % (len(rows) + 1))

    def cell(ci, ri, v):
        if v is None or v == '':
            return ''
        ref = '%s%d' % (col_letter(ci), ri)
        if _is_num(v):
            return '<c r="%s"><v>%s</v></c>' % (ref, v)
        return ('<c r="%s" t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>'
                % (ref, escape(_text(v))))

    body = ['<row r="1">' + ''.join(cell(i + 1, 1, h) for i, h in enumerate(header)) + '</row>']
    for ri, r in enumerate(rows, start=2):
        body.append('<row r="%d">' % ri
                    + ''.join(cell(i + 1, ri, v) for i, v in enumerate(r)) + '</row>')
    cols = ''
    if widths:
        cols = '<cols>' + ''.join(
            '<col min="%d" max="%d" width="%s" customWidth="1"/>' % (i + 1, i + 1, float(w))
            for i, w in enumerate(widths) if w) + '</cols>'
    sheet_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="%s">'
        '<sheetViews><sheetView workbookViewId="0">'
        # 見出し行は固定する。100本のロールを見るのに毎回上へ戻らせない。
        '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
        '</sheetView></sheetViews>'
        '%s<sheetData>%s</sheetData></worksheet>'
        % (NS_MAIN, cols, ''.join(body)))
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '</Types>')
    root_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="%s/officeDocument" Target="xl/workbook.xml"/>'
        '</Relationships>' % NS_REL)
    workbook = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="%s" xmlns:r="%s">'
        '<sheets><sheet name="%s" sheetId="1" r:id="rId1"/></sheets></workbook>'
        % (NS_MAIN, NS_REL, escape(_sheet_name(sheet_name))))
    wb_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="%s/worksheet" Target="worksheets/sheet1.xml"/>'
        '</Relationships>' % NS_REL)
    import io
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', content_types)
        z.writestr('_rels/.rels', root_rels)
        z.writestr('xl/workbook.xml', workbook)
        z.writestr('xl/_rels/workbook.xml.rels', wb_rels)
        z.writestr('xl/worksheets/sheet1.xml', sheet_xml)
    return buf.getvalue()


# シート名にExcelが許さない文字（: \ / ? * [ ]）と31文字の上限。
_BAD_SHEET = re.compile(r'[:\\/?*\[\]]')


def _sheet_name(name):
    n = _BAD_SHEET.sub('_', _text(name or '')).strip() or 'Sheet1'
    return n[:31]


def _first_sheet_part(z):
    """1枚目のシートの実体パス。**`sheet1.xml` と決め打ちしない**——
    Excelが作り直したブックでは名前も rId も揃っていない。"""
    names = set(z.namelist())
    if 'xl/workbook.xml' not in names:
        return None
    wb = ET.fromstring(z.read('xl/workbook.xml'))
    sheets = wb.find(_M + 'sheets')
    if sheets is None or not len(sheets):
        return None
    first = list(sheets)[0]
    rid = first.get(_R + 'id')
    title = first.get('name') or ''
    target = None
    if 'xl/_rels/workbook.xml.rels' in names:
        rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
        for rel in rels:
            if rel.get('Id') == rid:
                target = rel.get('Target')
                break
    if not target:
        target = 'worksheets/sheet1.xml'
    part = target.lstrip('/') if target.startswith('/') else 'xl/' + target.lstrip('./')
    return (part, title) if part in names else None


def read_sheet(data, max_rows=20000):
    """1枚目のシートを `{'sheet':名前,'rows':[[値,…],…]}` で返す。

    値は**すべて文字列**（数値も文字列で返す）。型を決めるのは呼ぶ側の仕事
    ——ロールの「本数」を数として読むか文字として読むかは業務の話で、
    ここが勝手に決めると先頭ゼロが消える。
    """
    if not data:
        raise XlsxError('ファイルが空です。')
    import io
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise XlsxError('Excelのファイル（.xlsx）として読めません。'
                        '古い形式（.xls）やCSVは、Excelで「.xlsx」として'
                        '保存し直してから取り込んでください。')
    with z:
        try:
            hit = _first_sheet_part(z)
        except ET.ParseError:
            raise XlsxError('Excelのファイルとして読めません（中身が壊れています）。')
        if not hit:
            raise XlsxError('シートが1枚も見つかりません。')
        part, title = hit
        shared = []
        if 'xl/sharedStrings.xml' in z.namelist():
            try:
                ss = ET.fromstring(z.read('xl/sharedStrings.xml'))
                for si in ss:
                    shared.append(''.join(t.text or '' for t in si.iter(_M + 't')))
            except ET.ParseError:
                shared = []          # 共有文字列が壊れていても数値は読める
        try:
            sh = ET.fromstring(z.read(part))
        except ET.ParseError:
            raise XlsxError('シートの中身が読めません（ファイルが壊れています）。')
        rows = []
        for row in sh.iter(_M + 'row'):
            cells = {}
            for c in row:
                if not c.tag.endswith('}c'):
                    continue
                ci = col_index(c.get('r'))
                if ci is None:
                    # 座標が無いブックもある。**位置で数え直さない**——
                    # 空セルが省略されているとずれるので、この行は
                    # 出てきた順に詰める（座標つきの行と混ざらない）。
                    ci = len(cells) + 1
                t = c.get('t')
                if t == 's':
                    v = c.find(_M + 'v')
                    try:
                        idx = int(v.text) if v is not None and v.text else -1
                    except ValueError:
                        idx = -1
                    val = shared[idx] if 0 <= idx < len(shared) else ''
                elif t == 'inlineStr':
                    node = c.find(_M + 'is')
                    val = ''.join(x.text or '' for x in node.iter(_M + 't')) if node is not None else ''
                else:
                    v = c.find(_M + 'v')
                    val = v.text if v is not None and v.text is not None else ''
                cells[ci] = str(val)
            if not cells:
                continue
            width = max(cells)
            rows.append([cells.get(i + 1, '') for i in range(width)])
            if len(rows) >= max_rows:
                break
        return {'sheet': title, 'rows': rows}
