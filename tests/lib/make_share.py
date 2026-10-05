"""make_share.py: 作業ツリーから「共有の置き場」を作る（CI の自己診断の3回目・§9.559）。

引数: 置き場のフォルダ。作業ツリーの版を ZIP（GitHub の「Download ZIP」と同じ頭`WaveLog-main/`）にして
`app_update.publish_zip()`で置き、`set_release()`で配る版にする——**本物の道で**置くので、配る入口
（`<置き場>\\WaveLog.exe`）と目録（sha256）も本物と同じにできる。exe は作業ツリーの`program/WaveLog.exe`
（CI が作った物を先に置いておく）。
`--bump`を付けると、同じ中身で版の字だけ`-ci`を足した版を置いて配る（4回目＝起動のときに配る版へそろえる道・§9.561）。
`--bump=ci2`のように字を渡すと`-ci2`（5回目＝入口役の python.exe を挟んで入れ替える道・§9.571。同じ版の置き直しは断られるので字を変える）。
"""
import io
import json
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from backend import app_update  # noqa: E402


def main(share, bump=''):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        for top in app_update.PAYLOAD:
            src = ROOT / top
            files = [src] if src.is_file() else [p for p in src.rglob('*') if p.is_file()]
            for p in files:
                rel = p.relative_to(ROOT).as_posix()
                if bump and rel == 'backend/changelog_data.py':
                    text = p.read_text(encoding='utf-8')
                    z.writestr('WaveLog-main/' + rel, text.replace(
                        "APP_VERSION='%s'" % app_update.APP_VERSION, "APP_VERSION='%s-%s'" % (app_update.APP_VERSION, bump), 1))
                    continue
                z.write(p, 'WaveLog-main/' + rel)
    base = Path(share)
    out = app_update.publish_zip(buf.getvalue(), 'ci.zip', 'ci', base)
    print('publish:', {k: out.get(k) for k in ('ok', 'version', 'files', 'error')})
    if not out.get('ok'):
        return 1
    rel = app_update.set_release(out['version'], 'ci', base)
    print('release:', rel)
    # 本番の置き場と同じく「新しい PC へ渡す設定」を置く（共有のマスタの置き場・§9.568）。CI の PC は工場の共有に
    # 届かないので、試しの置き場の中のマスタを渡す——置き忘れると既定の共有の場所を見に行く（それ自体は正しい振る舞い）。
    seed = base / app_update.SEED
    (base / 'Masters').mkdir(exist_ok=True)
    seed.write_text(json.dumps({'master_db_path': str(base / 'Masters' / 'master.sqlite3')}, ensure_ascii=False), encoding='utf-8')
    print('seed:', seed.read_text(encoding='utf-8'))
    return 0 if rel.get('ok') and (base / app_update.ENTRY_EXE).is_file() else 1


if __name__ == '__main__':
    flags = sys.argv[2:]
    tag = next((a.split('=', 1)[1] for a in flags if a.startswith('--bump=')), 'ci' if '--bump' in flags else '')
    sys.exit(main(sys.argv[1], tag))
