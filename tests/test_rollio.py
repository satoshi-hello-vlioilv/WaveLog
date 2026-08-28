# -*- coding: utf-8 -*-
"""ロールマスタのExcel持ち出し・取り込み(§9.240、利用者の指示)。

  「追加実装した、ロールマスタについて EXCELでのインポート＆エクスポート
   機能を実装してください。」

ここで固定すること:
 1. `.xlsx` を**追加ライブラリなし**で書ける／読める（往復する）
 2. **利用者がExcelで作った形**を読める——共有文字列(sharedStrings)・
    空セルの省略・シート名/rIdが任意・行番号の飛び
 3. 先頭ゼロ（`007`）が数値へ落ちない
 4. 突き合わせは**(設備名, ロール名, 接触面, 径MAX, 径MIN, 備考)**
    （§9.246 ⑤／§9.257 ③）。設備が違えば同名でも別の行。**接触面ちがい
    （上／下／上下）も、径ちがい・備考ちがいも別の行**。
    **鍵の列を書き直した行は「上書き」ではなく「追加」になる**——下見の
    件数がそう言い、`replace='file'`なら古い行が消える。ここを取り違えると
    「直したつもりが増える」ので、往復の網は**鍵でない列**（基準番号）で
    「書けたこと」を確かめる。
 5. **下見（保存しない）ができる**——何件追加・何件上書きかを書く前に返す
 6. **飛ばした行は理由つきで返す**（黙って減らさない）
 7. 壊れたファイルは**例外ではなく理由**で断る
 8. 書き出しは**無効な行も出す**（往復で消えない）

**素通りに注意**: 自分が書いた .xlsx を自分で読み返すだけでは、Excel が吐く
形（共有文字列・空セル省略）を一度も通らない。**手で組んだExcel風の
ファイル**を必ず1本通すこと。
"""
import os
import sys
import json
import base64
import zipfile
import urllib.request
import urllib.error
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
B = 'http://127.0.0.1:5029'
EQ, EQ2 = 'テスト設備A', 'テスト設備B'
TAG = 'RX%d' % os.getpid()

R = []


def rec(n, ok, d=''):
    R.append(bool(ok))
    print(('PASS' if ok else 'FAIL') + ': ' + n + (' -- ' + str(d) if d else ''))


def get(path):
    with urllib.request.urlopen(B + path, timeout=30) as r:
        return r.read(), dict(r.headers)


def post(path, body):
    req = urllib.request.Request(B + path, data=json.dumps(body, ensure_ascii=False).encode(),
                                 headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.getcode(), json.loads(r.read())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except Exception:
            return e.code, {}


def getj(path):
    with urllib.request.urlopen(B + path, timeout=30) as r:
        return json.loads(r.read())


def excel_like(rows_xml, sheet_part='xl/worksheets/mySheet.xml', shared=()):
    """**本物のExcelが吐く形**を手で組む（共有文字列・任意のシート名/rId）。"""
    ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
    rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
    target = sheet_part.split('xl/', 1)[1]
    ct = ('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
          '<Default Extension="xml" ContentType="application/xml"/>'
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
          '<Override PartName="/%s" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
          '</Types>' % sheet_part)
    rels = ('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="%s/officeDocument" Target="xl/workbook.xml"/></Relationships>' % rel)
    wb = ('<?xml version="1.0"?><workbook xmlns="%s" xmlns:r="%s">'
          '<sheets><sheet name="ロール一覧" sheetId="1" r:id="rId9"/></sheets></workbook>' % (ns, rel))
    wbr = ('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
           '<Relationship Id="rId9" Type="%s/worksheet" Target="%s"/>'
           '<Relationship Id="rIdS" Type="%s/sharedStrings" Target="sharedStrings.xml"/>'
           '</Relationships>' % (rel, target, rel))
    ss = ('<?xml version="1.0"?><sst xmlns="%s" count="%d" uniqueCount="%d">%s</sst>'
          % (ns, len(shared), len(shared),
             ''.join('<si><t xml:space="preserve">%s</t></si>' % x for x in shared)))
    sheet = ('<?xml version="1.0"?><worksheet xmlns="%s"><sheetData>%s</sheetData></worksheet>'
             % (ns, rows_xml))
    import io
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', ct)
        z.writestr('_rels/.rels', rels)
        z.writestr('xl/workbook.xml', wb)
        z.writestr('xl/_rels/workbook.xml.rels', wbr)
        z.writestr('xl/sharedStrings.xml', ss)
        z.writestr(sheet_part, sheet)
    return buf.getvalue()


made = []
try:
    post('/api/access-mode', {'mode': 'edit'})

    # ---- 0) モジュール単体: 往復と断り方 ----
    from backend.xlsx_io import write_sheet, read_sheet, XlsxError, col_letter, col_index
    rec('列の記号と番号が往復する',
        col_letter(1) == 'A' and col_letter(27) == 'AA' and col_index('AA9') == 27,
        '%s/%s/%s' % (col_letter(1), col_letter(27), col_index('AA9')))
    data = write_sheet(['あ', 'い', 'う'], [['日本語', 250, '007'], ['x', None, '']],
                       widths=[10, 10, 10], sheet_name='テスト/名前?')
    back = read_sheet(data)
    rec('自分で書いた.xlsxを読み返せる（日本語も）',
        back['rows'][0] == ['あ', 'い', 'う'] and back['rows'][1][0] == '日本語',
        json.dumps(back['rows'], ensure_ascii=False))
    rec('先頭ゼロが数値へ落ちない', back['rows'][1][2] == '007',
        json.dumps(back['rows'][1], ensure_ascii=False))
    rec('シート名の使えない文字を落として31字に収める',
        '/' not in back['sheet'] and '?' not in back['sheet'] and len(back['sheet']) <= 31,
        back['sheet'])
    # **書き出したファイルをExcelで直して戻す往復**を守る要（§9.240 の追補）。
    # 文字のセルに「文字」の書式（numFmtId=49＝`@`）が当たっていないと、
    # 利用者がExcelでそのセルを直した瞬間に「標準」書式が働き `007` が `7` に
    # なる。**読めることだけを見る網では捕まらない**（こちらが書いた直後は
    # 文字のままなので必ず通る）ので、XMLに書式が乗っていることを直に見る。
    import zipfile as _zip, io as _io, re as _re
    with _zip.ZipFile(_io.BytesIO(data)) as _z:
        names = set(_z.namelist())
        sheet_xml = _z.read('xl/worksheets/sheet1.xml').decode('utf-8')
        styles = _z.read('xl/styles.xml').decode('utf-8') if 'xl/styles.xml' in names else ''
    rec('書式の定義（styles.xml）を同梱する', 'xl/styles.xml' in names,
        json.dumps(sorted(names), ensure_ascii=False))
    rec('「文字」の書式（numFmtId=49＝@）を持っている', 'numFmtId="49"' in styles,
        styles[:160])
    rec('文字のセルに書式を当てている（Excelで直しても先頭ゼロが消えない）',
        bool(_re.search(r'<c r="C2" s="\d+" t="inlineStr"', sheet_xml)),
        (_re.search(r'<c r="C2"[^>]*>', sheet_xml) or [''])[0]
        if _re.search(r'<c r="C2"[^>]*>', sheet_xml) else sheet_xml[:120])
    rec('数値のセルには文字の書式を当てない（数として計算できる）',
        bool(_re.search(r'<c r="B2"><v>', sheet_xml)),
        (_re.search(r'<c r="B2"[^>]*>', sheet_xml).group(0)
         if _re.search(r'<c r="B2"[^>]*>', sheet_xml) else sheet_xml[:120]))
    # 長すぎる値は**印を付けて**切る（切らないとExcelがファイルごと開けない）
    from backend.xlsx_io import MAX_CELL_CHARS
    longv = read_sheet(write_sheet(['x'], [['あ' * (MAX_CELL_CHARS + 500)]]))['rows'][1][0]
    rec('長すぎる値は上限まで切る（Excelが開けなくならない）',
        len(longv) == MAX_CELL_CHARS, str(len(longv)))
    rec('切ったことが読めるように印を付ける（黙って減らさない）',
        '省略' in longv[-30:], longv[-30:])

    for bad, label in ((b'', '空'), (b'not a zip', 'zipでない')):
        try:
            read_sheet(bad)
            rec('壊れたファイル(%s)を理由つきで断る' % label, False, '例外が出なかった')
        except XlsxError as e:
            rec('壊れたファイル(%s)を理由つきで断る' % label, len(str(e)) > 8, str(e)[:50])

    # ---- 1) 書き出し（HTTP） ----
    a = post('/api/roll-master', {'user_id': 'test', 'equipment': EQ, 'name': TAG + 'A',
                                  'diaMax': 250, 'diaMin': 200, 'refNo': '007',
                                  'entryPos': '入側', 'count': 2})[1]
    if a.get('id'):
        made.append(a['id'])
    b = post('/api/roll-master', {'user_id': 'test', 'equipment': EQ2, 'name': TAG + 'A',
                                  'diaMax': 100})[1]
    if b.get('id'):
        made.append(b['id'])
    # **無効にした行も書き出しに出ること**（出さないと往復で消える）
    off = post('/api/roll-master', {'user_id': 'test', 'equipment': EQ, 'name': TAG + 'OFF',
                                    'diaMax': 111, 'enabledText': '無効'})[1]
    if off.get('id'):
        made.append(off['id'])

    raw, headers = get('/api/roll-master/export')
    rec('書き出しは.xlsxとして返る',
        raw[:2] == b'PK' and 'sheet' in (headers.get('Content-Type') or ''),
        '%s / %s' % (raw[:2], headers.get('Content-Type')))
    rec('ファイル名が付いている（添付として落ちる）',
        'attachment' in (headers.get('Content-Disposition') or ''),
        headers.get('Content-Disposition'))
    sheet = read_sheet(raw)
    head = sheet['rows'][0]
    from backend.repositories import roll_repo as rr
    rec('見出しはIO_COLUMNSの1箇所が持つ（書き写していない）',
        head == list(rr.IO_HEADER), json.dumps(head, ensure_ascii=False))
    rec('IDの列は運ばない', not any('ID' in x for x in head),
        json.dumps(head, ensure_ascii=False))
    # **鍵は (設備名, ロール名)**。ロール名だけを鍵にすると、設備違いの同名が
    # 互いを上書きして「先頭ゼロが消えた」ように見える（この網が実際に踏んだ）。
    body = {}
    for r in sheet['rows'][1:]:
        if len(r) > head.index('ロール名'):
            body[(r[head.index('設備名')], r[head.index('ロール名')])] = r
    rec('無効にした行も書き出す（往復で消えない）',
        (EQ, TAG + 'OFF') in body and body[(EQ, TAG + 'OFF')][head.index('有効')] == '無効',
        json.dumps(body.get((EQ, TAG + 'OFF')), ensure_ascii=False))
    rec('先頭ゼロの基準番号がそのまま出る',
        body.get((EQ, TAG + 'A'), [''] * 20)[head.index('基準番号')] == '007',
        json.dumps(body.get((EQ, TAG + 'A')), ensure_ascii=False))
    rec('同じロール名でも設備ごとに別の行として書き出す',
        (EQ, TAG + 'A') in body and (EQ2, TAG + 'A') in body,
        json.dumps(sorted(k[0] for k in body if k[1] == TAG + 'A'), ensure_ascii=False))
    one = read_sheet(get('/api/roll-master/export?equipment=' + urllib.parse.quote(EQ))[0])
    names = [r[head.index('設備名')] for r in one['rows'][1:] if r]
    rec('設備を指定するとその設備だけ書き出す',
        names and all(n == EQ for n in names), json.dumps(sorted(set(names)), ensure_ascii=False))

    # ---- 2) 取り込み: 下見は書き込まない ----
    hi = head.index
    def row_for(eq, name, dmax, ref=''):
        r = [''] * len(head)
        r[hi('設備名')] = eq; r[hi('ロール名')] = name
        r[hi('ロール径MAX')] = dmax; r[hi('基準番号')] = ref
        r[hi('有効')] = '有効'
        return r
    # **上書きの証拠は鍵でない列で立てる**（§9.257 ③）——径は鍵なので、
    # ここを変えると「上書き」ではなく「追加」になる（それは下の 3b で見る）。
    up = write_sheet(head, [row_for(EQ, TAG + 'A', 250, '008'),
                            row_for(EQ, TAG + 'NEW', 300, '009')])
    code, dry = post('/api/roll-master/import',
                     {'user_id': 'test', 'fileBase64': base64.b64encode(up).decode()})
    rec('下見が通る', code == 200 and dry.get('ok'), json.dumps(dry, ensure_ascii=False)[:200])
    rec('下見は「追加1・上書き1」と数える',
        dry.get('add') == 1 and dry.get('update') == 1,
        json.dumps({'add': dry.get('add'), 'update': dry.get('update')}))
    rec('下見は dryRun と名乗る', dry.get('dryRun') is True, str(dry.get('dryRun')))
    after = [x for x in getj('/api/roll-master')['items'] if x['name'] == TAG + 'A'
             and x['equipment'] == EQ]
    rec('下見では1件も書き込まない',
        after and after[0]['diaMax'] == 250, json.dumps(after[:1], ensure_ascii=False))
    rec('下見では新しい行も作らない',
        not any(x['name'] == TAG + 'NEW' for x in getj('/api/roll-master')['items']), '')

    # ---- 3) 取り込み: 適用 ----
    code, done = post('/api/roll-master/import',
                      {'user_id': 'test', 'fileBase64': base64.b64encode(up).decode(),
                       'apply': True})
    rec('適用が通る', code == 200 and done.get('saved') == 2,
        json.dumps(done, ensure_ascii=False)[:200])
    items = getj('/api/roll-master')['items']
    upd = [x for x in items if x['name'] == TAG + 'A' and x['equipment'] == EQ]
    new = [x for x in items if x['name'] == TAG + 'NEW']
    for x in new:
        made.append(x['id'])
    rec('上書きが効く（基準番号が変わる）',
        upd and upd[0]['refNo'] == '008' and upd[0]['diaMax'] == 250,
        json.dumps(upd[:1], ensure_ascii=False))
    rec('送っていない列は消えない（入出位置が残る）',
        upd and upd[0]['entryPos'] == '入側', json.dumps(upd[:1], ensure_ascii=False))
    rec('追加が効く', len(new) == 1 and new[0]['diaMax'] == 300,
        json.dumps(new, ensure_ascii=False))
    other = [x for x in items if x['name'] == TAG + 'A' and x['equipment'] == EQ2]
    rec('設備が違う同名の行は巻き添えにしない',
        other and other[0]['diaMax'] == 100, json.dumps(other, ensure_ascii=False))

    # ---- 3b) 鍵の列（径・備考）は「区別する情報」（§9.257 ③、利用者の指示） ----
    #
    #   「ロールマスタについて、設備＆ロール名＆接触面だけでなく、ロール径と
    #    備考の内容も区別する情報に加えてください。」
    #
    # 現場には**同じ設備・同じ名前・同じ接触面で径だけ／備考だけが違う**ロールが
    # 在る。直す前は自然キーが (設備名, ロール名, 接触面) だったので、2本目は
    # 1本目を上書きし、**最後の行しか残らなかった**（§9.246 ⑤で接触面について
    # 直したのとまったく同じ形）。
    #
    # **裏返しの約束も一緒に固定する**——鍵に入った以上、Excelでそこを書き直した
    # 行は「上書き」ではなく**追加**になる。下見がそう言うことまで見る（黙って
    # 増えるのがいちばん困る）。
    dia2 = write_sheet(head, [row_for(EQ, TAG + 'A', 999, '010')])
    code, ddry = post('/api/roll-master/import',
                      {'user_id': 'test', 'fileBase64': base64.b64encode(dia2).decode()})
    rec('径を書き直した行は下見で「追加」と言う（黙って増やさない）',
        code == 200 and ddry.get('add') == 1 and ddry.get('update') == 0,
        json.dumps({'add': ddry.get('add'), 'update': ddry.get('update')}))
    code, dap = post('/api/roll-master/import',
                     {'user_id': 'test', 'fileBase64': base64.b64encode(dia2).decode(),
                      'apply': True})
    twoA = [x for x in getj('/api/roll-master')['items']
            if x['name'] == TAG + 'A' and x['equipment'] == EQ]
    for x in twoA:
        if x['id'] not in made:
            made.append(x['id'])
    rec('径ちがいの同名ロールが2本とも残る（欠損しない）',
        len(twoA) == 2 and sorted(x['diaMax'] for x in twoA) == [250.0, 999.0],
        json.dumps(sorted(x['diaMax'] for x in twoA)))
    rec('径ちがいの2本目は元の行を塗り潰さない（基準番号がそのまま）',
        sorted(x['refNo'] for x in twoA) == ['008', '010'],
        json.dumps(sorted(x['refNo'] for x in twoA), ensure_ascii=False))
    # 備考も同じ。**5つとも同じでなければ別の行**。
    def note_row(note, ref):
        r = row_for(EQ, TAG + 'NOTE', 400, ref)
        r[hi('備考')] = note
        return r
    code, nap = post('/api/roll-master/import',
                     {'user_id': 'test', 'apply': True, 'fileBase64': base64.b64encode(
                         write_sheet(head, [note_row('予備', 'N1'),
                                            note_row('本番', 'N2')])).decode()})
    nrows = [x for x in getj('/api/roll-master')['items'] if x['name'] == TAG + 'NOTE']
    for x in nrows:
        made.append(x['id'])
    rec('備考ちがいの同名・同径ロールも2本とも残る（§9.257 ③）',
        nap.get('add') == 2 and len(nrows) == 2
        and sorted(x['note'] for x in nrows) == ['予備', '本番'],
        json.dumps(sorted((x['note'], x['refNo']) for x in nrows), ensure_ascii=False))
    # もう一度同じファイルを入れると**増えない**（鍵が効いている証拠）。
    code, nap2 = post('/api/roll-master/import',
                      {'user_id': 'test', 'apply': True, 'fileBase64': base64.b64encode(
                          write_sheet(head, [note_row('予備', 'N3'),
                                             note_row('本番', 'N4')])).decode()})
    nrows2 = [x for x in getj('/api/roll-master')['items'] if x['name'] == TAG + 'NOTE']
    rec('備考が同じなら2度目は上書き（増えない）',
        nap2.get('update') == 2 and nap2.get('add') == 0 and len(nrows2) == 2
        and sorted(x['refNo'] for x in nrows2) == ['N3', 'N4'],
        json.dumps({'res': {k: nap2.get(k) for k in ('add', 'update')},
                    'rows': len(nrows2)}, ensure_ascii=False))

    # ---- 4) 本物のExcelが吐く形（共有文字列・空セル省略・シート名任意） ----
    shared = ['設備名', 'ロール名', 'ロール径MAX', '基準番号', EQ, TAG + 'XL', '007']
    rows_xml = (
        '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c>'
        '<c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row>'
        # B と C を要素ごと省略（＝ここで列がずれる実装は基準番号を径として読む）
        '<row r="3"><c r="A3" t="s"><v>4</v></c><c r="B3" t="s"><v>5</v></c>'
        '<c r="D3" t="s"><v>6</v></c></row>')
    xl = excel_like(rows_xml, shared=shared)
    code, r4 = post('/api/roll-master/import',
                    {'user_id': 'test', 'fileBase64': base64.b64encode(xl).decode(),
                     'apply': True})
    rec('Excelが吐く形（共有文字列・任意のシート名）を取り込める',
        code == 200 and r4.get('saved') == 1, json.dumps(r4, ensure_ascii=False)[:200])
    xlrow = [x for x in getj('/api/roll-master')['items'] if x['name'] == TAG + 'XL']
    for x in xlrow:
        made.append(x['id'])
    rec('空セルが省略されていても列がずれない（径は空・基準番号は007）',
        xlrow and xlrow[0]['diaMax'] is None and xlrow[0]['refNo'] == '007',
        json.dumps(xlrow, ensure_ascii=False))

    # ---- 5) 飛ばす行は理由つきで返す ----
    bad_rows = [row_for('', TAG + 'NOEQ', 100),                 # 設備が空
                row_for('存在しない設備' + TAG, TAG + 'UNK', 100),  # 設備マスタに無い
                row_for(EQ, '', 100),                            # ロール名が空
                row_for(EQ, TAG + 'BADNUM', 'あいう')]           # 数として読めない
    r5 = post('/api/roll-master/import',
              {'user_id': 'test', 'fileBase64': base64.b64encode(
                  write_sheet(head, bad_rows)).decode()})[1]
    sk = r5.get('skipped') or []
    rec('取り込めない行は全部返す（4件）', len(sk) == 4, json.dumps(sk, ensure_ascii=False))
    rec('飛ばした理由を名指しする',
        all(x.get('why') for x in sk)
        and any('設備' in x['why'] for x in sk)
        and any('数' in x['why'] for x in sk),
        json.dumps([x.get('why') for x in sk], ensure_ascii=False))
    rec('飛ばした行の行番号を返す（直せるように）',
        all(isinstance(x.get('row'), int) for x in sk),
        json.dumps([x.get('row') for x in sk]))

    # 径MIN>MAX も断る（登録APIと同じ判断を通っていること）
    mm = row_for(EQ, TAG + 'MINMAX', 100)
    mm[hi('ロール径MIN')] = 200
    r6 = post('/api/roll-master/import',
              {'user_id': 'test', 'fileBase64': base64.b64encode(
                  write_sheet(head, [mm])).decode()})[1]
    rec('径MIN>MAXは取り込みでも断る',
        len(r6.get('skipped') or []) == 1 and 'MIN' in (r6['skipped'][0].get('why') or ''),
        json.dumps(r6.get('skipped'), ensure_ascii=False))

    # ---- 6) 見出しが無い／空のシートは理由で断る ----
    code, r7 = post('/api/roll-master/import',
                    {'user_id': 'test', 'fileBase64': base64.b64encode(
                        write_sheet(['よくわからない列'], [['x']])).decode()})
    rec('見出しが違うファイルは理由つきで断る',
        code == 400 and 'ロール名' in (r7.get('error') or ''), json.dumps(r7, ensure_ascii=False))
    # ---- 8) 接触面ちがいの同名ロールを潰さない（§9.246 ⑤、利用者の指示） ----
    #
    #   「ロールマスタの接触面は『上』『下』だけではなく、『上下』というものも
    #    存在するので、インポート時にデータ欠損させないように修正してください」
    #
    # 直す前は自然キーが (設備名, ロール名) だけだったので、この3行を取り込むと
    # `roll_upsert()` が同じ行を引き当てて**上書きし続け、最後の1行しか
    # 残らなかった**。**3件とも別の行として残ること**を見る。
    # **件数だけを見ないこと**——径まで突き合わせないと、3行あっても中身が
    # 同じ（＝最後の値で全部上書き）という壊れ方を見逃す。
    FACES = [('上', 101.0), ('下', 102.0), ('上下', 103.0)]
    def face_row(face, dmax, ref=''):
        r = [''] * len(head)
        r[hi('設備名')] = EQ
        r[hi('ロール名')] = TAG + 'FACE'
        r[hi('接触面')] = face
        r[hi('ロール径MAX')] = dmax
        r[hi('基準番号')] = ref
        return r
    code, rf = post('/api/roll-master/import', {
        'user_id': 'test', 'apply': True,
        'fileBase64': base64.b64encode(
            write_sheet(tuple(head), [face_row(f, d) for f, d in FACES])).decode()})
    rec('接触面ちがいの3行が3件とも取り込まれる（欠損しない）',
        code == 200 and rf.get('saved') == 3 and rf.get('add') == 3,
        json.dumps(rf, ensure_ascii=False))
    got = {x['contactFace']: x for x in getj('/api/roll-master')['items']
           if x['name'] == TAG + 'FACE'}
    rec('上・下・上下がそれぞれ別の行として残る',
        sorted(got) == ['上', '上下', '下'], json.dumps(sorted(got), ensure_ascii=False))
    rec('3行それぞれの径がそのまま入る（最後の1行で塗り潰されていない）',
        all(got.get(f, {}).get('diaMax') == d for f, d in FACES),
        json.dumps({k: v.get('diaMax') for k, v in got.items()}, ensure_ascii=False))
    # 2回目は**上書き**（増やさない）。キーを足しただけで往復が壊れていないか。
    # **鍵の列（径）は変えないこと**（§9.257 ③）——変えると別のロールなので
    # 追加になる。書けたことは鍵でない列（基準番号）で見る。
    code, rf2 = post('/api/roll-master/import', {
        'user_id': 'test', 'apply': True,
        'fileBase64': base64.b64encode(
            write_sheet(tuple(head), [face_row(f, d, 'F2') for f, d in FACES])).decode()})
    again = [x for x in getj('/api/roll-master')['items'] if x['name'] == TAG + 'FACE']
    rec('同じファイルをもう一度取り込んでも増えない（3件を上書き）',
        rf2.get('update') == 3 and rf2.get('add') == 0 and len(again) == 3
        and all(x['refNo'] == 'F2' for x in again),
        json.dumps({'res': rf2, 'rows': len(again)}, ensure_ascii=False))
    # 画面（登録API）からも2本目を置ける。直す前は「同じ名前のロールを2つ
    # 置けません」で弾かれ、**現場のロールを登録すらできなかった**。
    code, rn = post('/api/roll-master', {
        'user_id': 'test', 'equipment': EQ, 'name': TAG + 'UI', 'contactFace': '上',
        'diaMax': 200})
    code2, rn2 = post('/api/roll-master', {
        'user_id': 'test', 'equipment': EQ, 'name': TAG + 'UI', 'contactFace': '下',
        'diaMax': 201})
    ui = [x for x in getj('/api/roll-master')['items'] if x['name'] == TAG + 'UI']
    rec('画面からも接触面ちがいの同名ロールを2本登録できる',
        code == 200 and code2 == 200 and len(ui) == 2,
        json.dumps({'1': code, '2': code2, 'rows': len(ui),
                    'err': rn2.get('error')}, ensure_ascii=False))
    # **同じ接触面**の2本目は今までどおり断る（どちらの径で判定するか決まらない）。
    code3, rn3 = post('/api/roll-master', {
        'user_id': 'test', 'equipment': EQ, 'name': TAG + 'UI2', 'contactFace': '上',
        'diaMax': 300})
    ui_ids = [x['id'] for x in getj('/api/roll-master')['items'] if x['name'] == TAG + 'UI']
    # **径ちがいなら置ける**（§9.257 ③、利用者の指示）——同じ設備・同じ名前・
    # 同じ接触面でも、径が違えば別のロール。直す前はここで断っていた。
    code3b, rn3b = post('/api/roll-master/update', {
        'user_id': 'test', 'id': ui_ids[1],
        'equipment': EQ, 'name': TAG + 'UI2', 'contactFace': '上', 'diaMax': 301})
    ui2 = [x for x in getj('/api/roll-master')['items'] if x['name'] == TAG + 'UI2']
    rec('同じ設備・同名・同じ接触面でも径が違えば置ける（§9.257 ③）',
        code3b == 200 and len(ui2) == 2
        and sorted(x['diaMax'] for x in ui2) == [300.0, 301.0],
        json.dumps({'code': code3b, 'dia': sorted(x['diaMax'] for x in ui2),
                    'err': rn3b.get('error')}, ensure_ascii=False))
    # **6つとも同じ**の2本目は今までどおり断る（どちらの径で判定するか決まらない）。
    code4, rn4 = post('/api/roll-master/update', {
        'user_id': 'test', 'id': ui_ids[1],
        'equipment': EQ, 'name': TAG + 'UI2', 'contactFace': '上', 'diaMax': 300})
    rec('鍵が6つとも同じ同名ロールは今までどおり断る（理由に鍵の列を出す）',
        code4 == 400 and '接触面' in (rn4.get('error') or '')
        and 'ロール径MAX' in (rn4.get('error') or ''),
        json.dumps(rn4, ensure_ascii=False))
    # **鍵の列を持たないシート**を、その列で割ったあとのマスタへ取り込むと、
    # (設備,ロール名)では3本とも当たる——**どれを直すか決められない**ので
    # 黙って1本を上書きせず、理由つきで断る（§CLAUDE 4）。
    # ※ここが「キーを足すだけでは足りない残りの穴」。
    # **鍵を1つも言わない形で見ること**（§9.257 ③）——径だけを言えば、その径で
    # 1本に絞れる（絞れたら断る理由が無い）ので、この網を通らない。
    noface_head = [h for h in head if h not in ('接触面', 'ロール径MAX', 'ロール径MIN')]
    nf = [''] * len(noface_head)
    nf[noface_head.index('設備名')] = EQ
    nf[noface_head.index('ロール名')] = TAG + 'FACE'
    nf[noface_head.index('基準番号')] = 'NG'
    code, ra = post('/api/roll-master/import', {
        'user_id': 'test', 'apply': True, 'fileBase64': base64.b64encode(
            write_sheet(tuple(noface_head), [nf])).decode()})
    still = {x['contactFace']: x.get('refNo')
             for x in getj('/api/roll-master')['items'] if x['name'] == TAG + 'FACE'}
    rec('鍵の列が無いシートは、当たる行が複数あるとき断る（黙って潰さない）',
        code == 200 and ra.get('saved', 0) == 0
        and 'のどれかが違う行が複数' in json.dumps(ra.get('skipped'), ensure_ascii=False),
        json.dumps(ra, ensure_ascii=False))
    rec('断ったので3本は1つも書き換わっていない',
        len(still) == 3 and 'NG' not in still.values(),
        json.dumps(still, ensure_ascii=False))
    # **径まで言えば1本に絞れる**ので、こちらは通る（断るのは絞れないときだけ）。
    nf2 = list(nf)
    nf2[noface_head.index('基準番号')] = 'OK'
    okhead = [h for h in head if h != '接触面']
    nf3 = [''] * len(okhead)
    nf3[okhead.index('設備名')] = EQ
    nf3[okhead.index('ロール名')] = TAG + 'FACE'
    nf3[okhead.index('ロール径MAX')] = 101.0        # 「上」の径
    nf3[okhead.index('基準番号')] = 'OK'
    code, rok = post('/api/roll-master/import', {
        'user_id': 'test', 'apply': True, 'fileBase64': base64.b64encode(
            write_sheet(tuple(okhead), [nf3])).decode()})
    got2 = {x['contactFace']: x.get('refNo')
            for x in getj('/api/roll-master')['items'] if x['name'] == TAG + 'FACE'}
    rec('径まで言えば1本に絞れるので、接触面の列が無くても直せる',
        rok.get('update') == 1 and rok.get('add') == 0 and got2.get('上') == 'OK'
        and got2.get('下') != 'OK',
        json.dumps({'res': {k: rok.get(k) for k in ('add', 'update')},
                    'rows': got2}, ensure_ascii=False))
    # **接触面がまだ空の行**（この機能より前の行）は、面を書いた行が来たら
    # **その行へ書き足す**——増やさない（書き出す→面を足す→取り込む の往復）。
    code, _ = post('/api/roll-master', {'user_id': 'test', 'equipment': EQ,
                                        'name': TAG + 'BLANK', 'diaMax': 10})
    # **鍵の列は書き出したまま**（径10）で、接触面だけを書き足すのが
    # 「書き出す→分類する→取り込む」の往復（§9.257 ③）。
    code, rb = post('/api/roll-master/import', {
        'user_id': 'test', 'apply': True, 'fileBase64': base64.b64encode(
            write_sheet(tuple(head), [(lambda r: r)([
                (EQ if h == '設備名' else (TAG + 'BLANK') if h == 'ロール名'
                 else '上' if h == '接触面' else 10.0 if h == 'ロール径MAX'
                 else 'BK' if h == '基準番号' else '')
                for h in head])])).decode()})
    bl = [x for x in getj('/api/roll-master')['items'] if x['name'] == TAG + 'BLANK']
    rec('接触面が空の既存行には書き足す（往復で二重にならない）',
        len(bl) == 1 and bl[0]['contactFace'] == '上' and bl[0]['diaMax'] == 10.0
        and bl[0]['refNo'] == 'BK'
        and rb.get('update') == 1 and rb.get('add') == 0,
        json.dumps({'rows': len(bl), 'res': rb,
                    'row': bl[0] if bl else None}, ensure_ascii=False))

    # ファイルの中に同じキーが2行あったら、**黙って上書きせず行番号で言う**。
    dup = [face_row('上', 501.0, 'D1'), face_row('上', 501.0, 'D2')]
    code, rd = post('/api/roll-master/import', {
        'user_id': 'test', 'fileBase64': base64.b64encode(
            write_sheet(tuple(head), dup)).decode()})
    rec('同じファイルの中の重複は黙って潰さず行番号で断る',
        code == 200 and len(rd.get('skipped') or []) == 1
        and '2行目' in json.dumps(rd.get('skipped'), ensure_ascii=False),
        json.dumps(rd.get('skipped'), ensure_ascii=False))

    code, r8 = post('/api/roll-master/import',
                    {'user_id': 'test', 'fileBase64': base64.b64encode(b'not a zip').decode()})
    rec('xlsxでないファイルは理由つきで断る',
        code == 400 and 'xlsx' in (r8.get('error') or ''), json.dumps(r8, ensure_ascii=False))
    code, r9 = post('/api/roll-master/import', {'user_id': 'test'})
    rec('ファイルが無ければ断る', code == 400, json.dumps(r9, ensure_ascii=False))

    # ---- 9) まとめて消す・完全入替（§9.251、利用者の指示） ----
    #   「ロールマスタの全削除機能（ロールマスタの完全入替機能）を実装して
    #    ください」
    # §9.240 で決めた「**行の削除はしない**」を、ここで**取り消している**。
    # 既定（`replace`なし）は今までどおり消さないことを併せて固定する
    # ——既定が変わると、何も選ばずに取り込んでいる現場の動きが黙って変わる。
    # **この節だけ別の設備を使う**——入れ替えは「その設備の、ファイルに無い行」を
    # 消すので、上の節で作った行まで巻き添えにすると、下見の件数と実際の件数を
    # 突き合わせる網が自分の置き土産で狂う（何を確かめているのか分からなくなる）。
    W = TAG + 'W'
    EQ3, EQ4 = 'テスト設備C', 'テスト設備D'
    wipe = []
    for eq, nm, face, dia in ((EQ3, W + '1', '上', 250.0), (EQ3, W + '2', '下', 300.0),
                              (EQ3, W + '2', '上', 310.0), (EQ4, W + '9', '', 150.0)):
        _c, _r = post('/api/roll-master', {'user_id': 'test', 'equipment': eq, 'name': nm,
                                           'contactFace': face, 'diaMax': dia})
        if _r.get('id'):
            made.append(_r['id'])
            wipe.append(_r['id'])
    rec('前提: 入れ替えを試す材料を作れた（2設備・接触面ちがいを含む）',
        len(wipe) == 4, str(len(wipe)))

    def mine(items=None):
        items = items if items is not None else getj('/api/roll-master')['items']
        return [x for x in items if str(x.get('name') or '').startswith(W)]

    def sheet_of(rows):
        return base64.b64encode(write_sheet(tuple(head), rows)).decode()

    def io_row(eq, nm, face, dia, ref=''):
        return [(eq if h == '設備名' else nm if h == 'ロール名' else face if h == '接触面'
                 else dia if h == 'ロール径MAX' else ref if h == '基準番号' else '')
                for h in head]

    # **鍵の列（径）は在る行と同じにする**（§9.257 ③）——変えると別のロール＝
    # 追加になり、「入れ替えで消える行」の数がこの網の意図と変わる。
    # 値が入ることは鍵でない列（基準番号）で見る。
    one = sheet_of([io_row(EQ3, W + '1', '上', 250.0, 'W1')])

    # 既定（消さない）——**ここが変わると現場の動きが黙って変わる**
    code, d0 = post('/api/roll-master/import', {'user_id': 'test', 'fileBase64': one})
    rec('既定の取り込みは今までどおり1件も消さない（§9.240を残す）',
        code == 200 and not d0.get('removeCount') and not d0.get('remove')
        and d0.get('replace') == '',
        json.dumps({k: d0.get(k) for k in ('replace', 'removeCount', 'add', 'update')},
                   ensure_ascii=False))

    # 「ファイルに出てくる設備だけ」——**他の設備を巻き添えにしない**のが値打ち
    code, df = post('/api/roll-master/import',
                    {'user_id': 'test', 'fileBase64': one, 'replace': 'file'})
    rm_f = [x for x in (df.get('remove') or []) if str(x.get('name') or '').startswith(W)]
    rec('「ファイルの設備を入れ替える」はその設備の余った行だけを消す',
        code == 200 and len(rm_f) == 2 and all(x['equipment'] == EQ3 for x in rm_f),
        json.dumps(df.get('remove'), ensure_ascii=False))
    rec('他の設備のロールは消える一覧に入らない（巻き添えにしない）',
        not any(x['equipment'] == EQ4 for x in (df.get('remove') or [])),
        json.dumps(df.get('remove'), ensure_ascii=False))
    # **接触面まで見て数える**（§9.246 ⑤）——(設備,名前)だけで数えると
    # 面ちがいの2本が1本にまとまり、下見の件数が実際と食い違う。
    rec('接触面ちがいの2本は2件として数える',
        sorted(x['contactFace'] for x in rm_f) == ['上', '下'],
        json.dumps(rm_f, ensure_ascii=False))

    # 「すべての設備」——ファイルに1行も出てこない設備も消える
    code, da = post('/api/roll-master/import',
                    {'user_id': 'test', 'fileBase64': one, 'replace': 'all'})
    rm_a = [x for x in (da.get('remove') or []) if str(x.get('name') or '').startswith(W)]
    rec('「すべての設備を入れ替える」はファイルに無い設備のロールも消す',
        code == 200 and any(x['equipment'] == EQ4 for x in rm_a) and len(rm_a) == 3,
        json.dumps(rm_a, ensure_ascii=False))

    # **下見は1件も消さない**（下見の意味そのもの）
    rec('下見（applyなし）では1件も消えていない', len(mine()) == 4, str(len(mine())))

    # **読めない行があるうちは入れ替えない**（§CLAUDE 4）
    bad = sheet_of([io_row(EQ3, W + '1', '上', 250.0, 'W1'),
                    io_row('居ない設備', W + 'X', '', 10.0)])
    code, db_ = post('/api/roll-master/import',
                     {'user_id': 'test', 'fileBase64': bad, 'replace': 'file'})
    rec('取り込めない行があると、入れ替えは下見の時点で断る',
        code == 200 and bool(db_.get('blocked')) and len(db_.get('skipped') or []) == 1,
        json.dumps({'blocked': bool(db_.get('blocked')),
                    'skipped': db_.get('skipped')}, ensure_ascii=False))
    code, db2 = post('/api/roll-master/import',
                     {'user_id': 'test', 'fileBase64': bad, 'replace': 'file', 'apply': True})
    rec('断った入れ替えは口も通さない（画面が押せてしまっても書かない）',
        code == 400 and len(mine()) == 4,
        '%s / 残り%d件' % (code, len(mine())))
    # **同じファイルでも「足す・上書き」なら通る**——直す手立てを塞がない
    code, db3 = post('/api/roll-master/import',
                     {'user_id': 'test', 'fileBase64': bad, 'apply': True})
    rec('同じファイルでも「足す・上書きする」なら取り込める（直す道を塞がない）',
        code == 200 and db3.get('saved') == 1 and len(mine()) == 4,
        json.dumps({'code': code, 'saved': db3.get('saved')}, ensure_ascii=False))

    # 実際に入れ替える。**下見が言った件数と、実際に消えた件数が一致すること**
    code, ap = post('/api/roll-master/import',
                    {'user_id': 'test', 'fileBase64': one, 'replace': 'file', 'apply': True})
    left = mine()
    rec('入れ替えを当てると、下見の「消える件数」と実際が一致する',
        code == 200 and ap.get('removed') == df.get('removeCount') == len(rm_f),
        json.dumps({'removed': ap.get('removed'), 'dry': df.get('removeCount'),
                    'mine': len(rm_f)}, ensure_ascii=False))
    rec('入れ替えたあとに残るのはファイルの行と、他の設備の行だけ',
        sorted((x['equipment'], x['name']) for x in left)
        == sorted([(EQ3, W + '1'), (EQ4, W + '9')]),
        json.dumps([(x['equipment'], x['name']) for x in left], ensure_ascii=False))
    rec('入れ替えでもファイルの値はちゃんと入る（消すだけで終わらない）',
        next((x['refNo'] for x in left if x['name'] == W + '1'), None) == 'W1',
        json.dumps([(x['name'], x['refNo']) for x in left], ensure_ascii=False))

    # ---- 9b) 全削除（範囲は「すべて」か「設備を1つ」） ----
    code, dp = post('/api/roll-master/delete-all', {'user_id': 'test', 'scope': 'all'})
    rec('全削除も既定は下見（applyなしでは1件も消えない）',
        code == 200 and dp.get('dryRun') is True and len(mine()) == len(left),
        json.dumps({'code': code, 'dryRun': dp.get('dryRun')}, ensure_ascii=False))
    rec('下見は設備ごとの内訳を返す（画面が数え直さなくてよい）',
        isinstance(dp.get('byEquipment'), list)
        and sum(x['count'] for x in dp['byEquipment']) == dp['total'],
        json.dumps(dp.get('byEquipment'), ensure_ascii=False))
    rec('消える行を名前で挙げる（件数だけで済ませない）',
        isinstance(dp.get('names'), list) and dp['count'] > 0 and len(dp['names']) > 0,
        json.dumps(dp.get('names', [])[:3], ensure_ascii=False))
    # **範囲を選んでいないときは断る**——既定の範囲を持たせない（押し間違いが
    # そのまま全消しになる）
    code, e1 = post('/api/roll-master/delete-all', {'user_id': 'test'})
    rec('範囲を選んでいなければ断る（「消す」に既定を持たせない）',
        code == 400 and '範囲' in (e1.get('error') or ''), json.dumps(e1, ensure_ascii=False))
    code, e2 = post('/api/roll-master/delete-all', {'user_id': 'test', 'scope': 'equipment'})
    rec('設備を選んでいなければ断る', code == 400 and '設備' in (e2.get('error') or ''),
        json.dumps(e2, ensure_ascii=False))

    # 設備を1つ消す——**他の設備は1件も減らない**
    before_a = len([x for x in mine() if x['equipment'] == EQ3])
    code, d1 = post('/api/roll-master/delete-all',
                    {'user_id': 'test', 'scope': 'equipment', 'equipment': EQ4, 'apply': True})
    after = mine()
    rec('設備を1つ選ぶと、その設備のロールだけが消える',
        code == 200 and not any(x['equipment'] == EQ4 for x in after)
        and len([x for x in after if x['equipment'] == EQ3]) == before_a,
        json.dumps([(x['equipment'], x['name']) for x in after], ensure_ascii=False))
    rec('消した件数を文字で言う', '件' in (d1.get('message') or ''), d1.get('message'))

    # 「設備の入っていない行」は**空文字で名指しできる**（移行し損ねた古い行）
    from backend.db_access import connect, DBS
    with connect(DBS['MASTER']['path'], False) as _c:
        rr.ensure_table(_c)
        _c.execute('INSERT INTO [%s] ([設備名],[ロール名],[ロール径MAX],[有効],'
                   '[登録者ID],[更新者ID],[登録日時],[更新日時]) '
                   "VALUES ('',?,?,-1,'test','test',Now(),Now())" % rr.TABLE,
                   [W + 'NOEQ', 77.0])
        _c.commit()
    made.extend(x['id'] for x in mine() if x['name'] == W + 'NOEQ')
    # **「すべて入れ替える」でも設備なしの行は消さない**（ファイルで表せない）
    code, dn = post('/api/roll-master/import',
                    {'user_id': 'test', 'fileBase64': one, 'replace': 'all'})
    rec('設備の入っていない行は「すべて入れ替える」でも消さない',
        code == 200 and not any(not x['equipment'] for x in (dn.get('remove') or []))
        and (dn.get('keptNoEquipment') or 0) >= 1,
        json.dumps({'kept': dn.get('keptNoEquipment'),
                    'remove': dn.get('remove')}, ensure_ascii=False))
    code, d2 = post('/api/roll-master/delete-all',
                    {'user_id': 'test', 'scope': 'equipment', 'equipment': '', 'apply': True})
    rec('設備の入っていない行は全削除から名指しで消せる（隠して終わらせない）',
        code == 200 and not any(x['name'] == W + 'NOEQ' for x in mine()),
        json.dumps({'code': code, 'msg': d2.get('message')}, ensure_ascii=False))

except Exception as e:
    import traceback
    traceback.print_exc()
    print('FATAL ' + str(e))
    R.append(False)
finally:
    # **後始末**（§9.121。ロールマスタは実行をまたいで残る）
    try:
        for x in getj('/api/roll-master')['items']:
            if str(x.get('name') or '').startswith(TAG):
                post('/api/roll-master/delete', {'user_id': 'cleanup', 'id': x['id']})
    except Exception:
        pass

ok = sum(1 for x in R if x)
print('\n== %d/%d PASS ==' % (ok, len(R)))
sys.exit(0 if ok == len(R) else 1)
