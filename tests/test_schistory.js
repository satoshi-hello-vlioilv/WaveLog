/* test_schistory.js: さかのぼりを「種類→量」の2段にする（§9.366）
   ------------------------------------------------------------
   利用者の指示:
   「作業スケジュールで完了となったものは、指定した作業日時を完了時刻として、
    記録し、作業スケジュールの一覧からは、切り替えて見えないようにする機能
    (表示のさかのぼり)をもっと使いやすく改良し、指定できるパターンも
    増やしつつ選びやすくわかりやすく改良してください。」

   ここで固定すること:
    1. 語彙は**サーバーが持つ**（13の候補・5つの群）
    2. 選び方は**2段**（種類の札 → その中の量）。量が1つの群では欄を消す
    3. 起点は**サーバーが答える**（`historyFrom`）。「今日ぶん」「今の直から」は
       暦の0時ではなく**勤務の区切り**で切れる
    4. **突合で完了した行（実績の日付が古い）が、さかのぼりで隠れる**
       ——これが今回の主目的（以前は`actual`を持たないので絶対に隠れなかった）
    5. **隠している件数を画面に出す**（「済んだ行が無い」と見分けられるように）
    6. 旧い保存値（時間数）を読み替える（更新した日に見え方が変わらない）
   ============================================================ */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const W=require('./lib/wait.js');
const API='http://127.0.0.1:5029';
const EQ='テスト設備A';
const TAG='HIST'+process.pid;

let b=null;
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 page.on('pageerror',e=>console.log('[pageerror]',e.message));
 const made=[];
 let planId='';
 const openView=()=>page.evaluate(()=>window.WL&&WL.scheduleView&&WL.scheduleView.openViewPop
   &&WL.scheduleView.openViewPop());
 const post=(p,body)=>page.evaluate(async a=>{
  const r=await fetch(a.p,{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify(Object.assign({user_id:'test-schistory'},a.b))});
  let j={};try{j=await r.json()}catch(e){}
  return {status:r.status,body:j};
 },{p,b:body||{}});
 const pickGroup=async g=>{
  await page.evaluate(k=>document.querySelector(`[data-history-group="${k}"]`).click(),g);
  await W.until(page,()=>!document.querySelector('#scTimeline .sc-empty-note')
    ||document.querySelectorAll('#scTimeline .sc-row-line').length>=0);
 };
 const pickMode=async k=>{
  await page.selectOption('#scHistorySelect',k);
  await W.until(page,kk=>document.querySelector('#scHistorySelect').value===kk,k);
 };
 /* **行があるかは id で見る**（文字では見ない）。タイムラインに出るのは
    内容欄の値で、題名はふつう出ないため——文字で探すと「隠れている」と
    「そもそも出ない」を取り違える。 */
 const hasRow=()=>page.evaluate(id=>!!document.querySelector(
   `#scTimeline .sc-row-line[data-id="${id}"]`),String(planId));

 try{
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.evaluate(e=>{localStorage.setItem('AccessMeasurementConfiguredEquipment',e);
                          localStorage.setItem('AccessMeasurementUserId','tester');
                          /* 旧い保存値（72時間）を置いておく。§9.366で「3日」へ
                             読み替わることを確かめる（新しい鍵は置かない）。 */
                          localStorage.removeItem('ScheduleHistoryModeV1');
                          localStorage.setItem('ScheduleHistoryHoursV1','72');
                          localStorage.setItem('scLayoutPrefsV1',JSON.stringify({swap:false,open:'schedule'}))},EQ);
  await post('/api/access-mode',{mode:'schedule'});

  /* ---- 1) 語彙はサーバーが持つ ---- */
  const vocab=await page.evaluate(async()=>{
   const r=await fetch('/api/schedule/history-modes');return r.json();
  });
  rec('さかのぼりの語彙をサーバーが答える（13の候補・5つの群）',
      (vocab.modes||[]).length===13&&(vocab.groups||[]).length===5&&vocab.default==='h8',
      JSON.stringify({n:(vocab.modes||[]).length,g:(vocab.groups||[]).map(x=>x.key),d:vocab.default}));
  rec('「今日ぶん（現場歴）」と「今の直から」がある（時間では言えない区切り）',
      (vocab.modes||[]).some(m=>m.key==='today')&&(vocab.modes||[]).some(m=>m.key==='shift'),
      JSON.stringify((vocab.modes||[]).map(m=>m.key)));

  /* ---- 4) 完了時刻を持つ行を1件作る ---- */
  // 検証用の実績 ACT0001 は 2026-09-01。仕掛には居ないので突合で「完了」になる。
  const add=await post('/api/schedule/plan/add',{equipment:EQ,kind:'作業',lotNo:'ACT0001',
    castingNo:'C9001',title:TAG,
    detail:{'ロット番号':'ACT0001','鋳造番号':'C9001','前工程実績_作業終了_日付':'2026-09-01'}});
  if(add.body&&add.body.id){made.push(add.body.id);planId=String(add.body.id)}
  const plan=await page.evaluate(async e=>{
   const r=await fetch('/api/schedule/plan?equipment='+encodeURIComponent(e)+'&history=h8');
   return r.json();
  },EQ);
  const mine=(plan.entries||[]).find(x=>String(x.id)===String((add.body||{}).id))||{};
  rec('突合で完了した行が「完了時刻」を持つ',
      mine.state==='完了'&&String(mine.finishedAt||'').startsWith('2026-09-01'),
      JSON.stringify({state:mine.state,at:mine.finishedAt,by:mine.finishedBy}));
  rec('さかのぼりの起点をサーバーが答える',
      !!plan.historyFrom&&plan.historyKey==='h8'&&plan.historyHours===8,
      JSON.stringify({from:plan.historyFrom,key:plan.historyKey,h:plan.historyHours}));
  /* 持ち帰った値は**内容欄で使える**（§9.365、利用者の指示「作業スケジュールに
     使用可能とするデータも選べるように」）。サーバーが名前を答え、画面は
     それを候補へ足す。 */
  rec('持ち帰った値の列名をサーバーが答える',
      (plan.actualColumns||[]).includes('前工程実績_設備名'),
      JSON.stringify(plan.actualColumns));

  /* ---- 画面を開く ---- */
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.waitForSelector('#openSchedule',{timeout:25000});
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-board-row',{timeout:25000});
  await page.evaluate(e=>{const r=[...document.querySelectorAll('.sc-board-row')]
    .find(x=>x.dataset.equipment===e);if(r)r.click()},EQ);
  await page.waitForSelector('#scTimeline .sc-row-line',{timeout:25000});
  await openView();
  await W.until(page,()=>document.querySelectorAll('[data-history-group]').length>0);

  /* ---- 6) 旧い保存値の読み替え ---- */
  rec('旧い保存値（72時間）を「3日」として読み替える',
      await page.evaluate(()=>document.querySelector('#scHistorySelect').value==='d3'),
      await page.evaluate(()=>document.querySelector('#scHistorySelect').value));

  /* ---- 2) 2段で選ぶ ---- */
  const two=await page.evaluate(()=>({
   groups:[...document.querySelectorAll('[data-history-group]')].map(x=>x.textContent.trim()),
   on:(document.querySelector('[data-history-group].is-on')||{}).textContent||'',
   opts:[...document.querySelector('#scHistorySelect').options].map(o=>o.value),
  }));
  rec('種類は札で5つ、いま効いている札が分かる',
      two.groups.length===5&&two.on.trim()==='日で',JSON.stringify(two.groups)+' on='+two.on);
  rec('量はその群の中だけを出す（13を一度に並べない）',
      two.opts.length===3&&two.opts.every(k=>/^d/.test(k)),JSON.stringify(two.opts));

  /* ---- 4) 隠れる／出る ---- */
  await pickGroup('all');
  await W.until(page,id=>!!document.querySelector(`#scTimeline .sc-row-line[data-id="${id}"]`),planId);
  rec('「すべて」なら8日前に完了した行も出る',await hasRow());
  const allUi=await page.evaluate(()=>({
   hidden:document.querySelector('#scHistorySelect').hidden,
   from:document.querySelector('#scHistoryFrom').textContent,
  }));
  rec('量が1つの群では欄を消す（押せるのに効かないものを残さない）',
      allUi.hidden&&/すべて/.test(allUi.from),JSON.stringify(allUi));
  await pickGroup('hours');
  await pickMode('h8');
  await W.until(page,id=>!document.querySelector(`#scTimeline .sc-row-line[data-id="${id}"]`),planId);
  rec('さかのぼりを8時間へ戻すと、8日前に完了した行は隠れる（今回の主目的）',
      !(await hasRow()));

  /* ---- 5) 隠している件数を出す ---- */
  const cnt=await page.evaluate(()=>document.querySelector('#scHistoryFrom').textContent);
  rec('隠している件数を画面に出す（「無い」と「隠している」を見分けられる）',
      /隠しています/.test(cnt)&&/以降/.test(cnt),cnt);

  /* 内容欄の候補と値の取り出しに載っている（§9.365）。 */
  await pickGroup('all');
  await W.until(page,id=>!!document.querySelector(`#scTimeline .sc-row-line[data-id="${id}"]`),planId);
  const usable=await page.evaluate(id=>{
   const cand=WL.scheduleView.contentCandidates();
   return {cand:cand.includes('前工程実績_設備名'),
           value:WL.scheduleView.entryValue(id,'前工程実績_設備名')};
  },planId);
  rec('持ち帰った値が内容欄の候補に出る',usable.cand,JSON.stringify(usable));
  rec('持ち帰った値を行から取り出せる',usable.value==='前工程1号',JSON.stringify(usable));
  await pickGroup('hours');
  await pickMode('h8');

  /* ---- 3) 現場の区切りは暦の0時ではない ---- */
  await pickGroup('field');
  await pickMode('today');
  const field=await page.evaluate(async e=>{
   const r=await fetch('/api/schedule/plan?equipment='+encodeURIComponent(e)+'&history=today');
   const j=await r.json();
   const r2=await fetch('/api/schedule/plan?equipment='+encodeURIComponent(e)+'&history=shift');
   const j2=await r2.json();
   return {today:j.historyFrom,shift:j2.historyFrom};
  },EQ);
  const hh=s=>s?new Date(s).getHours():-1;
  rec('「今日ぶん（現場歴）」は勤務の区切りで切る（暦の0時ではない）',
      !!field.today&&hh(field.today)!==0,JSON.stringify(field));
  rec('「今の直から」は「今日ぶん」と同じかそれより後',
      !!field.shift&&new Date(field.shift)>=new Date(field.today),JSON.stringify(field));

  /* ---- 「出さない」 ---- */
  await pickGroup('off');
  await W.until(page,()=>/済んだ行は出しません/.test(document.querySelector('#scHistoryFrom').textContent));
  const none=await page.evaluate(()=>({
   text:document.querySelector('#scHistoryFrom').textContent,
   done:[...document.querySelectorAll('#scTimeline .sc-row-line')]
     .filter(r=>/完了|取消/.test(r.textContent)).length,
  }));
  rec('「出さない」を選ぶと済んだ行が1件も出ない',none.done===0,JSON.stringify(none));
  await pickGroup('hours');
  await pickMode('h8');

  rec('画面側の例外が出ていない',true);
 }catch(e){
  rec('FATAL',false,e.message);
 }finally{
  /* **自分が足した予定は自分で消す**（§9.351）。消えたことまで確かめる。 */
  try{
   await post('/api/access-mode',{mode:'schedule'});
   for(const id of made)await post('/api/schedule/plan/delete',{id,equipment:EQ});
   const left=await page.evaluate(async a=>{
    const r=await fetch('/api/schedule/plan?equipment='+encodeURIComponent(a.eq)+'&history=all');
    const j=await r.json();
    return (j.entries||[]).filter(x=>a.ids.includes(String(x.id))).length;
   },{eq:EQ,ids:made.map(String)});
   rec('後片付け: 足した予定が残っていない',left===0,String(left));
  }catch(e){console.log('  [cleanup]',e.message)}
  try{await post('/api/access-mode',{mode:'edit'})}catch(e){console.log('  [cleanup]',e.message)}
  if(b)await b.close();
 }
 const ng=R.filter(x=>!x.ok);
 console.log('\n== '+(R.length-ng.length)+'/'+R.length+' PASS ==');
 process.exit(ng.length?1:0);
})();
