/* tpa.js: 転写計算アプリ（Defect-Pitch-Analyzer）の画面と拡張の間の受け口（§9.519）。
   WaveLog の画面では動かない（WaveLog 側の受け口は wavelog.js）。見分けは2つとも満たすこと:
    - ポートが転写計算アプリのもの（config/appsettings.json の server.port・既定 57821）
    - `<meta name="application-name" content="TransferPitchAnalyzer">`（アプリの index.html が持つ）

   するのは3つだけ:
    1. `<html data-tpa-lotdsp-ext="版">`を付ける（アプリの画面が「拡張あり」と言える）
    2. アプリが出す`tpa:lotdsp-fetch`（detail は JSON 文字列 {lotNo, nonce}）を background.js へ渡す
    3. background.js から届く途中経過と結果を`tpa:lotdsp-progress`・`tpa:lotdsp-result`でアプリへ返す
   detail は**文字列**で渡す（拡張の側で作った物をページへ渡すと、物は読めないことがある）。 */
'use strict';
(() => {
  const TPA_PORTS = ['57821'];
  const meta = document.querySelector('meta[name="application-name"]');
  if (!TPA_PORTS.includes(location.port) || !meta || meta.content !== 'TransferPitchAnalyzer') return;
  document.documentElement.dataset.tpaLotdspExt = chrome.runtime.getManifest().version;
  const emit = (type, detail) => document.dispatchEvent(new CustomEvent(type, { detail: JSON.stringify(detail) }));

  document.addEventListener('tpa:lotdsp-fetch', async e => {
    let d = {};
    try { d = JSON.parse(e.detail || '{}'); } catch (err) { console.debug('[WaveLog拡張] 頼みの形が違う', err); }
    try {
      const r = await chrome.runtime.sendMessage({ type: 'tpa-fetch', lotNo: d.lotNo, nonce: d.nonce });
      if (r && r.error) emit('tpa:lotdsp-result', { nonce: d.nonce, error: r.error });
    } catch (err) {
      emit('tpa:lotdsp-result', { nonce: d.nonce, error: `拡張に届きませんでした（${err.message}）。Edge の拡張を読み込み直してください` });
    }
  });
  chrome.runtime.onMessage.addListener(msg => {
    if (!msg || typeof msg.nonce !== 'string') return;
    if (msg.type === 'tpa-progress') emit('tpa:lotdsp-progress', { nonce: msg.nonce, stage: msg.stage });
    else if (msg.type === 'tpa-result') {
      emit('tpa:lotdsp-result', { nonce: msg.nonce, lotNo: msg.lotNo, html: msg.html, error: msg.error });
    }
  });
})();
