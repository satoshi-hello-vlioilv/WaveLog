/* test_colsrcfx.js: 元データの列にも「この列の作り方」の式（§9.489、利用者の指示）
   ============================================================
   「表示列の編集機能で、すべての列で同じように機能があると思っていましたが、実は元データの
    ところには計算列と同じような項目は出ていないことが分かったので、元データのところでも、
    『この列の作り方』と書いてある項目の計算式を入力することができる機能をすべて搭載してほしい」

   列の設定パネルを使う画面ごとに、3つの物差しで見る。
    A. 元データの列を選ぶと「この列の作り方」の欄が出る（計算列と同じ道具：試し・候補・書き方）
    B. 元データの列に式を入れると、その画面の表の**セル**が式の結果になる（元の値は`[自分の名前]`で読める）
    C. 式を空にすると元の値に戻り、**列は消えない**（計算列は式も読み替えも空なら消えるが、元データは消えない）
   測定実績は、**計算列そのもの**のセルも見る（D）——そこは式を当てる道が無かった。

   **材料は自分で作る**（測定実績の記録1件）。列レイアウトマスタは`formulas`だけ送って書き戻す
   （送った鍵だけ書く・§9.212）——並びや隠し方は触らない。後片付けは最初の`formulas`へ戻す。
   ============================================================ */
'use strict';
const {run}=require('./lib/harness.js');
const B='http://127.0.0.1:5029';
const EQ='テスト設備A';
const TAG='FX'+process.pid;
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const getj=async p=>(await fetch(B+p)).json();
const layoutOf=async t=>(await getj('/api/column-layout-master?target='+encodeURIComponent(t)))||{};
const keep={};           /* 対象 → 最初の列レイアウト丸ごと（後片付けで戻す） */
const LAYOUT_KEYS=['order','widths','hidden','names','formats','rules','formulas','locks','sorts','aligns'];
const made=[];
const CALC='検証計算列'+String(process.pid).slice(-3);

async function setFormulas(t,f){
 if(!(t in keep))keep[t]=await layoutOf(t);
 await post('/api/column-layout-master',{target:t,formulas:f,user_id:'test'});
}
/* **最初の形へ丸ごと戻す**（§9.360「汚した本は指紋で名指しする」）。`formulas`だけ戻すと、
   もともと設定の無かった対象に行が残る（通しで「列レイアウトマスタ +3」と名指しされた）。
   元が空の対象は白紙へ、そうでなければ控えた全部を書き戻す。 */
async function restoreLayout(t,l){
 const empty=!LAYOUT_KEYS.some(k=>{const v=l[k];return Array.isArray(v)?v.length:(v&&Object.keys(v).length)});
 const body={target:t,user_id:'test'};
 if(empty)Object.assign(body,{clear:true,order:[],widths:{},hidden:[],names:{},formats:{},rules:{},formulas:{},
   locks:[],sorts:{},aligns:{}});
 else LAYOUT_KEYS.forEach(k=>{body[k]=l[k]||(k==='order'||k==='hidden'||k==='locks'?[]:{})});
 await post('/api/column-layout-master',body);
}
async function mkRecord(){
 const now=new Date(),iso=now.toISOString(),id=TAG+'-R1';
 const payload=JSON.stringify({id,status:'編集中',updatedAt:iso,
  basic:{lotNo:TAG+'L1',inspectionNo:'',mfgMaterial:'A1050',mfgThickness:'0.5'},
  settings:{registeredEquipment:EQ,opData:{}},
  workTime:{startAt:iso,endAt:new Date(now.getTime()+30*60000).toISOString()},measurements:{}});
 await post('/api/measurement/backup',{id,lotNo:TAG+'L1',inspectionNo:'',equipment:EQ,status:'編集中',
   codec:'json-full-v32',payload,user_id:'test',updated_at_iso:iso});
 made.push(id);
}

run('test_colsrcfx: 元データの列にも「この列の作り方」の式（§9.489）', async ({page,rec,W,idle,errs})=>{
 const out={};
 try{
  await post('/api/access-mode',{mode:'edit'});
  await mkRecord();
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:30000});
  await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
  await page.reload({waitUntil:'domcontentloaded'});
  await W.booted(page);

  /* 画面ごとの道: 開く・パネルを開く・対象・セルの字。 */
  const SCREENS=[
   {name:'仕掛一覧',
    open:async()=>{await page.waitForSelector('#grid table',{timeout:30000});
                   await page.waitForFunction(()=>document.querySelectorAll('#grid tbody tr td[data-col]').length>5,null,{timeout:20000})},
    target:()=>page.evaluate(()=>WL.list.listLayoutTarget()),
    panel:async()=>{await W.listView(page);await page.click('#listColumnBtn')},
    redraw:()=>page.evaluate(()=>WL.list.load()),
    cell:k=>page.evaluate(k=>{const td=document.querySelector(`#grid tbody tr td[data-col="${CSS.escape(k)}"]`);return td?td.textContent.trim():null},k)},
   {name:'作業スケジュール表',
    open:async()=>{await page.click('#openSchedule');await page.waitForSelector('.sc-row-line',{timeout:25000})},
    target:()=>page.evaluate(()=>`timeline:${WL.equipment.get()}`),
    panel:()=>page.evaluate(()=>{const b=document.getElementById('scContentModalBtn');b.click()}),
    redraw:async()=>{await page.click('#openSchedule');await page.waitForSelector('.sc-row-line',{timeout:25000})},
    cell:k=>page.evaluate(k=>{
     const rows=[...document.querySelectorAll('.sc-row-line')];
     for(const r of rows){const c=r.querySelector(`[data-col="${CSS.escape(k)}"]`);if(c&&c.textContent.trim())return c.textContent.trim()}
     return null},k)},
   {name:'測定実績',
    open:async()=>{await page.click('#openActuals');await page.waitForSelector('#actualsPanel .ac-row.head',{timeout:20000});
                   await page.waitForSelector('#acList .ac-row:not(.head)',{timeout:20000})},
    target:()=>Promise.resolve('actuals:list'),
    panel:()=>page.click('#acColumns'),
    redraw:async()=>{await page.click('#openActuals');await page.waitForSelector('#acList .ac-row:not(.head)',{timeout:20000})},
    cell:k=>page.evaluate(([k,lot])=>{
     const row=[...document.querySelectorAll('#acList .ac-row:not(.head)')].find(r=>r.textContent.includes(lot))
       ||document.querySelector('#acList .ac-row:not(.head)');
     const c=row&&row.querySelector(`[data-col="${CSS.escape(k)}"]`);return c?c.textContent.trim():null},[k,TAG+'L1'])},
   {name:'測定データ一覧',
    open:async()=>{await page.evaluate(()=>WL.records.openRecordsSafe('編集中'));await page.waitForSelector('.record-list-head',{timeout:20000})},
    target:()=>Promise.resolve('records:list'),
    panel:()=>page.evaluate(()=>WL.recordColumns.open()),
    redraw:async()=>{await page.evaluate(()=>WL.records.openRecordsSafe('編集中'));await page.waitForSelector('.record-list-head',{timeout:20000})},
    cell:k=>page.evaluate(k=>{const c=document.querySelector(`#recordList .record-list-cell[data-col="${CSS.escape(k)}"]`);return c?c.textContent.trim():null},k)},
  ];
  for(const sc of SCREENS){
   const o=out[sc.name]={};
   console.log('# 画面: '+sc.name);
   await sc.open();await idle();
   const t=await sc.target();
   /* 表に出ていて値のある元データの列を1つ選ぶ（パネルが「元データ」と分類した列）。 */
   await sc.panel();
   await page.waitForSelector('#lcList .lc-item',{timeout:15000});
   const cand=await page.evaluate(()=>[...document.querySelectorAll('#lcList .lc-item[data-origin="source"]:not(.is-off)')].map(e=>e.dataset.key));
   let key='';
   for(const k of cand){const v=await sc.cell(k);if(v&&v!=='-'&&v!=='—'){key=k;break}}
   o.key=key;
   if(!key){o.a=false;o.note='表に出ている元データの列が見つからない'+JSON.stringify(await page.evaluate(c=>({cand:c.slice(0,5),
     cells:[...document.querySelectorAll('[data-col]')].filter(e=>e.closest('#recordList,.record-list')).slice(0,6).map(e=>e.dataset.col+'='+e.textContent.trim().slice(0,12))}),cand));await page.evaluate(()=>WL.listColumns.close());continue}
   await page.evaluate(k=>document.querySelector(`#lcList .lc-item[data-key="${CSS.escape(k)}"] .lc-name, #lcList .lc-item[data-key="${CSS.escape(k)}"]`).click(),key);
   await W.until(page,k=>{const h=document.querySelector('#lcDetail .lc-card-name');return !!h},key,{ms:5000,what:'右の段'});
   /* A: この列の作り方の欄・候補・書き方・試し（計算列と同じ道具） */
   o.a=await page.evaluate(()=>({fx:!!document.getElementById('lcFormula'),help:!!document.querySelector('#lcDetail .lc-fx-help'),
     del:!!document.getElementById('lcFormulaDel'),head:(document.querySelector('#lcDetail .lc-step-fx .lc-step-head')||{}).textContent||''}));
   await page.evaluate(()=>WL.listColumns.close());
   /* B: 式を入れるとセルが式の結果 */
   const before=await sc.cell(key);
   const f0=(await layoutOf(t)).formulas||{};
   const fx={...f0,[key]:`concat('※',[${key}])`};
   if(sc.name==='測定実績')fx[CALC]=`concat('C',[${key}])`;
   await setFormulas(t,fx);
   await page.evaluate(t=>{WL.columnLayout.forget();return WL.columnLayout.load(t)},t);
   await sc.redraw();await idle();
   o.before=before;o.after=await sc.cell(key);
   o.b=o.after==='※'+before;
   if(sc.name==='測定実績'){
    /* D: 計算列そのもののセル（出すために並びへ載せる） */
    await post('/api/column-layout-master',{target:t,order:[...((await layoutOf(t)).order||[]),CALC],user_id:'test'});
    await page.evaluate(t=>{WL.columnLayout.forget();return WL.columnLayout.load(t)},t);
    await sc.redraw();await idle();
    o.calc=await sc.cell(CALC);
    o.d=o.calc==='C'+before;
   }
   /* C: 式を空にすると元の値に戻り、列は消えない */
   await setFormulas(t,{...f0,[key]:''});
   await page.evaluate(t=>{WL.columnLayout.forget();return WL.columnLayout.load(t)},t);
   await sc.redraw();await idle();
   o.cleared=await sc.cell(key);
   o.c=o.cleared===before;
   console.log('#  '+JSON.stringify(o));
   await restoreLayout(t,keep[t]);
  }
  const line=(n,f)=>Object.entries(out).map(([k,o])=>`${k}:${f(o)}`).join(' ／ ');
  rec('A: 元データの列を選ぶと「この列の作り方」の欄が出る（4画面）',
      Object.values(out).every(o=>o.a&&o.a.fx&&o.a.help),line('A',o=>o.key?(o.a&&o.a.fx?'欄あり':'欄なし'):o.note));
  rec('A: 元データの列には「この列を削除する」を出さない（元データは消せない）',
      Object.values(out).every(o=>o.a&&!o.a.del),line('A',o=>o.a&&o.a.del?'削除あり':'なし'));
  rec('B: 元データの列に式を入れると、表のセルが式の結果になる（4画面）',
      Object.values(out).every(o=>o.b),line('B',o=>`${o.before}→${o.after}`));
  rec('C: 式を空にすると元の値に戻り、列は消えない（4画面）',
      Object.values(out).every(o=>o.c),line('C',o=>`${o.cleared}`));
  rec('D: 測定実績の計算列のセルに式の結果が出る',
      !!out['測定実績']&&out['測定実績'].d===true,JSON.stringify(out['測定実績']&&out['測定実績'].calc));
  rec('画面の例外が出ていない',errs.length===0,errs.slice(0,3).join(' / '));
 }catch(e){
  rec('FATAL',false,String(e&&e.stack||e));
 }finally{
  for(const [t,l] of Object.entries(keep)){
   try{await restoreLayout(t,l)}catch(_){/* 片付けの失敗は次の実行が開始時に戻す（ランナーの restore_master） */}
  }
  try{await post('/api/measurement/backup/delete',{ids:made})}catch(_){/* 片付けの失敗は次の実行が開始時に戻す（ランナーの restore_master） */}
  try{await post('/api/access-mode',{mode:'edit'})}catch(_){/* 片付けの失敗は次の実行が開始時に戻す（ランナーの restore_master） */}
 }
},{viewport:{width:1700,height:1000}});
