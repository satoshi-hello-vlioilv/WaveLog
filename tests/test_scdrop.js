/* test_scdrop.js: 予定から外す受け皿（§9.116）
   ------------------------------------------------------------
   タイムラインの行を掴んで下端の帯へ落とすと、その予定を外せる。

   ここで固定すること:
    - **掴んでいる間だけ出す。** 常設すると「消す場所」が画面に居座り、
      並べ替えのたびに押し間違いの的になる。離したら必ず引っ込める。
    - **外せない行では出さない。** 実施中・完了・計画外は外せないので、
      出しておいて落としたら断る、では掴んだ手間が無駄になる。
    - **落とせば本当に消える。** 確認は deleteEntry のものをそのまま通す
      （確認の文言と取り消しの作法を2つに増やさない）。
    - **受け皿が並べ替えを確定させない。** 帯へ来るまでに行のdragoverで
      DOMは動いているが、外すのが目的なので途中の位置は保存しない。
    - **重なり順。** 帯が本文の下に隠れていると、DOMには居るのに掴めない
      （ゴーストで実際に起きた。z-indexの直値を書かないこと）。

   HTML5のD&DはPlaywrightのマウス操作では飛ばないので、dragstart/drop を
   直接発火して確かめる（実機の経路と同じハンドラを通る）。 */
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
 const post=(p,body)=>page.evaluate(async a=>{
  const r=await fetch(a.p,{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify(Object.assign({user_id:'test-scdrop'},a.b))});
  let j={};try{j=await r.json()}catch(e){}
  return {status:r.status,body:j};
 },{p,b:body||{}});
 const plan=()=>page.evaluate(async e=>{
  const r=await fetch('/api/schedule/plan?equipment='+encodeURIComponent(e));
  return (await r.json()).entries||[];
 },EQ);
 let madeId=null;

 try{
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.evaluate(e=>{localStorage.setItem('AccessMeasurementConfiguredEquipment',e);
                          localStorage.setItem('AccessMeasurementUserId','tester')},EQ);
  await setMode('schedule');

  /* 落として消すための行を1件だけ自分で作る。**既存の行を消さない**
     ——フィクスチャは他のテストも読むので、消すのは自分が作ったものだけ。 */
  const stops=await page.evaluate(async e=>{
   const r=await fetch('/api/schedule/stop-reason-master?equipment='+encodeURIComponent(e));
   return (await r.json()).items||[];
  },EQ);
  await post('/api/schedule/session/acquire',{equipment:EQ});
  const add=await post('/api/schedule/plan/add',
    {equipment:EQ,kind:'設備停止',stopReasonId:stops[0]&&stops[0].id});
  madeId=add.body&&add.body.id;
  rec('外す用の予定を1件作れた',add.status===200&&!!madeId,`${add.status} ${JSON.stringify(add.body).slice(0,90)}`);

  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.waitForSelector('#openSchedule',{timeout:25000});
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-board-row',{timeout:25000});
  await page.evaluate(e=>{const r=[...document.querySelectorAll('.sc-board-row')]
    .find(x=>x.dataset.equipment===e);if(r)r.click()},EQ);
  await page.waitForSelector('.sc-row-line',{timeout:30000});
  await page.waitForFunction(id=>[...document.querySelectorAll('.sc-row-line')]
    .some(r=>r.dataset.id===String(id)),madeId,{timeout:30000});

  /* ---- 1) はじめは出ていない ---- */
  rec('はじめは受け皿が出ていない',
      await page.evaluate(()=>{const z=document.getElementById('scDropRemove');return !!z&&z.hidden}));

  /* ---- 2) 外せる行を掴むと出て、離すと引っ込む ---- */
  const grab=await page.evaluate(id=>{
   const row=document.querySelector('.sc-row-line[data-id="'+id+'"]');
   if(!row)return {なし:true};
   const dt=new DataTransfer();
   row.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));
   const z=document.getElementById('scDropRemove');
   const r=z.getBoundingClientRect();
   /* **重なり順はDOMの有無でなく「その場所で一番手前か」で見る。**
      ゴーストは z-index の直値で本文の裏に回り、DOMには居るのに一度も
      見えていなかった（§9.112）。同じ見落としをしないため実際に拾う。 */
   const hit=document.elementFromPoint(Math.round(r.left+r.width/2),
                                       Math.round(r.top+r.height/2));
   const shown={出た:!z.hidden,見えている:r.width>0&&r.height>0,
                本文より上:!!hit&&(hit===z||z.contains(hit))};
   row.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:dt}));
   return {...shown,離したら隠れる:z.hidden};
  },madeId);
  rec('外せる行を掴むと受け皿が出る',grab.出た&&grab.見えている,JSON.stringify(grab));
  rec('受け皿は本文の上に出る',!!grab.本文より上,JSON.stringify(grab));
  rec('離すと受け皿が引っ込む',!!grab.離したら隠れる,JSON.stringify(grab));
  /* ---- 2b) 受け皿は幅いっぱいにしない(§9.238 ①、利用者の指示) ----
     「ロットの並び替えや入れ替えなどをやりたい時にその先がドロップゾーンに
     あると干渉して目的の操作ができなくなる」。以前は`left`〜`right`で
     下端を横断しており、**一覧の末尾へ行を運ぶ動線をそのまま覆っていた**。
     **幅の数字だけを見ないこと**——器の半分より狭いことに加え、
     「本文の左半分の同じ高さでは受け皿が手前に居ない」ことまで見る
     （そこが並べ替えで使う場所なので）。 */
  const zoneBox=await page.evaluate(id=>{
   const row=document.querySelector('.sc-row-line[data-id="'+id+'"]');
   const dt=new DataTransfer();
   row.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));
   const z=document.getElementById('scDropRemove');
   const host=document.getElementById('scSingleBody');
   const r=z.getBoundingClientRect(),h=host.getBoundingClientRect();
   /* 受け皿と同じ高さの、器の左寄り。並べ替えで最後の行を狙う場所。 */
   const y=Math.round(r.top+r.height/2);
   const x=Math.round(h.left+h.width*0.25);
   const hit=document.elementFromPoint(x,y);
   const out={受け皿幅:Math.round(r.width),器幅:Math.round(h.width),
              左に居ない:!(hit&&(hit===z||z.contains(hit)))};
   row.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:dt}));
   return out;
  },madeId);
  rec('受け皿は幅いっぱいではない（並べ替えの動線を覆わない）',
      zoneBox.受け皿幅>0&&zoneBox.受け皿幅<=zoneBox.器幅/2,JSON.stringify(zoneBox));
  rec('受け皿と同じ高さでも、左側は掴める場所が残っている',
      zoneBox.左に居ない,JSON.stringify(zoneBox));

  /* ---- 3) 外せない行では出さない ---- */
  const notRemovable=await page.evaluate(()=>{
   const row=[...document.querySelectorAll('.sc-row-line')]
     .find(r=>{const e=(WL.scheduleView.entries()||[]).find(x=>String(x.id)===r.dataset.id);
               return e&&e.state!=='予定'});
   if(!row)return {該当なし:true};
   const dt=new DataTransfer();
   row.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));
   const z=document.getElementById('scDropRemove');
   const out={出た:!z.hidden};
   row.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:dt}));
   return out;
  });
  rec('外せない行では受け皿を出さない',
      notRemovable.該当なし?true:notRemovable.出た===false,JSON.stringify(notRemovable));

  /* ---- 4) 落とすと消える（確認を通す） ---- */
  const before=(await plan()).map(e=>String(e.id));
  await page.evaluate(id=>{
   const row=document.querySelector('.sc-row-line[data-id="'+id+'"]');
   const dt=new DataTransfer();
   row.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));
   const z=document.getElementById('scDropRemove');
   z.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:dt}));
  },madeId);
  await page.waitForSelector('#appConfirmModal:not([hidden])',{timeout:10000});
  rec('落とすと確認が出る（黙って消さない）',true);
  await page.click('#appConfirmOk');
  let vanished=false;
  for(let i=0;i<30&&!vanished;i++){
   vanished=await page.evaluate(id=>![...document.querySelectorAll('.sc-row-line')]
     .some(r=>r.dataset.id===String(id)),madeId);
   if(!vanished)await page.waitForTimeout(500);
  }
  rec('落とした行が画面から消える',vanished);
  /* 書込は待ち行列を通るので、サーバー側へ反映されるまで待つ。
     **page.waitForFunction へ async の関数を渡さないこと**——返り値の
     Promiseがそのまま「真」と見なされ、1回目で即座に抜ける（実際にこれで
     「消えていないのに消えた」と読み違えた）。取得はNode側で回す。 */
  let served=false;
  for(let i=0;i<40&&!served;i++){
   served=!(await plan()).some(e=>String(e.id)===String(madeId));
   if(!served)await page.waitForTimeout(500);
  }
  const after=(await plan()).map(e=>String(e.id));
  const gone=before.filter(x=>!after.includes(x));
  const added=after.filter(x=>!before.includes(x));
  rec('サーバー側では落とした1件だけが消える',
      served&&gone.length===1&&gone[0]===String(madeId)&&!added.length,
      `消えた=${JSON.stringify(gone)} 増えた=${JSON.stringify(added)} 外した=${madeId}`);
  madeId=null;                                  // 消えたので後片付け不要

  /* ---- 5) 受け皿は並べ替えを確定させない ---- */
  let reordered=false;
  page.on('request',r=>{if(r.url().includes('/api/schedule/plan/reorder'))reordered=true});
  await page.waitForTimeout(1200);
  rec('外した操作で並べ替えを保存しない',!reordered);

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
 async function cleanup(){
  try{
   if(madeId)await post('/api/schedule/plan/delete',{id:madeId,equipment:EQ});
   await post('/api/schedule/session/release',{equipment:EQ});
   await setMode('edit');
  }catch(e){}
  if(b)await b.close().catch(()=>{});
 }
})().catch(async e=>{console.error('FATAL',e);if(b)await b.close().catch(()=>{});process.exit(2)});
