/* test_eqfeature.js: 設備の有効・無効を機能別に（§9.302）
   ------------------------------------------------------------
   利用者の指示:
    「設備マスタの有効・無効機能を実装してください。有効無効の範囲については
     機能別に分けて変更できるようにしたいです。」

   ここで固定すること:
    1. 語彙は**サーバーが答える**（`equipmentFeatures`）——画面へ書き写さない（§9.163）
    2. **保存値は「使わない機能」**——空欄＝すべて使える。触っていない設備が、
       あとで機能を1つ足したときに黙って無効にならない（§9.132）
    3. 知らない綴りは捨てる／送っていないときは今の値を残す（§9.212 ②）
    4. 一覧の列が「すべて／残る機能名／なし」と**文字で**言う（§3）
    5. 編集の窓は「使う機能」の札で、押すと隠し欄が裏返る（0個なら警告）
    6. 測定の使用設備の候補から落ちる。**いま選んでいる設備は落とさない**
       （§9.15。落とすと直す手立てまで消える）／伏せた件数を文字で書く（§4）
    7. 作業予定の設備の候補から落ちる。**いま開いている設備は落とさない**
    8. 帳票は**ロットが1件も無い設備だけ**落ちる（記録のある設備は履歴なので残す）

   **「札が並ぶ」だけを見ないこと**——候補が実際に減ること・減らないことの
   両方を見る（片側だけの網は、絞りすぎる実装も絞らない実装も素通しする）。 */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const API='http://127.0.0.1:5029';
const PRE='機能テスト設備';
const NAME=PRE+Date.now().toString().slice(-6);
const EQ='テスト設備A';   /* フィクスチャにロットのある設備（履歴側の確認に使う） */

let b=null,page=null;
const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};

/* 作った設備は必ず消す。設備マスタは master.sqlite3 なので、残すと後続の
   俯瞰ボード・設備の件数が変わる（§9.121）。 */
async function cleanup(){
 if(!page)return;
 try{
  await page.evaluate(async pre=>{
   const r=await fetch('/api/equipment-master',{cache:'no-store'}).then(x=>x.json());
   for(const it of (r.items||[])) if(String(it.name||'').startsWith(pre))
    await fetch('/api/equipment-master/delete',{method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({id:it.id,force:true,user_id:'tests'})});
  },PRE);
 }catch(e){console.log('  [cleanup]',e.message)}
}

(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 page=await b.newPage({viewport:{width:1700,height:1000}});
 page.on('dialog',d=>d.accept());
 page.on('pageerror',e=>console.log('  [pageerror]',e.message));
 try{
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:30000});
  await page.evaluate(e=>{localStorage.setItem('AccessMeasurementUserId','tester');
    localStorage.setItem('AccessMeasurementConfiguredEquipment',e);
    return fetch('/api/access-mode',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({mode:'edit'})})},EQ);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:30000});

  const post=(u,body)=>page.evaluate(a=>fetch(a.u,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(Object.assign({user_id:'tests'},a.b))}).then(async r=>({status:r.status,body:await r.json().catch(()=>({}))})),{u,b:body||{}});
  const master=()=>page.evaluate(()=>fetch('/api/equipment-master',{cache:'no-store'}).then(x=>x.json()));
  const one=async n=>((await master()).items||[]).find(x=>x.name===n)||null;

  await cleanup();

  /* ---- 1) 語彙はサーバーが答える ---- */
  const m0=await master();
  const vocab=(m0.equipmentFeatures||[]);
  rec('機能の語彙をサーバーが返す（キー・呼び名・一言）',
   vocab.length===3&&vocab.map(v=>v.key).join(',')==='measure,schedule,report'
   &&vocab.every(v=>v.label&&v.note),JSON.stringify(vocab.map(v=>v.key)));
  /* **画面のJSに綴りを書き写していないこと**（§9.163）——写すと機能を1つ
     足したときに直す場所が2つになる。設備マスタの欄の型は`source.key`で
     サーバーの戻りを読むだけ、という作りをここで固定する。 */
  const js=await page.evaluate(async()=>{
   const t=await fetch('/js/master-maint.js',{cache:'no-store'}).then(r=>r.text());
   /* 説明文（`more`／`hint`）には呼び名が出てよい。見るのは**綴りの配列**。 */
   return {配列:/\[\s*['"]measure['"]\s*,\s*['"]schedule['"]/.test(t)};
  });
  rec('画面のJSに機能の綴りの一覧を書き写していない',js.配列===false,JSON.stringify(js));

  /* ---- 2) 空欄＝すべて使える ---- */
  const made=await post('/api/equipment-master',{name:NAME});
  rec('設備を作れる',made.status===200&&made.body&&made.body.ok!==false,JSON.stringify(made.body).slice(0,120));
  const fresh=await one(NAME);
  rec('作ったばかりの設備はすべての機能で使える（空欄＝すべて）',
   !!fresh&&Object.keys(fresh.features||{}).length===3
   &&Object.values(fresh.features).every(v=>v===true)
   &&Array.isArray(fresh.disabledFeatures)&&fresh.disabledFeatures.length===0,
   JSON.stringify(fresh&&fresh.features));
  const old=((await master()).items||[]).find(x=>x.name===EQ);
  rec('もともと在る設備も触っていなければすべて使える',
   !!old&&Object.values(old.features||{}).every(v=>v===true),JSON.stringify(old&&old.features));

  /* ---- 3) 保存・知らない綴り・送らなかったとき ---- */
  const eid=fresh&&fresh.id;
  await post('/api/equipment-master/update',{id:eid,name:NAME,disabledFeatures:['measure','ありえない機能']});
  const off1=await one(NAME);
  rec('外した機能が保存され、知らない綴りは捨てる',
   !!off1&&off1.disabledFeatures.join(',')==='measure'&&off1.features.measure===false
   &&off1.features.schedule===true&&off1.features.report===true,
   JSON.stringify(off1&&off1.disabledFeatures));
  /* §9.212 ②。**送っていない設定は今の値を残す**——ここで空へ倒すと、
     名前を1文字直しただけで設定が黙って消える（同じ形で5度踏んでいる）。 */
  await post('/api/equipment-master/update',{id:eid,name:NAME,kind:'コイル'});
  const keep=await one(NAME);
  rec('disabledFeaturesを送らない更新では今の値が残る',
   !!keep&&keep.disabledFeatures.join(',')==='measure'&&keep.kind==='コイル',
   JSON.stringify(keep&&{d:keep.disabledFeatures,k:keep.kind}));
  await post('/api/equipment-master/update',{id:eid,name:NAME,disabledFeatures:[]});
  const back=await one(NAME);
  rec('空で送れば全部使える状態へ戻る',
   !!back&&back.disabledFeatures.length===0&&Object.values(back.features).every(v=>v===true),
   JSON.stringify(back&&back.disabledFeatures));

  /* ---- 4) 一覧の列（§3 色だけで伝えない） ---- */
  /* マスタの束は畳めるので（§9.250 ①）、**畳まれていたら開いてから押す**。
     番号ではなく`data-master`で選ぶ（並びが変わっても落ちない）。 */
  const pickEquipTab=async()=>{
   await page.evaluate(()=>{
    const hit=()=>document.querySelector('#masterMaintNav [data-master="equipment"]');
    if(!hit())document.querySelectorAll('#masterMaintNav [data-nav-fold]').forEach(g=>g.click());
    const b=hit();if(b)b.click();
   });
   await page.waitForFunction(()=>document.querySelectorAll('#masterMaintList .mm-row').length>1,
     null,{timeout:15000});
   await page.waitForTimeout(400);
  };
  const openEquipTab=async()=>{
   await page.click('#openMasterMaint');
   await page.waitForSelector('#masterMaintPanel',{state:'visible',timeout:15000});
   await pickEquipTab();
  };
  const cellOf=n=>page.evaluate(name=>{
   const head=[...document.querySelectorAll('#masterMaintList .mm-row.head>span')].map(s=>s.textContent.trim());
   const i=head.indexOf('使える機能');
   if(i<0)return {列なし:true,見出し:head};
   const row=[...document.querySelectorAll('#masterMaintList .mm-row:not(.head)')]
     .find(r=>[...r.querySelectorAll('span')].some(s=>s.textContent.trim()===name));
   if(!row)return {行なし:true};
   const cells=[...row.querySelectorAll('span')];
   return {文字:(cells[i]||{}).textContent?cells[i].textContent.trim():''};
  },n);
  await openEquipTab();
  const all=await cellOf(NAME);
  rec('一覧に「使える機能」の列があり、全部使えるときは「すべて」',
   all.文字==='すべて',JSON.stringify(all));
  await post('/api/equipment-master/update',{id:eid,name:NAME,disabledFeatures:['report']});
  await pickEquipTab();
  const some=await cellOf(NAME);
  rec('一部だけのときは残る機能の名前が並ぶ',
   some.文字==='測定 / 作業予定',JSON.stringify(some));
  await post('/api/equipment-master/update',{id:eid,name:NAME,disabledFeatures:['measure','schedule','report']});
  await pickEquipTab();
  const none=await cellOf(NAME);
  rec('0個のときは「なし」と書き切る（空欄にしない）',
   /^なし/.test(none.文字||''),JSON.stringify(none));

  /* ---- 5) 編集の窓は「使う機能」の札 ---- */
  await post('/api/equipment-master/update',{id:eid,name:NAME,disabledFeatures:[]});
  await pickEquipTab();
  await page.evaluate(name=>{
   const row=[...document.querySelectorAll('#masterMaintList .mm-row:not(.head)')]
     .find(r=>[...r.querySelectorAll('span')].some(s=>s.textContent.trim()===name));
   if(row)row.click();
  },NAME);
  await page.waitForSelector('#maintEditorModal:not([hidden]) [data-checkset-box="disabledFeatures"]',{timeout:10000});
  const panel=()=>page.evaluate(()=>{
   const box=document.querySelector('#maintEditorModal [data-checkset-box="disabledFeatures"]');
   if(!box)return {無い:true};
   const btns=[...box.querySelectorAll('[data-checkset]')];
   const hid=box.querySelector('[data-field="disabledFeatures"]');
   const note=box.querySelector('[data-checkset-note="disabledFeatures"]');
   return {札:btns.map(x=>({v:x.dataset.checksetV,on:x.getAttribute('aria-pressed')==='true',
                            文字:(x.querySelector('b')||{}).textContent||''})),
           隠し:hid?hid.value:null,注記:note?note.textContent.trim():'',
           警告:note?note.classList.contains('is-warn'):false};
  });
  const p0=await panel();
  rec('編集の窓に機能の札が3枚出て、既定は全部「使う」',
   !p0.無い&&p0.札.length===3&&p0.札.every(x=>x.on)&&p0.隠し===''
   &&/すべての機能/.test(p0.注記),JSON.stringify({札:p0.札,隠:p0.隠し,注:p0.注記}));
  rec('札の文字は呼び名（綴りを出さない）',
   !p0.無い&&p0.札.map(x=>x.文字).join(',')==='測定,作業予定,帳票',
   JSON.stringify(p0.札&&p0.札.map(x=>x.文字)));
  await page.click('#maintEditorModal [data-checkset="disabledFeatures"][data-checkset-v="measure"]');
  const p1=await panel();
  rec('札を押すと隠し欄が「使わない機能」で裏返る',
   p1.隠し==='measure'&&p1.札[0].on===false&&/測定では使いません/.test(p1.注記),
   JSON.stringify({隠:p1.隠し,注:p1.注記}));
  await page.click('#maintEditorModal [data-checkset="disabledFeatures"][data-checkset-v="schedule"]');
  await page.click('#maintEditorModal [data-checkset="disabledFeatures"][data-checkset-v="report"]');
  const p2=await panel();
  rec('全部外したら「どこにも出ない」と言い切って警告する（§4）',
   p2.隠し==='measure,schedule,report'&&p2.警告===true&&/どの機能でも使いません/.test(p2.注記),
   JSON.stringify({隠:p2.隠し,警告:p2.警告,注:p2.注記}));
  /* 窓から保存すると本当にマスタへ入るか（押せただけの網にしない）。 */
  await page.click('#maintEditorModal [data-checkset="disabledFeatures"][data-checkset-v="schedule"]');
  await page.click('#maintEditorModal [data-checkset="disabledFeatures"][data-checkset-v="report"]');
  await page.click('#maintEditorSave');
  await page.waitForTimeout(1500);
  const saved=await one(NAME);
  rec('窓から保存すると設備マスタへ入る',
   !!saved&&saved.disabledFeatures.join(',')==='measure'&&saved.features.measure===false,
   JSON.stringify(saved&&saved.disabledFeatures));
  await page.evaluate(()=>{const b=document.getElementById('maintEditorClose');if(b)b.click();
    const d=document.getElementById('maintEditorModal');if(d)d.hidden=true});
  await page.evaluate(()=>{const b=document.getElementById('closeMasterMaint');if(b)b.click()});
  await page.waitForTimeout(400);

  /* ---- 6) 測定の使用設備（measure） ----
     **状態はAPIで作る**——窓からの保存は上の節が別に見ているので、ここで
     そちらに寄りかかると、落ちたときにどちらが壊れたのか読めなくなる。 */
  await post('/api/equipment-master/update',{id:eid,name:NAME,disabledFeatures:['measure']});
  const eqSel=async()=>{
   await page.evaluate(()=>{if(typeof loadEquipmentMaster==='function')return loadEquipmentMaster(true)});
   await page.evaluate(()=>{if(typeof openEquipmentSettingsFinal==='function')return openEquipmentSettingsFinal('manual','')});
   await page.waitForSelector('#configuredEquipment',{timeout:10000});
   await page.waitForTimeout(400);
   return page.evaluate(()=>({
    候補:[...document.querySelectorAll('#configuredEquipment option')].map(o=>o.value),
    助け:(document.getElementById('equipmentMasterHelp')||{}).textContent||''}));
  };
  const s1=await eqSel();
  rec('測定を外した設備は使用設備の候補に出ない',
   s1.候補.indexOf(NAME)<0,JSON.stringify(s1.候補));
  rec('伏せた件数を文字で書く（§4）',
   /出していません/.test(s1.助け)&&/1件/.test(s1.助け),JSON.stringify(s1.助け).slice(0,180));
  rec('外していない設備は今までどおり候補に出る',
   s1.候補.indexOf(EQ)>=0,JSON.stringify(s1.候補));
  await page.evaluate(()=>{const m=document.getElementById('equipmentSettingsModal');if(m)m.hidden=true});
  /* **いま選んでいる設備は落とさない**（§9.15）。 */
  await page.evaluate(n=>localStorage.setItem('AccessMeasurementConfiguredEquipment',n),NAME);
  const s2=await eqSel();
  rec('いま選んでいる設備は外していても候補に残る（直す手立てを消さない）',
   s2.候補.indexOf(NAME)>=0,JSON.stringify(s2.候補));
  await page.evaluate(()=>{const m=document.getElementById('equipmentSettingsModal');if(m)m.hidden=true});
  await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);

  /* ---- 7) 作業予定の設備（schedule） ---- */
  await post('/api/equipment-master/update',{id:eid,name:NAME,disabledFeatures:['schedule']});
  await page.evaluate(()=>fetch('/api/access-mode',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({mode:'schedule'})}));
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:30000});
  await page.click('#openSchedule');
  await page.waitForSelector('#scModeToggle',{state:'visible',timeout:25000});
  /* scheduleモードの既定は全体俯瞰（`board`）で、そのあいだ設備の選択欄は
     伏せてある。**1設備ぶんの表へ切り替えてから見ること**——伏せた要素を
     待つと永久に来ない。 */
  await page.click('#scModeSingle');
  await page.waitForSelector('#scEquipmentSelect',{state:'visible',timeout:25000});
  await page.waitForFunction(()=>{
   const s=document.getElementById('scEquipmentSelect');return s&&s.options.length>1;
  },null,{timeout:25000});
  const sc1=await page.evaluate(()=>({
   候補:[...document.querySelectorAll('#scEquipmentSelect option')].map(o=>o.value),
   説明:(document.getElementById('scEquipmentSelect')||{}).title||''}));
  rec('作業予定を外した設備はスケジュールの設備の候補に出ない',
   sc1.候補.indexOf(NAME)<0&&sc1.候補.indexOf(EQ)>=0,JSON.stringify(sc1.候補));
  rec('絞ったことを説明に書く（§4）',
   /出していません/.test(sc1.説明),JSON.stringify(sc1.説明).slice(0,180));
  /* **いま開いている設備は落とさない**（§9.15）。
     開いてから外す、という現場で起きる順でしか通らない道なので、
     ①使える状態で選ぶ →②外す →③画面へ入り直す、の順で作る。 */
  /* 設備マスタを直せるのは編集モードだけ（`_WRITE_ALLOWED_MODES['masters']`）
     なので、**直すあいだだけ編集モードへ移る**。画面は再読み込みしないので
     `scState.equipment`（いま開いている設備）はそのまま残る。 */
  const setMode=m=>page.evaluate(mm=>fetch('/api/access-mode',{method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:mm})}),m);
  /* 設備マスタはタブを開いているあいだ持ち回るので、**取り直してから**
     画面へ入り直す（別のPCが直した設定は、この端末では古いまま残る）。 */
  const reloadEq=()=>page.evaluate(()=>{
   if(typeof loadEquipmentMaster==='function')return loadEquipmentMaster(true)});
  const reenterSchedule=async()=>{
   await page.click('#openMasterMaint');
   await page.waitForSelector('#masterMaintPanel',{state:'visible',timeout:15000});
   await page.click('#openSchedule');
   await page.waitForSelector('#scModeSingle',{state:'visible',timeout:25000});
   /* scheduleモードの既定は全体俯瞰なので、入り直すたびに個別へ戻す。 */
   await page.click('#scModeSingle');
   await page.waitForSelector('#scEquipmentSelect',{state:'visible',timeout:25000});
   await page.waitForTimeout(800);
  };
  await setMode('edit');
  await post('/api/equipment-master/update',{id:eid,name:NAME,disabledFeatures:[]});
  await setMode('schedule');
  await reloadEq();
  await reenterSchedule();
  await page.waitForFunction(n=>[...document.querySelectorAll('#scEquipmentSelect option')]
    .some(o=>o.value===n),NAME,{timeout:25000});
  await page.selectOption('#scEquipmentSelect',NAME);
  await page.waitForTimeout(1500);
  await setMode('edit');
  await post('/api/equipment-master/update',{id:eid,name:NAME,disabledFeatures:['schedule']});
  await setMode('schedule');
  await reloadEq();
  await reenterSchedule();
  const sc2=await page.evaluate(()=>({
   候補:[...document.querySelectorAll('#scEquipmentSelect option')].map(o=>o.value),
   いま:(document.getElementById('scEquipmentSelect')||{}).value}));
  rec('いま開いている設備は外していても候補に残る',
   sc2.候補.indexOf(NAME)>=0&&sc2.いま===NAME,JSON.stringify(sc2));

  /* ---- 8) 帳票（report）——ロットの無い設備だけ落ちる ---- */
  await page.evaluate(()=>fetch('/api/access-mode',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({mode:'edit'})}));
  await post('/api/equipment-master/update',{id:eid,name:NAME,disabledFeatures:['report']});
  /* フィクスチャの設備も帳票から外し、**記録があるほうは残る**ことを見る。 */
  const fixture=((await master()).items||[]).find(x=>x.name===EQ);
  if(fixture)await post('/api/equipment-master/update',
    {id:fixture.id,name:EQ,disabledFeatures:['report']});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:30000});
  /* 帳票はデータ一覧の行の「帳票」から開く（操作レールの`#openReport`は
     測定を開いているときだけ出る）。 */
  await page.evaluate(()=>openRecordsSafe('編集中'));
  await page.waitForSelector('.record-list-row',{timeout:25000});
  await page.click('.record-list-row .report');
  await page.waitForSelector('#reportContent .rp-blocks',{timeout:25000});
  await page.waitForTimeout(1200);
  await page.click('#reportArrange');
  await page.waitForSelector('#rpArrangeBar:not([hidden])',{timeout:15000});
  await page.waitForTimeout(600);
  const rp=await page.evaluate(e=>{
   const s=document.querySelector('#rpArrangeBar [data-rp-eq]');
   if(!s)return {無い:true};
   /* **前提を先に確かめる**（§9.108の作法）——この設備が帳票から外れていて、
      かつ**この端末にロットがある**ことまで見ないと、下の2つは
      「たまたま外れていなかった」でも通ってしまう。 */
   const m=(typeof equipmentMasterState!=='undefined'?equipmentMasterState.items:[])||[];
   const hit=m.find(x=>x.name===e);
   const lots=[...s.options].find(o=>o.value===e);
   return {候補:[...s.options].map(o=>o.value),
           外れている:!!hit&&hit.features&&hit.features.report===false,
           札:lots?lots.textContent.trim():''};
  },EQ);
  rec('前提: 記録のある設備を帳票から外せている＆この端末にロットがある',
   !rp.無い&&rp.外れている===true&&/（\d+件）/.test(rp.札),JSON.stringify(rp));
  rec('帳票を外した設備（ロットなし）は配置の候補に出ない',
   !rp.無い&&rp.候補.indexOf(NAME)<0,JSON.stringify(rp.候補));
  rec('記録のある設備は帳票を外しても候補に残る（履歴を隠さない）',
   !rp.無い&&rp.候補.indexOf(EQ)>=0,JSON.stringify(rp.候補));
  if(fixture)await post('/api/equipment-master/update',{id:fixture.id,name:EQ,disabledFeatures:[]});

 }catch(e){
  rec('FATAL',false,e&&e.message);
 }finally{
  try{
   /* フィクスチャの設備は必ず既定へ戻す（置き土産を残さない・§9.121）。 */
   if(page)await page.evaluate(async n=>{
    const r=await fetch('/api/equipment-master',{cache:'no-store'}).then(x=>x.json());
    const it=(r.items||[]).find(x=>x.name===n);
    if(it&&(it.disabledFeatures||[]).length)
     await fetch('/api/equipment-master/update',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({id:it.id,name:n,disabledFeatures:[],user_id:'tests'})});
   },EQ);
  }catch(e){console.log('  [restore]',e.message)}
  await cleanup();
  if(b)await b.close();
 }
 const ng=R.filter(x=>!x.ok).length;
 console.log(`\n${R.length-ng} PASS / ${ng} FAIL`);
 process.exit(ng?1:0);
})();
