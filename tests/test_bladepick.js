/* test_bladepick.js: 刃選択マスタの盤（§9.380 → §9.529 で2つの判定表）。

   「専用刃を使う条件だけになっていますが、刃厚を選ぶテーブルと通常刃か専用刃を選ぶテーブルの
     2つを準備し、5㎜刃か10㎜刃かなど、登録している刃厚を選択対象にできるようにしてください。
     条件テーブルは『保持方式』の選択マスタみたいな条件テーブルの作りが好ましいです。自由に条件設定が
     でき、他マスタで設定した項目(例えば板押さえ)も条件に加えられるようにしたいです。条件式の書き方は
     わかりやすく、サジェスト機能もつけて使いやすく再設計してください。」
   利用者の選択: 専用刃は答えでセットも選べる。

   前（実測・VER2.415.0）: 表は1つ（専用刃の決まりのカード）・刃厚は選べない（いつもいちばん厚い刃）・
   条件は4項目の窓で「項目→比べ方→値」を1つずつ選ぶ・候補なし。
   固定するのは7つ:
    ① 盤: ② 刃のカテゴリ・③ 刃厚の2つの判定表（保持方式と同じ部品）。未登録は今までの選び方（§9.574 で列なしの空の表）
    ② 列: 前の表の答え（板押さえ方式）と材料を足せる。刃厚の表だけが「刃のカテゴリ」を足せる
    ③ 候補: セルに入ると「この列の値」と「書き方」が出る。打ち終えた条件は Tab で離れても置き換わらない
    ④ 読む: 表の下の1行が決まりを文で言う／「試す」は2つの表で共有し、上の帯が「→ カテゴリ → 刃厚」を言う
    ⑤ 答え: 専用刃はセットまで選べ、刃厚は登録している刃厚から選ぶ。保存すると表のまま登録になる
    ⑥ ガイダンス: 2つの表に従い、札が「専用刃 B・5mm」と言う
    ⑦ 選択肢の列も字の列と同じ書き方（候補・「専用*」）・「試す」の字の欄に日本語を打っても割れない
   後片付けは finally（2つの表を未登録へ・刃セットを初期値へ）。 */
const H = require('./lib/harness.js');
const W = require('./lib/wait.js');
const B = H.B;
const EQ = 'テスト設備A';
const api = (p, o) => fetch(B + p, o).then(r => r.json());
const post = (p, body) => api(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const reset = async () => {
 for (const table of ['category', 'thickness']) await post('/api/bladeset/blade-pick', { equipment: EQ, table, reset: true, user_id: 'test' });
};

H.run('test_bladepick: 刃選択の2つの判定表（§9.529）', async ({ page, rec, errs }) => {
 await post('/api/bladeset/seed', { equipment: EQ });
 await reset();
 const sets = ((await api('/api/bladeset/blade-sets?equipment=' + encodeURIComponent(EQ))).items || []).filter(x => x.group);
 const gS = (sets[1] || sets[0] || {}).group;
 const thks = [...new Set(sets.flatMap(x => x.thicknesses))].sort((a, b) => b - a);
 try {
  await post('/api/bladeset/blade-sets', { equipment: EQ, group: gS, category: '専用刃', user_id: 'test' });
  await page.goto(B + '/', { waitUntil: 'domcontentloaded' });
  await W.booted(page);
  await W.until(page, () => !!(window.currentUserId && currentUserId()), null, { ms: 15000, what: '更新者IDが決まる' });
  await page.evaluate(() => WL.mm.openMasterMaint());
  await W.until(page, () => !!document.querySelector('[data-master="bladesetPick"]'), null, { ms: 15000, what: '刃選択のタブ' });
  await page.evaluate(() => document.querySelector('[data-master="bladesetPick"]').click());
  await W.until(page, () => !!document.querySelector('#bpEq'), null, { ms: 10000, what: '刃選択の盤' });
  await page.selectOption('#bpEq', { label: EQ });
  await W.until(page, e => document.querySelector('#bpEq')?.value === e && document.querySelectorAll('.rt-table').length === 2, EQ, { ms: 10000, what: '2つの表' });
  const T = k => `#masterMaintList [data-table="${k}"]`;

  /* ---- ① 2つの表・未登録は今までの選び方 ---- */
  const s0b = await page.evaluate(() => ['category', 'thickness'].map(k => {
   const h = document.querySelector(`#masterMaintList [data-table="${k}"]`);
   return { title: h.querySelector('.rt-h h3')?.textContent, state: h.querySelector('.rt-state')?.textContent,
            def: h.querySelector('.rt-row.is-default .rt-ansel')?.selectedOptions[0]?.textContent };
  }));
  rec('① 刃のカテゴリ・刃厚の2つの判定表が並ぶ（前は専用刃の決まりのカード1種類）',
      s0b.map(x => x.title).join('/') === '刃のカテゴリ/刃厚', JSON.stringify(s0b));
  rec('① 未登録の表は今までの選び方（既定の行＝通常刃／いちばん厚い刃）を「未登録」と言う',
      /未登録/.test(s0b[0].state) && s0b[0].def === '通常刃' && /未登録/.test(s0b[1].state) && s0b[1].def === 'いちばん厚い刃', JSON.stringify(s0b));
  const cols0 = await page.evaluate(() => document.querySelectorAll('#masterMaintList .rt-table .rt-col').length);
  rec('① §9.574 未登録の表は列なし（既定で板厚などの列を入れない）', cols0 === 0, String(cols0));

  /* ---- ② 列（前の表の答えと材料） ---- */
  const addable = await page.evaluate(() => ['category', 'thickness'].map(k => {
   const s = document.querySelector(`#masterMaintList [data-table="${k}"] .rt-addcol`);
   return [...s.querySelectorAll('optgroup')].map(g => g.label + ':' + [...g.querySelectorAll('option')].map(o => o.value).join(',')).join(' | ');
  }));
  rec('② カテゴリの表に足せる列: ほかのマスタの答え（板押さえ方式・フィンガー材質）・材料（板厚・計算値・材質・調質…）',
      /ほかのマスタの答え:hold,fingerMaterial/.test(addable[0]) && /材料から計算した値:thickness,coilWidth/.test(addable[0]) && /1本目のコイル（仕掛）:material,temper/.test(addable[0])
      && !/category/.test(addable[0]) && /ほかのマスタの答え:hold,fingerMaterial,category/.test(addable[1]), addable.join(' ／ '));
  /* 列は人が足す（§9.574）。カテゴリの表＝板押さえ方式・板厚、刃厚の表＝刃のカテゴリ・板厚。 */
  for (const [k, fs] of [['category', ['hold', 'thickness']], ['thickness', ['category', 'thickness']]]) {
   for (const f of fs) {
    await page.selectOption(`#masterMaintList [data-table="${k}"] .rt-addcol`, f);
    await W.until(page, ([k, f]) => !!document.querySelector(`#masterMaintList [data-table="${k}"] .rt-col[data-f="${f}"]`), [k, f], { ms: 5000, what: `${k} の表に ${f} の列` });
   }
  }
  const heads = await page.evaluate(() => [...document.querySelectorAll('#masterMaintList [data-table="thickness"] .rt-col')].map(th => th.querySelector('b').textContent + th.querySelector('small').textContent));
  rec('② 刃厚の表は「刃のカテゴリ」（前の表の答え）を列に持ち、見出しは名前の下に出どころを言う',
      heads.join('/') === '刃のカテゴリほかのマスタの答え/板厚材料から計算した値', heads.join('/'));

  /* ---- ③ 候補 ---- */
  await page.click(`${T('category')} [data-rt="addrow"]`);
  await W.until(page, () => document.querySelectorAll('#masterMaintList [data-table="category"] .rt-row').length === 2, null, { ms: 5000, what: '決まりの行' });
  const cell = (k, f, r = 0) => `${T(k)} .rt-c[data-r="${r}"][data-f="${f}"]`;
  await page.click(cell('category', 'thickness'));
  await W.until(page, () => !document.querySelector('.fx-suggest')?.hidden, null, { ms: 5000, what: '候補が出る' });
  const sg = await page.evaluate(() => [...document.querySelectorAll('.fx-suggest .fx-sg-head, .fx-suggest .fx-sg-item b')].map(e => e.textContent));
  rec('③ セルに入ると候補が出る（書き方の見本: ＜・≦・≧・＞・範囲・以外）',
      sg.includes('書き方（押すと入ります）') && sg.some(t => /^＜ 値$/.test(t)) && sg.some(t => /〜上限/.test(t)), sg.join(' / '));
  await page.keyboard.type('1.6');
  await W.until(page, () => [...document.querySelectorAll('.fx-suggest .fx-sg-item b')].some(b => b.textContent === '≧ 1.6'), null, { ms: 5000, what: '打った値で見本が変わる' });
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await W.until(page, c => document.querySelector(c)?.value === '≧ 1.6', cell('category', 'thickness'), { ms: 5000, what: '候補で入る' });
  rec('③ ↑↓で選んで Enter で入る（≧ 1.6）', true);
  await page.fill(cell('category', 'hold'), '');
  await page.click(cell('category', 'hold'));
  await W.until(page, () => [...document.querySelectorAll('.fx-suggest .fx-sg-item b')].some(b => b.textContent === 'ゴムリング'), null, { ms: 5000, what: '候補の値' });
  const holdSg = await page.evaluate(() => [...document.querySelectorAll('.fx-suggest .fx-sg-item b')].map(b => b.textContent));
  rec('③ 板押さえ方式の列は「この列の値」に保持方式の答え（フィンガー・ゴムリング）が出る',
      holdSg.includes('フィンガー') && holdSg.includes('ゴムリング') && !holdSg.some(t => /〜/.test(t)), holdSg.join(' / '));
  await page.click(`.fx-suggest .fx-sg-item:has(b:text-is("ゴムリング"))`);
  await W.until(page, c => document.querySelector(c)?.value === 'ゴムリング', cell('category', 'hold'), { ms: 5000, what: '値を押して入る' });
  await page.fill(cell('category', 'thickness'), '>= 1.2');
  await page.press(cell('category', 'thickness'), 'Tab');
  await W.until(page, c => document.querySelector(c)?.value === '≧ 1.2', cell('category', 'thickness'), { ms: 5000, what: '打ち終えた条件が残る' });
  rec('③ 打ち終えた条件（>= 1.2）は Tab で離れても候補に置き換わらず、記号で表に残る', true);

  /* ---- ④ 読む・試す ---- */
  await page.selectOption(`${T('category')} .rt-row[data-r="0"] .rt-ansel`, `専用刃|${gS}`);
  await page.hover(`${T('category')} .rt-row[data-r="0"]`);
  const read = await page.evaluate(() => document.querySelector('#masterMaintList [data-table="category"] .rt-read')?.textContent || '');
  rec('④ 表の下の1行が決まりを文で読む（板押さえ方式が ゴムリング かつ 板厚が 1.2 以上 → 専用刃（セット …））',
      read.includes('1行目: 板押さえ方式が ゴムリング かつ 板厚が 1.2 以上 → 専用刃（セット ' + gS + '）'), read);
  await page.fill(`${T('category')} .rt-try .rt-p[data-p="thickness"]`, '1.5');
  await page.selectOption(`${T('category')} .rt-try .rt-p[data-p="hold"]`, 'ゴムリング');
  await W.until(page, () => /専用刃/.test(document.querySelector('.bp-try')?.textContent || ''), null, { ms: 5000, what: '上の帯の答え' });
  const tr1 = await page.evaluate(() => ({ band: document.querySelector('.bp-try').textContent.replace(/\s+/g, ' '),
   shared: document.querySelector('#masterMaintList [data-table="thickness"] .rt-try .rt-p[data-p="thickness"]')?.value,
   won: !!document.querySelector('#masterMaintList [data-table="category"] .rt-row.is-won[data-r="0"]') }));
  rec('④ 「試す」の値は2つの表で共有し、上の帯が「この作業なら → 専用刃（セット …） → いちばん厚い刃」と言う',
      tr1.shared === '1.5' && tr1.won && new RegExp(`この作業なら → 専用刃（セット ${gS}）.*→ いちばん厚い刃`).test(tr1.band), JSON.stringify(tr1));

  /* ---- ⑤ 答え・保存 ---- */
  const thOpts = await page.evaluate(() => [...document.querySelector('#masterMaintList [data-table="thickness"] .rt-row.is-default .rt-ansel').options].map(o => o.textContent));
  rec('⑤ 刃厚の答えは登録している刃厚（厚い順）＋いちばん厚い刃', thOpts.join('/') === ['いちばん厚い刃'].concat(thks.map(t => t + 'mm')).join('/'), thOpts.join('/'));
  const catOpts = await page.evaluate(() => [...document.querySelector('#masterMaintList [data-table="category"] .rt-row[data-r="0"] .rt-ansel').options].map(o => o.textContent));
  rec('⑤ カテゴリの答えは通常刃／専用刃（どれでも）／専用刃（セット ○）', catOpts[0] === '通常刃' && /どれでも/.test(catOpts[1]) && catOpts.some(t => t.startsWith(`専用刃（セット ${gS}）`)), catOpts.join('/'));
  await page.click(`${T('category')} [data-rt="save"]`);
  await W.until(page, () => /登録済み/.test(document.querySelector('#masterMaintList [data-table="category"] .rt-state')?.textContent || ''), null, { ms: 10000, what: 'カテゴリの表を保存' });
  /* §9.574 片方の表を保存しても、もう片方の保存していない変更（足した列）は読み直しで捨てない。
     前（実測）: 刃のカテゴリを保存すると刃厚の表が読み直され、足したばかりの列が2つとも消えた。 */
  const keep = await page.evaluate(() => ({ cols: [...document.querySelectorAll('#masterMaintList [data-table="thickness"] .rt-col')].map(th => th.dataset.f).join(','),
   state: document.querySelector('#masterMaintList [data-table="thickness"] .rt-state')?.textContent || '' }));
  rec('⑤ カテゴリの表を保存しても、刃厚の表の保存していない列は残る（変更ありのまま）', keep.cols === 'category,thickness' && /保存していない/.test(keep.state), JSON.stringify(keep));
  await page.click(`${T('thickness')} [data-rt="addrow"]`);
  await page.fill(cell('thickness', 'category'), '専用刃'); await page.press(cell('thickness', 'category'), 'Tab');
  await page.selectOption(`${T('thickness')} .rt-row[data-r="0"] .rt-ansel`, String(thks[thks.length - 1]));
  await page.click(`${T('thickness')} [data-rt="save"]`);
  await W.until(page, () => /登録済み/.test(document.querySelector('#masterMaintList [data-table="thickness"] .rt-state')?.textContent || ''), null, { ms: 10000, what: '刃厚の表を保存' });
  const saved = await api('/api/bladeset/blade-pick?equipment=' + encodeURIComponent(EQ));
  const pack = t => saved.tables[t].rows.map(r => r.conditions.map(c => c.field + c.op + c.value).join('&') + '→' + r.answer + (r.group ? '|' + r.group : ''));
  rec('⑤ 保存すると画面の表のまま登録になる（最後は既定の行）',
      pack('category').join(' / ') === `holdeqゴムリング&thicknessge1.2→専用刃|${gS} / →通常刃`
      && pack('thickness').join(' / ') === `categoryeq専用刃→${thks[thks.length - 1]} / →`, JSON.stringify([pack('category'), pack('thickness')]));

  /* ---- ⑥ ガイダンス ---- */
  await page.evaluate(eq => WL.bladeGuide.open({ equipment: eq, seed: { thickness: 1.5, originalWidth: 1130,
    lots: [{ name: 'BP1', w: 279.8, n: 4, parent: 'BP1' }], headLot: '' } }), EQ);
  await W.until(page, () => /専用刃/.test(document.querySelector('#bsFPick')?.textContent || ''), null, { ms: 20000, what: 'ガイダンスの刃の札' });
  const pk = await page.evaluate(() => ({ t: document.querySelector('#bsFPick').textContent, title: document.querySelector('#bsFPick').title }));
  rec('⑥ ガイダンスは2つの表に従い、札が「専用刃 セット・刃厚」と言い、根拠（何行目）を title に持つ',
      pk.t === `専用刃 ${gS}・${thks[thks.length - 1]}mm` && /刃のカテゴリ」の1行目/.test(pk.title) && /「刃厚」の1行目/.test(pk.title), JSON.stringify(pk));
  /* ---- ⑦ 選択肢の列も保持方式と同じ書き方・日本語入力が割れない（利用者の指摘） ----
     「刃選択マスタの『刃厚』や『刃のカテゴリ』に関しても保持方式マスタと同じように様々な条件を入れられ
      サジェスト機能も出るように」「セルに文字を入力するときに子音と母音が分かれて、文字が入力できない」。
     前（実測）: 選択肢の列の書き方の候補は「＝／≠」の2つだけ（字の列は11）。「試す」の字の欄は1字打つたびに表ごと
     作り直され、IME で「か」を打つと「kかか」になった。 */
  await page.evaluate(() => WL.mm.openMasterMaint());
  await page.evaluate(() => document.querySelector('[data-master="bladesetPick"]').click());
  await W.until(page, e => document.querySelector('#bpEq')?.value === e && document.querySelectorAll('.rt-table').length === 2, EQ, { ms: 10000, what: '2つの表（開き直し）' });
  const tm = await page.evaluate(() => {
   const t = WL.bladePick.tables.thickness, n = f => { const it = t.suggestFor({ dataset: { f }, value: '' }).items; return it.length - it.findIndex(x => x.head && /書き方/.test(x.label)) - 1; };
   return { category: n('category'), hold: n('hold'), material: n('material') };
  });
  rec('⑦ 選択肢の列（刃のカテゴリ・板押さえ方式）にも字の列と同じ書き方の候補が出る',
      tm.category === tm.material && tm.hold === tm.material && tm.material >= 10, JSON.stringify(tm));
  await page.fill(cell('thickness', 'category'), '専用*'); await page.press(cell('thickness', 'category'), 'Tab');
  await page.selectOption(`${T('thickness')} .rt-p[data-p="category"]`, '専用刃');
  await W.until(page, () => !!document.querySelector('#masterMaintList [data-table="thickness"] .rt-row[data-r="0"].is-won'), null, { ms: 5000, what: '「専用*」の行が当たる' });
  rec('⑦ 選択肢の列に「専用*」（で始まる）と書け、試すと当たる', true);
  await page.selectOption(`${T('thickness')} .rt-addcol`, 'material');
  await W.until(page, () => !!document.querySelector('#masterMaintList [data-table="thickness"] .rt-p[data-p="material"]'), null, { ms: 5000, what: '材質の列が足される' });
  const cdp = await page.context().newCDPSession(page);
  await page.focus(`${T('thickness')} .rt-p[data-p="material"]`);
  await cdp.send('Input.imeSetComposition', { text: 'k', selectionStart: 1, selectionEnd: 1 });
  await cdp.send('Input.imeSetComposition', { text: 'か', selectionStart: 1, selectionEnd: 1 });
  await cdp.send('Input.insertText', { text: 'か' });
  await W.until(page, () => document.querySelector('#masterMaintList [data-table="thickness"] .rt-p[data-p="material"]')?.value === 'か', null, { ms: 5000, what: '試す欄に「か」' }).catch(() => {});
  const ime = await page.evaluate(() => document.querySelector('#masterMaintList [data-table="thickness"] .rt-p[data-p="material"]')?.value);
  rec('⑦ 「試す」の字の欄に日本語を打っても割れない（「k」が残らない）', ime === 'か', JSON.stringify(ime));
  rec('コンソールに例外が出ない', errs.length === 0, errs.slice(0, 3).join(' / '));
 } finally {
  await reset();
  await post('/api/bladeset/blade-sets', { equipment: EQ, group: gS, reset: true }).catch(() => {});
  const left = await api('/api/bladeset/blade-pick?equipment=' + encodeURIComponent(EQ));
  rec('後片付け: 2つの表は未登録へ戻る', !left.tables.category.stored && !left.tables.thickness.stored);
 }
}, { mode: 'edit', viewport: { width: 1728, height: 1030 } });
