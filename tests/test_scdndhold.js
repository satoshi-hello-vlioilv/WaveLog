/* test_scdndhold.js: 運んだ行が、運んだ位置に留まり続ける（§9.613）
   ============================================================
   利用者の報告「ドラッグした位置に入らず、一番上に入る、位置を調整しても戻る。
   戻らない時もあるし不安定」。本物のマウスで運び、**離したあと 100ms ごとに並びを
   控えて**「狙った位置にいた割合」を数える（1回だけ見る網は、戻ってまた来る形を見逃す）。

   直す前の実測（同じ物差し）:
     書込中に描き直しが入る … 留まる割合 76%（1.5秒戻った）
     読み直しが書く前の並びを返す（書込役への中継・Box の同期待ち）… 8%・戻ったまま
     その古い並びを土台に次を運ぶ … サーバーが「掴む前の並びが違う」で断り、戻る
   ここで固定すること:
     1. 書込の応答と予定の読みが共有の改訂番号を持つ（`revision`）
     2. 書込が残っている間に出した読みは当てない（書込中に描き直しても戻らない）
     3. 書いた番号より古い写しの読みは当てず、追いついてから当てる
     4. 仕掛一覧から落として差し込んだ行も、古い読みで消えない
   ============================================================ */
'use strict';
const {run}=require('./lib/harness.js');
const EQ='テスト設備A';
run('test_scdndhold: 運んだ行が、運んだ位置に留まり続ける（§9.613）',async({page,rec,W,idle,paint,setMode,errs})=>{
 await setMode('schedule');
 await page.goto('http://127.0.0.1:5029/',{waitUntil:'domcontentloaded'});
 await page.evaluate(e=>{localStorage.setItem('AccessMeasurementConfiguredEquipment',e);localStorage.setItem('AccessMeasurementUserId','tester')},EQ);
 await page.reload({waitUntil:'domcontentloaded'});
 await W.booted(page);
 await W.openSchedule(page,EQ);
 await idle();

 /* 応答をいじる口: 書込を遅らせる／書いたあとの読みに「書く前の応答」を返す（共有の同期待ちの再現）。 */
 const ctl={postDelay:0,staleBody:null,staleFor:0,staleUntil:0,served:0};
 await page.route(/\/api\/schedule\/plan\/(reorder|add|batch)$/,async r=>{
  /* 固定待ち: 書込が遅い共有（ロックの確かめ待ち）の再現。遅らせる時間そのものが検証の材料 */
  if(ctl.postDelay)await new Promise(z=>setTimeout(z,ctl.postDelay));
  const resp=await r.fetch();
  if(ctl.staleFor)ctl.staleUntil=Date.now()+ctl.staleFor;
  await r.fulfill({response:resp});
 });
 await page.route(/\/api\/schedule\/plan\?/,r=>(ctl.staleBody&&Date.now()<ctl.staleUntil)
  ?(ctl.served++,r.fulfill({status:200,contentType:'application/json',body:ctl.staleBody})):r.continue());
 const reset=()=>{ctl.postDelay=0;ctl.staleBody=null;ctl.staleFor=0;ctl.staleUntil=0};
 const planNow=()=>page.evaluate(async e=>await (await fetch('/api/schedule/plan?equipment='+encodeURIComponent(e)+'&_='+Date.now())).json(),EQ);
 const ids=()=>page.$$eval('#scTimeline .sc-row-line[draggable="true"]',n=>n.map(x=>x.dataset.id));
 const srvIds=async()=>((await planNow()).entries||[]).filter(x=>x.reorderable).map(x=>String(x.id));
 const rect=i=>page.evaluate(i=>{const el=document.querySelector(`#scTimeline .sc-row-line[data-id="${i}"]`);
  if(!el)return null;const r=el.getBoundingClientRect();return {x:r.x+Math.min(200,r.width/2),y:r.y+r.height/2,h:r.height}},i);
 /* 2つの行が両方見えるように送ってから、本物のマウスで運ぶ（上半分へ落とす＝その行の前）。 */
 async function drag(src,dst){
  await page.evaluate(([a,b])=>{const A=document.querySelector(`#scTimeline .sc-row-line[data-id="${a}"]`),B=document.querySelector(`#scTimeline .sc-row-line[data-id="${b}"]`);
   A.scrollIntoView({block:'center'});let p=A.parentElement;while(p&&p.scrollHeight<=p.clientHeight+2)p=p.parentElement;
   if(p){const ra=A.getBoundingClientRect(),rb=B.getBoundingClientRect();p.scrollTop+=((ra.top+rb.top)/2)-(p.getBoundingClientRect().top+p.clientHeight/2)}},[src,dst]);
  await paint();
  const a=await rect(src);
  await page.mouse.move(a.x,a.y);await page.mouse.down();
  await page.mouse.move(a.x,a.y+4,{steps:2});
  let b=await rect(dst);
  await page.mouse.move(b.x+10,b.y-b.h*0.3,{steps:15});
  b=await rect(dst);
  await page.mouse.move(b.x+12,b.y-b.h*0.3,{steps:2});
  await page.mouse.up();
 }
 /* 離したあとの並びを画面の中で 100ms ごとに控える（Node 側で待たずに数える）。 */
 const startSampling=(want,key)=>page.evaluate(([w,k])=>{
  window.__hold={n:0,ok:0,flips:0,last:null};
  const tick=()=>{const rows=[...document.querySelectorAll('#scTimeline .sc-row-line')];
   const ok=k.lot?(()=>{const i=rows.findIndex(r=>(r.textContent||'').includes(k.lot));const j=rows.findIndex(r=>r.dataset.id===k.before);return i>=0&&i===j-1})()
                 :JSON.stringify(rows.filter(r=>r.draggable).map(r=>r.dataset.id))===JSON.stringify(w);
   const h=window.__hold;h.n++;if(ok)h.ok++;if(h.last!==null&&h.last!==ok)h.flips++;h.last=ok};
  tick();window.__holdTimer=setInterval(tick,100)},[want,key]);
 const stopSampling=()=>page.evaluate(()=>{clearInterval(window.__holdTimer);return window.__hold});
 /* 場面ごとに開き直す（前の場面の書込の列・読み直しの待ちを持ち越さない）。 */
 const fresh=async()=>{reset();await page.reload({waitUntil:'domcontentloaded'});await W.booted(page);await W.openSchedule(page,EQ);await idle()};
 const want=(cur,src,dst)=>{const e=cur.filter(i=>i!==src);e.splice(e.indexOf(dst),0,src);return e};

 try{
  /* ---- 1) 改訂番号 ---- */
  const p0=await planNow();
  rec('予定の読みが改訂番号を持つ',Number.isFinite(Number(p0.revision)),String(p0.revision));
  {
   const cur=await ids();
   const r=await page.evaluate(async([e,o])=>{const x=await fetch('/api/schedule/plan/reorder',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({equipment:e,orderedIds:o.map(Number),user_id:'tester'})});return await x.json()},[EQ,cur]);
   rec('書込の応答が書いたあとの改訂番号を持つ',Number(r.revision)>Number(p0.revision),JSON.stringify({before:p0.revision,after:r.revision}));
   await page.evaluate(()=>WL.scheduleView.reloadPlan());await idle();
  }

  /* ---- 2) 書込中に描き直しても戻らない ---- */
  {
   const cur=await ids();const src=cur[17],dst=cur[5],exp=want(cur,src,dst);
   ctl.postDelay=1800;
   await drag(src,dst);
   await startSampling(exp,{});
   /* 測定画面を閉じたときと同じ描き直し（書込の最中に起きる） */
   await page.evaluate(()=>WL.refreshScheduleIfOpen());
   await W.poll(srvIds,s=>JSON.stringify(s)===JSON.stringify(exp),15000);
   await idle();
   await page.waitForTimeout(2500);   // 固定待ち: 書込が終わったあとの読み直しでも戻らないことを見る時間そのものが材料（読み直しは0.6〜2秒で来る）
   const h=await stopSampling();reset();
   rec('書込中に描き直しても、運んだ位置に留まる（割合100%）',h.ok===h.n&&h.n>20,JSON.stringify(h));
   rec('書込が届いたあとも、画面とサーバーが運んだ並び',JSON.stringify(await ids())===JSON.stringify(exp)&&JSON.stringify(await srvIds())===JSON.stringify(exp),'');
  }

  /* ---- 3) 書いたあとの読みが書く前の並びを返しても戻らない（共有の同期待ち） ---- */
  {
   await fresh();
   const cur=await ids();const src=cur[20],dst=cur[4],exp=want(cur,src,dst);
   ctl.staleBody=JSON.stringify(await planNow());ctl.staleFor=4000;
   await drag(src,dst);
   await startSampling(exp,{});
   await W.until(page,()=>!document.querySelector('.sc-row-pending'),null,15000);
   await page.waitForTimeout(5500);   // 固定待ち: 古い読みを返す4秒のあいだ（とそのあとの読み直し）に戻らないことを見る時間そのものが材料
   const h=await stopSampling();reset();
   await idle();
   rec('古い読みが返っても、運んだ位置に留まる（割合100%）',h.ok===h.n&&h.n>30,JSON.stringify(h));
   rec('追いついたあと、画面とサーバーが運んだ並び',JSON.stringify(await ids())===JSON.stringify(exp)&&JSON.stringify(await srvIds())===JSON.stringify(exp),'');
   /* 続けてもう1回運べる（古い並びを土台にして「ほかの端末が先に並べ替えました」で断られない） */
   const cur2=await ids();const s2=cur2[25],d2=cur2[9],exp2=want(cur2,s2,d2);
   await drag(s2,d2);
   const got=await W.poll(srvIds,s=>JSON.stringify(s)===JSON.stringify(exp2),15000);
   rec('続けて運んでも断られず、その並びになる',JSON.stringify(got)===JSON.stringify(exp2),'');
  }

  /* ---- 4) 仕掛一覧から差し込んだ行も、古い読みで消えない ---- */
  {
   await fresh();
   const cur=await ids();const dst=cur[8];
   await page.waitForSelector('#grid tbody tr[draggable="true"]',{timeout:15000});
   const tr=await page.evaluate(()=>{const t=[...document.querySelectorAll('#grid tbody tr[draggable="true"]')][0];t.scrollIntoView({block:'center'});
    const r=t.getBoundingClientRect();return {x:r.x+80,y:r.y+r.height/2,lot:(t.textContent||'').match(/L\d{4,}/)?.[0]||''}});
   await page.evaluate(b=>document.querySelector(`#scTimeline .sc-row-line[data-id="${b}"]`).scrollIntoView({block:'center'}),dst);
   await paint();
   ctl.staleBody=JSON.stringify(await planNow());ctl.served=0;
   await page.mouse.move(tr.x,tr.y);await page.mouse.down();await page.mouse.move(tr.x+10,tr.y+4,{steps:3});
   let b=await rect(dst);
   await page.mouse.move(b.x,b.y-b.h*0.3,{steps:20});b=await rect(dst);await page.mouse.move(b.x+3,b.y-b.h*0.3,{steps:2});
   /* 離した時から4秒は、予定の読みに「入れる前の応答」を返す（書込そのものより先に古い読みが来る形も含む） */
   ctl.staleUntil=Date.now()+4000;
   await page.mouse.up();
   await startSampling(null,{lot:tr.lot,before:dst});
   await page.waitForTimeout(5500);   // 固定待ち: 古い読みを返す4秒のあいだに、入れた行が消えないことを見る時間そのものが材料
   const h=await stopSampling();const served=ctl.served;reset();await idle();ctl.served=served;
   rec('差し込んだ行が、古い読みでも狙った行の前に出続ける（割合95%以上）',!!tr.lot&&h.ok/h.n>=0.95,JSON.stringify({lot:tr.lot,古い読み:ctl.served,...h}));
   /* 片付け: 入れた行を外す */
   await page.evaluate(async([e,lot])=>{const r=await (await fetch('/api/schedule/plan?equipment='+encodeURIComponent(e))).json();
    const x=(r.entries||[]).find(z=>z.lotNo===lot);
    if(x)await fetch('/api/schedule/plan/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:x.id,equipment:e,user_id:'tester'})})},[EQ,tr.lot]);
  }
  rec('JSエラーが出ていない',errs.length===0,errs.slice(0,3).join(' / '));
 }catch(e){rec('FATAL',false,String(e&&e.stack||e).slice(0,400))}
},{viewport:{width:1728,height:1152}});
