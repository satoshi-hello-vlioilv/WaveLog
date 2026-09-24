/* background.js: 拡張の設定画面（登録・直す・消す）を開く道（§9.485）。
   開く合図は2つ——ツールバーの拡張のアイコン／WaveLog の「使用設備の設定」③のボタン
   （wavelog.js が中継する）。**道は`openOptionsPage()`の1本**。 */
'use strict';
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
chrome.runtime.onMessage.addListener(msg => {
  if (msg && msg.type === 'open-options') chrome.runtime.openOptionsPage();
});
