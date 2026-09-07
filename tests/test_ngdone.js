/* test_ngdone.js: 公差外・基準外があっても測定を完了できる（§9.319）

   ============================================================
   利用者の指示
   ------------------------------------------------------------
   「測定値のエラーでNGがあっても測定は完了できるようにしてください。」

   以前は公差外が1件でもあると `WL.records.persistAndTransition('完了')` が入口で
   引き返しており、**完了そのものができなかった**。公差外は「測った事実」で
   あって入力の誤りとは限らない——外れたまま完了して次の工程へ渡す判断は
   現場のものなので、アプリが握ってはいけない。

   ただし**黙って通さない**。ここで固定するのは次の7つ。
    1. 公差外があっても完了できる（状態が「完了」になる）
    2. 押す前に**1回だけ**確認する。件数と項目が読める
    3. やめれば完了しない（記録は編集中のまま）
    4. **公差外のまま完了したことは記録に残る**（`settings.completedWithNg`）
    5. 直してから完了すれば印は消える（直した完了まで疑わせない）
    6. **オペレータ／検査員の未選択は今までどおり止まる**
       （誰が測ったか分からない記録は、あとから意味を持てない）
    7. 完了ボタンの説明が「完了できません」と読める書き方をしない

   **公差の材料は自分で注ぎ込む**（§9.291 ①）——検証用フィクスチャは公差を
   持たないので、入れずに見ると**直す前の実装でも「公差外0件」で通る**。
   ============================================================ */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const API='http://127.0.0.1:5029';
const EQ='テスト設備A';
const setMode=m=>fetch(API+'/api/access-mode',{method:'POST',
  headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m})});

let b=null;
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const page=await b.newPage({viewport:{width:1920,height:1080}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 page.on('pageerror',e=>console.log('[pageerror]',e.message.slice(0,140)));
 /* **素のconfirmを使っていないことも確かめたい**ので、native dialog が出たら
    数える（出れば「確認が2つある」か「アプリの窓を通っていない」の印）。 */
 let native=0;
 page.on('dialog',d=>{native++;d.accept()});

 /* アプリの確認窓。**1つだけ**であること・中身が読めることを見る。 */
 const modal=()=>page.evaluate(()=>{
  const el=document.getElementById('appConfirmModal');
  if(!el||el.hidden)return null;
  return {文:(document.getElementById('appConfirmBody')||{}).textContent||'',
          数:document.querySelectorAll('#appConfirmModal:not([hidden])').length};
 });
 const answer=async yes=>{
  await page.click(yes?'#appConfirmOk':'#appConfirmCancel');
  await page.waitForTimeout(500);
 };
 const recordNow=id=>page.evaluate(async x=>{
  const all=await WL.records.reliableAll();
  const r=all.find(v=>v.id===x);
  return r?{状態:r.status,印:(r.settings&&r.settings.completedWithNg)||null}:null;
 },id);

 let lotId='';
 try{
  await setMode('edit');
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:25000});
  await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:25000});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-row-line',{timeout:25000});
  const started=await page.evaluate(()=>{
   const r=[...document.querySelectorAll('.sc-row-line')].find(x=>x.querySelector('.sc-row-start'));
   if(r){r.querySelector('.sc-row-start').click();return true}return false;
  });
  if(!started)throw Error('開始できる行が無い');
  await page.waitForFunction(()=>!document.querySelector('#measureModal')?.hidden,null,{timeout:25000});
  await page.waitForFunction(()=>typeof S!=='undefined'&&!!S.measure,null,{timeout:25000});
  await page.waitForFunction(()=>document.querySelector('#saveOverlay')?.hidden!==false,null,{timeout:30000}).catch(()=>{});
  lotId=await page.evaluate(()=>S.measure.id);

  /* ---- 材料: 公差を入れて、範囲の外の値を1つ置く ---- */
  const seeded=await page.evaluate(()=>{
   const m=S.measure;
   m.basic.mfgWidth=100;m.basic.mfgThickness=2;
   m.source=m.source||{};
   m.source['板幅公差_製造_プラス']=0.5;m.source['板幅公差_製造_マイナス']=0.5;
   m.measurements.width.forEach(r=>r.fill(''));
   m.measurements.width[0][0]='120.00';        // 99.5〜100.5 の外
   /* **入力内容を板幅にしてから見る**——`WL.measureView.activeRequiredControls()`が
      測定表のセルを必須として数えるのは、その面が開いているときだけ
      （母材のままだと`.ng`のセルが1つも数に入らず、公差外だけの
      言い回しの道を一度も通らない）。 */
   const ty=document.getElementById('measureType');
   if(ty){ty.value='板幅';ty.dispatchEvent(new Event('change',{bubbles:true}))}
   /* 誰が測ったかは埋める——ここは止まったままが正しいので、別の節で試す。 */
   ['operator','inspector'].forEach(id=>{
    const el=document.getElementById(id);
    if(el&&el.options&&el.options.length>1){el.selectedIndex=1;el.dispatchEvent(new Event('change',{bubbles:true}))}
   });
   WL.measureInput.renderMeasureGrid();WL.measureView.updateValidationVisuals();
   const ng=WL.measureReview.outOfTolerance();
   return {公差:!!WL.measureInput.toleranceDetail('width',0,'板幅'),件数:(ng&&ng.total)||0};
  });
  rec('公差外の材料を注ぎ込めた',seeded.公差===true&&seeded.件数>0,JSON.stringify(seeded));

  /* ---- 7. 完了ボタンの説明が「完了できません」と読めない ---- */
  /* **「できません」と読める書き方をしない**——未入力が残っていれば説明は
     そちらを言う（直す先が1つに決まるほうを出す）。公差外だけのときの
     言い回しは、下で `WL.measureView.updateValidationVisuals()` の分岐を直接通して見る。 */
  const tip=await page.evaluate(()=>document.getElementById('complete')?.getAttribute('title')||'');
  rec('完了ボタンの説明が「完了できません」と読める書き方をしない',
      !/できません/.test(tip),tip);
  /* 未入力を一時的に「無い」ことにして、公差外だけのときの文言を見る。
     **本体の`WL.measureView.updateValidationVisuals()`を通すこと**——写して確かめると、
     本体が違う文言を出していても通る（§9.289）。 */
  const ngTip=await page.evaluate(()=>{
   /* **被せない**（§9.352）——閉じたファイルの関数は外から差し替えられない。
      持ち替えは登録表の `own` で行い、`finally` で必ず返上する。 */
   const only=WL.measureView.activeRequiredControls().filter(x=>x.el&&x.el.classList.contains('ng'));
   WL.measureHooks.own('activeRequiredControls',()=>only);
   let t='';
   try{WL.measureView.updateValidationVisuals();t=document.getElementById('complete').title}
   finally{WL.measureHooks.own('activeRequiredControls',null);WL.measureView.updateValidationVisuals()}
   return t;
  });
  rec('公差外だけのときは「確認のうえ完了できます」と言う',
      /確認のうえ完了できます/.test(ngTip)&&!/できません/.test(ngTip),ngTip);

  /* ---- 2・3. 1回だけ確認し、やめれば完了しない ---- */
  native=0;
  await page.click('#complete');
  await page.waitForSelector('#appConfirmModal:not([hidden])',{timeout:8000});
  const ask=await modal();
  rec('押す前に確認が出る（アプリの窓で1つだけ）',
      !!ask&&ask.数===1&&native===0,JSON.stringify(ask)+' native='+native);
  rec('確認に件数と項目が読める',
      !!ask&&/公差・基準の外/.test(ask.文)&&/板幅 公差外 1件/.test(ask.文),
      (ask&&ask.文||'').replace(/\s+/g,' ').slice(0,110));
  rec('記録に残ることも書いてある（黙って通さない）',
      !!ask&&/記録に残ります/.test(ask.文),'');
  await answer(false);
  const afterNo=await recordNow(lotId);
  rec('やめれば完了しない（編集中のまま）',
      !!afterNo&&afterNo.状態!=='完了',JSON.stringify(afterNo));

  /* ---- 1・4. 通せば完了でき、事実が記録に残る ---- */
  await page.click('#complete');
  await page.waitForSelector('#appConfirmModal:not([hidden])',{timeout:8000});
  await answer(true);
  await page.waitForTimeout(2500);
  const done=await recordNow(lotId);
  rec('公差外があっても完了できる',!!done&&done.状態==='完了',JSON.stringify(done&&done.状態));
  rec('公差外のまま完了したことが記録に残る',
      !!(done&&done.印&&done.印.total>0&&(done.印.items||[]).some(x=>x.name==='板幅')),
      JSON.stringify(done&&done.印));

  /* ---- 4b. 記録した印は、あとから読める場所がある（§9.319-A） ----
     **「記録に入った」だけを見る網では足りない**——読める場所が無い印は
     残していないのと同じ（§4）。データ一覧の候補に在ること・**既定では
     出さない**こと（§9.132）・実際に件数が出ることまで見る。 */
  const col=await page.evaluate(async id=>{
   const all=await WL.records.reliableAll();
   const r=all.find(v=>v.id===id)||{};
   const keys=WL.records.recordAllColumnKeys();
   const c=WL.records.RECORD_COL_BY_KEY.get('完了時の公差外');
   return {候補:keys.indexOf('完了時の公差外')>=0,
           既定では出さない:WL.records.recordInitialHidden(keys).indexOf('完了時の公差外')>=0,
           値:c?String(c.get(r)||''):null};
  },lotId);
  rec('データ一覧の候補に出せる（読める場所がある）',col.候補===true,JSON.stringify(col));
  rec('既定では1列も増やさない（§9.132）',col.既定では出さない===true,JSON.stringify(col));
  rec('公差外のまま完了した記録には件数が出る',/件/.test(col.値||''),JSON.stringify(col.値));

  /* ---- 5. 直したら印は消える ---- */
  await page.evaluate(async id=>{
   const all=await WL.records.reliableAll();
   const r=all.find(v=>v.id===id);
   S.measure=WL.measureView.ensureMeasureShape(r);
   document.getElementById('measureModal').hidden=false;
   S.measure.measurements.width[0][0]='100.00';
   WL.measureView.renderMeasurement();WL.measureView.updateValidationVisuals();
  },lotId);
  await page.waitForTimeout(400);
  const left=await page.evaluate(()=>WL.measureReview.outOfTolerance().total);
  rec('直したら公差外は0件になる',left===0,String(left));
  native=0;
  await page.click('#complete');
  await page.waitForTimeout(600);
  /* 未測定の項目は残るので確認は出る。**公差外の見出しは出ない**こと。 */
  const ask2=await modal();
  if(ask2){
   rec('公差外が無ければ、その見出しは出さない',!/公差・基準の外/.test(ask2.文),
       (ask2.文||'').replace(/\s+/g,' ').slice(0,80));
   await answer(true);
   await page.waitForTimeout(2500);
  }else{
   rec('公差外が無ければ、その見出しは出さない',true,'確認そのものが出なかった');
  }
  const fixed=await recordNow(lotId);
  rec('直して完了すれば印は消える',!!fixed&&fixed.状態==='完了'&&!fixed.印,
      JSON.stringify(fixed));

  /* ---- 6. オペレータ／検査員の未選択は今までどおり止まる ---- */
  await page.evaluate(async id=>{
   const all=await WL.records.reliableAll();
   const r=all.find(v=>v.id===id);
   S.measure=WL.measureView.ensureMeasureShape(r);S.measure.status='編集中';
   document.getElementById('measureModal').hidden=false;
   WL.measureView.renderMeasurement();
   const el=document.getElementById('operator');
   if(el){el.value='';el.dispatchEvent(new Event('change',{bubbles:true}))}
   WL.measureView.updateValidationVisuals();
  },lotId);
  await page.waitForTimeout(400);
  await page.click('#complete');
  await page.waitForTimeout(900);
  const blocked=await page.evaluate(()=>({
   窓:!document.getElementById('appConfirmModal')?.hidden,
   文:(document.querySelector('.validation-message')||{}).textContent||'',
  }));
  rec('オペレータ未選択は今までどおり止まる',
      !blocked.窓&&/完了できません/.test(blocked.文),JSON.stringify(blocked));
  rec('止めた理由に公差外を混ぜない（直す先を取り違えさせない）',
      !/公差外/.test(blocked.文),blocked.文.slice(0,60));
 }catch(e){
  rec('FATAL',false,String(e&&e.message||e));
 }

 /* 後片付け（§9.121）。この検証で完了にした記録を端末と共有から消す。 */
 try{
  if(lotId)await page.evaluate(async id=>{
   try{await WL.records.deleteBackupRows([id])}catch(e){}
   try{await WL.records.reliableDelete(id)}catch(e){}
  },lotId);
 }catch(e){}

 await b.close();
 const ng=R.filter(x=>!x.ok);
 console.log('\n== '+(R.length-ng.length)+'/'+R.length+' PASS ==');
 process.exit(ng.length?1:0);
})().catch(async e=>{
 console.error('FATAL',e);
 if(b)await b.close().catch(()=>{});
 process.exit(2);
});
