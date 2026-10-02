/* test_saveio.js: ファイルの保存は WL.base.saveBlob／saveFrom の1箇所（§9.551）
   ================================================================
   デスクトップ版の窓（WebView2）では、窓の宛先から**添付で返る応答へページを移しても保存が始まらない**
   （CI の自己診断で実測）。Blob を a[download] で落とす道は通るので、中身（Python）が返すファイルも
   fetch で受け取って Blob にしてから落とす。窓そのものの確かめは desktop/src/selftest.js（本物の WebView2）、
   ここはブラウザで「同じ答えを返すか・ページを移さないか・断りを言うか」を見る。

   物差し:
    ① saveFrom: Excel が日本語の名前（filename*）のまま・中身どおり（PK）に、Blob から落ち、ページを移さない
    ② ログの「保存」（data-log-save）を押しても、ページを移さずに Blob から .log が落ちる
       （落とす元が blob: であること＝窓で通る道。添付へページを移す形はブラウザでは落ちるので、それだけでは見分けられない）
    ③ 断られたら（400）理由を言う Error を投げ、ページを移さない
    ④ 保存を自前で書いている所が無い（URL.createObjectURL・a.download は base.js の saveBlob だけ）
   ================================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { run } = require('./lib/harness.js');
const W = require('./lib/wait.js');
const ROOT = path.join(__dirname, '..');

run('test_saveio: ファイルの保存は1箇所（§9.551）', async ({ page, rec, B }) => {
  await page.goto(B + '/', { waitUntil: 'domcontentloaded' });
  await W.booted(page);
  const home = page.url();

  /* ---- ① saveFrom: Excel ---- */
  let dl = page.waitForEvent('download', { timeout: 15000 });
  const named = await page.evaluate(() => WL.base.saveFrom('/api/roll-master/export', 'export.xlsx'));
  let d = await dl;
  const file = await d.path();
  const head = fs.readFileSync(file).subarray(0, 2).toString('latin1');
  rec('saveFrom: Excel が日本語の名前のまま・中身どおりに落ち、ページを移さない',
      /^ロールマスタ_.*\.xlsx$/.test(named) && d.suggestedFilename() === named && head === 'PK' && page.url() === home
      && d.url().startsWith('blob:'), JSON.stringify({ named, suggested: d.suggestedFilename(), head, url: page.url(), from: d.url().slice(0, 12) }));

  /* ---- ② ログの「保存」 ---- */
  await page.click('#openLogView');
  await page.click('#lgHead .lg-step[data-step="check"]');
  await W.until(page, () => document.querySelectorAll('#lgFiles [data-log-save]').length > 0, null,
    { ms: 10000, what: 'ログの一覧' });
  dl = page.waitForEvent('download', { timeout: 15000 });
  await page.click('#lgFiles [data-log-save]');
  d = await dl;
  /* 落とす元が blob: であること＝窓で通る道を通ったこと（添付へページを移す形はブラウザでは落ちるが、窓では始まらない） */
  rec('ログの「保存」はページを移さず、Blob から .log を落とす', /\.log$/.test(d.suggestedFilename()) && page.url() === home
      && d.url().startsWith('blob:'), JSON.stringify({ suggested: d.suggestedFilename(), url: page.url(), from: d.url().slice(0, 30) }));

  /* ---- ③ 断り ---- */
  const why = await page.evaluate(() => WL.base.saveFrom('/api/logs/download?file=..%2F..%2Fnope', 'x.log')
    .then(() => '', e => e.message));
  rec('断られたら理由を言い、ページを移さない', /扱えません/.test(why) && page.url() === home, why);

  /* ---- ④ 自前の保存が無い ---- */
  const own = [];
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'vendor') walk(p); return; }
    if (!p.endsWith('.js')) return;
    fs.readFileSync(p, 'utf8').split('\n').forEach((l, i) => {
      if (/createObjectURL|\.download\s*=|location\.href\s*=.*\/(export|download)/.test(l)) own.push(`${path.relative(ROOT, p)}:${i + 1}`);
    });
  });
  walk(path.join(ROOT, 'static', 'js'));
  rec('保存を自前で書いている所が無い（base.js の saveBlob だけ）',
      own.length > 0 && own.every(x => x.startsWith('static/js/core/base.js:')), own.join(' '));
});
