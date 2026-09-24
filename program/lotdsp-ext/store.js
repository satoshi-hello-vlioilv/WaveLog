/* store.js: ロット問い合わせのログインID・パスワードの置き場（§9.485）。**答えはここ1箇所**
   ——ログイン画面（lotdsp.js）も設定画面（options.js）もこれを通す。

   置き場は拡張の`chrome.storage.local`＝**Edge のこの PC・この Windows ユーザーの領域**。
   `sync`は使わない（他の PC へ同期させない）。WaveLog 本体へは渡さない。
   正直な限界: Edge のパスワード保存と違い、Windows のログオンで暗号化はされない。
   守りは「この PC のこのユーザーのフォルダ」であることだけ。 */
'use strict';
var WLLotdspStore = (() => {
  const KEY = 'lotdspLogin';
  const MAX_LEN = 256;
  const area = () => chrome.storage.local;
  /* 登録済みなら {userId, password, savedAt}、無ければ null。 */
  async function get() {
    const got = await area().get(KEY);
    const v = got && got[KEY];
    return v && v.userId ? v : null;
  }
  /* `password`が`null`なら**いまのパスワードのまま**ユーザーIDだけ直す。 */
  async function save(userId, password) {
    const id = String(userId || '').trim();
    if (!id) throw new Error('ユーザーIDを入れてください');
    let pw = password;
    if (pw == null) {
      const cur = await get();
      if (!cur) throw new Error('パスワードを入れてください（まだ登録されていません）');
      pw = cur.password;
    }
    pw = String(pw);
    if (!pw) throw new Error('パスワードを入れてください');
    if (id.length > MAX_LEN || pw.length > MAX_LEN) throw new Error(`ユーザーID・パスワードは${MAX_LEN}文字までです`);
    await area().set({ [KEY]: { userId: id, password: pw, savedAt: new Date().toISOString() } });
    return { userId: id };
  }
  async function remove() { await area().remove(KEY); }
  return { get, save, remove, KEY };
})();
