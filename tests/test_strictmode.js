/* test_strictmode.js: 厳密モード（§9.588、利用者の指示）——開始は一番上のロットからだけ
   ============================================================
   「運用のモードを現状が『通常モード』だとすると『厳密モード』というものを作り、ロットの開始を
    作業スケジュール一覧の一番上のロットからしかできないようにするモードを作成してください。」
   「スタートしたロットより上の設備停止は前のロットの終了時間とスタートしたロットの開始時刻の間の
    時間で実時間を登録を自動的にできる」「作業スケジュールの中で開始判定フラグを設け、管理する」

   物差し（前の値は §9.588 の決定記録・同じ物差しで測る）:
    M1. 一番上以外で「開始」を出す行の数（前 1以上・どの予定の行にも出ていた）→ 0
    M2. 開始したロットより上で、実際の時刻が無い設備停止の数（前 1）→ 0
    M3. 開始の記録（開始判定）が予定に残るか（前 なし）→ あり
   ほかに固定すること:
    1. ヘッダーに「運用 厳密」の札（字で言う）。一番上の行は左の帯（`sc-row-strict-top`）
    2. 開始の口は一番上でないロット（notTop）・予定に無いロット（notPlanned）を理由つきで断る
    3. 仕掛の一覧の道（予定の行を通らない開始）も関門で止まり、次の一手「作業スケジュールを開く」が出る
    4. 開始すると一番上は作業中になり、次の「開始」は出ない（前のロットを終えてから）
   材料（設備停止の行・運用モード）は自分で入れて自分で戻す。
   ============================================================ */
'use strict';
const {run}=require('./lib/harness.js');
const EQ='テスト設備A';
const TAG='RTS'+process.pid;

run('test_strictmode: 厳密モード（§9.588）', async ({page,rec,B,W,idle,errs})=>{
 const made=[];
 let eqRow=null,stopId=null;
 const post=(p,body)=>page.evaluate(async a=>{
  const t0=Date.now();let last=null;
  while(Date.now()-t0<20000){
   const r=await fetch(a.p,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(Object.assign({user_id:'test-strict'},a.b))});
   let j={};try{j=await r.json()}catch(e){j={parseError:String(e)}}
   last={status:r.status,body:j};
   if(r.status!==423)return last;
   await new Promise(z=>setTimeout(z,400));   // 共有の書込ロックが空くのを待つ（§4.2）
  }
  return last;
 },{p,b:body||{}});
 const get=u=>page.evaluate(async x=>(await fetch(x)).json(),u);
 const plan=async()=>((await get('/api/schedule/plan?equipment='+encodeURIComponent(EQ))).entries||[]);
 const setRunMode=async mode=>{
  if(!eqRow)return null;
  return post('/api/equipment-master/update',{id:eqRow.id,name:eqRow.name,kind:eqRow.kind,maxStrips:eqRow.maxStrips,
   standardMinutes:eqRow.standardMinutes,maxLineSpeed:eqRow.maxLineSpeed,runMode:mode});
 };
 try{
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await W.booted(page);
  await page.evaluate(e=>{localStorage.setItem('AccessMeasurementConfiguredEquipment',e);
                          localStorage.setItem('AccessMeasurementUserId','tester')},EQ);
  const list=await get('/api/equipment-master');
  eqRow=(list.items||[]).find(x=>x.name===EQ)||null;
  rec('設備マスタの応答は運用モードの語彙と各設備の運用モードを持つ',
      !!eqRow&&eqRow.runMode==='normal'&&(list.runModes||[]).map(x=>x.key).join(',')==='normal,strict',
      JSON.stringify({runMode:eqRow&&eqRow.runMode,modes:list.runModes}).slice(0,200));
  const sv=await setRunMode('strict');
  rec('設備マスタで運用モードを厳密にできる',!!sv&&sv.status===200,JSON.stringify(sv&&sv.body).slice(0,160));

  /* 材料: 一番上のロットの前に設備停止を1本（スケジュールモードで入れる） */
  await post('/api/access-mode',{mode:'schedule'});
  const before=await plan();
  const works=before.filter(e=>e.kind==='作業'&&!e.parentId&&!e.unplanned&&e.state==='予定');
  const top=works[0],third=works[2];
  const reg=await post('/api/schedule/stop-reason-master',{equipment:EQ,name:TAG+'段取り',category:'段取り',standardMinutes:20});
  stopId=reg.body.id;
  const add=await post('/api/schedule/plan/add',{equipment:EQ,kind:'設備停止',title:TAG+'段取り',
   stopReasonId:stopId,estimateMinutes:20,position:'before:'+top.id});
  if(add.body.id)made.push(add.body.id);
  rec('材料: 一番上のロットの前に設備停止を入れた',!!add.body.id,JSON.stringify(add.body).slice(0,160));
  await post('/api/access-mode',{mode:'edit'});

  // ---- 1. 見え方（編集モード＝開始する端末） ----
  await page.reload({waitUntil:'domcontentloaded'});
  await W.booted(page);
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-row-line',{timeout:25000});
  await W.settleFlags(page);
  await W.until(page,()=>!!document.querySelector('.sc-row-strict-top'),null,{ms:20000,what:'一番上の行の印'});
  const look=await page.evaluate(()=>{
   const chip=document.getElementById('runModeBadge');
   const starts=[...document.querySelectorAll('#scTimeline .sc-row-start')].map(b=>b.closest('.sc-row-line'));
   const topRow=document.querySelector('.sc-row-strict-top');
   return {chip:chip&&!chip.hidden?chip.textContent.replace(/\s+/g,''):'',chipTitle:chip?chip.title:'',
           starts:starts.length,onTop:starts.every(r=>r&&r.classList.contains('sc-row-strict-top')),
           topId:topRow?topRow.dataset.id:''};
  });
  rec('1: ヘッダーに「運用 厳密」の札（字で言う・なぜ他に開始が無いかを title が言う）',
      look.chip==='運用厳密'&&/一番上のロット/.test(look.chipTitle),JSON.stringify(look).slice(0,200));
  rec('1: 一番上のロットの行が印（左の帯）を持つ',look.topId===String(top.id),`${look.topId} / ${top.id}`);
  rec(`M1: 一番上以外で「開始」を出す行 0（前 1以上）——今は ${look.starts-(look.onTop&&look.starts?1:0)}`,
      look.starts===1&&look.onTop,JSON.stringify(look));

  // ---- 2. 開始の口が断る ----
  const notTop=await post('/api/schedule/plan/start',{equipment:EQ,id:third.id});
  rec('2: 一番上でないロットは 409・notTop・一番上のロットの名前と「並べ替え」を言う',
      notTop.status===409&&notTop.body.code==='notTop'&&notTop.body.error.includes(top.lotNo)&&/並べ替え/.test(notTop.body.error),
      JSON.stringify(notTop.body).slice(0,200));
  const notPlanned=await post('/api/schedule/plan/start',{equipment:EQ,lotNo:TAG+'ZZ',castingNo:'C9'});
  rec('2: 予定に無いロットは 409・notPlanned',notPlanned.status===409&&notPlanned.body.code==='notPlanned',
      JSON.stringify(notPlanned.body).slice(0,160));
  const other=await post('/api/schedule/plan/start',{equipment:'テスト設備B',lotNo:'L0041'});
  rec('2: 通常モードの設備では何も書かずに通す（strict:false）',other.status===200&&other.body.strict===false,
      JSON.stringify(other.body).slice(0,120));

  // ---- 3. 仕掛の一覧の道（予定の行を通らない開始）も止まる ----
  await page.evaluate(lot=>{WL.records.openMeasurement({'ロット番号':lot,'鋳造番号':'C'+lot.slice(1),'BOX設計_設備名':'テスト設備A'})},third.lotNo);
  await W.until(page,()=>{const m=document.getElementById('appConfirmModal');return !!m&&!m.hidden},null,{ms:20000,what:'断りの窓'});
  const refuse=await page.evaluate(()=>({title:document.getElementById('appConfirmTitle').textContent,
   body:document.getElementById('appConfirmBody').textContent,ok:document.getElementById('appConfirmOk').textContent}));
  rec('3: 開く前に断り、理由と次の一手「作業スケジュールを開く」を出す',
      /まだ開始できません/.test(refuse.title)&&refuse.body.includes(top.lotNo)&&refuse.ok==='作業スケジュールを開く',
      JSON.stringify(refuse).slice(0,220));
  await page.click('#appConfirmCancel');
  rec('3: 測定画面は開かない',await page.evaluate(()=>document.getElementById('measureModal').hidden));

  // ---- 4. 一番上から開始する ----
  await page.click('.sc-row-strict-top .sc-row-start');
  await W.until(page,()=>!document.querySelector('#measureModal')?.hidden&&typeof S!=='undefined'&&!!S.measure,null,{ms:25000,what:'測定画面'});
  rec('4: 一番上のロットは「開始」で測定画面が開く',true);
  const after=await plan();
  const t2=after.find(e=>e.id===top.id),s2=after.find(e=>e.id===add.body.id);
  rec('M3: 開始判定が予定に残り、測定の時刻が無くても作業中',!!t2&&t2.state==='着手'&&!!t2.startFlag&&t2.startFlag.by==='tester',
      JSON.stringify(t2&&{state:t2.state,flag:t2.startFlag}));
  const left=after.filter(e=>e.kind==='設備停止'&&!e.parentId&&after.indexOf(e)<after.indexOf(t2)
                        &&e.state!=='取消'&&!((e.actual||{}).startAt));
  rec(`M2: 開始したロットより上で実際の時刻が無い設備停止 0（前 1）——今は ${left.length}`,!left.length,
      JSON.stringify(left.map(e=>e.title)));
  rec('4: 上の設備停止は完了・出どころ「開始で自動」',!!s2&&s2.state==='完了'&&(s2.actual||{}).source==='開始で自動',
      JSON.stringify(s2&&{state:s2.state,actual:s2.actual}).slice(0,220));
  const next=await post('/api/schedule/plan/start',{equipment:EQ,id:works[1].id});
  rec('4: 作業中のロットがあるあいだは次のロットも開始できない（理由は「作業中」・並べ替えに行かせない）',
      next.status===409&&next.body.code==='busy'&&next.body.error.includes(top.lotNo+' が作業中')&&!/並べ替え/.test(next.body.error),
      JSON.stringify(next.body).slice(0,200));
  rec('JSエラーが出ていない',!errs.length,errs.slice(0,2).join(' / '));
 }finally{
  await setRunMode('normal');
  await post('/api/access-mode',{mode:'schedule'});
  for(const id of made)await post('/api/schedule/plan/delete',{equipment:EQ,id});
  if(stopId)await post('/api/schedule/stop-reason-master/delete',{id:stopId});
  await post('/api/access-mode',{mode:'edit'});
 }
},{viewport:{width:1728,height:1030}});
