/* test_oprange.js: 操業データ項目の入力範囲——試しに打つ（F-2）と盤の食い違いの札（F-5）（§9.541）
   ============================================================
   利用者の選択「F-2とF-5の組み合わせでお願いします。」

   ここで固定すること:
    ① 打った値を整える`WL.opData.settleValue()`が、測定画面の順（マイナス→刻みで丸め→小数桁→上下限）の正解と一致する
       （正解はこの網で独立に計算する）。小数桁が空なら1桁（`ruleText()`と同じ）
    ② 数の決まりの食い違い`WL.opData.ruleIssues()`が、正解の種類と一致する
       （最小>最大／正の型で最小<0／刻みを小数桁で表せない／上下限が刻みの段に無い／初期値が直される）
    ③ 盤のタイル: 食い違いがあれば「⚠ 食い違い N」（件数は正解どおり）、範囲を決めた項目は範囲の1行
    ④ 設定窓: 「試しに打つ」に打つと記録される値を字で言い、数直線に矢印が出る。
       欄に入ると図の同じ所が光り、食い違いの札を押すと直す欄へ移る。初期値の食い違いは初期値の欄の横の1か所だけ
   後片付けは finally（作った見本の項目を消す）。
   ============================================================ */
'use strict';
const { run } = require('./lib/harness.js');
const B = 'http://127.0.0.1:5029';
const TAG = 'rng-' + Date.now().toString(36);
const post = (p, x) => fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(x) }).then(r => r.json());
const get = p => fetch(B + p).then(r => r.json());

const ITEMS = [
 { name: TAG + '_正常', type: '正の数', decimals: 2, min: 0, max: 0.5, step: 0.05, roundMode: '切り上げ', initial: '0.05' },
 { name: TAG + '_初期値', type: '正の数', decimals: 1, min: 1, max: 9, initial: '12' },
 { name: TAG + '_最小最大', type: '整数', decimals: 0, min: 5, max: 3 },
 { name: TAG + '_刻み桁', type: '正の数', decimals: 1, min: 0, max: 50, step: 0.05, roundMode: '四捨五入' },
 { name: TAG + '_符号', type: '正の数', decimals: 2, min: -0.1, max: 1 },
 { name: TAG + '_段', type: '正の数', decimals: 2, min: 0, max: 0.52, step: 0.05, roundMode: '切り捨て' }];
const pos = t => ['正の整数', '正の数'].includes(t), int = t => ['整数', '正の整数'].includes(t);
const decOf = d => (int(d.type) ? 0 : (d.decimals == null ? 1 : d.decimals));
/* 正解（測定画面の順）。網の中で独立に計算する。 */
function truthSettle(raw, d) {
 let n = Number(raw);
 if (pos(d.type) && n < 0) n = -n;
 if (d.step > 0 && d.roundMode) {
  const q = n / d.step, k = d.roundMode === '切り上げ' ? Math.ceil(q - 1e-9) : d.roundMode === '切り捨て' ? Math.floor(q + 1e-9) : Math.round(q);
  n = k * d.step;
 }
 const dec = decOf(d);
 n = Number(n.toFixed(dec));
 if (d.min != null && n < d.min) n = d.min; else if (d.max != null && n > d.max) n = d.max;
 return n.toFixed(dec);
}
function truthIssues(d) {
 const k = [], dec = decOf(d), st = d.step > 0 ? d.step : null;
 const off = v => v != null && st && d.roundMode && Math.abs(v / st - Math.round(v / st)) > 1e-9;
 if (d.min != null && d.max != null && d.min > d.max) k.push('minmax');
 if (pos(d.type) && d.min != null && d.min < 0) k.push('sign');
 if (st && d.roundMode && Math.abs(st * 10 ** dec - Math.round(st * 10 ** dec)) > 1e-9) k.push('stepdec');
 if (off(d.min)) k.push('grid');
 if (off(d.max)) k.push('grid');
 if (d.initial != null && d.initial !== '' && Number(truthSettle(d.initial, d)) !== Number(d.initial)) k.push('initial');
 return k;
}

run('test_oprange: 操業データ項目の入力範囲——試しに打つ・盤の食い違いの札（§9.541）', async ({ page, rec, W, errs }) => {
 const ids = [];
 try {
  await post('/api/access-mode', { mode: 'edit' });
  for (const it of ITEMS) {
   const r = await post('/api/operation-item-master', Object.assign({ equipment: '*', group: TAG, place: '準備', user_id: 'test' }, it));
   if (r && r.id) ids.push(r.id);
  }
  rec('前提: 見本の項目を6件作れる', ids.length === ITEMS.length, ids.join(','));
  await page.goto(B + '/', { waitUntil: 'domcontentloaded' });
  await W.booted(page);
  await W.until(page, () => !!(window.currentUserId && currentUserId() && WL.opData && WL.opData.settleValue), null, { ms: 15000, what: '画面の準備' });

  /* ① ② 計算（測定画面と設定窓が読む1本） */
  const VALS = ['-0.1', '0', '0.051', '0.123', '0.3', '0.62', '12', '4', '-3', '0.05'];
  const got = await page.evaluate(([items, vals]) => items.map(d => ({ s: vals.map(v => WL.opData.settleValue(v, d).out), i: WL.opData.ruleIssues(d).map(x => x.key) })), [ITEMS, VALS]);
  let okS = 0, nS = 0, okI = 0;
  ITEMS.forEach((d, j) => { VALS.forEach((v, k) => { nS++; if (got[j].s[k] === truthSettle(v, d)) okS++; });
   if (JSON.stringify(got[j].i) === JSON.stringify(truthIssues(d))) okI++; });
  rec('① 打った値の整え方が測定画面の順の正解と一致する', okS === nS, `${okS}/${nS}`);
  rec('① 小数桁が空なら1桁（案内の字と同じ）', await page.evaluate(() => WL.opData.settleValue('1.26', { type: '数値', decimals: null }).out === '1.3'));
  rec('② 食い違いの種類が正解と一致する（6件・食い違い5件）', okI === ITEMS.length, `${okI}/${ITEMS.length}`);

  /* ③ 盤のタイル */
  await page.evaluate(() => WL.mm.openMasterMaint());
  await W.until(page, () => !!document.querySelector('[data-master="opItem"]'), null, { ms: 15000, what: '操業データ項目のタブ' });
  await page.evaluate(() => document.querySelector('[data-master="opItem"]').click());
  await W.until(page, t => [...document.querySelectorAll('#masterMaintList .op-tile-name')].filter(e => e.textContent.startsWith(t)).length >= 6, TAG, { ms: 15000, what: '見本のタイル' });
  const tiles = await page.evaluate(t => [...document.querySelectorAll('#masterMaintList .op-tile')].filter(e => (e.querySelector('.op-tile-name') || {}).textContent?.startsWith(t))
   .map(e => ({ name: e.querySelector('.op-tile-name').textContent, n: +(((e.querySelector('.op-chip-issue') || {}).textContent || '').match(/\d+/) || [0])[0],
    range: (e.querySelector('.op-tile-range') || {}).textContent || '' })), TAG);
  const bad = ITEMS.filter(d => { const t = tiles.find(x => x.name === d.name); return !t || t.n !== truthIssues(d).length; });
  rec('③ タイルの「⚠ 食い違い N」が正解の件数（無ければ札なし）', !bad.length, bad.map(d => d.name).join(','));
  const t0 = tiles.find(x => x.name === ITEMS[0].name) || {};
  rec('③ 範囲の1行が範囲と刻みを言う（0〜0.5・0.05刻みで切り上げ）', /0〜0\.5/.test(t0.range) && /0\.05刻みで切り上げ/.test(t0.range), t0.range);

  /* ④ 設定窓の試しに打つ */
  const open = async name => {
   await page.evaluate(n => { [...document.querySelectorAll('#masterMaintList .op-tile')].find(e => (e.querySelector('.op-tile-name') || {}).textContent === n).click(); }, name);
   await W.until(page, n => { const m = document.getElementById('opItemModal'); return !!m && !m.hidden && (document.getElementById('opModalTitle') || {}).textContent === n && !!document.getElementById('opdTryIn'); }, name, { ms: 8000, what: '設定窓 ' + name });
  };
  await open(ITEMS[0].name);
  await page.fill('#opdTryIn', '0.123');
  await W.until(page, () => /0\.15/.test((document.querySelector('#opdTryOut .op-try-say b') || {}).textContent || ''), null, { ms: 5000, what: '試し打ちの答え' });
  const t1 = await page.evaluate(() => ({ say: document.querySelector('#opdTryOut .op-try-say').textContent, arrows: document.querySelectorAll('#opdTryOut .op-try-arr').length,
   typed: !!document.querySelector('#opdTryOut .op-try-mk.is-typed') }));
  rec('④ 試しに打つと、記録される値と直し方を字で言う（0.123 → 0.15・0.05 刻みで切り上げ）', /0\.15/.test(t1.say) && /切り上げ/.test(t1.say), t1.say);
  rec('④ 数直線に打った値の矢印と見本の矢印が出る', t1.typed && t1.arrows >= 3, JSON.stringify(t1));
  await page.focus('#opdMax');
  rec('④ 最大の欄に入ると、図の最大の端が光る', await page.evaluate(() => [...document.querySelectorAll('#opdTryOut .is-hot')].every(e => e.dataset.k === 'max') && !!document.querySelector('#opdTryOut .is-hot[data-k="max"]')));
  await page.fill('#opdMax', '0.52');
  await W.until(page, () => /刻みの段に無い/.test((document.querySelector('#opdTryOut .op-try-issues') || {}).textContent || ''), null, { ms: 5000, what: '打った最大で食い違いが出る' });
  rec('④ 最大を 0.52 にすると、その場で「刻みの段に無い」と言う（保存前）', true);
  await page.click('#opdTryOut .op-try-issue');
  rec('④ 食い違いの札を押すと、直す欄（最大）へ移る', await page.evaluate(() => document.activeElement && document.activeElement.id === 'opdMax'));
  await page.click('#opModalClose');
  await open(ITEMS[1].name);
  const t2 = await page.evaluate(() => ({ chip: document.querySelectorAll('#opItemModal .op-warn-chip').length, issue: document.querySelectorAll('#opdTryOut .op-try-issue').length,
   text: (document.querySelector('#opItemModal .op-warn-chip') || {}).textContent || '' }));
  rec('④ 初期値の食い違いは初期値の欄の横の1か所だけ（試し打ちの下に重ねない）', t2.chip === 1 && t2.issue === 0 && /初期値 12/.test(t2.text), JSON.stringify(t2));
  await page.click('#opModalClose');
  rec('コンソールに例外が出ない', errs.length === 0, errs.slice(0, 3).join(' / '));
 } finally {
  for (const id of ids) { const r = await post('/api/operation-item-master/delete', { id, user_id: 'test' }); if (!r || !r.ok) console.log('  [cleanup] 見本の項目を消せない', id); }
  const left = ((await get('/api/operation-item-master')).items || []).filter(x => String(x.name).startsWith(TAG)).length;
  rec('後片付け: 見本の項目が残らない', left === 0, String(left));
 }
});
