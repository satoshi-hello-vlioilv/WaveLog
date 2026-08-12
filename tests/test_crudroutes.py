"""test_crudroutes.py: マスタ管理の汎用CRUDが3本とも生えていることを固定する（§9.82）

なぜ要るか
------------------------------------------------------------------
マスタ管理画面(static/js/master-maint.js の submitMaint)は、どのマスタでも
同じ約束で叩く:

    一覧   GET  <endpoint>
    新規   POST <endpoint>
    編集   POST <endpoint>/update      ← 編集のときだけURLが変わる
    削除   POST <endpoint>/delete

画面側は MASTER_DEFS に1行足すだけで動くため、**サーバー側に /update を
書き忘れても画面は普通に動いているように見える**。壊れるのは「編集」を
押したときだけで、しかも 404 のHTMLがそのままトーストに出るので、
利用者からは何が起きたのか分からない。

実際に3回起きた:
  - 設備停止マスタ    … /update が無く404（VER1.94.0で追加）
  - 設備停止分類マスタ … 改名の処理は登録側が持っていたのにURLが無い
  - データソースマスタ … /update が無く404、さらに /delete が key しか
                         受け付けず画面が送る id では消せなかった

1件ずつ気づくのではなく、**足したときに落ちる**ようにする。
このテストは MASTER_DEFS を読んで、汎用CRUDのマスタすべてについて
3本のURLが存在すること(404でないこと)と、POSTを受け付けること
(405でないこと)を確かめる。中身の妥当性は各マスタのテストが見る。
"""
import json
import re
import urllib.error
import urllib.request
from pathlib import Path

API = 'http://127.0.0.1:5029'
ROOT = Path(__file__).resolve().parent.parent

R = []


def rec(name, ok, detail=''):
    R.append(ok)
    print(('PASS' if ok else 'FAIL') + ': ' + name + (' -- ' + detail if detail else ''))


def call(method, path, body=None):
    req = urllib.request.Request(
        API + path, method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code


def master_defs():
    """MASTER_DEFS から汎用CRUD(special でなく hasDelete を持つ)を拾う。
       画面の定義そのものを情報源にするので、マスタを増やせば自動で対象になる。"""
    js = (ROOT / 'static' / 'js' / 'master-maint.js').read_text(encoding='utf-8')
    return re.findall(
        r"\{group:'[^']*',key:'([A-Za-z]+)',label:'([^']*)',icon:'[^']*',"
        r"endpoint:'([^']+)',hasDelete:true,", js)


def simple_masters():
    """サーバー側の宣言表(masters.SIMPLE_MASTERS)を読む。

    「名前だけ」の単純マスタは4本を写経せず、**1宣言から生成**している
    (docs/REFACTORING_PLAN.md フェーズC)。生成に切り替えたことで、
    宣言を足したのにURLが生えない/エンドポイント名が変わって
    アクセスモードの許可表(Blueprint名.関数名)から外れる、という
    新しい壊れ方ができた。宣言と実際のURL登録を突き合わせる。"""
    import sys
    sys.path.insert(0, str(ROOT))
    import app as flask_app
    from backend.routes.masters import SIMPLE_MASTERS
    rules = {(r.rule, m) for r in flask_app.app.url_map.iter_rules() for m in r.methods}
    names = {r.endpoint for r in flask_app.app.url_map.iter_rules()}
    return SIMPLE_MASTERS, rules, names


def main():
    defs = master_defs()
    rec('マスタ管理の汎用CRUDを画面定義から拾える', len(defs) >= 10, f'{len(defs)}件')

    # ---- 宣言から4本が生成されている ----
    specs, rules, names = simple_masters()
    rec('サーバー側の宣言表を読める', len(specs) >= 5, f'{len(specs)}件')
    for spec in specs:
        url = '/api/' + spec['url']
        key = spec.get('endpoint') or spec['url'].replace('-', '_')
        ok = (
            (url, 'GET') in rules and (url, 'POST') in rules
            and (url + '/update', 'POST') in rules and (url + '/delete', 'POST') in rules
        )
        rec(f"{spec['label']}: 宣言から4本が生成されている", ok, url)
        # エンドポイント名は畳む前の関数名のまま。ここが変わると
        # _ENDPOINT_EXTRA_MODES 等のキーが黙って一致しなくなる。
        missing = [n for n in ('list', 'register', 'update', 'delete')
                   if f'masters.{key}_{n}' not in names]
        rec(f"{spec['label']}: エンドポイント名が畳む前のまま", not missing, ', '.join(missing))

    for key, label, ep in defs:
        rec(f'{label}: 一覧が引ける', call('GET', ep) == 200, ep)
        # 中身は空で送る。ここで見たいのは「URLがあるか」だけなので、
        # 400(入力が足りない)でも合格。落とすのは404(ルート自体が無い)と
        # 405(POSTを受け付けない)の2つ。
        for suffix in ('', '/update', '/delete'):
            st = call('POST', ep + suffix, {'user_id': 'test-crudroutes'})
            name = {'': '新規登録', '/update': '編集の保存', '/delete': '削除'}[suffix]
            rec(f'{label}: {name}のURLがある', st not in (404, 405), f'{ep}{suffix} → {st}')

    print('\n=== SUMMARY ===')
    print('%d/%d passed' % (sum(R), len(R)))
    raise SystemExit(0 if all(R) else 1)


if __name__ == '__main__':
    main()
