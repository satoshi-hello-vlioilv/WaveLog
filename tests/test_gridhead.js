/* test_gridhead.js: 一覧の列見出しがスクロールしても固定されたままであること
   ============================================================
   §9.104。実機で「仕掛一覧をスクロールすると**カラムの項目が流れて
   見えなくなる**」と報告された。原因は詳細度の取り違えで、

     30-measure.css  #grid th            {position:sticky;top:0}
     20-shell.css    #grid th.sortable-col{position:relative}   ← 後者が勝つ

   `.sortable-col`が付くのは**データ列の見出しだけ**なので、
   先頭の`#`・`分割`は固定されたまま、**項目名の並びだけが流れる**という
   見え方になっていた。`position:relative`は列幅の取っ手(`.col-resize`)の
   絶対配置の基準として書かれていたが、**stickyも位置指定済みの要素**
   なので基準は兼ねられる。relativeは要らない。

   ここで固定するのは3つ:
     1. 見出しは**全部**stickyであること(先頭列だけでなくデータ列も)
     2. 縦にスクロールしても見出しが器の上端に残ること
     3. それでも列幅の取っ手が見出しの右端に正しく置かれること
        (relativeを外したことで壊れていないか)
   ============================================================ */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const B='http://127.0.0.1:5029';
let b=null;
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 // 使用設備が未設定だと一覧を出す前に設定バナーで止まる(他のUIテストと同じ前提)。
 const ctx=await b.newContext({viewport:{width:1400,height:900}});
 await ctx.addInitScript(()=>localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A'));
 const page=await ctx.newPage();
 const R=[];const rec=(n,ok,d)=>{R.push(ok);console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 page.on('pageerror',e=>console.log('[pageerror]',e.message));
 try{
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('aside [data-db-key="SIKALOTNOW"]',{timeout:25000});
  await page.click('aside [data-db-key="SIKALOTNOW"]');
  await page.waitForFunction(()=>document.querySelectorAll('#grid table tbody tr').length>0,{timeout:25000});

  // ---- 1. 見出しは全部 sticky ----
  const pos=await page.evaluate(()=>{
   const th=[...document.querySelectorAll('#grid thead th')];
   const kind=t=>t.classList.contains('sortable-col')?'データ列':'先頭/末尾の列';
   const bad={};
   th.forEach(t=>{
    const p=getComputedStyle(t).position;
    if(p!=='sticky')(bad[kind(t)]=bad[kind(t)]||[]).push((t.dataset.sortCol||t.textContent.trim()||'?')+':'+p);
   });
   return {全部:th.length,
           データ列:th.filter(t=>t.classList.contains('sortable-col')).length,bad};
  });
  rec('見出しは全部 position:sticky（データ列も含めて）',
    Object.keys(pos.bad).length===0,
    Object.keys(pos.bad).length?JSON.stringify(pos.bad).slice(0,200):JSON.stringify({全部:pos.全部,データ列:pos.データ列}));
  rec('データ列の見出しが実際に存在する（検証が空振りしていない）',
    pos.データ列>0,`${pos.データ列}列`);

  // ---- 2. 縦にスクロールしても器の上端に残る ----
  const drift=await page.evaluate(async()=>{
   const g=document.getElementById('grid');
   const raf=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   const out=[];
   for(const top of [0,400,1200,g.scrollHeight]){
    g.scrollTop=top;await raf();
    const gr=g.getBoundingClientRect();
    // 先頭列とデータ列の両方を見る（片方だけ残る、が実際の症状だった）
    const lead=g.querySelector('thead th:not(.sortable-col)');
    const data=g.querySelector('thead th.sortable-col');
    out.push({top:Math.round(g.scrollTop),
              先頭列:Math.round(lead.getBoundingClientRect().top-gr.top),
              データ列:Math.round(data.getBoundingClientRect().top-gr.top)});
   }
   g.scrollTop=0;
   return out;
  });
  const off=drift.filter(d=>Math.abs(d.先頭列)>2||Math.abs(d.データ列)>2);
  rec('縦にスクロールしても見出しは器の上端に残る',off.length===0,
    off.length?JSON.stringify(off):JSON.stringify(drift));
  rec('先頭列とデータ列がそろって残る（片方だけ流れない）',
    drift.every(d=>Math.abs(d.先頭列-d.データ列)<=1),JSON.stringify(drift));

  // ---- 3. 列幅の取っ手は見出しの右端にある ----
  /* `position:relative`を外したので、絶対配置の基準がstickyへ移った。
     基準が外れていると取っ手が表の左上や画面外へ飛ぶ。 */
  const handle=await page.evaluate(()=>{
   const th=document.querySelector('#grid thead th.sortable-col');
   const h=th&&th.querySelector('.col-resize');
   if(!h)return {ある:false};
   const a=th.getBoundingClientRect(),c=h.getBoundingClientRect();
   return {ある:true,右端のずれ:Math.round(c.right-a.right),
           高さの差:Math.round(c.height-a.height),幅:Math.round(c.width)};
  });
  rec('列幅の取っ手が見出しにある',handle.ある===true,JSON.stringify(handle));
  /* CSSは right:calc(--space-1 * -1) で少し外へ出している。基準が
     見出しであれば数px、基準が外れていれば数百px単位でずれる。 */
  rec('取っ手は見出しの右端に置かれている（基準が外れていない）',
    handle.ある&&Math.abs(handle.右端のずれ)<=16&&Math.abs(handle.高さの差)<=2,
    JSON.stringify(handle));
 }catch(e){
  console.error('FATAL',e);
 }finally{
  await b.close();
 }
 const ng=R.filter(x=>!x).length;
 console.log('\n== '+(R.length-ng)+'/'+R.length+' PASS ==');
 process.exit(ng?1:0);
})().catch(async e=>{console.error('FATAL',e);if(b)await b.close().catch(()=>{});process.exit(2)});
