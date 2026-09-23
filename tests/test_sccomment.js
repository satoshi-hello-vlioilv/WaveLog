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
    5. 空のまま入れられないこと（モーダルから入れる場合）

   §9.191（利用者の指示「D&Dでコメント枠だけ追加、コメントする場合は
   スケジュールに配置されたコメント欄をダブルクリックなどで編集モードに
   移行し入力したコメントを入力するように使う」）で足したぶん:
    6. 入口を**掴んで落とせる**こと。落とすと**中身は空のまま**枠が入る
       （先に枠を置いてから書く、というのがこの指示の中身）
    7. 置いた枠は**ダブルクリックでその場で書ける**こと（Enterで確定）
    8. **書いている最中は勝手に読み直さない**こと（10秒ごとの見張りに
       入力欄を消されると、書いている途中の文字が消える） */
'use strict';
const {run}=require('./lib/harness.js');
const API='http://127.0.0.1:5029';
const EQ='テスト設備A';
const TEXT='刃を交換すること_'+Date.now();

run('test_sccomment: 申し送り（コメント）を予定へ挟む（§9.189）', async ({page,rec,idle})=>{
 const setMode=m=>page.evaluate(async mm=>{await fetch('/api/access-mode',{method:'POST',
   headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:mm})})},m);
 let made=null;const extra=[];
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
    await idle();  // 書込のあとの予定の取り直し（時刻）が済むまで
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
  await idle();
  const paper=await page.evaluate(t=>{
   const tr=[...document.querySelectorAll('.sp-row-comment')].find(x=>x.innerText.includes(t));
   if(!tr)return null;
   const td=tr.querySelector('td');
   const cols=tr.closest('table').querySelectorAll('thead th').length;
   return {span:Number(td.getAttribute('colspan')||0),cols,text:td.innerText.trim().slice(0,40)};
  },TEXT.slice(0,10));
  rec('紙には横いっぱいの1行で出る',paper&&paper.span===paper.cols&&paper.span>1,JSON.stringify(paper));
  await page.evaluate(()=>WL.schedulePrint.closePreview());

  /* ---- 5) 枠だけ落として、その場で書く（§9.191） ---- */
  const drag=await page.evaluate(()=>{
   const btn=document.getElementById('scCommentBtn');
   btn.dispatchEvent(new DragEvent('dragstart',{dataTransfer:new DataTransfer(),
     bubbles:true,cancelable:true}));
   /* 掴んでいる印は画面の見え方で確かめる（内部の変数を覗かない）。 */
   const flag=btn.classList.contains('is-row-dragging');
   btn.dispatchEvent(new DragEvent('dragend',{dataTransfer:new DataTransfer(),bubbles:true}));
   return {draggable:btn.draggable,flag};
  });
  rec('コメントの入口は掴める（枠だけ置ける）',drag.draggable&&drag.flag,JSON.stringify(drag));

  const n2=await page.evaluate(()=>(WL.scheduleView.entries()||[]).filter(e=>e.kind==='コメント').length);
  await page.evaluate(()=>{
   const panel=document.querySelector('.sc-drop-target');
   const rows=[...document.querySelectorAll('.sc-row-line')];
   const box=rows[Math.min(1,rows.length-1)].getBoundingClientRect();
   const at={clientX:box.left+10,clientY:box.top+2};
   const btn=document.getElementById('scCommentBtn');
   btn.dispatchEvent(new DragEvent('dragstart',{dataTransfer:new DataTransfer(),bubbles:true,cancelable:true}));
   panel.dispatchEvent(new DragEvent('dragover',{dataTransfer:new DataTransfer(),bubbles:true,cancelable:true,...at}));
   panel.dispatchEvent(new DragEvent('drop',{dataTransfer:new DataTransfer(),bubbles:true,cancelable:true,...at}));
  });
  await page.waitForFunction(n=>(WL.scheduleView.entries()||[])
    .filter(e=>e.kind==='コメント'&&!e.__pending).length>n,n2,{timeout:20000});
  const dropped=await page.evaluate(()=>{
   const list=(WL.scheduleView.entries()||[]).filter(e=>e.kind==='コメント'&&!e.__pending);
   const e=list.find(x=>!String(x.title||'').trim());
   return e?{id:e.id,title:e.title||'',est:e.estimate&&e.estimate.minutes}:null;
  });
  if(dropped)extra.push(dropped.id);
  rec('落とすと中身が空のまま枠が入る',!!dropped&&!String(dropped.title).trim(),JSON.stringify(dropped));

  /* 落とした枠は**そのまま書ける状態**にする（枠だけ置いて「次にどうするか」を
     探させない）。ここは行を作り直したあとで開くので、待ってから見る。 */
  await page.waitForSelector('.sc-comment-edit',{timeout:15000});
  rec('落とした枠はそのまま書ける状態で出る',
      await page.evaluate(()=>document.activeElement&&
        document.activeElement.classList.contains('sc-comment-edit')));

  /* 空の枠は「ここに書ける」と分かる形で出す（空欄のままだと壊れて見える）。 */
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>!document.querySelector('.sc-comment-edit'),null,{timeout:8000});
  const hint=await page.evaluate(id=>{
   const r=[...document.querySelectorAll('.sc-row-line')].find(x=>String(x.dataset.id)===String(id));
   return r?r.innerText.replace(/\s+/g,' '):'';
  },dropped&&dropped.id);
  rec('空の枠は書き方を書いてある',/ダブルクリック/.test(hint),hint.slice(0,60));

  /* ---- 6) ダブルクリックでその場で書く ---- */
  const EDIT='現場で直接書いた_'+Date.now();
  await page.evaluate(id=>{
   const r=[...document.querySelectorAll('.sc-row-line')].find(x=>String(x.dataset.id)===String(id));
   r.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
  },dropped&&dropped.id);
  await page.waitForSelector('.sc-comment-edit',{timeout:8000});
  const editing=await page.evaluate(()=>({
   欄:!!document.querySelector('.sc-comment-edit'),
   焦点:document.activeElement&&document.activeElement.classList.contains('sc-comment-edit'),
   読み直さない:WL.scheduleView.canAutoReload()===false,
  }));
  rec('ダブルクリックでその場の入力欄が出る',editing.欄&&editing.焦点,JSON.stringify(editing));
  rec('書いている最中は勝手に読み直さない',editing.読み直さない,JSON.stringify(editing));
  await page.fill('.sc-comment-edit',EDIT);
  await page.keyboard.press('Enter');
  await page.waitForFunction(({id,t})=>((WL.scheduleView.entries()||[])
    .find(e=>String(e.id)===String(id))||{}).title===t,
    {id:dropped&&dropped.id,t:EDIT},{timeout:20000});
  const saved=await page.evaluate(id=>{
   const e=(WL.scheduleView.entries()||[]).find(x=>String(x.id)===String(id))||{};
   const r=[...document.querySelectorAll('.sc-row-line')].find(x=>String(x.dataset.id)===String(id));
   return {title:e.title||'',画面:r?r.innerText.replace(/\s+/g,' '):'',
           編集中:!!document.querySelector('.sc-comment-edit')};
  },dropped&&dropped.id);
  rec('Enterで確定し、書いた文字が行に出る',
      saved.title===EDIT&&saved.画面.includes(EDIT.slice(0,10))&&!saved.編集中,
      JSON.stringify(saved).slice(0,220));
  /* 書き終われば読み直しは戻る（書込キューが空くまでは止まったまま）。 */
  const back=await page.waitForFunction(()=>WL.scheduleView.canAutoReload()===true,
    null,{timeout:15000}).then(()=>true).catch(()=>false);
  rec('書き終われば読み直しは戻る',back);

  /* ---- 4) 空のままは入れられない（モーダルから入れる場合） ---- */
  await page.click('#scCommentBtn');
  await page.waitForSelector('#scCommentText',{timeout:8000});
  const n0=await page.evaluate(()=>(WL.scheduleView.entries()||[]).filter(e=>e.kind==='コメント').length);
  await page.click('#appConfirmOk');
  /* 「入らない」ことを見るので条件では待てない。入るなら起きるはずの書込と取り直しが静まるまで待つ。 */
  await idle(800);
  const n1=await page.evaluate(()=>(WL.scheduleView.entries()||[]).filter(e=>e.kind==='コメント').length);
  rec('空のままでは入らない',n0===n1,`${n0} → ${n1}`);
 }catch(e){
  console.error('FATAL',e);rec('例外なく終わる',false,e.message);
 }finally{
  /* **後始末**: 入れたコメントを消す(残すと後続のテストの件数が合わない)。 */
  try{for(const id of [made,...extra].filter(x=>x!=null))await page.evaluate(async i=>{
   await fetch('/api/schedule/plan/delete',{method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({id:i,user_id:'tester'})});
  },id)}catch(_){}
  try{await setMode('edit')}catch(_){}
 }
}, {viewport:{width:1700,height:1000}});
