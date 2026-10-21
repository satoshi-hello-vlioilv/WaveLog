/* test_filter.js: 絞り込みの面と窓のふるまい（§9.80・§9.345・§9.453・§9.468・§9.614）
   ------------------------------------------------------------
   §9.614 でフィルタをゼロから作り直した（帯は「フィルタ ▾」と条件の札・作る入口は列の値の一覧）。
   前の作りから引き継いで固定すること:
    1. 検索欄の顔をした器は帯に1つだけ（「一覧を検索」。条件を足す入口はボタン・§9.345）
    2. 浮く面は同時に1つ・Esc で閉じる・開いたら押せる最初の欄へ焦点（§9.468）
    3. 保存したフィルタを直す窓の上に出す値の一覧は窓より手前で、実際に押せる（§9.80 ①の下敷きの再発防止）。
       窓の中の削除は2手でマスタから消える
    4. スケジュールモードでも保存でき（以前は403）、変数入りの条件も保存でき、置き場は共通と混ざらない（§9.80 ③④）
    5. 絞って0件なら、効いている条件を出どころつきで言い、案内の中のボタン1つで外れて行が戻る（§9.453）
   ------------------------------------------------------------ */
'use strict';
const H = require('./lib/harness.js');
const API = H.B;
const TAG = 'T' + Date.now().toString().slice(-6);
/* 製品の「削除」は論理削除（`有効=0`）なので、この実行で増えた行だけを素の表から片付ける（§9.362 ⑤）。 */
const SNAP_TABLES = ['フィルタプリセットマスタ'];
let snapM = null;

H.run('test_filter: 絞り込みの面と窓のふるまい（§9.614）', async ({ page, rec, W, idle, setMode }) => {
 snapM = await H.masterSnapshot(SNAP_TABLES);
 const openList = async () => {
  await page.goto(API + '/', { waitUntil: 'domcontentloaded' }); await W.booted(page);
  await page.click('aside [data-db-key="SIKALOTNOW"]', { timeout: 15000 });
  await W.until(page, () => document.querySelectorAll('#grid tbody tr').length > 0, null, { ms: 20000, what: '仕掛一覧' });
  await idle();
 };
 const presets = mode => page.evaluate(async m => {
  const q = new URLSearchParams({ db: 'SIKALOTNOW', table: '仕掛', mode: m, user: localStorage.getItem('AccessMeasurementUserId') || '' });
  return ((await (await fetch('/api/filter-presets?' + q)).json()).items || []);
 }, mode);
 try {
  await setMode('edit');
  await page.goto(API + '/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { localStorage.setItem('AccessMeasurementConfiguredEquipment', 'テスト設備A'); localStorage.setItem('AccessMeasurementUserId', 'tester'); });
  await openList();

  /* ---- 1) 検索欄の顔は1つ ---- */
  const looks = await page.evaluate(() => [...document.querySelectorAll('#genericFilterBar input,#listToolbar input')]
   .filter(e => e.getClientRects().length && /search|text/.test(e.type)).map(e => e.id || e.className));
  rec('帯の検索欄の顔をした器は「一覧を検索」の1つだけ', looks.length === 1 && looks[0] === 'search', looks.join(','));
  const add = await page.evaluate(() => { const b = document.getElementById('filterAddCond'); return !!b && b.tagName === 'BUTTON'; });
  rec('条件を足す入口はボタン（＋ 条件）', add);

  /* ---- 2) 浮く面は同時に1つ・Esc・焦点 ---- */
  await page.click('#filterAddCond');
  await W.until(page, () => !!document.querySelector('.flt-col-pick'), null, { ms: 5000, what: '列を選ぶ面' });
  const f1 = await page.evaluate(() => document.activeElement && document.activeElement.closest('.flt-col-pick') ? document.activeElement.getAttribute('aria-label') : '');
  rec('開いたら押せる最初の欄（列名を探す）へ焦点が乗る', f1 === '列名を探す', f1);
  await page.click('#filterSavedBtn');
  await W.until(page, () => !!document.getElementById('filterSavedMenu'), null, { ms: 5000, what: '保存したフィルタの面' });
  const one = await page.evaluate(() => ({ pick: !!document.querySelector('.flt-col-pick'), saved: !!document.getElementById('filterSavedMenu') }));
  rec('浮く面は同時に1つ（保存したフィルタを開くと列を選ぶ面は閉じる）', one.saved && !one.pick, JSON.stringify(one));
  await page.keyboard.press('Escape');
  const closed = await W.until(page, () => !document.getElementById('filterSavedMenu'), null, { ms: 5000, what: 'Esc で閉じる' }).then(() => true, () => false);
  rec('Esc で閉じる', closed);

  /* ---- 3) 直す窓の上の値の一覧・窓の中の削除 ---- */
  const col = await page.evaluate(() => S.columns.find(c => /ロット番号/.test(c)) || S.columns[1]);
  const made = await page.evaluate(async ([t, c]) => {
   const r = await fetch('/api/filter-presets', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '削除用_' + t, db: S.db, table: S.table, mode: '', user: 'tester', user_id: 'tester', filters: [{ column: c, op: 'in', value: ['L0001'] }] }) });
   return (await r.json()).id;
  }, [TAG, col]);
  await page.evaluate(() => WL.filters.reload());
  await page.click('#filterSavedBtn');
  await W.until(page, id => !!document.querySelector(`#filterSavedMenu [data-edit="${id}"]`), made, { ms: 10000, what: '自分の行' });
  await page.click(`#filterSavedMenu [data-edit="${made}"]`);
  await W.until(page, () => !!document.querySelector('#appConfirmBody .flt-ed'), null, { ms: 8000, what: '直す窓' });
  await page.click('#appConfirmBody [data-pickv]');
  await W.until(page, () => document.querySelectorAll('#filterColPop [data-v]').length > 0, null, { ms: 10000, what: '窓の上の値の一覧' });
  const stack = await page.evaluate(() => {
   const pop = document.getElementById('filterColPop'), dlg = document.getElementById('appConfirmModal');
   const b = pop.querySelector('[data-act="ok"]').getBoundingClientRect();
   const top = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
   return { pz: +getComputedStyle(pop).zIndex, dz: +getComputedStyle(dlg).zIndex, hit: !!top && pop.contains(top), top: top ? (top.id || top.className) : 'なし' };
  });
  rec('直す窓の上の値の一覧は窓より手前で、押せる（下敷きにならない）', stack.pz > stack.dz && stack.hit, JSON.stringify(stack));
  await page.click('#filterColPop [data-act="cancel"]');
  await page.click('#appConfirmBody [data-del="1"]');
  const ask = await page.evaluate(() => (document.querySelector('#appConfirmBody .flt-ed-danger') || {}).textContent || '');
  rec('削除は窓の中で2手（1手目で「本当に削除しますか」）', /本当に削除しますか/.test(ask), ask.trim());
  await page.click('#appConfirmBody [data-del="2"]');
  await W.until(page, () => document.getElementById('appConfirmModal').hidden, null, { ms: 8000, what: '窓が閉じる' });
  const after = await W.poll(() => presets(''), list => !list.some(x => x.id === made), 8000);
  rec('削除が実行される', !after.some(x => x.id === made));

  /* ---- 4) スケジュールモードでも保存でき、置き場が分かれる ---- */
  await setMode('schedule');
  await openList();
  const sc = await page.evaluate(async t => {
   const r = await fetch('/api/filter-presets', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'SC_' + t, db: 'SIKALOTNOW', table: '仕掛', mode: 'schedule', user: 'tester', user_id: 'tester',
     filters: [{ column: 'BOX設計_設備名', op: 'eq', value: '{使用設備}' }] }) });
   return r.status;
  }, TAG);
  rec('スケジュールモードでも保存できる（以前は403）', sc === 200, `HTTP ${sc}`);
  const scList = (await presets('schedule')).map(x => x.name), common = (await presets('')).map(x => x.name);
  rec('変数を含む条件も保存できる', scList.some(n => n.includes(TAG)), scList.join(' / ') || 'なし');
  rec('スケジュールモードの条件は共通側へ混ざらない', !common.some(n => n.startsWith('SC_')), `共通=${common.length}件`);

  /* ---- 5) 0件の案内（§9.453）。物差し: ①効いている条件の字 ②出どころ ③いつも適用の断り ④案内の中のボタン1つで戻る ---- */
  await setMode('edit');
  await openList();
  const rowsBack = what => W.until(page, () => document.querySelectorAll('#grid tbody tr').length > 0, null, { ms: 15000, what });
  const NONE = 'QJ無いロット';
  const emptyNote = () => page.evaluate(() => {
   const g = document.getElementById('grid'); const e = g && [...g.children].find(c => c.tagName !== 'TABLE');
   return e ? { text: e.innerText.replace(/\s+/g, ' '), btn: !!e.querySelector('button') } : { text: '', btn: false };
  });
  const waitEmpty = what => W.until(page, () => { const g = document.getElementById('grid');
   return !!g && !g.querySelector('tbody tr') && [...g.children].some(c => c.tagName !== 'TABLE'); }, null, { ms: 15000, what });
  const pressClear = () => page.evaluate(() => { const g = document.getElementById('grid');
   const e = [...g.children].find(c => c.tagName !== 'TABLE'); const b = e && e.querySelector('button'); if (b) b.click(); return !!b; });
  const setFilters = list => page.evaluate(l => { S.genericFilters = l; S.page = 1; WL.list.load(true); }, list);
  await setFilters([]); await rowsBack('仕掛一覧が出る'); await idle();
  const scene = async (label, setup, expect, { confirm = false } = {}) => {
   await setup(); await waitEmpty(label + 'で0件になる');
   const n = await emptyNote();
   rec(`0件の案内（${label}）: 効いている条件と出どころを字で言う`, expect.every(x => n.text.includes(x)), n.text.slice(0, 140));
   const pressed = await pressClear();
   if (pressed && confirm) await W.answerConfirm(page, true);
   const back = pressed && await rowsBack(label + 'を外して行が戻る');
   rec(`0件の案内（${label}）: 案内の中のボタン1つで外れて行が戻る`, !!back, pressed ? '' : 'ボタンが無い');
   await idle();
  };
  await scene('検索欄', async () => { await page.fill('#search', NONE); }, ['一覧を検索', NONE]);
  rec('0件の案内（検索欄）: 外すと検索欄も空になる', (await page.inputValue('#search')) === '', await page.inputValue('#search'));
  await scene('フィルタ', () => setFilters([{ column: 'ロット番号', op: 'eq', value: NONE }]), ['条件', 'ロット番号', NONE]);
  await scene('いつも適用', () => setFilters([{ column: 'ロット番号', op: 'eq', value: NONE, locked: true }]),
   ['いつも適用', 'ロット番号', NONE, '開くたび'], { confirm: true });
  await scene('値の一覧', async () => {
   /* 列の値の一覧で選んだ値は「値を選ぶ（in）」の条件。無い値は一覧に出ないので、選んだ値の条件を直に入れて同じ道を通す。 */
   await setFilters([{ column: 'ロット番号', op: 'in', value: [NONE] }]);
  }, ['条件', 'ロット番号', NONE]);
  await scene('検索欄＋フィルタ', async () => { await page.fill('#search', NONE); await setFilters([{ column: 'ロット番号', op: 'eq', value: NONE }]); },
   ['一覧を検索', '条件', 'ロット番号']);
  const left = await page.evaluate(() => ({ search: document.getElementById('search').value, filters: S.genericFilters.length }));
  rec('0件の案内: 1回押すと検索欄とフィルタの両方が外れる', left.search === '' && left.filters === 0, JSON.stringify(left));
 } finally {
  await page.evaluate(async t => {
   for (const m of ['', 'schedule']) {
    const q = new URLSearchParams({ db: 'SIKALOTNOW', table: '仕掛', mode: m, user: 'tester' });
    const items = ((await (await fetch('/api/filter-presets?' + q)).json()).items || []);
    for (const it of items) if (it.name.includes(t))
     await fetch('/api/filter-presets/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: it.id, user: 'tester', user_id: 'tester' }) });
   }
  }, TAG).catch(e => console.log('!! 片付けの削除に失敗: ' + (e && e.message || e)));
  await setMode('edit');
  try { if (snapM) await H.dropNewMasterRows(snapM); }
  catch (e) { console.log('!! 増えた行を消せませんでした: ' + (e && e.message || e)); }
 }
}, { viewport: { width: 1600, height: 1000 } });
