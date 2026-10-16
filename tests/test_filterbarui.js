/* test_filterbarui.js: 一覧の絞り込みの帯（§9.612・利用者の指示）
   ============================================================
   利用者の言葉「仕掛一覧などの表示をフィルタをかけて絞り込み操作する部分のボタンが小さすぎることと
   検索バーが無駄に長すぎること、ボタンが押せないものがあるなど不具合があり、フィルタの状態が確認できない」
   「フィルタの見栄えは別リポジトリの LotScope の感じ大きさや見た目が使いやすい…機能を削らないよう注意しながら移植」。

   物差し（評価関数）。単独の仕掛一覧と、作業スケジュールに並べた仕掛一覧の両方で測る:
    F1 押す物の高さ・字（LotScope の帯＝30px・13.5px。どちらの器でも同じ寸法）
    F2 検索欄の幅は LotScope の 300px 以下（伸びて余りを食わない）
    F3 帯の押す物が帯の中に収まる（切れて押せない物が無い・1536 と 1728）
    F4 条件の数は「一覧を検索」の字とスライサーの選択も数える（効いている物が1つの数で読める）
    F5 件数は絞ったら「n件 / 全 N件」
    F6 スライサーだけで0件にしても「条件を外して全件を見る」で戻る
    F7 色付けの下書きが今の一覧に無い列なら、押す前に今の一覧の列へ戻っている（黙って空振りしない）
    F8 この表に無い列（結合した列など）の条件は黙って捨てず、応答が「効いていない」と言う
    H1 作業スケジュールの仕掛一覧は、予定に入れた（まだ終わっていない）ロットを伏せる（比べるのは鍵 __lotKey）
    H2 伏せている決まりと件数が帯の札で見える（押すと見分け方の列・伏せたロットの面）
    H3 「仕掛一覧と同じ条件」で、元データの一覧で当てた条件がスケジュールの仕掛一覧にも効く（切ると戻る）
    H4 スケジュールを出たら、左メニューの仕掛一覧は何も伏せない
   WAVELOG_SHOT=<dir> を付けたときだけ帯を撮る（見た目の確かめ用）。
   ============================================================ */
'use strict';
const H = require('./lib/harness.js');
const W = require('./lib/wait.js');
const B = H.B;
const EQ = 'テスト設備A';
const SHOT = process.env.WAVELOG_SHOT || '';
const path = require('path');

/* 帯（1段目＋2段目）の寸法を測る。押す物＝帯の中の外側の器（中の部品は数えない）。 */
function measureBar() {
 const bar = document.getElementById('genericFilterBar');
 const tb = document.getElementById('listToolbar');
 const vis = e => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1 && !e.closest('[hidden],.wl-menu') && getComputedStyle(e).visibility !== 'hidden'; };
 const roots = [bar && bar.querySelector('.filter-search-row'), tb].filter(Boolean);
 const TOP = 'button,label.lt-search,.list-pager,.list-join-chip,.list-tint-chip,.list-load-chip';
 const ctl = roots.flatMap(r => [...r.querySelectorAll(TOP)]).filter(vis).filter(e => !e.parentElement.closest(TOP));
 const br = (bar || tb).getBoundingClientRect();
 const box = r => ({ l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom) });
 const name = e => (e.id ? '#' + e.id : e.className.toString().split(' ')[0]) + '「' + (e.textContent || '').trim().slice(0, 8) + '」';
 /* 帯の外へはみ出した・器（overflow:hidden）に切られた押す物 */
 const cut = ctl.filter(e => { const r = e.getBoundingClientRect(); const pr = e.closest('.filter-search-row,#listToolbar').getBoundingClientRect();
   return r.right > pr.right + 1 || r.left < pr.left - 1 || r.right > window.innerWidth; }).map(name);
 const search = document.querySelector('#genericFilterBar .lt-search');
 /* 字0の器（短い名乗りを ::after で出す札）は数えない */
 const fs = ctl.map(e => parseFloat(getComputedStyle(e).fontSize)).filter(f => f > 0);
 return { h: [...new Set(ctl.map(e => Math.round(e.getBoundingClientRect().height)))].sort(),
          fs: [...new Set(fs)].sort(), n: ctl.length, cut,
          searchW: search && vis(search) ? Math.round(search.getBoundingClientRect().width) : -1,
          bar: box(br) };
}

H.run('test_filterbarui: 一覧の絞り込みの帯（§9.612）', async ({ page, rec, setMode }) => {
 const shot = async (n) => { if (process.env.WAVELOG_SHOT) await shotBar(n); };
 const shotBar = async (n) => { const el = await page.$('#genericFilterBar'); const tb = await page.$('#listToolbar');
  const a = el && await el.boundingBox(), b = tb && await tb.boundingBox();
  if (!a) return; const y = a.y, h = (b ? b.y + b.height : a.y + a.height) - y;
  await page.screenshot({ path: path.join(SHOT, n + '.png'), clip: { x: 0, y: Math.max(0, y - 8), width: page.viewportSize().width, height: h + 16 } }); };
 /* ---------- 単独の仕掛一覧（利用者の PC の見え方・1728×1152） ---------- */
 await setMode('edit');
 for (const vp of [{ width: 1728, height: 1152 }, { width: 1536, height: 864 }]) {
  await page.setViewportSize(vp);
  await page.goto(B + '/', { waitUntil: 'domcontentloaded' }); await W.booted(page);
  await page.click('[data-db-key="SIKALOTNOW"]');
  await W.until(page, () => document.querySelectorAll('#grid tbody tr').length > 0, null, { ms: 30000, what: '単独の仕掛一覧' });
  const m = await page.evaluate(measureBar);
  const tag = `単独・${vp.width}`;
  rec(`F1 ${tag}: 押す物は高さ30px以上・字13.5px以上の1種`, m.h.length === 1 && m.h[0] >= 30 && m.fs.length === 1 && m.fs[0] >= 13.5, JSON.stringify(m));
  rec(`F2 ${tag}: 検索欄は300px以下`, m.searchW > 0 && m.searchW <= 300, `${m.searchW}px`);
  rec(`F3 ${tag}: 押す物が帯の中に収まる`, m.cut.length === 0, m.cut.join(' '));
  await shot(`solo_${vp.width}`);
 }
 /* ---------- 状態の見え方（F4・F5） ---------- */
 await page.setViewportSize({ width: 1728, height: 1152 });
 const before = await page.evaluate(() => ({ n: (document.getElementById('filterCount') || {}).textContent || '', cnt: (document.querySelector('#listToolbar .list-count,#listCount') || {}).textContent || '' }));
 await page.fill('#search', 'ZZZ_NOT_FOUND_ZZZ');
 await W.until(page, () => /0\s*件|該当/.test((document.getElementById('grid') || {}).textContent || '') || document.querySelectorAll('#grid tbody tr[data-row]').length === 0, null, { ms: 10000, what: '検索で絞る' });
 const after = await page.evaluate(() => ({ n: (document.getElementById('filterCount') || {}).textContent || '', bar: (document.getElementById('listToolbar') || {}).textContent.replace(/\s+/g, ' ').trim().slice(0, 160) }));
 rec('F4 一覧を検索の字も条件の数に入る', Number(after.n) > Number(before.n || 0), `前 ${before.n} → 後 ${after.n}`);
 rec('F5 絞ったら件数は「n件 / 全 N件」', /\d+\s*件\s*\/\s*全\s*[\d,]+\s*件/.test(after.bar), after.bar);
 await shot('state_search');
 await page.fill('#search', '');
 await W.until(page, () => document.querySelectorAll('#grid tbody tr').length > 1, null, { ms: 10000, what: '検索を外す' });
 /* ---------- F8 この表に無い列の条件は黙って捨てず「効いていない」と返す ---------- */
 const ign = await page.evaluate(async () => { const q = new URLSearchParams({ db: S.db, table: S.table, page: 1, page_size: 1,
  filters: JSON.stringify([{ column: '結合で足した列', op: 'eq', value: 'x' }]) }); const d = await (await fetch('/api/table?' + q)).json();
  return { ign: d.filtersIgnored, all: d.countAll, n: d.count }; });
 rec('F8 この表に無い列の条件は filtersIgnored で返り、件数は絞る前の数も返る', (ign.ign || []).includes('結合で足した列') && ign.all >= ign.n && ign.all > 0, JSON.stringify(ign));
 /* ---------- F6 スライサーだけで0件 → 「条件を外して全件を見る」で戻る ---------- */
 await page.evaluate(() => { const s = `${S.db}:${S.table}`; const col = S.columns[0];
  localStorage.setItem('wl.listSlicer.v1', JSON.stringify({ tables: { [s]: { open: false, cards: [{ column: col, sel: ['__無い値__'] }] } } })); });
 await page.reload({ waitUntil: 'domcontentloaded' }); await W.booted(page);
 await page.click('[data-db-key="SIKALOTNOW"]');
 await W.until(page, () => !!document.querySelector('#grid [data-empty-clear]'), null, { ms: 30000, what: 'スライサーで0件' });
 const sx = await page.evaluate(() => ({ n: (document.getElementById('filterCount') || {}).textContent || '',
  conds: [...document.querySelectorAll('#grid .list-empty-conds li')].map(x => x.textContent.trim()) }));
 rec('F4 スライサーの選択も条件の数に入る', Number(sx.n) >= 1, `条件 ${sx.n}`);
 rec('F6a 0件の案内がスライサーを効いている条件として名乗る', sx.conds.some(t => /スライサー/.test(t)), sx.conds.join(' / '));
 await shot('state_slicer0');
 await page.click('#grid [data-empty-clear]');
 const back = await W.until(page, () => !document.querySelector('#grid [data-empty-clear]') && document.querySelectorAll('#grid tbody tr').length > 1, null, { ms: 10000, what: '全件に戻る' }).then(() => true, () => false);
 rec('F6b 「条件を外して全件を見る」でスライサーも外れて行が戻る', back);
 await page.evaluate(() => localStorage.removeItem('wl.listSlicer.v1'));
 /* ---------- F7 色付けの下書きは一覧を替えたら今の一覧の列へ戻る ---------- */
 const MARK_KEY = await page.evaluate(() => Object.keys(localStorage).filter(k => /mark/i.test(k)));
 await page.click('#listMarkBtn');
 await W.until(page, () => { const m = document.getElementById('listMarkMenu'); return m && !m.hidden; }, null, { ms: 5000, what: '色付けの面' });
 await page.keyboard.press('Escape');
 await page.click('[data-db-key="SIKALOTDEF"]');
 await W.until(page, () => S.db === 'SIKALOTDEF' && document.querySelectorAll('#grid tbody tr').length > 0, null, { ms: 30000, what: '品質データの一覧' });
 await page.click('#listMarkBtn');
 await W.until(page, () => { const m = document.getElementById('listMarkMenu'); return m && !m.hidden; }, null, { ms: 5000, what: '色付けの面（品質）' });
 await page.fill('#listMarkMenu .mk-make input[data-mk-k="value"]', 'x');
 await page.click('#listMarkMenu [data-mk-make]');
 const mk = await page.evaluate(() => { const t = [...document.querySelectorAll('#listMarkMenu .mk-text')].map(x => x.textContent.trim());
  const last = t[t.length - 1] || ''; return { last, ok: (S.columns || []).some(c => last.startsWith(c)) }; });
 rec('F7 色付けは今の一覧の列で作られる（前の一覧の列で黙って空振りしない）', mk.ok, mk.last);
 await page.keyboard.press('Escape');
 await page.evaluate(ks => { Object.keys(localStorage).filter(k => /mark/i.test(k) && !ks.includes(k)).forEach(k => localStorage.removeItem(k)); }, MARK_KEY);
 /* ---------- 作業スケジュールに並べた仕掛一覧 ---------- */
 await page.evaluate(e => { localStorage.setItem('AccessMeasurementConfiguredEquipment', e);
  localStorage.setItem('scLayoutPrefsV1', JSON.stringify({ swap: false, open: 'split' })); }, EQ);
 await setMode('schedule');
 for (const vp of [{ width: 1728, height: 1152 }, { width: 1536, height: 864 }]) {
  await page.setViewportSize(vp);
  await page.goto(B + '/', { waitUntil: 'domcontentloaded' }); await W.booted(page);
  await W.openSchedule(page, EQ);
  await W.until(page, () => document.querySelectorAll('#grid tbody tr').length > 0, null, { ms: 30000, what: 'スケジュールの仕掛一覧' });
  const m = await page.evaluate(measureBar);
  const tag = `スケジュール・${vp.width}`;
  rec(`F1 ${tag}: 押す物は高さ30px以上・字13.5px以上の1種`, m.h.length === 1 && m.h[0] >= 30 && m.fs.length === 1 && m.fs[0] >= 13.5, JSON.stringify(m));
  rec(`F3 ${tag}: 押す物が帯の中に収まる`, m.cut.length === 0, m.cut.join(' '));
  await shot(`sched_${vp.width}`);
  /* ポップアップで開いた仕掛一覧（器が広いので検索欄が余りを食いやすい） */
  await page.click('#scListModalBtn');
  await W.until(page, () => !!document.querySelector('.sc-float-body #genericFilterBar'), null, { ms: 10000, what: 'ポップアップの仕掛一覧' });
  const p = await page.evaluate(measureBar);
  rec(`F1 ポップアップ・${vp.width}: 押す物は高さ30px以上・字13.5px以上の1種`, p.h.length === 1 && p.h[0] >= 30 && p.fs.length === 1 && p.fs[0] >= 13.5, JSON.stringify(p));
  rec(`F2 ポップアップ・${vp.width}: 検索欄は300px以下`, p.searchW > 0 && p.searchW <= 300, `${p.searchW}px`);
  rec(`F3 ポップアップ・${vp.width}: 押す物が帯の中に収まる`, p.cut.length === 0, p.cut.join(' '));
  await shot(`float_${vp.width}`);
  await page.click('#scListModalBtn');
 }
 /* ---------- H1・H2: 予定に入れたロットを伏せる・決まりが見える ---------- */
 await page.setViewportSize({ width: 1728, height: 1152 });
 await page.goto(B + '/', { waitUntil: 'domcontentloaded' }); await W.booted(page);
 await W.openSchedule(page, EQ);
 await W.until(page, () => document.querySelectorAll('#grid tbody tr').length > 0, null, { ms: 30000, what: 'スケジュールの仕掛一覧' });
 const h = await page.evaluate(() => {
  const set = WL.scheduleView.hiddenLotSet() || new Set();
  const planned = WL.scheduleView.entries().filter(e => e.kind === '作業' && e.state === '予定' && e.lotKey).map(e => e.lotKey);
  const shown = [...document.querySelectorAll('#grid tbody tr')].length;
  return { keyed: (S.rows || []).filter(r => r.__lotKey).length, rows: (S.rows || []).length, planned: planned.length,
           allHidden: planned.every(k => set.has(k)), leak: (S.rows || []).filter(r => planned.includes(r.__lotKey)).length,
           visibleLeak: WL.lotHide ? WL.lotHide.hiddenRows().length : -1, shown };
 });
 rec('H1 仕掛一覧の行はロットの鍵を持ち、予定に入れたロットは伏せる', h.keyed === h.rows && h.rows > 0 && h.planned > 0 && h.allHidden, JSON.stringify(h));
 const chip = await page.evaluate(() => { const c = document.getElementById('lotHideChip'); return c && !c.hidden ? c.textContent.replace(/\s+/g, ' ').trim() : ''; });
 rec('H2 帯に「予定と同じロットを伏せる N件」の札', /予定と同じロットを伏せる\s*\d+/.test(chip), chip);
 if (chip) {
  await page.click('#lotHideChip');
  await W.until(page, () => { const m = document.getElementById('lotHidePanel'); return m && !m.hidden && /同じロットとみなす列/.test(m.textContent); }, null, { ms: 8000, what: '見分け方の面' });
  const panel = await page.evaluate(() => document.getElementById('lotHidePanel').textContent.replace(/\s+/g, ' ').trim());
  rec('H2 面に見分け方の列（ロット番号・鋳造番号・製造材質）と伏せている件数', /ロット番号/.test(panel) && /鋳造番号/.test(panel) && /伏せているロット\s*\d+件/.test(panel), panel);
  await shot('lothide_panel');
  await page.keyboard.press('Escape');
 }
 /* ---------- H3: 仕掛一覧と同じ条件（「条件」の札が字で名乗り、面の中で切り替える） ---------- */
 const scope0 = await page.evaluate(() => (document.querySelector('#filterCondBtn .fb-cond-scope') || {}).textContent || '');
 rec('H3 「条件」の札がいまの条件の置き場を字で言う（スケジュール用）', scope0 === 'スケジュール用', scope0);
 await page.click('#filterCondBtn');
 await W.until(page, () => !!document.querySelector('#filterCondMenu:not([hidden]) [data-link-set="1"]'), null, { ms: 8000, what: '条件の面のつなぎ' });
 await page.click('#filterCondMenu [data-link-set="1"]');
 await W.until(page, () => ((document.querySelector('#filterCondBtn .fb-cond-scope') || {}).textContent || '') === '仕掛一覧と同じ', null, { ms: 8000, what: 'つないだ' });
 const linkedKey = await page.evaluate(() => JSON.parse(localStorage.getItem('wl.filterLink.v1') || '{}'));
 rec('H3 面の中で「仕掛一覧と同じ」に切り替わり、利用者×一覧ごとに覚える', JSON.stringify(linkedKey).includes('true'), JSON.stringify(linkedKey));
 await page.click('#filterCondMenu [data-link-set="0"]').catch(async () => { await page.click('#filterCondBtn'); await page.click('#filterCondMenu [data-link-set="0"]'); });
 await W.until(page, () => ((document.querySelector('#filterCondBtn .fb-cond-scope') || {}).textContent || '') === 'スケジュール用', null, { ms: 8000, what: '切った' });
 rec('H3 切るとスケジュール用に戻る', true);
 await page.keyboard.press('Escape');
 /* ---------- H4: スケジュールを出たら伏せない ---------- */
 await page.click('[data-db-key="SIKALOTNOW"]');
 await W.until(page, () => !document.body.classList.contains('sc-mode') && document.querySelectorAll('#grid tbody tr').length > 0, null, { ms: 30000, what: '左メニューの仕掛一覧' });
 const out = await page.evaluate(() => ({ set: WL.scheduleView.hiddenLotSet(), rows: (S.rows || []).length, shown: document.querySelectorAll('#grid tbody tr').length }));
 rec('H4 スケジュールを出たら伏せない（答えは null）', out.set === null, JSON.stringify(out));
 await page.evaluate(() => localStorage.removeItem('wl.filterLink.v1'));
 /* WAVELOG_PROPOSALS=<案の js> と WAVELOG_SHOT を付けたときだけ、案を実画面に当てて撮る（E の手順・見た目の確かめ用）。 */
 if (process.env.WAVELOG_PROPOSALS && SHOT) await shootProposals(page, setMode, require(process.env.WAVELOG_PROPOSALS));
 await setMode('edit');
}, { mode: 'edit', viewport: { width: 1728, height: 1152 } });

async function openScene(page, setMode, scene) {
 await page.setViewportSize(scene.vp);
 await setMode(scene.mode);
 await page.goto(B + '/', { waitUntil: 'domcontentloaded' }); await W.booted(page);
 if (scene.mode === 'edit') await page.click('[data-db-key="SIKALOTNOW"]');
 else await W.openSchedule(page, EQ);
 await W.until(page, () => document.querySelectorAll('#grid tbody tr').length > 0, null, { ms: 30000, what: scene.key });
 if (scene.float) {
  await page.click('#scListModalBtn');
  await W.until(page, () => !!document.querySelector('.sc-float-body #genericFilterBar'), null, { ms: 10000, what: 'ポップアップ' });
 }
}
async function shootProposals(page, setMode, props) {
 const scenes = [{ key: 'solo1728', vp: { width: 1728, height: 1152 }, mode: 'edit' },
                 { key: 'split1728', vp: { width: 1728, height: 1152 }, mode: 'schedule' },
                 { key: 'split1536', vp: { width: 1536, height: 864 }, mode: 'schedule' },
                 { key: 'float1728', vp: { width: 1728, height: 1152 }, mode: 'schedule', float: true }];
 for (const p of props) {
  for (const sc of scenes) {
   await openScene(page, setMode, sc);
   await page.evaluate(({ css, apply }) => { const st = document.createElement('style'); st.id = 'pxStyle'; st.textContent = css; document.head.appendChild(st);
    if (apply) (0, eval)('(' + apply + ')')(); }, { css: p.css, apply: p.apply });
   await W.until(page, () => { const s = document.getElementById('pxCondStrip'); return !s || !s.hidden; }, null, { ms: 8000, what: '効いている条件の札の列' });
   await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
   const m = await page.evaluate(measureBar);
   console.log(`PROP ${p.key} ${sc.key} ${JSON.stringify(m)}`);
   const box = await page.evaluate(() => { const b = document.getElementById('genericFilterBar').getBoundingClientRect();
    const g = document.getElementById('grid').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: g.top - b.top + 90 }; });
   await page.screenshot({ path: path.join(SHOT, `${p.key}_${sc.key}.png`),
    clip: { x: Math.max(0, box.x - 8), y: Math.max(0, box.y - 8), width: Math.min(page.viewportSize().width - Math.max(0, box.x - 8), box.w + 16), height: box.h + 16 } });
  }
 }
}
