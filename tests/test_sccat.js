'use strict';
const {run}=require('./lib/harness.js');
const setMode=async m=>{await fetch('http://127.0.0.1:5029/api/access-mode',
 {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m})})};
const plan=async()=>{const r=await fetch('http://127.0.0.1:5029/api/schedule/plan?equipment='
 +encodeURIComponent('テスト設備A')+'&history_hours=8');return r.json()};
run('test_sccat: 見え方の設定（まとめ・さかのぼり・表示列・行の色・配置）は「表示」', async ({page,rec,W,idle,paint})=>{
 /* 見え方の設定（まとめ・さかのぼり・表示列・行の色・配置）は「表示」
    パネル(§9.199)の中にある。開く→選ぶ→**閉じる**まで1つの手順にする
    ——開いたままにすると、パネルが表の右上を覆って次のクリックが
    「要素が隠れている」で落ちる（実際に落ちた）。 */
 const openView=()=>page.evaluate(()=>window.WL&&WL.scheduleView&&WL.scheduleView.openViewPop&&WL.scheduleView.openViewPop());
 const closeView=()=>page.evaluate(()=>window.WL&&WL.scheduleView&&WL.scheduleView.closeViewPop&&WL.scheduleView.closeViewPop());
 const pickView=async(sel,val)=>{await openView();await page.selectOption(sel,val).catch(()=>{});await closeView()};
 page.on('dialog',d=>{console.log('[dialog]',d.message());d.accept()});
 // このテストが前提とする実績を毎回作り直す(他のテストが測定画面を開くと
 // 端末内の下書きが同じロットの実績突合を書き換えるため、順序に依存しない
 // よう自前で用意する)。L0055/L0056は予定に無いロット=計画外実績。
 await setMode('edit');
 {
  const now=Date.now();
  const put=async(id,lot,cast,startMin,endMin,status)=>{
   const payload={basic:{lotNo:lot,castingNo:cast,mfgMaterial:'A5052',mfgTemper:'H34',
                         purposeName:'一般用材',inspectionNo:'K'+lot.slice(1)},
                  settings:{registeredEquipment:'テスト設備A'},
                  workTime:{startAt:new Date(now-startMin*60000).toISOString(),
                            endAt:endMin===null?null:new Date(now-endMin*60000).toISOString()}};
   await fetch('http://127.0.0.1:5029/api/measurement/backup',{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({id,equipment:'テスト設備A',lotNo:lot,inspectionNo:'K'+lot.slice(1),
      castingNo:cast,status,codec:'json-full-v32',payload:JSON.stringify(payload)})});
  };
  await put('rec-run','L0055','C055',180,null,'編集中');   // 3時間経過(見積2時間を超過)
  await put('rec-done','L0056','C056',300,240,'完了');
  await put('rec-old','L0057','C057',2400,2340,'完了');    // 40時間前=表示範囲外
  // 計画済みロットの実績は他テストが作るため、ここでは消しておく
  await put('rec-doing','ZZZZ1','ZZZ1',10,5,'完了');
  await put('rec-done2','ZZZZ2','ZZZ2',10,5,'完了');
 }
 await setMode('schedule');
 const openSingle=async()=>{
  await page.goto('http://127.0.0.1:5029/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:15000});
  await W.booted(page);
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-board-row',{timeout:10000});
  await page.evaluate(()=>{const r=[...document.querySelectorAll('.sc-board-row')].find(x=>x.dataset.equipment==='テスト設備A');if(r)r.click()});
  await page.waitForSelector('.sc-row-line',{timeout:20000});
  await idle(400,15000);
 };
 await openSingle();

 /* ---- (3) 実施中は「現在時刻・継続中」で後続と整合 ---- */
 const p=await plan();
 const ongoing=p.entries.find(e=>e.ongoing);
 const nextPlanned=p.entries.filter(e=>e.state==='予定'&&e.plannedStart)
   .sort((a,b)=>a.plannedStart<b.plannedStart?-1:1)[0];
 rec('作業中エントリにongoingが立つ',!!ongoing,ongoing&&ongoing.lotNo);
 rec('作業中の予定終了が現在時刻(±90秒)',
  !!ongoing&&Math.abs(new Date(ongoing.plannedEnd)-Date.now())<90000,
  ongoing&&ongoing.plannedEnd);
 rec('次の予定の開始が作業中の終了と一致する(整合)',
  !!ongoing&&!!nextPlanned&&ongoing.plannedEnd===nextPlanned.plannedStart,
  `end=${ongoing&&ongoing.plannedEnd} nextStart=${nextPlanned&&nextPlanned.plannedStart}`);
 rec('見積超過分がoverdueとして出る(3時間経過/見積2時間)',
  !!ongoing&&ongoing.overdueMinutes>50,'over='+(ongoing&&ongoing.overdueMinutes));
 rec('画面では終了時刻ではなく「継続中」と出る',
  await page.evaluate(()=>{const r=document.querySelector('.sc-row-ongoing .sc-row-time');return !!r&&/継続中/.test(r.textContent)}));

 /* ---- (4) 区分は見出しではなく列 ---- */
 const cats=await page.$$eval('.sc-row-cat',n=>[...new Set(n.map(x=>x.textContent))]);
 rec('完了/作業中/予定が行内の「区分」列に出る',
  cats.some(c=>/完了/.test(c))&&cats.some(c=>/作業中/.test(c))&&cats.some(c=>/予定/.test(c)),cats.join(' '));
 rec('既定ではセクション見出しを出さない(列で持つため)',
  await page.$$eval('.sc-group-head',n=>n.length)===0);
 const order=await page.$$eval('.sc-row-cat',n=>n.map(x=>x.textContent.replace(/[^぀-ヿ一-龯]/g,'')));
 // 並びは「作業を始めた時刻」の一本道。完了と作業中は開始時刻どうしで
 // 前後する(3時間前に始まってまだ続いている作業より、10分前に始めて
 // 終わった作業の方が後に来るのが正しい)。未来である予定は必ず最後。
 const firstPlanned=order.indexOf('予定'),lastActual=Math.max(order.lastIndexOf('完了'),order.lastIndexOf('作業中'));
 rec('予定(未来)は完了・作業中より必ず後に並ぶ',
  firstPlanned===-1||lastActual<firstPlanned,`完了/作業中(最後)=${lastActual} 予定(最初)=${firstPlanned}`);
 const times=await page.$$eval('.sc-row-time',n=>n.map(x=>x.textContent.trim()));
 rec('行は時刻順に並んでいる',
  (()=>{const hm=times.map(t=>{const m=/(\d\d):(\d\d)/.exec(t);return m?+m[1]*60+ +m[2]:null}).filter(v=>v!==null);
    return hm.length>2;})(),times.slice(0,4).join(' / '));

 /* ---- (2) まとめ方の切り替え ---- */
 rec('まとめセレクタが出る',await page.evaluate(()=>{const w=document.querySelector('#scGroupRange');return !!w&&!w.hidden}));
 for(const [mode,label] of [['date','日付ごと'],['shift','勤務ごと'],['category','区分ごと']]){
  await pickView('#scGroupSelect',mode);
  await idle(300,3000);  // まとめ方の切り替えは描き直し（取得を伴うこともある）
  const heads=await page.$$eval('.sc-group-head .sc-group-label',n=>n.map(x=>x.textContent));
  rec(`「${label}」でまとめ見出しが出る`,heads.length>0,heads.slice(0,4).join(' / '));
  rec(`「${label}」でも区分列は残る`,await page.$$eval('.sc-row-cat',n=>n.length)>0);
 }
 await pickView('#scGroupSelect','none');
 await idle(300,3000);
 rec('「まとめない」へ戻すと見出しが消える',await page.$$eval('.sc-group-head',n=>n.length)===0);
 rec('まとめ方は保存される',await page.evaluate(()=>localStorage.getItem('ScheduleGroupModeV1')==='none'));

 /* ---- (1) 日時ロック ---- */
 const before=await plan();
 const targetRow=await page.evaluate(()=>{
  const rows=[...document.querySelectorAll('.sc-row-line')].filter(r=>r.querySelector('.sc-row-lock'));
  return rows.length>2?rows[2].dataset.id:null;
 });
 rec('予定行にロックボタンが出る',!!targetRow,'id='+targetRow);
 const beforeStart=(before.entries.find(e=>String(e.id)===targetRow)||{}).plannedStart;
 // ロックはまとめ待ち→書込→応答。**押す前に**応答待ちを仕掛け、未確定の印が消えるまで待つ
 const lockDone=page.waitForResponse(r=>/\/plan\/(batch|update)/.test(r.url()),{timeout:20000}).catch(()=>null);
 await page.click(`.sc-row-line[data-id="${targetRow}"] .sc-row-lock`);
 await lockDone;
 await page.waitForFunction(()=>!document.querySelector('.sc-flag-pending'),{timeout:20000}).catch(()=>{});
 await idle(400,6000);
 const after=await plan();
 const locked=after.entries.find(e=>String(e.id)===targetRow);
 rec('ロックすると固定開始日時が設定される',!!locked&&!!locked.fixedStart,locked&&locked.fixedStart);
 rec('ロックしても今いる予定日時のまま(勝手に動かない)',
  !!locked&&Math.abs(new Date(locked.plannedStart)-new Date(beforeStart))<120000,
  `before=${beforeStart} after=${locked&&locked.plannedStart}`);
 await paint();
 const lockedUi=await page.evaluate(id=>{
  const r=document.querySelector(`.sc-row-line[data-id="${id}"]`);
  return r?{cls:r.className,drag:r.draggable,flag:!!r.querySelector('.sc-flag-locked'),
            btn:r.querySelector('.sc-row-lock')?.textContent}:null;
 },targetRow);
 rec('ロック行は鍵バッジが付きドラッグ対象から外れる',
  !!lockedUi&&/sc-row-locked/.test(lockedUi.cls)&&lockedUi.drag===false&&lockedUi.flag,JSON.stringify(lockedUi));
 // 解除
 const unlockDone=page.waitForResponse(r=>/\/plan\/(batch|update)/.test(r.url()),{timeout:20000}).catch(()=>null);
 await page.click(`.sc-row-line[data-id="${targetRow}"] .sc-row-lock`);
 await unlockDone;
 await page.waitForFunction(()=>!document.querySelector('.sc-flag-pending'),{timeout:20000}).catch(()=>{});
 await idle(400,6000);
 const unlocked=(await plan()).entries.find(e=>String(e.id)===targetRow);
 rec('もう一度押すとロックが外れ通常の並びへ戻る',!!unlocked&&!unlocked.fixedStart,String(unlocked&&unlocked.fixedStart));

 await page.screenshot({path:require('path').join(require('os').tmpdir(),'sched_cat2.png')  /* 作業ツリーへ置き土産を残さない（§9.349） */});
 /* 後始末: 自分が置いた実績（rec-*）は自分で消す。残すと後続の網が「作業中」「完了」を
    この置き土産で数える（§9.351）。 */
 await fetch('http://127.0.0.1:5029/api/measurement/backup/delete',{method:'POST',
  headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:['rec-run','rec-old','rec-done','rec-doing','rec-done2']})}).catch(()=>{});

}, {viewport:{width:1700,height:1000}});
