/* ============================================================
   test_listtoolsui.js: 一覧の道具の画面（§9.591）——スライサー・色付け・一覧の拡大・ファイル・帯の寸法

   利用者の指示（2026-10-12）:
    「仕掛情報や品質情報、作業スケジュールの仕掛一覧や作業スケジュール表に関しても上部メニューの構成の不満や
     UIサイズのバラバラ感が残っており…別リポジトリのLotScopeのメニューなどのUIの内容構成や配置が非常に優秀で
     参考になると思うので不足している機能は実装し、UI配置やUI関連サイズ、デザインに関しては再構築を」
   足す機能は利用者が選んだ: Excel に出力・一覧の拡大（60〜200%）・表示の設定の書き出し／読み込み・スライサー・色付け。

   固定すること:
    1. 帯の寸法は1つ（物差し）: ヘッダーの札・ボタン・表の札と一覧の帯の押す物は**高さ1種・字1種**
       （前: 高さ 36／30／26px・字 14／12px。後: 30px・13px）
    2. スライサー: 開くと一覧の上にカードが出る・値を押すと一覧の件数が減り、2段目に札が出る・札を押すと戻る
    3. 色付け: 決まりを作ると当たるセルに色の印（`mk-cell`）と2段目の札（件数つき）・札で塗るのをやめられる
    4. 一覧の拡大: ＋で110%・表に`zoom`が効く・「100%に戻す」で戻る
    5. ファイル: 「Excel に出力」で .xlsx が落ちる（中身は PK で始まる）・表示の設定が JSON で落ちる
   後片付け: スライサー・色付け・拡大はこの端末の覚え（localStorage／sessionStorage）なので、最後に空へ戻す。
   ============================================================ */
'use strict';
const fs = require('fs');
const H = require('./lib/harness.js');
const W = require('./lib/wait.js');
const B = H.B;

H.run('test_listtoolsui: 一覧の道具（§9.591）', async ({ page, rec, setMode, idle }) => {
 const clean = () => page.evaluate(() => { try { localStorage.removeItem('wl.listSlicer.v1'); localStorage.removeItem('wl.listMarks.v1'); sessionStorage.removeItem('wl.listZoom.v1'); } catch (e) { /* 覚えが読めない窓では消す物も無い */ } });
 try {
  await page.goto(B + '/', { waitUntil: 'domcontentloaded' }); await W.booted(page);
  await clean();
  await setMode('edit');
  await page.reload({ waitUntil: 'domcontentloaded' }); await W.booted(page);
  await page.click('[data-db-key="SIKALOTNOW"]');
  await W.until(page, () => document.querySelectorAll('#grid tbody tr').length > 0, null, { ms: 30000, what: '仕掛一覧' });
  await idle();

  /* ---------- 1) 帯の寸法は1つ ---------- */
  const sizes = await page.evaluate(() => {
   const vis = e => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1 && !e.closest('[hidden],.wl-menu'); };
   const TOP = 'button,select,label.lt-search,.hd-chip,.list-pager';
   const roots = [...document.querySelectorAll('main>header .hd-status, main>header .hd-actions, #tabs, #genericFilterBar .filter-search-row, #listToolbar .lt-state')];
   const ctl = roots.flatMap(r => [...r.querySelectorAll(TOP)]).filter(vis).filter(e => !e.parentElement.closest(TOP));
   const pairs = [...new Set(ctl.map(e => `${Math.round(e.getBoundingClientRect().height)}/${parseFloat(getComputedStyle(e).fontSize)}`))];
   return { pairs, n: ctl.length, who: ctl.map(e => `${e.id || e.className}:${Math.round(e.getBoundingClientRect().height)}/${parseFloat(getComputedStyle(e).fontSize)}`).slice(0, 40) };
  });
  rec('1) ヘッダーと一覧の帯の押す物は高さ1種・字1種（前: 36／30／26px・14／12px）',
      sizes.n >= 10 && sizes.pairs.length === 1, JSON.stringify(sizes));

  /* ---------- 2) スライサー ---------- */
  const pick = await page.evaluate(async () => {
   const total = S.count | 0;
   for (const c of (S.columns || []).slice(0, 40)) {
    const q = new URLSearchParams({ db: S.db, table: S.table, column: c });
    const d = await api('/api/table/slicer?' + q);
    const vs = (d.values || []).filter(v => v.count > 0);
    if (vs.length >= 2 && vs.length <= 30) { const v = vs.find(x => x.count < total && x.value !== ''); if (v) return { column: c, value: v.value, count: v.count, total }; }
   }
   return null;
  });
  rec('2) 前提: 値が2〜30種類の列が見つかる', !!pick, JSON.stringify(pick));
  if (pick) {
   await page.click('#listSlicerBtn');
   await W.until(page, () => { const p = document.getElementById('listSlicer'); return !!p && !p.hidden; }, null, { ms: 5000, what: 'スライサーの面が開く' });
   await page.selectOption('#listSlicer [data-sx-add]', pick.column);
   await W.until(page, c => !!document.querySelector(`#listSlicer .sx-card[data-sx-col="${CSS.escape(c)}"] .sx-v`), pick.column, { ms: 10000, what: 'スライサーのカードに値が出る' });
   const above = await page.evaluate(() => { const p = document.getElementById('listSlicer').getBoundingClientRect(), g = document.getElementById('grid').getBoundingClientRect(); return { p: Math.round(p.bottom), g: Math.round(g.top) }; });
   rec('2) スライサーの面は一覧のすぐ上', above.p <= above.g + 1 && above.g - above.p < 24, JSON.stringify(above));
   await page.click(`#listSlicer .sx-card[data-sx-col="${pick.column}"] .sx-v[data-sx-v="${pick.value}"]`);
   await W.until(page, n => (S.count | 0) === n, pick.count, { ms: 15000, what: '値で絞った件数になる' });
   const chip = await page.evaluate(() => [...document.querySelectorAll('#listToolSums .sx-chip')].map(b => b.textContent.trim()));
   rec('2) 値を押すと一覧がその件数になり、2段目に札が出る', chip.length === 1 && chip[0].includes(pick.column), JSON.stringify({ chip, count: pick.count }));
   await page.click('#listToolSums .sx-chip');
   await W.until(page, n => (S.count | 0) === n, pick.total, { ms: 15000, what: '札を押すと全件へ戻る' });
   rec('2) 札を押すと選択が外れて全件に戻る', true);

   /* ---------- 3) 色付け ---------- */
   await page.click('#listMarkBtn');
   await W.until(page, () => { const m = document.getElementById('listMarkMenu'); return !!m && !m.hidden; }, null, { ms: 5000, what: '色付けの面が開く' });
   await page.selectOption('#listMarkMenu .mk-cond select[data-mk-k="column"]', pick.column);
   await page.selectOption('#listMarkMenu .mk-cond select[data-mk-k="op"]', 'eq');
   await page.fill('#listMarkMenu .mk-cond input[data-mk-k="value"]', pick.value);
   await page.click('#listMarkMenu [data-mk-make]');
   await W.until(page, () => document.querySelectorAll('#grid td.mk-cell').length > 0, null, { ms: 15000, what: '当たるセルに色が付く' });
   const mk = await page.evaluate(() => ({ cells: document.querySelectorAll('#grid td.mk-cell').length,
    chip: (document.querySelector('#listToolSums .mk-chip') || {}).textContent || '', bg: getComputedStyle(document.querySelector('#grid td.mk-cell')).backgroundColor }));
   rec('3) 色付けで当たるセルに色が付き、2段目の札が件数を言う（色だけにしない）',
       mk.cells > 0 && mk.chip.includes(pick.value) && mk.chip.includes(pick.count.toLocaleString('en-US')) && mk.bg !== 'rgba(0, 0, 0, 0)', JSON.stringify(mk));
   await page.keyboard.press('Escape');
   await page.click('#listToolSums .mk-chip');
   await W.until(page, () => document.querySelectorAll('#grid td.mk-cell').length === 0, null, { ms: 15000, what: '札で塗るのをやめる' });
   rec('3) 札を押すと塗るのをやめる（決まりは残る）', await page.evaluate(() => WL.listMarks.rules().length === 1));
  }

  /* ---------- 4) 一覧の拡大 ---------- */
  await page.click('#listZoomSlot [data-zoom="1"]');
  await W.until(page, () => document.getElementById('listZoomValue').textContent === '110%', null, { ms: 5000, what: '110%になる' });
  const z = await page.evaluate(() => ({ zoom: getComputedStyle(document.querySelector('#grid>table')).zoom, reset: !document.getElementById('listZoomReset').hidden }));
  rec('4) ＋で110%・表に zoom が効き「100%に戻す」が出る', Math.abs(parseFloat(z.zoom) - 1.1) < 0.01 && z.reset, JSON.stringify(z));
  await page.click('#listZoomReset');
  await W.until(page, () => document.getElementById('listZoomValue').textContent === '100%', null, { ms: 5000, what: '100%へ戻る' });
  rec('4) 「100%に戻す」で戻る', true);

  /* ---------- 5) ファイル ---------- */
  await page.click('#listFileBtn');
  await W.until(page, () => { const m = document.getElementById('listFileMenu'); return !!m && !m.hidden; }, null, { ms: 5000, what: 'ファイルの面が開く' });
  const items = await page.evaluate(() => [...document.querySelectorAll('#listFileMenu [data-file]')].map(b => b.dataset.file).join(','));
  rec('5) ファイルの面は Excel に出力・書き出す・読み込むの3つ', items === 'xlsx,save,load', items);
  let dl = page.waitForEvent('download', { timeout: 30000 });
  await page.click('#listFileMenu [data-file="xlsx"]');
  let d = await dl;
  const head = fs.readFileSync(await d.path()).subarray(0, 2).toString('latin1');
  rec('5) Excel に出力すると .xlsx が落ちる（中身は PK）', /\.xlsx$/.test(d.suggestedFilename()) && head === 'PK', JSON.stringify({ name: d.suggestedFilename(), head }));
  /* 書き出すセル: 数として読める値は数（Excel で足し算できる）・先頭0の番号や字はそのまま（§9.591）。
     フィクスチャの仕掛には数の列が無いので、表示している列へ値を差し替えた1行で見る。 */
  const cells = await page.evaluate(async () => {
   const row = (await WL.listTools.gather())[0];
   const t0 = WL.list.exportTable([row]), c = t0.columns;
   const [a, b, d] = [c[c.length - 1], c[1], c[0]];
   const t = WL.list.exportTable([{ ...row, [a]: '1,250', [b]: '0012', [d]: '12345678901234567' }]);
   const r = t.rows[0];
   return { num: r[c.indexOf(a)], zero: r[c.indexOf(b)], long: r[c.indexOf(d)], cols: [a, b, d] };
  });
  rec('5) 数として読める値は数のセル・先頭0の番号と16桁以上は字のまま',
      cells.num === 1250 && cells.zero === '0012' && cells.long === '12345678901234567', JSON.stringify(cells));
  await page.click('#listFileBtn');
  dl = page.waitForEvent('download', { timeout: 15000 });
  await page.click('#listFileMenu [data-file="save"]');
  d = await dl;
  const js = JSON.parse(fs.readFileSync(await d.path(), 'utf-8'));
  rec('5) 表示の設定は JSON で書き出せる（列・スライサー・色付けを持つ）',
      js.kind === 'wavelog-list-display' && js.items && 'columns' in js.items && 'slicer' in js.items && 'marks' in js.items && (Array.isArray(js.items.marks) ? js.items.marks.length : -1) === (pick ? 1 : 0),
      JSON.stringify({ name: d.suggestedFilename(), kind: js.kind, keys: Object.keys(js.items || {}) }));
 } finally {
  await clean();
 }
}, { viewport: { width: 1728, height: 1152 } });
