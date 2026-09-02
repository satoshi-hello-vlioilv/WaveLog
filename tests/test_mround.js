/* test_mround.js: 入力値の丸め（§9.305 ①、利用者の指示）
   ============================================================
   「0.5単位切り上げなど、入力値の切り上げ機能を実装してください。
    導入したい項目は以下です。可能であれば他の入力項目についても、汎用的に
    設定できるように配慮してもらえると助かります。
     ①ラテラルボーの入力値 ②テレスコープの入力値 ③巻ズレの入力値
     ④揃いの項目のうち、値の入力値」

   ここで固定すること:
    1. 決まりは**測定項目マスタ**が持ち、語彙（どの入力・どの向き）は
       **サーバーが答える**（§9.163。画面へ綴りを書き写さない）
    2. **種**として①〜④に0.5刻みの切り上げが入っている——ラテラルボーの
       「0.5刻み切り上げ」は`measurement-input.js`に焼き付いており、しかも
       **転送のときしか効いていなかった**。移したので手入力にも効く
    3. **打ち終わって欄を離れたとき**に効く（打っている最中は変わらない）
    4. 刻みも向きも設定で変わる／行を消せば丸めない
    5. **保存済みの記録は書き換えない**（開いただけで値が変わらない）

   **素通りに注意**: 計算関数だけを見る網は、画面のどこにも配線されていない
   実装でも通る。**実際に欄へ打って、離して、配列に入った値**まで見る。
   ============================================================ */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const API='http://127.0.0.1:5029';
const EQ='テスト設備A';
const post=(p,body)=>fetch(API+p,{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify(body)}).then(r=>r.json().catch(()=>({})));
const getj=p=>fetch(API+p).then(r=>r.json());
const setMode=m=>post('/api/access-mode',{mode:m});
let b=null,page=null;

/* 後始末（§9.121）。**db/master.sqlite3は実行をまたいで生き延びる**ので、
   触った行は種の値へ戻す。 */
const SEED=[['lateral',0.5,'切り上げ'],['telescope',0.5,'切り上げ'],
            ['offset',0.5,'切り上げ'],['alignValue',0.5,'切り上げ']];
async function restoreSeeds(){
 try{
  const d=await getj('/api/measure-item-master');
  const byKey=new Map((d.items||[]).map(x=>[x.key,x]));
  for(const [k,u,m] of SEED){
   const cur=byKey.get(k);
   if(cur&&Number(cur.unit)===u&&cur.mode===m&&cur.enabled!==false)continue;
   await post('/api/measure-item-master',{key:k,unit:u,mode:m,enabled:true,user_id:'tests'});
  }
  /* 種に無いキーを作っていたら消す（この網が作ったものだけ）。 */
  for(const x of (d.items||[]))
   if(!SEED.some(s=>s[0]===x.key))await post('/api/measure-item-master/delete',{id:x.id,user_id:'tests'});
 }catch(e){}
}

(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 page=await b.newPage({viewport:{width:1920,height:1080}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const errs=[];
 page.on('pageerror',e=>errs.push(e.message.slice(0,140)));
 page.on('dialog',d=>d.accept());
 try{
  await setMode('edit');
  await restoreSeeds();

  /* ==========================================================
     1) 語彙はサーバーが答える／種が入っている
     ========================================================== */
  const d0=await getj('/api/measure-item-master');
  const keys=(d0.targets||[]).map(t=>t.key);
  rec('選べる入力の語彙をサーバーが返す',
      ['lateral','telescope','offset','alignValue'].every(k=>keys.indexOf(k)>=0),
      JSON.stringify(keys));
  rec('丸め方の語彙もサーバーが返す（既定は切り上げ）',
      (d0.modes||[]).some(m=>m.key==='切り上げ')&&d0.defaultMode==='切り上げ',
      JSON.stringify((d0.modes||[]).map(m=>m.key)));
  const seeded=k=>(d0.items||[]).find(x=>x.key===k);
  rec('①〜④に0.5刻みの切り上げが種として入っている',
      ['lateral','telescope','offset','alignValue'].every(k=>{
        const x=seeded(k);return x&&Number(x.unit)===0.5&&x.mode==='切り上げ'}),
      JSON.stringify((d0.items||[]).map(x=>`${x.key}:${x.unit}:${x.mode}`)));
  /* **呼び名もサーバーが返す**——一覧は生のキーを出さない。 */
  rec('項目の呼び名もサーバーが返す（生のキーを画面に出さない）',
      !!(seeded('lateral')||{}).label&&(seeded('lateral')||{}).label!=='lateral',
      (seeded('lateral')||{}).label||'');
  /* **知らないキーは断る**（§4。押しても一度も効かない行を作らない）。 */
  const bad=await fetch(API+'/api/measure-item-master',{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({key:'nosuchitem',unit:0.5,user_id:'tests'})});
  const badJson=await bad.json().catch(()=>({}));
  rec('知らない入力キーは理由を添えて断る',
      bad.status===400&&/測定項目ではありません/.test(String(badJson.error||'')),
      `${bad.status} ${String(badJson.error||'').slice(0,50)}`);

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
     5) 設定を変えると効き方が変わる／消せば丸めない
     ========================================================== */
  await post('/api/measure-item-master',{key:'lateral',unit:1,mode:'切り捨て',user_id:'tests'});
  await page.evaluate(()=>WL.measureRound.forget());
  await page.evaluate(()=>WL.measureRound.load());
  await page.waitForFunction(()=>((WL.measureRound.rules()||{}).lateral||{}).mode==='切り捨て',
    null,{timeout:10000}).catch(()=>{});
  const lat2=await typeInto('ラテラルボー','1.9');
  rec('刻みと向きを変えると効き方が変わる（1刻み切り捨て: 1.9→1）',
      lat2.欄==='1'&&String(lat2.記録)==='1',JSON.stringify(lat2));
  const row=(await getj('/api/measure-item-master')).items.find(x=>x.key==='lateral');
  await post('/api/measure-item-master/delete',{id:row.id,user_id:'tests'});
  await page.evaluate(()=>WL.measureRound.forget());
  await page.evaluate(()=>WL.measureRound.load());
  await page.waitForFunction(()=>!(WL.measureRound.rules()||{}).lateral,null,{timeout:10000}).catch(()=>{});
  const lat3=await typeInto('ラテラルボー','1.2');
  rec('行を消すと丸めない（打った値がそのまま残る）',
      lat3.欄==='1.2'&&String(lat3.記録)==='1.2',JSON.stringify(lat3));

  rec('画面のエラーが出ていない',errs.length===0,errs.slice(0,3).join(' / '));
 }catch(e){
  rec('FATAL',false,e.message);
 }finally{
  /* **後始末**（§9.121）。種の値へ戻す。 */
  await restoreSeeds();
  if(b)await b.close();
 }
 const ok=R.filter(x=>x.ok).length;
 console.log(`\n== ${ok}/${R.length} PASS ==`);
})();
