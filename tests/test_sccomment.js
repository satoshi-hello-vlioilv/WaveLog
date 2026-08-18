/* test_sccomment.js: 申し送り（コメント）を予定へ挟む（§9.189）
   ------------------------------------------------------------
   利用者の指示「コメント用の欄、コメントもできるものを設備停止のように
   追加できるようにしてください」。

   設備停止と同じ入口・同じ差し込み位置の決まり（§9.179）で足せるが、
   **時間は取らない**——申し送りを1行入れるたびに後ろの予定が押されるので
   あれば、書く気が失せる。ここで固定するのは:
    1. 予定の列へ挟めること（時間は0分）
    2. **後ろの予定の時刻が動かないこと**（これが設備停止との違い）
    3. 区分が「コメント」で、中身がそのまま出ること
    4. 紙には**横いっぱいの1行**で出ること（列に押し込むと読めない）
    5. 空のまま入れられないこと */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const API='http://127.0.0.1:5029';
const EQ='テスト設備A';
const TEXT='刃を交換すること_'+Date.now();

let b=null;
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 page.on('pageerror',e=>console.log('[pageerror]',e.message));
 const setMode=m=>page.evaluate(async mm=>{await fetch('/api/access-mode',{method:'POST',
   headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:mm})})},m);
 let made=null;
 try{
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.evaluate(e=>{localStorage.setItem('AccessMeasurementConfiguredEquipment',e);
                          localStorage.setItem('AccessMeasurementUserId','tester')},EQ);
  await setMode('schedule');
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-board-row',{timeout:25000});
  await page.evaluate(e=>{const r=[...document.querySelectorAll('.sc-board-row')]
    .find(x=>x.dataset.equipment===e);if(r)r.click()},EQ);
  await page.waitForSelector('.sc-row-line',{timeout:30000});
  await page.waitForFunction(()=>(WL.scheduleView?.entries?.()||[]).length>0,null,{timeout:30000});

  /* ---- 0) 入口は設備停止のとなり ---- */
  const btn=await page.evaluate(()=>{
   const el=document.getElementById('scCommentBtn'),stop=document.getElementById('scStopModalBtn');
   return el?{hidden:el.hidden,text:el.textContent.trim(),
              となり:!!stop&&stop.nextElementSibling===el}:null;
  });
  rec('コメントの入口が設備停止のとなりにある',btn&&!btn.hidden&&btn.となり,JSON.stringify(btn));

  /* ---- 1) 時間を取らない ----
     **時刻そのものを前後で比べないこと**——予定は「今」から並べ直すので、
     秒が進むだけで全部の時刻が変わる（それで落ちた）。確かめたいのは
     「コメントが時間を食っていないこと」なので、**同じ展開結果の中で**
     コメントの時刻と、その次に来る予定の開始時刻を突き合わせる。 */
  await page.click('#scCommentBtn');
  await page.waitForSelector('#scCommentText',{timeout:8000});
  await page.fill('#scCommentText',TEXT);
  await page.click('#appConfirmOk');
  await page.waitForFunction(()=>(WL.scheduleView.entries()||[]).some(e=>e.kind==='コメント'&&!e.__pending),
    null,{timeout:20000});
  await page.waitForTimeout(1200);
  const after=await page.evaluate(t=>{
   const list=WL.scheduleView.entries()||[];
   const i=list.findIndex(x=>x.kind==='コメント'&&x.title===t);
   const e=i<0?null:list[i];
   /* コメントの次に来る「時間を持つ予定」。 */
   const next=list.slice(i+1).find(x=>x.kind!=='コメント'&&x.state==='予定'&&x.plannedStart);
   return {entry:e?{id:e.id,est:e.estimate&&e.estimate.minutes,start:e.plannedStart,
                    end:e.plannedEnd,state:e.state}:null,
           next:next?{id:next.id,start:next.plannedStart}:null};
  },TEXT);
  made=after.entry&&after.entry.id;
  rec('予定の列へ挟める',!!after.entry,JSON.stringify(after.entry));
  rec('時間は0分（場所だけ取る）',after.entry&&after.entry.est===0,String(after.entry&&after.entry.est));
  rec('時刻を持つ（どこに挟まったか分かる）',!!(after.entry&&after.entry.start));
  rec('始まりと終わりが同じ（幅を持たない）',
      after.entry&&after.entry.start===after.entry.end,
      `${after.entry&&after.entry.start} 〜 ${after.entry&&after.entry.end}`);
  rec('次の予定はコメントと同じ時刻から始まる（時間を食わない）',
      !after.next||after.next.start===after.entry.start,
      `コメント ${after.entry&&after.entry.start} / 次 ${after.next&&after.next.start}`);

  /* ---- 2) 画面の見え方 ---- */
  const row=await page.evaluate(t=>{
   const r=[...document.querySelectorAll('.sc-row-line')].find(x=>x.innerText.includes(t));
   if(!r)return null;
   const cat=r.querySelector('[data-col="__cat__"]');
   return {cat:cat?cat.textContent.trim():'',text:r.innerText.replace(/\s+/g,' ').slice(0,60),
           消せる:!!r.querySelector('.sc-row-delete'),
           開始ボタン:!!r.querySelector('.sc-row-start')};
  },TEXT);
  rec('区分は「コメント」',row&&/コメント/.test(row.cat),row?row.cat:'なし');
  rec('中身がそのまま出る',row&&row.text.includes(TEXT.slice(0,10)),row?row.text:'なし');
  rec('消せる（入れ間違えても戻せる）',!!(row&&row.消せる));
  rec('作業の「開始」は出さない',!!row&&!row.開始ボタン);

  /* ---- 3) 紙では横いっぱいの1行 ---- */
  await page.evaluate(()=>WL.schedulePrint.openPreview('テスト設備A'));
  await page.waitForSelector('#schedulePrintPreview:not([hidden])',{timeout:10000});
  await page.waitForFunction(()=>document.querySelectorAll('.sp-pv-sheet').length>0,null,{timeout:20000});
  await page.waitForTimeout(500);
  const paper=await page.evaluate(t=>{
   const tr=[...document.querySelectorAll('.sp-row-comment')].find(x=>x.innerText.includes(t));
   if(!tr)return null;
   const td=tr.querySelector('td');
   const cols=tr.closest('table').querySelectorAll('thead th').length;
   return {span:Number(td.getAttribute('colspan')||0),cols,text:td.innerText.trim().slice(0,40)};
  },TEXT.slice(0,10));
  rec('紙には横いっぱいの1行で出る',paper&&paper.span===paper.cols&&paper.span>1,JSON.stringify(paper));
  await page.evaluate(()=>WL.schedulePrint.closePreview());

  /* ---- 4) 空のままは入れられない ---- */
  await page.click('#scCommentBtn');
  await page.waitForSelector('#scCommentText',{timeout:8000});
  const n0=await page.evaluate(()=>(WL.scheduleView.entries()||[]).filter(e=>e.kind==='コメント').length);
  await page.click('#appConfirmOk');
  await page.waitForTimeout(1200);
  const n1=await page.evaluate(()=>(WL.scheduleView.entries()||[]).filter(e=>e.kind==='コメント').length);
  rec('空のままでは入らない',n0===n1,`${n0} → ${n1}`);
 }catch(e){
  console.error('FATAL',e);rec('例外なく終わる',false,e.message);
 }finally{
  /* **後始末**: 入れたコメントを消す(残すと後続のテストの件数が合わない)。 */
  try{if(made)await page.evaluate(async id=>{
   await fetch('/api/schedule/plan/delete',{method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({id,user_id:'tester'})});
  },made)}catch(_){}
  try{await setMode('edit')}catch(_){}
  if(b)await b.close().catch(()=>{});
 }
 console.log('\n=== SUMMARY ===');
 const ng=R.filter(x=>!x.ok);console.log(`${R.length-ng.length}/${R.length} passed`);
 ng.forEach(x=>console.log(' -',x.n,x.d||''));
 process.exit(ng.length?1:0);
})();
