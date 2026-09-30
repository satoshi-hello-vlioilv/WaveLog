/* test_screenprint.js: 画面をそのまま1枚へ刷る（§9.525、利用者の指示）。

   「刃組ガイダンスの表示画面を左のメニューを除いた見た目そのままを印刷できる機能を
     実装してください。A4横のレイアウトが良いです。」

   前（実測・ヘッダーの「画面を印刷」＝ブラウザの印刷そのまま）:
     用紙は縦・左メニューも刷れる・右の「刃組の内訳」が図の下へ回る（紙の幅で組み直す）・
     断面図（WebGL）が白い。
   固定するのは6つ:
    ① ボタンの説明が「何がどう刷られるか」（A4横・左メニューを除く）を言う
    ② 刷る直前の姿: A4横の`@page`・縦横の比を保って1枚に入る倍率・WebGLの図は絵に差し替え
    ③ 紙: **1枚・A4横**（PDFの MediaBox で見る）
    ④ 紙の上で左メニューが伏せてあり、「刃組の内訳」が図の横に居る（画面と同じ並び）
    ⑤ 刷り終わったら元へ戻る（印・倍率・絵・`@page`が残らない）
    ⑥ 印刷を名乗らない画面は今までどおりブラウザの印刷（ほかの画面の動きを変えない） */
const H = require('./lib/harness.js');
const W = require('./lib/wait.js');
const B = H.B;
const EQ = 'テスト設備A';

H.run('test_screenprint: 刃組ガイダンスを見た目のままA4横へ（§9.525）', async ({ page, rec, idle, errs }) => {
 await fetch(B + '/api/bladeset/seed', { method: 'POST', headers: { 'Content-Type': 'application/json' },
   body: JSON.stringify({ equipment: EQ }) }).catch(() => {});
 await page.goto(B + '/', { waitUntil: 'domcontentloaded' });
 await W.booted(page);
 await page.evaluate(eq => WL.bladeGuide.open({ equipment: eq, seed: { thickness: 1.2, originalWidth: 1130,
   lots: [{ name: 'SP1', w: 50, n: 22, parent: 'SP1' }], headLot: '' } }), EQ);
 await W.until(page, () => /方式/.test(document.querySelector('#bsHold2')?.textContent || ''), null, { ms: 20000, what: 'ガイダンスが開く' });
 await idle(400, 15000); await W.paint(page);

 const hint = await page.evaluate(() => document.getElementById('printCurrentView')?.title || '');
 rec('① 「画面を印刷」の説明が、A4横・左メニューを除くと言う', /A4横/.test(hint) && /左のメニューを除いた/.test(hint), hint);

 const prep = await page.evaluate(() => {
  const vis = [...document.querySelectorAll('.layout > main canvas')].filter(c => c.width && c.height && c.getClientRects().length).length;
  window.__undo = WL.printCurrentView({ dryRun: true });
  const m = document.querySelector('.layout > main');
  const g = k => m.style.getPropertyValue(k);
  return { cls: document.body.classList.contains('screen-print'), title: document.title,
   zoom: +g('--print-zoom'), w: parseFloat(g('--print-w')), h: parseFloat(g('--print-h')),
   canvases: vis, snaps: document.querySelectorAll('img.print-snap').length,
   blank: [...document.querySelectorAll('img.print-snap')].filter(i => (i.src || '').length < 2000).length,
   page: document.getElementById('bsPrintPage')?.textContent || '' };
 });
 const MMPX = 25.4 / 96, useW = (297 - 16) / MMPX, useH = (210 - 16) / MMPX;
 rec('② 用紙はA4横・余白8mm（`@page`）', prep.page === '@page{size:297mm 210mm;margin:8mm}', prep.page);
 rec('② 縦横の比を保って1枚に入る倍率（大きくはしない）',
     prep.zoom > 0 && prep.zoom <= 1 && prep.w * prep.zoom <= useW + 1 && prep.h * prep.zoom <= useH + 1,
     JSON.stringify({ zoom: prep.zoom, w: prep.w, h: prep.h }));
 rec('② WebGLの図は刷る直前に絵へ差し替える（白く刷らない）', prep.snaps === prep.canvases && prep.blank === 0,
     JSON.stringify({ canvases: prep.canvases, snaps: prep.snaps, blank: prep.blank }));
 rec('② 題（PDFのファイル名）は画面名と設備', /^刃組ガイダンス_テスト設備A_\d{8}_\d{4}$/.test(prep.title), prep.title);

 /* **紙の幅で**並びを見る——刷るときの「窓の幅」は紙の刷れる幅（A4横で約1062px）なので、
    画面の幅のまま測ると、紙の上でだけ効く幅の条件（`max-width`）を見逃す（実際に見逃した）。 */
 await page.setViewportSize({ width: Math.floor(useW), height: Math.floor(useH) });
 await page.emulateMedia({ media: 'print' }); await W.paint(page);
 const onPaper = await page.evaluate(() => {
  const shown = e => !!e && getComputedStyle(e).display !== 'none' && e.getClientRects().length > 0;
  const rail = document.getElementById('bsRail')?.getBoundingClientRect();
  const col = document.querySelector('.bs-body > .bs-col')?.getBoundingClientRect();
  return { aside: shown(document.querySelector('.layout > aside')), side: !!(rail && col && rail.left >= col.right - 2 && rail.top < col.bottom) };
 });
 const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
 await page.emulateMedia({ media: 'screen' });
 await page.setViewportSize({ width: 1728, height: 1152 });
 const txt = pdf.toString('latin1');
 const pages = (txt.match(/\/Type\s*\/Page[^s]/g) || []).length;
 const box = (txt.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/) || []).slice(1).map(Number);
 rec('③ 紙は1枚・A4横（PDFの MediaBox 842×595pt）', pages === 1 && Math.abs(box[0] - 841.89) < 2 && Math.abs(box[1] - 595.28) < 2,
     JSON.stringify({ pages, box }));
 rec('④ 紙の上で左メニューは伏せてある', onPaper.aside === false);
 rec('④ 「刃組の内訳」は図の横（画面と同じ並び・紙の幅で組み直さない）', onPaper.side === true, JSON.stringify(onPaper));

 const after = await page.evaluate(() => {
  window.__undo && window.__undo();
  const m = document.querySelector('.layout > main');
  return { cls: document.body.classList.contains('screen-print'), snaps: document.querySelectorAll('img.print-snap').length,
   hidden: document.querySelectorAll('canvas.print-hide').length, zoom: m.style.getPropertyValue('--print-zoom'),
   page: !!document.getElementById('bsPrintPage'), title: document.title };
 });
 rec('⑤ 刷り終わったら元へ戻る（印・倍率・絵・用紙の指定が残らない）',
     !after.cls && !after.snaps && !after.hidden && !after.zoom && !after.page && !/刃組ガイダンス_/.test(after.title), JSON.stringify(after));

 /* ⑥ 印刷を名乗らない画面（一覧）はブラウザの印刷のまま。`window.print`を数えて確かめる。 */
 await page.click('aside [data-db-key="SIKALOTNOW"]');
 await W.until(page, () => WL.currentView === 'list', null, { ms: 10000, what: '一覧へ' });
 const plain = await page.evaluate(() => {
  let n = 0; const orig = window.print; window.print = () => { n++; };
  try { WL.printCurrentView(); } finally { window.print = orig; }
  return { n, cls: document.body.classList.contains('screen-print'),
   hint: document.getElementById('printCurrentView')?.title || '' };
 });
 rec('⑥ 印刷を名乗らない画面はブラウザの印刷をそのまま呼ぶ', plain.n === 1 && !plain.cls, JSON.stringify(plain));
 rec('⑥ その画面のボタンの説明は今までの字に戻る', /そのまま印刷します/.test(plain.hint) && !/A4横/.test(plain.hint), plain.hint);
 rec('コンソールに例外が出ない', errs.length === 0, errs.slice(0, 3).join(' / '));
}, { mode: 'edit', viewport: { width: 1728, height: 1152 } });
