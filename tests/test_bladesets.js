/* test_bladesets.js: 刃セット・刃選択の4項目・フィンガー材質（§9.526、利用者の指示）。

   「１）刃のセットの使用状態を切り替えられるようにしてください。使用中、研磨中
     ２）カテゴリを追加して通常刃、専用刃の選択も追加してください。
     ３）刃の選択マスタは、板押さえ方式と板厚と材質と調質から選べるようにしてください。
     ４）フィンガーは名称入力欄は不要、その代わりにフィンガー材質というカテゴリを追加し、
        ベークライトとアルミニウムを登録して、既定はベークライトにしてください。」
   利用者の選択: 使用状態・カテゴリは**セット（組）ごと**／刃選択の条件は**4項目に絞る**（前の決まりは効かせる）。

   前（実測）: ① セットの切り替え口なし（刃1枚ずつの「状態」3値に混ざっていた）・② 同じ・
   ③ 選べる項目7つ（板押さえ方式・調質は0）・④ 名称が必須で材質の欄なし。
   固定するのは4つ（§9.529 で①は「刃」の2ペインへ、②は2つの判定表へ、③は test_bladepick.js へ移した）:
    ① 盤: セットの札を押すと**その場で保存**され、研磨中は「選ばれない」と字で言う
    ② ガイダンスの選び方: 未登録は通常刃・使用中のいちばん厚い刃／研磨中は選ばない／専用刃は
       カテゴリの表に当たったときだけ（セットまで選べる）・刃厚は刃厚の表・使えなければ落として理由を札で
    ④ フィンガーの窓: 名称の欄が無く、材質の選択（既定ベークライト）がある
   後片付けは finally（刃セットを初期値へ・決まりを消す）。 */
const H = require('./lib/harness.js');
const W = require('./lib/wait.js');
const B = H.B;
const EQ = 'テスト設備A';
const api = (p, o) => fetch(B + p, o).then(r => r.json());
const post = (p, body) => api(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

H.run('test_bladesets: 刃セット・刃選択の4項目・フィンガー材質（§9.526）', async ({ page, rec, errs }) => {
 let groups = [];
 const madeFingers = [];
 let holdSaved = false;
 await post('/api/bladeset/seed', { equipment: EQ });
 try {
  groups = ((await api('/api/bladeset/blade-sets?equipment=' + encodeURIComponent(EQ))).items || []).map(x => x.group);
  rec('刃セットは刃の組から作られる（初期セットで2組以上）', groups.length >= 2, groups.join('/'));
  for (const g of groups) await post('/api/bladeset/blade-sets', { equipment: EQ, group: g, reset: true });

  await page.goto(B + '/', { waitUntil: 'domcontentloaded' });
  await W.booted(page);
  await W.until(page, () => !!(window.currentUserId && currentUserId()), null, { ms: 15000, what: '更新者IDが決まる' });

  /* ---- ① 盤（§9.529 で「刃」の2ペインへ統合: 左＝セット・右＝カテゴリ／使用状態と刃厚ごとの行） ---- */
  await page.evaluate(() => WL.mm.openMasterMaint());
  await W.until(page, () => !!document.querySelector('[data-master="bladesetBlade"]'), null, { ms: 15000, what: '刃のタブ' });
  rec('① 「刃セット」のタブは「刃」へ統合した（§9.529）', await page.evaluate(() => !document.querySelector('[data-master="bladesetSets"]')));
  await page.evaluate(() => document.querySelector('[data-master="bladesetBlade"]').click());
  await W.until(page, () => !!document.querySelector('#bbEq'), null, { ms: 10000, what: '刃の盤' });
  await page.selectOption('#bbEq', { label: EQ });
  await W.until(page, e => document.querySelector('#bbEq')?.value === e && !!document.querySelector('.bk-card'), EQ, { ms: 10000, what: '設備の刃セット' });
  const g0 = groups[0];
  const cardOf = g => page.evaluate(g => {
   const it = document.querySelector(`.bk-item[data-bk-key="${g}"]`);
   if (!it) return null;
   if (!it.classList.contains('is-on')) return { pick: true };
   const on = k => document.querySelector(`.bk-card .bk-opt.is-on[data-seg="${k}"]`)?.textContent || '';
   return { cat: on('category'), use: on('use'), say: document.querySelector('.bk-card-t small')?.textContent || '',
            tags: [...it.querySelectorAll('.bk-tag')].map(t => t.textContent).join('/') };
  }, g);
  await page.click(`.bk-item[data-bk-key="${g0}"]`);
  await W.until(page, g => !!document.querySelector(`.bk-item.is-on[data-bk-key="${g}"]`), g0, { ms: 8000, what: 'セットを選ぶ' });
  const r0 = await cardOf(g0);
  rec('① 未登録の組は通常刃・使用中で、「ふつうは…選ばれます」と言う',
      !!r0 && r0.cat === '通常刃' && r0.use === '使用中' && /ふつうは/.test(r0.say) && /未登録/.test(r0.say), JSON.stringify(r0));
  const sel = (k, v) => `.bk-card .bk-opt[data-seg="${k}"][data-v="${v}"]`;
  await page.click(sel('use', '研磨中'));
  await W.until(page, () => /研磨中/.test(document.querySelector('.bk-card .bk-opt.is-on[data-seg="use"]')?.textContent || ''), null, { ms: 8000, what: '研磨中へ' });
  const s1 = (await api('/api/bladeset/blade-sets?equipment=' + encodeURIComponent(EQ))).items.find(x => x.group === g0);
  const r1 = await cardOf(g0);
  rec('① 札を押すとその場で保存される（保存ボタンを持たない）', s1 && s1.use === '研磨中' && s1.stored === true, JSON.stringify(s1));
  rec('① 研磨中のセットは「刃組ガイダンスでは選ばれません」と字で言い、一覧にも札が付く',
      /選ばれません/.test(r1.say) && /研磨中/.test(r1.tags), JSON.stringify(r1));
  await page.click(sel('category', '専用刃'));
  await W.until(page, () => /専用刃/.test(document.querySelector('.bk-card .bk-opt.is-on[data-seg="category"]')?.textContent || ''), null, { ms: 8000, what: '専用刃へ' });
  const s2 = (await api('/api/bladeset/blade-sets?equipment=' + encodeURIComponent(EQ))).items.find(x => x.group === g0);
  rec('① カテゴリを変えても使用状態は残る（送った項目だけ書く）', s2 && s2.category === '専用刃' && s2.use === '研磨中', JSON.stringify(s2));

  /* ---- ② ガイダンスの選び方（§9.529: 刃のカテゴリの表 → 刃厚の表） ---- */
  const pick = await page.evaluate(async EQ => {
   const Bs = WL.bladeSet;
   const M = Bs.normalize(await api('/api/bladeset/context?equipment=' + encodeURIComponent(EQ)));
   const blade = (group, tk, category, use) => ({ name: group + tk, group, thickness: tk, currentDia: 300, qty: 1, category, use });
   const tb = (rows, def) => ({ stored: true, rows: rows.concat([def]) });
   const run = (blades, cat, th, thick) => {
    const st = Object.assign(Bs.defaultState(), { thick: thick || 1.2, lots: [{ name: 'L', w: 50, n: 22, parent: 'L' }], order: [] });
    Bs.syncOrder(st);
    Bs.applyBladePick(st, Object.assign({}, M, { blades, holds: [], holdsStored: false, pickTables: {
     category: cat || { stored: false, rows: [{ conditions: [], answer: '通常刃', group: '' }] },
     thickness: th || { stored: false, rows: [{ conditions: [], answer: '' }] } } }));
    return { tk: st.tk, set: st.pick.set, pick: st.pick, word: Bs.pickWord(st, M).text };
   };
   const both = [blade('N', 10, '通常刃', '使用中'), blade('N', 5, '通常刃', '使用中'), blade('S', 15, '専用刃', '使用中'), blade('T', 8, '専用刃', '使用中')];
   const toS = tb([{ conditions: [{ field: 'thickness', op: 'ge', value: '1.0' }], answer: '専用刃', group: 'S' }], { conditions: [], answer: '通常刃', group: '' });
   const anyS = tb([{ conditions: [{ field: 'thickness', op: 'ge', value: '1.0' }], answer: '専用刃', group: '' }], { conditions: [], answer: '通常刃', group: '' });
   return {
    fromCtx: M.blades.every(b => !!b.category && !!b.use),
    normal: run(both).tk,
    grindSkip: run([blade('N', 10, '通常刃', '研磨中'), blade('M', 12, '通常刃', '使用中')]).tk,
    special: run(both, toS),
    anySpecial: run(both, anyS).set,
    specialGrind: run([blade('N', 10, '通常刃', '使用中'), blade('S', 15, '専用刃', '研磨中')], toS),
    holdRule: run(both, tb([{ conditions: [{ field: 'hold', op: 'eq', value: 'ゴムリング' }], answer: '専用刃', group: 'S' }], { conditions: [], answer: '通常刃', group: '' })).tk,
    th5: run(both, null, tb([{ conditions: [{ field: 'thickness', op: 'lt', value: '2' }], answer: '5' }], { conditions: [], answer: '' })),
    thByCat: run(both, toS, tb([{ conditions: [{ field: 'category', op: 'eq', value: '専用刃' }], answer: '15' }], { conditions: [], answer: '5' })).tk,
    thMissing: run(both, null, tb([], { conditions: [], answer: '7' }))
   };
  }, EQ);
  rec('② 刃の行はサーバーからセットのカテゴリ・使用状態を名乗って届く', pick.fromCtx === true);
  rec('② 表が未登録なら通常刃・使用中のいちばん厚い刃（今までと同じ）', pick.normal === 10, String(pick.normal));
  rec('② 研磨中のセットは選ばない（使用中の通常刃へ）', pick.grindSkip === 12, String(pick.grindSkip));
  rec('② カテゴリの表で専用刃（セット S）に当たれば、そのセットの刃・札は「専用刃 S・15mm」',
      pick.special.tk === 15 && pick.special.set === 'S' && !pick.special.pick.missing.length && pick.special.word === '専用刃 S・15mm', JSON.stringify(pick.special));
  rec('② 専用刃（どれでも）なら使える専用刃のいちばん厚い刃（S 15mm）', pick.anySpecial === 'S', String(pick.anySpecial));
  rec('② 当たっても専用刃が研磨中なら通常刃で描き、理由（missing）を札で言う',
      pick.specialGrind.tk === 10 && pick.specialGrind.pick.missing.includes('category') && /使えない/.test(pick.specialGrind.word), JSON.stringify(pick.specialGrind));
  rec('② 前の表の答え（板押さえ方式＝ゴムリング）を条件に使える', pick.holdRule === 15, String(pick.holdRule));
  rec('§9.529 ② 刃厚の表で 5mm に当たれば 5mm の刃（板厚 1.2 < 2）', pick.th5.tk === 5 && pick.th5.word === '通常刃 N・5mm', JSON.stringify(pick.th5));
  rec('§9.529 ② 刃厚の表は刃のカテゴリの答えも条件に使える（専用刃 → 15mm）', pick.thByCat === 15, String(pick.thByCat));
  rec('§9.529 ② 登録の無い刃厚（7mm）に当たれば、いちばん厚い刃で描いて「7mmが無い」と言う',
      pick.thMissing.tk === 10 && pick.thMissing.pick.missing.includes('thickness') && /7mmが無い/.test(pick.thMissing.word), JSON.stringify(pick.thMissing));

  /* ---- ④ フィンガーの窓 ---- */
  await page.evaluate(() => document.querySelector('[data-master="bladesetFinger"]')?.click());
  await W.until(page, () => !!document.getElementById('masterMaintAdd'), null, { ms: 10000, what: '新規のボタン' });
  await page.click('#masterMaintAdd');
  const MF = '.mm-editor-modal:not([hidden]) [data-field="material"]';
  await W.until(page, s => !!document.querySelector(s), MF, { ms: 10000, what: 'フィンガーの窓' });
  const fg = await page.evaluate(MF => {
   const m = document.querySelector(MF);
   return { name: !!document.querySelector('.mm-editor-modal:not([hidden]) [data-field="name"]'),
            opts: m ? [...m.options].map(o => o.value).filter(Boolean) : [], cur: m ? m.value : null };
  }, MF);
  await page.click('#maintEditorClose');
  rec('④ フィンガーの窓に名称の欄は無い', fg.name === false, JSON.stringify(fg));
  rec('④ 材質はベークライト・アルミニウムから選び、既定はベークライト',
      fg.opts.join('/') === 'ベークライト/アルミニウム' && fg.cur === 'ベークライト', JSON.stringify(fg));

  /* ---- ⑤ フィンガーの材質で図の色を変える（§9.527、利用者の指示・選択「保持方式の表で決める」「アルミは青みの銀」） ----
     前（実測）: 在庫は幅だけで数え材質を合算（ベークライト+アルミの本数）・図の色は材質によらず茶の1色。 */
  const ctx0 = await api('/api/bladeset/context?equipment=' + encodeURIComponent(EQ));
  for (const f of (ctx0.fingers || []).filter(x => x.material === 'ベークライト')) {
   const r = await post('/api/bladeset-finger-master', { equipment: EQ, width: f.width, material: 'アルミニウム', qty: 3, user_id: 'test' });
   if (r && r.id) madeFingers.push(r.id);
  }
  rec('⑤ 準備: 同じ幅のアルミニウムのフィンガーを足せる（設備＋幅＋材質で別の1本）', madeFingers.length > 0, String(madeFingers.length));
  const calc = await page.evaluate(async EQ => {
   const Bs = WL.bladeSet;
   const M0 = Bs.normalize(await api('/api/bladeset/context?equipment=' + encodeURIComponent(EQ)));
   const table = mat => Object.assign({}, M0, { holdsStored: true, holds: [
    { conditions: [{ field: 'thickness', op: 'lt', value: '1' }], hold: 'フィンガー', material: mat },
    { conditions: [], hold: 'ゴムリング', material: '' }] });
   const run = M => {
    const st = Object.assign(Bs.defaultState(), { thick: 0.5, W: 1130, lots: [{ name: 'L', w: 50, n: 22, parent: 'L' }], order: [] });
    Bs.syncOrder(st);
    const res = Bs.solve(st, M, Bs.buildIndex(M));
    let total = 0; res.zp.plan.finger.forEach(x => { total += x.total; });
    const mats = new Set();
    res.zp.zones.forEach(z => [z.up, z.lo].forEach(p => { if (p && p.hold && p.hold.kind === 'finger') mats.add(p.hold.mat); }));
    return { mat: Bs.fingerMaterial(st, M), label: Bs.holdLabel(st, M), total, mats: [...mats] };
   };
   const stock = mat => M0.fingers.filter(f => f.material === mat).reduce((a, f) => a + f.qty, 0);
   return { al: run(table('アルミニウム')), blank: run(table('')), stockAl: stock('アルミニウム'), stockBk: stock('ベークライト'),
            tone: [Bs.fingerTone('ベークライト'), Bs.fingerTone('アルミニウム'), Bs.fingerTone('知らない')] };
  }, EQ);
  rec('⑤ 当たった行の材質で決まる（アルミニウム）・画面の名前は「フィンガー（アルミニウム）」',
      calc.al.mat === 'アルミニウム' && calc.al.label === 'フィンガー（アルミニウム）', JSON.stringify(calc.al));
  rec('⑤ 行の材質が空欄なら既定のベークライト', calc.blank.mat === 'ベークライト', JSON.stringify(calc.blank));
  rec('⑤ 在庫はその材質だけで数える（ほかの材質の本数を足さない）',
      calc.al.total === calc.stockAl && calc.blank.total === calc.stockBk && calc.stockAl !== calc.stockBk,
      JSON.stringify({ al: calc.al.total, bk: calc.blank.total, stockAl: calc.stockAl, stockBk: calc.stockBk }));
  rec('⑤ 区間の押さえは使う材質を名乗る（図まで材質が届く）',
      calc.al.mats.join() === 'アルミニウム' && calc.blank.mats.join() === 'ベークライト', JSON.stringify([calc.al.mats, calc.blank.mats]));
  rec('⑤ 色の鍵は材質から（知らない材質は既定の茶）', calc.tone.join('/') === 'finger/finger-al/finger', calc.tone.join('/'));

  /* 表に登録して、刃組ガイダンスの3つの図で色を見る。 */
  await post('/api/bladeset/hold-pick', { equipment: EQ, user_id: 'test', rows: [
   { conditions: [{ field: 'thickness', op: 'lt', value: '1' }], hold: 'フィンガー', material: 'アルミニウム' },
   { conditions: [], hold: 'ゴムリング' }] });
  holdSaved = true;
  const hp = await api('/api/bladeset/hold-pick?equipment=' + encodeURIComponent(EQ));
  rec('⑤ 保持方式の表は行ごとにフィンガー材質を持つ（ゴムリングの行は空）',
      hp.rows[0].material === 'アルミニウム' && hp.rows[1].material === '' && (hp.fingerMaterials || []).length === 2, JSON.stringify(hp.rows));
  await page.evaluate(() => document.querySelector('[data-master="bladesetHold"]')?.click());
  await W.until(page, () => !!document.querySelector('#hpEq'), null, { ms: 10000, what: '保持方式の盤' });
  await page.selectOption('#hpEq', { label: EQ }).catch(() => {});
  await W.until(page, () => !!document.querySelector('.rt-table .rt-ansel'), null, { ms: 10000, what: '保持方式の表' });
  const hpOpts = await page.evaluate(() => { const s = document.querySelector('.rt-table .rt-ansel');
   return { opts: [...s.options].map(o => o.textContent), cur: s.options[s.selectedIndex].textContent }; });
  rec('⑤ 表の「→ 保持方式」でフィンガーの材質まで選べ、登録した材質が選ばれている',
      hpOpts.opts.join('/') === 'フィンガー（ベークライト）/フィンガー（アルミニウム）/ゴムリング' && hpOpts.cur === 'フィンガー（アルミニウム）',
      JSON.stringify(hpOpts));

  await page.evaluate(eq => WL.bladeGuide.open({ equipment: eq, seed: { thickness: 0.5, originalWidth: 1130,
    lots: [{ name: 'FM1', w: 50, n: 22, parent: 'FM1' }], headLot: '' } }), EQ);
  await W.until(page, () => /アルミニウム/.test(document.querySelector('#bsHold2')?.textContent || ''), null, { ms: 20000, what: 'ガイダンスがアルミのフィンガー' });
  rec('⑤ ガイダンスの説明は材質まで言う', /フィンガー（アルミニウム）/.test(await page.evaluate(() => document.querySelector('#bsHold2').textContent)));
  const toFig = async k => {
   await page.evaluate(() => document.querySelectorAll('.bs-step.is-open').forEach(p => p.classList.remove('is-open')));
   await page.click(`#bsFigTabs [data-fig="${k}"]`);
   await W.until(page, k => document.querySelector(`#bsFigTabs [data-fig="${k}"]`)?.classList.contains('is-on'), k, { ms: 15000, what: '図を' + k });
   await W.paint(page);
  };
  const tokens = await page.evaluate(() => { const cs = getComputedStyle(document.querySelector('.bs-shell'));
   const hex = v => { const c = document.createElement('canvas').getContext('2d'); c.fillStyle = v; return c.fillStyle; };
   return { al: hex(cs.getPropertyValue('--bs-fig-finger-al').trim()), bk: hex(cs.getPropertyValue('--bs-fig-finger').trim()),
            sp: hex(cs.getPropertyValue('--bs-fig-spacer').trim()) }; });
  rec('⑤ アルミの色は藍の淡色で、ベークライトの茶ともスペーサーの灰とも違う',
      tokens.al === '#b0bae4' && tokens.al !== tokens.bk && tokens.al !== tokens.sp, JSON.stringify(tokens));
  await toFig('2d');
  await W.until(page, () => document.querySelectorAll('.bs-fng').length > 0, null, { ms: 10000, what: '模式図のフィンガー' });
  const fills = await page.evaluate(() => {
   const hex = v => { const c = document.createElement('canvas').getContext('2d'); c.fillStyle = v; return c.fillStyle; };
   return [...new Set([...document.querySelectorAll('.bs-fng')].map(r => hex(r.getAttribute('fill')) + '|' + r.dataset.mat))]; });
  rec('⑤ 模式図: フィンガーはアルミの色で描かれる', fills.length === 1 && fills[0] === tokens.al + '|アルミニウム', fills.join(' / '));
  for (const k of ['cut', '3d']) {
   await toFig(k);
   const ok = await W.until(page, () => !!(WL.bladeSolid && Object.keys(WL.bladeSolid.view().fingers || {}).length), null, { ms: 20000, what: k + 'のフィンガー' });
   const skins = await page.evaluate(() => WL.bladeSolid.view().fingers);
   rec(`⑤ ${k === 'cut' ? '断面図' : '立体図'}: フィンガーはアルミの色の材質だけで組まれる`,
       ok && Object.keys(skins).join() === 'holdffinger-al' && skins['holdffinger-al'] === tokens.al, JSON.stringify(skins));
  }

  rec('コンソールに例外が出ない', errs.length === 0, errs.slice(0, 3).join(' / '));
 } finally {
  if (holdSaved) await post('/api/bladeset/hold-pick', { equipment: EQ, reset: true, user_id: 'test' }).catch(() => {});
  for (const id of madeFingers) await post('/api/bladeset-finger-master/delete', { id }).catch(() => {});
  for (const g of groups) await post('/api/bladeset/blade-sets', { equipment: EQ, group: g, reset: true }).catch(() => {});
  const left = ((await api('/api/bladeset/blade-sets?equipment=' + encodeURIComponent(EQ))).items || []).filter(x => x.stored).length;
  rec('後片付け: 刃セットは初期値へ戻る（登録が残らない）', left === 0, String(left));
 }
}, { mode: 'edit', viewport: { width: 1728, height: 1030 } });
