/* ============================================================
   test_mmlist.js: 汎用の表のマスタの一覧（§9.599・ステップ2・採点で選んだ K 97点）

   利用者の依頼（2026-10-13）「メインにマージして、ステップ2へ進んでください。」——ステップ1（§9.598）の型の上に、
   汎用の表で描くマスタ（ロール・帳票ブロック・内部データ・テーブル生データ）を載せる。固定すること:
    1. サーバー: 刃組の盤・設備停止の挿入条件が持つ表は「内部データ」に出さない（左の一覧に同じ呼び名が2つ並ばない）。
       稼働カレンダーは「いつ」（区分＋曜日＋日付）の見せ方をサーバーが名乗る
    2. 件数はどの一覧も札の行のタブ「一覧 N件」（題の横に件数を出さない）。行のある一覧だけ探す欄を持つ
    3. 探すと、その場で行を絞り、タブは「n / N件」、当たった字に印、群の見出しの件数と要約も絞った行で数え直す
    4. 数の列は右寄せ、単位は見出しの名前の外（`.mm-th-unit`）、ロールの径MIN の 0 は「—」
    5. 群（設備）の見出しは選択中と違う中立の形（左の帯・地なし）。ロールは径の範囲を言う
    6. 帳票ブロック: 「既定」の列は無く、全部が既定なら「全行で同じ」の1行が「種類 すべて既定」と言う。内容は「N項目＋札」、
       幅は12マスの帯、高さの空・0 は「中身なり」。畳むのは`fold`の列だけ
    7. 器に入る表は表の幅で止まる（`is-fitw`）。テーブル生データへ移っても前の画面の「すべて開く／畳む」は残らない
    8. テーブル生データ: 表を選ぶ欄は頭の右・タブ「中身 N件」・日時は「YYYY-MM-DD hh:mm」（GMT の字を出さない）・有効は字
    9. 0件の表は絵と「まだ1行もありません」で、探す欄を出さない
   ============================================================ */
'use strict';
const H = require('./lib/harness.js');
const W = require('./lib/wait.js');
const B = H.B;
const post = (p, body) => fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const getj = async p => (await fetch(B + p)).json();
const TAG = 'ML' + Date.now().toString(36).slice(-5);
const EQ = 'テスト設備A', EQ2 = 'テスト設備B';

H.run('test_mmlist: 汎用の表のマスタの一覧（§9.599）', async ({ page, rec, setMode, idle }) => {
 const rolls = [], cals = [];
 try {
  await post('/api/access-mode', { mode: 'edit' });
  /* ---------- 1) サーバーの対応表 ---------- */
  const cat = (await getj('/api/master-table/catalog')).tables || [];
  const of = t => cat.find(x => x.table === t);
  const BLADE = ['ゴムリングマスタ', 'スペーサーマスタ', 'フィンガーマスタ', '刃マスタ', '刃セットマスタ', '刃選択マスタ', '刃組基準値マスタ', '保持方式マスタ', '設備停止挿入条件マスタ'];
  const wrong = BLADE.filter(t => of(t) && of(t).kind !== 'covered');
  rec('1) 刃組の盤・設備停止が持つ表は専用の画面を指す（内部データに出さない）', !wrong.length, JSON.stringify(wrong));
  const cal = of('稼働カレンダーマスタ');
  rec('1) 稼働カレンダーは「いつ」の見せ方をサーバーが名乗る', !cal || !!(cal.views && cal.views.when && cal.views.when.label === 'いつ'), JSON.stringify(cal && cal.views));

  /* 見本: ロール5本（2設備・径MIN 0 が1本）と稼働カレンダー2行。**確かめたら消す**（finally）。 */
  const mkRoll = async b => { const r = await (await post('/api/roll-master', { user_id: 'test', ...b })).json(); if (r.id) rolls.push(r.id); return r; };
  await mkRoll({ equipment: EQ, name: TAG + 'ピンチ', entryPos: '中間', contactFace: '上下', diaMax: 300, diaMin: 298, faceLen: 1500 });
  await mkRoll({ equipment: EQ, name: TAG + 'ブライドル', entryPos: '入側', contactFace: '上', diaMax: 600, diaMin: 595, faceLen: 1500 });
  await mkRoll({ equipment: EQ, name: TAG + 'テンション', entryPos: '出側', contactFace: '下', diaMax: 450, diaMin: 448, faceLen: 1500 });
  await mkRoll({ equipment: EQ2, name: TAG + 'ピンチ', entryPos: '中間', contactFace: '上下', diaMax: 301, diaMin: 0, faceLen: 1300 });
  await mkRoll({ equipment: EQ2, name: TAG + 'デフレクター', entryPos: '出側', contactFace: '下', diaMax: 900, diaMin: 898, faceLen: 1300 });
  rec('（前提）ロールの見本を5本入れられた', rolls.length === 5, String(rolls.length));
  if (cal) {
   for (const b of [{ 設備名: EQ, 区分: '曜日', 曜日: 6, 稼働: 0, 表示順: 10, 有効: -1 }, { 設備名: EQ, 区分: '日付', 日付: '2026-10-25', 稼働: 1, 開始時刻: '08:00', 終了時刻: '17:00', 表示順: 20, 有効: -1 }]) {
    const r = await (await post('/api/master-table/' + encodeURIComponent('稼働カレンダーマスタ'), { ...b, user_id: 'test' })).json();
    if (r.id) cals.push(r.id);
   }
  }

  await page.goto(B + '/', { waitUntil: 'domcontentloaded' }); await W.booted(page);
  await setMode('edit');
  await page.evaluate(() => { try { localStorage.setItem('MasterNavFoldV1', '[]') } catch (e) { /* 覚えを書けない端末では畳んだ群が残るだけ */ } });
  await page.reload({ waitUntil: 'domcontentloaded' }); await W.booted(page);
  await page.click('[data-db-key="SIKALOTNOW"]');
  await W.until(page, () => document.querySelectorAll('#grid tbody tr').length > 0, null, { ms: 30000, what: '仕掛一覧' });
  await page.click('#openMasterMaint');
  await W.until(page, () => document.body.classList.contains('mm-mode') && !!document.querySelector('#masterMaintNav [data-master].active'), null, { ms: 20000, what: 'マスタ管理' });
  await idle();
  const openNav = async key => {
   await page.evaluate(k => { const b = document.querySelector(`#masterMaintNav [data-master="${k}"]`); if (b) b.scrollIntoView({ block: 'nearest' }); }, key);
   await page.click(`#masterMaintNav [data-master="${key}"]`);
   await W.until(page, k => { const b = document.querySelector(`#masterMaintNav [data-master="${k}"]`); return b && b.classList.contains('active'); }, key, { ms: 15000, what: key });
   await idle();
  };
  const nav = await page.evaluate(() => [...document.querySelectorAll('#masterMaintNav [data-master]')].map(b => b.textContent.trim()));
  const dup = [...new Set(nav.filter((x, i) => nav.indexOf(x) !== i))];
  rec('1) 左の一覧に同じ呼び名が2つ並ばない', !dup.length, JSON.stringify(dup));

  /* ---------- 2)〜5) ロール ---------- */
  await openNav('roll');
  await page.evaluate(() => { const o = document.querySelector('[data-mm-fold="open"]:not([disabled])'); if (o) o.click(); });
  await idle();
  const roll = () => page.evaluate(tag => {
   const list = document.getElementById('masterMaintList');
   const head = [...list.querySelectorAll('.mm-row.head>.mm-th')];
   const ix = n => head.findIndex(h => (h.querySelector('b') || {}).textContent === n);
   const rows = [...list.querySelectorAll('.mm-row:not(.head)')].filter(r => r.textContent.includes(tag));
   const cell = (r, n) => r && r.children[ix(n)];
   const pinchB = rows.find(r => r.closest('#masterMaintList') && r.textContent.includes(tag + 'ピンチ') && r.textContent.includes('1300'));
   const gh = [...list.querySelectorAll('.mm-group-head')];
   return {
    tab: (list.querySelector('.mm-lbar .mm-ltab.is-on') || {}).textContent || '',
    headCount: (document.getElementById('masterMaintCount') || {}).textContent || '',
    find: !!list.querySelector('.mm-lbar .mm-find:not([hidden]) input'),
    heads: head.map(h => (h.querySelector('b') || {}).textContent), units: head.map(h => (h.querySelector('.mm-th-unit') || {}).textContent || ''),
    numCls: !!(cell(rows[0], '径MAX') && cell(rows[0], '径MAX').classList.contains('is-num')),
    numAlign: cell(rows[0], '径MAX') ? getComputedStyle(cell(rows[0], '径MAX')).textAlign : '',
    zero: pinchB ? (cell(pinchB, '径MIN') || {}).textContent.trim() : '(行なし)',
    groups: gh.map(g => ({ t: g.textContent.trim(), bl: getComputedStyle(g).borderLeftWidth, bg: getComputedStyle(g).backgroundColor })),
    rows: rows.length,
   };
  }, TAG);
  const r0 = await roll();
  rec('2) 件数は札の行のタブ「一覧 N件」（題の横に件数を出さない）', /^一覧\s*\d+件$/.test(r0.tab.trim()) && !/件/.test(r0.headCount), JSON.stringify({ tab: r0.tab, head: r0.headCount }));
  rec('2) 行のある一覧は探す欄を持つ', r0.find, '');
  rec('4) 単位は見出しの名前の外（名前は「径MAX」のまま・単位 mm）', r0.heads.includes('径MAX') && r0.units[r0.heads.indexOf('径MAX')] === 'mm', JSON.stringify({ h: r0.heads, u: r0.units }));
  rec('4) 数の列は右寄せ（径MAX）', r0.numCls && /right|end/.test(r0.numAlign), JSON.stringify({ cls: r0.numCls, al: r0.numAlign }));
  rec('4) ロールの径MIN の 0 は「—」（未設定）', r0.zero === '—', r0.zero);
  rec('5) 群の見出しは中立（左の帯なし・地なし）で、径の範囲を言う',
   r0.groups.length >= 2 && r0.groups.every(g => g.bl === '0px' && /rgba\(0, 0, 0, 0\)|transparent/.test(g.bg)) && r0.groups.some(g => /径 \d/.test(g.t)),
   JSON.stringify(r0.groups));
  /* 3) 探す: その場で絞る */
  await page.fill('#masterMaintList .mm-lbar .mm-find input', TAG + 'ピンチ');
  await W.until(page, () => /\d+ \/ \d+件/.test((document.querySelector('#masterMaintList .mm-lbar .mm-ltab.is-on') || {}).textContent || ''), null, { ms: 6000, what: '絞った件数' });
  const r1 = await page.evaluate(tag => {
   const list = document.getElementById('masterMaintList');
   const rows = [...list.querySelectorAll('.mm-row:not(.head)')];
   const gB = [...list.querySelectorAll('.mm-group-head')].find(g => g.textContent.includes('テスト設備B'));
   return { tab: list.querySelector('.mm-lbar .mm-ltab.is-on').textContent, all: rows.length, hit: rows.filter(r => r.textContent.includes(tag + 'ピンチ')).length,
    marks: list.querySelectorAll('mark.mm-hit').length, gB: gB ? gB.textContent : '', focus: document.activeElement && document.activeElement.matches('.mm-find input') };
  }, TAG);
  /* 出ている行は全部当たる行で、n は N より小さい（絞らずに件数の字だけ変えたものを通さない）。 */
  const nN = (r1.tab.match(/(\d+) \/ (\d+)件/) || []).slice(1).map(Number);
  rec('3) 探すとその場で絞り、タブは「n / N件」・当たった字に印', r1.hit >= 2 && r1.all === r1.hit && nN.length === 2 && nN[0] === r1.all && nN[0] < nN[1] && r1.marks >= r1.hit, JSON.stringify(r1));
  rec('3) 打っている欄の焦点は描き直しで切れない', r1.focus, '');
  rec('3) 群の見出しは絞った行で数え直す（テスト設備Bはピンチ1本・径 301）', /テスト設備B/.test(r1.gB) && /径 301〜301 mm/.test(r1.gB), r1.gB);
  /* 3) 欄の字と絞り込みは食い違わない: 打ったまま別のマスタへ移って戻ると、欄は空・行は全部（前は「6 / 8件」なのに欄が空・§9.599 の採点）。 */
  await openNav('equipment'); await openNav('roll');
  const back = await page.evaluate(tag => {
   const list = document.getElementById('masterMaintList');
   return { tab: ((list.querySelector('.mm-lbar .mm-ltab.is-on') || {}).textContent || '').trim(), val: (list.querySelector('.mm-lbar .mm-find input') || {}).value,
    rows: [...list.querySelectorAll('.mm-row:not(.head)')].filter(r => r.textContent.includes(tag)).length };
  }, TAG);
  rec('3) 打ったまま移って戻ると、欄は空で行は全部（欄の字と絞り込みが食い違わない）', back.val === '' && /^一覧\s*\d+件$/.test(back.tab) && back.rows === 5, JSON.stringify(back));
  await page.fill('#masterMaintList .mm-lbar .mm-find input', TAG + 'ピンチ');
  await W.until(page, () => /\d+ \/ \d+件/.test((document.querySelector('#masterMaintList .mm-lbar .mm-ltab.is-on') || {}).textContent || ''), null, { ms: 6000, what: '絞り直し' });
  await page.fill('#masterMaintList .mm-lbar .mm-find input', '');
  await W.until(page, () => /^一覧\s*\d+件$/.test(((document.querySelector('#masterMaintList .mm-lbar .mm-ltab.is-on') || {}).textContent || '').trim()), null, { ms: 6000, what: '絞りを外す' });

  /* 4) 既定の印つきの数（「40 既定」）・未設定まじりの列も数の列（設備の最大条数・標準時間）。 */
  await openNav('equipment');
  const eq = await page.evaluate(() => {
   const list = document.getElementById('masterMaintList');
   const head = [...list.querySelectorAll('.mm-row.head>.mm-th')];
   const at = n => head.find(h => (h.querySelector('b') || {}).textContent === n);
   const ix = n => head.indexOf(at(n)), row = list.querySelector('.mm-row:not(.head)');
   return ['最大条数', '標準時間'].map(n => ({ n, th: !!(at(n) && at(n).classList.contains('is-num')), al: row && ix(n) >= 0 ? getComputedStyle(row.children[ix(n)]).textAlign : '(列なし)' }));
  });
  rec('4) 既定の印つきの数の列も右寄せ（設備の最大条数・標準時間）', eq.every(x => x.th && /right|end/.test(x.al)), JSON.stringify(eq));

  /* ---------- 7) テーブル生データへ移っても「すべて開く／畳む」が残らない・8) 生データの型 ---------- */
  await openNav('rawTable');
  await page.evaluate(() => { const s = document.getElementById('rawTableSelect'); if (s && s.value !== 'ゴムリングマスタ' && [...s.options].some(o => o.value === 'ゴムリングマスタ')) { s.value = 'ゴムリングマスタ'; s.dispatchEvent(new Event('change')); } });
  await W.until(page, () => document.querySelectorAll('.mm-raw-table tbody tr').length > 0, null, { ms: 15000, what: '生データの行' });
  const raw = await page.evaluate(() => {
   const fold = document.getElementById('masterMaintFold');
   const cells = [...document.querySelectorAll('.mm-raw-table tbody td')].map(td => td.textContent.trim());
   const th = [...document.querySelectorAll('.mm-raw-table thead th')].map(x => x.textContent.trim());
   const iOn = th.indexOf('有効');
   return { foldShown: !!(fold && !fold.hidden && fold.offsetWidth > 0), sel: !!document.querySelector('#masterMaintActs #rawTableSelect'),
    tab: (document.querySelector('#masterMaintList .mm-lbar .mm-ltab.is-on') || {}).textContent || '', gmt: cells.filter(t => /GMT/.test(t)).length,
    on: iOn < 0 ? '(列なし)' : [...document.querySelectorAll('.mm-raw-table tbody tr')].map(tr => (tr.children[iOn] || {}).textContent.trim()).slice(0, 3).join(','),
    ro: (document.getElementById('masterMaintLevel') || {}).textContent || '' };
  });
  rec('7) テーブル生データに前の画面の「すべて開く／畳む」が残らない', !raw.foldShown, JSON.stringify(raw));
  rec('8) 表を選ぶ欄は頭の右・タブ「中身 N件」・題の横に「読むだけ」', raw.sel && /^中身/.test(raw.tab.trim()) && raw.ro === '読むだけ', JSON.stringify(raw));
  rec('8) 日時は GMT の字を出さない・有効は字（-1 を出さない）', raw.gmt === 0 && !/-1/.test(raw.on), JSON.stringify({ gmt: raw.gmt, on: raw.on }));

  /* 8) 表を替えた回も欄の字と絞り込みは食い違わない（字を打ったまま別の表を選ぶと、欄は空・タブは「中身 N件」）。 */
  await page.fill('#masterMaintList .mm-lbar .mm-find input', '00');
  await W.until(page, () => /\d+ \/ /.test((document.querySelector('#masterMaintList .mm-lbar .mm-ltab.is-on') || {}).textContent || ''), null, { ms: 6000, what: '生データで絞る' });
  const other = await page.evaluate(() => { const s = document.getElementById('rawTableSelect'); const o = [...s.options].find(x => x.value && x.value !== s.value && x.value !== 'ゴムリングマスタ' && x.value === '設備マスタ') || [...s.options].find(x => x.value && x.value !== s.value); s.value = o.value; s.dispatchEvent(new Event('change')); return o.value; });
  await W.until(page, t => (document.querySelector('#masterMaintList .mm-lbar') || {}).dataset?.key === 'raw:' + t && document.querySelectorAll('.mm-raw-table tbody tr').length > 0, other, { ms: 15000, what: '別の表の行' });
  const sw = await page.evaluate(() => ({ tab: ((document.querySelector('#masterMaintList .mm-lbar .mm-ltab.is-on') || {}).textContent || '').trim(), val: (document.querySelector('#masterMaintList .mm-lbar .mm-find input') || {}).value }));
  rec('8) 字を打ったまま別の表を選ぶと、欄は空・タブは「中身 N件」（絞ったまま空の欄にしない）', sw.val === '' && /^中身/.test(sw.tab) && !/ \/ /.test(sw.tab.replace(/^中身先頭\d+ \/ 全/, '')), JSON.stringify({ other, ...sw }));

  /* ---------- 6) 帳票ブロック ---------- */
  await openNav('reportBlock');
  const rb = await page.evaluate(() => {
   const list = document.getElementById('masterMaintList');
   const heads = [...list.querySelectorAll('.mm-row.head>.mm-th b')].map(b => b.textContent);
   const rows = [...list.querySelectorAll('.mm-row:not(.head)')];
   return { heads, same: (list.querySelector('.mm-same') || {}).textContent || '', items: list.querySelectorAll('.mm-val-items').length,
    spans: list.querySelectorAll('.mm-val-span').length, auto: rows.filter(r => r.textContent.includes('中身なり')).length, n: rows.length,
    defTags: list.querySelectorAll('.mm-row:not(.head) .mm-val-def').length };
  });
  rec('6) 「既定」の列は無い', !rb.heads.includes('既定'), JSON.stringify(rb.heads));
  rec('6) 全部が既定なら「全行で同じ」が「種類 すべて既定」と言い、行の札は出さない',
   rb.n < 5 || (/種類\s*すべて既定/.test(rb.same) && rb.defTags === 0) || (!/種類/.test(rb.same)), JSON.stringify({ same: rb.same, tags: rb.defTags }));
  rec('6) 内容は「N項目＋札」・幅は12マスの帯・高さの空は「中身なり」', rb.items > 0 && rb.spans > 0 && rb.auto > 0, JSON.stringify(rb));

  /* ---------- 4)・7) 内部データ: 稼働カレンダー ---------- */
  if (cal) {
   await openNav('mt:稼働カレンダーマスタ');
   const c = await page.evaluate(() => {
    const list = document.getElementById('masterMaintList'), head = list.querySelector('.mm-row.head');
    const heads = [...head.querySelectorAll('.mm-th b')].map(b => b.textContent);
    const i = heads.indexOf('いつ'), rows = [...list.querySelectorAll('.mm-row:not(.head)')];
    return { heads, when: rows.map(r => (r.children[i] || {}).textContent || '').filter(Boolean), fitw: list.classList.contains('is-fitw'),
     headW: Math.round(head.getBoundingClientRect().width), listW: Math.round(list.getBoundingClientRect().width),
     lead: (document.getElementById('masterMaintLead') || {}).textContent || '' };
   });
   rec('4) 稼働カレンダーは1列「いつ」（毎週 土曜／日付 2026-10-25）', c.heads.includes('いつ') && !c.heads.includes('曜日') && c.when.some(t => /毎週\s*土曜/.test(t)) && c.when.some(t => /日付\s*2026-10-25/.test(t)), JSON.stringify(c));
   rec('7) 器に入る表は表の幅で止まる（行の罫線が右の空きまで走らない）', c.fitw && c.headW < c.listW - 100, JSON.stringify({ fitw: c.fitw, head: c.headW, list: c.listW }));
   rec('1) 内部データの用途の1行は「何の表か＋ふだんどこで直すか」', /ふだんは.+で直します/.test(c.lead), c.lead);
  }
  /* ---------- 9) 0件の表 ---------- */
  /* 0件の内部データの表はサーバーの対応表から選ぶ（左の一覧に出ているものだけ）。 */
  const zero = cat.filter(t => (t.kind === 'here' || t.kind === 'elsewhere') && t.rows === 0).map(t => t.table);
  const empty = await page.evaluate(ts => ts.find(t => !!document.querySelector(`#masterMaintNav [data-master="mt:${t}"]`)) || '', zero);
  if (empty) {
   await openNav('mt:' + empty);
   const e = await page.evaluate(() => {
    const list = document.getElementById('masterMaintList');
    const f = list.querySelector('.mm-lbar .mm-find');
    return { none: !!list.querySelector('.mm-empty.is-none .mm-empty-ico'), text: (list.querySelector('.mm-empty') || {}).textContent || '', find: !!(f && !f.hidden) };
   });
   rec('9) 0件の表は絵と「まだ1行もありません」で、探す欄を出さない', e.none && /まだ1行もありません/.test(e.text) && !e.find, JSON.stringify({ empty, ...e }));
  } else rec('9) 0件の表（見本の表が見つからない・確かめていない）', true, '0件の内部データが無い');
 } finally {
  for (const id of rolls) { try { await post('/api/roll-master/delete', { user_id: 'test', id }) } catch (e) { /* 消せなくても次の本はフィクスチャが戻す */ } }
  for (const id of cals) { try { await post('/api/master-table/' + encodeURIComponent('稼働カレンダーマスタ') + '/delete', { id }) } catch (e) { /* 同上 */ } }
 }
}, { mode: 'edit', viewport: { width: 1728, height: 1152 } });
