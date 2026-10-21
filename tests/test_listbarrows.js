/* test_listbarrows.js: 作業スケジュールの仕掛一覧の帯は2段まで・機能は1つも減らさない（§9.617・利用者の指示）
   ============================================================
   利用者の言葉「スケジュールモードではボタン類だけで５段にもなり、メインで表示しなければいけない仕掛の一覧の
   表示がかなり圧迫されており見にくいです。ボタン類の機能は２段までの範囲で納めるものとし、階層化表示を上手に
   使ってわかりやすく機能を維持しながらまとめてください」。

   物差し（評価関数）。作業スケジュールに並べた仕掛一覧で、「いつも適用」の条件が2つ効いている（利用者の画像と同じ）とき:
    R1 帯の段数（押す物・札が並ぶ行の数）→ 2 以下
    R2 帯の高さ（帯の上端〜表の上端の px）と、表に見えている行数
    R3 機能の入口が全部ある（検索・フィルタ・条件を足す・スライサー・色付け・表示列・見せ方・同じロットを伏せる・
       条件の札・すべて外す・元データ・結合・ページ）。見えているか、畳んだ入口の面に名前がある
    R4 押す物が帯の外へはみ出さない・重ならない
   撮る大きさは利用者の PC（1728×1152）とフル HD・125%（1536×864）。
   WAVELOG_SHOT=<dir> で帯を撮る。WAVELOG_PROPOSALS=<案の js> で案を当てて撮る（E の手順）。
   ============================================================ */
'use strict';
const H = require('./lib/harness.js');
const W = require('./lib/wait.js');
const path = require('path');
const B = H.B;
const EQ = 'テスト設備A';
const SHOT = process.env.WAVELOG_SHOT || '';

/* 帯の物差し。器は仕掛一覧の枠（#genericFilterBar の親の列）。 */
function measureRows() {
 const bar = document.getElementById('genericFilterBar');
 const grid = document.getElementById('grid');
 if (!bar || !grid) return { error: '帯か表が無い' };
 const top = bar.getBoundingClientRect().top;
 const gridTop = grid.getBoundingClientRect().top;
 const vis = e => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1 && !e.closest('[hidden],.wl-menu') && getComputedStyle(e).visibility !== 'hidden'; };
 const SEL = 'button,label.lt-search,input,.list-pager,.list-join-chip,.list-tint-chip,.list-load-chip,#count,.flt-chip,.lt-n';
 const zone = [...document.querySelectorAll(SEL)].filter(vis).filter(e => {
  const r = e.getBoundingClientRect(); return r.top >= top - 2 && r.bottom <= gridTop + 2 && r.left >= grid.getBoundingClientRect().left - 4 && r.right <= grid.getBoundingClientRect().right + 40;
 }).filter(e => !e.parentElement.closest(SEL));
 /* 行＝縦の中心が 10px 以内のものを同じ段と数える。 */
 const mids = zone.map(e => { const r = e.getBoundingClientRect(); return (r.top + r.bottom) / 2; }).sort((a, b) => a - b);
 const rows = []; mids.forEach(m => { if (!rows.length || m - rows[rows.length - 1] > 10) rows.push(m); });
 /* 重なり・はみ出し */
 const boxes = zone.map(e => ({ e, r: e.getBoundingClientRect() }));
 const over = [];
 for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
  const a = boxes[i].r, b = boxes[j].r;
  if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) over.push((boxes[i].e.id || boxes[i].e.className) + '×' + (boxes[j].e.id || boxes[j].e.className));
 }
 /* はみ出し＝帯の器（仕掛一覧の枠）の右端より外・器に切られて見えない物。 */
 let edge = bar.getBoundingClientRect().right;
 for (let a = bar.parentElement; a && a !== document.body; a = a.parentElement) {
  const ov = getComputedStyle(a).overflowX; if (ov !== 'visible') edge = Math.min(edge, a.getBoundingClientRect().right);
 }
 /* 押す物ごとに、切る器（overflow が見えない祖先）の右端と比べる（行の中で切れた物も数える）。 */
 const clipRight = e => { let r = edge; for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) { if (getComputedStyle(a).overflowX !== 'visible') r = Math.min(r, a.getBoundingClientRect().right); } return r; };
 const cut = zone.filter(e => e.getBoundingClientRect().right > clipRight(e) + 1).map(e => e.id || e.className);
 const body = grid.closest('.table-wrap,.grid-wrap') || grid.parentElement;
 const vb = body.getBoundingClientRect();
 const shown = [...grid.querySelectorAll('tbody tr')].filter(tr => { const r = tr.getBoundingClientRect(); return r.height > 4 && r.top >= vb.top && r.bottom <= Math.min(vb.bottom, window.innerHeight); }).length;
 /* 字で探す範囲＝帯と表の上の器（見えている字＋押す物の title／畳んだ入口の名乗り）。 */
 const host = bar.parentElement;
 const named = [...host.querySelectorAll('[title],[data-fold-items]')].filter(e => vis(e) && e.getBoundingClientRect().bottom <= gridTop + 2)
   .map(e => (e.title || '') + ' ' + (e.dataset.foldItems || '')).join(' ');
 const text = host.innerText.slice(0, 4000) + ' ' + named;
 /* 機能の入口: 見えているか・帯の押す物が名乗っているか（畳んだ入口・件数の札・フィルタ ▾ の title）。 */
 const has = (ids, words) => ids.some(id => { const x = document.getElementById(id); return x && vis(x); }) || words.some(w => named.includes(w));
 const feats = {
  検索: has(['search'], ['検索']), フィルタ: has(['filterSavedBtn', 'filterPresetBtn'], ['フィルタ']), 条件を足す: has(['filterAddCond'], ['条件']),
  スライサー: has(['listSlicerBtn'], ['スライサー']), 色付け: has(['listMarkBtn'], ['色付け']), 表示列: has(['listColumnBtn'], ['表示列']),
  見せ方: has(['listViewBtn', 'listFold-view'], ['見せ方']), 同じロットを伏せる: has(['lotHideChip'], ['伏せる']),
  条件の札: !!document.querySelector('.flt-chip') && (vis(document.querySelector('.flt-chip')) || /条件/.test(text)),
  すべて外す: has(['clearGenericFilters'], ['すべて外す']), 元データ: /元データ|読込/.test(text), 結合: /結合/.test(text), ページ: !!document.querySelector('.list-pager'),
 };
 return { rows: rows.length, barH: Math.round(gridTop - top), shown, n: zone.length, over: over.slice(0, 6), cut: cut.slice(0, 6), feats,
  missing: Object.keys(feats).filter(k => !feats[k]) };
}

async function openScene(page, setMode, vp, listW, noSlow) {
 await page.setViewportSize(vp);
 await setMode('schedule');
 await page.goto(B + '/', { waitUntil: 'domcontentloaded' }); await W.booted(page);
 await W.openSchedule(page, EQ);
 await W.until(page, () => document.querySelectorAll('#grid tbody tr').length > 0, null, { ms: 30000, what: '仕掛一覧' });
 /* 仕掛一覧の器を広げた形（利用者の画像は約740px）。既定は 380px。 */
 if (listW) await page.evaluate(w => { const s = document.querySelector('.sc-split-wrap'); if (s) s.style.setProperty('--sc-list-w', w); }, listW);
 /* 利用者の画像と同じ形: いつも適用の条件が2つ。 */
 await page.evaluate(() => {
  const cols = S.columns || [];
  const a = cols.find(c => /製造材質/.test(c)) || cols[1], b = cols.find(c => /製造調質/.test(c)) || cols[2];
  /* 札の字は利用者の画像と同じくらい長く（「…「(使用設備)(=LS4)」と一致」）。値はどの行にも無い＝一覧は絞られない。 */
  S.genericFilters = [{ column: a, op: 'not_in', values: ['(使用設備)(=LS4)・検証用'], locked: true }, { column: b, op: 'not_in', values: ['(使用設備)(=LS4)の残コース'], locked: true }];
  WL.filters.replace([]);
 });
 await W.until(page, () => document.querySelectorAll('.flt-chip').length >= 2, null, { ms: 10000, what: '条件の札' });
 await page.evaluate(n => { window.__noSlow = !!n; }, noSlow);
 /* 利用者の画像に出ている「元データ 時刻」と読み込みの秒（遅いときだけ出る札）も出した形で測る（検証用のデータでは出ない）。 */
 await page.evaluate(() => {
  /* 字の形は製品と同じ（list-view.js の`updateListFreshness()`・`renderLoadChip()`。日・秒・名前は詰める順で外す単位）。 */
  const f = document.getElementById('listFreshness'); if (f && f.hidden) { f.hidden = false; if (!f.title) f.title = '元データの 10/21 22:45 時点の内容です。押すと再読込'; if (!f.textContent.trim()) f.innerHTML = '<span class="lf-key">元データ</span><b class="lf-val"><span class="lf-day">10/21 </span>22:45</b><span class="lf-act">⟳</span>'; }
  const j = document.getElementById('listJoinChip'); if (j && !j.hidden) j.textContent = '結合 +56列';
  const l = document.getElementById('listLoadChip'); if (l && l.hidden && !window.__noSlow) { l.hidden = false; l.classList.add('is-slow'); if (!l.textContent.trim()) l.innerHTML = '<span class="lc-w">遅い</span><span class="lc-sec">2.6秒</span>'; if (f) f.classList.add('has-slow'); }
 });
 await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}
async function shoot(page, name) {
 if (!SHOT) return;
 const box = await page.evaluate(() => { const b = document.getElementById('genericFilterBar').getBoundingClientRect();
  const g = document.getElementById('grid').getBoundingClientRect(); return { x: b.left, y: b.top, w: Math.max(b.width, g.width), h: g.top - b.top + 140 }; });
 await page.screenshot({ path: path.join(SHOT, name + '.png'), clip: { x: Math.max(0, box.x - 8), y: Math.max(0, box.y - 8), width: box.w + 16, height: box.h + 16 } });
 await page.screenshot({ path: path.join(SHOT, name + '_full.png') });
}

/* 畳んだ入口の面を開き、中に本物の入口があることを見る（機能を削っていない）。開いた面も撮る。 */
async function openPanels(page, rec, key) {
 const PANELS = [
  { name: 'filter', btn: '#filterSavedBtn', menu: '#filterSavedMenu', want: ['#filterSavedMenu .flt-chip', '#filterSavedMenu [data-addcond]', '#filterSavedMenu #clearGenericFilters'] },
  { name: 'state', btn: '#listStateBtn', menu: '#listStateMenu', want: ['#listStateMenu #lotHideChip', '#listStateMenu #listJoinChip'] },
  { name: 'tools', btn: '#listFold-all', menu: '#listFoldMenu', want: ['#listFoldMenu [data-fold-to="listSlicerBtn"]', '#listFoldMenu [data-fold-to="listMarkBtn"]', '#listFoldMenu [data-fold-to="listColumnBtn"]', '#listFoldMenu [data-fold-to="listViewBtn"]'] },
 ];
 for (const p of PANELS) {
  await page.click(p.btn);
  await W.until(page, sel => { const m = document.querySelector(sel); return m && !m.hidden && m.getClientRects().length; }, p.menu, { ms: 5000, what: p.name + ' の面' });
  const got = await page.evaluate(ws => ws.filter(w => { const e = document.querySelector(w); return e && e.getClientRects().length; }), p.want);
  rec(`R7 ${p.name} の面に本物の入口がある（${key}）`, got.length === p.want.length, `ある ${got.length}/${p.want.length}: ${got.join(' ')}`);
  if (process.env.WAVELOG_SHOT) { const b = await page.evaluate(sel => { const x = document.getElementById('genericFilterBar').getBoundingClientRect(), m = document.querySelector(sel).getBoundingClientRect();
    return { x: Math.min(x.left, m.left), y: x.top, w: Math.max(x.right, m.right) - Math.min(x.left, m.left), h: Math.max(m.bottom, x.bottom) - x.top }; }, p.menu);
   await page.screenshot({ path: path.join(SHOT, `now_${key}_${p.name}.png`), clip: { x: Math.max(0, b.x - 8), y: Math.max(0, b.y - 8), width: b.w + 16, height: b.h + 16 } }); }
  await page.keyboard.press('Escape');
  await W.until(page, sel => { const m = document.querySelector(sel); return !m || m.hidden || !m.getClientRects().length; }, p.menu, { ms: 5000, what: p.name + ' の面が閉じる' });
 }
 /* 閉じたら貸した札は元の席（件数の隣）へ戻る。 */
 const back = await page.evaluate(() => ({ chips: !!document.querySelector('#listToolbar .lt-state>#filterChips'), sums: !!document.querySelector('#listToolbar .lt-state>#listToolSums') }));
 rec(`R8 面を閉じたら貸した札は帯の席へ戻る（${key}）`, back.chips && back.sums, JSON.stringify(back));
}
H.run('test_listbarrows: スケジュールの仕掛一覧の帯は2段まで（§9.617）', async ({ page, rec, setMode }) => {
 const row1 = {};
 const VPS = [{ key: '1728', vp: { width: 1728, height: 1152 } }, { key: '1728wide', vp: { width: 1728, height: 1152 }, listW: '740px' },
              { key: '1536', vp: { width: 1536, height: 864 } }, { key: '1728fast', vp: { width: 1728, height: 1152 }, noSlow: true }];
 for (const v of VPS) {
  await openScene(page, setMode, v.vp, v.listW, v.noSlow);
  const m = await page.evaluate(measureRows);
  console.log('MEASURE ' + v.key + ' ' + JSON.stringify(m));
  /* 1段目の押す物の位置（遅いかどうかで動かない・§9.397）と、件数の札の伏せ（最後の手まで使わずに入るか）。 */
  const r1 = await page.evaluate(() => [...document.querySelectorAll('#genericFilterBar .filter-search-row>*')].filter(e => e.getClientRects().length)
   .map(e => { const b = e.getBoundingClientRect(); return `${e.id || e.className.split(' ')[0]}:${Math.round(b.left)}-${Math.round(b.right)}`; }).join(' '));
  row1[v.key] = r1;
  const hide = await page.evaluate(() => { const h = document.querySelector('#listStateBtn .lt-cnt-hide'); return h ? { shown: !!h.getClientRects().length, text: h.textContent } : null; });
  rec(`R5 伏せの数は件数の札の中に出ている（${v.key}）`, hide && hide.shown, JSON.stringify(hide));
  rec(`R1 帯は2段まで（${v.key}）`, m.rows <= 2, `${m.rows}段・帯 ${m.barH}px・表に見える行 ${m.shown}`);
  rec(`R3 機能の入口が全部ある（${v.key}）`, !m.missing.length, '無い: ' + JSON.stringify(m.missing));
  rec(`R4 押す物が重ならない・はみ出さない（${v.key}）`, !m.over.length && !m.cut.length, JSON.stringify({ 重なり: m.over, はみ出し: m.cut }));
  await shoot(page, 'now_' + v.key);
  if (v.key === '1728' || v.key === '1728wide') await openPanels(page, rec, v.key);
 }
 rec('R6 1段目の押す物の位置は遅いかどうかで変わらない（1728 と 1728fast）', row1['1728'] === row1['1728fast'], `${row1['1728']} ／ ${row1['1728fast']}`);
 if (process.env.WAVELOG_PROPOSALS && SHOT) {
  for (const p of require(process.env.WAVELOG_PROPOSALS)) {
   for (const v of VPS) {
    await openScene(page, setMode, v.vp, v.listW, v.noSlow);
    await page.evaluate(({ css, apply }) => { const st = document.createElement('style'); st.textContent = css || ''; document.head.appendChild(st);
     if (apply) (0, eval)('(' + apply + ')')(); }, { css: p.css, apply: typeof p.apply === 'function' ? p.apply.toString() : p.apply });
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    console.log(`PROP ${p.key} ${v.key} ${JSON.stringify(await page.evaluate(measureRows))}`);
    const probe = await page.evaluate(() => window.__probe || '');
    if (probe) console.log('PROBE ' + probe);
    await shoot(page, `${p.key}_${v.key}`);
    /* 案が名乗る面（▾ を押すと開く小窓）を1つずつ開いて撮る。 */
    for (const pn of (v.key === '1728' || v.key === '1728wide' || v.key === '1728fast') ? (p.panels || []) : []) {
     await page.evaluate(src => { document.querySelectorAll('.px-panel').forEach(e => e.remove()); (0, eval)('(' + src + ')')(); }, typeof pn.open === 'function' ? pn.open.toString() : pn.open);
     await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
     if (SHOT) { const b = await page.evaluate(() => { const x = document.getElementById('genericFilterBar').getBoundingClientRect(); return { x: x.left, y: x.top, w: x.width }; });
      await page.screenshot({ path: path.join(SHOT, `${p.key}_${v.key}_${pn.name}.png`), clip: { x: Math.max(0, b.x - 8), y: Math.max(0, b.y - 8), width: Math.max(b.w, 460) + 16, height: 430 } }); }
    }
   }
  }
 }
 await setMode('edit');
}, { mode: 'edit', viewport: { width: 1728, height: 1152 } });
