/* test_holdpick.js: 保持方式マスタ（フィンガー／ゴムリングを選ぶ判定表・§9.524、利用者の指示）。

   「フィンガーとゴムリングを選ぶ条件を今は板厚だけで…条件が複雑になるので、
     取得済みデータを列に持つ条件テーブルを組めるようにマスタを追加してください。」
   利用者の選択: 列＝計算値＋仕掛の列／表の形＝列がデータの判定表／当たらないときは最後の既定行。

   固定するのは5つ:
    ① **登録が無い設備は今までと同じ**（板厚 < フィンガー切替板厚 → フィンガー）
    ② 表の決まり（条数・仕掛の列・板厚の範囲）で方式が決まる。**上から最初に当たった行**
    ③ 刃選択の「材質」条件が当たる（前は`st.material`を誰も入れておらず1度も当たらなかった）
    ④ 盤: セルの書き方を読む／読めない字は理由を出して残し保存させない／試す行で当たる行が光る／
       保存すると登録・「未登録に戻す」で種へ戻る
    ⑤ 刃組ガイダンスが表に従い、説明文が「何行目に当たったか」を言う

   前（実測）: ② 表現できない（板厚だけ）・③ 当たらない。
   後片付けは finally（「未登録に戻す」＝行を消す）。途中で落ちると表が残り、
   次の実行と test_bladeui が引き継ぐ（§9.284）。 */
const H = require('./lib/harness.js');
const W = require('./lib/wait.js');
const B = H.B;
const EQ = 'テスト設備A';
const post = (p, body) => fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body) }).then(r => r.json());
const reset = () => post('/api/bladeset/hold-pick', { equipment: EQ, reset: true, user_id: 'test' });

H.run('test_holdpick: 保持方式マスタ（§9.524）', async ({ page, rec, idle, errs }) => {
 await reset();
 try {
  await page.goto(B + '/', { waitUntil: 'domcontentloaded' });
  await W.booted(page);
  await W.until(page, () => !!(window.currentUserId && currentUserId()), null, { ms: 15000, what: '更新者IDが決まる' });

  /* ---- ①②③ 判定（刃組の計算そのもの） ---- */
  const j = await page.evaluate(async EQ => {
   const Bs = WL.bladeSet, out = {};
   const M = Bs.normalize(await api('/api/bladeset/context?equipment=' + encodeURIComponent(EQ)));
   const fm = +M.P.fingerMax;
   out.stored = M.holdsStored;
   let same = 0, n = 0;
   for (let t = 0.1; t <= 2.0001; t += 0.05) {
    const st = Object.assign(Bs.defaultState(), { thick: +t.toFixed(2), lots: [{ name: 'L', w: 50, n: 22, parent: 'L' }], order: [] });
    Bs.syncOrder(st); n++;
    if (Bs.isFinger(st, M) === (st.thick < fm)) same++;
   }
   out.same = [same, n];
   const M2 = Object.assign({}, M, { holdsStored: true, holds: [
    { conditions: [{ field: 'strips', op: 'ge', value: '20' }], hold: 'フィンガー' },
    { conditions: [{ field: 'source.製造材質', op: 'eq', value: 'SUS304' }], hold: 'フィンガー' },
    { conditions: [{ field: 'thickness', op: 'between', value: '0.3', value2: '0.5' }], hold: 'フィンガー' },
    { conditions: [], hold: 'ゴムリング' }] });
   const cases = [[1.2, 22, 'C1020', 'フィンガー', 0], [1.2, 4, 'C1020', 'ゴムリング', 3], [1.2, 4, 'SUS304', 'フィンガー', 1],
                  [0.4, 4, 'C1020', 'フィンガー', 2], [0.8, 4, 'C1020', 'ゴムリング', 3]];
   out.table = cases.map(([t, nn, mat, want, at]) => {
    const st = Object.assign(Bs.defaultState(), { thick: t, lots: [{ name: 'L', w: 40, n: nn, parent: 'L' }], order: [], src: { 製造材質: mat } });
    Bs.syncOrder(st);
    const h = Bs.holdPick(st, M2);
    return h.hold === want && h.index === at ? 1 : `${t}/${nn}/${mat}:${h.hold}@${h.index}`;
   });
   const st3 = Object.assign(Bs.defaultState(), { thick: 1, lots: [{ name: 'L', w: 40, n: 4, parent: 'L' }], order: [], src: { 製造材質: 'SUS304' } });
   Bs.syncOrder(st3);
   out.material = !!Bs.pickGroup([{ conditions: [{ field: 'material', op: 'eq', value: 'SUS304' }], group: 'X', name: '材質' }],
                                 Bs.pickCtx(st3, M), M.pickFields);
   return out;
  }, EQ);
  rec('① 登録が無い設備は「未登録」（今までの決め方の種）', j.stored === false, String(j.stored));
  rec('① 登録が無ければ、どの板厚でも今までと同じ方式（板厚 < 切替板厚）', j.same[0] === j.same[1], j.same.join('/'));
  rec('② 表の決まり（条数・仕掛の列・板厚の範囲）で方式が決まり、上から最初の行が効く',
      j.table.every(x => x === 1), JSON.stringify(j.table));
  rec('③ 刃選択の「材質」条件が、1本目の仕掛の行から当たる', j.material === true);

  /* ---- ④ 盤 ---- */
  await page.evaluate(() => WL.mm.openMasterMaint());
  await W.until(page, () => !!document.querySelector('[data-master="bladesetHold"]'), null, { ms: 15000, what: '保持方式のタブ' });
  await page.evaluate(() => document.querySelector('[data-master="bladesetHold"]').click());
  await W.until(page, () => !!document.querySelector('.hp-table'), null, { ms: 10000, what: '判定表' });
  await page.selectOption('#hpEq', { label: EQ });
  await W.until(page, e => document.querySelector('#hpEq')?.value === e && !!document.querySelector('.hp-table'), EQ, { ms: 10000, what: '設備の判定表' });
  const shape = () => page.evaluate(() => ({
   state: document.querySelector('#masterMaintForm .hp-state')?.textContent || '',
   rows: [...document.querySelectorAll('.hp-table tbody tr')].map(tr => [...tr.querySelectorAll('input.hp-c')].map(i => i.value).join(',')
     + '→' + tr.querySelector('.hp-hold')?.value + (tr.classList.contains('is-won') ? '★' : '')).join(' / '),
   ans: document.querySelector('.hp-ans')?.textContent.trim() || '' }));
  const s0 = await shape();
  rec('④ 未登録の設備は、切替板厚から作った表と「未登録」を出す', /未登録/.test(s0.state) && s0.rows === '＜ 0.6→フィンガー / →ゴムリング', JSON.stringify(s0));
  await page.selectOption('#hpAddCol', 'strips');
  await W.until(page, () => /条数/.test(document.querySelector('.hp-table thead')?.textContent || ''), null, { ms: 4000, what: '条数の列' });
  await page.click('#hpAddRow');
  await W.until(page, () => document.querySelectorAll('.hp-table tbody tr').length === 3, null, { ms: 4000, what: '決まりの行が増える' });
  const cell = f => `.hp-table tbody tr:nth-child(2) .hp-c[data-f="${f}"]`;
  await page.fill(cell('strips'), '>= 20'); await page.press(cell('strips'), 'Tab');
  await W.until(page, () => /≧ 20/.test([...document.querySelectorAll('.hp-c')].map(i => i.value).join('|')), null, { ms: 4000, what: 'セルが読まれる' });
  await page.fill(cell('thickness'), 'abc'); await page.press(cell('thickness'), 'Tab');
  await W.until(page, () => !!document.querySelector('.hp-c.is-bad'), null, { ms: 4000, what: '読めないセル' });
  await page.fill('.hp-try .hp-p[data-p="strips"]', '22');
  await W.until(page, () => /2行目/.test(document.querySelector('.hp-ans')?.textContent || ''), null, { ms: 4000, what: '試す行の答え' });
  const bad = await page.evaluate(() => { const e = document.querySelector('.hp-c.is-bad'); return e ? `${e.value}｜${e.title}` : ''; });
  rec('④ 読めない字は理由を出して、描き直しても残す', /^abc｜.+/.test(bad), bad);
  const s1 = await shape();
  rec('④ 試す行に値を入れると当たる行が光り、答えと行番号を言う',
      /≧ 20→フィンガー★/.test(s1.rows) && /フィンガー（2行目に当たる）/.test(s1.ans), JSON.stringify(s1));
  await page.click('#hpSave');
  await page.waitForSelector('#appConfirmModal:not([hidden])', { timeout: 5000 });
  const refused = await page.evaluate(() => document.getElementById('appConfirmModal').textContent);
  rec('④ 読めないセルがあるうちは保存させない（理由を言う）', /読めないセル/.test(refused), refused.slice(0, 80));
  await page.click('#closeAppConfirm');
  await page.fill(cell('thickness'), ''); await page.press(cell('thickness'), 'Tab');
  await W.until(page, () => !document.querySelector('.hp-c.is-bad'), null, { ms: 4000, what: '直す' });
  await page.click('#hpSave');
  await W.until(page, () => /登録済み/.test(document.querySelector('#masterMaintForm .hp-state')?.textContent || ''), null, { ms: 10000, what: '保存' });
  const saved = await page.evaluate(async EQ => {
   const r = await api('/api/bladeset/hold-pick?equipment=' + encodeURIComponent(EQ));
   return JSON.stringify({ stored: r.stored, rows: r.rows.map(x => [x.conditions.map(c => c.field + c.op + c.value).join('&'), x.hold]) });
  }, EQ);
  rec('④ 保存すると、画面の表のまま登録になる（最後は既定の行）',
      saved === JSON.stringify({ stored: true, rows: [['thicknesslt0.6', 'フィンガー'], ['stripsge20', 'フィンガー'], ['', 'ゴムリング']] }), saved);

  /* ---- ⑤ 刃組ガイダンスが表に従う（条数22 → 2行目でフィンガー） ---- */
  await page.evaluate(eq => WL.bladeGuide.open({ equipment: eq, seed: { thickness: 1.2, originalWidth: 1130,
    lots: [{ name: 'HP1', w: 50, n: 22, parent: 'HP1' }], headLot: '' } }), EQ);
  await W.until(page, () => /フィンガー/.test(document.querySelector('#bsHold2')?.textContent || ''), null, { ms: 15000, what: 'ガイダンスがフィンガーになる' });
  const why = await page.evaluate(() => document.querySelector('#bsHold2').textContent);
  rec('⑤ ガイダンスは表に従い、説明が「何行目に当たったか」と条件を言う',
      /2行目（条数 ≧ 20）に当たったため/.test(why) && /フィンガー/.test(why), why.slice(0, 120));

  /* ---- 「未登録に戻す」 ---- */
  await page.evaluate(() => WL.mm.openMasterMaint());
  await page.evaluate(() => document.querySelector('[data-master="bladesetHold"]').click());
  await W.until(page, () => !!document.querySelector('#hpReset'), null, { ms: 10000, what: '未登録に戻すのボタン' });
  await page.click('#hpReset');
  await page.waitForSelector('#appConfirmModal:not([hidden])', { timeout: 5000 });
  await page.click('#appConfirmOk');
  await W.until(page, () => /未登録/.test(document.querySelector('#masterMaintForm .hp-state')?.textContent || ''), null, { ms: 10000, what: '未登録へ戻る' });
  const s2 = await shape();
  rec('④ 「未登録に戻す」で行が消え、切替板厚の種へ戻る', s2.rows.replace(/★/g, '') === '＜ 0.6→フィンガー / →ゴムリング', JSON.stringify(s2));
  /* 消えた列（条数）の試しの値が裏で効かない——板厚だけの表で、試す行は空なので答えは出さない。 */
  rec('④ 表に無い列の試しの値は効かない（消えた条数の22で当てない）', !/★/.test(s2.rows) && /値を入れると/.test(s2.ans), JSON.stringify(s2));
  rec('コンソールに例外が出ない', errs.length === 0, errs.slice(0, 3).join(' / '));
 } finally {
  await reset();
 }
}, { mode: 'edit', viewport: { width: 1728, height: 1030 } });
