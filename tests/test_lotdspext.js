/* test_lotdspext.js: ロット問い合わせの自動ログイン（同梱の拡張・§9.485）
   ================================================================
   利用者の指示「VPN環境時のID＆PASSを登録しておき、必要に応じて自動入力して自動ログイン」
   「初回登録は…登録データがないと判断されたとき、登録修正もどこかから配線」「PC単位で管理でき、
   他PCからデータが見えない場所に保存」。方式は利用者が選んだ「拡張の中に登録する」
   （WaveLog は ID・パスワードを受け取りも渡しもしない）。

   本物のロット問い合わせはここから届かない（VPN が無い）ので、**スクリーンショットと同じ形の
   見本ページ**（tests/fixtures/lotdsp_login.html）へ、拡張の中身（store.js・lotdsp.js）を
   そのまま入れて確かめる。`chrome.storage.local`だけは見本の中の小さな置き換えで持つ。

   物差し（評価関数）:
    ① 利用者が手でする操作の数（前: 欄を押す→ID→欄を押す→パスワード→ログイン＝5）
    ② 拡張が「ログイン」を押す回数（**1回だけ**。違うパスワードでも繰り返さない）
    ③ 相手の画面が受け取った値（人が打ったのと同じ合図で入れたか＝model に届いたか）
    ④ パスワードが画面の文字として出た数（帯・本文）＝0
   ================================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { run } = require('./lib/harness.js');
const W = require('./lib/wait.js');
const ROOT = path.join(__dirname, '..');
const EXT = path.join(ROOT, 'program', 'lotdsp-ext');
const FAKE = 'http://nlmfangyweb1a/LotDspWeb/#/lotdsp?linkkey=L0001%20%20%20C0001&tab=1';
const USER = 'wl-user', PASS = 'p@ss w0rd';
const EQ = 'テスト設備A';

run('test_lotdspext: ロット問い合わせの自動ログイン（§9.485）', async ({ page, rec, B }) => {
  /* ---- 0) 置き場と約束の突き合わせ（ファイルを読むだけ） ---- */
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
  const base = fs.readFileSync(path.join(ROOT, 'static', 'js', 'core', 'base.js'), 'utf8');
  const lotBase = (base.match(/LOT_DSP_BASE='([^']+)'/) || [])[1] || '';
  const lotPrefix = lotBase.replace(/#.*$/, '');
  const lotMatch = (manifest.content_scripts || []).find(c => (c.js || []).includes('lotdsp.js'));
  rec('拡張が動くのはロット問い合わせのページ（base.js の LOT_DSP_BASE と同じ場所）',
      !!lotMatch && lotMatch.matches.length === 1 && lotPrefix && lotMatch.matches[0] === lotPrefix + '*',
      `${lotMatch && lotMatch.matches} ／ ${lotPrefix}`);
  rec('拡張の権限は storage だけ（よそのサイトへ問い合わせない・同期しない）',
      JSON.stringify(manifest.permissions) === '["storage"]' && !manifest.host_permissions,
      JSON.stringify({ p: manifest.permissions, h: manifest.host_permissions }));
  const cfg = fs.readFileSync(path.join(ROOT, 'backend', 'config.py'), 'utf8');
  const port = (cfg.match(/^PORT=(\d+)/m) || [])[1];
  const wl = fs.readFileSync(path.join(EXT, 'wavelog.js'), 'utf8');
  rec('WaveLog のポートは backend/config.py と同じ', !!port && wl.includes(`WAVELOG_PORT = '${port}'`), port);
  const store = fs.readFileSync(path.join(EXT, 'store.js'), 'utf8');
  rec('置き場は chrome.storage.local（sync を使わない＝他の PC へ出ない）',
      /chrome\.storage\.local/.test(store) && !/storage\.sync/.test(store));

  /* ---- 見本ページ（本物の代わり）と、拡張の中身の入れ方 ---- */
  const html = fs.readFileSync(path.join(__dirname, 'fixtures', 'lotdsp_login.html'), 'utf8');
  await page.route('http://nlmfangyweb1a/**', r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
  /* chrome.storage.local の置き換え。**見本の localStorage に持つ**ので、開き直しても残る
     （本物と同じく「この端末に1つ」）。WaveLog の画面には入れない。 */
  await page.addInitScript(() => {
    if (location.host !== 'nlmfangyweb1a') return;
    const K = '__extStore';
    const load = () => JSON.parse(localStorage.getItem(K) || '{}');
    const keep = o => localStorage.setItem(K, JSON.stringify(o));
    window.chrome = { storage: { local: {
      get: async k => { const d = load(); return { [k]: d[k] }; },
      set: async o => { keep({ ...load(), ...o }); },
      remove: async k => { const d = load(); delete d[k]; keep(d); } } },
      runtime: { getManifest: () => ({ version: 'test' }), sendMessage() {} } };
  });
  const content = fs.readFileSync(path.join(EXT, 'store.js'), 'utf8') + '\n'
    + fs.readFileSync(path.join(EXT, 'lotdsp.js'), 'utf8');
  /* **開くたびに URL を変える**（`?n=…`）。同じ URL（`#`の後ろだけ同じ）へ goto すると、ページを
     読み直さずに前の見本と前の拡張が残ったまま続く。 */
  let nth = 0;
  const open = async (url, seed) => {
    nth++;
    const u = url.replace('/LotDspWeb/', `/LotDspWeb/?n=${nth}&`).replace('&?', '&').replace('&#', '#');
    await page.goto(u, { waitUntil: 'domcontentloaded' });
    if (seed !== undefined) {
      await page.evaluate(s => {
        localStorage.setItem('__extStore', JSON.stringify(s ? { lotdspLogin: s } : {}));
      }, seed);
    }
    await page.addScriptTag({ content });   // 拡張の content_scripts と同じ（document_idle）
  };
  const state = () => page.evaluate(pw => {
    const bar = document.querySelector('[data-wl-lotdsp]');
    const barText = bar && bar.shadowRoot ? bar.shadowRoot.textContent : '';
    const barVals = bar && bar.shadowRoot ? [...bar.shadowRoot.querySelectorAll('input')].map(i => i.value) : [];
    return { bar: bar ? bar.getAttribute('data-wl-lotdsp') : '', clicks: window.__fake.clicks,
             sent: window.__fake.sent, done: !document.getElementById('result').hidden,
             leak: (document.body.innerText + barText).includes(pw) || barVals.includes(pw),
             stored: JSON.parse(localStorage.getItem('__extStore') || '{}').lotdspLogin || null };
  }, PASS);
  const clearTry = () => page.evaluate(() => { sessionStorage.clear(); });

  /* ---- 1) ログイン済みの画面では何もしない ---- */
  await open(FAKE.replace('/LotDspWeb/', '/LotDspWeb/?loggedin=1'), { userId: USER, password: PASS });
  await W.paint(page);
  let s = await state();
  rec('ログイン済みの画面では押さない・帯も出さない', s.clicks === 0 && !s.bar, JSON.stringify(s));

  /* ---- 2) 登録済み: 入れて1回押す（手の操作 5 → 0） ---- */
  await clearTry();
  await open(FAKE, { userId: USER, password: PASS });
  await W.until(page, () => window.__fake.clicks > 0 && !document.getElementById('result').hidden, null,
                { ms: 8000, what: '自動ログイン' });
  s = await state();
  rec('登録済みなら ID・パスワードを入れて「ログイン」を1回押す（手の操作 5→0）',
      s.clicks === 1 && s.done, JSON.stringify({ clicks: s.clicks, done: s.done }));
  rec('相手の画面は人が打ったのと同じ値を受け取る（input の合図で model に届く）',
      s.sent.length === 1 && s.sent[0].userId === USER && s.sent[0].password === PASS);
  await W.until(page, () => document.querySelector('[data-wl-lotdsp="ok"]'), null, { ms: 3000, what: '成功の帯' });
  s = await state();
  rec('ログインできたことを帯で言い、パスワードは画面の文字に出さない', s.bar === 'ok' && !s.leak, JSON.stringify({ bar: s.bar, leak: s.leak }));

  /* ---- 3) パスワードが違う: 押すのは1回だけ・8秒で「直す」帯。開き直しても押さない ---- */
  await clearTry();
  await open(FAKE, { userId: USER, password: 'old-pass' });
  await W.until(page, () => document.querySelector('[data-wl-lotdsp="fix"]'), null, { ms: 12000, what: '失敗の帯' });
  s = await state();
  rec('違うパスワードでも押すのは1回だけ。失敗は帯で言い、IDだけ入れ直した形で出す',
      s.clicks === 1 && s.bar === 'fix' && !s.leak && !s.done, JSON.stringify({ clicks: s.clicks, bar: s.bar, leak: s.leak }));
  await open(FAKE);               // 同じタブで開き直す（控えた「直前に押した」が効く）
  await W.until(page, () => document.querySelector('[data-wl-lotdsp="fix"]'), null, { ms: 5000, what: '開き直しの帯' });
  s = await state();
  rec('開き直しても続けて押さない（ロックさせない）', s.clicks === 0 && s.bar === 'fix', JSON.stringify({ clicks: s.clicks, bar: s.bar }));
  /* 帯の中で直すと、保存してそのままログインする。 */
  await page.evaluate(pw => {
    const r = document.querySelector('[data-wl-lotdsp]').shadowRoot;
    r.getElementById('p').value = pw; r.getElementById('go').click();
  }, PASS);
  await W.until(page, () => !document.getElementById('result').hidden, null, { ms: 8000, what: '直してログイン' });
  s = await state();
  rec('帯で直すと保存してそのままログインする', s.done && s.stored && s.stored.password === PASS && s.clicks === 1,
      JSON.stringify({ done: s.done, clicks: s.clicks, user: s.stored && s.stored.userId }));

  /* ---- 4) 未登録: 押さずに登録の帯。帯で登録するとログインまで進む ---- */
  await clearTry();
  await open(FAKE, null);
  await W.until(page, () => document.querySelector('[data-wl-lotdsp="register"]'), null, { ms: 5000, what: '登録の帯' });
  s = await state();
  rec('未登録なら押さずに「登録」の帯を出す', s.clicks === 0 && s.bar === 'register', JSON.stringify({ clicks: s.clicks, bar: s.bar }));
  await page.evaluate(([u, pw]) => {
    const r = document.querySelector('[data-wl-lotdsp]').shadowRoot;
    r.getElementById('u').value = u; r.getElementById('p').value = pw; r.getElementById('go').click();
  }, [USER, PASS]);
  await W.until(page, () => !document.getElementById('result').hidden, null, { ms: 8000, what: '登録してログイン' });
  s = await state();
  rec('帯で登録すると、この端末に保存してログインまで進む', s.done && s.clicks === 1 && s.stored && s.stored.userId === USER,
      JSON.stringify({ done: s.done, clicks: s.clicks, user: s.stored && s.stored.userId }));

  /* ---- 5) WaveLog の「使用設備の設定」③: 拡張の有無・入れ方・設定を開く道 ---- */
  await page.goto(B + '/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(e => localStorage.setItem('AccessMeasurementConfiguredEquipment', e), EQ);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await W.booted(page);
  const openModal = async () => {
    await page.click('.hd-chip-equip');
    await W.until(page, () => { const m = document.getElementById('appSettingsModal');
      return m && !m.hidden && /拡張: /.test((document.getElementById('lotdspExtNow') || {}).textContent || ''); },
      null, { ms: 15000, what: '使用設備の設定③' });
  };
  await openModal();
  await W.until(page, () => /lotdsp-ext/.test((document.getElementById('lotdspExtBody') || {}).textContent || ''),
                null, { ms: 8000, what: '拡張の置き場' });
  const off = await page.evaluate(() => ({ now: document.getElementById('lotdspExtNow').textContent,
    body: document.getElementById('lotdspExtBody').textContent.replace(/\s+/g, ' '),
    copy: !!document.getElementById('lotdspExtCopy') }));
  rec('拡張が無い端末では「入っていません」と入れ方（edge://extensions・展開して読み込み・フォルダ）を出す',
      /入っていません/.test(off.now) && /edge:\/\/extensions/.test(off.body) && /展開して読み込み/.test(off.body)
      && /program[\\/]lotdsp-ext/.test(off.body) && off.copy, off.body.slice(0, 120));
  const ext = await page.evaluate(() => fetch('/api/lotdsp/ext').then(r => r.json()));
  rec('WaveLog が答えるのは拡張の置き場と版だけ（ID・パスワードの鍵を持たない）',
      ext.found === true && !!ext.version && !Object.keys(ext).some(k => /pass|user/i.test(k)), JSON.stringify(Object.keys(ext)));
  await page.click('#closeAppSettings');
  /* 拡張が入っている端末（wavelog.js が名乗る印）を作って開き直す。 */
  await page.evaluate(() => {
    document.documentElement.dataset.lotdspExt = '1.0.0';
    window.__optAsked = 0;
    document.addEventListener('wl:lotdsp-options', () => { window.__optAsked++; });
  });
  await openModal();
  const on = await page.evaluate(() => ({ now: document.getElementById('lotdspExtNow').textContent,
    btn: !!document.getElementById('lotdspExtOpen') }));
  await page.click('#lotdspExtOpen');
  const asked = await page.evaluate(() => window.__optAsked);
  rec('拡張が入っていれば「入っています」と、登録・修正を開くボタン（拡張へ頼む合図を出す）',
      /入っています/.test(on.now) && on.btn && asked === 1, JSON.stringify({ ...on, asked }));
  await page.click('#closeAppSettings');
});
