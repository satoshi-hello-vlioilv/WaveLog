/* options.js: 拡張の設定画面（登録・直す・消す）。置き場の答えは store.js の1箇所（§9.485）。 */
'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const say = (text, cls) => { $('msg').textContent = text; $('msg').className = cls || ''; };
  let registered = false;
  async function paint() {
    const cur = await WLLotdspStore.get();
    registered = !!cur;
    $('now').textContent = cur ? `登録済み（ユーザーID: ${cur.userId}）` : '未登録';
    $('now').className = 'now' + (cur ? ' is-on' : '');
    $('u').value = cur ? cur.userId : '';
    $('p').value = '';
    /* 未登録のときはパスワードが要る——「空のままでよい」と言わない。 */
    $('pHint').hidden = !cur;
    $('del').disabled = !cur;
  }
  $('save').onclick = async () => {
    try {
      const pw = $('p').value;
      await WLLotdspStore.save($('u').value, registered && !pw ? null : pw);
      await paint();
      say('保存しました。次にロット問い合わせでログイン画面が出たら、自動でログインします。', 'ok');
    } catch (e) { say(e.message, 'ng'); }
  };
  $('del').onclick = async () => {
    if (!confirm('この PC に登録したロット問い合わせのログインを消します。よろしいですか？')) return;
    await WLLotdspStore.remove();
    await paint();
    say('消しました。', 'ok');
  };
  paint();
})();
