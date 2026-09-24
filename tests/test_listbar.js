/* test_listbar.js: 一覧の道具の帯は2段（§9.468）
   ============================================================
   利用者の指示「仕掛一覧をスケジュールと並べて表示する場合、統一感もなく
   バラバラしていてメニューがゴチャつきます。すぐに必要な機能とそうでもない
   機能、常に見えていないといけない表示と調べてわかればよい表示に分けて…」

   固定するのは3つ（利用者の常用の見え方 1728×1152 で測る）:
    1. スケジュールと並べたとき（一覧の幅380px）、帯は**2段**・高さ90px以下
       （前: 5段・236px）
    2. 決めたら触らない設定（表示列・行間・並び・表示件数）は「☰ 表示」の
       浮きパネルの中。**名前の列の右（欄の左端）がそろう**・Escで閉じる
    3. 「☰ 表示」は1段目（絞り込みのバーの席）に居る
   ============================================================ */
'use strict';
const H = require('./lib/harness.js');
const W = require('./lib/wait.js');
const B = H.B;
const EQ = 'テスト設備A';

H.run('test_listbar: 一覧の道具の帯は2段（§9.468）', async ({ page, rec, setMode }) => {
 try {
  await page.goto(B + '/', { waitUntil: 'domcontentloaded' }); await W.booted(page);
  await page.evaluate(e => { localStorage.setItem('AccessMeasurementConfiguredEquipment', e);
   localStorage.setItem('scLayoutPrefsV1', JSON.stringify({ swap: false, open: 'split' })); }, EQ);
  await setMode('schedule');
  await page.reload({ waitUntil: 'domcontentloaded' }); await W.booted(page);
  await page.waitForSelector('#openSchedule', { timeout: 25000 });
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-board-row', { timeout: 25000 });
  await page.evaluate(e => { const r = [...document.querySelectorAll('.sc-board-row')].find(x => x.dataset.equipment === e); if (r) r.click(); }, EQ);
  await page.waitForSelector('.sc-row-line', { timeout: 30000 });
  await W.until(page, () => document.querySelectorAll('#grid tbody tr').length > 0, null, { ms: 30000, what: '仕掛一覧' });
  /* 帯＝一覧の上にある、一覧と同じ幅の中の見えている操作・札。上端を12px刻みで束ねて段を数える。 */
  const bar = await page.evaluate(() => {
   const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
   const gr = document.querySelector('#grid').getBoundingClientRect();
   const els = [...document.querySelectorAll('button, select, input[type=range], [class*="chip"]')].filter(vis)
    .filter(el => { const r = el.getBoundingClientRect(); return r.bottom <= gr.top + 2 && r.left >= gr.left - 4 && r.right <= gr.right + 4 && r.top > 40; })
    .filter(el => !el.closest('#headerViewBar') && !el.parentElement.closest('button'));
   const tops = [...new Set(els.map(e => Math.round(e.getBoundingClientRect().top)))].sort((a, b) => a - b);
   const bands = []; tops.forEach(t => { if (!bands.length || t - bands[bands.length - 1] > 12) bands.push(t); });
   const first = Math.min(...els.map(e => e.getBoundingClientRect().top));
   return { rows: bands.length, h: Math.round(gr.top - first), w: Math.round(gr.width), n: els.length,
            viewIn: (document.getElementById('listViewBtn') || {}).parentElement?.id || '' };
  });
  rec('スケジュールと並べたとき、一覧の帯は2段（すぐ使う操作／常に見る状態）', bar.rows <= 2, JSON.stringify(bar));
  rec('帯の高さは90px以下（前は236px）', bar.h <= 90, `${bar.h}px（一覧の幅 ${bar.w}px）`);
  rec('「☰ 表示」は1段目（絞り込みのバーの席）', bar.viewIn === 'filterBarSlot', bar.viewIn);
  await W.listView(page);
  const panel = await page.evaluate(() => [...document.querySelectorAll('#listViewPanel .lvp-row')]
   .filter(x => x.getBoundingClientRect().height > 0)
   .map(x => Math.round((x.children[1] || x).getBoundingClientRect().left)));
  rec('「☰ 表示」の中の欄は左端がそろう（名前の列は固定幅）',
      panel.length >= 4 && new Set(panel).size === 1, panel.join('/'));
  rec('設定（表示列・行間・並び・表示件数）は「☰ 表示」の中',
      await page.evaluate(() => ['listColumnBtn', 'listRowGap', 'listSort', 'pageSize']
       .every(id => document.getElementById('listViewPanel').contains(document.getElementById(id)))));
  await page.keyboard.press('Escape');
  await W.until(page, () => document.getElementById('listViewPanel').hidden, null, { ms: 5000, what: 'Escで「表示」が閉じる' });
  rec('「☰ 表示」はEscで閉じる', true);
 } finally {
  await setMode('edit');
 }
}, { viewport: { width: 1728, height: 1152 } });
