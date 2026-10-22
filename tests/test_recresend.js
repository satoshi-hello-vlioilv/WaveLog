/* test_recresend.js: 手元にあって共有に届いていない測定データは、一覧を開くと送り直す（§9.621）
   ============================================================
   利用者の指摘「測定したPCからのデータは『完了』でかなりの数のデータが既に登録済み。見えるはずのものが見えていない」。
   測定した PC の一覧では、その記録の「最終更新者」が「-」だった（共有の行が無い＝サーバーの一覧に無い）。
   画面は「送れた（synced）」と控えているので、未送信の帯にも出ず、送り直しもされていなかった。

   物差し（評価関数）: この端末の保存領域（IndexedDB）に「送れた」と控えた記録を置き、サーバーには置かない。
   データ一覧を開いてから、サーバーの一覧（backup/summary）に届くかを数える。
    S1. 「送れた」と控えたのにサーバーに無い記録は、一覧を開くと送り直され、サーバーに届く
    S2. 「バックアップから消す」で利用者が外した記録（withdrawn）は送り直さない
    S3. 送り直した記録は「送れた」に戻る（未送信の数に残らない）
   ============================================================ */
'use strict';
const {run}=require('./lib/harness.js');
const B='http://127.0.0.1:5029',EQ='テスト設備A';
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});

run('test_recresend: 手元にあって共有に届いていない測定データは送り直す（§9.621）', async ({page,rec,W,idle,setMode})=>{
 const stamp=Date.now().toString(36);
 const lost={id:`RESEND-${stamp}-A`,lot:`RSA${stamp}`},gone={id:`RESEND-${stamp}-B`,lot:`RSB${stamp}`};
 const ids=[lost.id,gone.id];
 try{
  await setMode('edit');
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
  await page.reload({waitUntil:'domcontentloaded'});
  await W.booted(page);await idle();
  await page.evaluate(async([a,b,eq])=>{
   const at=new Date().toISOString();
   const mk=(x,st)=>WL.measureView.ensureMeasureShape({id:x.id,status:'完了',updatedAt:at,registeredEquipment:eq,
    basic:{lotNo:x.lot,inspectionNo:'K',castingNo:'C'},settings:{operator:'網'},measurements:{},
    syncState:{status:st,lastAttempt:at,lastError:'',attempts:1}});
   await WL.records.reliablePut(mk(a,'synced'));
   await WL.records.reliablePut(mk(b,'withdrawn'));
  },[lost,gone,EQ]);
  await page.evaluate(()=>WL.records.openRecords('履歴'));
  const onServer=async()=>{const r=await (await fetch(B+'/api/measurement/backup/summary')).json();return (r.items||[]).map(x=>x.id)};
  const t0=Date.now();
  const have=await W.poll(onServer,list=>list.includes(lost.id),10000,300);
  rec('S1. 「送れた」と控えたのにサーバーに無い記録は、一覧を開くと送り直されてサーバーに届く',have.includes(lost.id),
   `${have.includes(lost.id)?'届いた':'届かない'}（${Math.round((Date.now()-t0)/100)/10}秒）`);
  rec('S2. 利用者が共有から外した記録（withdrawn）は送り直さない',!have.includes(gone.id),have.includes(gone.id)?'送られた':'送られていない');
  const st=await page.evaluate(async id=>((await WL.records.reliableGet(id))||{}).syncState||{},lost.id);
  rec('S3. 送り直した記録は「送れた」に戻る',st.status==='synced',JSON.stringify(st));
 }finally{
  await post('/api/measurement/backup/delete',{ids}).catch(()=>{});
  await page.evaluate(async ids=>{for(const id of ids)await WL.records.reliableDelete(id).catch(()=>{})},ids).catch(()=>{});
 }
},{viewport:{width:1728,height:1152}});
