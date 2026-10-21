/* test_filtersavedui.js: 一覧の絞り込み（§9.614・ゼロから作り直した）
   ============================================================
   利用者の言葉「フィルタのボタン幅が無駄に大きく、表示のみになって使えないボタンがある。登録したフィルタの
   再編集もできないため、使えない。EXCELのような重複のない項目からチェックするだけで使えるフィルタも欲しい。
   登録内容からのプリセットへの組み立てもわかりづらいので完全にゼロからフィルタ機能をデザインも機能も作り直してください」。

   物差し（直す前の値は §9.614 の表）:
    M1 作る入口は「列の値の一覧」の1つ（見出しの ▼・帯の「＋ 条件」・札を押す が同じ面を開く）
    M2 「製造材質が A か B」: 見出しの ▼ → 2つ選ぶ → 絞り込む の3手（値ごとに件数が出る）
    M3 保存したフィルタを直せる（✎ 直す で名前・条件・見える人・いつも適用・削除）
    M4 2条件の保存したフィルタ: 条件を入れて「＋ 名前を付けて保存」の1手＋名前
    M5 押しても何も起きない・押せない形のボタンが帯に無い（帯の押す物は全部、押すと何かが開く・変わる）
    M6 帯は 1536 でも1段目に収まる（切れて押せない物が無い）。押す物の高さは帯の1つ（30px）
    D  保存した条件と違えば「変更あり」と、札ごとに 足した／変えた／外した を字で言う。外した札を押すと戻る
   WAVELOG_SHOT=<dir> を付けたときだけ画面を撮る（見た目の確かめ用）。
   ============================================================ */
'use strict';
const H = require('./lib/harness.js');
const W = require('./lib/wait.js');
const B = H.B;
const SHOT = process.env.WAVELOG_SHOT || '';
const path = require('path');
const TAG = '網UI' + String(Date.now()).slice(-6);

/* 帯（1段目＋2段目）の押す物と、はみ出した物 */
function measureBar() {
 const vis = e => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1 && !e.closest('[hidden],.wl-menu') && getComputedStyle(e).visibility !== 'hidden'; };
 const roots = [document.querySelector('#genericFilterBar .filter-search-row'), document.getElementById('listToolbar')].filter(Boolean);
 const TOP = 'button,label.lt-search,.list-pager';
 const ctl = roots.flatMap(r => [...r.querySelectorAll(TOP)]).filter(vis).filter(e => !e.parentElement.closest(TOP) || e.matches('.flt-chip-main,.flt-chip-x'));
 const name = e => (e.id ? '#' + e.id : String(e.className).split(' ')[0]) + '「' + (e.textContent || '').trim().slice(0, 10) + '」';
 const cut = ctl.filter(e => { const r = e.getBoundingClientRect(); const pr = e.closest('.filter-search-row,#listToolbar').getBoundingClientRect();
  return r.right > pr.right + 1 || r.left < pr.left - 1 || r.right > window.innerWidth; }).map(name);
 const row1 = document.querySelector('#genericFilterBar .filter-search-row');
 const kids = row1 ? [...row1.children].filter(vis) : [];
 const tops = [...new Set(kids.map(e => Math.round(e.getBoundingClientRect().top)))];
 const outer = ctl.filter(e => !e.matches('.flt-chip-main,.flt-chip-x,.lt-search *'));
 return { h: [...new Set(outer.map(e => Math.round(e.getBoundingClientRect().height)))].sort(), n: ctl.length, cut,
  rows1: tops.length, names: outer.map(name), odd: outer.filter(e => Math.round(e.getBoundingClientRect().height) !== 30).map(e => name(e) + Math.round(e.getBoundingClientRect().height)) };
}

const name = () => document.getElementById('filterSavedName').textContent.trim();
const isShown = sel => { const e = document.querySelector(sel); return !!e && e.getClientRects().length > 0 && !e.closest('[hidden]'); };
/* 値が2〜30種類ある列を1つ選ぶ（フィクスチャの顔ぶれを網へ書かない・testing.md） */
async function pickColumn(page, skip, min = 3) {
 return page.evaluate(async ([skip, min]) => {
  for (const c of S.columns.filter(c => !c.startsWith('__') && !skip.includes(c))) {
   const r = await (await fetch('/api/table/slicer?' + new URLSearchParams({ db: S.db, table: S.table, column: c }))).json();
   const vs = (r.values || []).filter(v => v.value !== '');
   if (vs.length >= min && vs.length <= 30 && !r.truncated && document.querySelector(`#grid thead th[data-col="${CSS.escape(c)}"]`)) return { column: c, values: vs };
  }
  return null;
 }, [skip || [], min]);
}
async function savedOnServer(page, id) {
 return page.evaluate(async id => { const r = await (await fetch('/api/filter-presets?' + new URLSearchParams({ db: S.db, table: S.table, mode: '', user: currentUserId() }))).json();
  return (r.items || []).find(x => String(x.id) === String(id)) || null; }, id);
}
/* 列の値の一覧で「この値だけ」を選んで絞り込む（すべて選ぶ を外す → 値を押す → 絞り込む） */
async function pickValues(page, W, values) {
 await W.until(page, () => document.querySelectorAll('#filterColPop [data-v]').length > 0, null, { ms: 10000, what: '値の一覧' });
 await page.click('#filterColPop [data-all]');
 for (const v of values) await page.click(`#filterColPop [data-v="${v}"]`);
 await page.click('#filterColPop [data-act="ok"]');
 await W.until(page, () => !document.getElementById('filterColPop'), null, { ms: 5000, what: '値の一覧が閉じる' });
}
async function settled(page, W) { await W.until(page, () => !document.querySelector('#grid.is-loading') && document.querySelectorAll('#grid tbody tr').length > 0, null, { ms: 20000, what: '一覧の読み直し' }); }
async function shotStates(page, W, shot, tag) {
 const pc = await pickColumn(page);
 await page.hover(`#grid thead th[data-col="${pc.column}"]`);
 await page.click(`#grid thead th[data-col="${pc.column}"] .col-funnel`);
 await W.until(page, () => document.querySelectorAll('#filterColPop [data-v]').length > 0, null, { ms: 10000, what: '値の一覧' });
 await shot(`colpop_${tag}`);
 await page.keyboard.press('Escape');
 await page.click('#filterSavedBtn');
 await W.until(page, isShown, '#filterSavedMenu', { ms: 5000, what: '保存したフィルタの面' });
 await page.waitForTimeout(400); // 固定待ち: 件数は裏で1件ずつ数える（撮るためだけ・判定に使わない）
 await shot(`savedmenu_${tag}`);
 const edit = await page.$('#filterSavedMenu [data-edit]');
 if (edit) { await edit.click(); await W.until(page, isShown, '#appConfirmModal', { ms: 5000, what: '直す窓' }); await shot(`edit_${tag}`); await page.click('#appConfirmCancel'); }
 else await page.keyboard.press('Escape');
}
async function flow(page, rec, W, shot, made) {
 const pc = await pickColumn(page);
 rec('前提: 値が3〜30種類の列がある', !!pc, JSON.stringify(pc && pc.column));
 if (!pc) return;
 const col = pc.column, [v1, v2] = [pc.values[0].value, pc.values[1].value];
 const want = pc.values[0].count + pc.values[1].count;
 /* ---- M1・M2 見出しの ▼ → 値を選ぶ → 絞り込む ---- */
 const hidden0 = await page.evaluate(c => getComputedStyle(document.querySelector(`#grid thead th[data-col="${CSS.escape(c)}"] .col-funnel`)).visibility, col);
 await page.hover(`#grid thead th[data-col="${col}"]`);
 const shown = await page.evaluate(c => getComputedStyle(document.querySelector(`#grid thead th[data-col="${CSS.escape(c)}"] .col-funnel`)).visibility, col);
 rec('M1 見出しの ▼ は乗せる前から見えている（入口を探させない）', hidden0 === 'visible' && shown === 'visible', `${hidden0} → ${shown}`);
 await page.click(`#grid thead th[data-col="${col}"] .col-funnel`);
 await W.until(page, () => document.querySelectorAll('#filterColPop [data-v]').length > 0, null, { ms: 10000, what: '値の一覧' });
 const pop = await page.evaluate(() => [...document.querySelectorAll('#filterColPop .flt-cp-item:not(.is-all)')].map(x => ({ v: x.querySelector('[data-v]').dataset.v, n: x.querySelector('.flt-cp-n').textContent.trim(), on: x.querySelector('input').checked })));
 rec('M2 値の一覧は重複のない値と件数を出し、最初は全部選んでいる', pop.length === pc.values.length && pop.every(x => /\d/.test(x.n) && x.on), JSON.stringify(pop.slice(0, 4)));
 rec('M5 条件の無い列の値の一覧に「この列の条件を外す」は出ない（押しても何も起きない物を置かない）', !(await page.$('#filterColPop [data-act="clear"]')));
 await shot('colpop_1728');
 await pickValues(page, W, [v1, v2]);
 await settled(page, W);
 const st1 = await page.evaluate(c => ({ chips: [...document.querySelectorAll('#filterChips .flt-chip')].map(x => x.textContent.replace(/\s+/g, ' ').trim()),
  count: document.getElementById('count').textContent.trim(), th: document.querySelector(`#grid thead th[data-col="${CSS.escape(c)}"]`).classList.contains('col-filtered'),
  on: !!document.querySelector(`#grid thead th[data-col="${CSS.escape(c)}"] .col-funnel.is-on`), conds: WL.filters.state().conds }), col);
 rec('M2 絞り込むと条件の札が1つ（列と選んだ値。長ければ「ほかN」で畳み、切らない）', st1.chips.length === 1 && st1.chips[0].includes(v1) && (st1.chips[0].includes(v2) || /ほか1/.test(st1.chips[0])), JSON.stringify(st1.chips));
 rec('M2 件数は選んだ値の件数の和（n件 / 全 N件）', new RegExp('^' + want.toLocaleString() + '件\\s*/\\s*全').test(st1.count), `${st1.count}（期待 ${want}件）`);
 rec('M2 絞った列は見出しの ▼ が塗られて残る', st1.th && st1.on, JSON.stringify({ th: st1.th, on: st1.on }));
 rec('M2 条件は「値を選ぶ（in）」の1つ', st1.conds.length === 1 && st1.conds[0].op === 'in' && st1.conds[0].value.length === 2, JSON.stringify(st1.conds));
 /* ---- M4 名前を付けて保存（1手＋名前） ---- */
 const nm = TAG + 'の2値';
 await page.click('#filterChange [data-fc="saveas"]');
 await W.until(page, isShown, '#appConfirmModal', { ms: 5000, what: '名前を付けて保存の窓' });
 await page.fill('#appConfirmBody input', nm);
 await page.click('#appConfirmOk');
 await W.until(page, n => document.getElementById('filterSavedName').textContent.trim() === n, nm, { ms: 10000, what: '保存したフィルタが選ばれる' });
 const sel = await page.evaluate(() => WL.filters.state());
 if (sel.selected) made.push(sel.selected.id);
 const srv = sel.selected && await savedOnServer(page, sel.selected.id);
 rec('M4 名前を付けて保存すると帯の「フィルタ」がその名前で、変更なし', !!sel.selected && !sel.dirty && await page.evaluate(() => document.getElementById('filterChange').hidden), JSON.stringify(sel));
 rec('M4 マスタに条件ごと入る', !!srv && JSON.stringify(srv.filters) === JSON.stringify(st1.conds.map(({ key: _k, ...f }) => f)), JSON.stringify(srv && srv.filters));
 /* ---- D 外した → 「外した」の札・変更あり → 札を押すと戻る。1段目の席は動かない ---- */
 const row1 = () => page.evaluate(() => ['filterSavedBtn', 'filterAddCond', 'listSlicerBtn', 'listMarkBtn'].map(id => { const e = document.getElementById(id); return e ? Math.round(e.getBoundingClientRect().left) : -1; }).join(','));
 const r1a = await row1();
 await page.click('#filterChips .flt-chip-x');
 await settled(page, W);
 const d1 = await page.evaluate(() => ({ removed: [...document.querySelectorAll('#filterChips .flt-chip.is-removed')].map(x => x.textContent.trim()),
  word: (document.querySelector('#filterChange .flt-chg-word') || {}).textContent || '', state: WL.filters.state() }));
 const r1b = await row1();
 rec('D 「変更あり」が出ても1段目の押す物の席は動かない', r1a === r1b, `${r1a} → ${r1b}`);
 rec('D 外した条件は「外した」の札で残り、「変更あり」と言う', d1.removed.length === 1 && /外した/.test(d1.removed[0]) && d1.word === '変更あり' && d1.state.dirty, JSON.stringify(d1));
 await shot('dirty_removed_1728');
 await page.click('#filterChips .flt-chip.is-removed .flt-chip-main');
 await settled(page, W);
 const d2 = await page.evaluate(() => WL.filters.state());
 rec('D 「外した」の札を押すと戻り、変更なしに戻る', !d2.dirty && d2.conds.length === 1, JSON.stringify(d2));
 /* ---- 「＋ 条件」→ 列を選ぶ → 値の一覧 → 足した札 → 上書き保存 ---- */
 const pc2 = await pickColumn(page, [col], 2);
 rec('前提: 値が2種類以上の列がもう1つある', !!pc2, '');
 if (!pc2) return;
 await page.click('#filterAddCond');
 await W.until(page, isShown, '.flt-col-pick', { ms: 5000, what: '列を選ぶ面' });
 await page.fill('.flt-col-pick input', pc2.column);
 await page.click(`.flt-col-pick [data-col="${pc2.column}"]`);
 await W.until(page, () => document.querySelectorAll('#filterColPop [data-v]').length > 0, null, { ms: 10000, what: '値の一覧（2つ目）' });
 await page.click(`#filterColPop [data-v="${pc2.values[0].value}"]`);  // 1つだけ外す（not_in）
 await page.click('#filterColPop [data-act="ok"]');
 await settled(page, W);
 const d3 = await page.evaluate(() => ({ added: [...document.querySelectorAll('#filterChips .flt-chip.is-added')].map(x => x.textContent.replace(/\s+/g, ' ').trim()), state: WL.filters.state() }));
 rec('M1 「＋ 条件」も同じ値の一覧へ行き、1つ外すと「除く（not_in）」の条件', d3.state.conds.some(f => f.column === pc2.column && f.op === 'not_in' && f.value.length === 1), JSON.stringify(d3.state.conds));
 rec('D 足した条件は「足した」の札で、変更あり', d3.added.length === 1 && /足した/.test(d3.added[0]) && d3.state.dirty, JSON.stringify(d3.added));
 await shot('dirty_added_1728');
 await page.click('#filterChange [data-fc="overwrite"]');
 await W.until(page, () => !WL.filters.state().dirty, null, { ms: 10000, what: '上書き保存' });
 const srv2 = await savedOnServer(page, sel.selected.id);
 rec('上書き保存でマスタの条件が2つになる', srv2 && srv2.filters.length === 2, JSON.stringify(srv2 && srv2.filters));
 /* ---- 戻す ---- */
 await page.click('#filterChips .flt-chip-x');
 await settled(page, W);
 await page.click('#filterChange [data-fc="revert"]');
 await settled(page, W);
 const d4 = await page.evaluate(() => WL.filters.state());
 rec('「戻す」で保存した条件へ戻る', !d4.dirty && d4.conds.length === 2, JSON.stringify(d4));
 /* ---- M3 ✎ 直す（名前・値を1つ外す） ---- */
 await page.click('#filterSavedBtn');
 await W.until(page, isShown, '#filterSavedMenu', { ms: 5000, what: '保存したフィルタの面' });
 await page.waitForTimeout(400); // 固定待ち: 件数は裏で1件ずつ数える（撮るためだけ・判定に使わない）
 await shot('savedmenu_1728');
 await page.click(`#filterSavedMenu [data-edit="${sel.selected.id}"]`);
 await W.until(page, isShown, '#appConfirmModal .flt-ed', { ms: 5000, what: '直す窓' });
 await shot('edit_1728');
 const nm2 = nm + '（直した）';
 await page.fill('#appConfirmBody .flt-ed-name', nm2);
 await page.click(`#appConfirmBody .flt-ed-row[data-i="0"] [data-unv="${v2}"]`);
 await page.click('#appConfirmOk');
 await W.until(page, n => document.getElementById('filterSavedName').textContent.trim() === n, nm2, { ms: 10000, what: '直した名前' });
 const srv3 = await savedOnServer(page, sel.selected.id);
 const d5 = await page.evaluate(() => WL.filters.state());
 rec('M3 ✎ 直す で名前と条件を直せる（マスタ）', srv3 && srv3.name === nm2 && JSON.stringify(srv3.filters[0].value) === JSON.stringify([v1]), JSON.stringify(srv3));
 rec('M3 選んでいる保存を直すと、当てている条件もそろう', !d5.dirty && d5.conds.some(f => f.column === col && JSON.stringify(f.value) === JSON.stringify([v1])), JSON.stringify(d5.conds));
 /* ---- M5 帯に押せない形のボタンが無い ---- */
 const dead = await page.evaluate(() => [...document.querySelectorAll('#genericFilterBar button,#filterChips button')].filter(b => b.disabled && b.getClientRects().length).map(b => b.textContent.trim()));
 rec('M5 帯に押せない形のボタンが無い', dead.length === 0, dead.join(' / '));
 /* ---- 削除（窓の中で2手） ---- */
 await page.click('#filterSavedBtn');
 await W.until(page, isShown, '#filterSavedMenu', { ms: 5000, what: '保存したフィルタの面' });
 await page.click(`#filterSavedMenu [data-edit="${sel.selected.id}"]`);
 await W.until(page, isShown, '#appConfirmModal .flt-ed', { ms: 5000, what: '直す窓（削除）' });
 await page.click('#appConfirmBody [data-del="1"]');
 await page.click('#appConfirmBody [data-del="2"]');
 await W.until(page, () => document.getElementById('filterSavedName').textContent.trim() === 'なし', null, { ms: 10000, what: '削除して選択が外れる' });
 const srv4 = await savedOnServer(page, sel.selected.id);
 rec('削除するとマスタから消え、帯は「なし」', !srv4, JSON.stringify(srv4));
 /* 後片付け: 条件を外す */
 await page.click('#clearGenericFilters');
 await settled(page, W);
}

H.run('test_filtersavedui: 一覧の絞り込み（§9.614）', async ({ page, rec, setMode, errs }) => {
 const shot = async (n, clip) => { if (!process.env.WAVELOG_SHOT) return; await W.paint(page); await page.screenshot({ path: path.join(SHOT, n + '.png'), ...(clip ? { clip } : {}) }); };
 const made = [];
 await setMode('edit');
 try {
  for (const vp of [{ width: 1728, height: 1152 }, { width: 1536, height: 864 }]) {
   await page.setViewportSize(vp);
   await page.goto(B + '/', { waitUntil: 'domcontentloaded' }); await W.booted(page);
   await page.click('[data-db-key="SIKALOTNOW"]');
   await W.until(page, () => document.querySelectorAll('#grid tbody tr').length > 0, null, { ms: 30000, what: '仕掛一覧' });
   const m = await page.evaluate(measureBar);
   rec(`M6 ${vp.width}: 帯の押す物が帯の中に収まる`, m.cut.length === 0, m.cut.join(' '));
   rec(`M6 ${vp.width}: 1段目は1行（折り返さない）`, m.rows1 === 1, JSON.stringify(m));
   rec(`M6 ${vp.width}: 押す物の高さは1つ（30px）`, m.h.length === 1 && m.h[0] === 30, JSON.stringify(m.odd));
   await shot(`bar_${vp.width}`);
  }
  await page.setViewportSize({ width: 1728, height: 1152 });
  await flow(page, rec, W, shot, made);
  /* ---------- 1536 でも同じ面が切れずに出る（撮るだけ・形は上で見た） ---------- */
  if (process.env.WAVELOG_SHOT) {
   await page.setViewportSize({ width: 1536, height: 864 });
   await page.reload({ waitUntil: 'domcontentloaded' }); await W.booted(page);
   await page.click('[data-db-key="SIKALOTNOW"]');
   await W.until(page, () => document.querySelectorAll('#grid tbody tr').length > 0, null, { ms: 30000, what: '仕掛一覧（1536）' });
   await shotStates(page, W, shot, '1536');
   /* 作業スケジュールに並べた狭い仕掛一覧（分割）も撮る */
   await page.evaluate(() => { localStorage.setItem('AccessMeasurementConfiguredEquipment', 'テスト設備A');
    localStorage.setItem('scLayoutPrefsV1', JSON.stringify({ swap: false, open: 'split' })); });
   await setMode('schedule');
   for (const vp of [{ width: 1728, height: 1152 }, { width: 1536, height: 864 }]) {
    await page.setViewportSize(vp);
    await page.goto(B + '/', { waitUntil: 'domcontentloaded' }); await W.booted(page);
    await W.openSchedule(page, 'テスト設備A');
    await W.until(page, () => document.querySelectorAll('#grid tbody tr').length > 0, null, { ms: 30000, what: 'スケジュールの仕掛一覧' });
    await shot(`split_${vp.width}`);
   }
   await setMode('edit');
  }
 } finally {
  if (made.length) await page.evaluate(async ids => { for (const id of ids) await fetch('/api/filter-presets/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }).catch(() => {}); }, made);
 }
 rec('画面のJSエラーが出ていない', errs.length === 0, errs.slice(0, 3).join(' / '));
}, { viewport: { width: 1728, height: 1152 } });
