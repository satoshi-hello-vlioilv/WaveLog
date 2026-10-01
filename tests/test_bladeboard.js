/* test_bladeboard.js: 刃マスタの盤（§9.529、利用者の指示）。

   「刃マスタについて ①名称をキーには使わない ②選択する内容、設備、刃の厚さ、セット名(アルファベット
     から選択)、というキーは3つで管理してください。③マスタが使いにくい。カテゴリや使用状態がマスタの
     モーダルから取り扱いできないので使いやすく再構築してください。」
   利用者の選択: ゴムリングと同じ「一覧＋詳細の2ペイン」。

   前（実測・VER2.415.0）: 1行＝名称が鍵の汎用の表（名称は必須・同じセット＋刃厚の2行目を断らない・
   セット名は自由な字）。カテゴリ・使用状態は別タブ「刃セット」でしか切り替えられなかった（刃のタブの札0）。
   固定するのは5つ:
    ① 一覧: セットが A→Z で並び、カテゴリ・研磨中を札で、刃厚と枚数を2行目で言う
    ② 詳細: カテゴリ・使用状態の2択がこの盤にある（押すとすぐ保存）・名称の欄は無い
    ③ 刃厚の行: 欄を離れるとすぐ保存し、焦点は次の欄のまま。同じ刃厚は足せない（理由を言う）
    ④ 新しいセット: 空いている字（A〜Z）から選び、登録済みの刃厚の顔ぶれで行が並ぶ
    ⑤ セット名を変える・セットを消す
   後片付けは finally（この網が作ったセットを消し、直した値を戻す）。 */
const H = require('./lib/harness.js');
const W = require('./lib/wait.js');
const B = H.B;
const EQ = 'テスト設備A';
const api = (p, o) => fetch(B + p, o).then(r => r.json());
const post = (p, body) => api(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const sets = () => api('/api/bladeset/blade-sets?equipment=' + encodeURIComponent(EQ)).then(r => r.items || []);

H.run('test_bladeboard: 刃マスタの盤（§9.529）', async ({ page, rec, errs }) => {
 await post('/api/bladeset/seed', { equipment: EQ });
 const before = await sets();
 const first = before[0], r0 = first && first.rows[0];
 const made = [];
 try {
  await page.goto(B + '/', { waitUntil: 'domcontentloaded' });
  await W.booted(page);
  await W.until(page, () => !!(window.currentUserId && currentUserId()), null, { ms: 15000, what: '更新者IDが決まる' });
  await page.evaluate(() => WL.mm.openMasterMaint());
  await W.until(page, () => !!document.querySelector('[data-master="bladesetBlade"]'), null, { ms: 15000, what: '刃のタブ' });
  await page.evaluate(() => document.querySelector('[data-master="bladesetBlade"]').click());
  await W.until(page, () => !!document.querySelector('#bbEq'), null, { ms: 10000, what: '刃の盤' });
  await page.selectOption('#bbEq', { label: EQ });
  await W.until(page, e => document.querySelector('#bbEq')?.value === e && !!document.querySelector('.bk-card'), EQ, { ms: 10000, what: '設備の盤' });

  /* ---- ① 一覧 ---- */
  const list = await page.evaluate(() => [...document.querySelectorAll('#masterMaintList .bk-item[data-bk-key]')].map(b => ({
   k: b.dataset.bkKey, sub: b.querySelector('small')?.textContent || '', tags: [...b.querySelectorAll('.bk-tag')].map(t => t.textContent).join('/') })));
  rec('① 一覧: セットが A→Z で全部並ぶ', list.map(x => x.k).join() === before.map(x => x.group).join(), JSON.stringify(list.map(x => x.k)));
  rec('① 一覧: 2行目が刃厚と枚数、札がカテゴリ',
      list.length > 0 && list[0].sub === `${first.thicknesses.join('・')} mm／${first.total}枚` && list[0].tags.startsWith(first.category), JSON.stringify(list[0]));

  /* ---- ② 詳細 ---- */
  const card = await page.evaluate(() => ({ title: document.querySelector('.bk-card-t h3')?.textContent,
   segs: [...document.querySelectorAll('.bk-card .bk-seg')].map(s => s.getAttribute('aria-label')),
   name: !!document.querySelector('#masterMaintList [data-f="name"],#masterMaintList [data-k="name"]'),
   rows: [...document.querySelectorAll('.bk-card .bk-table tbody tr')].map(tr => tr.querySelector('th').textContent) }));
  rec('② 詳細: カテゴリ・使用状態の2択がこの盤にある（前は刃のタブに0）', card.segs.join('/') === 'カテゴリ/使用状態', JSON.stringify(card));
  rec('② 詳細: 名称の欄は無い（呼び名はセット＋刃厚）・刃厚ごとに1行', !card.name && card.rows.length === first.rows.length, JSON.stringify(card));

  /* ---- ③ 刃厚の行 ---- */
  const dia = `.bk-card .bk-table tbody tr[data-id="${r0.id}"] [data-f="currentDia"]`;
  const qty = `.bk-card .bk-table tbody tr[data-id="${r0.id}"] [data-f="qty"]`;
  await page.fill(dia, String((r0.currentDia || 300) - 0.5));
  await page.press(dia, 'Tab');
  const rowOf = cs => ((cs.find(x => x.group === first.group) || { rows: [] }).rows.find(r => r.id === r0.id) || {});
  const got = rowOf(await W.poll(sets, cs => rowOf(cs).currentDia === (r0.currentDia || 300) - 0.5, 8000));
  rec('③ 欄を離れるとすぐ保存される（保存ボタンを探させない）', got.currentDia === (r0.currentDia || 300) - 0.5, JSON.stringify(got));
  await W.until(page, q => document.activeElement === document.querySelector(q), qty, { ms: 5000, what: '焦点は次の欄' }).catch(() => {});
  rec('③ 保存して描き直しても焦点は Tab で移った次の欄（保有枚数）のまま',
      await page.evaluate(q => document.activeElement === document.querySelector(q), qty));
  await page.fill('#bbNewT', String(r0.thickness)); await page.fill('#bbNewQ', '1');
  await page.click('[data-act="addrow"]');
  await page.waitForSelector('#appConfirmModal:not([hidden])', { timeout: 5000 });
  const dup = await page.evaluate(() => document.getElementById('appConfirmModal').textContent);
  rec('③ 同じセットの同じ刃厚は足せない（理由を言う）', new RegExp(`セット ${first.group} の刃厚 ${r0.thickness}mm はもう登録`).test(dup), dup.slice(0, 120));
  await page.click('#closeAppConfirm');

  /* ---- ④ 新しいセット ---- */
  await page.click('[data-bk-add]');
  await W.until(page, () => !!document.querySelector('.bk-card.is-new'), null, { ms: 8000, what: '新しいセットの詳細' });
  const nw = await page.evaluate(() => ({ opts: [...document.querySelector('[data-nk="group"]').options].map(o => o.value),
   rows: [...document.querySelectorAll('.bk-card.is-new [data-f="thickness"]')].map(i => +i.value) }));
  const used = before.map(x => x.group);
  rec('④ セット名は空いている字（A〜Z）から選ぶ（使っている字は出さない）',
      nw.opts.length === 26 - used.length && !nw.opts.some(o => used.includes(o)) && nw.opts.every(o => /^[A-Z]$/.test(o)), nw.opts.join(''));
  const ths = [...new Set(before.flatMap(x => x.thicknesses))].sort((a, b) => b - a);
  rec('④ 行は登録済みの刃厚の顔ぶれで最初から並ぶ（思い出させない）', nw.rows.join() === ths.join(), JSON.stringify(nw.rows));
  const g = nw.opts[nw.opts.length - 1];
  await page.selectOption('[data-nk="group"]', g);
  await W.until(page, g => document.querySelector('.bk-card.is-new [data-act="create"]')?.textContent.includes(g), g, { ms: 5000, what: '字を選ぶ' });
  await page.click(`.bk-card.is-new .bk-opt[data-seg="category"][data-v="専用刃"]`);
  await page.evaluate(() => document.querySelectorAll('.bk-card.is-new [data-f="qty"]').forEach((el, i) => {
   el.value = String(i + 2); el.dispatchEvent(new Event('input', { bubbles: true })); }));
  await page.click('.bk-card.is-new [data-act="create"]');
  made.push(g);
  await W.until(page, g => !!document.querySelector(`.bk-item.is-on[data-bk-key="${g}"]`), g, { ms: 10000, what: '登録して開く' });
  const s4 = (await sets()).find(x => x.group === g);
  rec('④ 新しいセットはカテゴリと刃厚ごとの枚数で登録される',
      !!s4 && s4.category === '専用刃' && s4.rows.length === ths.length && s4.total === ths.reduce((a, _t, i) => a + i + 2, 0), JSON.stringify(s4 && { c: s4.category, n: s4.rows.length, t: s4.total }));

  /* ---- ⑤ 字を変える・消す ---- */
  const g2 = nw.opts[nw.opts.length - 2];
  await page.selectOption('[data-rename]', g2);
  made.push(g2);
  await W.until(page, g => !!document.querySelector(`.bk-item.is-on[data-bk-key="${g}"]`), g2, { ms: 10000, what: '字を変える' });
  const s5 = await sets();
  rec('⑤ セット名を変えると刃の行ぜんぶが新しい字へ（前の字は残らない）',
      !s5.some(x => x.group === g) && (s5.find(x => x.group === g2) || { rows: [] }).rows.length === ths.length, s5.map(x => x.group).join());
  await page.click('[data-act="delset"]');
  await page.waitForSelector('#appConfirmModal:not([hidden])', { timeout: 5000 });
  await page.click('#appConfirmOk');
  await W.until(page, g => !document.querySelector(`.bk-item[data-bk-key="${g}"]`), g2, { ms: 10000, what: 'セットが消える' });
  rec('⑤ セットを消すと刃の行ぜんぶが消える', !(await sets()).some(x => x.group === g2));
  rec('コンソールに例外が出ない', errs.length === 0, errs.slice(0, 3).join(' / '));
 } finally {
  for (const g of made) {
   if ((await sets()).some(x => x.group === g)) await post('/api/bladeset/blade-sets', { equipment: EQ, group: g, delete: true, user_id: 'test' }).catch(() => {});
  }
  if (r0) await post('/api/bladeset-blade-master/update', { id: r0.id, currentDia: r0.currentDia, qty: r0.qty, user_id: 'test' }).catch(() => {});
  const now = await sets();
  rec('後片付け: この網が作ったセットは残らず、直した径は元へ戻る',
      now.map(x => x.group).join() === before.map(x => x.group).join()
      && ((now[0] || { rows: [] }).rows.find(r => r.id === (r0 || {}).id) || {}).currentDia === (r0 || {}).currentDia, now.map(x => x.group).join());
 }
}, { mode: 'edit', viewport: { width: 1728, height: 1030 } });
