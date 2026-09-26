/* test_sctimes.js: 実際の時刻を入れる（§9.514、利用者の指示）
   ============================================================
   「仕掛にないロットや時間的に完了したであろう設備停止は、色を変え、ユーザーに登録を
    促し開始時間だけ(この場合は登録済みの時間を適用する)もしくは開始時間と終了時間を
    入力(ワンクリックでも入れられるような入力補助をいれ、分単位で…)させるように
    してください。(過去の履歴から修正も可能にしてください)」
   配置は利用者の選択「札＋ボタン1つ」。

   ここで固定すること:
    1. 仕掛から消えたロット・後ろの作業が始まった設備停止は、**色（行の地と左の帯）と
       字（時刻の列に「時刻未登録」）**で名乗り、操作の列に「時刻を入れる」が1つ出る。
       後ろに何も始まっていない停止には出ない（対照）。並びは**完了側の最後**
       （これから並ぶ行より前・末尾へ落とさない）
    2. 知らせの棚に件数と「順に入れる」
    3. 窓は開けた時点で開始の候補が入り、終わりは「見積で終わる」が選ばれている
       ＝**押すだけで登録できる**（ワンクリック）。−5分・今・開始＋見積で分単位に動かせる
    4. 登録すると時刻の列に時刻と「手入力」の印が出て、色が消える（残っていない）
    5. 「終了の時刻を入れる」を選べば開始と終了で登録できる（行のダブルクリックでも開く）
    6. 段「履歴」の行に「時刻を直す」があり、直した時刻が出る
   材料（予定）は自分で足して、自分で消す（§9.351）。
   ============================================================ */
'use strict';
const {run}=require('./lib/harness.js');
const EQ='テスト設備A';
const TAG='RTT'+process.pid;

run('test_sctimes: 実際の時刻を入れる（§9.514）', async ({page,rec,B,W,idle,paint,errs,browser})=>{
 const made=[];
 const post=(p,body)=>page.evaluate(async a=>{
  const t0=Date.now();let last=null;
  while(Date.now()-t0<20000){
   const r=await fetch(a.p,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(Object.assign({user_id:'test-sctimes'},a.b))});
   let j={};try{j=await r.json()}catch(e){j={parseError:String(e)}}
   last={status:r.status,body:j};
   if(r.status!==423)return last;
   await new Promise(z=>setTimeout(z,400));   // 共有の書込ロックが空くのを待つ（§4.2）
  }
  return last;
 },{p,b:body||{}});
 const rowOf=id=>`.sc-row-line[data-id="${id}"]`;
 const look=id=>page.evaluate(sel=>{
  const r=document.querySelector(sel);if(!r)return null;
  const b=r.querySelector('[data-times]');
  return {need:r.classList.contains('sc-row-needtimes'),
          badge:b?(b.getAttribute('aria-label')||b.textContent.trim()):'',kind:b?b.dataset.times:'',
          btn:!!r.querySelector('.sc-row-times'),bg:getComputedStyle(r).backgroundColor};
 },rowOf(id));
 const refresh=async()=>{await page.evaluate(()=>WL.refreshScheduleIfOpen());await idle()};
 try{
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.evaluate(e=>{localStorage.setItem('AccessMeasurementConfiguredEquipment',e);
                          localStorage.setItem('AccessMeasurementUserId','tester')},EQ);
  await post('/api/access-mode',{mode:'schedule'});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-board-row',{timeout:25000});
  await page.evaluate(e=>{const r=[...document.querySelectorAll('.sc-board-row')]
    .find(x=>x.dataset.equipment===e);if(r)r.click()},EQ);
  await page.waitForSelector('.sc-row-line',{timeout:30000});

  /* 材料: 停止S1 → 仕掛落ちのロット → 停止S2（後ろの作業が始まった停止／対照） */
  const reasons=await page.evaluate(async e=>((await (await fetch('/api/schedule/stop-reason-master?equipment='
    +encodeURIComponent(e))).json()).items||[]),EQ);
  const rid=(reasons[0]||{}).id;
  const addStop=async name=>{const r=await post('/api/schedule/plan/add',{equipment:EQ,kind:'設備停止',
    title:TAG+name,stopReasonId:rid,estimateMinutes:30});if(r.body.id)made.push(r.body.id);return r.body.id};
  const s1=await addStop('S1');
  const g=await post('/api/schedule/plan/add',{equipment:EQ,kind:'作業',lotNo:TAG+'GONE',castingNo:'C0001',
   title:TAG+'GONE',detail:{'ロット番号':TAG+'GONE','鋳造番号':'C0001','前工程実績_作業終了_日付':'2026-09-09'}});
  if(g.body.id)made.push(g.body.id);
  const gone=g.body.id;
  const s2=await addStop('S2');
  rec('材料を足せた（停止2件・仕掛落ちのロット1件）',!!(s1&&gone&&s2),JSON.stringify([s1,gone,s2]));
  await refresh();
  await page.waitForSelector(rowOf(gone),{timeout:20000});

  // ---- 1. 色と字で名乗る・ボタンが1つ ----
  const lg=await look(gone),l1=await look(s1),l2=await look(s2);
  rec('1: 仕掛から消えたロットは「時刻未登録」の札・色・「時刻を入れる」',
      !!lg&&lg.need&&lg.badge==='時刻未登録'&&lg.btn,JSON.stringify(lg));
  rec('1: 後ろの作業が始まった設備停止も同じ',!!l1&&l1.need&&l1.badge==='時刻未登録'&&l1.btn,JSON.stringify(l1));
  rec('1: 後ろに何も始まっていない停止には出ない（対照）',!!l2&&!l2.need&&!l2.btn,JSON.stringify(l2));
  const order=await page.evaluate(a=>{
   const ids=[...document.querySelectorAll('#scTimeline .sc-row-line')].map(r=>r.dataset.id);
   const planned=[...document.querySelectorAll('#scTimeline .sc-row-line.sc-row-planned')].map(r=>ids.indexOf(r.dataset.id));
   return {gone:ids.indexOf(String(a.gone)),s1:ids.indexOf(String(a.s1)),firstPlanned:Math.min(...planned)};
  },{gone,s1});
  rec('1: 時刻未登録の行は完了側の最後（これから並ぶ行より前）',order.gone>=0&&order.s1>=0
      &&order.gone<order.firstPlanned&&order.s1<order.firstPlanned,JSON.stringify(order));

  // ---- 2. 知らせの棚 ----
  const note=await page.evaluate(()=>{const b=document.getElementById('scTimesNeeded');
   return b&&!b.hidden?{text:b.textContent.replace(/\s+/g,' '),btn:!!b.querySelector('#scTimesInOrder')}:null});
  rec('2: 知らせの棚に件数と「順に入れる」',!!note&&/件の実際の時刻が未登録です/.test(note.text)&&note.btn,
      JSON.stringify(note).slice(0,140));

  // ---- 3. ワンクリック: 候補が入り、見積で終わるが選ばれている ----
  await page.click(rowOf(gone)+' .sc-row-times');
  await page.waitForSelector('#sctForm',{timeout:10000});
  const f0=await page.evaluate(()=>({start:document.getElementById('sctStart').value,
   from:document.getElementById('sctStartFrom').textContent,
   est:(document.querySelector('[data-end="estimate"]')||{}).classList?.contains('is-on'),
   endHidden:document.getElementById('sctEndRow').hidden,
   sum:document.getElementById('sctSum').textContent}));
  rec('3: 開けた時点で開始の候補が入り、出どころを言う',/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(f0.start)&&/候補/.test(f0.from),
      JSON.stringify(f0));
  rec('3: 終わりは「見積で終わる」が選ばれている（押すだけで登録できる）',f0.est===true&&f0.endHidden===true,JSON.stringify(f0));
  rec('3: 所要と見積をその場で出す',/所要 \d+分/.test(f0.sum)&&/見積/.test(f0.sum),f0.sum);
  await page.click('[data-sct="start:-5"]');
  const f1=await page.evaluate(()=>document.getElementById('sctStart').value);
  const diff=(new Date(f0.start)-new Date(f1))/60000;
  rec('3: −5分で分単位に動かせる',diff===5,`${f0.start} → ${f1}`);
  await page.click('#appConfirmOk');
  await W.until(page,sel=>{const r=document.querySelector(sel);return !!r&&!!r.querySelector('[data-times="manual"]')},
   rowOf(gone),{ms:20000,what:'登録した行が「手入力」になる'});

  // ---- 4. 登録すると札が「手入力」・色が消える ----
  const lg2=await look(gone);
  rec('4: 登録すると時刻の列が「手入力」の印つきの時刻になり、色とボタンが消える',!!lg2&&!lg2.need&&lg2.badge==='手入力'&&!lg2.btn,JSON.stringify(lg2));
  const t=await page.evaluate(sel=>(document.querySelector(sel+' .sc-row-time')||{}).textContent||'',rowOf(gone));
  rec('4: 時刻の列に登録した時刻が出る',/\d\d:\d\d/.test(t),t);

  // ---- 5. 開始と終了（ダブルクリックでも開く） ----
  await page.dblclick(rowOf(s1)+' .sc-row-cat');
  await page.waitForSelector('#sctForm',{timeout:10000});
  await page.click('[data-end="input"]');
  await page.click('[data-sct="end:est"]');
  const f2=await page.evaluate(()=>({end:document.getElementById('sctEnd').value,shown:!document.getElementById('sctEndRow').hidden}));
  rec('5: 「終了の時刻を入れる」で終了の欄が出て、「開始＋見積」で入る',f2.shown&&!!f2.end,JSON.stringify(f2));
  await page.click('#appConfirmOk');
  await W.until(page,sel=>{const r=document.querySelector(sel);return !!r&&!!r.querySelector('[data-times="manual"]')},
   rowOf(s1),{ms:20000,what:'停止が「手入力」になる'});
  const ent=await page.evaluate(id=>(WL.scheduleView.entries?WL.scheduleView.entries():[]).find(e=>String(e.id)===String(id)),s1);
  rec('5: 開始と終了で登録できる（終わりの出どころ＝手入力）',!!ent&&ent.actual&&ent.actual.endFrom==='手入力',
      JSON.stringify(ent&&ent.actual));

  // ---- 6. 段「履歴」から直す ----
  await page.click('#scModeHistory');
  await W.until(page,()=>!!WL.scheduleHistory&&!WL.scheduleHistory.state().loading&&!!document.querySelector('#shScroll table'),
   null,{ms:20000,what:'履歴を読めた'});
  const fixSel=`#shScroll [data-fix="${s1}"]`;
  const hasFix=await page.$(fixSel);
  rec('6: 段「履歴」の行に「時刻を直す」がある（手で入れた時刻だけ）',!!hasFix,'');
  if(hasFix){
   await page.click(fixSel);
   await page.waitForSelector('#sctForm',{timeout:10000});
   const title=await page.textContent('#appConfirmTitle');
   const before=await page.evaluate(()=>document.getElementById('sctStart').value);
   await page.click('[data-sct="start:+5"]');
   await page.click('#appConfirmOk');
   await W.until(page,()=>!WL.scheduleHistory.state().loading,null,{ms:20000,what:'履歴を読み直した'});
   const after=await page.evaluate(id=>{const r=document.querySelector(`#shScroll tr[data-id="${id}"] .sh-c-time`);
    return r?r.textContent:''},s1);
   const want=before.slice(11,16).split(':').map(Number);const m=want[0]*60+want[1]+5;
   const hhmm=`${String(Math.floor(m/60)%24).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
   rec('6: 窓は「直す」と名乗る',/直す/.test(title),title);
   rec('6: 直した時刻が履歴に出る',after.includes(hhmm),`${after} ⊃ ${hhmm}?`);
  }
  rec('JSエラーが出ていない',!errs.length,errs.slice(0,2).join(' / '));
 }finally{
  for(const id of made)await post('/api/schedule/plan/delete',{equipment:EQ,id});
  await post('/api/access-mode',{mode:'edit'});
 }
},{viewport:{width:1728,height:1030}});
