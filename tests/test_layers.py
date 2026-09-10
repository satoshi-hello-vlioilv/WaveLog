#!/usr/bin/env python3
"""test_layers.py: テストの層（純粋 / 煙 / 全件）が崩れない（§9.337、REVIEW 3-13）。

============================================================
なぜ要るか
------------------------------------------------------------
通しは約39分かかる。直したいものと関係のない網まで毎回待つので、
**サーバーを立てずに回る網**を1段目として切り出し、並列で回せるようにした
（実測 56秒 → 20秒 / 47本・828件）。2段目は起動・一覧・スケジュール・測定の
各1本（実測93秒）。

1段目に載せてよいのは「**まっさらな取得（DBも設定もサーバーも無い）で
そのまま通る**」ものだけ。その判定をしているのは注意書きではなく
`.github/workflows/nets.yml` そのもの——サーバーを要る網を `PURE_TESTS` へ
載せれば、まっさらな取得で回す1段目が落ちる。

ここで見るのは**そこまで行かずに分かること**:
  1. 名前が実在する（打ち間違いは「静かに1本減る」形で効く）
  2. 1段目に**画面のテスト（.js）を混ぜていない**（ブラウザは要る）
  3. 1段目の網が**通しの一覧にも載っている**（層が別の宇宙へ分かれない）
  4. `--pure` が**パス設定の差し替えより前**にあり、サーバーを触らない
  5. **0本でも緑にならない**見張りが残っている
  6. CIが1段目・2段目の両方を回している

5. は実際に踏んだ——`grep -c` は0件でも数を出して終了コード1を返すので
`|| echo 0` を添えると `"0\\n0"` になり、`$(( ))` が構文エラーで止まる。
そのとき**終了コード0のまま「合計 0/0 PASS」**と出た。
**緑に見えている壊れた網は赤より悪い**（§9.200）。
============================================================
"""
import pathlib
import subprocess
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SH = (ROOT / 'tests' / 'run_all.sh').read_text(encoding='utf-8')
CI = ROOT / '.github' / 'workflows' / 'nets.yml'

R = []


def rec(name, ok, detail=''):
    R.append(ok)
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + str(detail)) if detail else ''))


def names(var):
    m = re.search(var + r'="(.*?)"', SH, re.S)
    return (m.group(1).replace('\\\n', ' ').split()) if m else []


def main():
    pure, smoke = names('PURE_TESTS'), names('SMOKE_TESTS')
    rec('1段目（純粋な網）の一覧を読める', len(pure) >= 30, f'{len(pure)}本')
    rec('2段目（煙テスト）の一覧を読める', 4 <= len(smoke) <= 8, f'{len(smoke)}本')

    # **一覧は1箇所だけ。** `PURE_TESTS="$PURE_TESTS 追加"` と書き足せる形だと、
    # 宣言を読むこの網からは見えないまま1段目の中身が変わる（A/Bで素通りした）。
    rec('1段目の一覧を宣言している箇所は1つ', SH.count('PURE_TESTS="') == 1,
        f'{SH.count(chr(80)+"URE_TESTS=")}箇所')
    rec('2段目の一覧を宣言している箇所は1つ', SH.count('SMOKE_TESTS="') == 1)

    dup = sorted({t for t in pure if pure.count(t) > 1})
    rec('1段目に同じ名前が2つ無い', not dup, str(dup))

    miss = [t for t in pure if not (ROOT / 'tests' / (t + '.py')).exists()]
    rec('1段目の名前が実在する（.py）', not miss, ', '.join(miss[:6]))
    smiss = [t for t in smoke
             if not (ROOT / 'tests' / (t + '.py')).exists()
             and not (ROOT / 'tests' / (t + '.js')).exists()]
    rec('2段目の名前が実在する', not smiss, ', '.join(smiss[:6]))

    # 画面のテストは1段目に混ぜない（ブラウザとサーバーが要る）。
    # **`.js`の同名が在るかでは見ない**——`test_savechip`のように、同じ主題を
    # サーバー側と画面側の2本で見ている網が実際に在る（1段目が回すのは`.py`）。
    only_js = [t for t in pure if not (ROOT / 'tests' / (t + '.py')).exists()]
    rec('1段目は .py だけを載せている', not only_js, ', '.join(only_js[:6]))

    # 層が別の宇宙へ分かれない——1段目の網は通しの一覧にも載っている
    body = SH.split('echo "--- サーバー側 ---"')[-1]
    listed = set(re.findall(r'(test_[a-z0-9_]+)', body))
    stray = [t for t in pure if t not in listed]
    rec('1段目の網は通しの一覧にも載っている', not stray, ', '.join(stray[:6]))

    # --pure はパス設定の差し替えより前で、サーバーを触らない
    i_pure = SH.index('if [ "$1" = "--pure" ]')
    i_swap = SH.index('パス設定を退避しました') if 'パス設定を退避しました' in SH else len(SH)
    rec('--pure はパス設定の差し替えより前にある', i_pure < i_swap)
    block = SH[i_pure:SH.index('if [ "$1" = "--smoke" ]')]
    touches = [w for w in ('restart_server', 'reseed', 'resetcontent', 'mode ', 'curl')
               if w in block]
    rec('--pure はサーバーを触らない', not touches, ', '.join(touches))
    rec('--pure は最後に exit する（通しへ落ちない）', 'exit $([ $NG -gt 0 ]' in block)

    # **0本でも緑にならない見張り**（実際に「合計 0/0 PASS・exit 0」を出した）
    rec('回った本数を数えて、足りなければ落とす',
        'RAN' in block and 'FATAL:' in block and '$RAN" -ne "$N"' in block)
    # 数の取り方（`grep -c` の失敗を `||` で拾わない）。**この網の中に
    # その字を書くと自分で落ちる**ので、字ではなく形で見る。
    code = '\n'.join(l for l in block.split('\n') if not l.strip().startswith('#'))
    rec('数を取るのに grep の失敗を `||` で拾っていない',
        not re.search(r'grep -c[^\n]*\|\|', code))

    # CIが両方を回している
    rec('CIのワークフローがある', CI.exists(), str(CI.relative_to(ROOT)))
    y = CI.read_text(encoding='utf-8') if CI.exists() else ''
    rec('CIが1段目を回す', 'run_all.sh --pure' in y)
    rec('CIが2段目を回す', 'run_all.sh --smoke' in y)
    rec('CIが全件を回さない（39分・ランナーは並べられない）',
        not re.search(r'run_all\.sh\s*$', y, re.M))

    # ---- 共有状態の後始末の仕組みが**外れていない**ことを見る（§9.360）----
    # 「マスタを丸ごと戻す」「汚した本を名指しする」は**消えても誰も気づかない**
    # 種類の仕組み（テストは緑のまま、赤が散らばるようになるだけ）。しかも
    # `state_fp.py` を相対パスで書くと**1件も読めずに黙って空振りする**——実際に
    # 一度そう書いて、比較が常に一致＝検出0件になった。ここで固定する。
    rec('マスタを控えて戻す（snap_master / restore_master）',
        'snap_master' in SH and 'restore_master' in SH)
    # **「書いてある」ではなく「呼ばれている」を見る。** コメントにしただけで
    # 通ってしまう網は網ではない（注入で素通りして気づいた）。行そのものを見る。
    called = re.search(r'^\s*restore_master\s*$', SH, re.M)
    rec('restore_master が run() の中で実際に呼ばれている', bool(called))
    rec('共有状態の指紋を取る（汚した本を名指しする）',
        'fingerprint' in SH and 'state_fp.py' in SH)
    rec('後始末は1つの trap へ畳んである（2つ書くと前のが消える）',
        "trap 'restore_paths; release_lock; rm -rf" in SH)
    fp = (ROOT / 'tests' / 'state_fp.py').read_text(encoding='utf-8')
    rec('指紋の置き場はファイル位置から決める（カレントに依らない）', '__file__' in fp)
    out = subprocess.run([sys.executable, str(ROOT / 'tests' / 'state_fp.py')],
                         capture_output=True, text=True, cwd=str(ROOT / 'tests'))
    lines = len(out.stdout.strip().splitlines())
    rec('指紋が実際に取れる（tests/ から呼んでも空にならない）', lines > 5, f'{lines}件')
    rec('落ちた本は単独で2回回して切り分ける（不安定を見分ける）',
        'for _try in 1 2' in SH and '不安定' in SH)
    # **ランナーが開くDBの道は絶対で書く。** ランナーは`cd tests`してから走るので、
    # `db/records.sqlite3` のような相対の道は`tests/db/...`を指す——存在せず、
    # 例外にもならないので**入れた日から一度も動かない**。`resetrecords`が実際に
    # そうで、実績が実行をまたいで生き延びていた（§9.356が入れた仕組みが、
    # 入れた本人の想定と違って空振りしていた。§9.360の指紋の`±1`で発覚）。
    # `state_fp.py`も同じ形で踏んだので、**同じ罠を2度踏まないように機械にする。**
    rel = re.findall(r'''pathlib\.Path\(\s*['"](db/[^'"]+)['"]''', SH)
    rec('ランナーが開くDBの道が相対で書かれていない（相対だと黙って空振りする）',
        not rel, '; '.join(rel[:4]) or '0件')
    # **「実在する」で見ない**（§9.369）。まっさらな取得には`db/`の中身が無い
    # ——無いことは異常ではないので、それで落とすとCIの1段目が必ず赤になる。
    # ここで守りたいのは「相対で書いて空振りしない」ことなので、**道の組み立て方**
    # を見る（実体があるときは中身も確かめる）。
    records_db = ROOT / 'db' / 'records.sqlite3'
    rec('実績を空へ戻す口は`$ROOT`から組み立てている（相対だと黙って空振りする）',
        'WAVELOG_RECORDS_DB="$ROOT/db/records.sqlite3"' in SH,
        '無し' if 'WAVELOG_RECORDS_DB' not in SH else '相対で書いている')
    rec('実績DBがあるときは読める（無い取得では測らない）',
        (not records_db.exists()) or records_db.stat().st_size > 0,
        'まっさらな取得のため測っていない' if not records_db.exists() else str(records_db))


    print(f'\n== {sum(R)}/{len(R)} PASS ==')
    print(f'  1段目 {len(pure)}本 / 2段目 {len(smoke)}本')
    sys.exit(0 if all(R) else 1)


main()
