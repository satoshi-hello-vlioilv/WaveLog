/* §9.61 履歴(作業中・完了)の削除。
   「データ一覧には無いのにスケジュールに居座る」状態を実際に作って消す。
   注意: このテストはモードを切り替え、共有のバックアップDBへ行を作る。
   後続テストを巻き込まないよう、**必ずfinallyで後始末する**
   (以前、失敗時にscheduleモードのまま抜けてtest_p11を壊した)。 */
'use strict';
const {run}=require('./lib/harness.js');
const B='http://127.0.0.1:5029';
const EQ='テスト設備A';
const STAMP=Date.now();
const RID='orphan-test-'+STAMP;
// ロット番号も実行ごとに変える。過去の失敗で残った行と同じ番号だと、
// 「自分が作った行」を取り違えて消し、検証が成立しなくなる。
const LOT='ZZ9T'+String(STAMP).slice(-4);
const post=async(p,b)=>{const r=await fetch(B+p,{method:'POST',
 headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});return r.json()};
const setMode=m=>post('/api/access-mode',{mode:m});
const seed=async()=>{
 await setMode('edit');
 return post('/api/measurement/backup',{id:RID,status:'編集中',equipment:EQ,
  lotNo:LOT,castingNo:'C0001',
  payload:JSON.stringify({basic:{lotNo:LOT,castingNo:'C0001',mfgMaterial:'ZZMAT'},
   settings:{registeredEquipment:EQ},status:'編集中',
   workTime:{startAt:new Date(Date.now()-3*3600*1000).toISOString(),endAt:null}})});
};
run('test_histdel: §9.61 履歴(作業中・完了)の削除。', async ({page,rec,B,W,idle,paint,errs,browser})=>{
 const rows=async()=>page.evaluate(l=>[...document.querySelectorAll('.sc-row-line')]
   .filter(r=>r.textContent.includes(l)).length,LOT);
 const rowBtn=async()=>page.evaluate(l=>{const r=[...document.querySelectorAll('.sc-row-line')]
   .find(x=>x.textContent.includes(l));return r?!!r.querySelector('.sc-row-delete-history'):null},LOT);
 const clickDel=async()=>page.evaluate(l=>{const r=[...document.querySelectorAll('.sc-row-line')]
   .find(x=>x.textContent.includes(l));if(r)r.querySelector('.sc-row-delete-history')?.click()},LOT);
 try{
  for(const mode of ['edit','schedule']){
   await seed();
   if(mode==='schedule')await setMode('schedule');
   await page.goto(B+'/',{waitUntil:'domcontentloaded'});
   await page.waitForSelector('#openSchedule',{timeout:15000});
   await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
   await page.reload({waitUntil:'domcontentloaded'});
   await W.booted(page);await idle();
   await page.click('#openSchedule');
   await idle();
   if(mode==='schedule'){
    await page.waitForSelector('.sc-board-row',{timeout:15000});
    await page.evaluate(e=>{const r=[...document.querySelectorAll('.sc-board-row')]
      .find(x=>x.dataset.equipment===e);if(r)r.click()},EQ);
   }
   await page.waitForSelector('.sc-row-line',{timeout:45000});
   // 固定待ちにせず、対象行が出るまで待つ(共有DBの状態で描画時間が変わるため)
   // 共有フィクスチャが大きいと予定の描画・実績突合に時間がかかる。
   // 固定の20秒では足りずに落ちることがあったため余裕を持たせる。
   const appeared=await page.waitForFunction(l=>[...document.querySelectorAll('.sc-row-line')]
     .some(x=>x.textContent.includes(l)),LOT,{timeout:45000}).then(()=>true).catch(()=>false);
   rec(`[${mode}] データ一覧に無い実績がスケジュールに出ている`,appeared,(await rows())+'行');
   if(!appeared)continue;
   rec(`[${mode}] 履歴行に実績削除ボタンがある`,await rowBtn()===true);
   await clickDel();
   const warned=await page.waitForSelector('#appConfirmModal:not([hidden])',{timeout:6000})
     .then(()=>true).catch(()=>false);
   if(!warned){rec(`[${mode}] 取り消せない旨の警告が出る`,false,'確認モーダルが出ない');continue}
   const warn=await page.evaluate(()=>({
    body:document.querySelector('#appConfirmBody').textContent,
    danger:document.querySelector('#appConfirmOk').className.includes('danger')}));
   rec(`[${mode}] 取り消せない旨の警告が出る`,
     /元に戻せません/.test(warn.body)&&warn.danger,JSON.stringify(warn).slice(0,120));
   await page.click('#appConfirmCancel');await page.waitForSelector("#appConfirmModal",{state:"hidden",timeout:6000});await idle(800);  // 起きないこと（消えない）を見る: 消すなら消すはずの往復が静まるまで
   rec(`[${mode}] キャンセルすると消えない`,(await rows())>0);
   await clickDel();
   await page.waitForSelector('#appConfirmModal:not([hidden])',{timeout:6000});
   await page.click('#appConfirmOk');
   const gone=await page.waitForFunction(l=>![...document.querySelectorAll('.sc-row-line')]
     .some(x=>x.textContent.includes(l)),LOT,{timeout:25000}).then(()=>true).catch(()=>false);
   rec(`[${mode}] 削除するとスケジュールから消える`,gone,(await rows())+'行');
   const still=await (await fetch(B+'/api/measurement/backup/list')).json();
   rec(`[${mode}] バックアップからも消えている`,!JSON.stringify(still.items||[]).includes(RID));
  }
  // 閲覧モードでは出さない
  await setMode('view');
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await W.until(page,()=>!!document.getElementById('openSchedule')&&!document.documentElement.classList.contains('app-booting'),
    null,{ms:20000,what:'閲覧モードで起動の覆いが外れる'});
  await idle(800,10000);  // 起きないこと（ボタンを出さない）を見る: 描き終えて静まるまで
  rec('閲覧モードでは実績削除ボタンを出さない',
    !(await page.evaluate(()=>!!document.querySelector('.sc-row-delete-history'))));
 }finally{
  // 後始末: 検証用の行を確実に消し、モードをeditへ戻す。
  // ここを飛ばすと後続テストが別モードで走り、無関係な失敗を生む。
  try{await setMode('edit');await post('/api/measurement/backup/delete',{ids:[RID]})}catch(e){}
 }
}, {viewport:{width:1700,height:1000}});
