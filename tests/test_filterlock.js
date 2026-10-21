/* test_filterlock.js: 「いつも適用（固定）」は1つの印（§9.190）
   ------------------------------------------------------------
   利用者の指摘: 「鍵をかけても画面を切り替えると解除されてしまいます。
   鍵の意味を取り違えられている可能性を感じました。フィルタの鍵は、他の
   一覧で使えないという意味ではなく、適用したフィルタから外せなくなる
   という意味のフィルタロックです。つまり鍵マークはデフォルトにすると
   同義です。混同する場合はデフォルトチェックだけで、フィルタの登録欄には
   鍵マークは不要ですね。」

   直したのは2つ。
   ①**意味を1つに**した——「デフォルト」と「鍵」は同じことを指していたので、
     登録一覧のチェックは「いつも適用（固定）」の1つだけにし、印は必ず
     2つそろえて保存する。
   ②**真因**: `masters.filter_preset_marks` が書込ガードの例外表に無く、
     **scheduleモードでは印の保存が403で弾かれていた**。画面は失敗を
     握り潰していたため、印は端末の控えにだけ残り、次に登録フィルタを
     読み直した瞬間にサーバーの答え（印なし）で消されていた。

   ここで固定するのは:
    1. scheduleモードでも印がマスタへ保存できる（403にならない）
    2. 【§9.614で場所を移した】「✎ 直す」の窓の操作は「いつも適用」の1つだけ（鍵マークは無い）
    3. 画面から付けると印は**2つそろって**保存される
    4. 外すと2つそろって外れる（窓の中のチェックを外して保存——窓そのものが確かめる手順。
       帯の札から外すときは確認を挟む・test_filtersavedui）
    5. 控えを消して開き直しても、いつも適用の条件が自動で入る（locked付き）
    6. 利用者IDが**後から**届いても、その人の控えを空で潰さない
       （`ensureMarkMaps()`がIDごとに読み直す）
    7. 保存できなかったときは黙らない */
'use strict';
const {run}=require('./lib/harness.js');
const API='http://127.0.0.1:5029';
const NAME='いつも適用テスト_'+Date.now();
const post=(p,b)=>fetch(API+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b||{})});
const OTHER_KEY='__別の一覧__::__別の表__::';   // 6) 用。今の一覧とは無関係な印

/* 触る前の行を控える（§9.362 ⑤）。製品の「登録フィルタを削除」は
   **論理削除**（`有効=0`）なので、APIで消しても行は残る。**この実行で
   増えた行だけ**を素の表から片付ける（名前で拾うと、同じ名前を使う
   他の網の期待と食い違う・§9.284）。 */
const H=require('./lib/harness.js');
const SNAP_TABLES=['フィルタプリセットマスタ','フィルタ個人設定マスタ'];
let snapM=null;
run('test_filterlock: 「いつも適用（固定）」は1つの印（§9.190）', async ({page,rec,B,W,idle,paint,errs,browser})=>{
 snapM=await H.masterSnapshot(SNAP_TABLES);
 let pid=null;
 const boot=async()=>{
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.waitForSelector('#grid table',{timeout:30000});
  await page.waitForFunction(()=>(S.rows||[]).length>0,null,{timeout:25000});
 };
 const marksOf=id=>page.evaluate(async ({id,db,table})=>{
  const q=new URLSearchParams({db,table,mode:'',user:'tester'});
  const j=await (await fetch('/api/filter-presets?'+q)).json();
  const it=(j.items||[]).find(x=>String(x.id)===String(id))||{};
  return {found:!!it.id,d:!!it.isDefault,l:!!it.isLocked};
 },{id,db:made.db,table:made.table});
 let made={};
 /* 固定待ちを置かない（tests/README.md）。印が変わるのを条件で待つ。 */
 const waitMarks=async(id,want,ms=10000)=>{
  const t=Date.now();let last=null;
  while(Date.now()-t<ms){
   last=await marksOf(id);
   if(last.d===want&&last.l===want)return last;
   await new Promise(r=>setTimeout(r,150));
  }
  return last;
 };
 /* 保存したフィルタの「✎ 直す」の窓を開く（§9.614）。保存の一覧はマスタを読み終えてから描くので、自分の行が出るまで待つ。 */
 const openEdit=async()=>{
  await page.evaluate(()=>WL.filters.reload());
  await page.click('#filterSavedBtn');
  await W.until(page,id=>!!document.querySelector(`#filterSavedMenu [data-edit="${id}"]`),pid,{ms:20000,what:'保存したフィルタの面に自分の行'});
  await page.click(`#filterSavedMenu [data-edit="${pid}"]`);
  await W.until(page,()=>!!document.querySelector('#appConfirmBody .flt-ed'),null,{ms:8000,what:'直す窓'});
 };
 const setAlways=async on=>{
  await openEdit();
  const box=await page.$('#appConfirmBody .flt-ed-always input');
  if(box&&(await box.isChecked())!==on)await box.click();
  await page.click('#appConfirmOk');
  await W.until(page,()=>document.getElementById('appConfirmModal').hidden,null,{ms:8000,what:'直す窓が閉じる'});
 };
 try{
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.evaluate(()=>{localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A');
                           localStorage.setItem('AccessMeasurementUserId','tester')});
  await boot();

  /* ---- 0) 印の付いていない条件を1件登録する ---- */
  made=await page.evaluate(async name=>{
   const col=(S.columns||[])[1];
   const r=await fetch('/api/filter-presets',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({name,db:S.db,table:S.table,mode:'',user_id:'tester',
      filters:[{column:col,op:'not_empty',value:''}]})});
   const j=await r.json();
   return {id:j.id!=null?j.id:null,col,db:S.db,table:S.table,error:j.error||''};
  },NAME);
  pid=made.id;
  rec('条件を登録できる',pid!=null,JSON.stringify(made));

  /* ---- 1) scheduleモードでも印を保存できる（真因の固定） ---- */
  await post('/api/access-mode',{mode:'schedule'});
  const inSchedule=await page.evaluate(async id=>{
   const r=await fetch('/api/filter-presets/marks',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({user:'tester',user_id:'tester',id,isDefault:true,isLocked:true})});
   return {status:r.status,body:(await r.text()).slice(0,160)};
  },pid);
  rec('★scheduleモードでも印を保存できる（403にならない）',inSchedule.status===200,JSON.stringify(inSchedule));
  await post('/api/access-mode',{mode:'edit'});
  // 付いた印はここでいったん外し、画面から付け直す（3の材料）
  await page.evaluate(async id=>fetch('/api/filter-presets/marks',{method:'POST',
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify({user:'tester',user_id:'tester',id,isDefault:false,isLocked:false})}),pid);

  /* ---- 2) 直す窓の操作は1つだけ ---- */
  await openEdit();
  const ui=await page.evaluate(()=>{
   const b=document.getElementById('appConfirmBody');
   return {always:b.querySelectorAll('.flt-ed-always input').length,
           legacy:b.querySelectorAll('.fp-lock-btn,.fp-default,[data-lock]').length,
           label:(b.querySelector('.flt-ed-always')||{}).textContent||''};
  });
  rec('直す窓の操作は「いつも適用」の1つだけ（鍵マークは無い）',ui.always===1&&ui.legacy===0&&/開くたびに当てる/.test(ui.label),JSON.stringify(ui));
  await page.click('#appConfirmCancel');

  /* ---- 3) 画面から付けると2つそろって保存される ---- */
  await setAlways(true);
  const on=await waitMarks(pid,true);
  rec('画面から付けると印は2つそろって立つ',on.d&&on.l,JSON.stringify(on));
  const applied0=await page.evaluate(()=>(S.genericFilters||[]).filter(f=>f.locked).length);
  rec('付けたらその場で、外せない印つきの条件が入る',applied0>=1,String(applied0));

  /* ---- 4) 外すと2つそろって外れる ---- */
  await setAlways(false);
  const off=await waitMarks(pid,false);
  rec('外すと印は2つそろって外れる',!off.d&&!off.l,JSON.stringify(off));

  /* ---- 5) 控えを消して開き直しても自動で入る ---- */
  await page.evaluate(async id=>fetch('/api/filter-presets/marks',{method:'POST',
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify({user:'tester',user_id:'tester',id,isDefault:true,isLocked:true})}),pid);
  await page.evaluate(()=>{
   Object.keys(localStorage).filter(k=>/Filter/i.test(k)).forEach(k=>localStorage.removeItem(k));
   localStorage.setItem('AccessMeasurementUserId','tester');
  });
  await boot();
  await page.waitForFunction(()=>(S.genericFilters||[]).some(f=>f.locked),null,{timeout:25000}).catch(()=>{});
  const applied=await page.evaluate(()=>(S.genericFilters||[]).map(f=>({c:f.column,locked:!!f.locked})));
  rec('控えを消して開き直しても、いつも適用の条件が入る（外せない印つき）',
      applied.some(f=>f.locked&&f.c===made.col),JSON.stringify(applied));

  /* ---- 6) 利用者IDが後から届いても、その人の控えを空で潰さない ----
     別の一覧の印を控えへ入れておき、「IDが空のまま一度動く→IDが届く」を
     再現する。IDごとに読み直していないと、空のときに作った写しがそのまま
     本人の置き場へ書き戻され、**触っていない一覧の印まで消える**。 */
  await page.evaluate(key=>{
   const all=JSON.parse(localStorage.getItem('MeasurementFilterMarksV2')||'{}');
   all.tester=all.tester||{def:{},lock:{}};
   all.tester.def[key]=['999'];all.tester.lock[key]=['999'];
   localStorage.setItem('MeasurementFilterMarksV2',JSON.stringify(all));
  },OTHER_KEY);
  /* **IDが分からないまま起動する**のを再現する（実機では/api/whoamiが
     後から返るまでこの状態。§9.184）。起動のたびに消しておく。 */
  await page.addInitScript(()=>localStorage.removeItem('AccessMeasurementUserId'));
  await boot();
  await page.evaluate(()=>WL.filters.reload());   // 別のID（またはID無し）で一度動かす
  await page.evaluate(()=>localStorage.setItem('AccessMeasurementUserId','tester'));
  await page.evaluate(()=>WL.filters.reload());   // 本人のIDが届いた
  const kept=await page.evaluate(key=>{
   const all=JSON.parse(localStorage.getItem('MeasurementFilterMarksV2')||'{}');
   return {keys:Object.keys(all),other:((all.tester||{}).def||{})[key]||null};
  },OTHER_KEY);
  rec('★利用者IDが後から届いても、触っていない一覧の印が消えない',
      !!kept.other&&kept.other.includes('999'),JSON.stringify(kept));

  /* ---- 7) 保存できなかったら黙らない ---- */
  await page.evaluate(()=>{
   window.__markToasts=[];window.__realToast=window.showToast;window.__realFetch=window.fetch;
   window.showToast=(t,m)=>{window.__markToasts.push(String(t)+'|'+String(m||''))};
   window.fetch=(u,o)=>String(u).includes('/api/filter-presets/marks')
     ?Promise.resolve(new Response(JSON.stringify({error:'現在のモードでは、この操作は実行できません。'}),
                                   {status:403,headers:{'Content-Type':'application/json'}}))
     :window.__realFetch(u,o);
  });
  await setAlways(false);
  const noisy=await page.waitForFunction(()=>window.__markToasts&&window.__markToasts.length
    ?window.__markToasts:false,null,{timeout:10000}).then(h=>h.jsonValue()).catch(()=>[]);
  await page.evaluate(()=>{window.fetch=window.__realFetch;window.showToast=window.__realToast});
  rec('保存に失敗したら画面に出す（黙って画面だけ変えない）',
      noisy.some(t=>/いつも適用|保存できません/.test(t)),JSON.stringify(noisy).slice(0,300));

 }catch(e){
  rec('例外なく終わる',false,e.message);
 }finally{
  /* 後始末: 登録した条件を消す（§9.121。置き土産は遠いテストを落とす） */
  try{if(pid!=null)await post('/api/filter-presets/delete',{id:pid,user_id:'tester'})}catch(_){}
  try{await post('/api/access-mode',{mode:'edit'})}catch(_){}
  try{if(snapM)await H.dropNewMasterRows(snapM)}
  catch(e){console.log('!! 増えた行を消せませんでした: '+(e&&e.message||e))}
 }
}, {viewport:{width:1600,height:1000}});
