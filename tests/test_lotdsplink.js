/* test_lotdsplink.js: 使用設備の設定③「ロット問い合わせのログイン」と LotData-Link（§9.485・§9.521）
   ================================================================
   ロット問い合わせの自動ログインと転写計算アプリへの取込は、別のアプリ **LotData-Link**（Edge 拡張・
   別リポジトリ）へ移した（利用者の指示「WaveLog の付属品的な扱いから切り離し、ロット問い合わせとアプリとの
   リンクを扱うデータリレー的な立ち位置の単独アプリ」）。拡張そのものの試験は LotData-Link の tests/ が持つ。
   WaveLog に残るのは**画面の約束**だけ——拡張が`<html data-lotdsp-ext="版">`で名乗り、WaveLog は
   `wl:lotdsp-options`の合図で登録画面を頼む。WaveLog は ID・パスワードを受け取りも渡しもしない。

   物差し（評価関数）:
    ① 入っていない端末: 「入っていません」と入れ方（LotData-Link・edge://extensions・展開して読み込み・extension フォルダ）
    ② 以前の同梱の拡張（版 1.x）: 「入れ替えが要ります」と、**古い拡張を先に消す**手順（二重ログインを防ぐ）
    ③ LotData-Link（版 2 以上）: 「入っています」と、登録画面を頼むボタン（合図を1回出す）
    ④ 同梱の拡張の置き場を答える口（/api/lotdsp/ext）は残っていない
   ================================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { run } = require('./lib/harness.js');
const W = require('./lib/wait.js');
const ROOT = path.join(__dirname, '..');
const EQ = 'テスト設備A';

run('test_lotdsplink: 使用設備の設定③と LotData-Link（§9.485・§9.521）', async ({ page, rec, B }) => {
  rec('同梱の拡張のフォルダは残っていない（拡張は LotData-Link が持つ）',
      !fs.existsSync(path.join(ROOT, 'program', 'lotdsp-ext')));

  await page.goto(B + '/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(e => localStorage.setItem('AccessMeasurementConfiguredEquipment', e), EQ);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await W.booted(page);
  const openModal = async () => {
    await page.click('.hd-chip-equip');
    await W.until(page, () => { const m = document.getElementById('appSettingsModal');
      return m && !m.hidden && /LotData-Link|入れ替え/.test((document.getElementById('lotdspExtNow') || {}).textContent || ''); },
      null, { ms: 15000, what: '使用設備の設定③' });
  };
  const read = () => page.evaluate(() => ({
    now: document.getElementById('lotdspExtNow').textContent,
    cls: document.getElementById('lotdspExtNow').className,
    body: document.getElementById('lotdspExtBody').textContent.replace(/\s+/g, ' '),
    btn: !!document.getElementById('lotdspExtOpen') }));
  /* 拡張の名乗りを作る（本物は LotData-Link の app-wavelog.js が document_start で付ける）。 */
  const pretend = ver => page.evaluate(v => {
    if (v) document.documentElement.dataset.lotdspExt = v; else delete document.documentElement.dataset.lotdspExt;
  }, ver);

  /* ---- ① 入っていない ---- */
  await openModal();
  let s = await read();
  rec('入っていない端末では「入っていません」と、LotData-Link の入れ方（edge://extensions・展開して読み込み・extension フォルダ）',
      /LotData-Link: 入っていません/.test(s.now) && /LotData-Link/.test(s.body) && /edge:\/\/extensions/.test(s.body)
      && /展開して読み込み/.test(s.body) && /extension/.test(s.body) && !s.btn && !/program[\\/]lotdsp-ext/.test(s.body),
      s.body.slice(0, 140));
  await page.click('#closeAppSettings');

  /* ---- ② 以前の同梱の拡張（1.x） ---- */
  await pretend('1.1.1');
  await openModal();
  s = await read();
  rec('以前の同梱の拡張なら「入れ替えが要ります」（設定要の色）と、古い拡張を先に消す手順を入れ方より前に出す',
      /入れ替えが要ります/.test(s.now) && /is-none/.test(s.cls) && /削除/.test(s.body)
      && s.body.indexOf('削除') < s.body.indexOf('展開して読み込み') && /登録し直/.test(s.body) && !s.btn,
      JSON.stringify({ now: s.now, cls: s.cls }));
  await page.click('#closeAppSettings');

  /* ---- ③ LotData-Link ---- */
  await pretend('2.0.0');
  await page.evaluate(() => { window.__optAsked = 0; document.addEventListener('wl:lotdsp-options', () => { window.__optAsked++; }); });
  await openModal();
  s = await read();
  await page.click('#lotdspExtOpen');
  const asked = await page.evaluate(() => window.__optAsked);
  rec('LotData-Link が入っていれば「入っています（版）」と、登録・修正を開くボタン（合図を1回出す）',
      /LotData-Link: 入っています（2\.0\.0）/.test(s.now) && s.btn && asked === 1, JSON.stringify({ now: s.now, asked }));
  await page.click('#closeAppSettings');

  /* ---- ④ 置き場を答える口は無い ---- */
  const code = await page.evaluate(() => fetch('/api/lotdsp/ext').then(r => r.status));
  rec('同梱の拡張の置き場を答える口（/api/lotdsp/ext）は残っていない', code === 404, String(code));
});
