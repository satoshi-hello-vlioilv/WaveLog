/* lotdsp.js: ロット問い合わせ（LotDsp）のログイン画面で、登録した ID・パスワードを入れて
   「ログイン」を押す（§9.485、利用者の指示「VPN環境時のID＆PASSを登録しておき、必要に応じて
   自動入力して自動ログイン」「初回登録は…登録データがないと判断されたとき」）。

   約束
    1. **押すのは1回だけ。** 押して8秒たってもログイン欄が残っていたら失敗とみなし、帯で知らせて
       繰り返さない（パスワードが変わったとき、何度も打ち込んでロックさせない）。開き直しても
       同じ（直近の試みを`sessionStorage`に控える）。
    2. **未登録なら、その場で登録できる帯**を出す。登録したらそのまま入れてログインする。
    3. パスワードは**画面の文字として出さない**（帯・知らせ・コンソール）。入れるのはログイン欄だけ。
    4. 欄への入れ方は**人が打ったのと同じ合図**（`input`・`change`）を出す——相手の画面
       （AngularJS の`ng-model`）はその合図で値を読む。値を直に書くだけだと空のまま送られる。 */
'use strict';
(() => {
  const SEL = { user: '#input_userId', pass: '#input_password', btn: 'button[ng-click*="action.login"]' };
  const WAIT_MS = 8000;           // 押してから「失敗」とみなすまで
  const RETRY_GUARD_MS = 30000;   // この間に開き直しても、もう1度は押さない
  const TRY_KEY = 'wlLotdspTry';
  const BACK_KEY = 'wlLotdspBack';
  const $ = s => document.querySelector(s);
  const shown = el => !!el && el.isConnected && el.getClientRects().length > 0
    && getComputedStyle(el).visibility !== 'hidden';
  const loginButton = () => $(SEL.btn)
    || [...document.querySelectorAll('button')].find(b => shown(b) && /ログイン/.test(b.textContent || ''));
  /* ログイン欄が**いま見えているか**。欄が DOM に在っても伏せてある（ng-show）ときは見えていない。 */
  function loginForm() {
    const u = $(SEL.user), p = $(SEL.pass), b = loginButton();
    return shown(u) && shown(p) && b ? { u, p, b } : null;
  }
  function put(el, v) {
    el.focus();
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const recentTry = () => {
    try { return Date.now() - Number(sessionStorage.getItem(TRY_KEY) || 0) < RETRY_GUARD_MS; }
    catch (e) { return false; }
  };
  const markTry = on => {
    try { if (on) sessionStorage.setItem(TRY_KEY, String(Date.now())); else sessionStorage.removeItem(TRY_KEY); }
    catch (e) { console.debug('[WaveLog拡張] 押した時刻を控えられない（同じページの中では二度押ししない）', e); }
  };

  /* ---------- 帯（相手のページの見た目と混ざらないよう shadow DOM の中に置く） ---------- */
  let bar = null;
  function closeBar() { if (bar) { bar.remove(); bar = null; } }
  function showBar(kind, opts) {
    closeBar();
    bar = document.createElement('div');
    bar.setAttribute('data-wl-lotdsp', kind);
    const root = bar.attachShadow({ mode: 'open' });
    const o = opts || {};
    const form = kind === 'register' || kind === 'fix';
    const title = {
      register: 'ロット問い合わせのログインが、この端末にまだ登録されていません。',
      fix: '自動でログインできませんでした。ID・パスワードが変わっていないか確かめ、直してください。',
      ok: '登録したID・パスワードで自動ログインしました。'
    }[kind] || '';
    root.innerHTML = `
      <style>
        :host{all:initial}
        .b{position:fixed;left:0;right:0;top:0;z-index:2147483646;display:flex;flex-wrap:wrap;gap:8px 12px;
           align-items:center;padding:8px 14px;font:13px/1.5 "Segoe UI","Yu Gothic UI",Meiryo,sans-serif;
           color:#0f2f3a;background:${kind === 'fix' ? '#fff4e5' : '#e6f4f3'};
           border-bottom:2px solid ${kind === 'fix' ? '#c96a00' : '#0f766e'};box-shadow:0 2px 8px rgba(0,0,0,.12)}
        .t{font-weight:700}
        .w{color:#475569}
        label{display:inline-flex;align-items:center;gap:6px}
        input{height:26px;padding:0 8px;border:1px solid #94a3b8;border-radius:4px;font:inherit;width:12em}
        button{height:28px;padding:0 12px;border-radius:4px;font:inherit;cursor:pointer;border:1px solid #0f766e;background:#fff;color:#0f766e}
        button.p{background:#0f766e;color:#fff;font-weight:700}
        .e{color:#b42318;font-weight:700}
        .sp{flex:1}
      </style>
      <div class="b" role="status">
        <span class="t">${title}</span>
        ${form ? `<span class="w">登録すると、次から自動でログインします（ID・パスワードは Edge のこの PC にだけ保存します）。</span>
        <label>ユーザーID <input id="u" autocomplete="off"></label>
        <label>パスワード <input id="p" type="password" autocomplete="off"></label>
        <button type="button" class="p" id="go">${kind === 'fix' ? '直してログイン' : '登録してログイン'}</button>
        <span class="e" id="err"></span>` : ''}
        <span class="sp"></span>
        <button type="button" id="x">${form ? '今回はしない' : '閉じる'}</button>
      </div>`;
    document.documentElement.appendChild(bar);
    root.getElementById('x').onclick = closeBar;
    if (form) {
      const u = root.getElementById('u'), p = root.getElementById('p'), err = root.getElementById('err');
      u.value = o.userId || '';
      (o.userId ? p : u).focus();
      const go = async () => {
        err.textContent = '';
        try {
          await WLLotdspStore.save(u.value, p.value);
          closeBar();
          markTry(false);
          await tryLogin(true);
        } catch (e) { err.textContent = e.message; }
      };
      root.getElementById('go').onclick = go;
      p.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    }
    if (kind === 'ok') setTimeout(() => { if (bar && bar.getAttribute('data-wl-lotdsp') === 'ok') closeBar(); }, 4000);
  }

  /* ---------- 入れて押す ---------- */
  let busy = false;
  async function tryLogin(fromBar) {
    if (busy) return;
    const f = loginForm();
    if (!f) return;
    busy = true;
    try {
      const cred = await WLLotdspStore.get();
      if (!cred) { showBar('register'); return; }
      /* 直前に押して失敗した続き（開き直し）なら、もう押さない（約束1）。 */
      if (!fromBar && recentTry()) { showBar('fix', { userId: cred.userId }); return; }
      markTry(true);
      /* ログインのあと相手が元のロットを開き直さなかったときのために、開いていた場所を控える。 */
      try { sessionStorage.setItem(BACK_KEY, location.href); }
      catch (e) { console.debug('[WaveLog拡張] 開いていた場所を控えられない（ログイン後に戻せないだけ）', e); }
      put(f.u, cred.userId);
      put(f.p, cred.password);
      f.b.click();
      const t0 = Date.now();
      while (Date.now() - t0 < WAIT_MS) {
        await new Promise(r => setTimeout(r, 250));
        if (!loginForm()) {                    // 欄が消えた＝ログインできた
          markTry(false);
          showBar('ok');
          backToLot();
          return;
        }
      }
      showBar('fix', { userId: cred.userId });
    } finally { busy = false; }
  }
  /* ログイン前に開いていたロット（linkkey 付き）から外れていたら、1度だけ戻す。 */
  function backToLot() {
    let back = '';
    try { back = sessionStorage.getItem(BACK_KEY) || ''; sessionStorage.removeItem(BACK_KEY); } catch (e) { return; }
    if (back && /[?&]linkkey=/.test(back) && location.href !== back) location.replace(back);
  }

  /* ---------- 見張り: ログイン欄が現れたら1回だけ動く ---------- */
  let was = false;
  const check = () => {
    const now = !!loginForm();
    if (now && !was) tryLogin(false);
    was = now;
  };
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; check(); });
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true,
    attributeFilter: ['class', 'style', 'hidden'] });
  check();
})();
