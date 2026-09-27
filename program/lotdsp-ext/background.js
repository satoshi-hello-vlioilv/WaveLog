/* background.js: 拡張の設定画面（登録・直す・消す）を開く道（§9.485）。
   開く合図は2つ——ツールバーの拡張のアイコン／WaveLog の「使用設備の設定」③のボタン
   （wavelog.js が中継する）。**道は`openOptionsPage()`の1本**。 */
'use strict';
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
chrome.runtime.onMessage.addListener(msg => {
  if (msg && msg.type === 'open-options') chrome.runtime.openOptionsPage();
});

/* ---- 転写計算アプリ（Defect-Pitch-Analyzer）への進度情報の取込（§9.519） ----
   WaveLog の道（上）とは**別の道**。頼みはアプリの画面（tpa.js）から来て、この拡張が開いた
   LotDsp のタブ（tpa-lotdsp.js）へ渡し、読めた画面をアプリへ返す。
   - 頼み（job）は開いたタブの番号ごとに`chrome.storage.session`へ持つ（この Edge の起動のあいだだけ・
     content script からは読めない）。**頼みの無い LotDsp のタブでは tpa-lotdsp.js は何もしない。**
   - 送り手は URL で確かめる（頼みはループバックの画面から・読めた画面は LotDsp のページから）。
   - 新しい権限は要らない（tabs.create／update／remove／sendMessage は`tabs`権限なしで使える）。 */
const TPA_LOTDSP_URL = 'http://nlmfangyweb1a/LotDspWeb/#/lotdsp';   // base.js の LOT_DSP_BASE と同じ
const TPA_LOTDSP_SITE = 'http://nlmfangyweb1a/LotDspWeb/';          // manifest の content_scripts と同じ
const TPA_LOT_RE = /^[A-Z0-9]{1,12}$/;
const tpaKey = tabId => `tpaJob:${tabId}`;
const tpaHost = u => { try { return new URL(u).hostname; } catch (e) { return ''; } };
const tpaFromApp = s => !!(s && s.tab && ['127.0.0.1', 'localhost'].includes(tpaHost(s.url)));
const tpaFromLotdsp = s => !!(s && s.tab && String(s.url || '').startsWith(TPA_LOTDSP_SITE));

async function tpaJob(tabId) {
  const k = tpaKey(tabId);
  const got = await chrome.storage.session.get(k);
  return (got && got[k]) || null;
}
function tpaToApp(job, msg) {
  return chrome.tabs.sendMessage(job.appTabId, { ...msg, nonce: job.nonce })
    .catch(e => console.debug('[WaveLog拡張] 転写計算アプリのタブへ届かない（閉じられた）', e));
}
/* 頼みを受けて LotDsp を開く。**先に空のタブを作って頼みを置き、それから LotDsp へ進める**——
   いきなり LotDsp で開くと、tpa-lotdsp.js が頼みを尋ねる方が置くより先になることがある。 */
async function tpaFetch(msg, appTab) {
  const lotNo = String(msg.lotNo || '').trim().toUpperCase();
  const nonce = String(msg.nonce || '').slice(0, 64);
  if (!TPA_LOT_RE.test(lotNo)) return { error: `ロット番号の形が違います（${lotNo || '空'}）` };
  if (!nonce) return { error: '頼みの印がありません' };
  const tab = await chrome.tabs.create({ url: 'about:blank', active: true, openerTabId: appTab.id });
  const job = { lotNo, nonce, appTabId: appTab.id, at: Date.now() };
  await chrome.storage.session.set({ [tpaKey(tab.id)]: job });
  await chrome.tabs.update(tab.id, { url: TPA_LOTDSP_URL });
  tpaToApp(job, { type: 'tpa-progress', stage: 'opened' });
  return { ok: true };
}
/* 結果をアプリへ返し、頼みを消す。読めたら LotDsp のタブは閉じる（この取込のために開いたタブ）。
   読めなかったときは残す——何が出ているかを人が確かめられるように。どちらもアプリのタブへ戻す。 */
async function tpaResult(msg, tab) {
  const job = await tpaJob(tab.id);
  if (!job || job.nonce !== msg.nonce) return;
  await chrome.storage.session.remove(tpaKey(tab.id));
  const ok = !msg.error && typeof msg.html === 'string' && msg.html.length > 0;
  await tpaToApp(job, ok
    ? { type: 'tpa-result', lotNo: job.lotNo, html: msg.html }
    : { type: 'tpa-result', lotNo: job.lotNo, error: String(msg.error || '進度情報を読めませんでした') });
  chrome.tabs.update(job.appTabId, { active: true }).catch(() => {});
  if (ok) chrome.tabs.remove(tab.id).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('tpa-')) return undefined;
  if (msg.type === 'tpa-fetch' && tpaFromApp(sender)) {
    tpaFetch(msg, sender.tab).then(reply, e => reply({ error: e.message }));
    return true;
  }
  if (msg.type === 'tpa-job' && tpaFromLotdsp(sender)) {
    tpaJob(sender.tab.id).then(j => reply(j ? { lotNo: j.lotNo, nonce: j.nonce } : null), () => reply(null));
    return true;
  }
  if (msg.type === 'tpa-progress' && tpaFromLotdsp(sender)) {
    tpaJob(sender.tab.id).then(j => {
      if (j && j.nonce === msg.nonce) tpaToApp(j, { type: 'tpa-progress', stage: String(msg.stage || '') });
    });
    return undefined;
  }
  if (msg.type === 'tpa-result' && tpaFromLotdsp(sender)) {
    tpaResult(msg, sender.tab);
    return undefined;
  }
  return undefined;
});
/* 読み終わる前に LotDsp のタブが閉じられたら、アプリに理由を返す（3分待たせない）。 */
chrome.tabs.onRemoved.addListener(async tabId => {
  const job = await tpaJob(tabId);
  if (!job) return;
  await chrome.storage.session.remove(tpaKey(tabId));
  tpaToApp(job, { type: 'tpa-result', lotNo: job.lotNo, error: '読み終わる前に LotDsp のタブが閉じられました' });
});
