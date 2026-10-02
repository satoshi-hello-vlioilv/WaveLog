/* test_equse.js: 設備の使い分けの表と効き先の図（§9.542、利用者の選択 G-2＋G-4）
   ============================================================
   利用者の選択「G-2とG-4の組み合わせでお願いします。」

   ここで固定すること:
    ① 答えは`WL.equipUse.useMatrix()`の1箇所: 多数派（半分以上の側・同数は使う）・違い・効かないセル（測定を使わない設備の
       入力内容＝null）・どこにも出ない設備（違いに数えない）が、網で独立に作った正解と一致する
    ② 主役は1枚目の一覧のまま（行数・見出しが変わらない）。2枚目のタブの札が違いの合計を言う
    ③ 外した設定は**全部**「外した」と名指しされ、行の頭の「Nか所」が正解、同じ組み合わせの設備を名指しする
    ④ 効き先の図: 選んだ設備の機能ごとのレーンが使う／外したを言い、外した入力内容の札が数どおり。設備名を押すと図が替わる
    ⑤ 本物のマウスでセルに乗せると「外すと／外してある・残るもの」が浮き、選んだ設備のセルなら図の同じ所が光る
    ⑥ セルを押すと1回で保存され（サーバーの値が変わる）、もう一度押すと戻る
   後片付けは finally（設備A〜Dの「使う機能・入力内容」を元へ丸ごと戻し、戻ったことを確かめる）。
   ============================================================ */
'use strict';
const { run } = require('./lib/harness.js');
const B = 'http://127.0.0.1:5029';
const post = (p, x) => fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(x) })
 .then(async r => ({ st: r.status, body: await r.json().catch(() => ({})) }));
const get = p => fetch(B + p).then(r => r.json());
const FEATS = ['measure', 'schedule', 'report'];
const ITEMS = ['全長', '寸法・外観', '板厚', '板幅', 'ラテラルボー', 'バリ', 'テレスコープ', '巻ずれ', 'フラットネス'];
const SAMPLE = {
 'テスト設備A': { f: [], i: [] },
 'テスト設備B': { f: [], i: ['テレスコープ', '巻ずれ'] },
 'テスト設備C': { f: [], i: ['テレスコープ', '巻ずれ'] },
 'テスト設備D': { f: ['schedule'], i: ['板幅', 'ラテラルボー', 'バリ', 'テレスコープ', '巻ずれ'] }};
const rowFields = x => ({ id: x.id, name: x.name, kind: x.kind, maxStrips: x.maxStrips, standardMinutes: x.standardMinutes, maxLineSpeed: x.maxLineSpeed });
/* 正解（網の中で独立に作る）。 */
function truth(set) {
 const names = Object.keys(set), live = names.filter(n => set[n].f.length < FEATS.length), meas = live.filter(n => !set[n].f.includes('measure'));
 const majF = Object.fromEntries(FEATS.map(f => [f, live.filter(n => !set[n].f.includes(f)).length * 2 >= live.length]));
 const majI = Object.fromEntries(ITEMS.map(it => [it, meas.filter(n => !set[n].i.includes(it)).length * 2 >= meas.length]));
 const diff = Object.fromEntries(names.map(n => [n, !live.includes(n) ? 0 : FEATS.filter(f => !set[n].f.includes(f) !== majF[f]).length
  + (meas.includes(n) ? ITEMS.filter(it => !set[n].i.includes(it) !== majI[it]).length : 0)]));
 const na = names.filter(n => set[n].f.includes('measure')).length * ITEMS.length;
 const off = names.flatMap(n => set[n].f.map(k => [n, k]).concat(set[n].f.includes('measure') ? [] : set[n].i.map(k => [n, k])));
 return { diff, off, na, total: Object.values(diff).reduce((a, b) => a + b, 0) };
}

run('test_equse: 設備の使い分けの表と効き先の図（§9.542）', async ({ page, rec, W, errs }) => {
 const backup = [];
 try {
  await post('/api/access-mode', { mode: 'edit' });
  for (const x of (await get('/api/equipment-master')).items.filter(x => SAMPLE[x.name])) {
   backup.push(Object.assign(rowFields(x), { disabledFeatures: x.disabledFeatures, disabledMeasureItems: x.disabledMeasureItems }));
   const r = await post('/api/equipment-master/update', Object.assign(rowFields(x), { disabledFeatures: SAMPLE[x.name].f, disabledMeasureItems: SAMPLE[x.name].i, user_id: 'test' }));
   if (r.st !== 200) throw new Error('見本を入れられない ' + x.name + ' ' + JSON.stringify(r.body));
  }
  rec('前提: 検証用の設備4台へ見本の使い分けを入れられる', backup.length === 4, String(backup.length));
  await page.goto(B + '/', { waitUntil: 'domcontentloaded' });
  await W.booted(page);
  await W.until(page, () => !!(window.currentUserId && currentUserId() && WL.equipUse && WL.mm), null, { ms: 15000, what: '画面の準備' });

  /* ① 答えの1箇所（死んだ設備・測定を使わない設備を含む見本で） */
  /* f を足して、板厚を「使う2台・外す2台」の同数にする（同数は「使う」が多数派——既定の側）。 */
  const PURE = { a: { f: [], i: [] }, b: { f: [], i: ['バリ'] }, c: { f: ['measure'], i: [] }, d: { f: FEATS.slice(), i: [] }, e: { f: ['report'], i: ['バリ', '板厚'] },
   f: { f: [], i: ['板厚'] } };
  const got = await page.evaluate(([set, feats, items]) => {
   const mx = WL.equipUse.useMatrix(Object.entries(set).map(([n, v], k) => ({ id: k, name: n, disabledFeatures: v.f, disabledMeasureItems: v.i })),
    feats.map(key => ({ key })), items.map(key => ({ key })), 'measure');
   return { diff: Object.fromEntries(mx.rows.map(r => [r.it.name, r.diff.length])), na: mx.rows.reduce((a, r) => a + Object.values(r.i).filter(v => v === null).length, 0),
    dead: mx.rows.filter(r => r.dead).map(r => r.it.name), total: mx.total };
  }, [PURE, FEATS, ITEMS]);
  const tp = truth(PURE);
  rec('① 多数派との違いが正解と一致する（同数は使う側・どこにも出ない設備は数えない）', JSON.stringify(got.diff) === JSON.stringify(tp.diff) && got.total === tp.total, JSON.stringify(got.diff));
  rec('① 測定を使わない設備の入力内容は「効かない」（null）', got.na === tp.na && JSON.stringify(got.dead) === '["d"]', JSON.stringify(got));

  /* ② 主役の一覧と2枚目のタブ */
  await page.evaluate(() => WL.mm.openMasterMaint());
  await W.until(page, () => !!document.querySelector('[data-master="equipment"]'), null, { ms: 15000, what: '設備のタブ' });
  await page.evaluate(() => document.querySelector('[data-master="equipment"]').click());
  await W.until(page, () => document.querySelectorAll('#masterMaintList .mm-row:not(.head)').length >= 4 && !!document.querySelector('[data-ltab="eqUse"]'), null, { ms: 15000, what: '一覧と2枚目のタブ' });
  const main = await page.evaluate(() => ({ rows: document.querySelectorAll('#masterMaintList .mm-row:not(.head)').length,
   head: [...document.querySelectorAll('#masterMaintList .mm-row.head > *')].map(e => e.textContent.trim()).join('/'),
   badge: (document.querySelector('[data-ltab="eqUse"] .mm-ltab-b') || {}).textContent || '' }));
  const T = truth(SAMPLE);
  rec('② 主役は1枚目の一覧のまま（4行・見出しは変えない）', main.rows === 4 && main.head === '設備名/区分/最大条数/標準時間/最大速度/使える機能/使う入力内容/操作', JSON.stringify(main));
  rec('② 2枚目のタブの札が違いの合計を言う', main.badge === `違い ${T.total}`, main.badge);
  await page.click('[data-ltab="eqUse"]');
  await W.until(page, () => !!document.querySelector('#masterMaintList [data-eu-cell]'), null, { ms: 8000, what: '使い分けの表' });

  /* ③ 名指し・違い・同じ組み合わせ */
  const named = await page.evaluate(off => off.filter(([n, k]) => !!document.querySelector(`#masterMaintList [data-eu-cell][data-eu-eq="${CSS.escape(n)}"][data-eu-key="${CSS.escape(k)}"][data-on="0"]`)).length, T.off);
  rec('③ 外した設定を全部「外した」と名指しする', named === T.off.length, `${named}/${T.off.length}`);
  const diffs = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#masterMaintList [data-eu-diff]')].map(e => [e.dataset.euEq, +e.dataset.euDiff])));
  rec('③ 行の頭の「Nか所」が正解（字でも言う）', Object.keys(T.diff).every(n => diffs[n] === T.diff[n]), JSON.stringify(diffs));
  const sameB = await page.evaluate(() => [...document.querySelectorAll('#masterMaintList tbody tr')].find(tr => tr.textContent.includes('テスト設備B')).querySelector('.eu-dc small')?.textContent || '');
  rec('③ 同じ組み合わせの設備を名指しする（B＝C）', /テスト設備C/.test(sameB), sameB);

  /* ④ 効き先の図 */
  const lanesOf = () => page.evaluate(() => ({ cap: (document.querySelector('#masterMaintList .eu-fcap b') || {}).textContent || '',
   lanes: Object.fromEntries([...document.querySelectorAll('#masterMaintList [data-eu-lane]')].map(e => [e.dataset.euLane, e.dataset.on])),
   off: document.querySelectorAll('#masterMaintList .eu-chip.is-off').length }));
  await page.click('#masterMaintList [data-eu-pick][data-eu-eq="テスト設備D"]');
  const fd = await lanesOf();
  rec('④ 効き先の図: 選んだ設備（D）の機能ごとのレーンが使う／外したを言う', fd.cap === 'テスト設備D' && fd.lanes.measure === '1' && fd.lanes.schedule === '0' && fd.lanes.report === '1', JSON.stringify(fd));
  rec('④ 測定のレーンの入力内容の札は、外した数だけ「外した」', fd.off === SAMPLE['テスト設備D'].i.length, String(fd.off));
  await page.click('#masterMaintList [data-eu-pick][data-eu-eq="テスト設備B"]');
  const fb = await lanesOf();
  rec('④ 設備名を押すと図がその設備になる（B・作業予定は使う）', fb.cap === 'テスト設備B' && fb.lanes.schedule === '1' && fb.off === 2, JSON.stringify(fb));

  /* ⑤ 本物のマウスで乗せる */
  const cellSel = (eq, key) => `#masterMaintList [data-eu-cell][data-eu-eq="${eq}"][data-eu-key="${key}"]`;
  await page.hover(cellSel('テスト設備B', 'バリ'));
  await W.until(page, () => /外すと/.test((document.querySelector('.wl-menu.eu-peek') || {}).textContent || ''), null, { ms: 5000, what: '乗せた浮き出し' });
  const pk = await page.evaluate(() => ({ text: document.querySelector('.wl-menu.eu-peek').textContent, hot: [...document.querySelectorAll('#masterMaintList .eu-flow .is-hot')].map(e => e.dataset.euAt) }));
  rec('⑤ 乗せると「外すと何が起き、何が残るか」が浮く（字はサーバーの語彙）', /外すと：測定画面の入力内容に出ず/.test(pk.text) && /残るもの：値を入れてある項目は伏せません/.test(pk.text), pk.text.slice(0, 120));
  rec('⑤ 図に出している設備のセルに乗せると、図の同じ所が光る', JSON.stringify(pk.hot) === '["i:バリ"]', JSON.stringify(pk.hot));
  await page.mouse.move(5, 5);
  await W.until(page, () => !document.querySelector('.wl-menu.eu-peek'), null, { ms: 5000, what: '浮き出しが閉じる' });
  /* 右端のセル: 浮き出しは**乗せた物そのものに被らない**（被ると押しても click が届かない・下の効き先の図も隠さない＝上に出す）。 */
  await page.hover(cellSel('テスト設備A', 'フラットネス'));
  await W.until(page, () => /フラットネス/.test((document.querySelector('.wl-menu.eu-peek h4') || {}).textContent || ''), null, { ms: 5000, what: '右端のセルの浮き出し' });
  const cover = await page.evaluate(s => { const c = document.querySelector(s).getBoundingClientRect(), m = document.querySelector('.wl-menu.eu-peek').getBoundingClientRect();
   return { hit: !(m.right <= c.left || m.left >= c.right || m.bottom <= c.top || m.top >= c.bottom), inView: m.left >= 0 && m.right <= innerWidth }; }, cellSel('テスト設備A', 'フラットネス'));
  rec('⑤ 右端のセルの浮き出しは乗せたセルに被らず、画面に収まる', !cover.hit && cover.inView, JSON.stringify(cover));
  await page.mouse.move(5, 5);
  await W.until(page, () => !document.querySelector('.wl-menu.eu-peek'), null, { ms: 5000, what: '浮き出しが閉じる' });
  /* 鍵盤で焦点を移すと開く（`:focus-visible`のときだけ。押した瞬間の焦点では開かない）。 */
  await page.focus(cellSel('テスト設備C', '板厚'));
  await page.keyboard.press('Tab');
  await W.until(page, () => /テスト設備C × 板幅/.test((document.querySelector('.wl-menu.eu-peek h4') || {}).textContent || ''), null, { ms: 5000, what: '鍵盤で移った先の浮き出し' });
  rec('⑤ 鍵盤（Tab）で焦点を移すと、その先のセルの浮き出しが開く', /テスト設備C × 板幅/.test(await page.evaluate(() => (document.querySelector('.wl-menu.eu-peek h4') || {}).textContent || '')));
  await page.keyboard.press('Escape');
  await W.until(page, () => !document.querySelector('.wl-menu.eu-peek'), null, { ms: 5000, what: 'Escで閉じる' });

  /* ⑥ 押す＝1回で保存・もう一度で戻る */
  const offOf = async n => ((await get('/api/equipment-master')).items.find(x => x.name === n) || {}).disabledMeasureItems || [];
  await page.click(cellSel('テスト設備A', 'フラットネス'));
  await W.until(page, s => { const e = document.querySelector(s); return !!e && e.dataset.on === '0'; }, cellSel('テスト設備A', 'フラットネス'), { ms: 8000, what: '押したセルが外れる' });
  rec('⑥ セルを1回押すと保存される（サーバーの値が変わる）', (await offOf('テスト設備A')).includes('フラットネス'), JSON.stringify(await offOf('テスト設備A')));
  await page.click(cellSel('テスト設備A', 'フラットネス'));
  await W.until(page, s => { const e = document.querySelector(s); return !!e && e.dataset.on === '1'; }, cellSel('テスト設備A', 'フラットネス'), { ms: 8000, what: '押したセルが戻る' });
  rec('⑥ もう一度押すと戻る', !(await offOf('テスト設備A')).includes('フラットネス'));
  rec('コンソールに例外が出ない', errs.length === 0, errs.slice(0, 3).join(' / '));
 } finally {
  for (const x of backup) { const r = await post('/api/equipment-master/update', Object.assign({}, x, { user_id: 'test' })); if (r.st !== 200) console.log('  [cleanup] 戻せない', x.name, JSON.stringify(r.body)); }
  const now = (await get('/api/equipment-master')).items.filter(x => SAMPLE[x.name]);
  const back = now.filter(x => { const o = backup.find(y => y.name === x.name); return o && JSON.stringify(o.disabledFeatures) === JSON.stringify(x.disabledFeatures) && JSON.stringify(o.disabledMeasureItems) === JSON.stringify(x.disabledMeasureItems); }).length;
  rec('後片付け: 設備の使い分けが元へ戻る', back === backup.length, `${back}/${backup.length}`);
 }
});
