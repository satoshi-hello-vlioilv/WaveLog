/* test_scinsertpos.js: 予定へ行と行のあいだに落とした物が、狙った位置に入る（§9.638）

   ============================================================
   利用者の報告
   ------------------------------------------------------------
   「以前治してもらったはずのスケジュールにロットや設備停止など登録する際に位置が狙い通りに入らず
    ズレたり一番下に入る現象が発生しており直っていないようです。原因調査分析し修正をお願いいたします」

   物差し（**直す前にも同じ物差しで測った**・前の値は §9.638 の決定記録）:
    P1. 落とした直後（楽観描画）に、狙った行のすぐ前に出るか
    P2. 書込のあと、サーバーの予定でも狙った行のすぐ前にあるか
    P3. 読み直した画面でも狙った行のすぐ前にあるか
   狙う行は「予定」の先頭・真ん中・最後の3つ × 物（ロット・設備停止）で6回。
   ============================================================ */
'use strict';
const {run}=require('./lib/harness.js');
const EQ='テスト設備A';

run('test_scinsertpos: 落とした位置に入る（§9.638）', async ({page,rec,B,W,idle,setMode})=>{
 const made=[];
 const post=(p,b)=>page.evaluate(([p,b])=>fetch(p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}).then(r=>r.json()),[p,b]);
 const planEntries=()=>page.evaluate(e=>fetch('/api/schedule/plan?equipment='+encodeURIComponent(e)+'&history=all').then(r=>r.json()).then(j=>j.entries||[]),EQ);
 /* 画面の行の並び（親の行だけ）。 */
 const domIds=()=>page.evaluate(()=>[...document.querySelectorAll('#scTimeline .sc-row-line')].map(r=>r.dataset.id));
 /* サーバーの予定の並び（動かせる予定だけ・サーバーが返す順＝表示順）。 */
 const serverPlanIds=async()=>(await planEntries()).filter(e=>e.parentId==null&&e.state==='予定').map(e=>String(e.id));
 const settle=async()=>{
  await W.until(page,()=>![...document.querySelectorAll('#scTimeline .sc-row-line')].some(r=>/^tmp-/.test(r.dataset.id)),null,{ms:30000,what:'楽観の行が本物になる'});
  await idle(400,20000);
 };
 try{
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
  rec('材料: 設備停止の停止内容がある',!!stop,JSON.stringify(stopRow).slice(0,120));
  const cases=[];
  for(const kind of ['lot','stop']){
   for(const where of ['first','mid','last']){
    const plan=await serverPlanIds();
    const dom=(await domIds()).filter(id=>plan.includes(id));
    const target=where==='first'?dom[0]:where==='last'?dom[dom.length-1]:dom[Math.floor(dom.length/2)];
    let lotNo='';
    if(kind==='lot'){
     const inPlan=new Set((await planEntries()).map(e=>String(e.lotNo||'')));
     const pickd=await page.evaluate(([eq,has])=>{
      const r=(S.rows||[]).find(r=>WL.base.equipmentIsInDesignCourse(eq,pick(r,'equipment'))&&!has.includes(String(pick(r,'lotNo')))&&!WL.split.hasSplit(r));
      return r?String(pick(r,'lotNo')):'';
     },[EQ,[...inPlan]]);
     lotNo=pickd;
     await page.evaluate(lot=>{window.__pickLot=(S.rows||[]).find(r=>String(pick(r,'lotNo'))===lot)},lotNo);
    }
    const before=new Set((await planEntries()).map(e=>String(e.id)));
    const r0=await page.evaluate(([id,kind,stop])=>{
     const row=document.querySelector(`#scTimeline .sc-row-line[data-id="${id}"]`);
     if(!row)return 'no-row';
     row.scrollIntoView({block:'center'});
     const y=row.getBoundingClientRect().top+3;
     const panel=document.getElementById('schedulePanel');
     if(kind==='lot')window.__scDragRows=[window.__pickLot];
     else window.__scDragStopReason=stop;
     const dt=new DataTransfer();
     panel.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,clientY:y,dataTransfer:dt}));
     panel.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,clientY:y,dataTransfer:dt}));
     return 'ok';
    },[target,kind,stop]);
    if(kind==='stop'){
     await page.waitForSelector('#scSpGo',{state:'attached',timeout:10000});
     await page.evaluate(()=>document.getElementById('scSpGo')?.click());
     await page.evaluate(()=>{const c=document.querySelector('#closeStopPicker,#scStopClose,[data-sc-stop-close]');if(c)c.click()});
    }
    /* P1: 楽観描画（書込より前に描いた行）。tmp- の行が狙った行のすぐ前か */
    const opt=await domIds();
    const tIdx=opt.indexOf(target);
    const p1=tIdx>0&&/^tmp-/.test(opt[tIdx-1]);
    await settle();
    const after=await planEntries();
    const added=after.filter(e=>!before.has(String(e.id))&&e.parentId==null).map(e=>String(e.id));
    added.forEach(id=>made.push(id));
    const sp=after.filter(e=>e.parentId==null&&e.state==='予定').map(e=>String(e.id));
    const p2=added.length===1&&sp.indexOf(added[0])===sp.indexOf(target)-1;
    /* P3: 読み直した画面（予定を開き直す） */
    await page.evaluate(e=>{const b=document.getElementById('scRefresh');if(b)b.click()},EQ);
    await idle(600,20000);
    const dom2=await domIds();
    const p3=added.length===1&&dom2.indexOf(added[0])===dom2.indexOf(target)-1;
    cases.push({kind,where,target,added,r0,p1,p2,p3,
      server:sp.slice(Math.max(0,sp.indexOf(target)-2),sp.indexOf(target)+1),
      dom:dom2.slice(Math.max(0,dom2.indexOf(target)-2),dom2.indexOf(target)+1)});
   }
  }
  /* ---- 現場で起きやすい条件（§9.638） ----
     S1 落としてから書くまでのあいだに、狙った行が始まった（ほかの端末・現場の「開始」）。
     S2 途中の行が作業中（次の1本は現場が自由に選ぶ・§9.339）。作業中の行の前後の予定へ落とす。
     S3 時刻を固定した行の前へ落とす。 */
  const ex={};
  /* S1（落としてから書くまでに狙った行が始まった）はサーバーの決め方だけで決まるので、純粋な網 test_scwriteback の W4 が見る。 */
  {
   const sp=await serverPlanIds();
   /* 次の1本は現場が自由に選ぶ（§9.339）——表示順で途中の行を先に流すことがある。 */
   const at=m=>{const d=new Date(Date.now()+m*60000);const z=n=>String(n).padStart(2,'0');
     return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`};
   /* 表示順で途中の行を、先に流して終えた（実際の時刻を入れた）。その行は完了の側へ移る。 */
   const st=await post('/api/schedule/plan/update',{id:sp[2],actualStart:at(-90),actualEnd:at(-60)});
   ex.started={ok:!!(st&&st.ok),err:st&&st.error};
  }
  await page.click('#scRefresh').catch(()=>{});await idle(600,20000);
  {
   /* S2: 作業中の行（S1で始めた行）が画面の上へ移っている。その下の予定の先頭・真ん中へ落とす。 */
   const sp=await serverPlanIds();
   for(const target of [sp[0],sp[Math.floor(sp.length/2)]]){
    const before=new Set((await planEntries()).map(e=>String(e.id)));
    await page.evaluate(([id,stop])=>{
     const row=document.querySelector(`#scTimeline .sc-row-line[data-id="${id}"]`);if(!row)return;
     row.scrollIntoView({block:'center'});
     const y=row.getBoundingClientRect().top+3,panel=document.getElementById('schedulePanel'),dt=new DataTransfer();
     window.__scDragStopReason=stop;
     panel.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,clientY:y,dataTransfer:dt}));
     panel.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,clientY:y,dataTransfer:dt}));
    },[target,stop]);
    await page.waitForSelector('#scSpGo',{state:'attached',timeout:10000});
    await page.evaluate(()=>document.getElementById('scSpGo')?.click());
    await settle();
    const after=await planEntries();
    const added=after.filter(e=>!before.has(String(e.id))&&e.parentId==null).map(e=>String(e.id));
    added.forEach(id=>made.push(id));
    const sp2=after.filter(e=>e.parentId==null&&e.state==='予定').map(e=>String(e.id));
    await page.click('#scRefresh').catch(()=>{});await idle(600,20000);
    const dom=await domIds();
    rec(`S2 表示順で途中の行を先に流した予定で（${ex.started.ok?'流した':'材料を作れず:'+ex.started.err}）、${target===sp[0]?'予定の先頭':'真ん中'}の前に入る（サーバーと画面）`,
        added.length===1&&sp2.indexOf(added[0])===sp2.indexOf(target)-1&&dom.indexOf(added[0])===dom.indexOf(target)-1,
        JSON.stringify({target,added,server:sp2.slice(Math.max(0,sp2.indexOf(target)-2),sp2.indexOf(target)+1),dom:dom.slice(Math.max(0,dom.indexOf(target)-2),dom.indexOf(target)+1)}));
   }
  }
  {
   /* S3: 時刻を固定した行の前。固定は「この時刻から始める」——前に入れたい物はその前に置ける。 */
   const plan=await planEntries();
   const sp=plan.filter(e=>e.parentId==null&&e.state==='予定');
   const f=sp[5];
   const at=f&&f.plannedStart?f.plannedStart:null;
   const u=await post('/api/schedule/plan/update',{id:f.id,fixedStart:at});
   await page.click('#scRefresh').catch(()=>{});await idle(600,20000);
   const before=new Set((await planEntries()).map(e=>String(e.id)));
   const hit=await page.evaluate(([id,stop])=>{
    const row=document.querySelector(`#scTimeline .sc-row-line[data-id="${id}"]`);if(!row)return 'no-row';
    row.scrollIntoView({block:'center'});
    const y=row.getBoundingClientRect().top+3,panel=document.getElementById('schedulePanel'),dt=new DataTransfer();
    window.__scDragStopReason=stop;
    panel.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,clientY:y,dataTransfer:dt}));
    const g=document.querySelector('.sc-insert-ghost,[data-before-id]');
    panel.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,clientY:y,dataTransfer:dt}));
    return g?g.dataset.beforeId||'':'(なし)';
   },[String(f.id),stop]);
   await page.waitForSelector('#scSpGo',{state:'attached',timeout:10000});
   await page.evaluate(()=>document.getElementById('scSpGo')?.click());
   await settle();
   const after=await planEntries();
   const added=after.filter(e=>!before.has(String(e.id))&&e.parentId==null).map(e=>String(e.id));
   added.forEach(id=>made.push(id));
   await page.click('#scRefresh').catch(()=>{});await idle(600,20000);
   const dom=await domIds();
   rec('S3 時刻を固定した行の上端へ落とすと、その行のすぐ前に入る',
       added.length===1&&dom.indexOf(added[0])===dom.indexOf(String(f.id))-1,
       JSON.stringify({fixed:f.id,fixOk:!!(u&&u.ok),ghostBefore:hit,added,dom:dom.slice(Math.max(0,dom.indexOf(String(f.id))-2),dom.indexOf(String(f.id))+2)}));
  }
  /* ---- H: さかのぼり「済んだ行を出さない」は、時刻の分からない完了（自動で完了した行など）も出さない ---- */
  {
   const sp=await serverPlanIds();
   const u=await post('/api/schedule/plan/update',{id:sp[sp.length-1],state:'完了'});   // 実績の時刻を持たない完了
   const shown=async key=>{
    await page.evaluate(k=>localStorage.setItem('ScheduleHistoryModeV1',k),key);
    await page.reload({waitUntil:'domcontentloaded'});await W.booted(page);
    await page.click('#openSchedule');
    await page.waitForSelector('.sc-board-row',{timeout:25000});
    await page.evaluate(e=>{const r=[...document.querySelectorAll('.sc-board-row')].find(x=>x.dataset.equipment===e);if(r)r.click()},EQ);
    await page.waitForSelector('.sc-row-line',{timeout:30000});await idle(400,20000);
    return page.evaluate(id=>!!document.querySelector(`#scTimeline .sc-row-line[data-id="${id}"]`),String(sp[sp.length-1]));
   };
   const inH8=await shown('h8'),inNone=await shown('none');
   rec('H さかのぼり「なし」では時刻の分からない完了も出さない（範囲を決めたときは出す）',
       !!(u&&u.ok)&&inH8===true&&inNone===false,JSON.stringify({update:u&&(u.ok||u.error),inH8,inNone}));
  }
  for(const c of cases){
   const name=`${c.kind==='lot'?'ロット':'設備停止'}・${({first:'先頭',mid:'真ん中',last:'最後'})[c.where]}の前`;
   rec(`P1 ${name}: 落とした直後に狙った行のすぐ前に出る`,c.p1,JSON.stringify(c));
   rec(`P2 ${name}: サーバーの予定でも狙った行のすぐ前`,c.p2,JSON.stringify(c));
   rec(`P3 ${name}: 読み直した画面でも狙った行のすぐ前`,c.p3,JSON.stringify(c));
  }
 }finally{
  for(const id of made)await post('/api/schedule/plan/delete',{id}).catch(()=>{});
  await setMode('edit');
 }
});
