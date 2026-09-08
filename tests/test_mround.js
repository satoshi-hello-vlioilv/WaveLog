/* test_mround.js: 入力値の丸め（§9.305 ①／§9.307、利用者の指示）
   ============================================================
   「0.5単位切り上げなど、入力値の切り上げ機能を実装してください。
    導入したい項目は ①ラテラルボーの入力値 ②テレスコープの入力値
    ③巻ズレの入力値 ④揃いの項目のうち、値の入力値」

   **専用のマスタは作らない**（§9.307、利用者の指摘）:
    「『入力値の丸め』マスタが『操業データ項目』マスタと被っており、この
     やり方であれば『操業データ項目』の編集内容の中に数値データが選ばれた
     ときにステップを決めるところで編集可能なので、今のままなら『入力値の
     丸め』マスタは特に必要ないです。必要なのは指示したラテラルボー／
     テレスコープ／巻ズレ／揃いの値の部分の入力の丸めです」

   ここで固定すること:
    1. **4つは組み込みの決まり**（0.5刻みで切り上げ）——測定表と丈別データは
       操業データ項目ではないので「刻み」では届かない
    2. **打ち終わって欄を離れたとき**に効く（打っている最中は変わらない）
    3. 汎用の設定は**操業データ項目マスタの「刻み」＋「丸め方」**
       ——刻みが空なら丸めない（＝今までどおり打った値がそのまま残る）
    4. **測定項目マスタは無い**（口ごと消えていること）

   **素通りに注意**: 計算関数だけを見る網は、画面のどこにも配線されていない
   実装でも通る。**実際に欄へ打って、離して、配列に入った値**まで見る。
   ============================================================ */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const API='http://127.0.0.1:5029';
const EQ='テスト設備A';
/* 実行ごとに一意（§CLAUDE tests/README）——同じ名前の行が積み上がらない。 */
const TAG='MR'+process.pid;
const post=(p,body)=>fetch(API+p,{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify(body)}).then(r=>r.json().catch(()=>({})));
const getj=p=>fetch(API+p).then(r=>r.json());
const setMode=m=>post('/api/access-mode',{mode:m});
let b=null,page=null;

(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 page=await b.newPage({viewport:{width:1920,height:1080}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const errs=[];
 page.on('pageerror',e=>errs.push(e.message.slice(0,140)));
 page.on('dialog',d=>d.accept());
 try{
  await setMode('edit');

  /* ==========================================================
     1) 4つは**組み込みの決まり**（マスタは作らない・§9.307）
     ========================================================== */
  const gone=await fetch(API+'/api/measure-item-master').then(r=>r.status).catch(()=>0);
  rec('「入力値の丸め」マスタの口は無い（重複していたので廃止）',
      gone===404||gone===0,String(gone));

  /* ==========================================================
     2) 丸めそのもの（画面の1箇所を通す）
     ----------------------------------------------------------
     **ちょうどの値が1段上がらないこと**が肝——`1.5/0.5`は
     `3.0000000000000004`なので、素の`Math.ceil`だと2.0になる。
     ========================================================== */
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:25000});
  await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  const table=await page.evaluate(()=>WL.measureRound.rules());
  rec('ラテラルボー・テレスコープ・巻ずれ・揃いの値が0.5刻みの切り上げ',
      ['lateral','telescope','offset','alignValue'].every(k=>
        table[k]&&table[k].unit===0.5&&table[k].mode==='切り上げ'),
      JSON.stringify(table));
  /* **表に無い鍵は丸めない**（板厚・板幅は今までどおり）。 */
  rec('板厚・板幅は丸めない（表に無い）',!table.thickness&&!table.width,
      JSON.stringify(Object.keys(table)));
  const calc=await page.evaluate(()=>{
   const f=WL.measureRound.toUnit;
   return {切上_1_2:f(1.2,.5,'切り上げ'),切上_1_5:f(1.5,.5,'切り上げ'),
           切上_1_0:f(1.0,.5,'切り上げ'),切上_0_1:f(0.1,.5,'切り上げ'),
           切捨_1_9:f(1.9,.5,'切り捨て'),切捨_1_5:f(1.5,.5,'切り捨て'),
           四捨_1_24:f(1.24,.5,'四捨五入'),四捨_1_26:f(1.26,.5,'四捨五入'),
           単位1_1_1:f(1.1,1,'切り上げ'),単位0_1:f(1.24,.1,'切り上げ')};
  });
  rec('0.5刻みで切り上がる（1.2→1.5）',calc.切上_1_2===1.5,JSON.stringify(calc));
  /* **ちょうどの値は上がらない**——浮動小数の誤差で1段ずれる罠。 */
  rec('ちょうどの値は1段上がらない（1.5→1.5・1.0→1.0）',
      calc.切上_1_5===1.5&&calc.切上_1_0===1.0,JSON.stringify(calc));
  rec('切り捨て・四捨五入も選べる',
      calc.切捨_1_9===1.5&&calc.切捨_1_5===1.5
      &&calc.四捨_1_24===1.0&&calc.四捨_1_26===1.5,JSON.stringify(calc));
  rec('刻みは0.5以外も使える（1刻み・0.1刻み）',
      calc.単位1_1_1===2&&calc.単位0_1===1.3,JSON.stringify(calc));

  /* ==========================================================
     3) 測定画面で実際に効く（打って、離す）
     ========================================================== */
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-row-line',{timeout:25000});
  const started=await page.evaluate(()=>{
   const r=[...document.querySelectorAll('.sc-row-line')].find(x=>x.querySelector('.sc-row-start'));
   if(!r)return false;r.querySelector('.sc-row-start').click();return true;
  });
  rec('前提: 予定から測定を開ける',started===true,String(started));
  await page.waitForFunction(()=>!document.querySelector('#measureModal')?.hidden,null,{timeout:25000});
  await page.waitForFunction(()=>typeof S!=='undefined'&&!!S.measure,null,{timeout:25000});
  await page.waitForTimeout(1200);
  /* 決まりが届いていること（届く前に打つと丸まらない）。 */
  await page.waitForFunction(()=>Object.keys(WL.measureRound.rules()||{}).length>0,
    null,{timeout:15000}).catch(()=>{});
  rec('測定画面が丸めの決まりを読んでいる',
      await page.evaluate(()=>!!(WL.measureRound.rules()||{}).lateral),
      JSON.stringify(await page.evaluate(()=>WL.measureRound.rules())));

  /* 手入力へ切り替えて、ラテラルボーの枠へ打つ。 */
  /* **`#measureType`は器に覆われた1pxの裏方**（§9.218 ②）なので、
     `selectOption`では触れない。値を入れて`change`を飛ばす。 */
  const typeInto=async(type,text)=>{
   /* **②測定の段へ移ってから**（測定表は①では伏せてある・§9.123）。 */
   await page.evaluate(()=>WL.measureSteps.go('2'));
   await page.waitForTimeout(300);
   await page.evaluate(t=>{const s=document.querySelector('#measureType');
     s.value=t;s.dispatchEvent(new Event('change',{bubbles:true}))},type);
   await page.waitForTimeout(500);
   await page.evaluate(()=>{const b=document.querySelector('[data-mode="manual"]');if(b)b.click()});
   /* 手動入力の注意はアプリの窓で出るようになった（§9.342）。**開いたまま
      だと次のクリックが窓に遮られる**（素の`alert()`のときは
      `page.on('dialog')`が黙って閉じていた）。 */
   if(await page.$('#appConfirmModal:not([hidden])')){
    await page.click('#appConfirmOk');
    await page.waitForSelector('#appConfirmModal',{state:'hidden',timeout:5000});
   }
   await page.waitForTimeout(200);
   const sel='[data-mkey][data-i="0"][data-j="0"]';
   await page.waitForSelector(sel,{timeout:10000});
   await page.evaluate(s=>{const el=document.querySelector(s);el.value='';el.oninput&&el.oninput()},sel);
   await page.click(sel);
   await page.type(sel,text);
   /* **離すまでは丸めない**（§9.305 ①）——打っている最中に丸めると、
      `0.2`を打つ途中の`0.`で値が飛ぶ。 */
   const mid=await page.evaluate(s=>document.querySelector(s).value,sel);
   await page.evaluate(s=>{const el=document.querySelector(s);el.blur()},sel);
   await page.waitForTimeout(250);
   return page.evaluate(s=>{
    const el=document.querySelector(s);
    return {欄:el.value,記録:S.measure.measurements[el.dataset.mkey][0][0]};
   },sel).then(r=>({...r,打っている最中:mid}));
  };
  const lat=await typeInto('ラテラルボー','1.2');
  rec('ラテラルボー: 打った1.2が離すと1.5になる',
      lat.欄==='1.5'&&String(lat.記録)==='1.5',JSON.stringify(lat));
  rec('打っている最中は丸めない（1.2のまま）',lat.打っている最中==='1.2',lat.打っている最中);
  const tel=await typeInto('テレスコープ','2.1');
  rec('テレスコープ: 2.1が2.5になる',
      tel.欄==='2.5'&&String(tel.記録)==='2.5',JSON.stringify(tel));
  const off=await typeInto('巻ずれ','0.1');
  rec('巻ずれ: 0.1が0.5になる',
      off.欄==='0.5'&&String(off.記録)==='0.5',JSON.stringify(off));

  /* ==========================================================
     4) 揃いの「値(mm)」（丈別データ）
     ========================================================== */
  /* 丈別データは**母材/丈毎**の面（§9.160）。項目を切り替えてから触る。 */
  await page.evaluate(()=>{const s=document.querySelector('#measureType');
    s.value='母材/丈毎';s.dispatchEvent(new Event('change',{bubbles:true}))});
  await page.waitForTimeout(600);
  const align=await page.evaluate(async()=>{
   const sel=document.querySelector('#productRowsBody [data-product-field="edgeShape"]');
   if(!sel)return {ある:false};
   /* 「揃い綺麗」以外を選ぶと内訳の段が開く（§9.203）。 */
   const opt=[...sel.options].map(o=>o.value).find(v=>v&&v!=='揃い綺麗');
   sel.value=opt;sel.oninput&&sel.oninput();
   await new Promise(r=>setTimeout(r,300));
   const el=document.querySelector('#productRowsBody [data-product-field="alignmentValue"]');
   if(!el)return {ある:false,形状:opt};
   el.value='1.2';el.oninput&&el.oninput();
   const 途中=el.value;
   el.onblur&&el.onblur();
   await new Promise(r=>setTimeout(r,200));
   return {ある:true,形状:opt,欄:el.value,途中,
           記録:(S.measure.product.rows[0]||{}).alignmentValue};
  });
  rec('前提: 揃いの内訳の「値(mm)」が出ている',align.ある===true,JSON.stringify(align));
  rec('揃いの値: 1.2が離すと1.5になる',
      align.欄==='1.5'&&String(align.記録)==='1.5',JSON.stringify(align));
  rec('揃いの値も打っている最中は丸めない',align.途中==='1.2',String(align.途中));

  /* ==========================================================
     5) 汎用の設定は**操業データ項目マスタの「刻み」＋「丸め方」**（§9.307）
     ----------------------------------------------------------
     利用者の指摘どおり、数値の項目は既に「刻み」を持っている。丸めは
     その隣の向きだけで済む——**専用のマスタは要らない**。
     ========================================================== */
  const ITEM=TAG+'丸め';
  let itemId=null;
  try{
   const mk=async(step,mode)=>{
    const r=await (await fetch(API+'/api/operation-item-master',{method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({id:itemId,name:ITEM,equipment:EQ,group:TAG,kind:'数値',
        decimals:1,step,roundMode:mode,user_id:'tests'})})).json();
    if(r&&r.id)itemId=r.id;
    return r;
   };
   await mk(0.5,'切り上げ');
   const back=await getj('/api/operation-item-master?equipment='+encodeURIComponent(EQ));
   const row=(back.items||[]).find(x=>x.name===ITEM)||{};
   rec('操業データ項目に「刻み」と「丸め方」が保存される',
       Number(row.step)===0.5&&row.roundMode==='切り上げ',
       JSON.stringify({step:row.step,mode:row.roundMode}));
   /* **語彙はサーバーが答える**（画面へ綴りを書き写さない・§9.163）。 */
   rec('丸め方の語彙をサーバーが返す',
       (back.roundModes||[]).indexOf('切り上げ')>=0&&(back.roundModes||[]).indexOf('四捨五入')>=0,
       JSON.stringify(back.roundModes));
   /* **他の設定だけを保存しても丸め方が消えない**（§9.212 ②・§9.287-H）。 */
   await (await fetch(API+'/api/operation-item-master',{method:'POST',
     headers:{'Content-Type':'application/json'},
     body:JSON.stringify({id:itemId,name:ITEM,equipment:EQ,group:TAG,kind:'数値',
       decimals:1,step:0.5,note:'メモだけ直す',user_id:'tests'})})).json();
   const back2=await getj('/api/operation-item-master?equipment='+encodeURIComponent(EQ));
   const row2=(back2.items||[]).find(x=>x.name===ITEM)||{};
   rec('丸め方を送らない保存では今の値が残る（設定だけ消えない）',
       row2.roundMode==='切り上げ',JSON.stringify({mode:row2.roundMode}));
   /* **刻みが空なら丸めない**（＝今までどおり打った値がそのまま）。 */
   await mk(null,'切り上げ');
   const back3=await getj('/api/operation-item-master?equipment='+encodeURIComponent(EQ));
   const row3=(back3.items||[]).find(x=>x.name===ITEM)||{};
   rec('刻みが空なら丸めようが無い（設定は残るが効かない）',
       row3.step==null,JSON.stringify({step:row3.step,mode:row3.roundMode}));
  }catch(e){rec('FATAL(§9.307 操業データ項目)',false,e.message)}
  finally{
   if(itemId)await post('/api/operation-item-master/delete',{id:itemId,user_id:'tests'});
  }

  rec('画面のエラーが出ていない',errs.length===0,errs.slice(0,3).join(' / '));
 }catch(e){
  rec('FATAL',false,e.message);
 }finally{
  /* 置いた実績は自分で消す（§9.351・§9.362）。残った実績は計画外実績として
     予定表に現れ、無関係な網を落とす。 */
  try{await require('./lib/harness.js').clearRecords()}catch(e){console.log('!! 実績の後片付けに失敗: '+(e&&e.message||e))}
  if(b)await b.close();
 }
 const ok=R.filter(x=>x.ok).length;
 console.log(`\n== ${ok}/${R.length} PASS ==`);
})();
