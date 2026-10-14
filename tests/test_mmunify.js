/* ============================================================
   test_mmunify.js: マスタの部品は画面をまたいで1つの型（§9.604・ステップ6・採点で選んだ I 99点）

   利用者の依頼（2026-10-14）「続けて」→ ステップ6＝全体の仕上げ（窓の英字も含む）。ステップ1〜5で画面ごとの型はそろえたが、
   画面Aと画面Bで同じ役目の部品が違う形のまま残っていた（`s6/MEASURE.md`）。固定すること:
    1. 一覧で選んだ項目は1つの見せ方（刃組の一覧＝設備停止・選択肢の値と同じ淡い青緑の地＋左の帯）
    2. 表の見出しは1つの形（汎用の表・選択肢の値・刃組の在庫表・判定表が同じ地・字・高さ）。マスタの表に縞は無い
    3. 詳細の頭は2段（種類の小見出し＋15pxの名前）。札（タブ）の高さは1つ
    4. 本文の中の「＋ 追加」は1つの形（白の縁・30px）。同じ操作の動詞は「追加」。押す札にピルを使わない
    5. 刃組の左の一覧にも頭（何の一覧・件数）。件数を頭に置いたら札の行の右に同じ数を出さない
    6. 行が0件の表でも見出しの字で列の幅を取る（「径MAX mm」が「径…」と切れない）
    7. 確かめる窓: 頭は白・小見出しはいる画面の名前・種類の印・事実の札・題は中身・決めるボタンは動詞・30px
    8. 設定の窓（操業データ項目）: 決める物は右下の足元（変更なし・記録者／キャンセル・保存）。変えると押せる
   ============================================================ */
'use strict';
const H = require('./lib/harness.js');
const W = require('./lib/wait.js');
const B = H.B;
const post = (p, body) => fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

H.run('test_mmunify: マスタの部品は画面をまたいで1つの型（§9.604）', async ({ page, rec, setMode, idle }) => {
 await post('/api/access-mode', { mode: 'edit' });
 await page.goto(B + '/', { waitUntil: 'domcontentloaded' }); await W.booted(page);
 await setMode('edit');
 await page.click('[data-db-key="SIKALOTNOW"]');
 await W.until(page, () => document.querySelectorAll('#grid tbody tr').length > 0, null, { ms: 30000, what: '仕掛一覧' });
 await page.click('#openMasterMaint');
 await W.until(page, () => document.body.classList.contains('mm-mode') && !!document.querySelector('#masterMaintNav [data-master].active'), null, { ms: 20000, what: 'マスタ管理' });
 await idle();
 const openNav = async (key, ready) => {
  await page.evaluate(k => { const b = document.querySelector(`#masterMaintNav [data-master="${k}"]`); if (b) b.scrollIntoView({ block: 'nearest' }); }, key);
  await page.click(`#masterMaintNav [data-master="${key}"]`);
  await W.until(page, k => { const b = document.querySelector(`#masterMaintNav [data-master="${k}"]`); return b && b.classList.contains('active'); }, key, { ms: 15000, what: key });
  if (ready) await W.until(page, s => !!document.querySelector(s), ready, { ms: 15000, what: key + ' の中身' });
  await idle();
 };
 /* 部品の見た目の型（同じ役目なら同じ値になるはずの物だけを並べる） */
 const look = (sel, keys) => page.evaluate(([s, k]) => {
  const e = document.querySelector(s); if (!e) return null;
  const c = getComputedStyle(e), r = e.getBoundingClientRect();
  return Object.fromEntries(k.map(x => [x, x === 'h' ? Math.round(r.height) : c[x]]));
 }, [sel, keys]);
 const SEL = ['backgroundColor', 'color', 'boxShadow'];
 const TH = ['backgroundColor', 'color', 'fontSize', 'fontWeight', 'borderBottomColor', 'borderBottomWidth'];
 const BTN = ['h', 'backgroundColor', 'borderTopColor', 'color', 'fontSize', 'fontWeight', 'borderTopLeftRadius'];
 const same = (a, b) => !!a && !!b && JSON.stringify(a) === JSON.stringify(b);
 const plusVerbs = () => page.evaluate(() => [...document.querySelectorAll('.mm-main button')].map(b => b.textContent.trim()).filter(t => /^＋/.test(t)));

 /* ---------- 設備停止（選んだ項目・詳細の題・本文の追加） ---------- */
 await openNav('stopReason', '.ssb-stop.is-on');
 const sel = { ssb: await look('.ssb-stop.is-on', SEL) };
 const dtitle = { ssb: await look('.ssb-detail .mm-dhead h3', ['fontSize']) };
 const verbs = await plusVerbs();
 /* ---------- 選択肢の値（選んだ項目・表の見出し・詳細の頭2段・本文の追加） ---------- */
 await openNav('opChoice', '.oc-group.is-on');
 sel.oc = await look('.oc-group.is-on', SEL);
 const th = { oc: await look('.oc-row.is-head', TH) }, thH = {};
 /* 選択肢の値は列の幅を em で書いているので、字の大きさは行でなくセルが持つ（行に当てると見出しと本文で列がずれる） */
 th.oc.fontSize = (await look('.oc-row.is-head>span:nth-child(2)', ['fontSize'])).fontSize;
 const ocHead = await page.evaluate(() => { const h = document.querySelector('.oc-values-head'); const s = h && h.querySelector('small'), t = h && h.querySelector('h3');
  return { two: !!s && !!t && s.getBoundingClientRect().bottom <= t.getBoundingClientRect().top + 2, fs: t ? getComputedStyle(t).fontSize : '' }; });
 dtitle.oc = { fontSize: ocHead.fs };
 const addBtn = { oc: await look('#ocAddValue', BTN), ref: await look('.oc-groups-head ~ * .mm-btn-ghost, #ocGroupMore', BTN) };
 const ocItemH = await look('.oc-group', ['h']);
 verbs.push(...await plusVerbs());
 rec('3) 選択肢の値の詳細の頭は2段（種類の小見出しが上・名前が下）', ocHead.two, JSON.stringify(ocHead));
 /* ---------- 設備（表の見出し・札の高さ） ---------- */
 await openNav('equipment', '.mm-row.head');
 th.mm = await look('.mm-row.head', TH);
 thH.mm = await look('.mm-row.head', ['h']);
 const tabH = { list: await look('.mm-lbar .mm-ltab', ['h']) };
 verbs.push(...await plusVerbs());
 /* ---------- ゴムリング（選んだ項目・一覧の頭・詳細の頭・札の高さ） ---------- */
 await openNav('bladesetRing', '.bk-item.is-on');
 sel.bk = await look('.bk-item.is-on', SEL);
 tabH.scope = await look('.mm-scopebar .mm-ltab', ['h']);
 const ring = await page.evaluate(() => { const h = document.querySelector('.bk-list>.mm-panehead');
  return { head: h ? [...h.children].map(c => c.textContent.trim()).join(' ') : '', items: document.querySelectorAll('.bk-items .bk-item').length,
   scope: (document.querySelector('.mm-scopebar') || {}).textContent || '', nameFs: (() => { const i = document.querySelector('.bk-card-h .rb-name input'); return i ? getComputedStyle(i).fontSize : ''; })() }; });
 rec('5) ゴムリングの左の一覧に頭「色 N件」（N＝一覧の項目の数）', ring.head === `色 ${ring.items}件`, JSON.stringify(ring.head));
 rec('5) 件数は頭だけ（札の行の右に「登録済みの色…」を出さない）', !/登録済みの色/.test(ring.scope), ring.scope.slice(0, 80));
 verbs.push(...await plusVerbs());
 /* ---------- スペーサー（表の見出し・縞） ---------- */
 await openNav('bladesetSpacer', '.bk-table tbody tr');
 th.bk = await look('.bk-table thead th', TH);
 thH.bk = await look('.bk-table thead th', ['h']);
 const zebra = await page.evaluate(() => [...new Set([...document.querySelectorAll('.bk-table tbody tr')].slice(0, 8).map(r => getComputedStyle(r).backgroundColor))]);
 rec('2) マスタの表に縞が無い（スペーサーの在庫表の行の地は1色）', zebra.length === 1, JSON.stringify(zebra));
 verbs.push(...await plusVerbs());
 /* ---------- 刃（詳細の頭2段・15px） ---------- */
 await openNav('bladesetBlade', '.bk-card-t h3');
 dtitle.bk = await look('.bk-card-t h3', ['fontSize']);
 const eb = await page.evaluate(() => (document.querySelector('.bk-card-t>.bk-card-eb') || {}).textContent || '');
 rec('3) 刃の詳細の頭に種類の小見出し「刃セット」', eb === '刃セット', eb);
 verbs.push(...await plusVerbs());
 /* ---------- 刃選択（判定表の見出し・本文の追加） ---------- */
 await openNav('bladesetPick', '.rt-table');
 th.rt = await look('.rt-table thead th:not(.rt-no)', TH);
 /* 見出しの行は「＋ 条件の列を追加」（30px）を持つ。上下の余白が残ると39pxに伸びた */
 thH.rt = await look('.rt-table thead tr:first-child th:not(.rt-no)', ['h']);
 addBtn.rt = await look('[data-rt="addcol"]', BTN);
 verbs.push(...await plusVerbs());
 /* ---------- 設備停止の時間（本文の追加・欄30px） ---------- */
 await openNav('stopMinutes', '#smnAdd');
 addBtn.smn = await look('#smnAdd', BTN);
 const smnIn = await look('#smnNew', ['h']);
 verbs.push(...await plusVerbs());
 /* ---------- 測定データの保存（設定の段の札＝左の一覧の2行の項目） ---------- */
 await openNav('measStorage', '.mm-tabbar.is-rail .mm-tab');
 const railH = await look('.mm-tabbar.is-rail .mm-tab', ['h']);
 /* ---------- 帳票レイアウト（一覧の頭・表の見出し・詳細の頭2段） ---------- */
 await openNav('reportLayout', '.rly-row.is-head');
 th.rly = await look('.rly-row.is-head', TH);
 th.rly.fontSize = (await look('.rly-row.is-head>span', ['fontSize'])).fontSize;
 thH.rly = await look('.rly-row.is-head', ['h']);
 const rly = await page.evaluate(() => { const h = document.querySelector('.rly-blocks-head>.mm-panehead');
  const s = document.querySelector('.rly-detail .mm-dhead small'), t = document.querySelector('.rly-detail .mm-dhead h3');
  return { head: h ? [...h.children].map(c => c.textContent.trim()).join(' ') : '', paper: !!document.querySelector('.rly-blocks[data-rly-paper]'),
   two: !!s && !!t && s.getBoundingClientRect().bottom <= t.getBoundingClientRect().top + 1 }; });
 rec('5) 帳票レイアウトの一覧の頭も1つの形（「塊 N件」・どの紙かは対象の札が言う）', /^塊 \d+件/.test(rly.head) && rly.paper, JSON.stringify(rly));
 rec('3) 帳票レイアウトの詳細の頭も2段（種類「塊」が上・名前が下）', rly.two, JSON.stringify(rly));
 /* ---------- 帳票ブロック（頭は主の操作1つ＋ ⋯・見本の帳票は札の行の右の行き先） ---------- */
 await openNav('reportBlock', '.mm-row.head');
 const rb = await page.evaluate(() => ({ acts: [...document.querySelectorAll('#masterMaintActs button')].map(b => b.id),
  go: !!document.querySelector('#masterMaintList .mm-lbar #mmSampleView') }));
 rec('1) 帳票ブロックの頭は主の操作1つ＋ ⋯（見本の帳票は札の行の右・1押し）', JSON.stringify(rb.acts) === '["masterMaintMore","masterMaintAdd"]' && rb.go, JSON.stringify(rb));
 /* ---------- 勤務形態（押す札にピルを使わない） ---------- */
 await openNav('shiftMaster', '.shift-list-item');
 const pill = await page.evaluate(() => [...document.querySelectorAll('.mm-main button')].filter(b => { const r = b.getBoundingClientRect(), c = getComputedStyle(b);
  return r.height > 0 && r.height < 40 && r.width > r.height * 1.6 && parseFloat(c.borderTopLeftRadius) >= r.height / 2 - 1; }).map(b => b.className + ':' + b.textContent.trim().slice(0, 8)));
 rec('4) 押す札にピルを使わない（勤務形態の適用設備も角丸8px）', !pill.length, JSON.stringify(pill));

 rec('1) 一覧で選んだ項目は1つの見せ方（刃組＝設備停止＝選択肢の値）', same(sel.bk, sel.ssb) && same(sel.oc, sel.ssb), JSON.stringify(sel));
 rec('2) 表の見出しは1つの形（汎用の表＝選択肢の値＝在庫表＝判定表＝帳票レイアウト）', same(th.oc, th.mm) && same(th.bk, th.mm) && same(th.rt, th.mm) && same(th.rly, th.mm), JSON.stringify(th));
 rec('3) 詳細の題は15pxの1つ（刃組＝設備停止＝選択肢の値）・ゴムリングの名前の欄も同じ', dtitle.bk && dtitle.ssb && dtitle.bk.fontSize === dtitle.ssb.fontSize && dtitle.oc.fontSize === dtitle.ssb.fontSize && ring.nameFs === dtitle.ssb.fontSize, JSON.stringify({ dtitle, ring: ring.nameFs }));
 rec('3) 札（タブ）の高さは1つ（一覧の札の行＝設備の札の行）', tabH.list && tabH.scope && tabH.list.h === tabH.scope.h, JSON.stringify(tabH));
 rec('4) 本文の中の「＋ 追加」は1つの形（選択肢の値＝判定表＝設備停止の時間）', same(addBtn.oc, addBtn.rt) && same(addBtn.smn, addBtn.rt), JSON.stringify(addBtn));
 rec('4) 追加の行の欄も30px（設備停止の時間の分の欄＝ボタンの高さ）', smnIn && addBtn.smn && smnIn.h === addBtn.smn.h, JSON.stringify({ smnIn, btn: addBtn.smn && addBtn.smn.h }));
 rec('2) 表の見出しの高さは1つ（汎用の表＝在庫表＝判定表）', thH.mm && thH.bk && thH.rt && thH.mm.h === thH.bk.h && thH.rt.h === thH.bk.h && thH.rly && thH.rly.h === thH.bk.h, JSON.stringify(thH));
 rec('4) 2行の一覧の項目は40px（選択肢の値のまとまり＝設定の段の札）', ocItemH && ocItemH.h === 40 && railH && railH.h === 40, JSON.stringify({ ocItemH, railH }));
 const badVerb = verbs.filter(t => /足す|つくる|作る/.test(t));
 rec('4) 「＋」のボタンは「追加」の1つの動詞（足す・つくるを使わない）', !badVerb.length && verbs.length > 5, JSON.stringify(badVerb.length ? badVerb : verbs.slice(0, 6)));

 /* ---------- ロール（0件でも見出しの字で列を取る） ---------- */
 await openNav('roll', '.mm-row.head');
 const cut = await page.evaluate(() => [...document.querySelectorAll('.mm-row.head>.mm-th>b')].filter(b => b.scrollWidth > b.clientWidth + 1).map(b => b.textContent));
 rec('6) ロールの見出しが切れない（0件の表も見出しの字の幅で列を取る）', !cut.length, JSON.stringify(cut));

 /* ---------- 7) 確かめる窓（いまはロールに居る） ---------- */
 const cm = await page.evaluate(() => {
  const p = window.confirmModal({ message: 'テストの窓を消しますか？\nここは本文です。', confirmLabel: '削除する', danger: true, facts: [{ text: '戻せません', danger: true }] });
  const d = document.querySelector('#appConfirmModal .confirm-modal-dialog'), hd = d.querySelector('header'), c = getComputedStyle(hd), ok = document.getElementById('appConfirmOk');
  const out = { eyebrow: document.getElementById('appConfirmEyebrow').textContent, title: document.getElementById('appConfirmTitle').textContent,
   body: document.querySelector('#appConfirmBody .confirm-modal-message')?.textContent || '', kind: document.getElementById('appConfirmMark').dataset.kind,
   mark: document.getElementById('appConfirmMark').textContent, fact: [...document.querySelectorAll('#appConfirmBody .cm-fact.is-danger')].map(e => e.textContent).join('/'),
   headBg: c.backgroundColor, headLine: c.borderBottomWidth, ok: ok.textContent, okH: Math.round(ok.getBoundingClientRect().height) };
  document.getElementById('appConfirmCancel').click(); return p.then(v => ({ ...out, result: v }));
 });
 rec('7) 窓の小見出しはいる画面の名前（ロール）・英字を出さない', cm.eyebrow === 'ロール', cm.eyebrow);
 rec('7) 題が無ければ文の最初の1文が題・残りが本文', cm.title === 'テストの窓を消しますか？' && cm.body === 'ここは本文です。', JSON.stringify([cm.title, cm.body]));
 rec('7) 危ない窓は赤の「!」の印と、戻せないことの札', cm.kind === 'danger' && cm.mark === '!' && cm.fact === '戻せません', JSON.stringify(cm));
 rec('7) 窓の頭は白・下に線1本（マスタの編集窓と同じ）', cm.headBg === 'rgb(255, 255, 255)' && cm.headLine === '1px', JSON.stringify([cm.headBg, cm.headLine]));
 rec('7) 決めるボタンは動詞（削除する）・補助の規格30px・キャンセルで false', cm.ok === '削除する' && cm.okH === 30 && cm.result === false, JSON.stringify([cm.ok, cm.okH, cm.result]));
 const al = await page.evaluate(() => {
  const p = window.alertModal('不要ファイルはありませんでした。');
  const d = document.querySelector('#appConfirmModal .confirm-modal-dialog');
  const out = { title: document.getElementById('appConfirmTitle').textContent, only: d.classList.contains('is-titleonly'), kind: document.getElementById('appConfirmMark').dataset.kind };
  document.getElementById('appConfirmOk').click(); return p.then(() => out);
 });
 rec('7) 短いお知らせは題だけ（「お知らせ」の決まり文句にしない・本文を出さない）', al.title === '不要ファイルはありませんでした' && al.only && al.kind === 'notice', JSON.stringify(al));
 const pr = await page.evaluate(() => {
  const p = window.promptModal({ title: '名前を付ける', label: '名前', confirmLabel: '名前を付ける' });
  const out = { cancel: document.getElementById('appConfirmCancel').textContent, kind: document.getElementById('appConfirmMark').dataset.kind };
  document.getElementById('appConfirmCancel').click(); return p.then(v => ({ ...out, v }));
 });
 rec('7) 1行入力の「やめる」は「キャンセル」（ほかの窓と同じ字）', pr.cancel === 'キャンセル' && pr.kind === 'input' && pr.v === null, JSON.stringify(pr));

 /* ---------- 8) 設定の窓（操業データ項目）の足元 ---------- */
 await openNav('opItem', '.op-tile');
 await page.click('.op-tile');
 await W.until(page, () => { const m = document.getElementById('opItemModal'); return !!m && !m.hidden && !!document.getElementById('opdSave'); }, null, { ms: 10000, what: '設定の窓' });
 const foot0 = await page.evaluate(() => ({ inFoot: !!document.querySelector('#opItemModal .op-modal-foot #opdSave'), save: document.getElementById('opdSave').disabled,
  cancel: document.getElementById('opdCancel').disabled, say: document.getElementById('opModalDirty').textContent, head: [...document.querySelectorAll('#opItemModal .op-modal-head button')].map(b => b.id) }));
 rec('8) 設定の窓の決める物は足元（頭は × だけ）', foot0.inFoot && JSON.stringify(foot0.head) === '["opModalClose"]', JSON.stringify(foot0));
 rec('8) 変更が無いうちは「変更なし」・キャンセルも保存も押せない', foot0.save && foot0.cancel && /^変更なし/.test(foot0.say), JSON.stringify(foot0));
 /* 打つのは表に出ている欄（項目名）。備考は「細かい設定」に畳まれていて見えない */
 const name0 = await page.evaluate(() => document.getElementById('opdName').value);
 await page.fill('#opdName', name0 + '（確かめ）');
 const foot1 = await page.evaluate(() => ({ save: document.getElementById('opdSave').disabled, say: document.getElementById('opModalDirty').textContent }));
 rec('8) 欄を打つと「変更あり」・保存が押せる', !foot1.save && /^変更あり/.test(foot1.say), JSON.stringify(foot1));
 await page.click('#opdCancel');
 await W.until(page, () => /変更を戻しました/.test((document.getElementById('opModalState') || {}).textContent || ''), null, { ms: 10000, what: 'キャンセル' });
 const foot2 = await page.evaluate(() => ({ name: (document.getElementById('opdName') || {}).value, say: document.getElementById('opModalDirty').textContent }));
 rec('8) キャンセルで打った値を捨てて描き直す（「変更なし」に戻る）', foot2.name === name0 && /^変更なし/.test(foot2.say), JSON.stringify({ ...foot2, name0 }));
 await page.click('#opModalClose');
 await W.until(page, () => { const m = document.getElementById('opItemModal'); return !m || m.hidden; }, null, { ms: 8000, what: '窓を閉じる' });
}, { mode: 'edit', viewport: { width: 1728, height: 1152 } });
