/* test_bladesets.js: 刃セット・刃選択の4項目・フィンガー材質（§9.526、利用者の指示）。

   「１）刃のセットの使用状態を切り替えられるようにしてください。使用中、研磨中
     ２）カテゴリを追加して通常刃、専用刃の選択も追加してください。
     ３）刃の選択マスタは、板押さえ方式と板厚と材質と調質から選べるようにしてください。
     ４）フィンガーは名称入力欄は不要、その代わりにフィンガー材質というカテゴリを追加し、
        ベークライトとアルミニウムを登録して、既定はベークライトにしてください。」
   利用者の選択: 使用状態・カテゴリは**セット（組）ごと**／刃選択の条件は**4項目に絞る**（前の決まりは効かせる）。

   前（実測）: ① セットの切り替え口なし（刃1枚ずつの「状態」3値に混ざっていた）・② 同じ・
   ③ 選べる項目7つ（板押さえ方式・調質は0）・④ 名称が必須で材質の欄なし。
   固定するのは4つ:
    ① 盤: 組ごとに札を押すと**その場で保存**され、研磨中の行は「選ばれない」と字で言う
    ② ガイダンスの選び方: 通常刃・使用中が既定／研磨中は選ばない／専用刃は決まりに当たったときだけ・
       当たっても使えなければ通常刃へ落として理由を持つ
    ③ 刃選択の盤: 項目は4つ・板押さえ方式は候補から選ぶ・前の項目の決まりも読める
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
 const madePicks = [];
 await post('/api/bladeset/seed', { equipment: EQ });
 try {
  groups = ((await api('/api/bladeset/blade-sets?equipment=' + encodeURIComponent(EQ))).items || []).map(x => x.group);
  rec('刃セットは刃の組から作られる（初期セットで2組以上）', groups.length >= 2, groups.join('/'));
  for (const g of groups) await post('/api/bladeset/blade-sets', { equipment: EQ, group: g, reset: true });

  await page.goto(B + '/', { waitUntil: 'domcontentloaded' });
  await W.booted(page);
  await W.until(page, () => !!(window.currentUserId && currentUserId()), null, { ms: 15000, what: '更新者IDが決まる' });

  /* ---- ① 盤 ---- */
  await page.evaluate(() => WL.mm.openMasterMaint());
  await W.until(page, () => !!document.querySelector('[data-master="bladesetSets"]'), null, { ms: 15000, what: '刃セットのタブ' });
  await page.evaluate(() => document.querySelector('[data-master="bladesetSets"]').click());
  await W.until(page, () => !!document.querySelector('#bssEq'), null, { ms: 10000, what: '刃セットの盤' });
  await page.selectOption('#bssEq', { label: EQ });
  await W.until(page, e => document.querySelector('#bssEq')?.value === e && !!document.querySelector('.bss-table'), EQ, { ms: 10000, what: '設備の刃セット' });
  const g0 = groups[0];
  const rowOf = g => page.evaluate(g => {
   const tr = [...document.querySelectorAll('.bss-row')].find(r => r.querySelector('.bss-group')?.textContent === g);
   if (!tr) return null;
   const on = k => tr.querySelector(`.bss-opt.is-on[data-k="${k}"]`)?.textContent || '';
   return { cat: on('category'), use: on('use'), say: tr.querySelector('.bss-say')?.textContent || '', grind: tr.classList.contains('is-grind') };
  }, g);
  const r0 = await rowOf(g0);
  rec('① 未登録の組は通常刃・使用中で、「ふつうはこれが選ばれます」と言う',
      !!r0 && r0.cat === '通常刃' && r0.use === '使用中' && /ふつうはこれ/.test(r0.say) && /未登録/.test(r0.say), JSON.stringify(r0));
  const sel = (g, k, v) => `.bss-opt[data-g="${g}"][data-k="${k}"][data-v="${v}"]`;
  await page.click(sel(g0, 'use', '研磨中'));
  await W.until(page, g => /研磨中/.test([...document.querySelectorAll('.bss-row')].find(r => r.querySelector('.bss-group')?.textContent === g)
    ?.querySelector('.bss-opt.is-on[data-k="use"]')?.textContent || ''), g0, { ms: 8000, what: '研磨中へ' });
  const s1 = (await api('/api/bladeset/blade-sets?equipment=' + encodeURIComponent(EQ))).items.find(x => x.group === g0);
  const r1 = await rowOf(g0);
  rec('① 札を押すとその場で保存される（保存ボタンを持たない）', s1 && s1.use === '研磨中' && s1.stored === true, JSON.stringify(s1));
  rec('① 研磨中の行は「刃組ガイダンスで選ばれません」と字で言う', r1.grind && /選ばれません/.test(r1.say), JSON.stringify(r1));
  await page.click(sel(g0, 'category', '専用刃'));
  await W.until(page, g => /専用刃/.test([...document.querySelectorAll('.bss-row')].find(r => r.querySelector('.bss-group')?.textContent === g)
    ?.querySelector('.bss-opt.is-on[data-k="category"]')?.textContent || ''), g0, { ms: 8000, what: '専用刃へ' });
  const s2 = (await api('/api/bladeset/blade-sets?equipment=' + encodeURIComponent(EQ))).items.find(x => x.group === g0);
  rec('① カテゴリを変えても使用状態は残る（送った項目だけ書く）', s2 && s2.category === '専用刃' && s2.use === '研磨中', JSON.stringify(s2));

  /* ---- ② ガイダンスの選び方（刃組の計算そのもの） ---- */
  const pick = await page.evaluate(async EQ => {
   const Bs = WL.bladeSet;
   const M = Bs.normalize(await api('/api/bladeset/context?equipment=' + encodeURIComponent(EQ)));
   const blade = (group, tk, category, use) => ({ name: group + tk, group, thickness: tk, currentDia: 300, qty: 1, category, use });
   const run = (blades, picks) => {
    const st = Object.assign(Bs.defaultState(), { thick: 1.2, lots: [{ name: 'L', w: 50, n: 22, parent: 'L' }], order: [] });
    Bs.syncOrder(st);
    Bs.applyBladePick(st, Object.assign({}, M, { blades, picks: picks || [], holds: [], holdsStored: false }));
    return { tk: st.tk, pick: st.pick };
   };
   const rule = [{ conditions: [{ field: 'thickness', op: 'ge', value: '1.0' }], group: 'S', name: '厚い', enabled: true }];
   return {
    fromCtx: M.blades.every(b => !!b.category && !!b.use),
    normal: run([blade('N', 10, '通常刃', '使用中'), blade('S', 15, '専用刃', '使用中')]).tk,
    grindSkip: run([blade('N', 10, '通常刃', '研磨中'), blade('M', 12, '通常刃', '使用中')]).tk,
    special: run([blade('N', 10, '通常刃', '使用中'), blade('S', 15, '専用刃', '使用中')], rule),
    specialGrind: run([blade('N', 10, '通常刃', '使用中'), blade('S', 15, '専用刃', '研磨中')], rule),
    holdRule: run([blade('N', 10, '通常刃', '使用中'), blade('S', 15, '専用刃', '使用中')],
                  [{ conditions: [{ field: 'hold', op: 'eq', value: 'ゴムリング' }], group: 'S', name: 'ゴム', enabled: true }]).tk,
    legacy: run([blade('N', 10, '通常刃', '使用中'), blade('S', 15, '専用刃', '使用中')],
                [{ conditions: [{ field: 'strips', op: 'ge', value: '20' }], group: 'S', name: '条数', enabled: true }]).tk
   };
  }, EQ);
  rec('② 刃の行はサーバーからセットのカテゴリ・使用状態を名乗って届く', pick.fromCtx === true);
  rec('② 決まりに当たらなければ通常刃・使用中のセット', pick.normal === 10, String(pick.normal));
  rec('② 研磨中のセットは選ばない（使用中の通常刃へ）', pick.grindSkip === 12, String(pick.grindSkip));
  rec('② 決まりに当たれば、その組の専用刃', pick.special.tk === 15 && pick.special.pick && !pick.special.pick.missing, JSON.stringify(pick.special));
  rec('② 当たっても専用刃が研磨中なら通常刃で描き、理由（missing）を持つ',
      pick.specialGrind.tk === 10 && pick.specialGrind.pick && pick.specialGrind.pick.missing === true, JSON.stringify(pick.specialGrind));
  rec('② 板押さえ方式の条件が当たる（1.2mm＝ゴムリング）', pick.holdRule === 15, String(pick.holdRule));
  rec('② 前の項目（条数）で書いた決まりも効く', pick.legacy === 15, String(pick.legacy));

  /* ---- ③ 刃選択の盤 ---- */
  const legacy = await post('/api/bladeset/blade-pick', { equipment: EQ, name: '前の条数の決まり', group: g0, user_id: 'test',
    conditions: [{ field: 'strips', op: 'ge', value: '20' }] });
  if (legacy && legacy.id) madePicks.push(legacy.id);
  await page.evaluate(() => document.querySelector('[data-master="bladesetPick"]')?.click());
  await W.until(page, () => !!document.querySelector('#bpEq'), null, { ms: 10000, what: '刃選択の盤' });
  await page.selectOption('#bpEq', { label: EQ });
  await W.until(page, () => !!document.querySelector('.bp-card'), null, { ms: 10000, what: '決まりのカード' });
  const probe = await page.evaluate(() => ({
   labels: [...document.querySelectorAll('.bp-pf s')].map(s => s.textContent),
   hold: [...(document.querySelector('select[data-p="hold"]')?.options || [])].map(o => o.textContent),
   card: document.querySelector('.bp-card')?.textContent.replace(/\s+/g, ' ') || '' }));
  rec('③ 試す欄の項目は板押さえ方式・板厚・材質・調質の4つ', probe.labels.join('/') === '板押さえ方式/板厚/材質/調質', probe.labels.join('/'));
  rec('③ 板押さえ方式は候補から選ぶ（フィンガー・ゴムリング）', /フィンガー/.test(probe.hold.join()) && /ゴムリング/.test(probe.hold.join()), probe.hold.join('/'));
  rec('③ 前の項目（条数）の決まりも名前つきで読める', /条数/.test(probe.card) && /専用刃/.test(probe.card), probe.card.slice(0, 80));
  await page.click('.bp-card [data-act="edit"]');
  await W.until(page, () => !!document.querySelector('.bp-row .bp-f'), null, { ms: 8000, what: '直す窓' });
  const ed1 = await page.evaluate(() => [...document.querySelector('.bp-row .bp-f').options].map(o => o.textContent));
  rec('③ 直す窓: 選べる項目は4つ＋その条件の前の項目（消さない）',
      ed1.length === 5 && ed1.some(t => /条数（前の項目）/.test(t)), ed1.join('/'));
  await page.selectOption('.bp-row .bp-f', 'hold');
  await W.until(page, () => document.querySelector('.bp-row .bp-v')?.tagName === 'SELECT', null, { ms: 8000, what: '値の欄が選択になる' });
  await page.selectOption('.bp-row .bp-v', 'ゴムリング');
  await page.click('[data-act="save"]');
  await W.until(page, () => WL.bladePick.state.editing === null, null, { ms: 10000, what: '保存して閉じる' });
  const savedPick = ((await api('/api/bladeset/blade-pick?equipment=' + encodeURIComponent(EQ))).items || []).find(x => x.id === legacy.id);
  rec('③ 板押さえ方式の条件で保存できる（比べ方は＝へ寄せる・前の「≧」は候補の項目では当たらない）',
      !!savedPick && JSON.stringify(savedPick.conditions) === JSON.stringify([{ field: 'hold', op: 'eq', value: 'ゴムリング' }]),
      JSON.stringify(savedPick && savedPick.conditions));
  const opsNow = await page.evaluate(() => { document.querySelector('.bp-card [data-act="edit"]').click();
   return [...(document.querySelector('.bp-row .bp-o')?.options || [])].map(o => o.value); });
  rec('③ 候補から選ぶ項目の比べ方は「＝」「≠」だけ', opsNow.join('/') === 'eq/ne', opsNow.join('/'));
  await page.click('[data-act="cancel"]');

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
  rec('コンソールに例外が出ない', errs.length === 0, errs.slice(0, 3).join(' / '));
 } finally {
  for (const id of madePicks) await post('/api/bladeset/blade-pick/delete', { id }).catch(() => {});
  for (const g of groups) await post('/api/bladeset/blade-sets', { equipment: EQ, group: g, reset: true }).catch(() => {});
  const left = ((await api('/api/bladeset/blade-sets?equipment=' + encodeURIComponent(EQ))).items || []).filter(x => x.stored).length;
  rec('後片付け: 刃セットは初期値へ戻る（登録が残らない）', left === 0, String(left));
 }
}, { mode: 'edit', viewport: { width: 1728, height: 1030 } });
