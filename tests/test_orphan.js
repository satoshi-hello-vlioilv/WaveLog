/* データ一覧とスケジュール実績の食い違い(§9.52)の検証 */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
const setMode=async m=>{await fetch(B+'/api/access-mode',{method:'POST',
 headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m})})};
const put=async(id,lot,cast,startMin,endMin,status)=>{
 const now=Date.now();
 const payload={basic:{lotNo:lot,castingNo:cast,mfgMaterial:'A5052',mfgTemper:'H34',
   purposeName:'一般用材',inspectionNo:'K'+lot.slice(1)},
  settings:{registeredEquipment:'テスト設備A',operator:'田中'},
  workTime:{startAt:new Date(now-startMin*60000).toISOString(),
            endAt:endMin===null?null:new Date(now-endMin*60000).toISOString()}};
 await fetch(B+'/api/measurement/backup',{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({id,equipment:'テスト設備A',lotNo:lot,inspectionNo:'K'+lot.slice(1),
   castingNo:cast,status,codec:'json-full-v32',payload:JSON.stringify(payload)})});
};
const backupIds=async()=>{
 const r=await fetch(B+'/api/measurement/backup/list').then(x=>x.json());
 return (r.items||[]).map(i=>i.id);
};
let b=null;
(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 page.on('pageerror',e=>console.log('[pageerror]',e.message));
 page.on('dialog',d=>d.accept());
 await setMode('edit');

 const openSchedule=async()=>{
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:15000});
  await page.evaluate(()=>localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A'));
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:15000});
  await page.waitForTimeout(1200);
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-row-line',{timeout:15000});
  await page.waitForTimeout(3000);
 };
 const rowsFor=async lot=>page.$$eval('.sc-row-line',(ns,l)=>ns
   .filter(n=>(n.querySelector('.sc-row-title')?.textContent||'').includes(l))
   .map(n=>({cat:(n.querySelector('.sc-row-cat')?.textContent||'').replace(/[▶✓○⛔\s]/g,'')})),lot);

 // ---- (1) 端末に無いバックアップがスケジュールに「作業中」で出る(再現) ----
 await put('orphan-run','P9001','C9001',40,null,'編集中');
 await openSchedule();
 let r1=await rowsFor('P9001');
 rec('端末に無いバックアップでも実績としてスケジュールに出る(再現)',
   r1.length>0&&r1.some(x=>/作業中/.test(x.cat)),JSON.stringify(r1));

 // ---- (2) バックアップ削除APIで消える ----
 const del=await page.evaluate(async()=>{
  const r=await fetch('/api/measurement/backup/delete',{method:'POST',
   headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:['orphan-run']})});
  return {status:r.status,body:await r.json()};
 });
 rec('バックアップ削除APIが行を消せる',del.status===200&&del.body.deleted===1,JSON.stringify(del.body));
 rec('削除したIDがバックアップ一覧から消える',!(await backupIds()).includes('orphan-run'));
 await openSchedule();
 r1=await rowsFor('P9001');
 rec('削除後はスケジュールからも消える',r1.length===0,JSON.stringify(r1));

 // ---- (3) 終了時刻が無くても「完了」なら作業中にしない ----
 await put('done-noend','P9002','C9002',300,null,'完了');
 await openSchedule();
 const r2=await rowsFor('P9002');
 rec('終了時刻が無くても状態が完了なら「完了」で出る(作業中にしない)',
   r2.length>0&&r2.every(x=>/完了/.test(x.cat))&&!r2.some(x=>/作業中/.test(x.cat)),JSON.stringify(r2));

 // NG扱いも終端として扱う
 await put('ng-noend','P9003','C9003',260,null,'測定値NG');
 await openSchedule();
 const r3=await rowsFor('P9003');
 rec('測定値NGも終端として扱う(作業中にしない)',
   r3.length>0&&!r3.some(x=>/作業中/.test(x.cat)),JSON.stringify(r3));

 // ---- (4) データ一覧からの削除がバックアップへ伝わる ----
 await page.evaluate(async()=>{
  // 端末内(IndexedDB)へ1件作り、バックアップも作る
  const id='local-del-1';
  const m={id,status:'編集中',updatedAt:new Date().toISOString(),
   basic:{lotNo:'P9004',castingNo:'C9004',mfgMaterial:'A5052',inspectionNo:'K9004'},
   settings:{registeredEquipment:'テスト設備A'},
   workTime:{startAt:new Date(Date.now()-30*60000).toISOString(),endAt:null}};
  await reliablePut(m);
  await backupRecord(m);
 });
 await page.waitForTimeout(1200);
 rec('端末内保存でバックアップにも行ができる',(await backupIds()).includes('local-del-1'));
 await page.evaluate(async()=>{await reliableDelete('local-del-1')});
 await page.waitForTimeout(1500);
 rec('データ一覧から削除するとバックアップからも消える(本体の修正)',
   !(await backupIds()).includes('local-del-1'));

 // ---- (5) 通信できなかった分は控えて次回消す ----
 await put('pending-del','P9005','C9005',20,null,'編集中');
 await page.route('**/api/measurement/backup/delete',r=>r.abort());
 await page.evaluate(async()=>{await reliableDelete('pending-del')});
 await page.waitForTimeout(800);
 const stillThere=(await backupIds()).includes('pending-del');
 const queued=await page.evaluate(()=>JSON.parse(localStorage.getItem('WaveLogPendingBackupDeleteV1')||'[]'));
 rec('サーバーへ届かないと削除は保留になる',stillThere&&queued.includes('pending-del'),JSON.stringify(queued));
 await page.unroute('**/api/measurement/backup/delete');
 await page.evaluate(async()=>{await flushPendingBackupDeletes()});
 await page.waitForTimeout(1200);
 rec('通信が戻ると保留分をまとめて消す',!(await backupIds()).includes('pending-del'),
   JSON.stringify(await page.evaluate(()=>JSON.parse(localStorage.getItem('WaveLogPendingBackupDeleteV1')||'[]'))));

 // ---- (6) データ引継ぎ画面で「端末内に無い」行が分かる ----
 await put('orphan-view','P9006','C9006',15,null,'編集中');
 await page.goto(B+'/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openMasterMaint',{timeout:15000});
 await page.click('#openMasterMaint');
 await page.waitForSelector('#masterMaintForm',{timeout:10000});
 await page.evaluate(()=>{
  const t=[...document.querySelectorAll('#masterMaintNav [data-master]')]
   .find(x=>(x.querySelector('.mm-nav-label')||x).textContent.trim()==='データ引継ぎ');
  if(t)t.click();
 });
 await page.waitForTimeout(2000);
 const view=await page.evaluate(()=>({
  orphanRows:document.querySelectorAll('#masterMaintList .mm-row.is-orphan').length,
  badge:document.querySelectorAll('#masterMaintList .mm-imp-badge.orphan').length,
  selBtn:!!document.querySelector('#mmImpSelectOrphan'),
  delBtn:!!document.querySelector('#mmImpDelete'),
  warn:!!document.querySelector('.mm-import-warning.is-orphan'),
 }));
 rec('端末内に無いバックアップを一覧で色分けして示す',view.orphanRows>0&&view.badge>0,JSON.stringify(view));
 rec('まとめて選ぶボタンと削除ボタンがある',view.selBtn&&view.delBtn,JSON.stringify(view));
 rec('食い違いの説明を画面に出す',view.warn);

 // 選んで削除できる
 await page.evaluate(()=>{
  document.querySelector('#masterMaintList [data-imp-id="orphan-view"]').checked=true;
 });
 await page.click('#mmImpDelete');
 // 削除はアプリ内の確認モーダル(confirmModal)を通る。OKを押す。
 await page.waitForSelector('#appConfirmOk',{state:'visible',timeout:5000});
 await page.click('#appConfirmOk');
 await page.waitForTimeout(2500);
 rec('画面から残骸を削除できる',!(await backupIds()).includes('orphan-view'));

 // 後片付け
 await page.evaluate(async()=>{
  await fetch('/api/measurement/backup/delete',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({ids:['done-noend','ng-noend','orphan-run','pending-del','orphan-view','local-del-1']})});
 });

 await b.close();
 const ng=R.filter(x=>!x.ok);
 console.log('\n== '+(R.length-ng.length)+'/'+R.length+' PASS ==');
 process.exit(ng.length?1:0);
})().catch(async e=>{
 // 落ちてもブラウザは必ず閉じる。閉じ忘れると開いたままの画面が設備の
 // 編集セッションを掴み続け、後続のスケジュール系テストが「編集中です」で
 // 連鎖的に落ちる(実際に1本のFATALから8本が落ちた)。
 console.error('FATAL',e);
 if(b)await b.close().catch(()=>{});
 process.exit(2);
});
