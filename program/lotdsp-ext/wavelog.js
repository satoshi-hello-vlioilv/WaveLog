/* wavelog.js: WaveLog の画面に「拡張が入っている」ことを名乗る（§9.485）。
   **ID・パスワードは WaveLog へ渡さない**——ここがするのは2つだけ:
    1. `<html data-lotdsp-ext="版">`を付ける（使用設備の設定③が「入っています」と言える）
    2. WaveLog が出す`wl:lotdsp-options`の合図で、拡張の設定画面を開く
   WaveLog 以外のローカルのページでは何もしない（ポートで見分ける）。 */
'use strict';
(() => {
  const WAVELOG_PORT = '5029';   // backend/config.py の PORT と同じ（test_lotdspext.js が突き合わせる）
  if (location.port !== WAVELOG_PORT) return;
  document.documentElement.dataset.lotdspExt = chrome.runtime.getManifest().version;
  document.addEventListener('wl:lotdsp-options', () => chrome.runtime.sendMessage({ type: 'open-options' }));
})();
