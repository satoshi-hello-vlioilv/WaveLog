/* test_measitems.js: 測定画面の入力内容を設備ごとに出し分ける（§9.392）
   ------------------------------------------------------------------
   利用者の指示:
    「測定画面の入力内容を、設備ごとに使う使わないと切り替えられるように
     してください。」

   ここで固定すること:
    1. 語彙は**サーバーが答える**（`measureItems`）——画面へ書き写さない（§9.163）
    2. **保存値は「使わない入力内容」**——空欄＝すべて使える（§9.302と同じ作法）
    3. 知らない綴りは捨てる／送っていないときは今の値を残す（§9.212 ②）
    4. **すべては外せない**——1つも選べない測定画面を作らせない（§CLAUDE 4）。
       断りは400で、**次にどうすればよいか**（使える機能の「測定」）まで言う
    5. 一覧の列と編集の窓が**文字で**言う（§CLAUDE 3）
    6. 測定画面で**外した項目が選択肢からもチップからも消える**
    7. **値が入っている項目は外しても伏せない**——見えないものは直せない

   **「札が並ぶ」だけを見ないこと**——測定画面から実際に消えること・
   消えないことの両方を見る（片側だけの網は、消しすぎる実装も
   消さない実装も素通しする）。 */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const API='http://127.0.0.1:5029';
const PRE='入力内容テスト設備';
const NAME=PRE+Date.now().toString().slice(-6);
const EQ='テスト設備A';   /* 測定画面を開いて確かめる設備 */

let b=null,page=null;
const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
const H=require('./lib/harness.js');
let snapM=null,eqBack=null;

/* 作った設備は消し、**借りた設備（テスト設備A）は元の設定へ戻す**（§9.362）。
   戻さないと、以降の網が「入力内容が3つしか無い測定画面」を見ることになる。 */
async function cleanup(){
 if(!page)return;
 try{
  await page.evaluate(async a=>{
   const r=await fetch('/api/equipment-master',{cache:'no-store'}).then(x=>x.json());
   for(const it of (r.items||[])){
    if(String(it.name||'').startsWith(a.pre))
     await fetch('/api/equipment-master/delete',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({id:it.id,force:true,user_id:'tests'})});
    if(a.back&&it.name===a.eq)
     await fetch('/api/equipment-master/update',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({id:it.id,name:it.name,disabledMeasureItems:a.back,user_id:'tests'})});
   }
  },{pre:PRE,eq:EQ,back:eqBack});
 }catch(e){console.log('  [cleanup]',e.message)}
 try{await H.clearRecords()}catch(e){console.log('  [cleanup] 実績を消せません: '+(e&&e.message||e))}
 try{if(snapM)await H.dropNewMasterRows(snapM)}
 catch(e){console.log('  [cleanup] 増えた行を消せませんでした: '+(e&&e.message||e))}
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

  snapM=await H.masterSnapshot(['設備マスタ']);
  await cleanup();
  const borrowed=await one(EQ);
  eqBack=(borrowed&&borrowed.disabledMeasureItems)||[];

  /* ---- 1) 語彙はサーバーが答える ---- */
  const m0=await master();
  const vocab=m0.measureItems||[];
  rec('入力内容の語彙をサーバーが返す（9項目・呼び名・一言つき）',
   vocab.length===9&&vocab.map(v=>v.key).join(',')==='母材,丈毎,板厚,板幅,ラテラルボー,バリ,テレスコープ,巻ずれ,フラットネス'
   &&vocab.every(v=>v.label&&v.note),JSON.stringify(vocab.map(v=>v.key)));
  /* **画面のJSに綴りの一覧を書き写していないこと**（§9.163）。マスタ側の
     定義は`source.key`でサーバーの戻りを読むだけ、という作りを固定する。
     測定画面の`WL.measureItem.ALL`は**画面の並びを決める別の役**なので、
     ここで見るのはマスタ管理の5本だけ。 */
  const js=await page.evaluate(async()=>{
   const t=(await Promise.all(['master/master-defs','master/master-maint','master/master-report',
                              'master/master-data','master/master-opdata']
     .map(n=>fetch('/static/js/'+n+'.js',{cache:'no-store'}).then(r=>r.text())))).join('\n');
   if(t.length<20000)throw new Error('画面のJSを読めていない（取れた長さ '+t.length+'）');
   return {配列:/['"]ラテラルボー['"]\s*,\s*['"]バリ['"]/.test(t)};
  });
  rec('マスタ管理のJSに入力内容の綴りの一覧を書き写していない',js.配列===false,JSON.stringify(js));

  /* ---- 2) 空欄＝すべて使える ---- */
  const made=await post('/api/equipment-master',{name:NAME});
  rec('設備を作れる',made.status===200&&made.body&&made.body.ok!==false,JSON.stringify(made.body).slice(0,120));
  const fresh=await one(NAME);
  rec('作ったばかりの設備は入力内容をすべて使う（空欄＝すべて）',
   !!fresh&&Array.isArray(fresh.disabledMeasureItems)&&fresh.disabledMeasureItems.length===0,
   JSON.stringify(fresh&&fresh.disabledMeasureItems));

  /* ---- 3) 保存・知らない綴り・送らなかったとき ---- */
  const eid=fresh&&fresh.id;
  await post('/api/equipment-master/update',{id:eid,name:NAME,
    disabledMeasureItems:['テレスコープ','ありえない項目','バリ']});
  const off1=await one(NAME);
  rec('外した入力内容が保存され、知らない綴りは捨てる',
   !!off1&&off1.disabledMeasureItems.join(',')==='バリ,テレスコープ',
   JSON.stringify(off1&&off1.disabledMeasureItems));
  rec('並びは語彙の順（保存の書き順に引きずられない）',
   !!off1&&off1.disabledMeasureItems[0]==='バリ',
   JSON.stringify(off1&&off1.disabledMeasureItems));
  await post('/api/equipment-master/update',{id:eid,name:NAME,kind:'コイル'});
  const keep=await one(NAME);
  rec('disabledMeasureItemsを送らない更新では今の値が残る',
   !!keep&&keep.disabledMeasureItems.join(',')==='バリ,テレスコープ'&&keep.kind==='コイル',
   JSON.stringify(keep&&{d:keep.disabledMeasureItems,k:keep.kind}));

  /* ---- 4) すべては外せない（§CLAUDE 4） ---- */
  const allOff=await post('/api/equipment-master/update',{id:eid,name:NAME,
    disabledMeasureItems:vocab.map(v=>v.key)});
  rec('入力内容を全部外そうとすると400で断る',
   allOff.status===400,`${allOff.status} ${JSON.stringify(allOff.body).slice(0,80)}`);
  rec('断りの文が「次にどうすればよいか」まで言う（使える機能の「測定」）',
   /測定/.test((allOff.body||{}).error||'')&&/1つ以上/.test((allOff.body||{}).error||''),
   (allOff.body||{}).error||'');
  const after400=await one(NAME);
  rec('断ったときは1文字も書き換えない',
   !!after400&&after400.disabledMeasureItems.join(',')==='バリ,テレスコープ',
   JSON.stringify(after400&&after400.disabledMeasureItems));
  const newAllOff=await post('/api/equipment-master',{name:NAME+'x',
    disabledMeasureItems:vocab.map(v=>v.key)});
  rec('新規登録でも全部外しは断る',newAllOff.status===400,String(newAllOff.status));

  /* ---- 5) 一覧の列と編集の窓（§CLAUDE 3） ---- */
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
  const cellOf=n=>page.evaluate(name=>{
   const head=[...document.querySelectorAll('#masterMaintList .mm-row.head>span')].map(s=>s.textContent.trim());
   const i=head.indexOf('使う入力内容');
   if(i<0)return {列なし:true,見出し:head};
   const row=[...document.querySelectorAll('#masterMaintList .mm-row:not(.head)')]
     .find(r=>[...r.querySelectorAll('span')].some(s=>s.textContent.trim()===name));
   if(!row)return {行なし:true};
   const cells=[...row.querySelectorAll('span')];
   return {文字:(cells[i]||{}).textContent?cells[i].textContent.trim():''};
  },n);
  await page.click('#openMasterMaint');
  await page.waitForSelector('#masterMaintPanel',{state:'visible',timeout:15000});
  await pickEquipTab();
  const some=await cellOf(NAME);
  rec('一覧に「使う入力内容」の列があり、残る項目の名前が並ぶ',
   !some.列なし&&!some.行なし&&/母材/.test(some.文字||'')&&!/バリ/.test(some.文字||''),
   JSON.stringify(some));
  await post('/api/equipment-master/update',{id:eid,name:NAME,disabledMeasureItems:[]});
  await pickEquipTab();
  const all=await cellOf(NAME);
  rec('全部使うときは「すべて」の1語で済ませる',all.文字==='すべて',JSON.stringify(all));

  await page.evaluate(name=>{
   const row=[...document.querySelectorAll('#masterMaintList .mm-row:not(.head)')]
     .find(r=>[...r.querySelectorAll('span')].some(s=>s.textContent.trim()===name));
   if(row)row.click();
  },NAME);
  await page.waitForSelector('#maintEditorModal:not([hidden]) [data-checkset-box="disabledMeasureItems"]',{timeout:10000});
  const panel=()=>page.evaluate(()=>{
   const box=document.querySelector('#maintEditorModal [data-checkset-box="disabledMeasureItems"]');
   if(!box)return {無い:true};
   const btns=[...box.querySelectorAll('[data-checkset]')];
   const hid=box.querySelector('[data-field="disabledMeasureItems"]');
   const note=box.querySelector('[data-checkset-note="disabledMeasureItems"]');
   return {札:btns.map(x=>({v:x.dataset.checksetV,on:x.getAttribute('aria-pressed')==='true'})),
           隠し:hid?hid.value:null,注記:note?note.textContent.trim():''};
  });
  const p0=await panel();
  rec('編集の窓に入力内容の札が9枚出て、既定は全部「使う」',
   !p0.無い&&p0.札.length===9&&p0.札.every(x=>x.on)&&p0.隠し===''
   &&/すべての入力内容/.test(p0.注記),JSON.stringify({数:p0.札&&p0.札.length,隠:p0.隠し,注:p0.注記}));
  await page.click('#maintEditorModal [data-checkset="disabledMeasureItems"][data-checkset-v="バリ"]');
  const p1=await panel();
  /* **一言は「機能」ではなく「入力内容」で言う**（同じ箱を使い回すので、
     文言を機能に固定すると片方が別のことを言う）。 */
  rec('札を押すと隠し欄が「使わない入力内容」で裏返り、一言もこの欄の言葉で言う',
   p1.隠し==='バリ'&&/測定画面に出しません/.test(p1.注記),JSON.stringify({隠:p1.隠し,注:p1.注記}));
  await page.click('#maintEditorSave');
  await page.waitForTimeout(1500);
  const saved=await one(NAME);
  rec('窓から保存すると設備マスタへ入る',
   !!saved&&saved.disabledMeasureItems.join(',')==='バリ',
   JSON.stringify(saved&&saved.disabledMeasureItems));
  await page.evaluate(()=>{const b=document.getElementById('maintEditorClose');if(b)b.click();
    const d=document.getElementById('maintEditorModal');if(d)d.hidden=true;
    const c=document.getElementById('closeMasterMaint');if(c)c.click()});
  await page.waitForTimeout(400);

  /* ---- 6) 測定画面から消える ---- */
  const target=await one(EQ);
  await post('/api/equipment-master/update',{id:target.id,name:EQ,
    disabledMeasureItems:['テレスコープ','フラットネス']});
  const openMeasure=async()=>{
   await page.goto(API+'/',{waitUntil:'domcontentloaded'});
   await page.waitForSelector('#openSchedule',{timeout:25000});
   await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
   await page.click('#openSchedule');
   await page.waitForSelector('.sc-row-line',{timeout:25000});
   const ok=await page.evaluate(()=>{
    const r=[...document.querySelectorAll('.sc-row-line')].find(x=>x.querySelector('.sc-row-start'));
    if(r){r.querySelector('.sc-row-start').click();return true}return false;
   });
   if(!ok)throw Error('開始できる行が無い');
   await page.waitForFunction(()=>!document.querySelector('#measureModal')?.hidden,null,{timeout:25000});
   await page.waitForFunction(()=>typeof S!=='undefined'&&!!S.measure,null,{timeout:25000});
   await page.evaluate(()=>WL.measureSteps.go('2'));
   /* **届いてから測る**（§9.102）——設備の設定は`/api/measurement/context`で
      来るので、固定待ちだと「まだ届いていない画面」を測ることになる。 */
   await page.waitForFunction(
     ()=>Array.isArray(S.measure&&S.measure.settings&&S.measure.settings.measureItemsOff),
     null,{timeout:20000});
   await page.waitForTimeout(400);
  };
  const shown=()=>page.evaluate(()=>({
   選択肢:[...document.querySelectorAll('#measureType option')].map(o=>o.text.trim()),
   チップ:[...document.querySelectorAll('.type-chip')].map(x=>x.dataset.typeChip),
   いま:document.querySelector('#measureType').value,
   伏せ:(S.measure.settings.measureItemsOff||[]).slice(),
  }));
  await openMeasure();
  const v1=await shown();
  rec('外した入力内容が選択肢から消える',
   v1.選択肢.length===7&&!v1.選択肢.includes('テレスコープ')&&!v1.選択肢.includes('フラットネス'),
   JSON.stringify(v1.選択肢));
  rec('チップからも同じだけ消える（選択肢とチップで食い違わない）',
   v1.チップ.join(',')===v1.選択肢.join(','),JSON.stringify(v1.チップ));
  rec('設備の設定が測定のレコードへ届いている',
   v1.伏せ.join(',')==='テレスコープ,フラットネス',JSON.stringify(v1.伏せ));

  /* ---- 7) 値が入っている項目は伏せない（§9.107の裏） ---- */
  const kept=await page.evaluate(async()=>{
   /* 「テレスコープ」に1件だけ入れて、設備の設定はそのままに数え直す。 */
   S.measure.measurements.telescope[0][0]='1.23';
   refreshMeasureProgress();
   WL.measureView.applyMeasureItemOptions();
   await new Promise(r=>setTimeout(r,150));
   return {選択肢:[...document.querySelectorAll('#measureType option')].map(o=>o.text.trim()),
           チップ:[...document.querySelectorAll('.type-chip')].map(x=>x.dataset.typeChip)};
  });
  rec('値が入っている項目は外してあっても伏せない（見えないものは直せない）',
   kept.選択肢.includes('テレスコープ')&&!kept.選択肢.includes('フラットネス')
   &&kept.チップ.includes('テレスコープ'),JSON.stringify(kept.選択肢));

  console.log('\n=== SUMMARY ===');
  const ng=R.filter(x=>!x.ok);console.log(`${R.length-ng.length}/${R.length} passed`);
  ng.forEach(x=>console.log(' -',x.n,x.d||''));
  await cleanup();
  await b.close();
  process.exit(ng.length?1:0);
 }catch(e){
  console.log('FATAL: '+(e&&e.message));
  await cleanup();
  if(b)await b.close();
  process.exit(2);
 }
})();
