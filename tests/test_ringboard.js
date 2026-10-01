/* test_ringboard.js: ゴムリングマスタの盤（§9.528 → §9.529 で一覧＋詳細の2ペイン）。

   「ゴムリングの管理は、色ごとに外径内径は共通にして、幅毎に本数を管理できるように…
     色はコードではわかりにくいのでカラーピッカーなど直感的に…今まで登録した色と被らない
     ようにしたいのでそれらの登録状況がわかるもの、色ごとにまとめて表示…もっと使いやすく」（§9.528）
   「①色の被り判定の中に潤滑リングが入っていません。②新規の色を追加する際に色名を付けられません。
     ③マスタが使いにくい。」（§9.529・②の状況は「色名の欄が見つからない」）
   利用者の選択: 刃と同じ「一覧＋詳細の2ペイン」／同じは断る・近いは注意。

   前（実測・VER2.415.0）: 新しい色のカードで色名は**3番目の欄**（種類・色の後）・12px・焦点なし。
   潤滑リングは色コードが空なので**どの色とも被らない**ことになっていた（同じ紫でも通る）。
   固定するのは7つ:
    ① 一覧: 登録済みの色が外径の順に全部・見本の色はマスタの色（潤滑リングは紫）
    ② 詳細: 外径・内径は1回だけ（幅ぜんぶで共通）、幅ごとの本数は欄を離れると保存
    ③ 被り: 同じ外径は断る（保存させない・理由を字で・一覧の見本に印）、近い色は注意（保存できる）
    ④ 新しい色: 色名が**いちばん上の欄で焦点もそこ**・ピッカーの色・外径・幅と本数で登録できる
    ⑤ 直す・幅を足す・色を消す（名前を変えるとその色の行ぜんぶ）
    ⑥ 潤滑リングの紫と同じ色は断る（§9.529 ①）
   後片付けは finally（この網が作った「回帰_」の色を消し、直した本数を戻す）。 */
const H = require('./lib/harness.js');
const W = require('./lib/wait.js');
const B = H.B;
const EQ = 'テスト設備A';
const api = (p, o) => fetch(B + p, o).then(r => r.json());
const post = (p, body) => api(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const colors = () => api('/api/bladeset/ring-colors?equipment=' + encodeURIComponent(EQ)).then(r => r.colors || []);

H.run('test_ringboard: ゴムリングマスタの盤（§9.528）', async ({ page, rec, errs }) => {
 await post('/api/bladeset/seed', { equipment: EQ });
 const before = await colors();
 const first = before[0], w0 = first && first.widths[0];
 try {
  await page.goto(B + '/', { waitUntil: 'domcontentloaded' });
  await W.booted(page);
  await W.until(page, () => !!(window.currentUserId && currentUserId()), null, { ms: 15000, what: '更新者IDが決まる' });
  await page.evaluate(() => WL.mm.openMasterMaint());
  await W.until(page, () => !!document.querySelector('[data-master="bladesetRing"]'), null, { ms: 15000, what: 'ゴムリングのタブ' });
  await page.evaluate(() => document.querySelector('[data-master="bladesetRing"]').click());
  await W.until(page, () => !!document.querySelector('#rbEq'), null, { ms: 10000, what: 'ゴムリングの盤' });
  await page.selectOption('#rbEq', { label: EQ });
  await W.until(page, e => document.querySelector('#rbEq')?.value === e && !!document.querySelector('.rb-card'), EQ, { ms: 10000, what: '設備の盤' });

  /* ---- ① 帯 ---- */
  const strip = await page.evaluate(() => {
   const hex = v => { const c = document.createElement('canvas').getContext('2d'); c.fillStyle = v; return c.fillStyle; };
   return [...document.querySelectorAll('#masterMaintList .bk-item[data-bk-key]')].map(b => ({ c: b.dataset.bkKey,
    sw: hex(getComputedStyle(b.querySelector('.rb-sw')).backgroundColor) }));
  });
  rec('① 一覧: 登録済みの色が全部・外径の順に並ぶ', strip.map(x => x.c).join() === before.map(g => g.color).join(),
      strip.map(x => x.c).join('/'));
  const rub = before.filter(g => !g.lube);
  rec('① 一覧: 見本の色はマスタの色（ゴムリングの色すべて）',
      rub.every(g => (strip.find(x => x.c === g.color) || {}).sw === g.hex.toLowerCase()), JSON.stringify(strip.slice(0, 3)));
  const lube = before.find(g => g.lube);
  rec('§9.529 ① 一覧: 潤滑リングの見本は紫（被り判定と同じ見えている色）',
      !!lube && (strip.find(x => x.c === lube.color) || {}).sw === lube.tone, JSON.stringify(lube && { tone: lube.tone, sw: (strip.find(x => x.c === lube.color) || {}).sw }));

  /* ---- ② カード ---- */
  const card = await page.evaluate(() => ({
   title: document.querySelector('#masterMaintList .bk-card-h [data-k="color"]')?.value, od: document.querySelector('[data-k="od"]')?.value,
   rows: document.querySelectorAll('.rb-card .bk-table tbody tr').length, odInputs: document.querySelectorAll('.rb-card [data-k="od"]').length }));
  rec('② 詳細: 最初の色が開き、外径の欄は1つ（幅ぜんぶで共通）・幅は行で並ぶ',
      card.title === first.color && +card.od === first.od && card.odInputs === 1 && card.rows === first.widths.length, JSON.stringify(card));
  const q = `.rb-card .bk-table tbody tr[data-id="${w0.id}"] .rb-q[data-f="qty"]`;
  await page.fill(q, String((w0.qty || 0) + 7)); await page.press(q, 'Tab');
  const qtyOf = cs => ((cs.find(g => g.color === first.color) || { widths: [] }).widths.find(w => w.id === w0.id) || {});
  const w0b = qtyOf(await W.poll(colors, cs => qtyOf(cs).qty === (w0.qty || 0) + 7, 8000));
  rec('② 本数は欄を離れると保存される（保存ボタンを探させない）', w0b.qty === (w0.qty || 0) + 7, JSON.stringify(w0b));

  /* ---- ③④ 新しい色（被りの確認つき） ---- */
  await page.click('[data-bk-add]');
  await W.until(page, () => !!document.querySelector('.bk-item[data-bk-key="__new"]'), null, { ms: 8000, what: '新しい色の詳細' });
  const head = await page.evaluate(() => {
   const ins = [...document.querySelectorAll('#masterMaintList .bk-detail input, #masterMaintList .bk-detail select')];
   const nm = document.querySelector('#masterMaintList .bk-detail [data-k="color"]');
   return { index: ins.indexOf(nm), focused: document.activeElement === nm, px: nm ? parseFloat(getComputedStyle(nm).fontSize) : 0 };
  });
  rec('§9.529 ② 新しい色は色名がいちばん上の欄・焦点もそこ・見出しの大きさ（前は3番目・焦点なし・12px）',
      head.index === 0 && head.focused && head.px >= 18, JSON.stringify(head));
  await page.keyboard.type('回帰_あ');
  rec('§9.529 ② 打った色名は一覧の仮の項目にもその場で映る（焦点は欄のまま）',
      await page.evaluate(() => document.querySelector('.bk-item[data-bk-key="__new"] b')?.textContent === '回帰_あ'
        && document.activeElement?.dataset.k === 'color'));
  const setv0 = (k, v) => page.evaluate(([k, v]) => { const el = document.querySelector(`.rb-card [data-k="${k}"]`);
   el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, [k, v]);
  await setv0('od', '299'); await setv0('hex', (lube && lube.tone) || '#7150c4');
  await W.until(page, () => /「潤滑」と同じ色/.test(document.querySelector('.rb-hard')?.textContent || ''), null, { ms: 8000, what: '潤滑リングと同じ色で断る' });
  const lh = await page.evaluate(() => ({ dis: document.querySelector('[data-act="create"]').disabled,
   mark: [...document.querySelectorAll('.bk-item.is-hard')].map(b => b.dataset.bkKey) }));
  rec('§9.529 ① 潤滑リングの紫と同じ色は断る（登録ボタンを止め、一覧の潤滑リングに印）', lh.dis && lh.mark.join() === '潤滑', JSON.stringify(lh));
  const setv = (k, v) => page.evaluate(([k, v]) => { const el = document.querySelector(`.rb-card [data-k="${k}"]`);
   el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, [k, v]);
  await setv('color', '回帰_紫'); await setv('hex', '#7b3fb0'); await setv('od', String(first.od));
  await W.until(page, () => !!document.querySelector('.rb-hard'), null, { ms: 8000, what: '同じ外径で断る' });
  const hard = await page.evaluate(() => ({ t: document.querySelector('.rb-hard').textContent,
   dis: document.querySelector('[data-act="create"]').disabled,
   mark: [...document.querySelectorAll('.bk-item.is-hard')].map(b => b.dataset.bkKey) }));
  rec('③ 同じ外径は断る: 理由を字で・登録ボタンを止め・一覧の見本に印',
      new RegExp(`「${first.color}」と同じ外径`).test(hard.t) && hard.dis && hard.mark.join() === first.color, JSON.stringify(hard));
  await setv('od', '311.5'); await setv('hex', first.hex.replace(/^#(..)/, (m, r) => '#' + ((parseInt(r, 16) + 6) % 256).toString(16).padStart(2, '0')));
  await W.until(page, () => !!document.querySelector('.rb-near') && !document.querySelector('.rb-hard'), null, { ms: 8000, what: '近い色の注意' });
  const near = await page.evaluate(() => ({ t: document.querySelector('.rb-near').textContent,
   dis: document.querySelector('[data-act="create"]').disabled,
   mark: [...document.querySelectorAll('.bk-item.is-near')].map(b => b.dataset.bkKey) }));
  rec('③ 近い色は注意（どの色に近いかと色差）・登録はできる',
      new RegExp(first.color).test(near.t) && /色差/.test(near.t) && !near.dis && near.mark.includes(first.color), JSON.stringify(near));
  await setv('hex', '#7b3fb0');
  await W.until(page, () => !!document.querySelector('.rb-ok'), null, { ms: 8000, what: '被りなし' });
  const nw = await page.evaluate(() => document.querySelectorAll('.rb-card [data-nw][data-f="qty"]').length);
  await page.evaluate(() => document.querySelectorAll('.rb-card [data-nw][data-f="qty"]').forEach((el, i) => {
   el.value = String(i + 1); el.dispatchEvent(new Event('input', { bubbles: true })); }));
  await page.click('[data-act="create"]');
  await W.until(page, () => document.querySelector('#masterMaintList .bk-card-h [data-k="color"]')?.value === '回帰_紫'
   && !document.querySelector('.bk-item[data-bk-key="__new"]'), null, { ms: 10000, what: '登録して開く' });
  const made = (await colors()).find(g => g.color === '回帰_紫');
  rec('④ 新しい色はピッカーの色・外径・幅と本数で登録される（幅は既存の顔ぶれで最初から並ぶ）',
      !!made && made.hex === '#7b3fb0' && made.od === 311.5 && made.widths.length === nw && nw > 0
      && made.total === nw * (nw + 1) / 2, JSON.stringify(made));

  /* ---- ⑤ 直す・幅を足す・消す ---- */
  await setv('color', '回帰_紺'); await setv('od', '311');
  await W.until(page, () => !document.querySelector('[data-act="save"]')?.disabled, null, { ms: 8000, what: '保存ボタンが押せる' });
  await page.click('[data-act="save"]');
  await W.until(page, () => !!document.querySelector('.bk-item.is-on[data-bk-key="回帰_紺"]'), null, { ms: 10000, what: '直して開き直す' });
  const renamed = (await colors()).find(g => g.color === '回帰_紺');
  rec('⑤ 名前・外径を直すと、その色の幅ぜんぶが変わる', !!renamed && renamed.widths.length === nw && renamed.od === 311, JSON.stringify(renamed));
  await page.fill('#rbNewW', '25'); await page.fill('#rbNewQ', '3');
  await page.click('[data-act="addwidth"]');
  await W.until(page, () => /25/.test(document.querySelector('.rb-card .bk-table tbody')?.textContent || ''), null, { ms: 10000, what: '幅が増える' });
  const added = ((await colors()).find(g => g.color === '回帰_紺') || { widths: [] }).widths.find(w => w.width === 25);
  rec('⑤ 幅を足すと、色の外径・内径を引き継いだ1行になる', !!added && added.qty === 3, JSON.stringify(added));
  await page.click('[data-act="delcolor"]');
  await page.waitForSelector('#appConfirmModal:not([hidden])', { timeout: 5000 });
  await page.click('#appConfirmOk');
  await W.until(page, () => !document.querySelector('.bk-item[data-bk-key="回帰_紺"]'), null, { ms: 10000, what: '色が消える' });
  rec('⑤ 色を消すと、その色の行がぜんぶ消える', !(await colors()).some(g => g.color === '回帰_紺'));
  rec('コンソールに例外が出ない', errs.length === 0, errs.slice(0, 3).join(' / '));
 } finally {
  for (const g of (await colors()).filter(x => /^回帰_/.test(x.color))) {
   await post('/api/bladeset/ring-colors', { equipment: EQ, current: g.color, delete: true, user_id: 'test' }).catch(() => {});
  }
  if (w0) await post('/api/bladeset-ring-master/update', { id: w0.id, qty: w0.qty || 0, user_id: 'test' }).catch(() => {});
  const left = (await colors()).filter(x => /^回帰_/.test(x.color)).length;
  rec('後片付け: この網が作った色は残らない', left === 0, String(left));
 }
}, { mode: 'edit', viewport: { width: 1728, height: 1030 } });
