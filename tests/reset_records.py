"""reset_records.py: 検証用設備の測定バックアップを白紙へ戻す(ランナーが起動時に呼ぶ)。

`resetcontent`(内容欄の項目・列レイアウト)と**同じ「置き土産」の問題**(§9.121)。
測定バックアップ(`db/records.sqlite3`の`[Web測定バックアップ]`)はランナーが
何も手当てしていなかったため、**異常終了した実行が残した実績が次の実行へ
そのまま持ち越される**。共有スケジュールDBは作業用コピーを作り直し、作業予定は
1本ごとにreseedするのに、ここだけ素通しだった。

しかも壊れ方が遠い——実データ由来のロット番号(ZZ9T4813)の「作業中」が1件
残っていただけで、タイムラインの先頭の作業中がその行になり、内容とは何の
関係も無い`test_screport`の「ダブルクリックで再開」が落ちた(§9.132)。

消すのは**検証用設備の行だけ**。実データの設備には触らない。
サーバーが落ちている・APIが失敗する等は「戻せなかった」だけで実行は続ける
(ここで止めると、確かめたいテストが1本も走らない)。

**これはランナーからは呼ばない。手で使う道具。** 起動時に必ず白紙へ戻す形も
試したが、`test_wkbg`(判定材料が揃う前は「?」)と`test_theme`(実績のある行に
削除ボタンが出る)が**実績が1件以上あることに暗黙に頼っている**ため、
コードを1行も変えていないのに落ちるようになった(実測: 空で4件FAIL →
実績を入れ直すと52/52 PASS)。依存している側を直すのが本筋で、それまでは
「異常終了した実行の置き土産を落としたいときだけ手で使う」に留める。
使ったあとは`tests/run_all.sh test_screport test_startwork`を1度流せば、
上の2本が要る実績は戻る。詳細は`tests/README.md`の
「前提は『他のテストの残骸』に頼らず自分で作る」。
"""
import json
import urllib.request

API = 'http://127.0.0.1:5029'
TEST_EQUIPMENT = 'テスト設備A'


def _rows():
    with urllib.request.urlopen(API + '/api/measurement/backup/summary', timeout=20) as r:
        return (json.loads(r.read()) or {}).get('items') or []


def _record_id(row):
    # 応答のキー名は英語/日本語のどちらもあり得るので両方見る。
    return row.get('id') or row.get('記録ID') or ''


def _equipment(row):
    return row.get('equipment') or row.get('設備') or ''


def main():
    try:
        rows = _rows()
    except Exception as e:
        print(f'!! 測定バックアップを読めませんでした({e})。前の実行の実績が残ります。')
        return 0
    ids = [_record_id(r) for r in rows if _equipment(r) == TEST_EQUIPMENT]
    ids = [i for i in ids if i]
    if not ids:
        return 0
    body = json.dumps({'ids': ids}).encode()
    req = urllib.request.Request(API + '/api/measurement/backup/delete', data=body,
                                 headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            got = json.loads(r.read()) or {}
        print(f'前の実行が残した測定データを{got.get("deleted", 0)}件消しました')
    except Exception as e:
        print(f'!! 測定バックアップを消せませんでした({e})。前の実行の実績が残ります。')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
