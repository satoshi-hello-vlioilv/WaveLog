/* tpa-lotdsp.js: 転写計算アプリ（Defect-Pitch-Analyzer）から頼まれたときだけ、ロット問い合わせ（LotDsp）で
   ロット番号を検索し、「進度情報」タブを描き終わった画面をそのまま渡す（§9.519、利用者の指示
   「WaveLog拡張に追加して1つで管理したいが、WaveLog上での挙動とは分けて使えるようにしたい」）。

   約束
    1. **頼まれたタブでだけ動く。** 頼み（job）は background.js が「転写計算アプリが開かせたタブ」にだけ持つ。
       人が開いた LotDsp・WaveLog から開いた LotDsp（linkkey 付き）では、頼みを尋ねて空なら何もしない。
    2. **ログインはしない。** VPN のログインは lotdsp.js（§9.485）の役目。ここはログイン欄が消えるのを待つだけ
       （同じ欄を2つの物が押しに行かない）。
    3. **検索は人と同じ道。** ロット番号の欄へ`input`・`change`の合図で入れて「検索」を押す。linkkey は鋳造番号が
       要るので使わない（利用者「鋳造番号が空の場合、ロット番号のところにロット番号を入れて検索を押す」）。
    4. **どの列が何かは決めない。** 列の意味づけは転写計算アプリ（lotdsp_progress.py）の1箇所。ここは
       「頼まれたロット番号で、進度情報の実績の表が描き終わった」ことだけを確かめて HTML を渡す。
       BOX（設備の行）は最大25の可変なので、行数が落ち着くまで待つ。
    5. **黙って止まらない。** 失敗は理由を付けてアプリへ返し、LotDsp のページの下にも帯で出す。 */
'use strict';
(() => {
  const TOTAL_MS = 170000;        // アプリの待ち（180秒）より短く——理由を付けて先に返す
  const STEP_MS = 250;
  const NOT_FOUND_MS = 8000;      // 「0件」が続いたら該当なしとみなす（検索の往復を待つ）
  const STABLE_TICKS = 3;         // 実績の行数が同じまま3回続いたら描き終わり
  const SEL = {
    login: '#input_userId',
    lot: '#common_searchLtno',
    inspection: '#common_searchKnno',
    search: 'button[ng-click="action.search()"]',
    message: '#messageArea',
  };
  const $ = s => document.querySelector(s);
  const norm = s => String(s || '').normalize('NFKC').replace(/\s+/g, '');
  const shown = el => !!el && el.isConnected && el.getClientRects().length > 0
    && getComputedStyle(el).visibility !== 'hidden';
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /* ---------- 画面を読む（見出しの文字で探す。class は使わない） ---------- */
  /* 見出し｜値の小さな表（1行目「ﾛｯﾄ番号」、2行目が値）から、いま出ているロット番号。 */
  function pageLot() {
    for (const t of document.querySelectorAll('table')) {
      const r = t.rows;
      if (r.length === 2 && r[0].cells.length === 1 && norm(r[0].textContent) === 'ロット番号') {
        return norm(r[1].textContent).toUpperCase();
      }
    }
    return '';
  }
  /* 「検索結果: n件」の n（読めなければ null）。 */
  function hitCount() {
    for (const el of document.querySelectorAll('.header-label')) {
      const m = norm(el.textContent).match(/検索結果:(\d+)件/);
      if (m) return Number(m[1]);
    }
    return null;
  }
  const currentTab = () => norm(($('.MniTabTblSelTd') || {}).textContent);
  const tabLink = name => [...document.querySelectorAll('a.MniTabLnk')].find(a => norm(a.textContent) === name);
  /* 進度情報の「実績」の表（見出しに 設備 と 前ｵﾌ が並ぶ表）と、その BOX の行数。 */
  function actualTable() {
    const t = [...document.querySelectorAll('table')].find(x => {
      const h = x.rows[0] ? [...x.rows[0].cells].map(c => norm(c.textContent)) : [];
      return h.includes('設備') && h.includes('前オフ');
    });
    if (!t || !shown(t)) return null;
    const rows = [...t.rows].slice(1).filter(r => /^\d+$/.test(norm(r.cells[0] && r.cells[0].textContent)));
    return { t, rows: rows.length };
  }

  /* ---------- 入れる（lotdsp.js と同じ合図。AngularJS の ng-model は input で値を読む） ---------- */
  function put(el, v) {
    el.focus();
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /* ---------- 帯（lotdsp.js の帯は上、こちらは下。shadow DOM で相手の見た目と混ぜない） ---------- */
  let bar = null;
  function showBar(text, bad) {
    if (!bar) {
      bar = document.createElement('div');
      bar.setAttribute('data-tpa-lotdsp', '');
      bar.attachShadow({ mode: 'open' });
      document.documentElement.appendChild(bar);
    }
    bar.setAttribute('data-tpa-lotdsp', bad ? 'error' : 'busy');
    bar.shadowRoot.innerHTML = `
      <style>
        :host{all:initial}
        .b{position:fixed;left:0;right:0;bottom:0;z-index:2147483646;padding:8px 14px;
           font:13px/1.5 "Segoe UI","Yu Gothic UI",Meiryo,sans-serif;color:#0f2f3a;
           background:${bad ? '#fff4e5' : '#e8f1f8'};border-top:2px solid ${bad ? '#c96a00' : '#2b5f79'};
           box-shadow:0 -2px 8px rgba(0,0,0,.12)}
        b{font-weight:700}
      </style>
      <div class="b" role="status"><b>転写計算アプリへの取込</b>　<span id="t"></span></div>`;
    bar.shadowRoot.getElementById('t').textContent = text;
  }

  async function until(fn, ms, what) {
    const t0 = Date.now();
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() - t0 >= ms) throw new Error(what);
      await sleep(STEP_MS);
    }
  }

  async function run(job) {
    const { lotNo, nonce } = job;
    const t0 = Date.now();
    const left = () => Math.max(0, TOTAL_MS - (Date.now() - t0));
    const progress = stage => chrome.runtime.sendMessage({ type: 'tpa-progress', nonce, stage }).catch(() => {});
    const loginShown = () => shown($(SEL.login));
    try {
      /* 1) ログイン（VPN）。押すのは lotdsp.js。欄が消えるまで待つだけ。 */
      await until(() => loginShown() || shown($(SEL.lot)), left(), 'ロット問い合わせの画面が出ませんでした');
      if (loginShown()) {
        progress('login');
        showBar(`${lotNo}: ロット問い合わせのログインを待っています（ログインが済むと続けて取り込みます）`);
        await until(() => !loginShown() && shown($(SEL.lot)), left(), 'ロット問い合わせのログインが済みませんでした');
      }
      /* 2) ロット番号で検索（検査番号の欄は空にする——両方入っていると相手がどちらで探すか分からない）。 */
      progress('searching');
      showBar(`${lotNo}: ロット番号で検索しています`);
      const input = $(SEL.lot);
      put(input, lotNo);
      const kn = $(SEL.inspection);
      if (kn && kn.value) put(kn, '');
      const btn = $(SEL.search);
      if (!btn) throw new Error('「検索」ボタンが見つかりません');
      btn.click();
      const clickedAt = Date.now();
      await until(() => {
        if (pageLot() === lotNo && hitCount() !== 0) return true;
        if (hitCount() === 0 && Date.now() - clickedAt > NOT_FOUND_MS) {
          const why = norm(($(SEL.message) || {}).textContent);
          throw new Error(`ロット問い合わせに ${lotNo} が見つかりません（検索結果 0件${why ? '・' + why : ''}）`);
        }
        return false;
      }, left(), `検索の結果が出ませんでした（${lotNo}）`);
      /* 3) 進度情報タブ。検索のあとに出るタブは相手の画面が決めるので、違えば押す。 */
      if (currentTab() !== '進度情報') {
        const a = tabLink('進度情報');
        if (!a) throw new Error('「進度情報」タブが見つかりません');
        a.click();
      }
      progress('reading');
      showBar(`${lotNo}: 進度情報を読んでいます`);
      let last = -1, same = 0;
      await until(() => {
        const at = currentTab() === '進度情報' && pageLot() === lotNo ? actualTable() : null;
        if (!at) { same = 0; last = -1; return false; }
        same = at.rows === last ? same + 1 : 0;
        last = at.rows;
        return same >= STABLE_TICKS;
      }, left(), '進度情報の実績の表が出ませんでした');
      /* 4) 画面をそのまま渡す。帯は渡す前に外す（転写計算アプリが読む HTML に混ぜない）。 */
      if (bar) { bar.remove(); bar = null; }
      await chrome.runtime.sendMessage({ type: 'tpa-result', nonce, lotNo, html: document.documentElement.outerHTML });
    } catch (e) {
      showBar(`取り込めませんでした: ${e.message}`, true);
      await chrome.runtime.sendMessage({ type: 'tpa-result', nonce, lotNo, error: e.message }).catch(() => {});
    }
  }

  /* 頼みがあるタブでだけ動く（約束1）。無ければ何もしない＝WaveLog からの利用はこれまでどおり。 */
  chrome.runtime.sendMessage({ type: 'tpa-job' })
    .then(job => { if (job && job.lotNo && job.nonce) run(job); })
    .catch(e => console.debug('[WaveLog拡張] 転写計算アプリの頼みを尋ねられない（取込はしない）', e));
})();
