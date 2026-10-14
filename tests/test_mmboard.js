/* ============================================================
   test_mmboard.js: 盤のマスタを1つの型へ（§9.602・ステップ4・採点で選んだ J 97点）

   利用者の依頼（2026-10-14）「メインにマージして、ステップ4へ進んでください。」——ステップ1〜3の型の上に、
   操業データ項目・記録した値の配置・選択肢の値・選択肢の親子・帳票レイアウト・換算係数・設備停止の時間の7画面を載せる。固定すること:
    1. 頭の行は画面名＋ⓘ＋用途の1行。頭と主役のあいだに帯（`.op-bar`）を持たない（`#masterMaintForm`は空で伏せる）
    2. 保存の結果は頭の知らせ（`#masterMaintSay`）の1か所。画面ごとの知らせの器（#opLayoutState など6つ）は無い
    3. 面は枠で囲まない（盤・候補・まとまり・値・木・表・詳細・要約の数・目盛り）
    4. 選んだ行は淡い地＋左の帯、1つだけ選ぶ切り替えは青緑の塗りの1つの部品（`.mm-seg`）
    5. 行・札に危ない操作（✕・削除）を出しっぱなしにしない（乗せたときだけ・または ⋯ の先）
    6. 画面ごと: 対象の札の行・必須の札・盤の切り替え（掴んで札へ運ぶと開く）・群の ⋯・足元の保存・右の詳細・流れの図・矢印の木・
       紙の縮図・係数の字が切れない・1本の目盛り
   ============================================================ */
'use strict';
const H = require('./lib/harness.js');
const W = require('./lib/wait.js');
const B = H.B;

const SCREENS = ['opItem', 'recordLayout', 'opChoice', 'choiceLink', 'reportLayout', 'loadFactor', 'stopMinutes'];
/* 面（§9.602 で枠を外した器）。3辺以上に線が引かれていれば「枠で囲んだ」と数える。 */
const PANES = '.op-board,.rl-pool,.rl-board,.oc-groups,.oc-values,.cl-pool,.cl-tree,.cl-box,.rly-blocks,.rly-detail,.lf-box,.lf-kpi,.smn-ruler,.smn-wrap';
const OLD_SAY = '#opLayoutState,#rlState,#ocState,#clState,#rlyState,#smnState';
const TAG = 'MB' + Date.now().toString(36).slice(-5);

H.run('test_mmboard: 盤のマスタを1つの型へ（§9.602）', async ({ page, rec, setMode, idle }) => {
 const post = (p, b) => page.evaluate(([u, x]) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(x) }).then(r => r.json().catch(() => ({}))), [p, b]);
 const made = [];
 await page.goto(B + '/', { waitUntil: 'domcontentloaded' }); await W.booted(page);
 await setMode('edit');
 await page.evaluate(() => { try { localStorage.setItem('MasterNavFoldV1', '[]'); localStorage.setItem('AccessMeasurementUserId', 'tests') } catch (e) { /* 覚えを書けない端末では畳んだ群が残るだけ */ } });
 try {
  /* 材料: 親子を1本（フィクスチャは親子を持たない）。後片付けは finally。 */
  for (const [n, v] of [[TAG + '親', 'A'], [TAG + '子', 'a']]) {
   const r = await post('/api/operation-choice-master', { name: n, value: v, order: 0, enabledText: '出す', user_id: 'tests' });
   if (r && r.id) made.push(r.id);
  }
  await post('/api/choice-link-master', { parent: TAG + '親', child: TAG + '子', user_id: 'tests' });

  await page.reload({ waitUntil: 'domcontentloaded' }); await W.booted(page);
  await page.click('#openMasterMaint');
  await W.until(page, () => document.body.classList.contains('mm-mode') && !!document.querySelector('#masterMaintNav [data-master].active'), null, { ms: 20000, what: 'マスタ管理' });
  await idle();
  const READY = {
   opItem: '.op-boardbar', recordLayout: '.rl-foot', opChoice: '.oc-flow', choiceLink: '.cl-tree-body',
   reportLayout: '.rly-detail', loadFactor: '#masterMaintList .mm-scopebar', stopMinutes: '.smn-wrap',
  };
  const openNav = async key => {
   await page.evaluate(k => { const b = document.querySelector(`#masterMaintNav [data-master="${k}"]`); if (b) b.scrollIntoView({ block: 'nearest' }); }, key);
   await page.click(`#masterMaintNav [data-master="${key}"]`);
   await W.until(page, k => { const b = document.querySelector(`#masterMaintNav [data-master="${k}"]`); return b && b.classList.contains('active'); }, key, { ms: 15000, what: key });
   /* 押した結果そのもの（その画面の器）を待つ（§9.522）。 */
   await W.until(page, s => !!document.querySelector(s), READY[key], { ms: 20000, what: key + ' の器' });
   await idle();
  };
  /* トークンの色を計算済みの色へ（比べるのは計算済みの値どうし）。 */
  const tokenColor = name => page.evaluate(n => { const d = document.createElement('div'); d.style.background = `var(${n})`; document.body.append(d); const c = getComputedStyle(d).backgroundColor; d.remove(); return c; }, name);
  const tint = await tokenColor('--teal-tint'), teal = await tokenColor('--teal');

  const look = () => page.evaluate(([PANESEL, OLDSEL]) => {
   const form = document.getElementById('masterMaintForm'), lead = document.getElementById('masterMaintLead');
   const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
   const sides = e => { const s = getComputedStyle(e); return ['Top', 'Right', 'Bottom', 'Left'].filter(k => parseFloat(s['border' + k + 'Width']) > 0 && s['border' + k + 'Style'] !== 'none' && !/rgba\(0, 0, 0, 0\)/.test(s['border' + k + 'Color'])).length; };
   const boxed = [...document.querySelectorAll('#masterMaintList ' + PANESEL.split(',').join(',#masterMaintList '))].filter(vis).filter(e => sides(e) >= 3).map(e => e.className);
   /* 出しっぱなしの危ない操作（見えていて、乗せなくても読める物）。 */
   const always = [...document.querySelectorAll('#masterMaintList .rl-chip-x,#masterMaintList .cl-chip-del,#masterMaintList .smn-tick button,#masterMaintList .oc-del,#masterMaintList .rly-act,#masterMaintList .smn-chip button')]
    .filter(vis).filter(e => parseFloat(getComputedStyle(e).opacity) > 0.01).length;
   return {
    tip: !!document.querySelector('#masterMaintInfo [data-tip]'),
    lead: !!lead && !lead.hidden && lead.textContent.trim().length > 4,
    band: !!document.querySelector('.op-bar'),
    formEmpty: !form || form.hidden || !form.textContent.trim(),
    say: !!document.getElementById('masterMaintSay'),
    oldSay: [...document.querySelectorAll(OLDSEL)].map(e => e.id),
    boxed, always,
   };
  }, [PANES, OLD_SAY]);

  /* ---------- 1)〜3)・5) 7画面に共通の型 ---------- */
  for (const key of SCREENS) {
   await openNav(key);
   const v = await look();
   rec(`1) ${key}: 頭の行は画面名＋ⓘ＋用途の1行`, v.tip && v.lead, JSON.stringify({ tip: v.tip, lead: v.lead }));
   rec(`1) ${key}: 頭と主役のあいだに帯を持たない`, !v.band && v.formEmpty, JSON.stringify({ band: v.band, formEmpty: v.formEmpty }));
   rec(`2) ${key}: 結果は頭の知らせの1か所（画面ごとの知らせの器が無い）`, v.say && !v.oldSay.length, JSON.stringify(v.oldSay));
   rec(`3) ${key}: 面を枠で囲まない`, !v.boxed.length, JSON.stringify(v.boxed));
   rec(`5) ${key}: 危ない操作を出しっぱなしにしない（乗せたときだけ・⋯ の先）`, v.always === 0, String(v.always));
  }

  /* ---------- 6a) 操業データ項目 ---------- */
  await openNav('opItem');
  const op = await page.evaluate(() => {
   const st = document.getElementById('masterMaintState');
   const segs = [...document.querySelectorAll('.op-boardseg [data-op-board]')];
   const boards = [...document.querySelectorAll('#masterMaintList .op-board')];
   return {
    state: st && !st.hidden ? st.textContent.trim() : '',
    scope: [...document.querySelectorAll('#masterMaintList .mm-scopebar [data-mm-scope]')].map(b => b.textContent.trim()),
    segs: segs.map(b => b.textContent.replace(/\s+/g, '')), boards: boards.length, shown: boards.filter(b => !b.hidden).length,
    bands: document.querySelectorAll('#masterMaintList .op-band').length,
    gmore: document.querySelectorAll('#masterMaintList .op-band [data-op-gmore]').length,
    loose: document.querySelectorAll('#masterMaintList [data-op-gspan],#masterMaintList [data-op-rename],#masterMaintList [data-op-fold]').length,
    legend: (document.querySelector('.op-boardbar .op-auto-legend') || {}).textContent || '',
   };
  });
  rec('6a) 操業データ項目: 頭の状態の札が必須の数を言う', /^必須 \d+\/\d+/.test(op.state), op.state);
  rec('6a) 操業データ項目: 対象は札の行（共通＋設備）', op.scope[0] === '共通' && op.scope.length >= 2, JSON.stringify(op.scope));
  rec('6a) 操業データ項目: 盤の切り替えが盤の数だけあり、名前と項目数を言う・見える盤は1つ',
   op.segs.length === op.boards && op.boards >= 2 && op.segs.every(t => /\d+項目/.test(t)) && op.shown === 1, JSON.stringify(op));
  rec('6a) 操業データ項目: 群の道具は ⋯ の1つ（幅・名前・畳むを帯に並べない）', op.bands > 0 && op.gmore === op.bands && op.loose === 0, JSON.stringify({ bands: op.bands, gmore: op.gmore, loose: op.loose }));
  rec('6a) 操業データ項目: 凡例は盤の上の1行の右（分類名と件数）', /自動\s*\d+件|仕掛から\s*\d+件/.test(op.legend), op.legend.slice(0, 60));
  /* 押して切り替える・掴んだカードを札へ運ぶと開く（描き直さない＝運んでいる物を失わない）。 */
  const sw = await page.evaluate(() => {
   const segs = [...document.querySelectorAll('.op-boardseg [data-op-board]')];
   const shownPlace = () => (document.querySelector('#masterMaintList .op-board:not([hidden])') || { dataset: {} }).dataset.opPlace;
   const a = shownPlace();
   segs[1].click();
   const b = shownPlace();
   segs[0].click();
   const tile = document.querySelector('#masterMaintList .op-board:not([hidden]) .op-tile');
   const dt = new DataTransfer();
   tile.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
   segs[1].dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
   const c = shownPlace(), same = document.body.contains(tile);
   tile.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
   segs[0].click();
   return { a, b, c, same, want: segs[1].dataset.opBoard };
  });
  rec('6a) 操業データ項目: 札を押すと盤が替わる', sw.b === sw.want && sw.a !== sw.b, JSON.stringify(sw));
  rec('6a) 操業データ項目: 掴んだカードを札へ運ぶとその盤が開く（運んでいる物は残る）', sw.c === sw.want && sw.same, JSON.stringify(sw));
  /* 群の ⋯ はメニューで幅・名前・畳むを出す。 */
  await page.click('#masterMaintList .op-band [data-op-gmore]');
  const gm = await page.evaluate(() => [...document.querySelectorAll('#mmActMenu:not([hidden]) button')].map(b => b.textContent.trim()));
  rec('6a) 操業データ項目: 群の ⋯ は幅・名前を出す', gm.some(t => /^幅/.test(t)) && gm.some(t => /名前/.test(t)), JSON.stringify(gm));
  await page.keyboard.press('Escape');
  await page.click('#opAdd');
  const am = await page.evaluate(() => [...document.querySelectorAll('#mmActMenu:not([hidden]) [data-op-add]')].map(b => b.dataset.opAdd));
  rec('6a) 操業データ項目: 「＋ 項目を追加 ▾」は項目・群・空きカード・自動で入る値', ['item', 'group', 'pad', 'auto'].every(k => am.includes(k)), JSON.stringify(am));
  await page.keyboard.press('Escape');

  /* ---------- 6b) 記録した値の配置 ---------- */
  await openNav('recordLayout');
  const rl = await page.evaluate(() => ({
   foot: (document.querySelector('.rl-foot .pc-dirty') || {}).textContent || '',
   save: !!(document.getElementById('rlSave') || {}).disabled,
   pick: !!document.querySelector('.rl-pool #rlEqPick'),
   label: (document.querySelector('.rl-poolpick span') || {}).textContent || '',
  }));
  rec('6b) 記録した値の配置: 保存は足元（変更が無いうちは押せない）', /変更なし/.test(rl.foot) && rl.save, JSON.stringify(rl));
  rec('6b) 記録した値の配置: 候補を絞る設備は候補の頭（「候補を設備で絞る」）', rl.pick && /候補を設備で絞る/.test(rl.label), JSON.stringify(rl));
  /* 盤を触ったら足元が「変更あり」、離れる前に聞く（黙って捨てない）。 */
  await page.click('.rl-board .rl-chip .rl-chip-x');   // 人と同じ道（乗せると出る ✕ を押す）
  const rd = await page.evaluate(() => ({ foot: (document.querySelector('.rl-foot .pc-dirty') || {}).textContent || '', save: !(document.getElementById('rlSave') || {}).disabled }));
  rec('6b) 記録した値の配置: 触ると足元が「変更あり」で保存が押せる', /変更あり/.test(rd.foot) && rd.save, JSON.stringify(rd));
  await page.click('#masterMaintNav [data-master="opChoice"]');
  const asked = await page.waitForSelector('#appConfirmModal:not([hidden])', { timeout: 5000 }).then(() => true).catch(() => false);
  rec('6b) 記録した値の配置: 保存していない並びは離れる前に聞く', asked);
  if (asked) await page.click('#appConfirmCancel');
  await page.click('#rlCancel');

  /* ---------- 6c) 選択肢の値 ---------- */
  await openNav('opChoice');
  const oc = await page.evaluate(() => ({
   grp: (document.querySelector('.oc-flow .oc-node.is-grp') || {}).textContent || '',
   head: (document.querySelector('.oc-values-head h3') || {}).textContent || '',
   addIn: !!document.querySelector('.oc-table-scroll #ocAddValue'),
   rowBtns: document.querySelectorAll('.oc-row[data-oc-id] button,.oc-row[data-oc-id] input').length,
   prim: (document.querySelector('#masterMaintActs .mm-hd-primary') || {}).textContent || '',
  }));
  rec('6c) 選択肢の値: 使っている項目 → まとまり → 値の流れを図で言う', !!oc.grp && oc.grp === oc.head, JSON.stringify(oc));
  rec('6c) 選択肢の値: 「＋ 値を追加」は表の最後・行に押す物を置かない', oc.addIn && oc.rowBtns === 0, JSON.stringify(oc));
  rec('6c) 選択肢の値: 主の操作は「＋ まとまりを追加」', /まとまりを追加/.test(oc.prim), oc.prim);
  await page.click('.oc-row[data-oc-id]');
  await W.until(page, () => { const m = document.getElementById('maintEditorModal'); return !!m && !m.hidden && m.classList.contains('is-docked'); }, null, { ms: 8000, what: '右の詳細' });
  const on = await page.evaluate(([t]) => { const r = document.querySelector('.oc-row.is-on'); return r ? getComputedStyle(r).backgroundColor : ''; }, [tint]);
  rec('4) 選択肢の値: 押した行は淡い地（右の詳細で直している行）', on === tint, JSON.stringify({ on, tint }));
  /* 入れたあとの採点（§9.602 の 6.）: 2択は分割の切り替え・出る設備は一覧の字と同じ状態・欄の下の説明は1行まで。 */
  const det = await page.evaluate(() => {
   const f = document.getElementById('maintEditorForm');
   const inner = f.querySelector('[data-tagfield="equipment"] .mm-tagfield-inner');
   const lines = [...f.querySelectorAll('.mm-field-hint')].filter(h => h.getClientRects().length).map(h => {
    const cs = getComputedStyle(h); const line = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.6;
    return Math.round(h.getBoundingClientRect().height / line);
   });
   return { seg: f.querySelectorAll('[data-seg="enabledText"]').length, sel: f.querySelectorAll('select[data-field="enabledText"]').length,
    scopeAll: !!f.querySelector('[data-equipment-scope="equipment"][data-v="all"].is-on'), innerHidden: !!inner && inner.hidden, lines };
  });
  rec('6c) 選択肢の値: 詳細の「出す」は分割の切り替え（2択をプルダウンにしない）', det.seg === 2 && det.sel === 0, JSON.stringify(det));
  rec('6c) 選択肢の値: 出る設備は一覧と同じ状態（空欄の行は「すべての設備」・設備の欄は絞るときだけ）', det.scopeAll && det.innerHidden, JSON.stringify(det));
  rec('6c) 選択肢の値: 欄の下の説明は1行まで（続きは見出しの ⓘ）', det.lines.length > 0 && det.lines.every(n => n <= 1), JSON.stringify(det.lines));
  await page.click('[data-equipment-scope="equipment"][data-v="pick"]');
  const pickOpen = await page.evaluate(() => !document.querySelector('[data-tagfield="equipment"] .mm-tagfield-inner').hidden);
  await page.click('[data-equipment-scope="equipment"][data-v="all"]');
  const scopeBack = await page.evaluate(() => ({ hidden: document.querySelector('[data-tagfield="equipment"] .mm-tagfield-inner').hidden,
   foot: (document.getElementById('maintEditorHint') || {}).textContent || '' }));
  rec('6c) 選択肢の値: 「設備で絞る」で設備の欄が開き、「すべての設備」に戻すと変更なしのまま', pickOpen && scopeBack.hidden && /変更なし/.test(scopeBack.foot), JSON.stringify({ pickOpen, scopeBack }));
  await page.click('#maintEditorForm [data-seg="enabledText"][data-seg-v="出さない"]');
  const segDirty = await page.evaluate(() => (document.getElementById('maintEditorHint') || {}).textContent || '');
  rec('6c) 選択肢の値: 切り替えを押すと足元が「変更あり」', /変更あり/.test(segDirty), segDirty);
  await page.click('#maintEditorCancel');
  await W.until(page, () => /変更なし/.test((document.getElementById('maintEditorHint') || {}).textContent || ''), null, { ms: 5000, what: 'キャンセルで変更なしへ戻る' });
  await page.click('#maintEditorClose');
  await W.until(page, () => document.getElementById('maintEditorModal').hidden, null, { ms: 5000, what: '詳細を閉じる' });
  const g = await page.evaluate(() => { const r = document.querySelector('.oc-group.is-on'); return r ? getComputedStyle(r).backgroundColor : ''; });
  rec('4) 選択肢の値: 選んだまとまりは淡い地（濃い塗りで選ばない）', g === tint, JSON.stringify({ g, tint }));
  /* 表は中身なりの幅で止める（器が広くても「—」だけの列が空きを抱えない）。頭・流れの図も同じ右端。 */
  const ocw = await page.evaluate(() => {
   const v = document.querySelector('.oc-values'), t = document.querySelector('.oc-table'), h = document.querySelector('.oc-values-head');
   return { pane: Math.round(v.getBoundingClientRect().width), table: Math.round(t.getBoundingClientRect().width),
    headR: Math.round(h.getBoundingClientRect().right), tableR: Math.round(t.getBoundingClientRect().right) };
  });
  rec('6c) 選択肢の値: 表は中身なりの幅で止まり、頭も同じ右端', ocw.table < ocw.pane && Math.abs(ocw.headR - ocw.tableR) <= 1, JSON.stringify(ocw));

  /* ---------- 6d) 選択肢の親子 ---------- */
  await openNav('choiceLink');
  const cl = await page.evaluate(t => {
   const box = [...document.querySelectorAll('.cl-box[data-cl-parent]')].find(b => b.dataset.clParent === t + '親');
   return { tree: !!box && !!box.querySelector('.cl-tree-row .cl-node.is-parent') && !!box.querySelector('.cl-edge') && !!box.querySelector('.cl-kids .cl-node'),
    newBox: !!document.querySelector('.cl-box-new'), menu: !!document.querySelector('#masterMaintActs #clCreate[aria-haspopup]') };
  }, TAG);
  rec('6d) 選択肢の親子: 親 → 矢印 → 子の木で描く', cl.tree, JSON.stringify(cl));
  rec('6d) 選択肢の親子: 選んでいないうちは新しい親の破線の箱を出さない・「＋ 親子をつくる ▾」で親を選ぶ', !cl.newBox && cl.menu, JSON.stringify(cl));

  /* ---------- 6e) 帳票レイアウト ---------- */
  await openNav('reportLayout');
  const ry = await page.evaluate(() => {
   const shown = document.querySelectorAll('.rly-row[data-rly-key]:not(.is-off)').length;
   return { tabs: document.querySelectorAll('#masterMaintList .mm-scopebar [data-mm-scope]').length,
    mini: document.querySelectorAll('.rly-mini-blk').length, shown,
    sel: (document.querySelector('.rly-row.is-on') || { dataset: {} }).dataset.rlyKey || '',
    miniSel: document.querySelectorAll('.rly-mini-blk.is-on').length,
    seg: (() => { const b = document.querySelector('.rly-grid .mm-seg>button.is-on'); return b ? getComputedStyle(b).backgroundColor : ''; })(),
    rowBtns: document.querySelectorAll('.rly-row[data-rly-key] button,.rly-row[data-rly-key] select').length };
  });
  rec('6e) 帳票レイアウト: 紙（設備）は対象の札の行', ry.tabs >= 2, String(ry.tabs));
  rec('6e) 帳票レイアウト: 右の詳細の縮図は出す塊の数だけ・選んだ塊が光る', ry.mini === ry.shown && ry.miniSel <= 1 && !!ry.sel, JSON.stringify(ry));
  rec('6e) 帳票レイアウト: 表の行に押す物を置かない（直すのは右の詳細）', ry.rowBtns === 0, String(ry.rowBtns));
  rec('4) 帳票レイアウト: 紙の割りの切り替えは青緑の塗り（紺にしない）', ry.seg === teal, JSON.stringify({ seg: ry.seg, teal }));
  /* 入れたあとの採点（§9.602 の 6.）: 「出す 16」は表の頭の1か所・紙の割りの行は表の右端で止まる・高さの欄は値を1回だけ言う。 */
  const ry2 = await page.evaluate(() => {
   const head = document.querySelector('.rly-blocks-head'), tbl = document.querySelector('.rly-table');
   const twice = [...document.querySelectorAll('.rly-dform select option')].map(o => o.textContent)
     .filter(t => { const m = t.match(/\d+\/\d+/g) || []; return new Set(m).size < m.length; });
   return { mini: (document.querySelector('.rly-mini-k') || {}).textContent || '',
    headR: Math.round(head.getBoundingClientRect().right), tableR: Math.round(tbl.getBoundingClientRect().right), twice };
  });
  rec('6e) 帳票レイアウト: 出す数は表の頭の1か所（縮図の頭で言い直さない）', !/出す/.test(ry2.mini), ry2.mini);
  rec('6e) 帳票レイアウト: 紙の割りの行は表の右端で止まる', Math.abs(ry2.headR - ry2.tableR) <= 1, JSON.stringify(ry2));
  rec('6e) 帳票レイアウト: 詳細の選択肢は同じ値を2回言わない', ry2.twice.length === 0, JSON.stringify(ry2.twice));
  /* 詳細で変えたら表の行と縮図がその場で動く（保存の前に紙での見え方が分かる）→ キャンセルで戻る。 */
  const live = await page.evaluate(() => {
   const before = document.querySelectorAll('.rly-mini-blk').length;
   document.querySelector('[data-rly-d-shown="0"]').click();
   const after = document.querySelectorAll('.rly-mini-blk').length;
   const foot = (document.querySelector('.rly-foot .pc-dirty') || {}).textContent || '';
   document.getElementById('rlyCancel').click();
   return { before, after, foot, back: document.querySelectorAll('.rly-mini-blk').length };
  });
  rec('6e) 帳票レイアウト: 詳細で「出さない」にすると縮図からその場で消え、足元が「変更あり」・キャンセルで戻る',
   live.after === live.before - 1 && /変更あり/.test(live.foot) && live.back === live.before, JSON.stringify(live));

  /* ---------- 6f) 換算係数 ---------- */
  await openNav('loadFactor');
  const lf = await page.evaluate(() => {
   const svg = document.querySelector('#lfForest svg');
   let over = null;
   if (svg) {
    const W = svg.viewBox.baseVal.width;
    over = [...svg.querySelectorAll('text')].map(t => { const b = t.getBBox(); return b.x + b.width - W; }).filter(d => d > 0.5).length;
   }
   return { tabs: document.querySelectorAll('#masterMaintList .mm-scopebar [data-mm-scope]').length, more: !!document.getElementById('masterMaintMore'), forest: !!svg, over };
  });
  rec('6f) 換算係数: 設備は対象の札の行・再計算は頭の ⋯', lf.tabs >= 1 && lf.more, JSON.stringify(lf));
  if (lf.forest) rec('6f) 換算係数: 係数の効き目の字が図の右端で切れない', lf.over === 0, JSON.stringify(lf));
  else rec('6f) 換算係数: 係数の効き目は測っていない（この設備に係数が無い・フィクスチャに完了実績が無い）', true, '');

  /* ---------- 6g) 設備停止の時間 ---------- */
  await openNav('stopMinutes');
  const sm = await page.evaluate(() => ({
   ticks: document.querySelectorAll('.smn-ruler .smn-tick[data-smn-min]').length,
   band: !!document.querySelector('.smn-ruler .smn-band'),
   n: Number(((document.querySelector('.smn-count') || {}).textContent || '').replace(/\D/g, '')),
   old: document.querySelectorAll('.smn-chip,.smn-card,input[type=range]').length,
  }));
  rec('6g) 設備停止の時間: 選べる時間は1本の目盛りの点（札の並びと見本のスライダーを2枚にしない）', sm.ticks === sm.n && sm.n > 0 && sm.old === 0, JSON.stringify(sm));
  rec('6g) 設備停止の時間: 帯がスライダーの範囲（選択肢が2件以上のとき）', sm.n < 2 || sm.band, JSON.stringify(sm));
 } finally {
  /* 後片付けは自分が作った物だけ（§9.121）。 */
  try {
   const links = await page.evaluate(() => fetch('/api/choice-link-master').then(r => r.json()));
   for (const x of (links.items || [])) if (String(x.parent).startsWith(TAG) || String(x.child).startsWith(TAG)) await post('/api/choice-link-master/delete', { id: x.id, user_id: 'tests' });
  } catch (e) { /* 片付けの失敗は次の実行の名指しで分かる */ }
  for (const id of made) { try { await post('/api/operation-choice-master/delete', { id, user_id: 'tests' }); } catch (e) { /* 同上 */ } }
 }
}, { viewport: { width: 1600, height: 1000 } });
