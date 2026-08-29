"""storage_layout.py: 「何がどこに置かれるか」を1箇所で答える（§9.267）。

============================================================
なぜ要るか
------------------------------------------------------------
置き場の設定は**2つの保存先**に分かれている。

  ① `config/local.json`  … マスタDB自身の置き場を決める4つ
     （`db_dir` / `master_db_path` / `records_db_path` / `master_share_mode`）
     マスタDBの置き場を決める値をマスタDBの中に書くと、読みに行く先が
     分からないまま読みに行くことになる（鶏と卵）ので、ここだけは外に残る。
  ② パス設定マスタ（`master.sqlite3` の中）… それ以外の全部

利用者から見ると**同じ「置き場の設定」なのに直す場所が2つ**あり、しかも
①は画面に一切出ていなかった（「local.jsonの扱いがわからない」）。さらに
①には**優先順位**がある（個別指定 > `db_dir` > 既定）のに、それを言う場所も
無かった。

ここは「いまどこか・どの設定から決まったか・優先順位・種類・在るか」を
**1つの答え**として返す。**画面へ判定を写さないこと**（§9.163）——
「UNCかどうか」「どの段で決まったか」を画面でも判定すると答えが2通りになる。

**存在確認で失敗しないこと。** 共有越しでは stat だけ失敗することがあり
（WinError 59 等）、確認のつもりの1行が唯一の失敗原因になる。`exists` は
True／False／**None（確かめられなかった）** の3値で、Noneを「無い」と
同じに扱わない（§CLAUDE「共有DBを開く前に Path.exists() を置かない」）。
============================================================
"""
import threading
from contextlib import contextmanager
from pathlib import Path

from . import paths

# ------------------------------------------------------------------
# config/local.json で受け付ける鍵。**ここが唯一の一覧**——増やすときは
# `local_config_fields()` の説明も一緒に書く（画面はこれをそのまま出す）。
# ------------------------------------------------------------------
LOCAL_CONFIG_PATH_KEYS = ('db_dir', 'master_db_path', 'records_db_path')
LOCAL_CONFIG_CHOICE_KEYS = {'master_share_mode': ('auto', 'on', 'off')}
LOCAL_CONFIG_KEYS = LOCAL_CONFIG_PATH_KEYS + tuple(LOCAL_CONFIG_CHOICE_KEYS)


def local_config_path():
    # **答えるのは `paths` の1箇所**（§9.163）。ここに同じ組み立てを持つと、
    # 置き場を変えたときに読む側と書く側で食い違う。
    return paths.local_config_path()


def kind_of(path):
    """置き場の種類。'network'／'cloud'／'local'／''（分からない）。

    **綴りとドライブ種別だけ**で決める（開かない・statしない）。
    """
    raw = str(path or '')
    if not raw:
        return ''
    try:
        if paths.is_network_path(raw):
            return 'network'
    except Exception:
        pass
    try:
        if paths.cloud_sync_hint(Path(raw)):
            return 'cloud'
    except Exception:
        pass
    return 'local'


def exists_of(path):
    """True／False／None（確かめられなかった）。**Noneを「無い」と読まないこと。**"""
    if not path:
        return None
    from .db_access import path_exists_safe
    try:
        return path_exists_safe(Path(path))
    except Exception:
        return None


def _local_config_raw():
    try:
        return paths.load_local_config()
    except Exception:
        return {}


def local_config_fields():
    """`config/local.json` の4つを、値と説明と優先順位つきで返す。

    **優先順位はここが言う**——「個別指定 > db_dir > 既定」を画面へ書き写すと、
    段を1つ足したときに2箇所直すことになる。
    """
    raw = _local_config_raw()
    app_db = paths.APP_ROOT / 'db'
    # 変数で書いてあるときは**展開後の姿も出す**（§6。書いたものと効くものが
    # 違うので、片方だけ見せると確かめようがない）。
    def expanded(key):
        v = str(raw.get(key) or '')
        got = paths.expand_path(v)
        return got if (v and got != v) else ''
    return [
        {'key': 'db_dir', 'label': 'この端末のDBフォルダ（まとめて指定）', 'mode': 'dir',
         'value': str(raw.get('db_dir') or ''),
         'expanded': expanded('db_dir'),
         'effective': str(paths.db_dir()),
         'default': str(app_db),
         'what': 'この端末が持つ2つのDBファイル（master.sqlite3 / records.sqlite3）'
                 'を置くフォルダ',
         'hint': '<b>作業用のコピー置き場ではありません</b>——写しや作業コピーの'
                 '置き場は下の「作り直せるファイル」で、こちらが決めます'
                 '（設定は要りません）。空欄ならアプリの中の db フォルダ。'
                 '下の2つで個別に指定した側が優先されます。'
                 '<code>%LOCALAPPDATA%\\WaveLog</code> のように環境変数でも書けます。'},
        {'key': 'master_db_path', 'label': 'マスタDBだけ別の場所へ', 'mode': 'file',
         'value': str(raw.get('master_db_path') or ''),
         'expanded': expanded('master_db_path'),
         'effective': _master_configured(),
         'default': str(app_db / 'master.sqlite3'),
         'what': 'master.sqlite3（設定・マスタの全部）',
         'hint': '<b>ファイル名まで</b>指定します（フォルダではありません）。'
                 '共有フォルダを指定すると、書込は順番待ちを通り、'
                 '読みはこの端末の写しからになります。'},
        {'key': 'records_db_path', 'label': 'records.sqlite3 だけ別の場所へ',
         'mode': 'file',
         'value': str(raw.get('records_db_path') or ''),
         'expanded': expanded('records_db_path'),
         'effective': _records_configured(),
         'default': str(app_db / 'records.sqlite3'),
         'what': 'records.sqlite3（この端末で測ったぶんの控え）',
         'hint': '<b>ファイル名まで</b>指定します（フォルダではありません）。'
                 'みんなで見る測定データの置き場は<b>これではありません</b>——'
                 '「② みんなで使う」の「測定データ（共有）」のほうです。'
                 '<b>ふつうは空欄でかまいません。</b>'},
        {'key': 'master_share_mode', 'label': 'マスタの書込サイクル',
         'mode': 'choice',
         'choices': [['', '（既定）auto: 置き場の綴りで決める'],
                     ['auto', 'auto: 置き場の綴りで決める'],
                     ['on', 'on: 常に順番待ちを通す'],
                     ['off', 'off: 常に直に書く']],
         'value': str(raw.get('master_share_mode') or ''),
         'effective': _master_share_mode(),
         'default': 'auto',
         'what': 'マスタを共有に置いたときの守り方',
         'hint': 'auto は「置き場がUNC／クラウド同期フォルダなら順番待ちを通す」です。'
                 '手元に置いている端末では何も起きません。'},
    ]


def _master_configured():
    from .db_access import _MASTER_PATH_CONFIGURED
    return str(_MASTER_PATH_CONFIGURED)


def _records_configured():
    from .db_access import MEAS_DB
    return str(MEAS_DB)


def _master_share_mode():
    v = str(_local_config_raw().get('master_share_mode') or '').strip().lower()
    return v if v in ('auto', 'on', 'off') else 'auto'


# ------------------------------------------------------------------
# 置き場そのもの
# ------------------------------------------------------------------
# パス設定マスタは**1回の`items()`につき1回だけ開く**（§9.268の追補）。
# 以前は行ごとに`_saved_of()`が開いており、`/api/storage-layout`1回で
# **11回**開いて11回statしていた（9行＋`items()`の明示2回）。手元に置いて
# いる端末では実害が出ないが、マスタを共有へ移すとそのぶん往復が増える。
# **スレッドごとに持つ**——Flaskは`threaded=True`で動くので、モジュール変数に
# 置くと別のリクエストの写しを読みうる。
_tls = threading.local()


def _read_path_config():
    """パス設定マスタを1回読む。読めなければ空。

    **開く前に`exists()`を置かない**（CLAUDE.md）——読みたいのはファイル
    そのもので、確認は別のファイルアクセスになる。共有越しでは「開けるのに
    statだけ失敗する」ことがあり、確認のつもりの1行が唯一の失敗原因になる。
    **読めなくても送出しない**——置き場の一覧は「保存値が空」で出せるので、
    ここで投げて画面ごと開けなくしない（§9.89）。
    """
    try:
        from .db_access import DBS, connect, path_config_rows
        with connect(DBS['MASTER']['path'], True) as c:
            return dict(path_config_rows(c))
    except Exception:
        return {}


@contextmanager
def _path_config_once():
    """このブロックのあいだ、パス設定マスタの読みを1回にまとめる。

    **入れ子で二重に読まない**（外側が持っていればそれを使う）。
    """
    fresh = getattr(_tls, 'pathcfg', None) is None
    if fresh:
        _tls.pathcfg = _read_path_config()
    try:
        yield
    finally:
        if fresh:
            _tls.pathcfg = None


def _saved_of(field, store):
    """その欄の**保存値**（効いている値ではない）。

    **効いている値と混ぜないこと**（§9.250 ⑩）——欄に効いている値を出して
    しまうと、空欄の設定を画面がそのまま送り返すだけで値が焼き付く。
    """
    if not field:
        return ''
    if store == 'local-json':
        return str(_local_config_raw().get(field) or '')
    rows = getattr(_tls, 'pathcfg', None)
    if rows is None:
        rows = _read_path_config()
    return str(rows.get(field, '') or '')


def _planned_of(key, saved, active):
    """保存値から解決した「これから効く置き場」。

    **綴りの解釈は本体と同じ1箇所を通す**（§9.163）——どの置き場もフォルダを
    書いてよいので（§9.271）、ここで自前に組み立てると画面と実物が食い違う。

    **環境変数は展開してから返す**（§9.271）。ここは「これから効く値」＝
    画面が出す先であり、**「無いので作る」が作る先**でもある。生のまま返すと、
    `%LOCALAPPDATA%\\WaveLog` と書いた端末では**どこへ置かれるのか画面から
    読めず**、作ることもできない（`_is_absolute()`に弾かれる）。
    **保存は生のまま**なのは今までどおり（§9.268の追補）。
    """
    if not saved:
        return str(active or '')
    from .db_access import resolve_db_file
    name = {'schedule': 'schedule.sqlite3', 'master': 'master.sqlite3',
            'recordsLocal': 'records.sqlite3'}.get(key)
    if name:
        try:
            return str(resolve_db_file(paths.expand_path(saved), name) or '')
        except Exception:
            return str(saved)
    return str(paths.expand_path(saved) or saved)


def _row(key, group, label, what, path, **kw):
    """1行。`path`は**このプロセスで効いている値**。

    置き場の設定はどれも起動時に1回だけ読むので、保存しただけの値は
    まだ効いていない。**利用者が直すのも作るのも「保存した値」のほう**
    （利用者の指示「設定さえ書いてあればフォルダやファイルが存在しない
    場合には作成して、ユーザーの操作を妨げないように」）——再起動しないと
    作れないのでは、それこそ操作を妨げる。だから
      path    … これから効く値（保存値から解決したもの）＝直す・作る対象
      active  … いま効いている値
      pending … その2つが食い違っている＝再起動待ち
    の3つを返し、**画面はそれをそのまま出す**。
    """
    store = kw.get('store', 'path-master')
    field = kw.get('field', '')
    saved = _saved_of(field, store)
    planned = kw.get('planned')
    if planned is None:
        planned = _planned_of(key, saved, path)
    row = {'key': key, 'group': group, 'label': label, 'what': what,
           'path': str(planned or ''), 'active': str(path or ''),
           'pending': bool(planned and path and str(planned) != str(path))
                      or bool(planned and not path) or bool(path and not planned),
           'kind': kind_of(planned or path),
           'exists': exists_of(planned or path),
           'store': store,
           'field': field,
           'saved': saved,
           'mode': kw.get('mode', 'dir'),
           'when': kw.get('when', 'restart'),
           'editable': kw.get('editable', True),
           'creatable': kw.get('creatable', True),
           'from': kw.get('from', ''),
           'note': kw.get('note', ''),
           'retired': kw.get('retired', ''),
           'jump': kw.get('jump', ''),
           # 共通設定の中の節へ飛ぶ印（`jump`はマスタのタブへ飛ぶ印）。
           'section': kw.get('section', '')}
    return row


def items():
    """この端末が読み書きする置き場の全部。

    群は3つ——「この端末の中」「みんなで使う」「読むだけ」。
    **群を増やすより、どの群に入るかを決めるほうが読む側は楽**（§9.264）。
    """
    from . import master_share
    from .db_access import (DBS, MEAS_DB, RECORDS_SHARE_DIR,
                            RECORDS_BACKUP_EXPORT_PATH, SCHEDULE_SHARE_PATH,
                            SCHEDULE_SHARE_FROM, PURPOSE_SCHEDULE)
    from . import records_export

    with _path_config_once():
        return _items_inner(records_export)


def _items_inner(records_export):
    from . import master_share
    from .db_access import (DBS, MEAS_DB, RECORDS_SHARE_DIR,
                            RECORDS_BACKUP_EXPORT_PATH, SCHEDULE_SHARE_PATH,
                            SCHEDULE_SHARE_FROM, PURPOSE_SCHEDULE)

    out = []

    # ---- ① この端末の中 ----
    master_src = str(master_share.source_path() or DBS['MASTER']['path'])
    out.append(_row(
        'master', 'terminal', 'マスタ', '設定・マスタの全部（master.sqlite3）',
        master_src, store='local-json', field='master_db_path', mode='file',
        note=('共有で動いています。書くときは順番待ち（ロック→取り直し→反映）を通り、'
              '読むのはこの端末の写しからです。' if master_share.is_shared()
              else 'この端末の中だけです。共有フォルダへ移すと、'
                   '書き込みが重ならないよう順番待ちを通る形で動きます。')))
    out[-1]['from'] = ('master_db_path' if _local_config_raw().get('master_db_path')
                       else ('db_dir' if _local_config_raw().get('db_dir') else '既定'))
    out[-1]['shared'] = master_share.is_shared()
    if master_share.is_shared():
        out[-1]['mirror'] = str(master_share.local_path() or '')

    out.append(_row(
        'recordsLocal', 'terminal', '測定データ（この端末）',
        'この端末で測ったぶんの控え（records.sqlite3）',
        MEAS_DB, store='local-json', field='records_db_path', mode='file',
        note='共有の置き場を決めても、書けなかったときの逃げ場としてここは残ります。'))
    out[-1]['from'] = ('records_db_path' if _local_config_raw().get('records_db_path')
                       else ('db_dir' if _local_config_raw().get('db_dir') else '既定'))

    out.append(_row(
        'work', 'terminal', '作り直せるファイル',
        '共有からの写し・作業コピー・バイトコード',
        paths.work_dir(), store='auto', editable=False, creatable=False,
        when='live',
        note=(paths.work_dir_reason() or
              'データの置き場がそのまま使われています（手元なので逃がす必要がありません）。')))

    # ---- ② みんなで使う ----
    # **一言は「これから効く値」で書く**——保存した直後は SCHEDULE_SHARE_PATH が
    # まだ空なので、in-processの値で書くと「まだ設定されていません」と出て、
    # いま入力した値を否定することになる。
    sched_saved = _saved_of('schedule_share_path', 'path-master')
    out.append(_row(
        'schedule', 'share', '作業予定',
        'みんなで使う予定表（schedule.sqlite3）',
        SCHEDULE_SHARE_PATH or '', field='schedule_share_path', mode='dir',
        note=('' if (SCHEDULE_SHARE_PATH or sched_saved)
              else 'まだ設定されていません（スケジュール機能は無効です）。')))
    out[-1]['from'] = ('パス設定' if (SCHEDULE_SHARE_FROM == 'path-config' or sched_saved)
                       else ('データソースの役割「スケジュール」'
                             if SCHEDULE_SHARE_FROM == 'data-source' else '未設定'))

    rec_saved = _saved_of('records_share_dir', 'path-master')
    out.append(_row(
        'recordsShare', 'share', '測定データ（共有）',
        '設備ごとのフォルダ（<設備>\\records.sqlite3）',
        RECORDS_SHARE_DIR or '', field='records_share_dir', mode='dir',
        note=('' if (RECORDS_SHARE_DIR or rec_saved) else
              'まだこの端末の中だけです。置き場を決めると設備ごとに分けて置けます。')))
    out[-1]['from'] = 'パス設定' if rec_saved else '未設定'

    retired = ''
    try:
        retired = records_export.retired_reason() or ''
    except Exception:
        retired = ''
    out.append(_row(
        'export', 'share', '閲覧用の複製',
        '測定データを丸ごと写す先（役目を終えました）',
        RECORDS_BACKUP_EXPORT_PATH or '', field='records_backup_export_path',
        mode='dir', retired=retired,
        editable=not retired, creatable=not retired,
        note=(retired or
              '測定データの共有の置き場を決めると、この複製は要らなくなります。')))

    # ---- ③ 読むだけ ----
    for key, cfg in (DBS or {}).items():
        cfg = cfg or {}
        if cfg.get('role') != 'readonly':
            continue
        if cfg.get('purpose') == PURPOSE_SCHEDULE:
            continue
        from .db_access import source_override_key
        out.append(_row(
            'src:' + key, 'read', str(cfg.get('label') or key),
            '読むだけの参照データ', cfg.get('path') or '',
            field=source_override_key(key), mode='file', editable=False,
            creatable=False, jump='dataSource',
            note='読み込み先は「データ接続」のカードから直します'
                 '（同じ設定を2画面に置かないため）。'))

    from . import rne_scheduler
    try:
        # **欄はRNE抽出の節が持つ**（§9.207 入口は1つ）——ここに欄を置くと
        # 同じ `data-pc-field` が画面に2つ並び、保存はDOM順で後の側が勝つ
        # ＝どちらが効くのか分からなくなる。ここは在り処だけ言って連れて行く。
        out.append(_row('rneAssets', 'read', 'RNE資材',
                        'RNEファイルと symnavim.conf の置き場',
                        rne_scheduler.assets_dir(), field='rne_assets_dir',
                        mode='dir', when='live', editable=False, creatable=False,
                        section='rne',
                        note='読み込み先は「RNE抽出」の節で直します。'))
    except Exception:
        pass
    return out


def same_root(rows):
    """3つの「本体」が同じ場所の下にあるか。**1つでも未設定なら言わない**——
    2つだけを見て同じ根だと言うと、まだ置いていないものまで置いた気にさせる。
    """
    roots = []
    for x in rows:
        if x['key'] not in ('master', 'schedule', 'recordsShare'):
            continue
        if not x['path']:
            return ''
        try:
            p = Path(x['path'])
            roots.append(str(p if x['key'] == 'recordsShare' else p.parent))
        except Exception:
            return ''
    return roots[0] if len(roots) == 3 and len(set(roots)) == 1 else ''


def layout():
    rows = items()
    return {'items': rows, 'sameRoot': same_root(rows),
            'localConfig': local_config_fields(),
            'localConfigPath': str(local_config_path()),
            # **読めなかったことを画面に出す**（§9.271）。黙って空として扱うと、
            # 書いた設定が1つも効いていないのに画面は「既定のまま」に見える。
            'localConfigError': paths.local_config_error() or '',
            'onShare': [x['key'] for x in rows if x['kind'] in ('network', 'cloud')]}


# ==================================================================
# config/local.json の書き換え（§9.267、利用者の指示「local.jsonの扱いが
# わからない…全ての設定を共通設定に」）
# ==================================================================
# **画面から直せるようにする。** 鶏と卵なのは**読む側**の話（起動時に
# マスタDBの場所を知るために外のファイルが要る）であって、書く側ではない。
# 直せないままにしておくと、置き場の設定だけが画面の外に残る。
#
# **守りは3つ**——①受け付ける鍵を限る ②絶対パスだけ ③書く前に前の内容を
# 控える。壊れた local.json は起動を止めうるので、戻せる道を必ず残す。
LOCAL_CONFIG_BACKUP_SUFFIX = '.bak'


class LocalConfigError(Exception):
    pass


def _is_absolute(raw):
    """絶対パスか。**Windowsの綴りをLinuxでも見分ける**——検証はLinuxで
    走るので、`Path.is_absolute()`だけだと`C:\\...`も`\\\\server\\share`も
    相対パス扱いになり、この判定を一度も通らない（§CLAUDE「UNCの判定は
    resolve()の前に生の文字列で」と同じ理由）。"""
    s = str(raw or '').strip()
    if not s:
        return False
    if s.startswith('\\\\') or s.startswith('//'):
        return True
    if len(s) >= 3 and s[1] == ':' and s[2] in '\\/' and s[0].isalpha():
        return True
    return Path(s).is_absolute()


def validate_local_config(updates):
    """受け取った値を確かめる。→ 直したい値の辞書（エラーは送出）。

    **存在確認はしない**（利用者の指示「設定さえ書いてあればフォルダや
    ファイルが存在しない場合には強制的に作成して、ユーザーの操作を妨げない
    ように」）——共有が落ちていても保存はできる。作るかどうかは
    `prepare_path()`が別に受け持つ。
    """
    out = {}
    errors = []
    for key, value in (updates or {}).items():
        if key not in LOCAL_CONFIG_KEYS:
            errors.append(f'{key} はここでは設定できません。')
            continue
        raw = str(value or '').strip()
        if key in LOCAL_CONFIG_CHOICE_KEYS:
            allowed = LOCAL_CONFIG_CHOICE_KEYS[key]
            if raw and raw not in allowed:
                errors.append(f'{key} は「' + '」「'.join(allowed) + '」のいずれかです。')
                continue
            out[key] = raw
            continue
        raw = raw.rstrip('\\/') if len(raw.rstrip('\\/')) > 2 else raw
        # **展開してから確かめ、書くのは生のまま**（§9.268の追補）——
        # `%LOCALAPPDATA%\WaveLog` のように変数で書けると、同じ
        # `config/local.json` を全端末へ配れる。展開して保存すると端末ごとに
        # 違う文字列になり、変数で書きたい理由そのものが消える。
        shown = paths.expand_path(raw)
        if raw and not _is_absolute(shown):
            # **理由を言い分ける**（§4・§6）——「絶対パスにしてください」だけ
            # だと、変数を書いたのに空だった場合に打つ手が分からない。
            has_var = ('%' in raw) or ('$' in raw)
            if shown != raw:
                why = f'（「{raw}」は「{shown}」になります）'
            elif has_var:
                why = (f'（「{raw}」の環境変数がこの端末では空でした。'
                       'システム環境変数を確かめるか、実際のパスを書いてください）')
            else:
                why = f'（いまは「{raw}」）'
            errors.append(f'{key} は絶対パスで指定してください{why}。')
            continue
        out[key] = raw
    if errors:
        raise LocalConfigError(' / '.join(errors))
    return out


def save_local_config(updates):
    """`config/local.json` を書き換える。→ (書いた内容, 控えのパス)

    **送られてこなかった鍵は触らない**（§9.212 ②）。空文字は「既定へ戻す」で、
    その鍵を消す（`{}`が既定の姿）。
    """
    import json
    values = validate_local_config(updates)
    path = local_config_path()
    current = dict(_local_config_raw())
    for key, value in values.items():
        if value:
            current[key] = value
        else:
            current.pop(key, None)
    # **書く前に控える。** 壊れた local.json は起動を止めうるので、
    # 「1つ前に戻す」道を必ず残す（消えても困らないので失敗は無視する）。
    backup = path.with_suffix(path.suffix + LOCAL_CONFIG_BACKUP_SUFFIX)
    try:
        if path.exists():
            backup.write_text(path.read_text(encoding='utf-8'), encoding='utf-8')
    except Exception:
        backup = None
    text = json.dumps(current, ensure_ascii=False, indent=2) + '\n'
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(text, encoding='utf-8')
    from . import atomic_io
    atomic_io.replace(tmp, path, label='local.json')
    return current, (str(backup) if backup else '')


# ==================================================================
# 「無ければ作る。ただし作る前に確認する」（§9.267、利用者の指示）
# ==================================================================
# **既定は下見**（§9.193）——`apply:true` を送るまで1つも作らない。
# 何ができるのか（どのフォルダの連鎖・どのファイル）を先に出す。
def _chain(path):
    """作られることになるフォルダを、上から順に返す（既に在るものは除く）。"""
    out = []
    cur = Path(path)
    guard = 0
    while guard < 64:
        guard += 1
        if exists_of(cur) is not False:
            break
        out.append(str(cur))
        parent = cur.parent
        if parent == cur:
            break
        cur = parent
    return list(reversed(out))


def _blank_sqlite(path):
    """空のSQLiteを1つ作る。**中身はアプリが後から入れる**——ここで表を
    作ると、表の定義が`ensure_*`と2箇所になる。

    **ヘッダまで書かせること。** SQLiteは中身を書くまでファイルへ1バイトも
    書かないので、`PRAGMA user_version`（読むだけ）では**0バイトのファイル**が
    残る——それは`touch()`と同じで、「作った」と言いながら中身は
    コピーに失敗した残骸と見分けが付かない。書き込みを伴う
    `PRAGMA user_version=0`でヘッダだけ書かせる（表は作らない）。
    """
    import sqlite3
    con = sqlite3.connect(str(path))
    try:
        con.execute('PRAGMA user_version=0')
        con.commit()
    finally:
        con.close()


def prepare_path(raw, mode='dir', apply=False):
    """置き場を用意する。→ 何が起きるか（起きたか）の答え。

    `mode='file'` ならフォルダの連鎖＋空のファイル、`'dir'` ならフォルダだけ。
    """
    written = str(raw or '').strip()
    if not written:
        raise LocalConfigError('先に置き場を決めてください（空欄です）。')
    # **先に環境変数を展開する**（§9.271）。`%LOCALAPPDATA%\WaveLog` は
    # 展開前は相対パスに見えるので、素で見ると**変数で書いた端末では
    # 「無いので作る」が一度も押せない**（しかも「絶対パスで指定して
    # ください」と、書いてあるのに否定する文言が出る）。
    raw = paths.expand_path(written)
    if not _is_absolute(raw):
        has_var = ('%' in written) or ('$' in written)
        if raw != written:
            why = f'（「{written}」は「{raw}」になります）'
        elif has_var:
            why = (f'（「{written}」の環境変数がこの端末では空でした。'
                   'システム環境変数を確かめるか、実際のパスを書いてください）')
        else:
            why = f'（いまは「{written}」）'
        raise LocalConfigError(f'絶対パスで指定してください{why}。')
    target = Path(raw.rstrip('\\/') if len(raw.rstrip('\\/')) > 2 else raw)
    folder = target.parent if mode == 'file' else target
    made_dirs = _chain(folder)
    have_file = exists_of(target) is True if mode == 'file' else None
    plan = {'path': str(target), 'mode': mode,
            'dirs': made_dirs,
            'file': '' if mode != 'file' or have_file else str(target),
            'already': not made_dirs and (mode != 'file' or have_file is True),
            'kind': kind_of(target), 'apply': bool(apply)}
    if not apply:
        return plan
    try:
        folder.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        raise LocalConfigError(f'フォルダを作れませんでした: {folder}\n{e}')
    if mode == 'file' and not have_file:
        try:
            if str(target).lower().endswith(('.sqlite3', '.db', '.sqlite')):
                _blank_sqlite(target)
            else:
                target.touch()
        except Exception as e:
            raise LocalConfigError(f'ファイルを作れませんでした: {target}\n{e}')
    # **作ったあと、実際に書けるかまで確かめる**——作れても書けない共有が
    # あり、そこで止まると「作ったのに動かない」になる。
    probe = folder / '.wavelog-write-test'
    try:
        probe.write_text('', encoding='utf-8')
        try:
            probe.unlink()
        except Exception:
            pass
        plan['writable'] = True
    except Exception as e:
        plan['writable'] = False
        plan['writeError'] = str(e)
    plan['done'] = True
    return plan
