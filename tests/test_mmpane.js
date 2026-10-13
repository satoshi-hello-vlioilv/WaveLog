/* ============================================================
   test_mmpane.js: マスタの右の詳細（§9.598・ステップ1 1c）——一覧と並ぶ・開いただけでは「変更なし」・変更は黙って捨てない

   利用者の依頼（2026-10-13）:
    「現在の主にマスタのデザインがなんかしっくりきていないというか、もったりしたデザインのような印象がありUIUXも含めて
     きれいに作り替えたいです。…DataRelay や LotScope のデザインは気に入っており、これらの要素の良いところを取り入れて」
   採点で選んだ AA（99点）の「一覧＋右の詳細」を固定する:
    1. 汎用の表のマスタは、行を押すと右に詳細が開く（窓で覆わない）。器は一覧の右に並び、窓の高さに収まる（足元が見える）。
       閉じるのは頭の×だけ（Esc では閉じない——中の ⋯ のメニューや候補の一覧の Esc と取り合わない）
    2. **開いただけでは「変更なし」**——保存とキャンセルは押せない（どの汎用の表のマスタでも。値の読み方は保存と同じ1箇所）
    3. 行に「編集・削除」のボタンを持たない。削除は詳細の頭の ⋯（赤の字）
    4. 打つと「変更あり」で保存・キャンセルが押せる。キャンセルは元の値へ戻す（閉じない）
    5. 変更があるまま別の行・×・「戻る」を押すと聞く（黙って捨てない）。「戻って続ける」なら残る
    6. 開いているあいだ頭の「追加」は縁取り（塗りの主ボタンは足元の保存の1つ）。閉じれば塗りへ戻る
    7. 表の値は印で言う（既定は薄い字・機能は札・入力内容は棒・段は ●◐○— と凡例）。列の幅は中身の比で、切れない。
       欄に入ると同じ列が光り、打った値はその場でセルに出る（キャンセルで戻る）
    8. 編集欄: 説明の続きは ⓘ の1つ・空欄の値は欄の中の薄い字・欄が1つの節は名前を見出しへ・札の一言は切れない
   ============================================================ */
'use strict';
const H = require('./lib/harness.js');
const W = require('./lib/wait.js');
const B = H.B;

H.run('test_mmpane: マスタの右の詳細（§9.598）', async ({ page, rec, setMode, idle }) => {
 await page.goto(B + '/', { waitUntil: 'domcontentloaded' }); await W.booted(page);
 await setMode('edit');
 await page.evaluate(v => { try { localStorage.setItem('AccessMeasurementUserId', v) } catch (e) { /* 覚えを書けない端末でも続ける（足元の記録者が「—」になるだけ） */ } }, 'tester');
 await page.reload({ waitUntil: 'domcontentloaded' }); await W.booted(page);
 await page.click('[data-db-key="SIKALOTNOW"]');
 await W.until(page, () => document.querySelectorAll('#grid tbody tr').length > 0, null, { ms: 30000, what: '仕掛一覧' });
 await page.click('#openMasterMaint');
 await W.until(page, () => document.body.classList.contains('mm-mode') && !!document.querySelector('#masterMaintNav [data-master].active'), null, { ms: 20000, what: 'マスタ管理' });
 await idle();

 const pane = () => page.evaluate(() => {
  const m = document.getElementById('maintEditorModal');
  if (!m || m.hidden) return { open: false };
  const r = e => { const b = e.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), b: Math.round(b.bottom) }; };
  const dlg = m.querySelector('.mm-editor-dialog'), foot = m.querySelector('.mm-editor-foot'), list = document.querySelector('#masterMaintPanel .mm-list-wrap');
  return { open: true, docked: m.classList.contains('is-docked'), title: document.getElementById('maintEditorTitle').textContent,
   kind: document.getElementById('maintEditorEyebrow').textContent, foot: document.getElementById('maintEditorHint').textContent,
   save: !document.getElementById('maintEditorSave').disabled, cancel: !document.getElementById('maintEditorCancel').disabled,
   more: !document.getElementById('maintEditorMore').hidden, quiet: !!document.querySelector('#masterMaintActs .mm-hd-primary.is-quiet'),
   pane: r(m), dlg: r(dlg), footR: r(foot), list: r(list), vh: innerHeight };
 });
 const openNav = async key => {
  await page.click(`#masterMaintNav [data-master="${key}"]`);
  await W.until(page, k => { const b = document.querySelector(`#masterMaintNav [data-master="${k}"]`); return b && b.classList.contains('active'); }, key, { ms: 15000, what: key });
  await idle();
 };
 /* 開いた直後の値は配線（3桁区切り・隠し欄）のあとに写す。足元が字を書くまで待つ。 */
 const settled = () => W.until(page, () => /記録者/.test((document.getElementById('maintEditorHint') || {}).textContent || ''), null, { ms: 8000, what: '詳細の足元' });

 /* ---------- 1)〜3) 汎用の表のマスタを全部開く ---------- */
 const keys = await page.evaluate(() => (WL.mm.MASTER_DEFS || []).filter(d => !d.special && !d.readOnly && Array.isArray(d.fields) && d.fields.length)
  .map(d => d.key).filter(k => { const b = document.querySelector(`#masterMaintNav [data-master="${k}"]`); if (!b) return false; const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; }));   // 畳んだ群の中は押せないので数えない
 const seen = [], spurious = [], unfit = [], btns = [], modal = [], inline = [];
 /* 右の詳細で開くはずのマスタ（窓で開く定義の中で、専用の画面・組み立て・紙の見本を持たないもの）。答えは製品と同じ条件。 */
 const want = await page.evaluate(() => (WL.mm.MASTER_DEFS || []).filter(d => !d.special && !d.readOnly && Array.isArray(d.fields) && d.fields.length
  && (d.editorModal === true || (d.editorModal !== false && (d.fields.length >= 4 || d.fields.some(f => /^equipment-multi/.test(f.type)))))
  && typeof d.asideHtml !== 'function' && !d.fields.some(f => f.type === 'field-builder')).map(d => d.key));
 for (const key of keys) {
  await openNav(key);
  await page.evaluate(() => { const o = document.querySelector('[data-mm-fold="open"]:not([disabled])'); if (o) o.click(); });   // 群で畳む一覧は開いてから
  await idle();
  const has = await page.evaluate(() => !!document.querySelector('#masterMaintList .mm-row[data-mm-open]'));
  btns.push(...await page.evaluate(k => [...document.querySelectorAll('#masterMaintList .mm-edit,#masterMaintList .mm-del,#masterMaintList .mm-act')].map(() => k), key));
  const add = await page.evaluate(() => !!document.getElementById('masterMaintAdd'));
  if (!has && !add) continue;
  await page.click(has ? '#masterMaintList .mm-row[data-mm-open]' : '#masterMaintAdd');   // 行が無いマスタは新規で開く
  await idle();
  const p = await pane();
  if (!p.open) { inline.push(key); continue; }   // 欄が少ないマスタは一覧の上の欄で直す（右の詳細ではない）
  if (!p.docked) {   // 窓のまま（組み立て・紙の見本）のマスタは右の詳細ではない——閉じて次へ（窓は左の一覧を覆う）
   modal.push(key);
   await page.click('#maintEditorClose');
   await W.until(page, () => document.getElementById('maintEditorModal').hidden, null, { ms: 5000, what: '窓を閉じる' });
   continue;
  }
  await settled(); await idle();
  const q = await pane();
  seen.push(key);
  if (!/変更なし|まだ入力がありません/.test(q.foot) || q.save || q.cancel) spurious.push({ key, foot: q.foot, save: q.save });
  if (q.footR.b > q.vh + 1 || q.dlg.t < q.pane.t - 1 || q.list.r > q.pane.l + 1) unfit.push({ key, foot: q.footR, pane: q.pane, list: q.list, vh: q.vh });
  await page.click('#maintEditorClose');
  await W.until(page, () => document.getElementById('maintEditorModal').hidden, null, { ms: 5000, what: '×で閉じる' });
 }
 const wantVis = want.filter(k => keys.includes(k));
 rec('1) 窓で開いていた汎用の表のマスタは、行を押すと右に詳細が開く（窓で覆わない）',
  wantVis.length > 0 && wantVis.every(k => seen.includes(k)) && seen.every(k => wantVis.includes(k)), JSON.stringify({ seen, wantVis, modal, inline }));
 rec('1) 詳細は一覧の右に並び、窓の高さに収まる（足元が見える・頭が隠れない）', unfit.length === 0, JSON.stringify(unfit));
 rec('2) 開いただけでは「変更なし」——保存もキャンセルも押せない（どのマスタでも）', spurious.length === 0, JSON.stringify(spurious));
 rec('3) 行に「編集・削除」のボタンを持たない', btns.length === 0, JSON.stringify(btns));

 /* ---------- 3)〜6) 設備で操作の流れを見る ---------- */
 await openNav('equipment');
 const rows = await page.evaluate(() => document.querySelectorAll('#masterMaintList .mm-row[data-mm-open]').length);
 await page.click('#masterMaintList .mm-row[data-mm-open] >> nth=0');
 await settled(); await idle();
 const a = await pane();
 const sel = await page.evaluate(() => { const r = document.querySelector('#masterMaintList .mm-row.editing'); return r ? r.textContent.trim().slice(0, 20) : ''; });
 rec('1) 頭は種類の小さな字とその行の名前・選んだ行に印', a.kind === '設備' && !!a.title && sel.startsWith(a.title), JSON.stringify({ kind: a.kind, title: a.title, sel }));
 rec('6) 開いているあいだ頭の「追加」は縁取り', a.quiet, JSON.stringify(a.quiet));
 rec('3) 削除は詳細の頭の ⋯', a.more, JSON.stringify(a.more));
 await page.click('#maintEditorMore');
 await W.until(page, () => { const m = document.getElementById('mmRowMenu'); return !!m && !m.hidden; }, null, { ms: 5000, what: '⋯ のメニュー' });
 const menu = await page.evaluate(() => { const b = document.querySelector('#mmRowMenu [data-row-act="delete"]'); return b ? { text: b.textContent.trim(), color: getComputedStyle(b).color, danger: b.classList.contains('is-danger') } : null; });
 rec('3) ⋯ の中に「この設備を…」の削除（赤の字）', !!menu && menu.danger && /^この設備を/.test(menu.text), JSON.stringify(menu));
 await page.keyboard.press('Escape');
 await W.until(page, () => { const m = document.getElementById('mmRowMenu'); return !m || m.hidden; }, null, { ms: 5000, what: '⋯ が閉じる' });
 rec('3) メニューの Esc では詳細は閉じない', (await pane()).open, JSON.stringify(await page.evaluate(() => { const m = document.getElementById('maintEditorModal'); return { hidden: m.hidden, cls: m.className, parent: m.parentElement && m.parentElement.className, active: document.activeElement && (document.activeElement.id || document.activeElement.className) }; })));

 /* 4) 打つと「変更あり」・キャンセルで戻る */
 const field = '#maintEditorForm [data-field="name"]';
 const was = await page.inputValue(field);
 await page.fill(field, was + '_変');
 await W.until(page, () => !document.getElementById('maintEditorSave').disabled, null, { ms: 5000, what: '保存が押せる' });
 const b = await pane();
 rec('4) 打つと「変更あり」で保存とキャンセルが押せる', /変更あり/.test(b.foot) && b.save && b.cancel, JSON.stringify({ foot: b.foot, save: b.save, cancel: b.cancel }));

 /* 5) 変更があるまま別の行を押すと聞く */
 if (rows >= 2) {
  await page.click('#masterMaintList .mm-row[data-mm-open] >> nth=1');
  await page.waitForSelector('#appConfirmModal', { state: 'visible', timeout: 5000 });
  await page.click('#appConfirmCancel');
  await W.until(page, () => document.getElementById('appConfirmModal').hidden, null, { ms: 5000, what: '確かめる窓が閉じる' });
  const c = await pane();
  rec('5) 変更があるまま別の行を押すと聞く——「戻って続ける」なら残る', c.title === a.title && (await page.inputValue(field)) === was + '_変', JSON.stringify({ title: c.title }));
 } else rec('5) 変更があるまま別の行を押すと聞く', true, '設備が1件しか無いので省略');
 /* 「戻る」も聞く */
 await page.click('#viewBack');
 await page.waitForSelector('#appConfirmModal', { state: 'visible', timeout: 5000 });
 await page.click('#appConfirmCancel');
 await W.until(page, () => document.getElementById('appConfirmModal').hidden, null, { ms: 5000, what: '確かめる窓が閉じる' });
 rec('5) 変更があるまま「戻る」を押すと聞く——留まる', await page.evaluate(() => document.body.classList.contains('mm-mode')) && (await pane()).open);
 await page.click('#maintEditorCancel');
 await W.until(page, () => document.getElementById('maintEditorSave').disabled, null, { ms: 5000, what: 'キャンセルで戻る' });
 const d = await pane();
 rec('4) キャンセルは元の値へ戻す（閉じない）', d.open && (await page.inputValue(field)) === was && /変更なし/.test(d.foot), JSON.stringify({ foot: d.foot }));
 /* 変更が無ければ別の行へそのまま替わる */
 if (rows >= 2) {
  await page.click('#masterMaintList .mm-row[data-mm-open] >> nth=1');
  await W.until(page, t => document.getElementById('maintEditorTitle').textContent !== t, a.title, { ms: 5000, what: '詳細が替わる' });
  const e = await pane();
  rec('5) 変更が無ければ別の行へそのまま替わる（聞かない）', e.open && e.title !== a.title && await page.evaluate(() => document.getElementById('appConfirmModal')?.hidden !== false), JSON.stringify({ title: e.title }));
 }
 /* ---------- 7) 表の値の印と、欄と表を結ぶ（1d） ---------- */
 const marks = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#masterMaintList .mm-row:not(.head)')];
  const cut = rows.flatMap(r => [...r.children].filter(c => c.scrollWidth > c.clientWidth + 1).map(c => c.title || c.textContent.trim()));
  return { cut, def: document.querySelectorAll('#masterMaintList .mm-val-def').length, tags: document.querySelectorAll('#masterMaintList .mm-val-tag').length,
   bar: document.querySelectorAll('#masterMaintList .mm-val-bar').length, vw: innerWidth };
 });
 rec('7) 値は印で言う（既定は薄い字・機能は札・入力内容は棒）', marks.def > 0 && marks.tags > 0 && marks.bar > 0, JSON.stringify(marks));
 rec('7) 列の幅は中身の比——詳細を開いたままでもセルが「…」で切れない', marks.cut.length === 0, JSON.stringify(marks));
 /* ---------- 8) 編集欄（1e） ---------- */
 const ed = await page.evaluate(() => {
  const f = document.getElementById('maintEditorForm');
  const solo = [...f.querySelectorAll('.mm-field[data-solo]')];
  return { old: f.querySelectorAll('.mm-more').length, tips: f.querySelectorAll('.wl-tip-i[data-tip]').length,
   ph: [...f.querySelectorAll('.mm-num-input')].map(i => i.placeholder),
   blankHints: [...f.querySelectorAll('.mm-field-hint')].filter(h => /^空欄なら/.test(h.textContent.trim())).length,
   solo: solo.length, soloHidden: solo.every(x => { const sp = x.querySelector(':scope>span'); return !sp || getComputedStyle(sp).display === 'none'; }),
   headTips: [...f.querySelectorAll('.mm-fieldgroup>.wl-tip-i')].length,
   cut: [...f.querySelectorAll('.mm-card-txt>small')].filter(x => x.scrollWidth > x.clientWidth + 1).length };
 });
 rec('8) 欄の説明の続きは ⓘ の1つ（`?`は無い）', ed.old === 0 && ed.tips > 0, JSON.stringify(ed));
 rec('8) 空欄のときの値は欄の中の薄い字（「空欄なら…」の説明の行は無い）', ed.ph.includes('40（既定）') && ed.ph.includes('120（既定）') && ed.blankHints === 0, JSON.stringify(ed.ph));
 rec('8) 欄が1つの節は欄の名前を出さず、名前と ⓘ は節の見出しが持つ', ed.solo > 0 && ed.soloHidden && ed.headTips > 0, JSON.stringify(ed));
 rec('8) 札の一言は切れない（右の詳細では折り返す）', ed.cut === 0, JSON.stringify(ed.cut));
 const minF = '#maintEditorForm [data-field="standardMinutes"]';
 await page.focus(minF);
 const hot = await page.evaluate(() => ({ th: !!document.querySelector('#masterMaintList .mm-th.is-hot[data-col="standardMinutes"]'),
  cell: (document.querySelector('#masterMaintList .mm-row.editing>.is-hot') || {}).title || '' }));
 rec('7) 欄に入ると、表の同じ列の見出しと選んだ行のセルが光る', hot.th && !!hot.cell, JSON.stringify(hot));
 await page.fill(minF, '95');
 await W.until(page, () => ((document.querySelector('#masterMaintList .mm-row.editing>.is-hot') || {}).title || '') === '95分', null, { ms: 5000, what: '打った値がセルに出る' });
 rec('7) 打った値はその場で表のセルに出る（保存の前に一覧の見え方が分かる）', true);
 await page.click('#maintEditorCancel');
 await W.until(page, c => ((document.querySelector('#masterMaintList .mm-row.editing>.is-hot') || {}).title || '') === c, hot.cell, { ms: 5000, what: 'キャンセルでセルも戻る' });
 rec('7) キャンセルで表のセルも元へ戻る', true, hot.cell);
 await page.click('#maintEditorClose');
 await W.until(page, () => document.getElementById('maintEditorModal').hidden, null, { ms: 5000, what: '×で閉じる' });
 await openNav('accessPermission');
 const lv = await page.evaluate(() => ({ legend: [...document.querySelectorAll('#masterMaintList .mm-val-legend>span')].map(s => s.textContent.trim()),
  marks: [...document.querySelectorAll('#masterMaintList .mm-row:not(.head) .mm-val-lv')].map(i => i.getAttribute('aria-label')).filter(Boolean).length,
  all: document.querySelectorAll('#masterMaintList .mm-row:not(.head) .mm-val-lv').length }));
 rec('7) 段の値は ●◐○— の印で、凡例が1つあり、印は字（aria-label）も持つ', lv.legend.join(',') === 'できる,一部,見るだけ,できない' && lv.all > 0 && lv.marks === lv.all, JSON.stringify(lv));
 await openNav('equipment');
 const f = await page.evaluate(() => ({ quiet: !!document.querySelector('#masterMaintActs .mm-hd-primary.is-quiet'), grid: document.querySelector('#masterMaintPanel .mm-main').classList.contains('has-pane'), sel: !!document.querySelector('#masterMaintList .mm-row.editing') }));
 rec('6) 閉じれば「追加」は塗りへ戻り、一覧は横いっぱい・行の印も消える', !f.quiet && !f.grid && !f.sel, JSON.stringify(f));
});
