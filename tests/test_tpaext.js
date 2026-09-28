/* test_tpaext.js: 転写計算アプリへの進度情報の取込（同梱の拡張・§9.519）
   ================================================================
   利用者の指示「WaveLog拡張に追加して1つで管理したいが、WaveLog上での挙動とは分けて使えるようにしたい」
   「鋳造番号が空の場合、ロット番号のところにロット番号を入れて、HTML上の検索を押さなければいけません」
   「設備BOX数は最大25までの可変」。

   本物のロット問い合わせはここから届かない（VPN が無い）ので、**利用者が保存した実物と同じ形の見本**
   （tests/fixtures/lotdsp_progress.html）へ拡張の中身（tpa-lotdsp.js）をそのまま入れ、`chrome.*`は
   見本の中の小さな置き換えで持つ。background.js・tpa.js も同じく置き換えの`chrome.*`の上で動かす。
   サーバーは使わない。

   物差し（評価関数）:
    ① 頼みの無い LotDsp のタブで拡張が押した回数（検索・タブ）＝0（WaveLog からの利用と分ける）
    ② 頼まれたら: 検索1回・相手の model に届いたロット番号・進度情報タブを押した回数・渡した行数（25まで可変）
    ③ ログイン画面（VPN）では押さずに待ち、ログインが済んでから続ける（押すのは lotdsp.js）
    ④ 該当なし・タブを閉じた等は理由を付けて返す（黙って3分待たせない）
    ⑤ 頼みを受け付ける送り手・返す相手が決まっていること（背景の仕分け）
   ================================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { run } = require('./lib/harness.js');
const W = require('./lib/wait.js');
const ROOT = path.join(__dirname, '..');
const EXT = path.join(ROOT, 'program', 'lotdsp-ext');
const read = f => fs.readFileSync(path.join(EXT, f), 'utf8');
const LOT = 'L7150C0';

run('test_tpaext: 転写計算アプリへの進度情報の取込（§9.519）', async ({ page, rec }) => {
  /* ---- 0) 置き場と約束の突き合わせ（ファイルを読むだけ） ---- */
  const manifest = JSON.parse(read('manifest.json'));
  const base = fs.readFileSync(path.join(ROOT, 'static', 'js', 'core', 'base.js'), 'utf8');
  const lotBase = (base.match(/LOT_DSP_BASE='([^']+)'/) || [])[1] || '';
  const bg = read('background.js');
  const cs = manifest.content_scripts || [];
  const entry = f => cs.find(c => (c.js || []).includes(f));
  rec('権限は storage だけのまま（取込のために権限を足さない）',
      JSON.stringify(manifest.permissions) === '["storage"]' && !manifest.host_permissions, JSON.stringify(manifest.permissions));
  rec('取込の読み手（tpa-lotdsp.js）は WaveLog のログイン（lotdsp.js）と別の登録で、同じ LotDsp のページに入る',
      !!entry('tpa-lotdsp.js') && entry('tpa-lotdsp.js') !== entry('lotdsp.js')
      && JSON.stringify(entry('tpa-lotdsp.js').matches) === JSON.stringify(entry('lotdsp.js').matches),
      JSON.stringify(entry('tpa-lotdsp.js')));
  rec('アプリ側の受け口（tpa.js）は WaveLog の受け口（wavelog.js）と別の登録',
      !!entry('tpa.js') && entry('tpa.js') !== entry('wavelog.js'));
  rec('開く場所は base.js の LOT_DSP_BASE と同じ・送り手の確かめは manifest の場所と同じ',
      !!lotBase && bg.includes(`TPA_LOTDSP_URL = '${lotBase}'`)
      && bg.includes(`TPA_LOTDSP_SITE = '${entry('lotdsp.js').matches[0].replace(/\*$/, '')}'`), lotBase);

  /* ---- 見本ページと、置き換えの chrome.runtime ---- */
  const html = fs.readFileSync(path.join(__dirname, 'fixtures', 'lotdsp_progress.html'), 'utf8');
  await page.route('http://nlmfangyweb1a/**', r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
  await page.addInitScript(() => {
    if (location.host !== 'nlmfangyweb1a') return;
    window.__sent = [];
    window.chrome = { runtime: { sendMessage: async m => {
      window.__sent.push(m.html ? { ...m, html: `(${m.html.length}字)`, htmlText: m.html } : m);
      return m.type === 'tpa-job' ? (window.__job || null) : undefined;
    } } };
  });
  const content = read('tpa-lotdsp.js');
  let nth = 0;
  const open = async (query, job) => {
    nth++;
    await page.goto(`http://nlmfangyweb1a/LotDspWeb/?n=${nth}${query ? '&' + query : ''}#/lotdsp`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(j => { window.__job = j; }, job);
    await page.addScriptTag({ content });   // 拡張の content_scripts と同じ（document_idle）
  };
  const sent = () => page.evaluate(() => window.__sent.map(m => ({ ...m, htmlText: undefined })));
  const result = () => page.evaluate(() => window.__sent.find(m => m.type === 'tpa-result') || null);
  const job = { lotNo: LOT, nonce: 'n1' };

  /* ---- 1) 頼みの無いタブ（人が開いた・WaveLog から開いた）では何もしない ---- */
  await open('', null);
  await W.until(page, () => window.__sent.some(m => m.type === 'tpa-job'), null, { ms: 5000, what: '頼みを尋ねる' });
  await W.paint(page);
  let f = await page.evaluate(() => ({ ...window.__fake, model: undefined, bar: !!document.querySelector('[data-tpa-lotdsp]') }));
  let s = await sent();
  rec('頼みの無い LotDsp のタブでは、検索もタブも押さず帯も出さない（WaveLog からの利用と分ける）',
      f.searches === 0 && f.tabClicks === 0 && !f.bar && s.length === 1, JSON.stringify({ f, s }));

  /* ---- 2) 頼まれたら: ロット番号で検索 → 進度情報タブ → 描き終わった画面を渡す（BOX 25） ---- */
  await open('boxes=25', job);
  await W.until(page, () => window.__sent.some(m => m.type === 'tpa-result'), null, { ms: 20000, what: '取込の結果' });
  f = await page.evaluate(() => ({ searches: __fake.searches, start: __fake.startSearches, header: __fake.headerSearches,
                                   tabClicks: __fake.tabClicks, lot: __fake.model.lot }));
  const r25 = await page.evaluate(() => {
    const m = window.__sent.find(x => x.type === 'tpa-result') || { error: '(結果なし)' };
    const doc = new DOMParser().parseFromString(m.htmlText || '', 'text/html');
    return { error: m.error || '', nonce: m.nonce, lotNo: m.lotNo,
             rows: doc.querySelectorAll('tr[ng-repeat*="staffProgressJBoxInfos"]').length,
             bar: !!doc.querySelector('[data-tpa-lotdsp]') };
  });
  rec('最初の画面（実物の #/lotdsp）で、ロット番号の欄 #input_searchLtno へ人と同じ合図で入れ、後から現れる「検索」を1回押す（linkkey は使わない）',
      f.searches === 1 && f.start === 1 && f.header === 0 && f.lot === LOT, JSON.stringify(f));
  rec('検索のあと「進度情報」タブを押し、25 BOX すべて描き終わってから渡す（行数を決め打ちしない）',
      f.tabClicks === 1 && !r25.error && r25.rows === 25 && r25.lotNo === LOT && r25.nonce === 'n1', JSON.stringify(r25));
  rec('渡す画面に拡張の帯を混ぜない', r25.bar === false);
  s = await sent();
  rec('途中経過は 検索 → 読む の順で知らせる',
      JSON.stringify(s.filter(m => m.type === 'tpa-progress').map(m => m.stage)) === '["searching","reading"]',
      JSON.stringify(s.map(m => m.stage || m.type)));

  /* ---- 2b) 検索のあとの画面（上の検索欄）から始まっても同じように読む ---- */
  await open('header=1&boxes=10', { lotNo: LOT, nonce: 'n1b' });
  await W.until(page, () => window.__sent.some(m => m.type === 'tpa-result'), null, { ms: 20000, what: '上の検索欄からの取込' });
  const r2b = (await result()) || { error: '(結果なし)' };
  f = await page.evaluate(() => ({ start: __fake.startSearches, header: __fake.headerSearches, lot: __fake.model.lot }));
  rec('検索のあとの画面から始まったら、見えている上の検索欄（#common_searchLtno）で検索して渡す',
      !r2b.error && f.start === 0 && f.header === 1 && f.lot === LOT, JSON.stringify({ err: r2b.error, f }));

  /* ---- 3) VPN のログイン画面: 押さずに待ち、ログインが済んだら続ける ---- */
  await open('login=1&boxes=3', { lotNo: LOT, nonce: 'n2' });
  await W.until(page, () => window.__sent.some(m => m.stage === 'login'), null, { ms: 5000, what: 'ログイン待ち' });
  f = await page.evaluate(() => ({ login: __fake.loginClicks, searches: __fake.searches }));
  rec('ログイン画面では「ログイン」も「検索」も押さない（押すのは lotdsp.js）', f.login === 0 && f.searches === 0, JSON.stringify(f));
  await page.click('[ng-click="action.login()"]');   // lotdsp.js（または人）がログインしたことにする
  await W.until(page, () => window.__sent.some(m => m.type === 'tpa-result'), null, { ms: 20000, what: 'ログイン後の取込' });
  const r3 = (await result()) || { error: '(結果なし)' };
  s = await sent();
  f = await page.evaluate(() => ({ start: __fake.startSearches, header: __fake.headerSearches }));
  rec('ログインが済んだら最初の画面の検索から続け、3 BOX を渡す',
      !r3.error && f.start === 1 && f.header === 0 && JSON.stringify(s.filter(m => m.type === 'tpa-progress').map(m => m.stage)) === '["login","searching","reading"]',
      JSON.stringify({ err: r3.error, f, stages: s.map(m => m.stage || m.type) }));

  /* ---- 4) 該当なし: 理由を付けて返す・帯でも言う ---- */
  await open('', { lotNo: 'L0000A0', nonce: 'n3' });
  await W.until(page, () => window.__sent.some(m => m.type === 'tpa-result'), null, { ms: 20000, what: '該当なしの結果' });
  const r4 = (await result()) || { error: '' };
  const bar4 = await page.evaluate(() => { const b = document.querySelector('[data-tpa-lotdsp]');
    return b ? b.getAttribute('data-tpa-lotdsp') + ':' + b.shadowRoot.textContent : ''; });
  rec('該当なしは「見つかりません」と理由（相手の文言）を付けて返し、LotDsp の下の帯でも言う',
      /L0000A0 が見つかりません/.test(r4.error || '') && /該当データがありません/.test(r4.error || '') && !r4.htmlText
      && /^error:/.test(bar4) && /取り込めませんでした/.test(bar4), JSON.stringify({ err: r4.error, bar: bar4.slice(0, 80) }));

  /* ---- 5) アプリ側の受け口（tpa.js）: 見分け・頼みの中継・結果の返し ---- */
  const appHtml = port => `<!doctype html><html><head><meta charset="utf-8">${port === 'meta'
    ? '<meta name="application-name" content="TransferPitchAnalyzer">' : ''}</head><body>app</body></html>`;
  await page.route('http://127.0.0.1:57821/**', r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: appHtml('meta') }));
  await page.route('http://127.0.0.1:57822/**', r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: appHtml('meta') }));
  await page.route('http://127.0.0.1:57823/**', r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: appHtml('') }));
  await page.addInitScript(() => {
    if (location.hostname !== '127.0.0.1' || !/^578/.test(location.port)) return;
    window.__appSent = []; window.__listeners = [];
    window.chrome = { runtime: {
      getManifest: () => ({ version: '9.9.9' }),
      sendMessage: async m => { window.__appSent.push(m); return undefined; },
      onMessage: { addListener: fn => window.__listeners.push(fn) } } };
  });
  const tpa = read('tpa.js');
  const mark = async url => {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: tpa });
    return page.evaluate(() => document.documentElement.dataset.tpaLotdspExt || '');
  };
  const marks = [await mark('http://127.0.0.1:57822/'), await mark('http://127.0.0.1:57823/')];
  rec('ポートが違う・アプリの印（meta）が無いページでは名乗らない（WaveLog の画面では動かない）',
      marks.join('|') === '|', JSON.stringify(marks));
  const on = await mark('http://127.0.0.1:57821/');
  const relay = await page.evaluate(async () => {
    const got = [];
    document.addEventListener('tpa:lotdsp-result', e => got.push(JSON.parse(e.detail)));
    document.dispatchEvent(new CustomEvent('tpa:lotdsp-fetch', { detail: JSON.stringify({ lotNo: 'L7150C0', nonce: 'a1' }) }));
    await new Promise(r => setTimeout(r, 0));
    window.__listeners.forEach(fn => fn({ type: 'tpa-result', nonce: 'a1', lotNo: 'L7150C0', html: '<html>x</html>' }));
    return { sent: window.__appSent, got };
  });
  rec('転写計算アプリの画面では版を名乗り、頼みを拡張へ渡し、結果を文字列の detail で返す',
      on === '9.9.9' && relay.sent.length === 1 && relay.sent[0].type === 'tpa-fetch' && relay.sent[0].lotNo === LOT
      && relay.got.length === 1 && relay.got[0].html === '<html>x</html>', JSON.stringify({ on, relay }));

  /* ---- 6) 背景（background.js）の仕分け: 誰の頼みを受け、誰へ返すか ---- */
  await page.route('http://bg.test/**', r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><title>bg</title>' }));
  await page.goto('http://bg.test/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    const store = {}; let nextTab = 100;
    window.__bg = { created: [], updated: [], removed: [], toTab: [], msgL: [], remL: [], store };
    window.chrome = {
      action: { onClicked: { addListener() {} } },
      runtime: { openOptionsPage() {}, onMessage: { addListener: fn => __bg.msgL.push(fn) } },
      storage: { session: {
        get: async k => ({ [k]: store[k] }), set: async o => Object.assign(store, o), remove: async k => { delete store[k]; } } },
      tabs: {
        create: async o => { const t = { id: nextTab++, ...o }; __bg.created.push(t); return t; },
        update: async (id, o) => { __bg.updated.push({ id, ...o }); return { id }; },
        remove: async id => { __bg.removed.push(id); },
        sendMessage: async (id, m) => { __bg.toTab.push({ id, ...m }); },
        onRemoved: { addListener: fn => __bg.remL.push(fn) } } };
  });
  await page.addScriptTag({ content: read('background.js') });
  const bgr = await page.evaluate(async () => {
    const send = (msg, sender) => new Promise(res => {
      let answered = false;
      const keep = __bg.msgL.map(fn => fn(msg, sender, v => { answered = true; res(v); })).some(x => x === true);
      if (!keep && !answered) setTimeout(() => res('(no reply)'), 20);
    });
    const app = { url: 'http://127.0.0.1:57821/', tab: { id: 7 } };
    const evil = { url: 'http://example.com/', tab: { id: 8 } };
    const out = {};
    out.evil = await send({ type: 'tpa-fetch', lotNo: 'L7150C0', nonce: 'z' }, evil);
    out.badLot = await send({ type: 'tpa-fetch', lotNo: 'L7150C0;x', nonce: 'z' }, app);
    out.ok = await send({ type: 'tpa-fetch', lotNo: 'l7150c0', nonce: 'b1' }, app);
    const tabId = __bg.created[0] && __bg.created[0].id;
    const lot = { url: 'http://nlmfangyweb1a/LotDspWeb/#/lotdsp', tab: { id: tabId } };
    out.jobOther = await send({ type: 'tpa-job' }, { url: 'http://nlmfangyweb1a/LotDspWeb/', tab: { id: 999 } });
    out.jobFromApp = await send({ type: 'tpa-job' }, { url: 'http://127.0.0.1:57821/', tab: { id: tabId } });
    out.job = await send({ type: 'tpa-job' }, lot);
    out.createdBlank = __bg.created[0] && __bg.created[0].url;
    out.navigated = __bg.updated[0] && __bg.updated[0].url;
    await send({ type: 'tpa-result', nonce: 'wrong', html: '<html>x</html>' }, lot);
    const beforeRight = __bg.toTab.filter(m => m.type === 'tpa-result').length;
    await send({ type: 'tpa-result', nonce: 'b1', lotNo: 'L7150C0', html: '<html>ok</html>' }, lot);
    await new Promise(r => setTimeout(r, 0));
    out.beforeRight = beforeRight;
    out.toApp = __bg.toTab.map(m => ({ id: m.id, type: m.type, stage: m.stage, html: m.html, error: m.error, nonce: m.nonce }));
    out.removed = __bg.removed.slice();
    out.leftJobs = Object.keys(__bg.store);
    /* 読み終わる前にタブを閉じた */
    await send({ type: 'tpa-fetch', lotNo: 'L7150C0', nonce: 'b2' }, app);
    const t2 = __bg.created[1].id;
    await Promise.all(__bg.remL.map(fn => fn(t2)));
    out.closed = __bg.toTab.filter(m => m.nonce === 'b2' && m.type === 'tpa-result').map(m => m.error);
    return out;
  });
  rec('頼みを受けるのはループバックの画面からだけ（よそのページの頼みは受けない）・ロット番号の形も確かめる',
      bgr.evil === '(no reply)' && bgr.badLot && /形が違います/.test(bgr.badLot.error || '') && bgr.ok && bgr.ok.ok === true,
      JSON.stringify({ evil: bgr.evil, badLot: bgr.badLot, ok: bgr.ok }));
  rec('空のタブで頼みを置いてから LotDsp へ進める（読み手が尋ねるより先に置く）',
      bgr.createdBlank === 'about:blank' && bgr.navigated === 'http://nlmfangyweb1a/LotDspWeb/#/lotdsp',
      JSON.stringify({ c: bgr.createdBlank, n: bgr.navigated }));
  rec('頼みを答えるのは開いたそのタブの LotDsp にだけ（別のタブ・別のサイトには null）',
      bgr.jobOther === null && bgr.jobFromApp === '(no reply)' && bgr.job && bgr.job.lotNo === 'L7150C0' && bgr.job.nonce === 'b1',
      JSON.stringify({ o: bgr.jobOther, a: bgr.jobFromApp, j: bgr.job }));
  const ok = bgr.toApp.find(m => m.type === 'tpa-result' && m.nonce === 'b1');
  rec('印の違う結果は捨て、正しい結果だけを頼んだアプリのタブへ返し、LotDsp のタブを閉じて頼みも消す',
      bgr.beforeRight === 0 && ok && ok.id === 7 && ok.html === '<html>ok</html>'
      && bgr.removed.includes(100) && bgr.leftJobs.length === 0,
      JSON.stringify({ toApp: bgr.toApp, removed: bgr.removed, left: bgr.leftJobs }));
  rec('読み終わる前に LotDsp のタブが閉じられたら、理由を付けてアプリへ返す',
      bgr.closed.length === 1 && /閉じられました/.test(bgr.closed[0]), JSON.stringify(bgr.closed));
});
