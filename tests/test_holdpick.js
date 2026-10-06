/* test_holdpick.js: 保持方式マスタ（フィンガー／ゴムリングを選ぶ判定表・§9.524、利用者の指示）。

   「フィンガーとゴムリングを選ぶ条件を今は板厚だけで…条件が複雑になるので、
     取得済みデータを列に持つ条件テーブルを組めるようにマスタを追加してください。」
   利用者の選択: 列＝計算値＋仕掛の列／表の形＝列がデータの判定表／当たらないときは最後の既定行。

   固定するのは5つ:
    ① **登録が無い設備は既定の行だけ**（どの板厚でもゴムリング・§9.574 で切替板厚の種をやめた）
    ② 表の決まり（条数・仕掛の列・板厚の範囲）で方式が決まる。**上から最初に当たった行**
    ③ 刃選択の「材質」条件が当たる（前は`st.material`を誰も入れておらず1度も当たらなかった）
    ④ 盤: セルの書き方を読む／読めない字は理由を出して残し保存させない／試す行で当たる行が光る／
       保存すると登録・「未登録に戻す」で空の表へ戻る
    ⑤ 刃組ガイダンスが表に従い、説明文が「何行目に当たったか」を言う
    ⑥ 行と列を後から並べ替えられる（掴む札・キー）・列の並びは保存する（§9.530）
    ⑧ 当たり得ない条件を見分け、図・保存したらどうなるか・直す案を出す（§9.534）
    ⑨ 答えの地図と列の効き目・上の行に覆われて一度も当たらない行の名指し（§9.535）
    ⑩ 列幅を見出しの縁で変えられ、端末に覚える（ダブルクリックで元へ）

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
/* 列を足す（§9.574・人と同じ道）: 空の表なら道しるべの札、列があれば見出しの「＋ 条件の列」の一覧から。 */
const addCol = async (page, scope, f) => {
 /* 前に足した列のセルの候補が開いていれば閉じる（浮いた候補は下の札を覆う——人も打つか Esc で閉じてから押す）。 */
 if (await page.$('.fx-suggest:not([hidden])')) await page.keyboard.press('Escape');
 const chip = `${scope} .rt-chip[data-addcol="${f}"]`;
 if (await page.$(chip)) await page.click(chip);
 else { await page.click(`${scope} .rt-addc [data-rt="addcol"]`); await page.click(`.rt-colmenu [data-addcol="${f}"]`); }
 await W.until(page, ([s, f]) => !!document.querySelector(`${s} .rt-col[data-f="${f}"]`), [scope, f], { ms: 4000, what: f + 'の列' });
};

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
   out.stored = M.holdsStored;
   let same = 0, n = 0;
   for (let t = 0.1; t <= 2.0001; t += 0.05) {
    const st = Object.assign(Bs.defaultState(), { thick: +t.toFixed(2), lots: [{ name: 'L', w: 50, n: 22, parent: 'L' }], order: [] });
    Bs.syncOrder(st); n++;
    if (Bs.isFinger(st, M) === false) same++;
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
  rec('① 登録が無い設備は「未登録」', j.stored === false, String(j.stored));
  rec('① §9.574 登録が無ければ、どの板厚でも既定の行（ゴムリング）——薄い板でもフィンガーへ替えない', j.same[0] === j.same[1], j.same.join('/'));
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
   rows: [...document.querySelectorAll('.rt-table tbody tr.rt-row')].map(tr => [...tr.querySelectorAll('input.rt-c')].map(i => i.value).join(',')
     /* 答えの列は「方式（材質）」の1つの選択（§9.527）。値（方式|材質）でなく選ばれている札の字で見る。 */
     + '→' + (tr.querySelector('.rt-ansel')?.selectedOptions[0]?.textContent || '') + (tr.classList.contains('is-won') ? '★' : '')).join(' / '),
   ans: document.querySelector('.rt-ans')?.textContent.trim() || '' }));
  const s0 = await shape();
  rec('④ §9.574 未登録の設備は、空の表（列なし・既定の行だけ）と「未登録」を出す',
      /未登録/.test(s0.state) && s0.rows === '→ゴムリング'
      && await page.evaluate(() => document.querySelectorAll('.rt-table .rt-col').length === 0), JSON.stringify(s0));
  /* 空の表で最初の列を足すと、決まりの行も1つでき、そのセルへ入る（§9.574・H1）。 */
  await addCol(page, '#masterMaintList', 'thickness');
  const first = await page.evaluate(() => ({ rows: document.querySelectorAll('.rt-table tbody .rt-row').length,
   focus: document.activeElement?.matches('.rt-c[data-r="0"][data-f="thickness"]') }));
  rec('④ §9.574 空の表で列を足すと決まりの行が1つでき、そのセルへ入る（最初の決まりまでの手が1つ減る）', first.rows === 2 && first.focus, JSON.stringify(first));
  /* 「＋ 条件の列」の一覧は何の値かを言い、名前でも説明でも探せる（§9.574）。前（実測）: 名前だけの選択肢（説明 0）。 */
  await page.click('#masterMaintList .rt-addc [data-rt="addcol"]');
  await page.waitForSelector('.rt-colmenu .rt-cm-q');
  await page.keyboard.type('狭い');
  const cm = await page.evaluate(() => ({ shown: [...document.querySelectorAll('.rt-colmenu [data-addcol]:not([hidden])')].map(b => b.dataset.addcol).join(','),
   say: document.querySelector('.rt-colmenu [data-addcol="minWidth"] small')?.textContent || '' }));
  rec('④ 列の一覧は説明つきで、字で探せる（「狭い」→ 条幅（いちばん狭い）だけ）', cm.shown === 'minWidth' && /mm/.test(cm.say), JSON.stringify(cm));
  await page.keyboard.press('Escape');
  await W.until(page, () => !document.querySelector('.rt-colmenu'), null, { ms: 4000, what: '一覧を閉じる' });
  await addCol(page, '#masterMaintList', 'strips');
  await page.click('[data-rt="addrow"]');
  await W.until(page, () => document.querySelectorAll('.rt-table tbody .rt-row').length === 3, null, { ms: 4000, what: '決まりの行が増える' });
  const c1 = '.rt-table tbody tr:nth-child(1) .rt-c[data-f="thickness"]';
  await page.fill(c1, '<0.6'); await page.press(c1, 'Tab');
  await W.until(page, () => /＜ 0\.6/.test([...document.querySelectorAll('.rt-c')].map(i => i.value).join('|')), null, { ms: 4000, what: '1行目が読まれる' });
  const cell = f => `.rt-table tbody tr:nth-child(2) .rt-c[data-f="${f}"]`;
  await page.fill(cell('strips'), '>= 20'); await page.press(cell('strips'), 'Tab');
  await W.until(page, () => /≧ 20/.test([...document.querySelectorAll('.rt-c')].map(i => i.value).join('|')), null, { ms: 4000, what: 'セルが読まれる' });
  await page.fill(cell('thickness'), 'abc'); await page.press(cell('thickness'), 'Tab');
  await W.until(page, () => !!document.querySelector('.rt-c.is-bad'), null, { ms: 4000, what: '読めないセル' });
  await page.fill('.rt-try .rt-p[data-p="strips"]', '22');
  await W.until(page, () => /2行目/.test(document.querySelector('.rt-ans')?.textContent || ''), null, { ms: 4000, what: '試す行の答え' });
  /* 試す欄にも「この列の値」の候補と説明（§9.574）。前（実測）: 候補の器なし・説明なし（表ごとに1つずつ）。 */
  const pr = await page.evaluate(() => [...document.querySelectorAll('.rt-try .rt-p')].map(i => ({ f: i.dataset.p, sg: !!i.dataset.wlSuggest, tip: i.title })));
  rec('④ 試す欄はどれも候補の器と説明（何の値で試すか）を持つ', pr.length === 2 && pr.every(x => x.sg && /試す/.test(x.tip)), JSON.stringify(pr));
  await page.click('.rt-try .rt-p[data-p="thickness"]');
  await W.until(page, () => [...document.querySelectorAll('.fx-suggest:not([hidden]) .fx-sg-item b')].some(b => b.textContent === '0.6'), null, { ms: 4000, what: '試す欄の候補に表の値' });
  rec('④ 試す欄に入ると、表に書いた値（0.6）が候補に出る', true);
  await page.keyboard.press('Escape');
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
  rec('④ 「未登録に戻す」で行が消え、空の表（既定の行だけ）へ戻る', s2.rows.replace(/★/g, '') === '→ゴムリング', JSON.stringify(s2));
  /* 消えた列（条数）の試しの値が裏で効かない——列の無い表で、試す行は空なので答えは出さない。 */
  rec('④ 表に無い列の試しの値は効かない（消えた条数の22で当てない・列が無いので試す行も出さない）', !/★/.test(s2.rows) && !/に当たる/.test(s2.ans), JSON.stringify(s2));
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

  /* ---- ⑦ 1つのセルに組み合わせ・前方一致など（§9.533、利用者の指示「<0.6かつ>0.9などの組み合わせのパターンも
     1つのセル内に」「＊＊＊で始まる、＊＊＊で終わるのような前方一致、や後方一致など様々な種類」）。
     前（実測・10通りの書き方）: 正しく判定できた書き方 0/10（組み合わせは「数で書いてください」で断り、
     SUS* などは字そのものと同じかで比べていた）。 ---- */
  const c7 = f => `.rt-row[data-r="0"] .rt-c[data-f="${f}"]`;
  await page.fill(c7('thickness'), '<0.6 または >0.9'); await page.press(c7('thickness'), 'Tab');
  await W.until(page, s => document.querySelector(s)?.value === '＜ 0.6 または ＞ 0.9', c7('thickness'), { ms: 4000, what: '組み合わせのセル' });
  await page.focus(c7('thickness'));
  const read7 = await page.evaluate(() => document.querySelector('.rt-read')?.textContent || '');
  rec('⑦ 1つのセルに「または」で書け、表の字は記号にそろい、読みは括弧で包む',
      /板厚が （?（0\.6 より小さい または 0\.9 より大きい）/.test(read7), read7);
  await page.fill('.rt-try .rt-p[data-p="thickness"]', '1.0');
  await page.fill('.rt-try .rt-p[data-p="strips"]', '1');
  await W.until(page, () => !!document.querySelector('.rt-row[data-r="0"] .rt-cell.is-hit'), null, { ms: 4000, what: '試す値で当たる' }).catch(() => {});
  const hit7 = await page.evaluate(() => ({ th: document.querySelector('.rt-row[data-r="0"] .rt-c[data-f="thickness"]')?.closest('td').className }));
  rec('⑦ 試す値 1.0 は「＜0.6 または ＞0.9」に当たる（○）', /is-hit/.test(hit7.th || ''), JSON.stringify(hit7));
  await page.fill('.rt-try .rt-p[data-p="thickness"]', '0.7');
  await W.until(page, () => /is-miss/.test(document.querySelector('.rt-row[data-r="0"] .rt-c[data-f="thickness"]')?.closest('td').className || ''), null, { ms: 4000, what: '0.7 は外れる' }).catch(() => {});
  rec('⑦ 試す値 0.7 は当たらない（×）', await page.evaluate(() => /is-miss/.test(document.querySelector('.rt-row[data-r="0"] .rt-c[data-f="thickness"]')?.closest('td').className || '')));
  /* ⑥の R3（板厚 ＜0.5）は1行目（＜0.6 または ＞0.9）に覆われて一度も当たらない——保存の前に確かめられる（§9.535）。 */
  await page.click('[data-rt="save"]');
  await page.waitForSelector('#appConfirmModal:not([hidden])', { timeout: 5000 });
  const ask7 = await page.evaluate(() => document.getElementById('appConfirmModal').textContent);
  rec('⑦ 上の行に覆われた行（3行目）があると、保存の前に名指しして確かめる（§9.535）', /当たらない決まり/.test(ask7) && /3行目/.test(ask7), ask7.slice(0, 120));
  await page.click('#appConfirmOk');
  await W.until(page, () => /登録済み/.test(document.querySelector('.rt-state')?.textContent || ''), null, { ms: 10000, what: '組み合わせを保存' });
  const sv7 = await (await fetch(B + '/api/bladeset/hold-pick?equipment=' + encodeURIComponent(EQ))).json();
  const th7 = sv7.rows[0].conditions.filter(c => c.field === 'thickness').map(c => `${c.or ? '|' : ''}${c.op}${c.value}`).join(' ');
  rec('⑦ 保存して開き直しても同じ組み合わせ（2つ目に「または」の印）', th7 === 'lt0.6 |gt0.9', th7);

  /* ---- ⑧ 当たり得ない条件（§9.534、利用者の指示「ありえない条件は代替案と登録した場合、どうなるかも含めて視覚化」）。
     前（実測・20通りのうち当たり得ない12通り）: 見つける 0/12・案 0/12・図 0/12・保存したらどうなるか 0/12。 ---- */
  const core8 = await page.evaluate(() => {
   const Bs = WL.bladeSet, T = (t, k) => Bs.parseCell(t, k).conds.map(c => Object.assign({ field: 'f' }, c));
   const dead = [['<0.6 かつ >0.9', 'num'], ['0.6〜1.0 かつ >2', 'num'], ['1 かつ ≠1', 'num'], ['<0.6 かつ ≧0.6', 'num'],
                 ['SUS かつ SPCC', 'text'], ['SUS* かつ SPC*', 'text'], ['空 かつ SUS*', 'text'], ['*H5* かつ ≠ *H*', 'text'], ['SUS304 かつ ≠ SUS*', 'text']];
   const live = [['≧0.6 かつ <1.0', 'num'], ['≦0.6 かつ ≧0.6', 'num'], ['<0.6 または >0.9', 'num'],
                 ['SUS* かつ *304', 'text'], ['SUS304 かつ SUS*', 'text'], ['*H* かつ ≠ *H5*', 'text']];
   const miss = dead.filter(([t, k]) => !Bs.cellDead(T(t, k), k).dead).map(x => x[0])
    .concat(live.filter(([t, k]) => Bs.cellDead(T(t, k), k).dead).map(x => '誤:' + x[0]));
   const alts = Bs.cellDead(T('<0.6 かつ >0.9', 'num'), 'num').alts.map(a => a.text);
   const part = Bs.cellDead(T('<0.6 かつ >0.9 または 1.2', 'num'), 'num');
   return { miss, alts, part: [part.dead, part.part] };
  });
  rec('⑧ 当たり得ない組み合わせを見分ける（数・字とも・当たり得る組は誤って言わない）', core8.miss.length === 0, core8.miss.join(' / '));
  rec('⑧ 直す案は「または」と「あいだ」（＜0.6 かつ ＞0.9）', core8.alts.join(' ／ ') === '＜ 0.6 または ＞ 0.9 ／ 0.6〜0.9', core8.alts.join(' ／ '));
  rec('⑧ 一部の組だけ当たらないセルは「一部」と言う（セルは当たる）', !core8.part[0] && core8.part[1], JSON.stringify(core8.part));
  await page.fill(c7('thickness'), '<0.6 かつ >0.9'); await page.press(c7('thickness'), 'Tab');
  await W.until(page, () => !!document.querySelector('.rt-dead svg'), null, { ms: 4000, what: '当たらない条件の盤' });
  const p8 = await page.evaluate(() => { const d = document.querySelector('.rt-dead');
   return { tag: document.querySelector('.rt-row[data-r="0"] .rt-cell.is-dead .rt-deadtag')?.textContent || '',
            none: /重なり無し/.test(d.querySelector('figure').textContent), then: /素通り/.test(d.textContent) && /使われません/.test(d.textContent),
            skip: !!d.querySelector('.rt-flow li.is-skip'), alts: [...d.querySelectorAll('.rt-alt b')].map(b => b.textContent),
            head: document.querySelector('.rt-h .rt-state.is-warn')?.textContent || '' }; });
  rec('⑧ セルに「当たらない」と字で出て、頭が「当たらない決まり 1行」と言う', p8.tag === '当たらない' && /当たらない決まり 1行/.test(p8.head), JSON.stringify(p8));
  rec('⑧ 盤は数直線で「重なり無し」・保存するとこの行を素通りして答えが使われないことを描く', p8.none && p8.then && p8.skip, JSON.stringify(p8));
  await page.click('[data-rt="save"]');
  await page.waitForSelector('#appConfirmModal:not([hidden])', { timeout: 5000 });
  const ask8 = await page.evaluate(() => document.getElementById('appConfirmModal').textContent);
  rec('⑧ 保存の前に、当たらない行と使われない答えを言って確かめる', /当たらない決まり/.test(ask8) && /1行目/.test(ask8) && /使われません/.test(ask8), ask8.slice(0, 120));
  await page.click('#closeAppConfirm');
  await W.until(page, () => document.getElementById('appConfirmModal')?.hidden !== false, null, { ms: 4000, what: '確かめの窓を閉じる' });
  await page.click('.rt-dead .rt-alt[data-alt="1"]');
  await W.until(page, s => document.querySelector(s)?.value === '0.6〜0.9', c7('thickness'), { ms: 4000, what: '案でセルが置き換わる' });
  rec('⑧ 案を押すとセルがその条件に置き換わり、盤と印が消える',
      await page.evaluate(() => !document.querySelector('.rt-dead') && !document.querySelector('.rt-cell.is-dead')));

  /* ---- ⑨ 答えの地図と列の効き目（§9.535、利用者の選択「A-12」）。区切りの格子で全部の場合を数える。
     前（実測・5列7行の見本）: 上の行に覆われて一度も当たらない行（正解 4行目・5行目）を名指し 0行・地図 0・効き目 0。 ---- */
  const core9 = await page.evaluate(() => {
   const Bs = WL.bladeSet, P = (t, f, k) => t ? Bs.parseCell(t, k || 'num').conds.map(c => Object.assign({ field: f }, c)) : [];
   const rows = [P('>=20', 'strips'), P('0.3〜0.5', 'thickness').concat(P('SUS*', 'material', 'text')), P('<0.6', 'thickness'),
    P('0.35〜0.45', 'thickness').concat(P('<10', 'strips'), P('SUS304', 'material', 'text')), P('>=1.5', 'thickness').concat(P('>=25', 'strips')),
    P('C1020', 'material', 'text').concat(P('1/2H', 'temper', 'text')), P('>=1200', 'coilWidth').concat(P('<20', 'strips')), []].map(c => ({ conditions: c }));
   const fields = [['thickness', 'num'], ['strips', 'num'], ['material', 'text'], ['temper', 'text'], ['coilWidth', 'num']].map(([field, kind]) => ({ field, kind }));
   const G = Bs.ruleGrid(rows, fields, Object.fromEntries(fields.map(f => [f.field, f.kind])));
   /* 数え上げの答えと、乱数の点での判定が食い違わないか（点の行が、点の入る場合の行と同じ） */
   let seed = 5, bad = 0; const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280, pick = a => a[Math.floor(rnd() * a.length)];
   /* 値 → 区間の番号。字の列は「その列の全部の条件への当たり外れ」が同じ組（数え上げと同じ決め方）。 */
   const kinds = Object.fromEntries(fields.map(f => [f.field, f.kind]));
   const sig = (f, x) => rows.flatMap(r => r.conditions.filter(c => c.field === f)).map(c => (Bs.rowHits([c], { [f]: x }, kinds) ? 1 : 0)).join('');
   const iv = (c, v) => { if (!c.num) return c.iv.findIndex(x => sig(c.field, x.reps[0]) === sig(c.field, v)); let j = 0; c.iv.forEach((x, k) => { if (k && v >= x.at) j = k; }); return j; };
   for (let n = 0; n < 2000; n++) {
    const ctx = { thickness: +(rnd() * 2.2).toFixed(3), strips: 1 + Math.floor(rnd() * 40), material: pick(['SUS304', 'C1020', 'A5052']), temper: pick(['1/2H', 'H']), coilWidth: 900 + Math.floor(rnd() * 600) };
    const w = Bs.firstRule(rows, ctx, fields, true).index;
    const ix = G.cols.map(c => iv(c, ctx[c.field]));
    if (!G.cases.some(q => q.win === w && q.ix.every((j, k) => j === ix[k]))) bad++;
   }
   const eff = Bs.ruleEffect(G).sort((a, b) => b.share - a.share).map(e => e.field);
   return { shadow: G.shadow.map(s => `${s.index + 1}←${s.by + 1}`).join(','), size: G.size, bad, top: eff[0] };
  });
  rec('⑨ 区切りの格子で全部の場合を数え、覆われて当たらない行を名指しする（4行目←2行目・5行目←1行目）', core9.shadow === '4←2,5←1', JSON.stringify(core9));
  rec('⑨ 数え上げは判定と食い違わない（乱数2000点の当たった行が、その点の入る場合の行）', core9.bad === 0 && core9.top === 'strips', JSON.stringify(core9));
  /* 画面: 1行目と同じ条件で板厚だけ狭い行を足すと、1行目に覆われて一度も当たらない */
  const r0 = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.rt-row[data-r="0"] .rt-c')].map(i => [i.dataset.f, i.value])));
  await page.click('[data-rt="addrow"]'); await page.waitForSelector('.rt-row[data-r="1"] .rt-c[data-f="thickness"]');
  for (const [f, v] of Object.entries(r0)) { if (!v) continue; const sel = `.rt-row[data-r="1"] .rt-c[data-f="${f}"]`;
   await page.fill(sel, f === 'thickness' ? '0.7〜0.8' : v); await page.press(sel, 'Tab'); }
  await W.until(page, () => !!document.querySelector('.rt-map [data-shadow="1"]'), null, { ms: 6000, what: '覆われた行の名指し' });
  const p9 = await page.evaluate(() => ({ named: document.querySelector('.rt-map [data-shadow="1"]').textContent,
   tag: document.querySelector('.rt-row[data-r="1"] .rt-out .rt-deadtag')?.textContent || '', cells: document.querySelectorAll('.rt-map .rt-mc').length,
   eff: document.querySelectorAll('.rt-map [data-eff]').length, head: document.querySelector('.rt-h .rt-state.is-warn')?.textContent || '' }));
  rec('⑨ 地図と列の効き目が出て、足した行は「一度も当たらない（1行目が先に取る）」と表と地図の両方で言う',
      p9.cells > 0 && p9.eff > 0 && /1行目/.test(p9.named) && /1行目が先に取る/.test(p9.tag) && /当たらない決まり/.test(p9.head), JSON.stringify(p9));
  await page.click('.rt-map .rt-mc[data-cx="0"][data-cy="0"]');
  await W.until(page, () => [...document.querySelectorAll('.rt-try .rt-p')].some(i => i.value !== ''), null, { ms: 4000, what: 'マスを押すと試す行へ' });
  rec('⑨ 地図のマスを押すと、その区間の値が「試す」の行へ入り、当たる行が出る',
      await page.evaluate(() => !/値を入れると/.test(document.querySelector('.rt-ans').textContent)));
  /* ---- ⑩ 列幅を変えられる（利用者の指示「複数条件を1セル内に書く場合、入力した文字数が多い場合もあるので
     条件テーブルの列幅を変化させられるように」）。前（実測）: 取っ手が無く、列は中身なりのまま。
     見出しの右の縁を掴んで引くと、見出しとその列のセルが同じ幅になり、描き直しても残る（端末に覚える）。
     ダブルクリックで元の幅へ。 ---- */
  const colW = () => page.evaluate(() => { const th = document.querySelector('#masterMaintList .rt-col'), f = th.dataset.f;
   const td = document.querySelector(`#masterMaintList .rt-cell[data-f="${CSS.escape(f)}"]`);
   return { th: Math.round(th.getBoundingClientRect().width), td: td ? Math.round(td.getBoundingClientRect().width) : null }; });
  const w0 = await colW();
  const g = await (await page.$('#masterMaintList .rt-col .rt-wgrip')).boundingBox();
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2); await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2 + 120, g.y + g.height / 2, { steps: 8 }); await page.mouse.up();
  await W.until(page, () => !!(JSON.parse(localStorage.getItem('wl.ruleTable.widths') || '{}').hold), null, { ms: 4000, what: '列幅を端末に覚える' });
  await page.evaluate(() => WL.holdPick.table.render());
  const w1 = await colW();
  rec('⑩ 見出しの縁を引くと列が広がり、描き直しても残る（セルも同じ幅）',
      Math.abs(w1.th - (w0.th + 120)) <= 4 && w1.td === w1.th, JSON.stringify({ 前: w0, 後: w1 }));
  await page.dblclick('#masterMaintList .rt-col .rt-wgrip');
  await W.until(page, () => !(JSON.parse(localStorage.getItem('wl.ruleTable.widths') || '{}').hold || {})[document.querySelector('#masterMaintList .rt-col').dataset.f], null, { ms: 4000, what: 'ダブルクリックで元の幅へ' });
  rec('⑩ ダブルクリックで中身なりの幅へ戻る', Math.abs((await colW()).th - w0.th) <= 2);
  rec('コンソールに例外が出ない', errs.length === 0, errs.slice(0, 3).join(' / '));
 } finally {
  await page.evaluate(() => localStorage.removeItem('wl.ruleTable.widths')).catch(() => {});
  await reset();
 }
}, { mode: 'edit', viewport: { width: 1728, height: 1030 } });
