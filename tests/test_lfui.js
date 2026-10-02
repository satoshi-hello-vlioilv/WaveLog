/* test_lfui.js: 換算係数の画面——散布図・1ロットの積み上げ・係数の効き目と上書き（§9.543、利用者の選択 H-1＋H-5＋H-2）
   ============================================================
   利用者の選択「H-1とH-5とH-2の組み合わせでお願いします。」

   ここで固定すること（答えそのものは test_lfpoints.py。ここは画面がその答えを描いているか）:
    ① 散布図の点＝サーバーの1件ごとの点（ロット・実績・見積・外れ値）。要約の数＝サーバーの要約
    ② 因子は日本語の呼び名で出る（英字のキーを画面に出さない）
    ③ 点を押すと積み上げ（H-5）: 基準時間×係数の積＝見積。段を押すと右の図でその係数が選ばれる（H-5→H-2）
    ④ 係数を選んで値を打つと、保存の前に「効くロットの数・見積の変わり方」が正しく出て、散布図の点と図の◆が動く
    ⑤ 保存するとサーバーの上書きと点の見積が変わり、解除で戻る
    ⑥ 本物のマウスで点に乗せると、そのロットの実績と見積が浮く
   後片付けは finally（入れた実績を消す・上書きを外す・係数を作り直す）。
   ============================================================ */
'use strict';
const { run } = require('./lib/harness.js');
const B = 'http://127.0.0.1:5029', EQ = 'テスト設備A', TAG = 'lfui' + Date.now().toString(36);
const post = (p, x) => fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(x) })
 .then(async r => ({ st: r.status, body: await r.json().catch(() => ({})) }));
const get = p => fetch(B + p).then(r => r.json());
const lfApi = () => get('/api/schedule/load-factors?equipment=' + encodeURIComponent(EQ));
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
function records() {
 let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
 const out = [];
 for (let i = 0; i < 40; i++) {
  const p = ['一般', '自動車', '電機'][i % 3], th = [0.2, 0.4, 0.6, 0.9, 1.2][i % 5], hc = [6, 12, 20, 30][i % 4];
  let min = Math.round(40 * (p === '自動車' ? 1.2 : 1) * (th < .3 ? 1.2 : 1) * (hc > 25 ? 1.3 : 1) * (0.85 + rnd() * 0.3));
  if (i === 7) min *= 3;
  const st = new Date(2026, 5, 1 + i, 8, 0), en = new Date(st.getTime() + min * 60000), id = `${TAG}-${i}`, lot = `${TAG}L${i}`;
  const basic = { lotNo: lot, equipment: EQ, purposeName: p, mfgThickness: String(th), boxHorizontalCount: String(hc) };
  out.push({ id, lot, payload: { id, status: '完了', workTime: { startAt: iso(st), endAt: iso(en) }, basic, settings: { registeredEquipment: EQ, crewSize: i % 2 ? '2' : '3' } } });
 }
 return out;
}

run('test_lfui: 換算係数の画面——散布図・積み上げ・係数の効き目と上書き（§9.543）', async ({ page, rec, W, errs }) => {
 const recs = records(); let ov = false;
 try {
  await post('/api/access-mode', { mode: 'edit' });
  for (const r of recs) {
   const x = await post('/api/measurement/backup', { id: r.id, lotNo: r.lot, equipment: EQ, status: '完了', codec: 'json-full-v32', payload: JSON.stringify(r.payload), user_id: 'test' });
   if (x.st !== 200) throw new Error('実績を入れられない ' + JSON.stringify(x.body));
  }
  await post('/api/schedule/load-factors/recalc', { equipment: EQ, user_id: 'test' });
  const api0 = await lfApi();
  rec('前提: 入れた実績でこの設備の係数が作られる', api0.model && api0.model.basis === 'equipment' && api0.points.length >= recs.length, JSON.stringify(api0.model && { basis: api0.model.basis, n: api0.model.n }));
  await page.goto(B + '/', { waitUntil: 'domcontentloaded' });
  await W.booted(page);
  await W.until(page, () => !!(window.WL && WL.mm && WL.mm.loadMasterTableCatalog && window.currentUserId && currentUserId()), null, { ms: 15000, what: '画面の準備' });
  await page.evaluate(() => WL.mm.openMasterMaint());
  await W.until(page, () => !!document.querySelector('[data-master="loadFactor"]'), null, { ms: 15000, what: '換算係数のタブ' });
  await page.evaluate(() => document.querySelector('[data-master="loadFactor"]').click());
  await W.until(page, () => document.querySelectorAll('#lfPlot [data-lf-lot]').length > 0, null, { ms: 15000, what: '散布図の点' });

  /* ① 点と要約 */
  const dom = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#lfPlot [data-lf-lot]')].map(e => [e.dataset.lfLot, [+e.dataset.est, +e.dataset.act, e.dataset.out]])));
  const badPts = api0.points.filter(p => { const d = dom[p.lot]; return !d || d[0] !== p.estimate || d[1] !== p.actual || d[2] !== (p.outlier ? '1' : '0'); }).map(p => p.lot);
  rec('① 散布図の点＝サーバーの点（ロット・実績・見積・外れ値）', !badPts.length && Object.keys(dom).length === api0.points.length, badPts.slice(0, 3).join(','));
  const kpi = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#masterMaintList [data-lf-kpi]')].map(e => [e.dataset.lfKpi, +e.dataset.v])));
  const s = api0.accuracy;
  rec('① 要約の数＝サーバーの要約（±20%・中央値・帯・外れ値）', kpi.within20 === s.within20 && kpi.ratio === s.ratio && kpi.band === s.band && kpi.out === s.outliers, JSON.stringify({ kpi, s }));
  /* ② 呼び名 */
  const raw = await page.evaluate(() => (document.getElementById('masterMaintList').innerText.match(/purposeName|mfgThickness|boxHorizontalCount|crewSize|mfgMaterial/g) || []).length);
  rec('② 因子は日本語の呼び名で出る（英字のキーが0）', raw === 0 && await page.evaluate(() => /用途/.test(document.getElementById('lfForest').textContent)), String(raw));

  /* ③ 積み上げ */
  const live = api0.points.filter(p => !p.outlier), pick = live[0];
  await page.click(`#lfPlot [data-lf-lot="${pick.lot}"]`);
  await W.until(page, l => (document.querySelector('#lfWf h4') || {}).textContent?.includes(l), pick.lot, { ms: 5000, what: '積み上げ' });
  const wf = await page.evaluate(() => ({ base: +document.querySelector('#lfWf [data-lf-wf-base]').dataset.v, steps: [...document.querySelectorAll('#lfWf [data-lf-step]')].map(e => +e.dataset.v), total: +document.querySelector('#lfWf [data-lf-wf-total]').dataset.v }));
  rec('③ 点を押すと積み上げ: 基準時間×係数の積＝見積（係数は小数3桁なので0.3分まで）', Math.abs(wf.base * wf.steps.reduce((a, v) => a * v, 1) - pick.estimate) <= .3 && wf.total === pick.estimate && wf.steps.length === pick.factors.length, JSON.stringify(wf));
  await page.click('#lfWf [data-lf-step][data-key="purposeName"]');
  await W.until(page, () => /用途＝/.test((document.querySelector('#lfEdit h4') || {}).textContent || ''), null, { ms: 5000, what: '段から係数を選ぶ' });
  rec('③ 積み上げの段を押すと、右の図でその係数が選ばれる', await page.evaluate(l => (document.querySelector('#lfEdit h4') || {}).textContent.includes('用途＝' + l), pick.factors.find(f => f.key === 'purposeName').level));

  /* ④ 保存の前の効き目（用途＝自動車） */
  await page.click('#lfForest [data-lf-level-row][data-key="purposeName"][data-level="自動車"]');
  await W.until(page, () => !!document.getElementById('lfOvValue'), null, { ms: 5000, what: '上書きの欄' });
  await page.fill('#lfOvValue', '1.5');
  const hits = live.filter(p => p.factors.some(f => f.key === 'purposeName' && f.level === '自動車'));
  const cur = hits[0].factors.find(f => f.key === 'purposeName').value, want = hits.reduce((a, p) => a + p.estimate * (1.5 / cur - 1), 0);
  await W.until(page, n => +(document.querySelector('#lfEdit [data-lf-preview]') || {}).dataset?.lots === n, hits.length, { ms: 5000, what: '効き目の字' });
  const pv = await page.evaluate(() => { const e = document.querySelector('#lfEdit [data-lf-preview]'); return { lots: +e.dataset.lots, delta: +e.dataset.delta, rings: document.querySelectorAll('#lfPlot .is-hit').length, draft: (document.querySelector('#lfForest [data-lf-draft="purposeName|自動車"]') || {}).getAttribute?.('d') || '' }; });
  rec('④ 打つと保存の前に「効くロットの数・見積の変わり方」を正しく言う', pv.lots === hits.length && Math.abs(pv.delta - want) <= .5, JSON.stringify({ pv, want: +want.toFixed(2) }));
  rec('④ 効くロットの点に輪が付き、係数の図に打った値の◆が出る', pv.rings === hits.length && /^M/.test(pv.draft), JSON.stringify(pv));

  /* ⑤ 保存と解除 */
  await page.click('#lfOvSave'); ov = true;
  await W.until(page, () => !!document.getElementById('lfOvClear'), null, { ms: 8000, what: '保存して解除ボタンが出る' });
  const api1 = await lfApi(), p1 = api1.points.find(p => p.lot === hits[0].lot);
  rec('⑤ 保存するとサーバーの上書きと点の見積が変わる（×1.5）', (api1.model.overrides || []).some(o => o.factor === 'purposeName' && o.level === '自動車' && o.coefficient === 1.5)
   && Math.abs(p1.estimate - hits[0].estimate * 1.5 / cur) <= .3 && await page.evaluate(([l, v]) => +document.querySelector(`#lfPlot [data-lf-lot="${l}"]`).dataset.est === v, [p1.lot, p1.estimate]), `${hits[0].estimate} → ${p1.estimate}`);
  await page.click('#lfOvClear');
  await W.until(page, () => !document.getElementById('lfOvClear') && !!document.getElementById('lfOvValue'), null, { ms: 8000, what: '解除' });
  const api2 = await lfApi();
  rec('⑤ 解除すると上書きが外れ、見積が元へ戻る', !(api2.model.overrides || []).some(o => o.factor === 'purposeName' && o.level === '自動車')
   && api2.points.find(p => p.lot === hits[0].lot).estimate === hits[0].estimate);
  ov = false;

  /* ⑥ 乗せると浮く */
  await page.hover(`#lfPlot [data-lf-lot="${live[1].lot}"]`);
  await W.until(page, l => ((document.querySelector('.wl-menu.lf-peek') || {}).textContent || '').includes(l), live[1].lot, { ms: 5000, what: '点の浮き出し' });
  rec('⑥ 本物のマウスで点に乗せると、そのロットの実績と見積が浮く', /実績.*見積/.test(await page.evaluate(() => document.querySelector('.wl-menu.lf-peek').textContent)));
  await page.mouse.move(5, 5);
  rec('コンソールに例外が出ない', errs.length === 0, errs.slice(0, 3).join(' / '));
 } finally {
  if (ov) await post('/api/schedule/load-factors/override', { equipment: EQ, factor: 'purposeName', level: '自動車', coefficient: null, user_id: 'test' });
  const d = await post('/api/measurement/backup/delete', { ids: recs.map(r => r.id) });
  await post('/api/schedule/load-factors/recalc', { equipment: EQ, user_id: 'test' });
  const left = ((await lfApi()).points || []).filter(p => String(p.lot).startsWith(TAG)).length;
  rec('後片付け: 入れた実績が消え、点に残らない', d.body.deleted === recs.length && left === 0, `${d.body.deleted}/${recs.length}・残り${left}`);
 }
});
