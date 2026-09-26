/* test_listbar.js: 一覧の道具の帯は2段（§9.468）
   ============================================================
   利用者の指示「仕掛一覧をスケジュールと並べて表示する場合、統一感もなく
   バラバラしていてメニューがゴチャつきます。すぐに必要な機能とそうでもない
   機能、常に見えていないといけない表示と調べてわかればよい表示に分けて…」

   固定するのは3つ（利用者の常用の見え方 1728×1152 で測る）:
    1. スケジュールと並べたとき（一覧の幅380px）、帯は**2段**・高さ90px以下
       （前: 5段・236px）
    2. 決めたら触らない設定（行間・並び・表示件数）は「表の見せ方」の
       浮きパネルの中。**名前の列の右（欄の左端）がそろう**・Escで閉じる
       （**1回のEscで閉じるのは1枚だけ**・§9.471）
    3. 「表示列」「表の見せ方」は1段目（絞り込みのバーの席）に居る。表示列は帯に直に（§9.505）
    4. 帯は「1面1サイズ」（§9.505）——字・押す物の高さ・角丸がそれぞれ1種（前: 4種・2種・3種）
   ============================================================ */
'use strict';
const H = require('./lib/harness.js');
const W = require('./lib/wait.js');
const B = H.B;
const EQ = 'テスト設備A';

H.run('test_listbar: 一覧の道具の帯は2段（§9.468）・1面1サイズ（§9.505）', async ({ page, rec, setMode }) => {
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
            viewIn: (document.getElementById('listViewBtn') || {}).parentElement?.id || '',
            colsIn: (document.getElementById('listColumnBtn') || {}).parentElement?.id || '',
            order: [...(document.getElementById('filterBarSlot') || { children: [] }).children].map(e => e.id).join(',') };
  });
  rec('スケジュールと並べたとき、一覧の帯は2段（すぐ使う操作／常に見る状態）', bar.rows <= 2, JSON.stringify(bar));
  rec('帯の高さは90px以下（前は236px）', bar.h <= 90, `${bar.h}px（一覧の幅 ${bar.w}px）`);
  rec('「表示列」「表の見せ方」は1段目（絞り込みのバーの席）・表示列が先',
      bar.viewIn === 'filterBarSlot' && bar.colsIn === 'filterBarSlot' && bar.order.startsWith('listColumnBtn,listViewBtn'), JSON.stringify(bar));
  await W.listView(page);
  const panel = await page.evaluate(() => [...document.querySelectorAll('#listViewPanel .lvp-row')]
   .filter(x => x.getBoundingClientRect().height > 0)
   .map(x => Math.round((x.children[1] || x).getBoundingClientRect().left)));
  rec('「表の見せ方」の中の欄は左端がそろう（名前の列は固定幅）',
      panel.length >= 4 && new Set(panel).size === 1, panel.join('/'));
  /* §9.481（利用者の報告「表示列の編集…マウスオーバーで表示文字がコントラスト不足で読めなくなる」）。
     `.wl-menu button:hover`の淡い地が塗りのボタンに勝ち、白字が 2.33 だった（離しても説明の行は 3.86）。
     字と**重ねた地**（透明なら祖先まで辿る）の比を、乗せた／離したの両方で 4.5 以上。 */
  const contrast = () => page.evaluate(() => {
   const b = document.getElementById('listColumnBtn');
   const rgb = s => { const m = (s.match(/[\d.]+/g) || []).map(Number); return m.length < 4 ? m.concat([1]) : m; };
   const lum = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; };
     return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); };
   const bgOf = e => { const st = []; for (let x = e; x; x = x.parentElement) {
     const c = rgb(getComputedStyle(x).backgroundColor); if (c[3] > 0) { st.push(c); if (c[3] >= 1) break; } }
     let acc = [255, 255, 255]; st.reverse().forEach(c => { acc = acc.map((v, k) => v * (1 - c[3]) + c[k] * c[3]); });
     return acc; };
   return Math.min(...[b, ...b.querySelectorAll('*')]
    .filter(e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()))
    .map(e => { let op = 1; for (let x = e; x && x !== b.parentElement; x = x.parentElement) op *= +getComputedStyle(x).opacity;
      const fg = rgb(getComputedStyle(e).color), bg = bgOf(e);
      const a = lum(fg.slice(0, 3).map((v, k) => v * op * fg[3] + bg[k] * (1 - op * fg[3]))), c = lum(bg);
      return (Math.max(a, c) + .05) / (Math.min(a, c) + .05); }));
  });
  const cOff = await contrast();
  await page.hover('#listColumnBtn'); await W.paint(page);
  const cOn = await contrast();
  await page.mouse.move(2, 2);
  rec('「表示列」の字は乗せても離しても読める（コントラスト 4.5 以上・前: 乗せて 2.33）',
      cOff >= 4.5 && cOn >= 4.5, `離した ${cOff.toFixed(2)} ／ 乗せた ${cOn.toFixed(2)}`);
  rec('設定（行間・並び・表示件数）は「表の見せ方」の中・表示列は帯に直に（§9.505）',
      await page.evaluate(() => ['listRowGap', 'listSort', 'pageSize']
       .every(id => document.getElementById('listViewPanel').contains(document.getElementById(id)))
       && !document.getElementById('listViewPanel').contains(document.getElementById('listColumnBtn'))
       && !!document.querySelector('#listColumnBtn .fa-table-columns')));
  /* §9.476（利用者の指示「ポップオーバーメニュー内の文字のサイズの統一感…整列した感じや美観…表示列の
     編集はよく使うので、アイコンを設定したりして特にわかりやすく」）。前（実測）: 字の大きさ3種（10/11/12px）・
     表示列の入口はアイコン無しで小さい・並びが2段（49px）。 */
  const look = await page.evaluate(() => {
   const p = document.getElementById('listViewPanel');
   const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
   const rows = [...p.querySelectorAll('.lvp-row')].filter(vis);
   const body = rows.flatMap(r => [...r.querySelectorAll('*')].filter(e => vis(e) && [...e.childNodes].some(n => n.nodeType === 3 && n.nodeValue.trim())));
   const ctl = rows.flatMap(r => [...r.querySelectorAll('button,select,.list-child-chip')].filter(vis));
   return { fs: [...new Set(body.map(e => getComputedStyle(e).fontSize))], h: [...new Set(ctl.map(e => Math.round(e.getBoundingClientRect().height)))],
            sortH: Math.round((document.getElementById('listSort').getBoundingClientRect() || {}).height || 0) };
  });
  rec('「表の見せ方」の中の字は1つの大きさ・欄は1つの高さ（前: 字3種）', look.fs.length === 1 && look.h.length === 1, JSON.stringify(look));
  rec('並びは1行（前: 2段 49px）', look.sortH === 0 || look.sortH <= 36, String(look.sortH));
  await page.keyboard.press('Escape');
  await W.until(page, () => document.getElementById('listViewPanel').hidden, null, { ms: 5000, what: 'Escで「表の見せ方」が閉じる' });
  rec('「表の見せ方」はEscで閉じる', true);
  /* **1回のEscで閉じるのは1枚だけ**（§9.471）。上に浮いた面を閉じた押下で、下の
     条件の窓まで畳まない（畳むと一覧が伸びて、何が起きたか読めない）。 */
  await page.evaluate(() => document.getElementById('filterToggle').click());
  await W.until(page, () => !document.getElementById('filterBody').hidden, null, { ms: 5000, what: '条件の窓が開く' });
  await W.listView(page);
  await page.keyboard.press('Escape');
  await W.until(page, () => document.getElementById('listViewPanel').hidden, null, { ms: 5000, what: 'Escで「表の見せ方」が閉じる（2回目）' });
  rec('1回のEscで閉じるのは上の1枚だけ（下の条件の窓は開いたまま）',
      await page.evaluate(() => !document.getElementById('filterBody').hidden));
  await page.keyboard.press('Escape');
  await W.until(page, () => document.getElementById('filterBody').hidden, null, { ms: 5000, what: 'もう1回のEscで条件の窓が閉じる' });
  rec('もう1回のEscで条件の窓が閉じる', true);

  /* ---------- 4) 帯は「1面1サイズ」（§9.505、利用者の指示） ----------
     「一覧類の上部メニューの文字がサイズ感がバラバラ…メニューの文字のサイズとボタン類のUIのサイズと
      デザインや形状の統一感を」。物差し（評価関数）は3つ——帯の中の**字**の大きさ・**押す物**の
     高さ・角丸の種類。前（1728×1030・単独の仕掛一覧）: 字 4種（10・11・12・14px）・高さ 2種（30／26px）・
     角丸 3種（4・8・10px）。数えないもの: 開く印「▾」（字ではなく記号・1種）、押す物の**内側**の部品
     （検索欄の中の入力・ページめくりの中の ‹ ›——外側の器が高さを持つ）。 */
  await setMode('edit');
  await page.reload({ waitUntil: 'domcontentloaded' }); await W.booted(page);
  await page.click('[data-db-key="SIKALOTNOW"]');
  await W.until(page, () => document.querySelectorAll('#grid tbody tr').length > 0, null, { ms: 30000, what: '単独の仕掛一覧' });
  const uni = await page.evaluate(() => {
   const vis = e => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1 && !e.closest('[hidden],.wl-menu'); };
   const roots = [...document.querySelectorAll('#genericFilterBar .filter-search-row, #listToolbar .lt-state')];
   const all = roots.flatMap(r => [...r.querySelectorAll('*')]).filter(vis);
   const TOP = 'button,label.lt-search,.list-pager,.list-join-chip,.list-tint-chip,.list-load-chip';
   const ctl = all.filter(e => e.matches(TOP) && !e.parentElement.closest(TOP));
   const txt = all.filter(e => !e.matches('.hd-caret') && [...e.childNodes].some(n => n.nodeType === 3 && n.nodeValue.trim()));
   const set = a => [...new Set(a)].sort();
   return { fs: set(txt.map(e => parseFloat(getComputedStyle(e).fontSize))), h: set(ctl.map(e => Math.round(e.getBoundingClientRect().height))),
            r: set(ctl.map(e => getComputedStyle(e).borderTopLeftRadius)), n: ctl.length };
  });
  rec('帯の字は1つの大きさ（前: 4種 10・11・12・14px）', uni.fs.length === 1 && uni.fs[0] >= 11, JSON.stringify(uni));
  rec('帯の押す物は1つの高さ・1つの角丸（前: 高さ2種・角丸3種）', uni.h.length === 1 && uni.r.length === 1 && uni.n >= 6, JSON.stringify(uni));
  /* 一覧から開く面も字1種（§9.505）。「条件」の面（旧⋯の中身もここ）とプリセットの面。 */
  const faceFs = async (btn, sel) => {
   await page.click(btn);
   await W.until(page, s => !!document.querySelector(s), sel, { ms: 5000, what: sel + 'が開く' });
   const fs = await page.evaluate(s => [...new Set([...document.querySelector(s).querySelectorAll('*')]
     .filter(e => e.getBoundingClientRect().height > 0 && [...e.childNodes].some(n => n.nodeType === 3 && n.nodeValue.trim()))
     .map(e => getComputedStyle(e).fontSize))], sel);
   await page.keyboard.press('Escape');
   return fs;
  };
  const condFs = await faceFs('#filterCondBtn', '#filterCondMenu:not([hidden])');
  rec('「条件」の面の字は1つの大きさ（前: ⋯の面 9.5・14px）', condFs.length === 1, condFs.join('/'));
  const presetFs = await faceFs('#filterPresetBtn', '.fb-preset-menu');
  rec('プリセットの面の字は1つの大きさ（前: 9.5・12・13・14px）', presetFs.length === 1, presetFs.join('/'));
 } finally {
  await setMode('edit');
 }
}, { viewport: { width: 1728, height: 1152 } });
