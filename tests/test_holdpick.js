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
    ⑥ 行と列を後から並べ替えられる（掴む札・キー）・列の並びは保存する（§9.530）

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
   /* 刃選択の表（§9.529 で2つの判定表）。材質の条件で専用刃に当たるか。 */
   const M3 = Object.assign({}, M, { pickTables: { category: { stored: true, rows: [
    { conditions: [{ field: 'material', op: 'eq', value: 'SUS304' }], answer: '専用刃', group: 'X' },
    { conditions: [], answer: '通常刃', group: '' }] } } });
   out.material = Bs.bladeChoice(st3, M3).category === '専用刃';
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
  await W.until(page, () => !!document.querySelector('.rt-table'), null, { ms: 10000, what: '判定表' });
  await page.selectOption('#hpEq', { label: EQ });
  await W.until(page, e => document.querySelector('#hpEq')?.value === e && !!document.querySelector('.rt-table'), EQ, { ms: 10000, what: '設備の判定表' });
  const shape = () => page.evaluate(() => ({
   state: document.querySelector('#masterMaintList .rt-state')?.textContent || '',
   rows: [...document.querySelectorAll('.rt-table tbody tr')].map(tr => [...tr.querySelectorAll('input.rt-c')].map(i => i.value).join(',')
     /* 答えの列は「方式（材質）」の1つの選択（§9.527）。値（方式|材質）でなく選ばれている札の字で見る。 */
     + '→' + (tr.querySelector('.rt-ansel')?.selectedOptions[0]?.textContent || '') + (tr.classList.contains('is-won') ? '★' : '')).join(' / '),
   ans: document.querySelector('.rt-ans')?.textContent.trim() || '' }));
  const s0 = await shape();
  rec('④ 未登録の設備は、切替板厚から作った表と「未登録」を出す', /未登録/.test(s0.state) && s0.rows === '＜ 0.6→フィンガー（ベークライト） / →ゴムリング', JSON.stringify(s0));
  await page.selectOption('.rt-addcol', 'strips');
  await W.until(page, () => /条数/.test(document.querySelector('.rt-table thead')?.textContent || ''), null, { ms: 4000, what: '条数の列' });
  await page.click('[data-rt="addrow"]');
  await W.until(page, () => document.querySelectorAll('.rt-table tbody tr').length === 3, null, { ms: 4000, what: '決まりの行が増える' });
  const cell = f => `.rt-table tbody tr:nth-child(2) .rt-c[data-f="${f}"]`;
  await page.fill(cell('strips'), '>= 20'); await page.press(cell('strips'), 'Tab');
  await W.until(page, () => /≧ 20/.test([...document.querySelectorAll('.rt-c')].map(i => i.value).join('|')), null, { ms: 4000, what: 'セルが読まれる' });
  await page.fill(cell('thickness'), 'abc'); await page.press(cell('thickness'), 'Tab');
  await W.until(page, () => !!document.querySelector('.rt-c.is-bad'), null, { ms: 4000, what: '読めないセル' });
  await page.fill('.rt-try .rt-p[data-p="strips"]', '22');
  await W.until(page, () => /2行目/.test(document.querySelector('.rt-ans')?.textContent || ''), null, { ms: 4000, what: '試す行の答え' });
  const bad = await page.evaluate(() => { const e = document.querySelector('.rt-c.is-bad'); return e ? `${e.value}｜${e.title}` : ''; });
  rec('④ 読めない字は理由を出して、描き直しても残す', /^abc｜.+/.test(bad), bad);
  const s1 = await shape();
  rec('④ 試す行に値を入れると当たる行が光り、答えと行番号を言う',
      /≧ 20→フィンガー（ベークライト）★/.test(s1.rows) && /フィンガー（ベークライト）（2行目に当たる）/.test(s1.ans), JSON.stringify(s1));
  await page.click('[data-rt="save"]');
  await page.waitForSelector('#appConfirmModal:not([hidden])', { timeout: 5000 });
  const refused = await page.evaluate(() => document.getElementById('appConfirmModal').textContent);
  rec('④ 読めないセルがあるうちは保存させない（理由を言う）', /読めないセル/.test(refused), refused.slice(0, 80));
  await page.click('#closeAppConfirm');
  await page.fill(cell('thickness'), ''); await page.press(cell('thickness'), 'Tab');
  await W.until(page, () => !document.querySelector('.rt-c.is-bad'), null, { ms: 4000, what: '直す' });
  await page.click('[data-rt="save"]');
  await W.until(page, () => /登録済み/.test(document.querySelector('#masterMaintList .rt-state')?.textContent || ''), null, { ms: 10000, what: '保存' });
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
  await W.until(page, () => !!document.querySelector('[data-rt="reset"]'), null, { ms: 10000, what: '未登録に戻すのボタン' });
  await page.click('[data-rt="reset"]');
  await page.waitForSelector('#appConfirmModal:not([hidden])', { timeout: 5000 });
  await page.click('#appConfirmOk');
  await W.until(page, () => /未登録/.test(document.querySelector('#masterMaintList .rt-state')?.textContent || ''), null, { ms: 10000, what: '未登録へ戻る' });
  const s2 = await shape();
  rec('④ 「未登録に戻す」で行が消え、切替板厚の種へ戻る', s2.rows.replace(/★/g, '') === '＜ 0.6→フィンガー（ベークライト） / →ゴムリング', JSON.stringify(s2));
  /* 消えた列（条数）の試しの値が裏で効かない——板厚だけの表で、試す行は空なので答えは出さない。 */
  rec('④ 表に無い列の試しの値は効かない（消えた条数の22で当てない）', !/★/.test(s2.rows) && /値を入れると/.test(s2.ans), JSON.stringify(s2));
  /* ---- ⑥ 行と列の並べ替え（§9.530、利用者の指示「条件テーブルの部分は行や列の並び替えが後からできるように」） ----
     前（実測）: 列は並べ替えられない（掴む物0）・行は▲▼で1段ずつ（最後を先頭へ3手）・列の並びは
     条件の出てくる順から起こすので、保存→開き直しで「板厚/条数」が「条数/板厚」へ入れ替わっていた。 */
  await post('/api/bladeset/hold-pick', { equipment: EQ, user_id: 'test', cols: ['thickness', 'strips'], rows: [
   { conditions: [{ field: 'strips', op: 'ge', value: '20' }], hold: 'フィンガー', note: 'R1' },
   { conditions: [{ field: 'thickness', op: 'lt', value: '0.4' }], hold: 'フィンガー', note: 'R2' },
   { conditions: [{ field: 'thickness', op: 'lt', value: '0.5' }], hold: 'フィンガー', note: 'R3' },
   { conditions: [], hold: 'ゴムリング' }] });
  await page.evaluate(() => WL.holdPick.load(true));
  await W.until(page, () => document.querySelectorAll('.rt-table tbody .rt-row').length === 4, null, { ms: 10000, what: '並べ替えの表' });
  const order = () => page.evaluate(() => ({
   rows: [...document.querySelectorAll('.rt-table tbody .rt-n')].map(i => i.value).filter(Boolean).join(','),
   cols: [...document.querySelectorAll('.rt-table .rt-col b')].map(b => b.textContent).join('/'),
   dirty: /保存していない/.test(document.querySelector('.rt-state')?.textContent || '') }));
  const o0 = await order();
  rec('⑥ 列の並びは保存した並び（板厚/条数）で開く——1行目に無い列も後ろへ回らない', o0.cols === '板厚/条数' && o0.rows === 'R1,R2,R3', JSON.stringify(o0));
  await page.dragAndDrop('.rt-row[data-r="2"] .rt-grip', '.rt-row[data-r="0"] .rt-no', { targetPosition: { x: 4, y: 2 } });
  await W.until(page, () => [...document.querySelectorAll('.rt-table tbody .rt-n')].map(i => i.value).filter(Boolean).join(',') === 'R3,R1,R2', null, { ms: 5000, what: '行を運ぶ' }).catch(() => {});
  const o1 = await order();
  rec('⑥ 行は番号の横の札を掴んで運べる（最後の決まりを先頭へ1手・前は▲を3回）', o1.rows === 'R3,R1,R2' && o1.dirty, JSON.stringify(o1));
  /* §9.201: 運んだ結果その行がカーソルの下へ来た状態で離すと`drop`は起きない——`dragend`だけで確定すること。 */
  const noDrop = await page.evaluate(() => {
   const g = document.querySelector('.rt-row[data-r="0"] .rt-grip'), tb = document.querySelector('.rt-table');
   const last = document.querySelector('.rt-row[data-r="2"]').getBoundingClientRect();
   const dt = new DataTransfer();
   g.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
   tb.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: last.left + 5, clientY: last.bottom - 2 }));
   g.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
   return [...document.querySelectorAll('.rt-table tbody .rt-n')].map(i => i.value).filter(Boolean).join(',');
  });
  rec('⑥ drop が起きずに離しても dragend で確定する（§9.201）', noDrop === 'R1,R2,R3', noDrop);
  rec('⑥ 既定の行はいつも最後（運べない）', await page.evaluate(() => !document.querySelector('.rt-row.is-default .rt-grip')
    && document.querySelector('.rt-table tbody tr:last-child').classList.contains('is-default')));
  await page.focus('.rt-col .rt-grip[data-i="1"]');
  await page.keyboard.press('ArrowLeft');
  const o2 = await order();
  const kfocus = await page.evaluate(() => document.activeElement?.matches('.rt-grip[data-grip="col"][data-i="0"]'));
  rec('⑥ 列は見出しの札で運べ、キー（←→）でも動く・焦点は動いた札についていく', o2.cols === '条数/板厚' && kfocus, JSON.stringify({ o2, kfocus }));
  await page.focus('.rt-row[data-r="0"] .rt-grip');
  await page.keyboard.press('ArrowDown');
  const o3 = await order();
  rec('⑥ 行もキー（↑↓）で動く', o3.rows === 'R2,R1,R3', JSON.stringify(o3));
  await page.click('[data-rt="save"]');
  await W.until(page, () => /登録済み/.test(document.querySelector('.rt-state')?.textContent || ''), null, { ms: 10000, what: '並べ替えを保存' });
  const sv = await (await fetch(B + '/api/bladeset/hold-pick?equipment=' + encodeURIComponent(EQ))).json();
  const o4 = await order();
  rec('⑥ 保存すると行の並びと列の並びが両方残り、開き直しても同じ', sv.cols.join('/') === 'strips/thickness'
      && sv.rows.map(r => r.note).filter(Boolean).join(',') === 'R2,R1,R3' && o4.cols === '条数/板厚' && o4.rows === 'R2,R1,R3',
      JSON.stringify({ cols: sv.cols, o4 }));
  rec('コンソールに例外が出ない', errs.length === 0, errs.slice(0, 3).join(' / '));
 } finally {
  await reset();
 }
}, { mode: 'edit', viewport: { width: 1728, height: 1030 } });
