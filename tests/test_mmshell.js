/* ============================================================
   test_mmshell.js: マスタ管理を全幅の画面にする（§9.593）——戻る・伏せる物・マスタを探す

   利用者の指示（2026-10-12）:
    「マスタボタンを押したら、『戻る』ことができるボタンをメニューにつけてマスタリストもわかりやすく再構成して表示し、
     測定メイン画面が出るときのようにマスタ編集中に不要なメニューは出ないような工夫を入れてエリア全体を活かせるように」

   固定すること:
    1. 仕掛の一覧から開くと、左のメニュー・使用設備の案内・現場段取り／使用設備の札が出ない（前: 全部出ていた）。
       作業の面は窓の8割以上（前: 62%・1728×1152）
    2. ヘッダーの左端に「仕掛（現在）へ戻る」——字は入る直前に選んでいた行き先の名前
    3. マスタを探す: 名前の一部で畳んだ群（内部データ）の中まで当たる・当たらなければ字で言う・Esc で字だけ消える・
       Enter で1つ目を開く
    4. 戻るを押すと元の一覧へ戻り、左のメニューが出て、行き先が選ばれている・戻るは消える
   ============================================================ */
'use strict';
const H = require('./lib/harness.js');
const W = require('./lib/wait.js');
const B = H.B;

H.run('test_mmshell: マスタ管理の全幅・戻る・探す（§9.593）', async ({ page, rec, setMode, idle }) => {
 await page.goto(B + '/', { waitUntil: 'domcontentloaded' }); await W.booted(page);
 await setMode('edit');
 await page.reload({ waitUntil: 'domcontentloaded' }); await W.booted(page);
 await page.click('[data-db-key="SIKALOTNOW"]');
 await W.until(page, () => document.querySelectorAll('#grid tbody tr').length > 0, null, { ms: 30000, what: '仕掛一覧' });
 const from = await page.evaluate(() => (document.querySelector('[data-db-key="SIKALOTNOW"] span') || {}).textContent.trim());
 await page.click('#openMasterMaint');
 await W.until(page, () => document.body.classList.contains('mm-mode') && !!document.querySelector('#masterMaintNav [data-master].active'), null, { ms: 20000, what: 'マスタ管理' });
 await idle();

 /* ---------- 1) 伏せる物と作業の面 ---------- */
 const m = await page.evaluate(() => {
  const vis = q => { const e = document.querySelector(q); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const w = document.querySelector('.mm-main').getBoundingClientRect();
  return { shown: ['.layout>aside', '#equipmentSetupBanner', '#fieldReorderBadge', '.hd-chip-equip'].filter(vis),
   mode: vis('#accessModeBadge'), share: +(w.width * Math.min(w.height, innerHeight - w.top) / (innerWidth * innerHeight)).toFixed(3) };
 });
 rec('1) 左のメニュー・使用設備の案内・現場段取り／使用設備の札は出ない（モードの札は残す）', m.shown.length === 0 && m.mode, JSON.stringify(m));
 rec('1) 作業の面は窓の8割以上（前: 62%）', m.share >= 0.8, JSON.stringify(m));

 /* ---------- 2) 戻るの字 ---------- */
 const back = await page.evaluate(() => { const b = document.getElementById('viewBack'); const r = b.getBoundingClientRect(), t = document.getElementById('fileName').getBoundingClientRect();
  return { hidden: b.hidden, text: b.textContent.trim(), left: r.right <= t.left }; });
 rec('2) ヘッダーの左端に「（入る前の行き先）へ戻る」', !back.hidden && back.text === `${from}へ戻る` && back.left, JSON.stringify({ back, from }));

 /* ---------- 3) マスタを探す ---------- */
 const internal = await page.evaluate(() => { const g = document.querySelector('.mm-nav-group[data-nav-group="internal"]'); return g ? g.classList.contains('is-folded') : null; });
 /* 畳んだ群（内部データ）の中の名前を1つ選ぶ（畳んだ群の行は描いていないので、画面と同じ口から引く）。 */
 const word = await page.evaluate(async () => {
  const r = await api('/api/master-table/catalog');
  const x = ((r && r.tables) || []).find(v => v.kind !== 'retired' && v.kind !== 'covered' && (v.label || v.table));
  return x ? (x.label || x.table) : '';
 });
 await page.fill('#masterMaintFind', '停止');
 await W.until(page, () => [...document.querySelectorAll('#masterMaintNav [data-master]')].every(b => b.textContent.includes('停止')), null, { ms: 5000, what: '「停止」で絞れる' });
 const hit = await page.evaluate(() => [...document.querySelectorAll('#masterMaintNav [data-master]')].map(b => b.textContent.trim()));
 rec('3) 名前の一部で絞れる（「停止」→設備停止・設備停止の時間）', hit.includes('設備停止') && hit.includes('設備停止の時間') && hit.length >= 2, JSON.stringify(hit));
 if (internal && word) {
  await page.fill('#masterMaintFind', word);
  await W.until(page, w => [...document.querySelectorAll('#masterMaintNav [data-master]')].some(b => b.textContent.trim() === w), word, { ms: 5000, what: '畳んだ群の中まで当たる' });
  rec('3) 畳んだ群（内部データ）の中まで当たる', true, word);
 } else rec('3) 前提: 内部データの群が畳まれていて名前が引ける', false, JSON.stringify({ internal, word }));
 await page.fill('#masterMaintFind', 'ありえない名前zz');
 await W.until(page, () => !!document.querySelector('#masterMaintNav .mm-nav-empty'), null, { ms: 5000, what: '当たらないと字で言う' });
 rec('3) 当たらなければ字で言う', /当たるマスタはありません/.test(await page.textContent('#masterMaintNav .mm-nav-empty')));
 await page.focus('#masterMaintFind');
 await page.keyboard.press('Escape');
 const afterEsc = await page.evaluate(() => ({ v: document.getElementById('masterMaintFind').value, mm: document.body.classList.contains('mm-mode'), n: document.querySelectorAll('#masterMaintNav [data-master]').length }));
 rec('3) Esc で探す字だけ消える（画面は閉じない）', afterEsc.v === '' && afterEsc.mm && afterEsc.n > 10, JSON.stringify(afterEsc));
 await page.fill('#masterMaintFind', 'ロール');
 await W.until(page, () => document.querySelectorAll('#masterMaintNav [data-master]').length === 1, null, { ms: 5000, what: '「ロール」で1つ' });
 await page.keyboard.press('Enter');
 await W.until(page, () => (document.querySelector('#masterMaintNav [data-master].active') || {}).dataset?.master === 'roll', null, { ms: 10000, what: 'Enter で1つ目を開く' });
 rec('3) Enter で1つ目を開く', true);
 await page.fill('#masterMaintFind', '');

 /* ---------- 4) 戻る ---------- */
 await page.click('#viewBack');
 await W.until(page, () => !document.body.classList.contains('mm-mode') && document.querySelectorAll('#grid tbody tr').length > 0, null, { ms: 30000, what: '一覧へ戻る' });
 const r = await page.evaluate(() => { const a = document.querySelector('.layout>aside').getBoundingClientRect();
  return { aside: a.width > 0, active: !!document.querySelector('[data-db-key="SIKALOTNOW"].active'), back: document.getElementById('viewBack').hidden, focus: document.body.classList.contains('view-focus') }; });
 rec('4) 戻ると仕掛の一覧・左のメニューが出て行き先が選ばれている・戻るは消える', r.aside && r.active && r.back && !r.focus, JSON.stringify(r));
}, { viewport: { width: 1728, height: 1152 } });
