/* test_stopeq.js: 設備停止マスタの対象設備(§9.81)
   ------------------------------------------------------------
   これまで設備停止マスタの[設備名]は1設備のプルダウンで、同じ停止内容を
   設備の数だけ登録し直す必要があった。設備が増えるたびに登録も増える。
   [設備名]を「対象設備」として、複数設備('A,B')と全設備('*')を1行で
   書けるようにした。書式はアクセス権限マスタの[現場段取り対象設備]と同じで、
   判定は schedule_repo.stop_equipment_* に集約してある。

   ここで固定すること:
    - 画面の欄がタグ入力(複数選択)+「すべての設備」になっていること
    - 複数設備の1行が、それぞれの設備から引けること
    - 全設備の1行が、どの設備から引けて、予定にも投入できること
    - 対象設備が重なる同名の登録は止まること
      (どちらの標準所要分が効くのか決まらなくなるため)
    - 既存行の対象設備を差し替えられること(/update。以前は経路が無く、
      編集で対象設備を変えると別行が増えていた) */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const API='http://127.0.0.1:5029';
const TAG='EQ'+Date.now().toString().slice(-6);
const EQ_A='テスト設備A',EQ_B='テスト設備B';

let b=null;
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 page.on('pageerror',e=>console.log('[pageerror]',e.message));
 page.on('dialog',d=>d.accept());
 const settle=(ms=700)=>page.waitForTimeout(ms);

 // サーバー側の登録・取得はfetchで直接叩く(画面操作は入力欄の形と
 // 保存の往復だけを見る。UIの手順を全部なぞると、どこで落ちたのか
 // 分からないテストになる)。
 const post=(path,body)=>page.evaluate(async a=>{
  const r=await fetch(a.path,{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify(Object.assign({user_id:'test-stopeq'},a.body))});
  let j={};try{j=await r.json()}catch(e){}
  return {status:r.status,body:j};
 },{path,body});
 const listFor=eq=>page.evaluate(async e=>{
  const q=e?('?equipment='+encodeURIComponent(e)):'';
  const r=await fetch('/api/schedule/stop-reason-master'+q);
  return ((await r.json()).items||[]);
 },eq);
 const openStopTab=async()=>{
  await page.click('#openMasterMaint');
  await page.waitForSelector('#masterMaintForm',{timeout:10000});
  await page.evaluate(()=>{const b=document.querySelector('[data-master="stopReason"]');if(b)b.click()});
  await settle(1400);
  await page.evaluate(v=>{try{localStorage.setItem('AccessMeasurementUserId',v)}catch(e){}},'test-stopeq');
 };
 const made=[];

 try{
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await settle(900);

  /* ---- 1) 入力欄が複数選択+「すべての設備」になっている ---- */
  await openStopTab();
  await page.click('#masterMaintAdd');
  await page.waitForSelector('#maintEditorModal:not([hidden])',{timeout:5000});
  await settle(900);
  const form=await page.evaluate(()=>{
   const all=document.querySelector('[data-equipment-all="equipment"]');
   const box=document.querySelector('[data-equipment-box="equipment"]');
   const field=document.querySelector('[data-tagfield="equipment"]');
   return {hasAll:!!all,hasBox:!!box,
           legacySelect:!!document.querySelector('select[data-field="equipment"]'),
           label:(field?.querySelector(':scope > span')?.textContent||'').trim(),
           allLabel:(all?.closest('label')?.textContent||'').trim(),
           hint:(field?.querySelector('.mm-field-hint')?.textContent||'').trim()};
  });
  rec('対象設備は複数選べるタグ入力になっている',form.hasBox&&!form.legacySelect,JSON.stringify(form));
  rec('「すべての設備」を選べる',form.hasAll&&/すべての設備/.test(form.allLabel),form.allLabel);
  rec('欄の名前が「対象設備」になっている',/^対象設備/.test(form.label),form.label);
  rec('必須であることが分かる',/\*/.test(form.label),form.label);
  rec('補足文が権限ではなく停止内容の話になっている',
      /停止内容/.test(form.hint)&&!/権限/.test(form.hint),form.hint.slice(0,60));

  /* ---- 2) 未選択のままでは保存させない ---- */
  await page.fill('[data-field="name"]',TAG+'_未選択');
  await page.click('#maintEditorSave');
  await settle(1200);
  const none=await listFor();
  rec('対象設備を選ばずに保存しようとしても登録されない',
      !none.some(x=>x.name===TAG+'_未選択'));

  /* ---- 3) 画面から複数設備をまとめて登録できる ---- */
  for(const eq of [EQ_A,EQ_B]){
   await page.click('[data-equipment-search="equipment"]');
   await settle(300);
   await page.click(`[data-equipment-suggest="equipment"] [data-pick="${eq}"]`);
   await settle(200);
  }
  const tags=await page.$$eval('[data-equipment-box="equipment"] .mm-tag',ts=>ts.map(t=>t.textContent.replace('×','').trim()));
  rec('選んだ設備がタグとして並ぶ',tags.length===2&&tags.includes(EQ_A)&&tags.includes(EQ_B),tags.join('/'));
  await page.fill('[data-field="name"]',TAG+'_多');
  await page.fill('#maintEditorForm .mm-num-input','30');
  await page.click('#maintEditorSave');
  await settle(2200);
  const many=(await listFor()).find(x=>x.name===TAG+'_多');
  if(many)made.push(many.id);
  rec('複数設備を1行で登録できる',!!many&&many.equipmentList.length===2,JSON.stringify(many&&many.equipmentList));
  rec('保存は1行のまま(設備の数だけ増えない)',
      (await listFor()).filter(x=>x.name===TAG+'_多').length===1);
  const cellMany=await page.$$eval('#masterMaintList .mm-row:not(.head)',
    (rs,t)=>{const r=rs.find(x=>x.innerText.includes(t));return r?r.innerText.split('\n')[0].trim():''},TAG+'_多');
  rec('一覧では設備名が読める形で並ぶ',cellMany===`${EQ_A} / ${EQ_B}`,cellMany);

  /* ---- 4) それぞれの設備から引ける ---- */
  const inA=(await listFor(EQ_A)).some(x=>x.name===TAG+'_多');
  const inB=(await listFor(EQ_B)).some(x=>x.name===TAG+'_多');
  rec('どちらの設備からも同じ停止内容が選べる',inA&&inB,`A=${inA} B=${inB}`);

  /* ---- 5) 全設備('*') ---- */
  const all=await post('/api/schedule/stop-reason-master',
    {equipment:'*',name:TAG+'_全',standardMinutes:15,category:'保全'});
  rec('「すべての設備」で登録できる',all.status===200,JSON.stringify(all.body));
  if(all.body.id)made.push(all.body.id);
  const allRow=(await listFor(EQ_A)).find(x=>x.name===TAG+'_全');
  rec('全設備の停止内容はどの設備からも選べる',!!allRow,JSON.stringify(allRow&&allRow.equipmentList));
  rec('全設備は「すべての設備」と読める形で返る',
      !!allRow&&allRow.equipmentLabel==='すべての設備',allRow&&allRow.equipmentLabel);

  /* ---- 6) 対象設備が重なる同名は止める ---- */
  const dup=await post('/api/schedule/stop-reason-master',
    {equipment:EQ_A,name:TAG+'_多',standardMinutes:45});
  rec('対象設備が重なる同名の登録は止まる',dup.status===400&&/重なら/.test(dup.body.error||''),
      `${dup.status} ${dup.body.error||''}`);
  rec('重なった相手を文言で示す',/テスト設備/.test(dup.body.error||''),dup.body.error||'');

  /* ---- 7) 既存行の対象設備を差し替えられる(/update) ---- */
  const upd=await post('/api/schedule/stop-reason-master/update',
    {id:many.id,equipment:[EQ_B],name:TAG+'_多',standardMinutes:45,category:'保全'});
  rec('編集で対象設備そのものを入れ替えられる',upd.status===200&&upd.body.created===false,
      JSON.stringify(upd.body));
  const afterA=(await listFor(EQ_A)).some(x=>x.name===TAG+'_多');
  const afterB=(await listFor(EQ_B)).find(x=>x.name===TAG+'_多');
  rec('外した設備からは消え、残した設備には残る',!afterA&&!!afterB,`A=${afterA} B=${!!afterB}`);
  rec('編集で行が増えない',(await listFor()).filter(x=>x.name===TAG+'_多').length===1);
  rec('標準所要分も一緒に更新される',!!afterB&&Number(afterB.standardMinutes)===45,
      String(afterB&&afterB.standardMinutes));

  /* ---- 8) 全設備の停止内容を実際に予定へ投入できる ---- */
  await page.evaluate(async()=>{await fetch('/api/access-mode',{method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'schedule'})})});
  await post('/api/schedule/session/acquire',{equipment:EQ_A});
  const plan=await post('/api/schedule/plan/add',
    {equipment:EQ_A,kind:'設備停止',stopReasonId:allRow.id});
  rec('全設備の停止内容を設備Aの予定へ投入できる',plan.status===200,
      `${plan.status} ${plan.body.error||''}`);
  if(plan.body.id)await post('/api/schedule/plan/delete',{id:plan.body.id,equipment:EQ_A});
  await post('/api/schedule/session/release',{equipment:EQ_A});
  await page.evaluate(async()=>{await fetch('/api/access-mode',{method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'edit'})})});

  /* ---- 9) 消したものを同じ内容で登録し直すと元の行が戻る ----
     削除は論理削除で、UNIQUE INDEX([設備名],[名称])も残っている。
     「消えているのだから新規登録できるはず」で新しい行を作ろうとすると
     索引に弾かれるため、自然キーの照合は無効化済みの行も見る。 */
  const del=await post('/api/schedule/stop-reason-master/delete',{id:allRow.id});
  rec('登録した停止内容を消せる',del.status===200,JSON.stringify(del.body));
  rec('消したものは一覧から出なくなる',
      !(await listFor(EQ_A)).some(x=>x.name===TAG+'_全'));
  const revive=await post('/api/schedule/stop-reason-master',
    {equipment:'*',name:TAG+'_全',standardMinutes:20,category:'保全'});
  rec('同じ内容で登録し直すと元の行が戻る（新しい行を作らない）',
      revive.status===200&&revive.body.created===false&&revive.body.id===allRow.id,
      JSON.stringify(revive.body));
  const revived=(await listFor(EQ_A)).find(x=>x.name===TAG+'_全');
  rec('戻した行が一覧に出る',!!revived&&Number(revived.standardMinutes)===20,
      JSON.stringify(revived&&revived.standardMinutes));

  console.log('\n=== SUMMARY ===');
  const ng=R.filter(x=>!x.ok);console.log(`${R.length-ng.length}/${R.length} passed`);
  ng.forEach(x=>console.log(' -',x.n,x.d||''));
  await cleanup();
  process.exit(ng.length?1:0);
 }catch(e){
  console.error('FATAL',e);
  await cleanup();
  process.exit(2);
 }
 /* 後片付けは**process.exitより前**に呼ぶこと。finallyに置くとexitで
    プロセスが即終了して走らない(実際に踏んだ)。設備停止マスタは共有DBでは
    なくmaster.sqlite3にあり、ランナーのフィクスチャ差し替え(仕掛/品質/
    共有スケジュール)では戻らないため、残すと次回以降の一覧に混ざり続ける。 */
 async function cleanup(){
  try{
   await page.evaluate(async()=>{await fetch('/api/access-mode',{method:'POST',
     headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'edit'})})});
   for(const id of made)await post('/api/schedule/stop-reason-master/delete',{id});
  }catch(e){}
  if(b)await b.close().catch(()=>{});
 }
})().catch(async e=>{console.error('FATAL',e);if(b)await b.close().catch(()=>{});process.exit(2)});
