/* test_scscrollkeep.js: 予定へ入れても・読み直しても、表のスクロールの位置を動かさない（§9.640）

   ============================================================
   利用者の報告
   ------------------------------------------------------------
   「作業スケジュールのロット追加や設備停止の追加の際に問題なく指定の個所にスケジュールを組み込むことが
    できるようになりましたが、反映されるたびにスクロールの位置が戻されるので使いづらいです。スクロールの位置を
    変えないように修正をお願いします。」

   物差し（**直す前にも同じ物差しで測った**・前の値は §9.640 の決定記録）:
    表を途中までスクロールし、見えている最初の行（目印）の器の上端からの位置を控える。
    K1 見えている行の前へ設備停止を落とす → 落とした直後・反映のあと、目印の位置が動かないか
    K2 同じくロットを落とす
    K3 「再読込」で読み直しても動かないか（真ん中まで送った表）
    K4 いちばん下まで送った表で、見えている行の前へ設備停止を落としても・読み直しても動かないか
       （描き直しの途中で末尾の余白を測り直すと、そこで位置が切り詰められる）
    K5 人と同じ道: 行と行の境目をマウスで押して設備停止の窓を開き、停止内容を選んで「追加」を押す（直す前は 554px→0）
    K6 人と同じ道: 境目をダブルクリックして仕掛一覧の窓を開き、ロットをダブルクリックで入れる
   目印より下へ入れるので、目印が動く理由は無い。許す差は 2px（丸め）。
   ============================================================ */
'use strict';
const {run}=require('./lib/harness.js');
const EQ='テスト設備A';
const TOL=2;

run('test_scscrollkeep: 予定へ入れてもスクロールの位置を動かさない（§9.640）', async ({page,rec,B,W,idle,setMode})=>{
 const made=[];
 const post=(p,b)=>page.evaluate(([p,b])=>fetch(p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}).then(r=>r.json()),[p,b]);
 const planEntries=()=>page.evaluate(e=>fetch('/api/schedule/plan?equipment='+encodeURIComponent(e)+'&history=all').then(r=>r.json()).then(j=>j.entries||[]),EQ);
 const settle=async()=>{
  await W.until(page,()=>![...document.querySelectorAll('#scTimeline .sc-row-line')].some(r=>/^tmp-/.test(r.dataset.id)),null,{ms:30000,what:'楽観の行が本物になる'});
  await idle(400,20000);
 };
 /* 表を真ん中あたりまで送り、見えている最初の行（目印）と、その3行下（落とす相手）を返す。 */
 const scrollMid=(bottom)=>page.evaluate(bottom=>{
  const tl=document.getElementById('scTimeline');
  const rows=[...tl.querySelectorAll('.sc-row-line')].filter(r=>!r.closest('.sc-child-rows'));
  tl.scrollTop=Math.round((tl.scrollHeight-tl.clientHeight)/2);
  const t=tl.getBoundingClientRect().top;
  /* いちばん下: 最後の行が器の6割の高さに来るまで送る（下は末尾の余白＝描き直しで測り直す所）。 */
  if(bottom)tl.scrollTop+=Math.round(rows[rows.length-1].getBoundingClientRect().top-t-tl.clientHeight*0.6);
  const i=rows.findIndex(r=>r.getBoundingClientRect().top>=t+40);
  const t3=bottom?rows[rows.length-1]:rows[i+3];
  const a=rows[i]&&rows[i].getBoundingClientRect();
  return {hover:a?{x:Math.round(a.left+a.width/2),y:Math.round(a.top+a.height/2)}:null,top:tl.scrollTop,max:tl.scrollHeight-tl.clientHeight,anchor:rows[i]&&rows[i].dataset.id,target:t3&&t3!==rows[i]?t3.dataset.id:null};
 },!!bottom);
 /* 目印の行の、器の上端からの位置（px）。 */
 /* 人と同じく、カーソルは表の上にある（押した・落とした後もそこに残る）。 */
 const hover=async m=>{if(m.hover)await page.mouse.move(m.hover.x,m.hover.y)};
 const anchorAt=id=>page.evaluate(id=>{
  const tl=document.getElementById('scTimeline');
  const r=tl.querySelector(`.sc-row-line[data-id="${id}"]`);
  return r?Math.round(r.getBoundingClientRect().top-tl.getBoundingClientRect().top):null;
 },id);
 const drop=(id,kind,stop)=>page.evaluate(([id,kind,stop])=>{
  const row=document.querySelector(`#scTimeline .sc-row-line[data-id="${id}"]`);
  if(!row)return 'no-row';
  const y=row.getBoundingClientRect().top+3,panel=document.getElementById('schedulePanel'),dt=new DataTransfer();
  if(kind==='lot')window.__scDragRows=[window.__pickLot];else window.__scDragStopReason=stop;
  panel.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,clientY:y,dataTransfer:dt}));
  panel.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,clientY:y,dataTransfer:dt}));
  return 'ok';
 },[id,kind,stop]);
 try{
  await page.setViewportSize({width:1536,height:760});
  await setMode('schedule');
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await W.booted(page);
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-board-row',{timeout:25000});
  await page.evaluate(e=>{const r=[...document.querySelectorAll('.sc-board-row')].find(x=>x.dataset.equipment===e);if(r)r.click()},EQ);
  await page.waitForSelector('.sc-row-line',{timeout:30000});
  await idle(400,25000);
  const stops=await page.evaluate(e=>fetch('/api/schedule/stop-reason-master?equipment='+encodeURIComponent(e)).then(r=>r.json()),EQ);
  const stopRow=(stops.items||[]).find(s=>s&&s.id)||null;
  const stop=stopRow?{id:stopRow.id,name:stopRow.name}:null;
  const m0=await scrollMid();
  rec('材料: 表がスクロールできる・停止内容がある',m0.max>200&&!!m0.anchor&&!!m0.target&&!!stop,JSON.stringify(m0));
  for(const [kind,bottom] of [['stop',false],['lot',false],['stop',true]]){
   const m=await scrollMid(bottom);
   await hover(m);
   const at0=await anchorAt(m.anchor);
   if(kind==='lot'){
    const inPlan=new Set((await planEntries()).map(e=>String(e.lotNo||'')));
    await page.evaluate(([eq,has])=>{
     window.__pickLot=(S.rows||[]).find(r=>WL.base.equipmentIsInDesignCourse(eq,pick(r,'equipment'))&&!has.includes(String(pick(r,'lotNo')))&&!WL.split.hasSplit(r));
    },[EQ,[...inPlan]]);
   }
   const before=new Set((await planEntries()).map(e=>String(e.id)));
   const r0=await drop(m.target,kind,stop);
   if(kind==='stop'){
    await page.waitForSelector('#scSpGo',{state:'attached',timeout:10000});
    await page.evaluate(()=>document.getElementById('scSpGo')?.click());
   }
   const atOpt=await anchorAt(m.anchor);
   await settle();
   const atDone=await anchorAt(m.anchor);
   if(kind==='stop')await page.evaluate(()=>{const c=document.querySelector('#closeStopPicker,#scStopClose,[data-sc-stop-close]');if(c)c.click()});
   (await planEntries()).filter(e=>!before.has(String(e.id))&&e.parentId==null).forEach(e=>made.push(String(e.id)));
   const name=bottom?'K4 いちばん下まで送った表で設備停止':kind==='stop'?'K1 設備停止':'K2 ロット';
   rec(`${name}を見えている行の前へ落としても、目印の行の位置が動かない（落とした直後・反映のあと）`,
     r0==='ok'&&at0!=null&&Math.abs(atOpt-at0)<=TOL&&Math.abs(atDone-at0)<=TOL,
     JSON.stringify({anchor:m.anchor,target:m.target,at0,atOpt,atDone,scrollTop0:m.top}));
  }
  /* ---- K5・K6: 人と同じ道（マウスで境目を押す） ---- */
  await page.evaluate(e=>{localStorage.setItem('AccessMeasurementConfiguredEquipment',e);
   localStorage.setItem('scLayoutPrefsV1',JSON.stringify({swap:false,open:'schedule',insert:'tip'}));
   localStorage.removeItem('scSplitListCollapsedV1')},EQ);
  await page.reload({waitUntil:'domcontentloaded'});await W.booted(page);
  await W.openSchedule(page,EQ);
  const gapAt=async m=>{
   const b=await page.evaluate(id=>{const r=document.querySelector(`#scTimeline .sc-row-line[data-id="${id}"]`).getBoundingClientRect();
     return {x:r.x+r.width*0.4,y:r.top}},m.target);
   await page.mouse.move(b.x,b.y+20);await W.paint(page);
   await page.mouse.move(b.x,b.y);await W.paint(page);
   await W.until(page,id=>(document.querySelector('#scInsertGhost')||{dataset:{}}).dataset.beforeId===String(id),m.target,{ms:5000,what:'行間の線が出る'});
  };
  for(const kind of ['stop','lot']){
   const m=await scrollMid(false);
   await W.settle(page);
   const at0=await anchorAt(m.anchor);
   const before=new Set((await planEntries()).map(e=>String(e.id)));
   await gapAt(m);
   if(kind==='stop'){
    await page.click('#scInsertGhost .sc-insert-line');
    await W.until(page,()=>document.querySelector('#scStopModal')?.hidden===false,null,{ms:8000,what:'停止の窓'});
    await page.click('#scStopModal .sc-stop-button');
    await W.until(page,()=>{const g=document.getElementById('scSpGo');return !!g&&!g.disabled},null,{ms:8000,what:'追加が押せる'});
    await page.click('#scSpGo');
   }else{
    await page.dblclick('#scInsertGhost .sc-insert-line');
    await W.until(page,()=>document.querySelector('#scListModal')?.hidden===false,null,{ms:8000,what:'仕掛一覧の窓'});
    await page.waitForSelector('#scListModal #grid tbody tr',{timeout:20000});
    await page.evaluate(eq=>{
     const ok=v=>(S.rows||[]).some(r=>String(pick(r,'lotNo'))===v&&WL.base.equipmentIsInDesignCourse(eq,pick(r,'equipment'))&&!WL.split.hasSplit(r));
     for(const tr of document.querySelectorAll('#scListModal #grid tbody tr')){const c=tr.querySelector('[data-col="ロット番号"]');
      if(c&&ok(c.textContent.trim())){tr.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));return}}
    },EQ);
   }
   const atOpt=await anchorAt(m.anchor);
   await W.poll(()=>planEntries(),x=>x.length>before.size,15000);
   await settle();
   const atDone=await anchorAt(m.anchor);
   await page.evaluate(()=>{document.querySelector('#scStopModalClose')?.click();document.querySelector('#scListModalClose')?.click()});
   await W.settle(page);
   const atClose=await anchorAt(m.anchor);
   (await planEntries()).filter(e=>!before.has(String(e.id))&&e.parentId==null).forEach(e=>made.push(String(e.id)));
   rec(`${kind==='stop'?'K5 境目を押して設備停止の「追加」':'K6 境目をダブルクリックしてロットを入れる'}でも、目印の行の位置が動かない（押した直後・反映のあと・窓を閉じたあと）`,
     at0!=null&&[atOpt,atDone,atClose].every(v=>v!=null&&Math.abs(v-at0)<=TOL),
     JSON.stringify({anchor:m.anchor,target:m.target,at0,atOpt,atDone,atClose,scrollTop0:m.top}));
  }
  for(const bottom of [false,true]){
   /* 1回では起きないことがある（描き直しの途中で測る物が入るかどうかで変わる）ので3回読み直して全部を見る。 */
   const seen=[];
   for(let k=0;k<3;k++){
    const m=await scrollMid(bottom);
    const at0=await anchorAt(m.anchor);
    await page.evaluate(()=>document.getElementById('scRefresh')?.click());
    await hover(m);
    await idle(600,20000);
    seen.push({anchor:m.anchor,at0,at1:await anchorAt(m.anchor)});
   }
   rec(`${bottom?'K4 いちばん下まで送った表を':'K3 '}「再読込」で3回読み直しても、目印の行の位置が動かない`,
     seen.every(x=>x.at0!=null&&Math.abs(x.at1-x.at0)<=TOL),JSON.stringify(seen));
  }
 }finally{
  for(const id of made)await post('/api/schedule/plan/delete',{id}).catch(()=>{});
  await setMode('edit');
 }
});
