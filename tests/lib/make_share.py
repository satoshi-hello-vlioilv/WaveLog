"""make_share.py: 作業ツリーから「共有の置き場」を作る（CI の自己診断の3回目・§9.559）。

引数: 置き場のフォルダ。作業ツリーの版を ZIP（GitHub の「Download ZIP」と同じ頭`WaveLog-main/`）にして
`app_update.publish_zip()`で置き、`set_release()`で配る版にする——**本物の道で**置くので、配る入口
（`<置き場>\\WaveLog.exe`）と目録（sha256）も本物と同じにできる。exe は作業ツリーの`program/WaveLog.exe`
（CI が作った物を先に置いておく）。
`--bump`を付けると、同じ中身で版の字だけ`-ci`を足した版を置いて配る（4回目＝起動のときに配る版へそろえる道・§9.561）。
"""
import io
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from backend import app_update  # noqa: E402


def main(share, bump=False):
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
                        "APP_VERSION='%s'" % app_update.APP_VERSION, "APP_VERSION='%s-ci'" % app_update.APP_VERSION, 1))
                    continue
                z.write(p, 'WaveLog-main/' + rel)
    base = Path(share)
    out = app_update.publish_zip(buf.getvalue(), 'ci.zip', 'ci', base)
    print('publish:', {k: out.get(k) for k in ('ok', 'version', 'files', 'error')})
    if not out.get('ok'):
        return 1
    rel = app_update.set_release(out['version'], 'ci', base)
    print('release:', rel)
    return 0 if rel.get('ok') and (base / app_update.ENTRY_EXE).is_file() else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1], '--bump' in sys.argv[2:]))
