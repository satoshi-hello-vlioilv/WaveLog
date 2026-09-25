"""setup_app.py: 起動前の確認と下ごしらえ(§9.225)。`update.bat`から呼ばれる。

**導入時と、アプリを更新したあとに1回だけ**実行する。ここで済ませた確認は
刻印(`%LOCALAPPDATA%\\WaveLog\\runtime\\ready.json`)に残り、毎日の起動
(Start.vbs)はそれを見て確認を飛ばす。

**刻印が食い違っても起動は止まらない**——`start_app.py`がその場で同じ確認を
やり直して起動する(遅くなるだけ)。だからこのファイルの実行を忘れても
「動かなくなる」ことはない。速さのためのものである、という位置づけを
崩さないこと。
"""
import _pycache_bootstrap  # noqa: F401 副作用のためのimport。**いちばん最初に**（.pycの置き場を決める。`program/`の隣に在るので探索先の用意は要らない・§9.406）
import _approot  # noqa: F401,E402 副作用のためのimport。リポジトリ直下（`backend`の在り処）を探索先へ入れる・§9.404

import sys

from backend import file_cleanup
from backend.launcher import ready, setup_check
from backend.logging_setup import console_off, launcher_logger, log_environment
from backend.paths import (APP_ROOT, ensure_local_dirs, is_network_path,
                           local_root, logs_dir)


def main():
    """**画面に出すのは「結果」と「次にすること」だけ**（§9.431、利用者の指示
    「ユーザーが読んで知っておくべき情報をもっとわかりやすく表示する。一般的には
    不要な情報が多い」）。置き場の道・刻印・写しの行き先は**記録（ログ）へ**回す
    ——毎回同じで、読んでも打つ手が変わらない。"""
    # **どの記録も画面へ出さない**（§9.497の追補）——途中で読み込まれる部品（db_access 等）が
    # 読み込んだだけで出す警告まで含めて。記録そのものは app.log／launcher.log に残る。
    console_off()
    ensure_local_dirs()
    # **記録は launcher.log へ、画面は結果だけ**（§9.431）。時刻つきの記録を
    # 混ぜない——`log_environment()` だけで6行出て、読むものが倍になる。
    log = launcher_logger(to_console=False)
    log.info('--- 起動前の確認 (setup) ---')
    log_environment(log)
    line = '=' * 60
    bad_seen = []
    print('')
    print(line)
    print('  WaveLog  起動の準備')
    print(line)
    # **版を最初に言う**（§9.497、利用者の指示「update.batでアップデートの版の表示追加」）。
    # 何へ更新したのかが分からないと、更新が効いたのかを確かめる手が無い。比べる相手は前回の刻印。
    prev = ready.read()
    print('  アプリの版         %s' % ready.version_note(prev))
    print('  アプリの置き場所   %s' % APP_ROOT)
    print('  この端末の作業場所 %s' % local_root())
    print('')

    def say(message, bad=False, quiet=False):
        """`quiet=True` は**記録だけ**（画面に出さない）。

        画面に出る行は**そのまま読める短い1行**にする——頭に `[OK]`／`[NG]` が
        付くので、文は「何を確かめたか」だけでよい。"""
        text = str(message)
        (log.warning if bad else log.info)('setup: %s', text)
        if bad:
            bad_seen.append(text)
        if quiet:
            return
        print(('  [NG] ' if bad else '  [OK] ') + text)

    before = ready.mismatch()
    say('前回の確認からの違い: ' + (' / '.join(before) if before else 'なし'), quiet=True)

    # **作り直せる古いデータを片付けてから**確かめる（§9.497、利用者の指示「古いデータ
    # (一時ファイルたち)をアップデートで一旦消して、作り直した方が良い」）。バイトコードは
    # 直後の事前コンパイルが、待機画面の写しは直後の写し直しが作り直す。本物のデータ
    # （マスタ・測定データ・設定・ログ）は`file_cleanup`から見えない場所にあり、触らない。
    try:
        got = file_cleanup.run_for_update()
        if got['removed']:
            note = file_cleanup.failed_note(got)
            say('古いデータを片付けました（作り直せるもの %d件・%.1fMB）%s' % (
                got['removed'], got['bytes'] / 1048576.0, ('。' + note) if note else ''))
        else:
            say('片付ける古いデータはありませんでした', quiet=True)
        for r in got['results']:
            if r['removed'] or r['failed']:
                say('片付け: %s %d件（残した %d件）' % (r['label'], r['removed'], r['failed']), quiet=True)
    except Exception as e:
        # **片付けられなくても準備は続ける**（作り直せる物が残るだけで、動きは変わらない）。
        say('古いデータを片付けられませんでした（準備は続けます）: %s' % e, quiet=True)
    ok, why = setup_check.run(say)
    if is_network_path(APP_ROOT):
        say('アプリ本体は共有フォルダーにあります'
            '（この端末の中だけへ書きます。共有には書きません）')
    print('')
    print('-' * 60)
    if ok:
        print('  準備ができました。')
        print('')
        print('  次にすること')
        print('    デスクトップの「WaveLog」から起動してください。')
        print('')
        print('  覚えておくこと')
        print('    アプリを更新したら、この update.bat をもう一度実行してください。')
        print('    （忘れても起動はできます。その1回だけ起動が遅くなります）')
    else:
        print('  準備できていません: %s' % why)
        print('')
        print('  次にすること')
        print('    上の [NG] の行を直してから、もう一度 update.bat を実行してください。')
        print('    この状態でも起動は試みますが、失敗することがあります。')
    # **困ったときの行き先は、困ったときだけ出す**（§CLAUDE 2 次にすることを
    # 1つだけ指す）。うまくいった回に道を並べても、読む側は打つ手を選べない。
    if bad_seen:
        print('')
        print('  記録（うまくいかないときはこの中を見てください）')
        print('    %s' % logs_dir())
    print(line)
    log.info('--- 起動前の確認 完了 (%s) ---', '合格' if ok else '不合格')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
