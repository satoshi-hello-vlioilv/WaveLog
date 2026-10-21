/* ============================================================
   strict-start.js: 厳密モードの開始の関門（§9.588）

   利用者の指示:
   「ロットの開始を作業スケジュール一覧の一番上のロットからしかできないようにするモードを作成してください。
    …仕掛などから直接読んできてロットをスタートさせる使い方ができなくなります。」
   「スタートしたロットより上の設備停止は前のロットの終了時間とスタートしたロットの開始時刻の間の時間で
    実時間を登録を自動的にできる」「作業スケジュールの中で開始判定フラグを設け、管理する」

   測定画面を開く入口は1つ（`WL.records.openMeasurement()`）で、予定の「開始」・初期画面の帯・仕掛の一覧の
   どの道もここを通る。**その前の関門**（`gate('openMeasurement')`）で開始の口
   （`POST /api/schedule/plan/start`）へ聞く:
     ・通常モードの設備 … 何も書かずに通す（今までの開始のまま）
     ・厳密モード … 一番上の「予定」のロットなら開始判定を予定に残し、上の設備停止へ実際の時刻を入れて通す。
                   違えば**理由と一番上のロット**を言って止め、次の一手（作業スケジュールを開く）を置く
   決めるのはサーバーの1箇所（`strict_top()`／`strict_start_plan()`）。ここは聞く・言う・止めるだけ。
   続き（この端末の編集中のデータ・既に始めた記録）は止めない——厳密モードが止めるのは「新しく始めること」。
   ============================================================ */
(function(){
 'use strict';
 const WL = (window.WL = window.WL || {});
 /* 予定の行から始めたときの「どの行か」（行の写しに印を付けない＝測定データへ混ぜない）。 */
 const intents = new WeakMap();
 function intend(row, info) { if (row && typeof row === 'object') intents.set(row, info || {}); }
 const hm = iso => { const d = new Date(String(iso || '')); return isNaN(d.getTime()) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
 /* 入れた時刻を1行で（「段取り替え 10:05〜10:35・清掃 10:35〜10:50」）。 */
 const stopsText = stops => (stops || []).map(s => `${s.title || '設備停止'} ${hm(s.startAt)}〜${hm(s.endAt)}`).join('・');

 async function refuse(err) {
  const top = err.top || null;
  const go = await confirmModal({
   title: 'このロットはまだ開始できません', eyebrow: '厳密モード',
   /* 一番上のロットの名前は、理由の字がまだ言っていないときだけ添える（同じ名前を2度言わない）。 */
   message: `${err.message}${top && top.lotNo && !String(err.message).includes(top.lotNo) ? `\n（一番上のロット: ${top.lotNo}）` : ''}`,
   confirmLabel: '作業スケジュールを開く', cancelLabel: '閉じる'
  });
  if (go && WL.scheduleView) WL.scheduleView.open();
 }
 /* 確かめられない（作業スケジュールを読めない・通信できない）。**ラインを止めない**——続けるかを人が決める
    （続けると開始判定は残らないことを言う）。 */
 function cannotCheck(err) {
  return confirmModal({
   title: '厳密モードの開始を確かめられません', eyebrow: '厳密モード',
   message: `${err.message || err}\n\nこのまま開始すると、開始判定と設備停止の実際の時刻は記録されません（あとで作業スケジュールの「時刻入力」で入れられます）。`,
   confirmLabel: 'このまま開始する'
  });
 }
 async function gate(row) {
  const info = intents.get(row) || {};
  const equipment = String(info.equipment || (typeof currentConfiguredEquipment === 'function' ? currentConfiguredEquipment() : '') || '').trim();
  /* 使用設備が決まっていなければ、入口（`requireEquipmentBeforeMeasurement`）が先に聞く——決めたあとにまた来る。 */
  if (!equipment || !row) return undefined;
  /* この端末の編集中のデータの続きは止めない。 */
  if (WL.records && WL.records.findDraftForRow && await WL.records.findDraftForRow(row)) return undefined;
  let r;
  try {
   r = await api('/api/schedule/plan/start', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(withUserId({ equipment, id: info.id ?? '', lotNo: pick(row, 'lotNo'), castingNo: pick(row, 'castingNo'),
                                      mfgMaterial: pick(row, 'mfgMaterial') })) });
  } catch (e) {
   if (e && e.status === 409 && e.code) { await refuse(e); return false; }
   return (await cannotCheck(e)) ? undefined : false;
  }
  WL.scheduleView?.noteWriteRevision?.(r);
  if (r && r.strict && r.stops && r.stops.length && typeof showToast === 'function')
   showToast('開始しました（厳密モード）', `上の設備停止 ${r.stops.length}件に実際の時刻を入れました: ${stopsText(r.stops)}`, 8000);
  return undefined;
 }
 /* 優先は編集モードの関門（10）より後——編集モードでない端末には聞かない。子ロットの読み替え（20）の後でもある。 */
 WL.measureHooks.gate('openMeasurement', gate, { priority: 5 });
 WL.strictStart = { intend, gate };
})();
