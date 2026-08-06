const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const setMode=async m=>{await fetch('http://127.0.0.1:5029/api/access-mode',
 {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m})})};
const plan=async()=>(await (await fetch('http://127.0.0.1:5029/api/schedule/plan?equipment='
 +encodeURIComponent('テスト設備A')+'&history_hours=8')).json());
let b=null;
(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 page.on('pageerror',e=>console.log('[pageerror]',e.message));
 page.on('dialog',d=>d.accept());
 let n={batch:0,add:0,del:0,reorder:0,update:0};
 page.on('request',r=>{const u=r.url();
  if(u.includes('/plan/batch'))n.batch++;else if(u.includes('/plan/add'))n.add++;
  else if(u.includes('/plan/delete'))n.del++;else if(u.includes('/plan/reorder'))n.reorder++;
  else if(u.includes('/plan/update'))n.update++;});
 const reset=()=>{n={batch:0,add:0,del:0,reorder:0,update:0}};
 await setMode('schedule');
 const open=async()=>{
  await page.goto('http://127.0.0.1:5029/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:15000});
  await page.waitForTimeout(1200);
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-board-row',{timeout:15000});
  await page.evaluate(()=>{const r=[...document.querySelectorAll('.sc-board-row')].find(x=>x.dataset.equipment==='テスト設備A');if(r)r.click()});
  await page.waitForTimeout(4000);
 };
 await open();

 /* --- 一括追加が1リクエストにまとまり、全件保存される --- */
 const before=(await plan()).entries.filter(e=>e.state==='予定').length;
 reset();
 const t=Date.now();
 const lots=await page.evaluate(()=>{
  const rows=(typeof S!=='undefined'&&S.rows||[]).slice(0,12);
  rows.forEach(r=>window.scheduleAddFromRow&&window.scheduleAddFromRow(r));
  return rows.length;
 });
 await page.waitForFunction(()=>!document.querySelector('.sc-flag-pending'),{timeout:120000});
 const ms=Date.now()-t;
 rec('一括追加が共有DB書込1回にまとまる',n.batch===1&&n.add===0,`batch=${n.batch} add個別=${n.add} ${ms}ms`);
 const after=(await plan()).entries.filter(e=>e.state==='予定').length;
 rec('まとめても全件がサーバーへ保存される',after===before+lots,`${before} → ${after} (投入${lots}件)`);
 rec('仮IDが実IDへ差し替わる(画面に未確定が残らない)',
  await page.evaluate(()=>![...document.querySelectorAll('.sc-row-line')].some(r=>String(r.dataset.id).startsWith('tmp-'))));

 /* --- 種類の違う操作が混ざってもまとまる --- */
 await open();
 const ids=await page.$$eval('.sc-row-line',x=>x.map(r=>r.dataset.id).filter(i=>/^\d+$/.test(i)));
 reset();
 await page.evaluate(async idList=>{
  // 削除はアプリ内の確認モーダルを待つ。検証では自動承諾にして、
  // 3操作が同じキュー(150msのまとめ待ち)へ入るようにする。
  window.confirmModal=async()=>true;
  document.querySelector(`.sc-row-line[data-id="${idList[0]}"] .sc-row-delete`)?.click();
  document.querySelector(`.sc-row-line[data-id="${idList[1]}"] .sc-row-delete`)?.click();
  document.querySelector(`.sc-row-line[data-id="${idList[2]}"] .sc-row-lock`)?.click();
  await new Promise(r=>setTimeout(r,50));
 },ids);
 await page.waitForTimeout(6000);
 rec('削除・ロックなど種類の違う操作も1回にまとまる',
  n.batch===1&&n.del===0&&n.update===0,`batch=${n.batch} delete個別=${n.del} update個別=${n.update}`);
 const p2=await plan();
 rec('削除がサーバーへ反映されている',!p2.entries.some(e=>String(e.id)===ids[0]||String(e.id)===ids[1]),
  `残り: ${p2.entries.filter(e=>String(e.id)===ids[0]||String(e.id)===ids[1]).length}件`);
 rec('ロックがサーバーへ反映されている',
  !!(p2.entries.find(e=>String(e.id)===ids[2])||{}).fixedStart,
  String((p2.entries.find(e=>String(e.id)===ids[2])||{}).fixedStart));
 // 後片付け
 await page.evaluate(async id=>{await fetch('/api/schedule/plan/update',{method:'POST',
  headers:{'Content-Type':'application/json'},body:JSON.stringify({id:Number(id),fixedStart:'',user_id:'test'})})},ids[2]);

 /* --- 1件失敗しても残りは適用される --- */
 await open();
 const ids2=await page.$$eval('.sc-row-line',x=>x.map(r=>r.dataset.id).filter(i=>/^\d+$/.test(i)));
 const beforeN=(await plan()).entries.length;
 const r=await page.evaluate(async id=>{
  return (await (await fetch('/api/schedule/plan/batch',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({user_id:'test',ops:[
    {op:'delete',id:999999},                 // 存在しない=失敗するはず
    {op:'update',id:Number(id),remark:'まとめ書込の検証'},
   ]})})).json());
 },ids2[0]);
 rec('1件失敗しても残りは適用される(結果は送った順で返る)',
  !!r.ok&&r.results&&r.results.length===2&&r.results[0].ok===false&&r.results[1].ok===true,
  JSON.stringify(r).slice(0,140));

 /* --- editモードからはまとめ書込を使えない(権限の抜け道を作らない) --- */
 await setMode('edit');
 const denied=await page.evaluate(async()=>{
  const res=await fetch('/api/schedule/plan/batch',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({user_id:'test',ops:[{op:'add',equipment:'テスト設備A',kind:'作業',lotNo:'X0001'}]})});
  return {status:res.status};
 });
 rec('編集モードからはまとめ書込を受け付けない(追加の抜け道にしない)',denied.status===403,JSON.stringify(denied));
 await setMode('schedule');

 console.log('\n=== SUMMARY ===');
 const f=R.filter(x=>!x.ok);console.log(`${R.length-f.length}/${R.length} passed`);
 f.forEach(x=>console.log(' -',x.n,x.d||''));
 await b.close();process.exit(f.length?1:0);
})().catch(async e=>{
 // 落ちてもブラウザは必ず閉じる。閉じ忘れると開いたままの画面が設備の
 // 編集セッションを掴み続け、後続のスケジュール系テストが「編集中です」で
 // 連鎖的に落ちる(実際に1本のFATALから8本が落ちた)。
 console.error('FATAL',e);
 if(b)await b.close().catch(()=>{});
 process.exit(2);
});
