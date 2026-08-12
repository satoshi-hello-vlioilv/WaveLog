# -*- coding: utf-8 -*-
"""アクセスモード × 書込エンドポイントの許可表を固定する。

なぜ要るか
----------
書込ガード(backend/access_mode.py の _guard_write)は **Blueprint名をキー**に
判定する。したがってエンドポイントを別のBlueprintへ移すと、コードを1行も
変えていなくても許可が変わる:

  _WRITE_ALLOWED_MODES      Blueprint名 -> 書込を許可するモード集合
  _ENDPOINT_EXTRA_MODES     'bp.func' -> 追加で許可するモード
  _READ_ONLY_POST_ENDPOINTS 'bp.func' の集合(読み直すだけのPOST。ガード対象外)

後ろ2つのキーは **Blueprint名を含む**ので、移動すると黙って一致しなくなる。
routes/masters.py の分割(docs/REFACTORING_PLAN.md フェーズ4.1)の前に、
現在の許可表を実測で固定しておくためのテスト。

**未宣言のBlueprintはfail-open**(素通し)である点に注意。移動先を
_WRITE_ALLOWED_MODES へ登録し忘れると、403になるのではなく
**閲覧モードからも書けるようになる**。CLAUDE.mdには長く逆の説明
(「安全側＝どのモードでも書込不可へ倒れる」)が書かれていたが、
コードは `if allowed is None: return None` で素通ししている。

副作用について
--------------
このテストは実際にPOSTするので、値を壊さない叩き方だけを使う:
  - path-config-master : GETした現在値をそのまま書き戻す(冪等)
  - schedule-column-master : 同上
  - operator-master : 空ボディ。ガードを通っても入力検証で400になり行は増えない
  - rne-extract/run : サンドボックスにはRNE資材が無いので400で戻る(起動しない)
"""
from __future__ import annotations
import json
import urllib.error
import urllib.parse
import urllib.request

API = 'http://127.0.0.1:5029'
R = []


def rec(name, ok, detail=''):
    R.append(ok)
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + str(detail)) if detail else ''))


def call(method, path, payload=None):
    """(status, body) を返す。4xx/5xxも例外にせず拾う。"""
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(API + path, data=data, method=method,
                                 headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'replace')
    except urllib.error.URLError as e:
        # サーバーが起動していない等。FATALで落とさず0を返し、呼び出し側で
        # FAILとして数える(スタックトレースだけ出て件数が合わないのを避ける)。
        return 0, f'接続できません: {e.reason}'


def set_mode(mode):
    st, _ = call('POST', '/api/access-mode', {'mode': mode})
    return st == 200


# ガードが弾いたときだけ出る文言。他の403(権限の個別判定)と区別する。
GUARD_MSG = '現在のモードでは、この操作は実行できません。'


def blocked_by_guard(status, body):
    """ガード由来の403かどうか。**本文はJSONとして復号してから照合する**:
    Flaskの既定は非ASCIIをユニコードエスケープへ退避するので、生の本文へ
    日本語で部分一致を掛けても永久にヒットしない(このテストを書いたとき
    実際に踏み、全モードで「弾かれていない」と誤判定した)。"""
    if status != 403:
        return False
    try:
        return GUARD_MSG in str(json.loads(body).get('error') or '')
    except Exception:
        return GUARD_MSG in body


def probe_path_config():
    st, body = call('GET', '/api/path-config-master')
    values = (json.loads(body).get('values') or {}) if st == 200 else {}
    payload = dict(values)
    payload['user_id'] = 'test-modeguard'
    return call('POST', '/api/path-config-master', payload)


def probe_column_layout():
    """一覧の見せ方(§9.88)。**書式や読み替えを消さない叩き方**にする:
    GETした現在値をそのまま書き戻す(冪等)。全置換なので、空で送ると
    その一覧の設定が消える。"""
    target = 'list:__modeguard__:T'
    st, body = call('GET', '/api/column-layout-master?target=' + urllib.parse.quote(target))
    cur = json.loads(body) if st == 200 else {}
    return call('POST', '/api/column-layout-master',
                {'target': target, 'order': cur.get('order') or [],
                 'widths': cur.get('widths') or {}, 'hidden': cur.get('hidden') or [],
                 'names': cur.get('names') or {}, 'formats': cur.get('formats') or {},
                 'rules': cur.get('rules') or {}, 'user_id': 'test-modeguard'})


def probe_display_rule():
    """表示ルール。名前を専用のものにして、実運用のルールへ触れないようにする。"""
    return call('POST', '/api/display-rule-master',
                {'name': '__modeguard__', 'rows': [], 'user_id': 'test-modeguard'})


def probe_schedule_column():
    st, body = call('GET', '/api/schedule-column-master?equipment=' + urllib.parse.quote('テスト設備A'))
    cols = (json.loads(body).get('columns') or []) if st == 200 else []
    return call('POST', '/api/schedule-column-master',
                {'equipment': 'テスト設備A', 'columns': cols, 'user_id': 'test-modeguard'})


def probe_logs():
    """ログ・診断(§9.99)。**消さない叩き方**にする: 消す行を空で送るので、
    ガードを通っても removed=0 で何も起きない。"""
    return call('POST', '/api/logs/delete-lines', {'file': 'app.log', 'lines': []})


PROBES = {
    'マスタCRUD(operator-master)': lambda: call('POST', '/api/operator-master', {}),
    'パス設定(path-config-master)': probe_path_config,
    'スケジュール列表示(schedule-column-master)': probe_schedule_column,
    'RNE手動実行(rne-extract/run)': lambda: call('POST', '/api/rne-extract/run', {}),
    '列レイアウト(column-layout-master)': probe_column_layout,
    '表示ルール(display-rule-master)': probe_display_rule,
    'ログの整理(logs/delete-lines)': probe_logs,
}

# 現在の許可表(実測で固定する)。True=ガードを通る / False=ガードが弾く
EXPECTED = {
    'マスタCRUD(operator-master)':                {'edit': True,  'view': False, 'schedule': False},
    'パス設定(path-config-master)':               {'edit': True,  'view': False, 'schedule': False},
    # §9.18: scheduleモードの端末が分割表示中に表示列を選べるようにする例外
    'スケジュール列表示(schedule-column-master)': {'edit': True,  'view': False, 'schedule': True},
    # §9.50: 読み直すだけのPOSTなのでガード対象外(全モードで通る)
    'RNE手動実行(rne-extract/run)':               {'edit': True,  'view': True,  'schedule': True},
    # §9.88: 「その画面の見え方」の設定。scheduleモードの端末は仕掛一覧を
    # 主に使うので、列を動かした瞬間だけ403になることのないよう開けている
    # (登録フィルタ・スケジュール列表示と同じ理由)。閲覧モードには開かない。
    '列レイアウト(column-layout-master)':         {'edit': True,  'view': False, 'schedule': True},
    '表示ルール(display-rule-master)':            {'edit': True,  'view': False, 'schedule': True},
    # §9.99: 読み出し(GET)は全モードから。**消す・区切るはeditだけ**。
    # ログは端末ごとのローカルファイルだが、消えると調査ができなくなる。
    'ログの整理(logs/delete-lines)':              {'edit': True,  'view': False, 'schedule': False},
}


def main():
    try:
        for mode in ('edit', 'view', 'schedule'):
            if not set_mode(mode):
                rec(f'{mode}モードへ切り替えられる', False)
                continue
            for label, probe in PROBES.items():
                st, body = probe()
                passed = not blocked_by_guard(st, body)
                want = EXPECTED[label][mode]
                rec(f'{mode}: {label} → {"通る" if want else "ガードが弾く"}',
                    passed == want, f'status={st} {body[:80]}')
    finally:
        set_mode('edit')

    print('\n=== SUMMARY ===')
    print('%d/%d passed' % (sum(R), len(R)))
    raise SystemExit(0 if all(R) else 1)


if __name__ == '__main__':
    main()
