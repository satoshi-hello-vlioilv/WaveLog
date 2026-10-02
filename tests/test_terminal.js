/* test_terminal.js: 端末の控え（§9.545・評価関数 E6）
   ================================================================
   ブラウザの保存領域は「どこから開いたか（オリジン）」ごとに別。ブラウザ版（Edge・127.0.0.1:5029）と
   デスクトップ版（WebView2・wavelog.localhost）は互いの記録・設定を見られない。両方から届く Python に
   「端末の控え」を置き、画面は保存のたびにそこへ書き、開いたときに突き合わせる。

   ここでは**同じサーバーを2つのオリジン**（127.0.0.1 と localhost）で開き、2つの窓に見立てる
   （オリジンが違えば Chromium は保存領域を分ける——本物の2つの窓と同じ「互いに見えない」形）。

   物差し（E6・設計書 §8）:
    ① 共有へ送っていない記録が、もう一方の窓で開ける（件数と中身の指紋が一致）
    ② 2つの窓を行き来しても、更新時刻の新しいほうが勝つ（両方向）
    ③ 消した記録は戻らない（消した後の古い記録も控えが受け付けない）
    ④ 設定（localStorage）は変わった名前だけ届き、消した名前も届く（両方向）
    ⑤ 初めて控えと揃える窓では、手元に在る設定が正（前の版から使い込んだ設定を消さない）
    ⑥ 控えの値に `</script>` が入っていても画面の HTML は壊れない
    ⑦ 送る前に読み直した変更は手元が勝つ（控えの古い値で戻らない）
   ================================================================ */
'use strict';
const crypto = require('crypto');
const { run } = require('./lib/harness.js');
const W = require('./lib/wait.js');

const A = 'http://127.0.0.1:5029', Bo = 'http://localhost:5029';
const KEY = 'wlTerminalProbeV1';
const sha = o => crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex').slice(0, 12);
const iso = ms => new Date(ms).toISOString();

run('test_terminal: 端末の控え——2つの窓で記録と設定を揃える（§9.545・E6）', async ({ page, rec, errs }) => {
  const pageB = await page.context().newPage();
  const open = async (p, base) => {
    await p.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await W.booted(p);
    await p.evaluate(() => WL.records.terminalReconciled());
  };
  const flush = p => p.evaluate(() => WL.terminalStore.flushSettings(false));
  const get = (p, id) => p.evaluate(i => WL.records.reliableGet(i), id);
  const ids = p => p.evaluate(() => WL.records.reliableAll().then(a => a.map(x => x.id).sort()));
  const index = () => fetch(A + '/api/terminal/records').then(r => r.json()).then(j => j.items || []);

  await open(page, A);
  rec('控えが有効（サーバーが設定を画面へ埋めて渡している）', await page.evaluate(() => WL.terminalStore.enabled()));

  /* ---- ① 共有へ送っていない記録が、もう一方の窓で開ける ---- */
  const id = 'term-' + Date.now().toString(36);
  const t0 = Date.now() - 60000;
  const rec1 = { id, status: '編集中', updatedAt: iso(t0), basic: { lotNo: 'TERM-' + id.slice(-5), inspectionNo: '', castingNo: '' },
    settings: { registeredEquipment: 'テスト設備A' }, measurements: { note: '日本語の値・①' } };
  await page.evaluate(r => WL.records.reliablePut(r), rec1);
  await W.poll(index, items => items.some(x => x.id === id), 10000);
  const share = await fetch(A + '/api/measurement/backup/get?id=' + encodeURIComponent(id)).then(r => r.json());
  rec('前提: この記録は共有へ送っていない（共有のバックアップに無い）', !share.item);
  await open(pageB, Bo);
  const gotB = await get(pageB, id);
  rec('① 共有へ送っていない記録が、もう一方の窓（別のオリジン）で開ける',
      !!gotB && gotB.measurements && gotB.measurements.note === '日本語の値・①');
  const idsA = await ids(page), idsB = await ids(pageB);
  rec('① 2つの窓の記録の件数と顔ぶれが一致する', sha(idsA) === sha(idsB), `${idsA.length}件 / ${idsB.length}件`);
  const a1 = await get(page, id);
  rec('① 中身の指紋が一致する', sha(a1.measurements) === sha(gotB.measurements));

  /* ---- ② 新しいほうが勝つ（両方向） ---- */
  await pageB.evaluate(r => WL.records.reliablePut(r), { ...gotB, updatedAt: iso(t0 + 10000), measurements: { note: 'Bで直した' } });
  await W.poll(index, items => items.some(x => x.id === id && x.updatedAt === iso(t0 + 10000)), 10000);
  await open(page, A);
  rec('② もう一方の窓で直した新しい版が届く（B→A）', ((await get(page, id)) || {}).measurements?.note === 'Bで直した');
  await page.evaluate(r => WL.records.reliablePut(r), { ...rec1, updatedAt: iso(t0 + 20000), measurements: { note: 'Aで直した' } });
  await W.poll(index, items => items.some(x => x.id === id && x.updatedAt === iso(t0 + 20000)), 10000);
  await open(pageB, Bo);
  rec('② 逆向きも届く（A→B）', ((await get(pageB, id)) || {}).measurements?.note === 'Aで直した');
  /* 古い版で上書きしない: B の手元を古い版へ戻してから開き直しても、控えの新しい版が勝つ */
  await pageB.evaluate(r => WL.records.reliablePut(r), { ...rec1, updatedAt: iso(t0 + 5000), measurements: { note: '古い版' } });
  const kept = await fetch(A + '/api/terminal/records/get', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: [id] }) }).then(r => r.json());
  rec('② 控えは古い版を受け付けない（新しいほうを持ち続ける）',
      (kept.items || [])[0]?.record?.measurements?.note === 'Aで直した');

  /* ---- ③ 消した記録は戻らない ---- */
  await page.evaluate(i => WL.records.reliableDelete(i), id);
  await W.poll(index, items => items.some(x => x.id === id && x.deletedAt), 10000);
  await open(pageB, Bo);
  rec('③ 一方の窓で消した記録は、もう一方の窓からも消える', !(await get(pageB, id)));
  await open(page, A);
  rec('③ 消した窓で開き直しても戻らない', !(await get(page, id)));
  const late = await fetch(A + '/api/terminal/records/put', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ records: [{ ...rec1, updatedAt: iso(t0 + 30000) }] }) }).then(r => r.json());
  rec('③ 消した後に届いた古い記録は控えが受け付けない', late.refused === 1, JSON.stringify(late));

  /* ---- ④ 設定は変わった名前だけ届く・消した名前も届く ---- */
  await page.evaluate(k => localStorage.setItem(k, 'A-1'), KEY);
  await flush(page);
  await open(pageB, Bo);
  rec('④ 設定が届く（A→B）', await pageB.evaluate(k => localStorage.getItem(k), KEY) === 'A-1');
  await pageB.evaluate(k => localStorage.setItem(k, 'B-2'), KEY);
  await flush(pageB);
  await open(page, A);
  rec('④ 逆向きも届く（B→A・2回目からは変わった名前だけを当てる）', await page.evaluate(k => localStorage.getItem(k), KEY) === 'B-2');
  await page.evaluate(k => localStorage.removeItem(k), KEY);
  await flush(page);
  await open(pageB, Bo);
  rec('④ 消した名前も届く', await pageB.evaluate(k => localStorage.getItem(k), KEY) === null);
  rec('④ 送らない名前（測定の記録の写し）は控えへ入らない',
      await fetch(A + '/api/terminal/settings').then(r => r.json()).then(j => !('MeasurementLocalMirrorV31' in (j.values || {}))));

  /* ---- ⑤ 初めて揃える窓では手元が正 ---- */
  await pageB.evaluate(k => localStorage.setItem(k, 'B-store'), KEY);
  await flush(pageB);
  await page.evaluate(k => { localStorage.removeItem('WaveLogTerminalSyncV1'); localStorage.setItem(k, 'A-mine'); }, KEY);
  await open(page, A);
  const st = await page.evaluate(() => WL.terminalStore.status());
  rec('⑤ 初めて揃える窓では、手元に在る設定を控えで上書きしない', st.first
      && await page.evaluate(k => localStorage.getItem(k), KEY) === 'A-mine', JSON.stringify(st));
  await W.poll(() => fetch(A + '/api/terminal/settings').then(r => r.json()), j => (j.values || {})[KEY] === 'A-mine', 10000);
  rec('⑤ 手元の値が控えへ送られる（もう一方の窓は次に開いたときそれを見る）',
      await fetch(A + '/api/terminal/settings').then(r => r.json()).then(j => (j.values || {})[KEY] === 'A-mine'));

  /* ---- ⑦ 送る前に読み直した変更は手元が勝つ（読み直しの往復と行き違っても戻らない） ---- */
  await page.evaluate(k => localStorage.setItem(k, 'race-1'), KEY);
  await open(page, A);   // 5秒の送りを待たずに読み直す
  rec('⑦ 送る前に読み直しても、手元で変えた値が控えの古い値で戻らない',
      await page.evaluate(k => localStorage.getItem(k), KEY) === 'race-1');
  await W.poll(() => fetch(A + '/api/terminal/settings').then(r => r.json()), j => (j.values || {})[KEY] === 'race-1', 10000);
  rec('⑦ その値は開いた直後に控えへ送られる',
      await fetch(A + '/api/terminal/settings').then(r => r.json()).then(j => (j.values || {})[KEY] === 'race-1'));

  /* ---- ⑥ </script> で閉じられない ---- */
  const evil = '</script><script>window.__wlEvil=1</script>';
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, evil]);
  await flush(page);
  await open(pageB, Bo);
  rec('⑥ 控えの値に</script>が入っていても画面は壊れず、値はそのまま届く',
      await pageB.evaluate(() => window.__wlEvil === undefined) && await pageB.evaluate(k => localStorage.getItem(k), KEY) === evil);

  /* 後片付け（控えの白紙は土台がする） */
  await page.evaluate(k => localStorage.removeItem(k), KEY);
  await flush(page);
  const st2 = await fetch(A + '/api/terminal/status').then(r => r.json());
  rec('控えを使った画面が2つ（両方のオリジン）記録されている（引き継ぎの印）',
      [A, Bo].every(o => (st2.origins || []).some(x => x.origin === o)), (st2.origins || []).map(x => x.origin).join(', '));
  rec('画面にJSエラーが出ていない', errs.length === 0, errs.slice(0, 3).join(' / '));
});
