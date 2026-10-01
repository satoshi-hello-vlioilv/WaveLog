/* test_partboards.js: 刃組基準値・スペーサー・フィンガーの盤（§9.531、利用者の指示）。

   「刃組基準値、スペーサー、フィンガーのマスタはもっと使いやすく再設計してください。」
   利用者の選択「中身に合わせて」: スペーサー＝寸法の在庫表をその場で直す1枚／フィンガー＝ゴムリングと
   同じ2ペイン（左＝材質・右＝幅ごとの本数）／刃組基準値＝節ごとの設定・既定値を薄字・離れたら保存。

   前（実測・VER2.417.0）: 刃組基準値は登録の無い設備で**いま効いている値が0個**（空の表だけ）。
   スペーサー・フィンガーは本数1つを直すのに 編集→欄→保存 の3手（その場で直せる欄 0）。
   固定するのは:
    ① 刃組基準値: 未登録でも、いま効いている値が欄の薄字で全部見える・節の名前に番号が無い
    ② 刃組基準値: 節の中で入力の左端が1本・打って離れると保存され「変更」の札・「既定へ」で空へ戻る
    ③ 刃組基準値: 選ぶ欄は「既定（右）」が選ばれている（保存で固定しない）
    ⑥ 刃組基準値（§9.533）: 左＝節・右＝図と欄の2ペイン。欄と図の部品は同じ鍵で光り合い、打った値で図が動く
    ④ スペーサー: 寸法の大きい順に全部・保有をその場で直すと保存・下限を割ると橙の札と頭の数
    ⑤ フィンガー: 左に材質（見本は図と同じ色）・材質を選んで幅を足すとその材質で登録される
   後片付けは finally（作った行を消し、直した値を戻す）。 */
const H = require('./lib/harness.js');
const W = require('./lib/wait.js');
const B = H.B;
const EQ = 'テスト設備A';
const api = (p, o) => fetch(B + p, o).then(r => r.json());
const post = (p, body) => api(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const q = encodeURIComponent(EQ);

async function openBoard(page, key, sel) {
 await page.evaluate(k => document.querySelector(`[data-master="${k}"]`).click(), key);
 await W.until(page, s => !!document.querySelector(s), sel, { ms: 10000, what: key + ' の盤' });
}

H.run('test_partboards: 刃組基準値・スペーサー・フィンガーの盤（§9.531）', async ({ page, rec }) => {
 await post('/api/bladeset/seed', { equipment: EQ });
 const std0 = ((await api('/api/bladeset-standard-master?equipment=' + q)).items || []).find(x => x.equipment === EQ) || null;
 const sp0 = ((await api('/api/bladeset-spacer-master?equipment=' + q)).items || []).filter(x => x.equipment === EQ);
 const madeFinger = [];
 let stdMade = null;
 try {
  if (std0) await post('/api/bladeset-standard-master/delete', { id: std0.id });
  await page.goto(B + '/', { waitUntil: 'domcontentloaded' });
  await W.booted(page);
  await W.until(page, () => !!(window.currentUserId && currentUserId()), null, { ms: 15000, what: '更新者IDが決まる' });
  await page.evaluate(() => WL.mm.openMasterMaint());
  await W.until(page, () => !!document.querySelector('[data-master="bladesetStandard"]'), null, { ms: 15000, what: '刃組のタブ' });

  /* ---- ① ② ③ ⑥ 刃組基準値（§9.533 で2ペイン: 左＝節・右＝その節の図と欄） ---- */
  await openBoard(page, 'bladesetStandard', '#masterMaintList .sb-row');
  const secNames = await page.evaluate(() => [...document.querySelectorAll('#masterMaintList .bk-item[data-bk-key]')].map(e => e.dataset.bkKey));
  /* 節を選ぶ（右のカードの見出しがその節になるまで待つ）。 */
  const pickSec = async name => {
   await page.click(`#masterMaintList .bk-item[data-bk-key="${name}"]`);
   await W.until(page, n => ((document.querySelector('#masterMaintList .sb-card h3') || {}).textContent || '') === n, name, { ms: 8000, what: '節 ' + name });
  };
  const secs = [];
  for (const name of secNames) {
   await pickSec(name);
   secs.push(await page.evaluate(nm => {
    const L = document.getElementById('masterMaintList');
    const nums = [...L.querySelectorAll('.sb-rows input[type=number]')];
    return { name: nm, nums: nums.length, shown: nums.filter(i => /^\d/.test(i.placeholder)).length,
     lefts: new Set([...L.querySelectorAll('.sb-c')].map(c => Math.round(c.getBoundingClientRect().left))).size,
     fig: !!L.querySelector('.sb-fig svg'),
     keys: L.querySelectorAll('.sb-rows [data-k]').length,
     linked: [...L.querySelectorAll('.sb-rows [data-k]')].filter(e => L.querySelector(`.sb-fig [data-k="${CSS.escape(e.dataset.k)}"]`)).length };
   }, name));
  }
  const tot = k => secs.reduce((a, x) => a + x[k], 0);
  rec('① 未登録の設備でも、いま効いている値が欄の薄字で見える（数の欄の9割以上）', tot('shown') >= tot('nums') * 0.9 && tot('nums') >= 25, `${tot('shown')}/${tot('nums')}`);
  rec('① 節の名前に番号（①②…）が無い', secs.length >= 6 && secs.every(x => !/[①-⑳]/.test(x.name)), secs.map(x => x.name).join('/'));
  rec('② 節の中で入力の左端が1本にそろう', secs.every(x => x.lefts === 1), secs.map(x => x.lefts).join('/'));
  rec('⑥ §9.533 左に節の一覧・右に選んだ節の図（6節とも図を持つ）', secs.length >= 6 && secs.every(x => x.fig), secs.map(x => x.name + ':' + x.fig).join('/'));
  rec('⑥ 欄の9割以上が図の部品と同じ鍵で結ばれている', tot('linked') >= (tot('keys') - 1) * 0.9, `${tot('linked')}/${tot('keys')}`);

  await pickSec('機械の寸法');
  const s1 = await page.evaluate(() => ({ state: document.querySelector('.bk-state').textContent,
   shaft: document.querySelector('.sb-rows [data-k="shaftDia"]').placeholder }));
  rec('① 頭が「未登録——すべて既定値」と言う', /未登録/.test(s1.state) && /既定値/.test(s1.state), s1.state);
  /* 欄に入ると図の同じ鍵が光り、打った値で図が動く（保存はまだ）。図の部品に乗ると欄が光る。 */
  await page.focus('.sb-rows [data-k="arborLen"]');
  const lit = await page.evaluate(() => [...document.querySelectorAll('.sb-fig [data-k].is-on')].map(e => e.dataset.k));
  rec('⑥ 欄に入ると図の同じ部品が光る（有効長）', lit.length > 0 && lit.every(k => k === 'arborLen'), lit.join('/'));
  await page.fill('.sb-rows [data-k="arborLen"]', '1500');
  const dimTxt = await page.evaluate(() => [...document.querySelectorAll('.sb-fig [data-k="arborLen"] text')].map(e => e.textContent).join('/'));
  rec('⑥ 打った値で図が動く（保存の前に・有効長 1500）', /1500/.test(dimTxt), dimTxt);
  await page.fill('.sb-rows [data-k="arborLen"]', '');
  await page.hover('.sb-fig [data-k="shaftDia"]');
  rec('⑥ 図の部品に乗ると、効く欄の行が光る（軸外径）',
      await page.evaluate(() => !!document.querySelector('.sb-row.is-on [data-k="shaftDia"]')));
  await pickSec('板押さえの空き');
  const s1b = await page.evaluate(() => { const lube = document.querySelector('.sb-rows [data-k="integLubeText"]');
   return { gap: (document.querySelector('.sb-rows [data-k="integGapMin"]') || {}).placeholder, lube: lube && lube.value,
            lubeOpt: lube && [...lube.options].map(o => o.textContent).join('/') }; });
  rec('§9.532 一体型の空き 目標（既定0）と潤滑リングの切り替え（既定は載せない・載せる／載せない）が出る',
      s1b.gap === '0' && s1b.lube === '' && s1b.lubeOpt === '既定（載せない）/載せる/載せない', JSON.stringify(s1b));
  await pickSec('図の呼び方と向き');
  const s1c = await page.evaluate(() => { const pos = document.querySelector('.sb-rows [data-k="viewDatumPos"]');
   return { pos: pos && pos.value, posOpt: pos && pos.options[0].textContent }; });
  rec('③ 選ぶ欄は「既定（右）」が選ばれている（登録の無い値を保存で固定しない）', s1c.pos === '' && /既定（右）/.test(s1c.posOpt || ''), JSON.stringify(s1c));
  await pickSec('機械の寸法');

  await page.fill('.sb-rows [data-k="shaftDia"]', '210');
  await page.press('.sb-rows [data-k="shaftDia"]', 'Tab');
  const saved = await W.poll(() => api('/api/bladeset-standard-master?equipment=' + q), r => ((r.items || []).find(x => x.equipment === EQ) || {}).shaftDia === 210);
  stdMade = ((saved.items || []).find(x => x.equipment === EQ) || {}).id || null;
  await W.until(page, () => !!document.querySelector('.sb-row.is-set [data-k="shaftDia"]'), null, { ms: 8000, what: '変更の札' });
  const s2 = await page.evaluate(() => ({ state: document.querySelector('.bk-state').textContent,
   tag: !!document.querySelector('.sb-row.is-set [data-undo="shaftDia"]'), focus: document.activeElement && document.activeElement.dataset.k }));
  rec('② 打って離れると保存される（軸外径 210）', !!stdMade, String(stdMade));
  rec('② 変えた欄に「変更」の札と「既定へ」・頭は「既定と違う値 1項目」', s2.tag && /既定と違う値 1項目/.test(s2.state), JSON.stringify(s2));
  rec('② 保存して描き直しても、焦点は Tab で移った先の欄', !!s2.focus && s2.focus !== 'shaftDia', String(s2.focus));
  await page.click('[data-undo="shaftDia"]');
  const back = await W.poll(() => api('/api/bladeset-standard-master?equipment=' + q), r => ((r.items || []).find(x => x.equipment === EQ) || {}).shaftDia == null);
  rec('② 「既定へ」で空（既定値）へ戻る', ((back.items || []).find(x => x.equipment === EQ) || {}).shaftDia == null);

  /* ---- ④ スペーサー ---- */
  await openBoard(page, 'bladesetSpacer', '#masterMaintList .bk-stock tr[data-id]');
  const sp = await page.evaluate(() => [...document.querySelectorAll('#masterMaintList .bk-stock tr[data-id]')].map(tr => +tr.querySelector('th').firstChild.textContent));
  rec('④ スペーサーは寸法の大きい順に全部', sp.length === sp0.length && sp.every((v, i) => i === 0 || sp[i - 1] >= v), sp.join('/'));
  const t = sp0.slice().sort((a, b) => b.size - a.size)[0];
  const row = `#masterMaintList tr[data-id="${t.id}"]`;
  await page.fill(row + ' [data-f="qty"]', String((t.qty || 0) + 1));
  await page.press(row + ' [data-f="qty"]', 'Tab');
  const sq = await W.poll(() => api('/api/bladeset-spacer-master?equipment=' + q), r => ((r.items || []).find(x => x.id === t.id) || {}).qty === (t.qty || 0) + 1);
  rec('④ 保有はその場で直すと保存（1手・窓を開かない）', ((sq.items || []).find(x => x.id === t.id) || {}).qty === (t.qty || 0) + 1);
  await page.fill(row + ' [data-f="minQty"]', String((t.qty || 0) + 50));
  await page.press(row + ' [data-f="minQty"]', 'Tab');
  await W.until(page, s => /下限を下回っています/.test((document.querySelector(s) || {}).textContent || ''), row, { ms: 8000, what: '下限割れの札' });
  rec('④ 下限を割った行は橙の札、頭が「下限割れ 1」と言う',
      await page.evaluate(() => /下限割れ 1/.test(document.querySelector('.bk-state').textContent) && !!document.querySelector('.bk-stock .bk-tag.is-warn')));

  /* ---- ⑤ フィンガー ---- */
  await openBoard(page, 'bladesetFinger', '#masterMaintList .bk-item[data-bk-key]');
  const fg = await page.evaluate(() => {
   const hex = v => { const c = document.createElement('canvas').getContext('2d'); c.fillStyle = v; return c.fillStyle; };
   const tok = n => hex(getComputedStyle(document.getElementById('masterMaintList')).getPropertyValue(n).trim());
   return { mats: [...document.querySelectorAll('.bk-item[data-bk-key]')].map(b => ({ m: b.dataset.bkKey,
     sw: hex(getComputedStyle(b.querySelector('.rb-sw')).backgroundColor) })), bake: tok('--bs-fig-finger'), al: tok('--bs-fig-finger-al') };
  });
  rec('⑤ 左に材質（ベークライト・アルミニウム）', fg.mats.map(x => x.m).join('/') === 'ベークライト/アルミニウム', JSON.stringify(fg.mats));
  rec('⑤ 材質の見本は刃組図と同じ色（ベークライト＝茶・アルミ＝藍の淡色）',
      fg.mats[0] && fg.mats[0].sw === fg.bake && fg.mats[1] && fg.mats[1].sw === fg.al, JSON.stringify(fg));
  await page.click('.bk-item[data-bk-key="アルミニウム"]');
  await W.until(page, () => /アルミニウム/.test((document.querySelector('.bk-card-t h3') || {}).textContent || ''), null, { ms: 8000, what: 'アルミの詳細' });
  await page.fill('#fgNewD', '77');
  await page.fill('#fgNewQ', '4');
  await page.click('[data-act="add"]');
  const fr = await W.poll(() => api('/api/bladeset-finger-master?equipment=' + q),
   r => (r.items || []).some(x => x.equipment === EQ && x.width === 77 && x.material === 'アルミニウム'));
  const nf = (fr.items || []).find(x => x.equipment === EQ && x.width === 77 && x.material === 'アルミニウム');
  if (nf) madeFinger.push(nf.id);
  rec('⑤ 選んだ材質で幅を足すと、その材質で登録される（アルミニウム 77mm・4本）', !!nf && nf.qty === 4, JSON.stringify(nf));
  await W.until(page, () => !!document.querySelector('.bk-stock tr[data-id]'), null, { ms: 8000, what: '足した行' });
  rec('⑤ 足した行が右の表に出る', await page.evaluate(() => [...document.querySelectorAll('.bk-stock tr[data-id] th')].some(th => /^77/.test(th.textContent))));
 } finally {
  /* 後片付け（消せなかったら黙らない・§9.360）。 */
  for (const id of madeFinger) { const r = await post('/api/bladeset-finger-master/delete', { id }); if (!r || !r.ok) console.log('  [cleanup] フィンガーを消せない', id); }
  for (const x of sp0) await post('/api/bladeset-spacer-master/update', { id: x.id, qty: x.qty || 0, minQty: x.minQty || 0, user_id: 'test' });
  const cur = ((await api('/api/bladeset-standard-master?equipment=' + q)).items || []).find(x => x.equipment === EQ);
  if (cur) await post('/api/bladeset-standard-master/delete', { id: cur.id });
  if (std0) {
   const vals = Object.fromEntries(Object.entries(std0).filter(([k, v]) => v != null && !['id', 'enabled', 'enabledText', 'order'].includes(k)));
   const r = await post('/api/bladeset-standard-master', Object.assign(vals, { equipment: EQ, user_id: 'test' }));
   if (!r || !r.ok) console.log('  [cleanup] 刃組基準値を戻せない', JSON.stringify(r));
  }
 }
});
