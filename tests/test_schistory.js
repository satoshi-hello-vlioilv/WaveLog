/* test_schistory.js: さかのぼりを「種類→量」の2段にする（§9.366）
   ------------------------------------------------------------
   利用者の指示:
   「作業スケジュールで完了となったものは、指定した作業日時を完了時刻として、
    記録し、作業スケジュールの一覧からは、切り替えて見えないようにする機能
    (表示のさかのぼり)をもっと使いやすく改良し、指定できるパターンも
    増やしつつ選びやすくわかりやすく改良してください。」

   ここで固定すること:
    1. 語彙は**サーバーが持つ**（13の候補・5つの群）。専用のルートは作らず
       予定の応答が運ぶ（語彙と起点が食い違いようがない）
    2. 選び方は**2段**（種類の札 → その中の量）。量が1つの群では欄を消す
    3. 起点は**サーバーが答える**（`historyFrom`）。「今日ぶん」「今の直から」は
       暦の0時ではなく**勤務の区切り**で切れる
    4. **突合で完了した行（実績の日付が古い）が、さかのぼりで隠れる**
       ——これが今回の主目的（以前は`actual`を持たないので絶対に隠れなかった）
    5. **持ち帰った値が内容欄で使える**（§9.365、利用者の指示）
    6. **隠している件数を画面に出す**（「済んだ行が無い」と見分けられるように）
    7. 旧い保存値（時間数）を読み替える（更新した日に見え方が変わらない）
   ============================================================ */
const {run}=require('./lib/harness.js');
const EQ='テスト設備A';

run('test_schistory: さかのぼりの2段と完了時刻（§9.366）',
 async({page,rec,B,setMode,W})=>{
  const made=[];
  let planId='';
  const post=async(p,body)=>page.evaluate(async a=>{
   const r=await fetch(a.p,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(Object.assign({user_id:'test-schistory'},a.b))});
   let j=null;
   try{j=await r.json()}
   catch(e){j={parseError:String(e&&e.message||e)}}   // 本文がJSONでないことも情報
   return {status:r.status,body:j};
  },{p,b:body||{}});
  const plan=async q=>page.evaluate(async a=>{
   const r=await fetch('/api/schedule/plan?equipment='+encodeURIComponent(a.eq)+'&history='+a.q);
   return r.json();
  },{eq:EQ,q});
  const hasRow=()=>page.evaluate(id=>!!document.querySelector(
    `#scTimeline .sc-row-line[data-id="${id}"]`),String(planId));
  const pickGroup=async g=>{
   await page.evaluate(k=>document.querySelector(`[data-history-group="${k}"]`).click(),g);
   await W.until(page,k=>(document.querySelector('[data-history-group].is-on')||{}).dataset
     .historyGroup===k,g);
  };
  const pickMode=async k=>{
   await page.selectOption('#scHistorySelect',k);
   await W.until(page,kk=>document.querySelector('#scHistorySelect').value===kk,k);
  };

  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await W.booted(page);
  await page.evaluate(e=>{localStorage.setItem('AccessMeasurementConfiguredEquipment',e);
                          localStorage.setItem('AccessMeasurementUserId','tester');
                          /* 旧い保存値（72時間）を置いておく。§9.366で「3日」へ
                             読み替わることを確かめる（新しい鍵は置かない）。 */
                          localStorage.removeItem('ScheduleHistoryModeV1');
                          localStorage.setItem('ScheduleHistoryHoursV1','72');
                          localStorage.setItem('scLayoutPrefsV1',
                            JSON.stringify({swap:false,open:'schedule'}))},EQ);
  await setMode('schedule');

  try{
   /* ---- 4) 完了時刻を持つ行を1件作る ----
      検証用の実績 ACT0001 は 2026-09-01。仕掛には居ないので突合で「完了」になる。 */
   const add=await post('/api/schedule/plan/add',{equipment:EQ,kind:'作業',lotNo:'ACT0001',
     castingNo:'C9001',title:'HIST'+process.pid,
     detail:{'ロット番号':'ACT0001','鋳造番号':'C9001','前工程実績_作業終了_日付':'2026-09-01'}});
   if(add.body&&add.body.id){made.push(add.body.id);planId=String(add.body.id)}
   const p8=await plan('h8');
   const mine=(p8.entries||[]).find(x=>String(x.id)===planId)||{};
   rec('突合で完了した行が「完了時刻」を持つ',
       mine.state==='完了'&&String(mine.finishedAt||'').startsWith('2026-09-01'),
       JSON.stringify({state:mine.state,at:mine.finishedAt,by:mine.finishedBy}));
   rec('さかのぼりの起点をサーバーが答える',
       !!p8.historyFrom&&p8.historyKey==='h8'&&p8.historyHours===8,
       JSON.stringify({from:p8.historyFrom,key:p8.historyKey,h:p8.historyHours}));

   /* ---- 1) 語彙は同じ応答が運ぶ（専用のルートを作らない） ---- */
   rec('さかのぼりの語彙を予定の応答が運ぶ（13の候補・5つの群）',
       (p8.historyModes||[]).length===13&&(p8.historyGroups||[]).length===5
       &&p8.historyDefault==='h8',
       JSON.stringify({n:(p8.historyModes||[]).length,
                       g:(p8.historyGroups||[]).map(x=>x.key),d:p8.historyDefault}));
   rec('「今日ぶん（現場歴）」と「今の直から」がある（時間では言えない区切り）',
       (p8.historyModes||[]).some(m=>m.key==='today')
       &&(p8.historyModes||[]).some(m=>m.key==='shift'),
       JSON.stringify((p8.historyModes||[]).map(m=>m.key)));
   /* ---- 5) 持ち帰った値の列名 ---- */
   rec('持ち帰った値の列名をサーバーが答える',
       (p8.actualColumns||[]).includes('前工程実績_設備名'),
       JSON.stringify(p8.actualColumns));

   /* ---- 画面を開く ---- */
   await page.reload({waitUntil:'domcontentloaded'});
   await W.booted(page);
   await W.openSchedule(page,EQ);
   await page.evaluate(()=>WL.scheduleView.openViewPop());
   await W.until(page,()=>document.querySelectorAll('[data-history-group]').length>0);

   /* ---- 7) 旧い保存値の読み替え ---- */
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
   await W.until(page,id=>!!document.querySelector(
     `#scTimeline .sc-row-line[data-id="${id}"]`),planId);
   rec('「すべて」なら8日前に完了した行も出る',await hasRow());
   const allUi=await page.evaluate(()=>({
    hidden:document.querySelector('#scHistorySelect').hidden,
    from:document.querySelector('#scHistoryFrom').textContent,
   }));
   rec('量が1つの群では欄を消す（押せるのに効かないものを残さない）',
       allUi.hidden&&/すべて/.test(allUi.from),JSON.stringify(allUi));

   /* ---- 5) 持ち帰った値が内容欄で使える ---- */
   const usable=await page.evaluate(id=>({
    cand:WL.scheduleView.contentCandidates().includes('前工程実績_設備名'),
    value:WL.scheduleView.entryValue(id,'前工程実績_設備名'),
   }),planId);
   rec('持ち帰った値が内容欄の候補に出る',usable.cand,JSON.stringify(usable));
   rec('持ち帰った値を行から取り出せる',usable.value==='前工程1号',JSON.stringify(usable));

   await pickGroup('hours');
   await pickMode('h8');
   await W.until(page,id=>!document.querySelector(
     `#scTimeline .sc-row-line[data-id="${id}"]`),planId);
   rec('さかのぼりを8時間へ戻すと、8日前に完了した行は隠れる（今回の主目的）',
       !(await hasRow()));

   /* ---- 6) 隠している件数を出す ---- */
   const cnt=await page.evaluate(()=>document.querySelector('#scHistoryFrom').textContent);
   rec('隠している件数を画面に出す（「無い」と「隠している」を見分けられる）',
       /隠しています/.test(cnt)&&/以降/.test(cnt),cnt);

   /* ---- 3) 現場の区切りは暦の0時ではない ---- */
   const today=await plan('today'),shift=await plan('shift');
   const hh=s=>s?new Date(s).getHours():-1;
   rec('「今日ぶん（現場歴）」は勤務の区切りで切る（暦の0時ではない）',
       !!today.historyFrom&&hh(today.historyFrom)!==0,
       JSON.stringify({today:today.historyFrom,shift:shift.historyFrom}));
   rec('「今の直から」は「今日ぶん」と同じかそれより後',
       !!shift.historyFrom&&new Date(shift.historyFrom)>=new Date(today.historyFrom),
       JSON.stringify({today:today.historyFrom,shift:shift.historyFrom}));

   /* ---- 「出さない」 ---- */
   await pickGroup('off');
   await W.until(page,()=>/済んだ行は出しません/.test(
     document.querySelector('#scHistoryFrom').textContent));
   const none=await page.evaluate(()=>({
    text:document.querySelector('#scHistoryFrom').textContent,
    done:[...document.querySelectorAll('#scTimeline .sc-row-line')]
      .filter(r=>/完了|取消/.test(r.textContent)).length,
   }));
   rec('「出さない」を選ぶと済んだ行が1件も出ない',none.done===0,JSON.stringify(none));
   await pickGroup('hours');
   await pickMode('h8');
  }finally{
   /* **自分が足した予定は自分で消す**（§9.351）。消えたことまで確かめる（§9.362）。 */
   for(const id of made)await post('/api/schedule/plan/delete',{id,equipment:EQ});
   const left=await page.evaluate(async a=>{
    const r=await fetch('/api/schedule/plan?equipment='+encodeURIComponent(a.eq)+'&history=all');
    const j=await r.json();
    return (j.entries||[]).filter(x=>a.ids.includes(String(x.id))).length;
   },{eq:EQ,ids:made.map(String)});
   rec('後片付け: 足した予定が残っていない',left===0,String(left));
  }
 },{mode:'schedule'});
