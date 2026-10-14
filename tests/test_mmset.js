/* ============================================================
   test_mmset.js: 設定型のマスタを共通設定と同じ型へ（§9.601・ステップ3・採点で選んだ H 97点）

   利用者の依頼（2026-10-14）「メインにマージして、ステップ3へ進んでください。」——ステップ1・2の型の上に、
   測定データの保存・データ引継ぎ・データ接続・クエリ結合・接続状況・不要ファイル掃除の6画面を載せる。固定すること:
    1. 頭の行は共通設定と同じ: 画面名＋ⓘ＋用途の1行。この端末だけに効く画面は範囲の札「この端末だけ」（灰の札）
    2. 主役の前に説明の帯・箱を置かない（説明は ⓘ）。旧い器（次にすること・注意の帯・件数の帯）が残っていない
    3. 段が2つ以上の画面は、頭の下に全幅の状態の図 → 左の段（共通設定と同じ札・状態の札が字を持つ）
    4. 塗りの主ボタンは頭の右か足元だけ。表の行にボタンを置かない（危ない操作は窓や行のメニューの ⋯ の先）
    5. 押せないボタンは理由を title で言う。保存の道は段に1つ（足元）
    6. 表はステップ2の型（札の行のタブが件数を言う）
    7. 窓の中の ⋯ のメニューを Esc で閉じても、窓は閉じない（1回の Esc で閉じるのは1枚・§9.471）
    8. 入れた後の採点（91点）の指摘: 1536×864 でデータ接続の道が切れない（短い値の列は中身なり・`fit`）／
       どの行でも使えない種類だけの列を並べない（見出しの ⓘ が言う）／一覧の用途の札は窓の選ぶ札と別の名（縁なし）
   ============================================================ */
'use strict';
const H = require('./lib/harness.js');
const W = require('./lib/wait.js');
const B = H.B;

const SCREENS = {
 measStorage: { scope: true, multi: true, table: false },
 importBackup: { scope: true, multi: false },
 dataSource: { scope: false, multi: false },
 queryJoin: { scope: false, multi: false },
 presence: { scope: false, multi: true },
 cleanup: { scope: true, multi: true },
};
/* 旧い器（§9.601 で畳んだ・消した物）。1つでも残っていれば、主役の前に説明の帯・箱がある。 */
const OLD = '.ms-lead,.ms-next,.cl-lead,.cl-top,.cl-next,.mm-import-warning,.mm-imp-state,.ds-summary,.pz-sum,.mm-def-hint,.mm-form-head,.mm-cd-toolbar';

H.run('test_mmset: 設定型のマスタを共通設定と同じ型へ（§9.601）', async ({ page, rec, setMode, idle }) => {
 await page.goto(B + '/', { waitUntil: 'domcontentloaded' }); await W.booted(page);
 await setMode('edit');
 await page.evaluate(() => { try { localStorage.setItem('MasterNavFoldV1', '[]') } catch (e) { /* 覚えを書けない端末では畳んだ群が残るだけ */ } });
 await page.reload({ waitUntil: 'domcontentloaded' }); await W.booted(page);
 await page.click('#openMasterMaint');
 await W.until(page, () => document.body.classList.contains('mm-mode') && !!document.querySelector('#masterMaintNav [data-master].active'), null, { ms: 20000, what: 'マスタ管理' });
 await idle();
 const openNav = async key => {
  await page.evaluate(k => { const b = document.querySelector(`#masterMaintNav [data-master="${k}"]`); if (b) b.scrollIntoView({ block: 'nearest' }); }, key);
  await page.click(`#masterMaintNav [data-master="${key}"]`);
  await W.until(page, k => { const b = document.querySelector(`#masterMaintNav [data-master="${k}"]`); return b && b.classList.contains('active'); }, key, { ms: 15000, what: key });
  /* 押した結果そのもの（その画面の型の器）を待つ（§9.522）。 */
  await W.until(page, () => !!document.querySelector('#masterMaintForm.mm-set .mm-set-body'), null, { ms: 20000, what: key + ' の器' });
  await idle();
 };
 const look = () => page.evaluate(OLDSEL => {
  const form = document.getElementById('masterMaintForm');
  const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
  const chip = document.getElementById('masterMaintLevel'), lead = document.getElementById('masterMaintLead');
  const prim = [...document.querySelectorAll('#masterMaintPanel .mm-main .mm-btn-primary')].filter(vis);
  const panelOf = b => b.closest('.mm-tabpanel') || form;
  const saves = [...form.querySelectorAll('button')].filter(b => /^保存$/.test(b.textContent.trim()));
  const savePanels = new Set(saves.map(panelOf));
  return {
   tip: !!document.querySelector('#masterMaintInfo [data-tip]'),
   lead: !!lead && !lead.hidden && lead.textContent.trim().length > 4,
   scope: chip && !chip.hidden ? { text: chip.textContent.trim(), ro: chip.classList.contains('is-ro') } : null,
   old: [...form.querySelectorAll(OLDSEL)].map(e => e.className),
   set: form.classList.contains('mm-set'),
   fig: !!form.querySelector(':scope>.mm-set-fig'),
   figFirst: (form.firstElementChild || {}).className || '',
   rail: !!form.querySelector('.mm-set-page .mm-tabbar.is-rail'),
   railStates: [...form.querySelectorAll('.mm-set-page .mm-tabbar.is-rail .mm-tab')].map(t => (t.querySelector('.mm-tab-badge') || {}).textContent || ''),
   primOut: prim.filter(b => !b.closest('#masterMaintActs,.mm-set-foot')).map(b => b.textContent.trim()),
   rowBtns: form.querySelectorAll('.mm-row:not(.head) button:not(.wl-tip-i)').length,   // ⓘ は読む物（操作ではない）
   danger: form.querySelectorAll('.mm-btn-danger').length,
   disabledNoWhy: [...form.querySelectorAll('button:disabled')].filter(b => !b.title).map(b => b.textContent.trim()),
   savesPerPanel: saves.length - savePanels.size,
   tabs: [...form.querySelectorAll('.mm-lbar .mm-ltab')].map(t => t.textContent.replace(/\s+/g, '')),
  };
 }, OLD);

 for (const [key, want] of Object.entries(SCREENS)) {
  await openNav(key);
  const v = await look();
  rec(`1) ${key}: 頭の行は画面名＋ⓘ＋用途の1行`, v.tip && v.lead, JSON.stringify({ tip: v.tip, lead: v.lead }));
  rec(`1) ${key}: 範囲の札は${want.scope ? '「この端末だけ」の灰の札' : '出さない'}`,
   want.scope ? !!v.scope && v.scope.text === 'この端末だけ' && v.scope.ro : !v.scope, JSON.stringify(v.scope));
  rec(`2) ${key}: 主役の前に説明の帯・箱を置かない（旧い器が残っていない）`, v.set && !v.old.length, JSON.stringify(v.old));
  if (want.multi) {
   rec(`3) ${key}: 頭の下に全幅の状態の図 → 左の段`, v.fig && /mm-set-fig/.test(v.figFirst) && v.rail, JSON.stringify({ fig: v.fig, first: v.figFirst, rail: v.rail }));
   rec(`3) ${key}: 左の段の札はどれも状態を字で言う`, v.railStates.length >= 2 && v.railStates.every(t => t.trim()), JSON.stringify(v.railStates));
  } else {
   rec(`3) ${key}: 段が1つの画面は左の段を持たない`, !v.rail, String(v.rail));
  }
  rec(`4) ${key}: 塗りの主ボタンは頭の右か足元だけ`, !v.primOut.length, JSON.stringify(v.primOut));
  rec(`4) ${key}: 表の行にボタンを置かない・危ない操作の塗りのボタンを置かない`, v.rowBtns === 0 && v.danger === 0, JSON.stringify({ rowBtns: v.rowBtns, danger: v.danger }));
  rec(`5) ${key}: 押せないボタンは理由を言う・保存の道は段に1つ`, !v.disabledNoWhy.length && v.savesPerPanel === 0, JSON.stringify({ noWhy: v.disabledNoWhy, extra: v.savesPerPanel }));
  if (want.table !== false) rec(`6) ${key}: 表は札の行のタブが件数を言う`, v.tabs.length > 0 && v.tabs.some(t => /\d/.test(t)), JSON.stringify(v.tabs));
 }

 /* ---------- 7) 窓の中の ⋯ と Esc（データ接続の行を開く） ---------- */
 await openNav('dataSource');
 await page.click('#dsList .mm-row[data-set-row]');
 await page.waitForSelector('#maintEditorModal:not([hidden]) #maintEditorMore:not([hidden])', { timeout: 20000 });
 await page.click('#maintEditorMore');
 await page.waitForSelector('#mmActMenu:not([hidden]) [data-ds-act="disable"]', { timeout: 5000 });
 const dis = await page.evaluate(() => document.querySelector('#mmActMenu [data-ds-act="disable"]').classList.contains('is-danger'));
 rec('7) 無効にするは窓の ⋯ の中の危ない操作', dis);
 await page.keyboard.press('Escape');
 await W.until(page, () => !!document.querySelector('#mmActMenu') && document.querySelector('#mmActMenu').hidden, null, { ms: 5000, what: 'メニューが閉じる' });
 const stays = await page.evaluate(() => !document.getElementById('maintEditorModal').hidden);
 rec('7) メニューを Esc で閉じても窓は開いたまま（1回の Esc で閉じるのは1枚）', stays);
 await page.keyboard.press('Escape');
 await W.until(page, () => document.getElementById('maintEditorModal').hidden, null, { ms: 5000, what: '2回目の Esc で窓が閉じる' });
 rec('7) 2回目の Esc で窓が閉じる', true);
 /* 窓を閉じたら ⋯ の中身を次の窓へ持ち越さない（汎用の窓で別の行の操作が出ない）。 */
 const carried = await page.evaluate(() => { const m = document.getElementById('maintEditorModal'); return !!(m && m.__moreItems); });
 rec('7) 閉じた窓の ⋯ の中身を持ち越さない', !carried);

 /* ---------- 8) 入れた後の採点の指摘（§9.601 の 6.） ---------- */
 await page.setViewportSize({ width: 1536, height: 864 });
 try {
  await openNav('queryJoin');
  const qj = await page.evaluate(() => [...document.querySelectorAll('#qjList .mm-row:not(.head) .mm-set-tag')]
   .map(t => ({ t: t.textContent.trim(), b: parseFloat(getComputedStyle(t).borderTopWidth) || 0 })));
  rec('8) クエリ結合: 一覧の札（用途・端）はどれも縁なし（窓の用途の札と同じ名を名乗らない）',
   qj.length > 0 && qj.every(x => x.b === 0), JSON.stringify(qj.filter(x => x.b)));
  /* 描いたときの幅で測る（`fit`）ので、この大きさで開き直してから見る。 */
  await openNav('dataSource');
  const ds = await page.evaluate(() => {
   const rows = [...document.querySelectorAll('#dsList .mm-row:not(.head)')];
   const cut = rows.map(r => r.querySelector('.mm-set-path')).filter(Boolean).map(c => c.parentElement)
    .filter(c => c.scrollWidth > c.clientWidth + 1).map(c => c.textContent.trim().slice(-30));
   const tags = r => r.children[5].querySelectorAll('.mm-set-tag,.mm-set-tag-off');
   const n = rows.length ? tags(rows[0]).length : 0;
   /* 種類（列の中の何番目の札）ごとに、使える札が1行でもあるか。全部の行で薄い字だけの種類は並べない。 */
   const deadCols = [...Array(n).keys()].filter(i => rows.every(r => !(tags(r)[i] && tags(r)[i].classList.contains('mm-set-tag'))));
   const tip = (document.querySelector('#dsList .mm-row.head [data-tip]') || {}).dataset || {};
   return { cut, n, deadCols, tip: tip.tip || '' };
  });
  rec('8) データ接続（1536×864）: いま読んでいる道が切れない', !ds.cut.length, JSON.stringify(ds.cut));
  rec('8) データ接続: どの行でも使えない種類だけの列を並べない（見出しの ⓘ が言う）',
   ds.n > 0 && !ds.deadCols.length && /使える/.test(ds.tip), JSON.stringify(ds));
 } finally { await page.setViewportSize({ width: 1600, height: 1000 }); }
}, { viewport: { width: 1600, height: 1000 } });
