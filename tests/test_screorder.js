/* 待ちは「時間」ではなく「条件」（§9.102・3-15 ③・§9.347）。骨組み
   （起動・rec・pageerror・素のダイアログ・集計・閉じる）は tests/lib/harness.js。
   置き換え前後で全PASS行（測った値ごと）を突き合わせてある。 */
const {run}=require('./lib/harness.js');
const setMode=async m=>{await fetch('http://127.0.0.1:5029/api/access-mode',
 {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m})})};
run('test_screorder: 現場段取りの並べ替え',async({page,rec,W,idle,paint})=>{
 let reorderBody=null;
 page.on('request',r=>{if(r.url().includes('/api/schedule/plan/reorder'))reorderBody=r.postData()});
 await setMode('schedule');
 await page.goto('http://127.0.0.1:5029/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openSchedule',{timeout:15000});
 await W.booted(page);
 await page.click('#openSchedule');
 await page.waitForSelector('.sc-board-row',{timeout:10000});
 await page.evaluate(()=>{const r=[...document.querySelectorAll('.sc-board-row')].find(x=>x.dataset.equipment==='テスト設備A');if(r)r.click()});
 await W.until(page,()=>!!document.querySelector(".sc-row-line"),null,15000);await W.settleFlags(page);await idle();

 // タイムラインは区分列を持つ1本のリスト(§9.39)。予定行は区分チップで見分ける。
 // 並べ替え対象は「予定」と「設備停止」(どちらも状態は予定)。
 const planned=()=>page.$$eval('.sc-row-line',n=>n
   .filter(x=>/予定|設備停止/.test(x.querySelector('.sc-row-cat')?.textContent||''))
   .map(x=>x.dataset.id));
 const before=await planned();
 rec('予定セクションに並べ替え可能な行がある',before.length>2,'件数='+before.length);
 rec('作業中の行はドラッグ不可(計画外実績は共有DBに行が無い)',
  await page.evaluate(()=>{const r=[...document.querySelectorAll('.sc-row-line')]
    .find(x=>/作業中/.test(x.querySelector('.sc-row-cat')?.textContent||''));
   return !!r&&r.draggable===false}));

 // Alt+↓ で2番目を1つ下げる(HTML5 D&Dはキーボード経路と同じcommitDragOrderを通る)
 const ids0=await planned();
 const target=await page.$(`.sc-row-line[data-id="${ids0[1]}"]`);
 await target.focus();
 await page.keyboard.down('Alt');await page.keyboard.press('ArrowDown');await page.keyboard.up('Alt');
 await idle(600);
 const after=await planned();
 rec('Alt+↓で予定の並びが入れ替わる',before[0]!==after[0]||before[1]!==after[1],
  `before=${before.slice(0,4)} after=${after.slice(0,4)}`);
 rec('並べ替えAPIが呼ばれた',!!reorderBody,String(reorderBody).slice(0,120));
 if(reorderBody){
  const ids=(JSON.parse(reorderBody).orderedIds)||[];
  rec('送信IDに合成id(actual:*)が混ざらない',ids.every(x=>!String(x).startsWith('actual:')),JSON.stringify(ids.slice(0,6)));
  rec('送信IDが並べ替え対象の行数と一致する',ids.length===after.length,`ids=${ids.length} rows=${after.length}`);
 }
 rec('並べ替え後も区分列が保たれる',
  await page.$$eval('.sc-row-cat',n=>n.length)>0);

 /* ---- ロック行がある状態での並べ替え ---- */
 // 後ろの方の予定を、今より前の日時でロックする(表示順は割り込んで前へ来るが、
 // 予定順としては元の位置に据え置かれるべき)。
 const lockTargetId=(await planned())[6];
 const early=new Date(Date.now()+30*60000).toISOString();
 await page.evaluate(async ([id,iso])=>{
  await fetch('/api/schedule/plan/update',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({id:Number(id),fixedStart:iso,user_id:'test'})});
 },[lockTargetId,early]);
 /* **上限3秒で見切る**（元の固定待ちと同じ）。計測すると、この直前の
    `/api/schedule/plan/update` がスケジュールモードの単独実行では21秒以上
    返らず（§9.347 追補）、`idle` は正直に待って上限まで行く。元の網は3秒で
    先へ進んでも判定が通っていたので、待ち方だけを変えて結果は変えない。 */
 await page.click('#scRefresh');await idle(400,3000);await W.settleFlags(page);
 const domNow=await planned();
 rec('ロック行は固定日時どおり表示順の前方へ割り込む',
  domNow.indexOf(lockTargetId)<6,`表示位置=${domNow.indexOf(lockTargetId)} (元は6)`);
 reorderBody=null;
 try{
  const otherId=domNow.find(id=>id!==lockTargetId);
  // 行が取れないまま .focus() を呼ぶとFATALで落ち、下の後片付け(ロック解除)が
  // 走らない。残ったロックは後続テストの並べ替えを黙って失敗させるので、
  // ここは必ずFAILとして記録し、後片付けまで到達させる(実際に落ちた)。
  const t2=otherId?await page.$(`.sc-row-line[data-id="${otherId}"]`):null;
  if(!t2)rec('ロック行以外の予定行を掴める',false,`domNow=${domNow.slice(0,4)} lock=${lockTargetId}`);
  else{
   await t2.focus();
   await page.keyboard.down('Alt');await page.keyboard.press('ArrowDown');await page.keyboard.up('Alt');
   await idle(600,2500);   // 上限は元の固定待ちと同じ2.5秒（同じ update が塞いでいる）
   if(reorderBody){
    const ids2=JSON.parse(reorderBody).orderedIds.map(String);
    rec('ロック行は表示順ではなく元の予定順の位置のまま送られる',
     ids2.indexOf(lockTargetId)>=5,`予定順での位置=${ids2.indexOf(lockTargetId)} / 表示順=${domNow.indexOf(lockTargetId)}`);
    rec('ロック行を含めて並べ替え対象の全件が送られる',ids2.length===domNow.length,`ids=${ids2.length} rows=${domNow.length}`);
   }else rec('ロック時も並べ替えAPIが呼ばれる',false);
  }
 }finally{
  // 後片付け
  await page.evaluate(async id=>{
   await fetch('/api/schedule/plan/update',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({id:Number(id),fixedStart:'',user_id:'test'})});
  },lockTargetId).catch(()=>{});
 }
},{mode:'schedule'});
