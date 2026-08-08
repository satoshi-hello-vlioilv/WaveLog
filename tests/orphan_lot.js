/* tests/orphan_lot.js: 仕掛(SIKALOTNOW)に存在しないロットの予定を1件だけ作る。
   ============================================================
   作業可否の索引(§9.57)には「判定が要るロットが全部見つかったらそこで
   打ち切る」最適化が入っている。つまり**仕掛に無いロットが予定に1件も
   無ければ、索引は1ページ目で止まるのが正しい動き**。

     ・500件を越えて複数ページ辿れること
     ・辿っても見つからないぶんを個別問い合わせで確定させること

   を検証したいテストは、その前提(＝見つからないロット)を自分で用意する。

   以前はこれを test_sccat が残した実績行(ZZZZ1/ZZZZ2 = 仕掛に無いロット)に
   暗黙に頼っていた。test_sccat は test_audit / test_nav より**後**に走るので、
   通しで回したときに効くのは「前回の実行の残骸」であり、それが表示範囲
   (直近N時間)に入っているかどうかで結果が変わっていた。直前に流していれば
   通り、間が空くと落ちる — 実行履歴で変わる安全網は安全網にならないので、
   必要な前提はテストが自前で作って自前で消す。

   使い方(後始末は必ず finally に置くこと):
     const {addOrphanPlan}=require('./orphan_lot');
     const orphan=await addOrphanPlan('テスト設備A');
     try{ ... }finally{ await orphan.remove() }
   ============================================================ */
const B = 'http://127.0.0.1:5029';

const post = async (path, body) => {
  const r = await fetch(B + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let json = {};
  try { json = await r.json() } catch (e) { /* HTMLのエラーページ等 */ }
  return { status: r.status, body: json };
};
const setMode = m => post('/api/access-mode', { mode: m });

/* 予定の追加はscheduleモードのみ(editモードで許されるのは現場段取りの
   並べ替えだけ)。呼び出し側のモードを壊さないよう、切り替えたら必ず戻す。 */
async function withScheduleMode(equipment, fn) {
  const before = (await (await fetch(B + '/api/access-mode')).json()).mode || 'edit';
  await setMode('schedule');
  try {
    await post('/api/schedule/session/acquire', { equipment });
    return await fn();
  } finally {
    await post('/api/schedule/session/release', { equipment });
    await setMode(before);
  }
}

/* 仕掛に無いロットの予定を1件追加する。
   戻り値の remove() で消す(消し忘れると共有フィクスチャに残り、
   後続テストの「不可」の件数や行位置が変わる)。 */
async function addOrphanPlan(equipment) {
  // 実行ごとに一意にする。過去の失敗で残った行と取り違えて消さないため。
  const lotNo = 'ORPHAN' + Date.now().toString(36).toUpperCase();
  const added = await withScheduleMode(equipment, () => post('/api/schedule/plan/add', {
    equipment, kind: '作業', lotNo,
    inspectionNo: 'K' + lotNo, castingNo: 'C' + lotNo,
    estimateMinutes: 30, user_id: 'tests',
    // 残仕掛設備ｺｰｽは**入れない**。入れると保存値だけで判定が付いてしまい
    // (§9.67の往復ゼロ)、索引を辿らせるという目的を果たさない。
    detail: { lotNo },
  }));
  const id = added.body && added.body.id;
  return {
    id: id || null, lotNo,
    ok: added.status === 200 && !!id,
    detail: `${added.status} ${(added.body && added.body.error) || ''}`.trim(),
    async remove() {
      if (!id) return;
      await withScheduleMode(equipment, () =>
        post('/api/schedule/plan/delete', { id, equipment, user_id: 'tests' }));
    },
  };
}

module.exports = { addOrphanPlan };
