"""setup_app.py: 起動前の確認と下ごしらえ(§9.225)。`setup.bat`から呼ばれる。

**導入時と、アプリを更新したあとに1回だけ**実行する。ここで済ませた確認は
刻印(`%LOCALAPPDATA%\\WaveLog\\runtime\\ready.json`)に残り、毎日の起動
(Start.vbs)はそれを見て確認を飛ばす。

**刻印が食い違っても起動は止まらない**——`start_app.py`がその場で同じ確認を
やり直して起動する(遅くなるだけ)。だからこのファイルの実行を忘れても
「動かなくなる」ことはない。速さのためのものである、という位置づけを
崩さないこと。
"""
import _approot  # noqa: F401 **必ず1行目のimport**（program/から実行されるので、リポジトリ直下をimportの探索先へ入れる・§9.404）
import _pycache_bootstrap  # noqa: E402 `_approot`の次に

import sys

from backend.launcher import ready, setup_check
from backend.logging_setup import launcher_logger, log_environment
from backend.paths import APP_ROOT, ensure_local_dirs, is_network_path


def main():
    ensure_local_dirs()
    log = launcher_logger()
    log.info('--- 起動前の確認 (setup) ---')
    log_environment(log)
    print('WaveLog: 起動前の確認')
    print('  アプリの置き場所: %s' % APP_ROOT)

    def say(message, bad=False):
        text = str(message)
        print(('  [!] ' if bad else '  ') + text)
        (log.warning if bad else log.info)('setup: %s', text)

    before = ready.mismatch()
    if before:
        say('前回からの違い: ' + ' / '.join(before))
    else:
        say('前回の確認から変わっていません（もう一度確かめます）')

    ok, why = setup_check.run(say)
    if is_network_path(APP_ROOT):
        say('アプリ本体は共有フォルダーにあります。バイトコード・進捗ファイル・'
            '写しはこの端末の中へ置きます（共有には書きません）')
    print('')
    if ok:
        print('  確認できました。次回からの起動が速くなります。')
        print('  ※ アプリを更新したあとは、もう一度このファイルを実行してください')
        print('    （忘れても起動はします。そのときだけ少し遅くなります）')
    else:
        print('  確認できませんでした: %s' % why)
        print('  この状態でも起動は試みますが、失敗する可能性があります。')
    log.info('--- 起動前の確認 完了 (%s) ---', '合格' if ok else '不合格')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
