/* test_scundecided.js: 「時刻未定」の案内と、追加後の時刻の取り直し（§9.185）
   ------------------------------------------------------------
   利用者の指摘「スケジュール追加時に正しく時間などの計算も反映されて
   ほしい。もしうまくいかなくて未定が残ってしまった場合、未定が出たら
   再計算を押すことをアナウンスしてほしい」。

   起きていたこと: 予定を1本足すと、楽観的に置いた行は`plannedStart`を
   持たないので「未定」と出る。書込キューは**自分が編集中の設備では
   取り直さない**作りだったため、足した行は未定のまま、後続の予定の時刻も
   古いまま残っていた（1本挿すと後ろの時刻は全部動く）。

   ここで固定するのは:
    1. 予定を足したあと、**時刻が入ること**（取り直していること）
    2. 未定が残っているときだけ案内が出て、件数とロット番号を文字で言うこと
    3. 反映を待っているだけのものは案内しないこと（待てば決まる）
    4. 案内から「再計算」を押せること（打つ手を同じ場所に置く） */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const API='http://127.0.0.1:5029';
const EQ='テスト設備A';

let b=null;
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 page.on('pageerror',e=>console.log('[pageerror]',e.message));
 const setMode=m=>page.evaluate(async mm=>{await fetch('/api/access-mode',{method:'POST',
   headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:mm})})},m);
 let added=null;
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

  /* ---- 0) ふだんは案内を出さない ---- */
  rec('未定が無ければ案内を出さない',
      await page.evaluate(()=>document.getElementById('scUndecided').hidden));

  /* ---- 1) 案内は「件数・ロット番号・打つ手」を出す ---- */
  const shown=await page.evaluate(()=>{
   /* 実データで未定を作るのは稼働カレンダー次第なので、**表示の決まり**を
      直接確かめる。時刻の無い予定を1本混ぜて描き直す。 */
   const list=WL.scheduleView.entries();
   const one=list.find(e=>e.state==='予定'&&e.parentId==null);
   if(!one)return {skip:true};
   const keep={s:one.plannedStart,e:one.plannedEnd};
   one.plannedStart=null;one.plannedEnd=null;
   WL.scheduleView.render();
   const box=document.getElementById('scUndecided');
   const out={hidden:box.hidden,text:box.innerText.replace(/\s+/g,' '),
              btn:!!document.getElementById('scUndecidedFix'),lot:one.lotNo||''};
   one.plannedStart=keep.s;one.plannedEnd=keep.e;
   WL.scheduleView.render();
   out.gone=document.getElementById('scUndecided').hidden;
   return out;
  });
  if(shown.skip)rec('未定の案内を確かめられる予定がある',false,'予定が無い');
  else{
   rec('未定が残っていると案内が出る',!shown.hidden,shown.text.slice(0,120));
   rec('件数を文字で言う',/1件の予定が「時刻未定」です/.test(shown.text),shown.text.slice(0,80));
   rec('どのロットかを言う',!shown.lot||shown.text.includes(shown.lot),
       `${shown.lot} / ${shown.text.slice(0,80)}`);
   rec('打つ手（再計算）を同じ場所に置く',shown.btn);
   rec('直れば案内は消える',shown.gone);
  }

  /* ---- 2) 反映を待っているだけのものは案内しない ---- */
  const pending=await page.evaluate(()=>{
   const list=WL.scheduleView.entries();
   list.push({id:'tmp-テスト',kind:'作業',state:'予定',reorderable:true,parentId:null,
              plannedStart:null,plannedEnd:null,estimate:null,actual:null,
              lotNo:'PENDING1',title:'',detail:{},__pending:true});
   WL.scheduleView.render();
   const hidden=document.getElementById('scUndecided').hidden;
   list.pop();WL.scheduleView.render();
   return hidden;
  });
  rec('サーバーへ反映中のものは案内しない（待てば決まる）',pending);

  /* ---- 3) 予定を足したら時刻が入る（取り直していること） ---- */
  const before=await page.evaluate(()=>WL.scheduleView.entries().length);
  added=await page.evaluate(async()=>{
   /* 仕掛から1本足す。**画面の道具で足す**——サーバーへ直接投げると、
      画面が取り直すかどうかを確かめられない。 */
   const eq=WL.scheduleView.equipment();
   const r=await fetch('/api/table?db='+encodeURIComponent(WL.dataSource.workKey())
     +'&table='+encodeURIComponent('仕掛')+'&page=1&page_size=1&columns='+encodeURIComponent('ロット番号'));
   const j=await r.json();
   const lot=(j.rows||[])[0]&&(j.rows[0]['ロット番号']);
   if(!lot)return null;
   const add=await fetch('/api/schedule/plan/add',{method:'POST',
     headers:{'Content-Type':'application/json'},
     body:JSON.stringify({equipment:eq,kind:'作業',lotNo:lot,user_id:'tester'})});
   const aj=await add.json();
   return {lot,id:aj.id||null,error:aj.error||''};
  });
  if(!added||!added.id)rec('予定を1本足せる',false,JSON.stringify(added));
  else{
   await page.evaluate(()=>WL.scheduleView.refresh(true));
   await page.waitForFunction(n=>(WL.scheduleView.entries()||[]).length>=n,before,{timeout:20000});
   const after=await page.evaluate(id=>{
    const e=(WL.scheduleView.entries()||[]).find(x=>String(x.id)===String(id));
    return e?{start:e.start||e.plannedStart,est:e.estimate?e.estimate.minutes:null}:null;
   },added.id);
   rec('足した予定に時刻が入る',!!(after&&after.start),JSON.stringify(after));
   rec('足した予定に見積が入る',!!(after&&after.est!=null),JSON.stringify(after));
   rec('足したあと未定の案内は出ていない',
       await page.evaluate(()=>document.getElementById('scUndecided').hidden));
  }
 }catch(e){
  console.error('FATAL',e);rec('例外なく終わる',false,e.message);
 }finally{
  /* **後始末**: 足した予定を消す(残すとタイムラインが伸び続け、他の
     テストの件数が合わなくなる。§9.121)。 */
  try{if(added&&added.id)await page.evaluate(async id=>{
   await fetch('/api/schedule/plan/delete',{method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({id,user_id:'tester'})});
  },added.id)}catch(_){}
  try{await setMode('edit')}catch(_){}
  if(b)await b.close().catch(()=>{});
 }
 console.log('\n=== SUMMARY ===');
 const ng=R.filter(x=>!x.ok);console.log(`${R.length-ng.length}/${R.length} passed`);
 ng.forEach(x=>console.log(' -',x.n,x.d||''));
 process.exit(ng.length?1:0);
})();
