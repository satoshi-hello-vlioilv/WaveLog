"""masters: 各種マスタのCRUD API（Blueprint `masters`）。

データアクセス（テーブル定義・読み取り・正規化）は
`backend/repositories/master_repo.py`（と`operation_repo`等）が持ち、ここは
リクエストの受付とレスポンス整形だけを行う。保存先はすべて
`db/master.sqlite3`で、表が無ければ初回アクセス時に自動で作る。

------------------------------------------------------------------
1枚だったものを段へ分けた（§9.333、REVIEW 3-10）
------------------------------------------------------------------
以前は`routes/masters.py`の1枚に**73ルート・2,093行**が並んでいた。中身は
9つの無関係なマスタで、直したいマスタへ辿り着くのに関係のない8つを飛ばす
ことになっていた。

**Blueprintは`_base.py`の1つのまま**で、段はそこへ登録する——これが
この分け方の値打ちで、`access_mode`の`_WRITE_ALLOWED_MODES`／
`_ENDPOINT_EXTRA_MODES`も`master_share.WRITING_BLUEPRINTS`も
**Blueprint名と関数名**で書いてあるので、**権限表を1文字も触らずに済む**
（鍵を変えると、その瞬間にそのAPIだけ書込ガードを通らなくなる）。
URLも関数名も1つも変えていない。

  `equipment`     設備マスタ
  `access`        アクセス権限マスタ
  `filters`       フィルタ／ソートのプリセット・一覧表示設定
  `columns`       列の見せ方（スケジュール列・内容欄・列レイアウト・
                  列プリセット・表示ルール）
  `joins`         クエリ結合マスタ
  `operation`     操業データ（項目・選択肢・入力フォーム）
  `report_block`  帳票ブロックマスタ
  `roll`          ロールマスタ
  `choice_link`   選択肢リンクマスタ
  `bladeset`       刃組の設備の諸元（基準値）と記録（履歴）・1画面ぶん（§9.377）
  `bladeset_parts` 刃組の部材（刃・スペーサー・ゴムリング・フィンガー）
  `stop_detail`    設備停止の内訳（サブカテゴリ）と時間の選択肢（§9.389）

**段を1つ足したら、下の import へも1行足すこと**——import しないと
`@bp.post(...)`が走らず、**そのAPIだけ404になる**（画面からは「押しても
何も起きないボタン」に見える・§4）。`tests/test_crudroutes.py`が
`MASTER_DEFS`の4本セットを実際に叩くので、載せ忘れはそこで落ちる。

------------------------------------------------------------------
ここに無いもの
------------------------------------------------------------------
オペレータ／機器／スプール種別／内径種別／バリ揃え／コイル止めは
**操業データ選択肢マスタへ移した**（§9.221 ③、利用者の指示）。6つとも
「名前の一覧」でしかなく、違いはオペレータが持っていたヨミガナと作業可能
設備だけだった——その2つは`[よみ]`／`[対象設備]`として選択肢の側へ持たせた
ので、**まとまり名が違うだけの同じもの**になる。CRUDは
`/api/operation-choice-master`の1組、読み口は`op.choice_values()`の1本、
画面は「選択肢の値」の1枚。元の表は`migrate_legacy_choice_masters()`が
1度だけ写す材料として残してあるが、アプリはもう読まない。

「名前だけ」の単純マスタの**生成器も撤去した**（同）。使われていない生成器を
残すと、次に触る人が「まだ現役だ」と読んで新しいマスタをそちらへ足し、
選択肢マスタと2本立てになる。名前だけのマスタが要る場面は
`/api/operation-choice-master`で足りる。
"""
from ._base import bp
# 段の import そのものがルートの登録（`@bp.get`/`@bp.post`）を走らせる。
from . import (equipment, access, filters, columns, joins,      # noqa: F401 登録のためのimport
               operation, report_block, roll, choice_link,      # noqa: F401 登録のためのimport
               bladeset, bladeset_parts, stop_detail)           # noqa: F401 登録のためのimport

__all__ = ['bp']
