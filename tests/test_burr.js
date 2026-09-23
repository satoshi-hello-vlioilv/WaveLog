/* test_burr.js: バリは「2回測って差を採る」（§9.242 ③、利用者の指示）
   ============================================================
   「1回目のデータを受け付けたことを表示し、2回目入力時にはそのデータの
    計算式も合わせて見える形に表示してください。ただし、表示領域は今の1行の
    範囲内で納めるようにしてください」

   ここで固定すること:
    - **1回目を受け付けたことが画面に出る**（受け付けた値そのもの）
    - **2回目で計算式が出る**（② − ① = 差。差は測定表へ入った値と同じ）
    - **行は増えない**（見出しは1行のまま・横にも溢れない。§9.234 ③）
    - **保存状態を潰さない**——以前は`setState()`＝`#localState`へ書いており、
      同じ転送処理の末尾の`markDirty()`が上書きするため**一度も表示されて
      いなかった**うえ、書けていたとしても保存状態を消していた（§9.212 ④）
    - **DELETEで①からやり直せる**（差がマイナスのときの案内がそう言っている）

   **確かめるときは実際に転送を流すこと。** バッジが在ることだけを見る網は、
   値を1つも読まない実装でも通る。 */
'use strict';
const {run}=require('./lib/harness.js');
const API='http://127.0.0.1:5029';
const EQ='テスト設備A';
const setMode=m=>fetch(API+'/api/access-mode',{method:'POST',
  headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m})});

run('test_burr: バリは「2回測って差を採る」（§9.242 ③、利用者の指示）', async ({page,rec,B,W,idle,paint,errs,browser})=>{
 /* 実機の測定器はクリックを挟まず送り続ける。**こちらからフォーカスを
    触らない**（触ると「フォーカスが戻る」を自分で戻してから確かめる形になる）。 */
 const send=async raw=>{
  await page.keyboard.type(raw);
  await page.keyboard.press('Tab');
  /* 受信の処理は Tab の次の描画で走り、終わると「直前受信」へ生データを書く
     （measure-input.js の processDeviceInput）。送る生データは毎回違う。 */
  await W.until(page,r=>((document.getElementById('deviceLastReceived')||{}).textContent||'').includes(r),raw,{ms:5000,what:'転送 '+raw+' を受け付ける'});
 };
 const setType=async v=>{
  await page.evaluate(t=>{const el=document.getElementById('measureType');
    el.value=t;el.dispatchEvent(new Event('change',{bubbles:true}))},v);
  await paint();
 };
 /* バッジの見え方は**実寸で読む**（文字があるかだけでは、隠れた器の中でも通る）。 */
 const burr=()=>page.evaluate(()=>{
  const el=document.querySelector('.burr-step');
  if(!el)return{ある:false};
  const r=el.getBoundingClientRect();
  return{ある:true,見える:r.width>0&&r.height>0,
    文:(el.textContent||'').replace(/\s+/g,''),
    説明:el.getAttribute('title')||'',
    段:[...el.classList].find(c=>c.startsWith('burr-step--'))||'',
    値:[...el.querySelectorAll('.burr-val')].map(x=>x.textContent.trim()),
    差:(el.querySelector('.burr-val--diff')||{}).textContent||''};
 });
 const headBox=()=>page.evaluate(()=>{
  const h=document.querySelector('.editor-head');
  if(!h)return null;
  const r=h.getBoundingClientRect();
  /* 段は**中心**で数える（`align-items:center`なので上端はそろわない）。 */
  const rows=[...h.querySelectorAll(':scope > .mhead-line')]
    .filter(e=>e.getBoundingClientRect().width>0)
    .map(e=>{const q=e.getBoundingClientRect();return Math.round((q.top+q.bottom)/2)});
  return{高さ:Math.round(r.height),段:[...new Set(rows)].length,
    幅:Math.round(r.width),中身:h.scrollWidth,
    はみ出し:Math.max(0,h.scrollWidth-h.clientWidth)};
 });
 const burrRow=()=>page.evaluate(()=>(S.measure.measurements.burr?.[0]||[]).slice(0,4));
 const saveState=()=>page.evaluate(()=>document.getElementById('localState')?.textContent||'');

 try{
  await setMode('edit');
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:25000});
  await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:25000});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-row-line',{timeout:25000});
  const started=await page.evaluate(()=>{
   const r=[...document.querySelectorAll('.sc-row-line')].find(x=>x.querySelector('.sc-row-start'));
   if(r){r.querySelector('.sc-row-start').click();return true}return false;
  });
  rec('予定から測定画面を開ける',started);
  if(!started)throw Error('開始できる行が無い');
  await page.waitForFunction(()=>!document.querySelector('#measureModal')?.hidden,null,{timeout:25000});
  await page.waitForFunction(()=>document.querySelector('#saveOverlay')?.hidden!==false,null,{timeout:30000}).catch(()=>{});
  await page.waitForFunction(()=>typeof S!=='undefined'&&!!S.measure,null,{timeout:25000});
  await page.evaluate(()=>WL.measureSteps.go('2'));
  await paint();
  /* 条を4本にして、確定のあと条が進むのが見えるようにする。 */
  await page.evaluate(()=>{const h=document.querySelector('#horizontalCount');
    h.value='4';h.dispatchEvent(new Event('change',{bubbles:true}))});
  await idle();

  /* ---- 0) バリ以外では出さない（§4：関係の無い項目で場所を取らない） ---- */
  await setType('板幅');
  const other=await burr();
  rec('バリ以外の項目ではバリの段を出さない',other.ある===false,JSON.stringify(other));

  /* ---- 1) バリを選ぶと①から始まる ---- */
  await setType('バリ');
  const s0=await burr();
  rec('バリを選ぶと①（板厚）の案内が出る',
      s0.ある&&s0.見える&&s0.段==='burr-step--first'&&/板厚/.test(s0.文),JSON.stringify(s0));
  rec('①では何を測るかを説明が持つ',/板厚/.test(s0.説明)&&/差/.test(s0.説明),s0.説明);

  /* ---- 2) 1回目を受け付けたことが**値つきで**出る（利用者の指示） ---- */
  await send('DT100+002.000');
  const s1=await burr();
  rec('1回目を受け付けると受け付けた値が出る',
      s1.段==='burr-step--second'&&s1.値.includes('2.000'),JSON.stringify(s1));
  rec('1回目のあと次は②だと分かる',/②/.test(s1.文)&&/高さ/.test(s1.文),s1.文);
  /* **測定表へはまだ入らない**（1回目は基準で、記録するのは差）。 */
  const r1=await burrRow();
  rec('1回目だけでは測定表に値は入らない',r1.every(v=>v===''),JSON.stringify(r1));

  /* ---- 3) 2回目で計算式が出る（利用者の指示） ---- */
  await send('DT100+002.150');
  const s2=await burr();
  const r2=await burrRow();
  rec('2回目で計算式が出る（② − ① = 差）',
      s2.段==='burr-step--done'&&s2.値.includes('2.150')&&s2.値.includes('2.000')
      &&/−/.test(s2.文)&&/=/.test(s2.文),JSON.stringify(s2));
  rec('式の答えが測定表へ入った値と同じ',
      s2.差.trim()===r2[0]&&r2[0]==='0.150',JSON.stringify({式:s2.差,表:r2}));
  rec('どの丈・どの条の式かを説明が持つ',/条/.test(s2.説明),s2.説明);

  /* ---- 4) 保存状態を潰さない（§9.212 ④） ----
     以前は`setState()`で書いていたため、保存状態のバッジが案内文で
     上書きされうる作りだった（実際には`markDirty()`が勝って一度も
     出ていなかったが、どちらにしても保存状態の場所ではない）。 */
  const st=await saveState();
  rec('バリの案内で保存状態のバッジを潰さない',
      /未保存|保存/.test(st)&&!/バリ|STEP|板厚/.test(st),st);

  /* ---- 5) 行は増えない（§9.234 ③） ---- */
  const hBurr=await headBox();
  await setType('板幅');
  const hWidth=await headBox();
  await setType('バリ');
  rec('バリでも見出しは1行',hBurr&&hBurr.段===1,JSON.stringify(hBurr));
  rec('バリでも見出しが横に溢れない',hBurr&&hBurr.はみ出し<=1,String(hBurr&&hBurr.はみ出し));
  rec('バリの見出しの高さが板幅と変わらない',
      !!(hBurr&&hWidth&&hBurr.高さ<=hWidth.高さ+2),
      JSON.stringify({バリ:hBurr&&hBurr.高さ,板幅:hWidth&&hWidth.高さ}));

  /* ---- 6) 狭い窓でも1行（§9.234 ③。広い窓だけを見る網は溢れを見逃す） ----
     **ここで転送を流さない**。窓を作り直すとフォーカスが受信欄から外れ、
     直後の1件目がどこにも入らずに2件目が「1回目」として扱われる（実測）。
     見たいのは割り付けなので、**式が出たままの状態で窓だけ狭める**
     ——項目を往復させれば描き直しは起きる（式の控えは記録が同じなら残る）。 */
  await page.setViewportSize({width:1366,height:768});
  await paint();
  await setType('板幅');
  await setType('バリ');
  const narrow=await headBox();
  const s3=await burr();
  rec('1366pxでもバリの見出しは1行',narrow&&narrow.段===1,JSON.stringify(narrow));
  rec('1366pxでも見出しが横に溢れない',narrow&&narrow.はみ出し<=1,String(narrow&&narrow.はみ出し));
  rec('1366pxでも計算式が切れない',
      !!(s3.ある&&s3.段==='burr-step--done'&&s3.値.includes('2.150')&&s3.値.includes('2.000')),
      JSON.stringify(s3));
  const cut=await page.evaluate(()=>{
   const el=document.querySelector('.burr-step');
   return el?Math.max(0,el.scrollWidth-el.clientWidth):null;
  });
  rec('計算式のピル自身が切り詰められない',cut!==null&&cut<=1,String(cut));
  await page.setViewportSize({width:1920,height:1080});
  await paint();

  /* ---- 7) DELETEで①からやり直せる（案内文が言っているとおりに動く・§4） ----
     **転送を流すのは元の窓へ戻してから**（上のとおり、窓の作り直しの直後は
     フォーカスが受信欄に無い）。 */
  await page.evaluate(()=>document.getElementById('deviceInput').focus());
  await page.waitForFunction(()=>document.activeElement&&document.activeElement.id==='deviceInput',
    null,{timeout:5000});
  await send('DT100+002.500');
  const mid=await burr();
  rec('前提: もう一度1回目を受け付けている',mid.段==='burr-step--second',JSON.stringify(mid));
  await send('DELETE');
  const afterDel=await burr();
  const firstLeft=await page.evaluate(()=>S.measure.settings.burrFirst);
  rec('DELETEを送ると①からやり直せる',
      afterDel.段==='burr-step--first'&&(firstLeft===null||firstLeft===undefined),
      JSON.stringify({段:afterDel.段,控え:firstLeft}));

  rec('コンソールに例外が出ない',errs.length===0,errs.slice(0,3).join(' / '));

  await cleanup();
 }catch(e){
  rec('FATAL',false,String(e&&e.message||e));
  await cleanup();
 }
 /* 後片付け（§9.121）。**落ちた側でも通す**。画面のidと保存側のIDは
    同じではない（設備名が前に付く）ので**末尾一致で消す**。 */
 async function cleanup(){
  try{await page.evaluate(async()=>{
   const id=(typeof S!=='undefined'&&S.measure)?S.measure.id:'';
   if(id&&typeof WL.records.reliableDelete==='function')await WL.records.reliableDelete(id).catch(()=>{});
   if(id){
    for(let k=0;k<6;k++){
     const r=await fetch('/api/measurement/backup/list').then(x=>x.json()).catch(()=>({items:[]}));
     const ids=(r.items||[]).map(i=>i.id).filter(x=>x===id||String(x).endsWith(id));
     if(!ids.length)break;
     await fetch('/api/measurement/backup/delete',{method:'POST',
       headers:{'Content-Type':'application/json'},body:JSON.stringify({ids})}).catch(()=>{});
     await new Promise(r2=>setTimeout(r2,250));
    }
   }
   const m=document.querySelector('#measureModal');if(m)m.hidden=true;
  })}catch(e){}
  try{await setMode('edit')}catch(e){}
 }
}, {viewport:{width:1920,height:1080}});
