/* test_equipgroupui.js: 設備グループのマスタ画面（§9.628・LotScope の設備グループマスタ）
   ============================================================
   ダッシュボードのパネルが「まとめ方」を1つ選んで設備を合算するための現場のマスタ。マスタ管理の「設備」の群に
   汎用の表のマスタとして載る（一覧＋右の詳細）。ここで見ること:
     - 左の一覧の「設備」の群にあり、開くとまとめ方ごとの群で行が並ぶ
     - 「いま入る設備」に、書いた設備と名前の決まりで入る設備がサーバーの答えのまま出る
     - 名前の決まりを1行に1つの字で直して保存でき、比べ方の無い字は断られる（窓は閉じない）
   WAVELOG_SHOT=<dir> で画面を撮る（利用者の PC 1728×1152 とフル HD・125% の 1536×864）。
   ============================================================ */
'use strict';
const H = require('./lib/harness.js');
const path = require('path');
const SHOT = process.env.WAVELOG_SHOT || '';
const TAG = 'EGUI_';

H.run('test_equipgroupui: 設備グループのマスタ画面（§9.628）', async ({ page, rec, setMode, idle, B, W }) => {
 const post = (url, body) => page.evaluate(async ([u, b]) => { const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); return { status: r.status, json: await r.json().catch(() => ({})) }; }, [url, body]);
 const made = [];
 await page.goto(B + '/', { waitUntil: 'domcontentloaded' }); await W.booted(page);
 await setMode('edit');
 try {
  /* 見本: 同じまとめ方に2つ（書いた設備で1つ・名前の決まりで1つ） */
  for (const g of [{ name: TAG + 'A', set: TAG + 'ライン別', equipment: ['テスト設備A'] },
                   { name: TAG + 'B', set: TAG + 'ライン別', equipment: [], rules: [{ op: 'suffix', value: '設備B' }] }]) {
   const r = await post('/api/masters/equipgroups', g);
   if (r.json.created) made.push(r.json.created);
  }
  rec('見本のグループを2つ置けた', made.length === 2, JSON.stringify(made));
  await page.click('[data-db-key="SIKALOTNOW"]');
  await W.until(page, () => document.querySelectorAll('#grid tbody tr').length > 0, null, { ms: 30000, what: '仕掛一覧' });
  await page.click('#openMasterMaint');
  await W.until(page, () => document.body.classList.contains('mm-mode') && !!document.querySelector('#masterMaintNav [data-master].active'), null, { ms: 20000, what: 'マスタ管理' });
  await idle();
  const navGroup = await page.evaluate(() => { const b = document.querySelector('#masterMaintNav [data-master="equipGroup"]'); const g = b && b.closest('[data-mm-group]'); return { has: !!b, text: b ? b.textContent.trim() : '', group: g ? g.dataset.mmGroup : '' }; });
  rec('左の一覧の「設備」の群に「設備グループ」がある', navGroup.has && /設備グループ/.test(navGroup.text), JSON.stringify(navGroup));
  await page.evaluate(() => { const b = document.querySelector('#masterMaintNav [data-master="equipGroup"]'); b.scrollIntoView({ block: 'nearest' }); });
  await page.click('#masterMaintNav [data-master="equipGroup"]');
  await W.until(page, () => [...document.querySelectorAll('#masterMaintList .mm-row[data-mm-open]')].some(r => r.textContent.includes('EGUI_B')), null, { ms: 15000, what: '設備グループの一覧' });
  await page.evaluate(() => { const o = document.querySelector('[data-mm-fold="open"]:not([disabled])'); if (o) o.click(); });
  await idle();
  const row = name => page.evaluate(n => { const r = [...document.querySelectorAll('#masterMaintList .mm-row[data-mm-open]')].find(x => x.textContent.includes(n)); return r ? r.innerText.replace(/\s+/g, ' ') : ''; }, name);
  const a = await row(TAG + 'A'), b = await row(TAG + 'B');
  rec('書いた設備の行に「いま入る設備」が出る', a.includes('テスト設備A'), a.slice(0, 120));
  rec('名前の決まりの行に、決まりの字と当たる設備が出る', b.includes('設備B で終わる') && b.includes('テスト設備B'), b.slice(0, 120));
  const heads = await page.evaluate(t => [...document.querySelectorAll('#masterMaintList .mm-group-head, #masterMaintList [data-mm-group-head]')].map(x => x.textContent).filter(x => x.includes(t)).length, TAG + 'ライン別');
  rec('まとめ方ごとの群で並ぶ', heads >= 1, String(heads));
  if (process.env.WAVELOG_SHOT) for (const [tag, vp] of [['1728', { width: 1728, height: 1152 }], ['1536', { width: 1536, height: 864 }]]) {
   await page.setViewportSize(vp); await idle();
   await page.screenshot({ path: path.join(SHOT, `equipgroup_list_${tag}.png`) });
  }

  /* ---- 右の詳細で名前の決まりを直す ---- */
  await page.evaluate(n => [...document.querySelectorAll('#masterMaintList .mm-row[data-mm-open]')].find(x => x.textContent.includes(n)).click(), TAG + 'B');
  await W.until(page, () => { const m = document.getElementById('maintEditorModal'); return m && !m.hidden && !!m.querySelector('[data-field="rulesText"]'); }, null, { ms: 10000, what: '右の詳細' });
  const shown = await page.evaluate(() => document.querySelector('#maintEditorModal [data-field="rulesText"]').value);
  rec('決まりが1行に1つの字で欄に出る', shown === '設備B で終わる', shown);
  rec('受け付けない「すべての設備」は押せる形で出さない', await page.evaluate(() => !document.querySelector('#maintEditorModal [data-equipment-all="equipment"]')));
  if (process.env.WAVELOG_SHOT) await page.screenshot({ path: path.join(SHOT, 'equipgroup_detail_1536.png') });
  const typeRules = async v => { await page.fill('#maintEditorModal [data-field="rulesText"]', v); await W.until(page, () => !document.getElementById('maintEditorSave').disabled, null, { ms: 5000, what: '保存が押せる' }); await page.click('#maintEditorSave'); };
  await typeRules('テスト設備');
  await W.until(page, () => /比べ方が読めません/.test(document.body.innerText), null, { ms: 8000, what: '断りの字' });
  rec('比べ方の無い決まりは断り、詳細は開いたまま', await page.evaluate(() => !document.getElementById('maintEditorModal').hidden));
  await typeRules('テスト設備 で始まる\n除外しない を含む');
  await W.until(page, n => [...document.querySelectorAll('#masterMaintList .mm-row[data-mm-open]')].some(x => x.textContent.includes(n) && x.textContent.includes('テスト設備 で始まる')), TAG + 'B', { ms: 10000, what: '保存した決まりが一覧に出る' });
  const saved = await page.evaluate(async () => (await (await fetch('/api/masters/equipgroups')).json()).items.find(x => x.name === 'EGUI_B'));
  rec('2行の決まりがそのまま保存される', JSON.stringify(saved.rules) === JSON.stringify([{ op: 'prefix', value: 'テスト設備' }, { op: 'contains', value: '除外しない' }]), JSON.stringify(saved.rules));
  rec('決まりで入る設備が増える（テスト設備A も入る）', (saved.matched || []).includes('テスト設備A') && (saved.matched || []).includes('テスト設備B'), JSON.stringify(saved.matched));
 } finally {
  for (const id of made) await post('/api/masters/equipgroups/delete', { id });
 }
}, { viewport: { width: 1536, height: 864 } });
