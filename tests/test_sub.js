/* サブ導線の棚卸し(§9.54)の検証:
   - データ一覧/ダッシュボードの全件読みが1回になっている
   - ダッシュボードの同時呼び出しでも読みが二重にならない
   - 恒久的な失敗(403)はバックアップ削除の控えへ積み直さない */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
const setMode=async m=>{await fetch(B+'/api/access-mode',{method:'POST',
 headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m})})};
let b=null;
(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 page.on('pageerror',e=>console.log('[pageerror]',e.message.slice(0,140)));
 page.on('dialog',d=>d.accept());

 await setMode('edit');
 await page.goto(B+'/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openSchedule',{timeout:15000});
 await page.evaluate(()=>localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A'));
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForTimeout(2500);
 await page.evaluate(async()=>{
  const now=Date.now();
  for(let i=0;i<40;i++)await WL.records.reliablePut({id:'s-'+i,status:i%3?'完了':'編集中',
   updatedAt:new Date(now-i*3600000).toISOString(),
   basic:{lotNo:'L'+String(i).padStart(5,'0'),castingNo:'C'+i,mfgMaterial:'A5052'},
   settings:{registeredEquipment:'テスト設備A'},
   workTime:{startAt:new Date(now-i*3600000).toISOString(),endAt:new Date(now-i*3600000+3600000).toISOString()},
   measurements:{}});
 });
 // 端末内データの全件読みを数える
 const arm=()=>page.evaluate(()=>{
  /* **被せない**（§9.352）——数えるのは登録表の `own` で行い、
     元の道は核（`reliableAllCore`）を呼ぶ。 */
  window.__ra=0;
  WL.measureHooks.own('reliableAll',async(...a)=>{
   window.__ra++;return WL.records.reliableAllCore(...a);
  });
 });
 const reads=()=>page.evaluate(()=>window.__ra);

 await arm();
 await page.evaluate(()=>{const m=document.querySelector('#recordModal');if(m)m.hidden=true});
 await page.click('#homeDrafts');await page.waitForTimeout(2200);
 const listReads=await reads();
 rec('データ一覧を開くときの全件読みは1回',listReads===1,listReads+'回');

 await arm();
 const btn=await page.$('[data-status-filter="done"]');
 if(btn){await btn.click();await page.waitForTimeout(1500)}
 rec('一覧内の絞り込みでは読み直さない',(await reads())===0,(await reads())+'回');

 await arm();
 await page.click('#openDashboard');await page.waitForTimeout(3000);
 const dashReads=await reads();
 // 以前はensureDataが結果だけをキャッシュしており、1回の描画から同時に
 // 2箇所が呼ぶと両方ともキャッシュ未命中になって2回読んでいた。
 rec('ダッシュボードを開くときの全件読みは1回(同時呼び出しでも二重に読まない)',
   dashReads===1,dashReads+'回');

 // ---- 恒久的な失敗(403)は控えへ積まない ----
 await page.evaluate(()=>localStorage.removeItem('WaveLogPendingBackupDeleteV1'));
 await setMode('schedule');
 await page.evaluate(async()=>{await WL.records.deleteBackupRows(['no-such-id-403'])});
 await page.waitForTimeout(600);
 const q403=await page.evaluate(()=>JSON.parse(localStorage.getItem('WaveLogPendingBackupDeleteV1')||'[]'));
 rec('権限が無い(403)ときは控えへ積み直さない',q403.length===0,JSON.stringify(q403));

 // 一時的な失敗(通信断)は従来どおり控える
 await setMode('edit');
 await page.route('**/api/measurement/backup/delete',r=>r.abort());
 await page.evaluate(async()=>{await WL.records.deleteBackupRows(['transient-1'])});
 await page.waitForTimeout(600);
 const qNet=await page.evaluate(()=>JSON.parse(localStorage.getItem('WaveLogPendingBackupDeleteV1')||'[]'));
 rec('通信できないときは従来どおり控える',qNet.includes('transient-1'),JSON.stringify(qNet));
 await page.unroute('**/api/measurement/backup/delete');
 await page.evaluate(()=>localStorage.removeItem('WaveLogPendingBackupDeleteV1'));

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
