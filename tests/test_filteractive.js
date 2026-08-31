/* test_filteractive.js: 適用中のフィルタを個人単位で覚える(§9.175)
   ============================================================
   実機で「閉じた後、再起動するとフィルタを適用した内容が外れてしまう」と
   報告された。控え(activeFilterStateCache)がメモリのオブジェクトだけで、
   **一覧を切り替えたときは戻るのに、開き直すと消える**という食い違いに
   なっていた。ここで固定するのは次の点。
    1. 条件を付けたあと**開き直しても同じ条件が当たっている**(件数も同じ)
    2. 置き場は利用者ごと(同じPCを別の人が使っても混ざらない)
    3. 全解除したら覚えも消える(空の入れ物を残さない)
    4. 登録一覧に「覚えている」ことが文字で出て、消す手立てがある
   ============================================================ */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
const STORE='MeasurementFilterActiveV1';
let b=null;
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1600,height:950}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const errs=[];page.on('pageerror',e=>errs.push(e.message));
 const openList=async()=>{
  await page.waitForSelector('aside [data-db-key]',{timeout:25000});
  await page.waitForTimeout(700);
  await page.click('aside [data-db-key]');
  await page.waitForSelector('#grid tbody tr',{timeout:25000});
  await page.waitForTimeout(1500);
 };
 const snap=()=>page.evaluate(()=>({
  tags:[...document.querySelectorAll('#filterTokenInput .filter-tag')].map(t=>t.textContent.replace(/\s+/g,'').replace(/[☆★×]/g,'')),
  rows:document.querySelectorAll('#grid tbody tr').length,
  store:localStorage.getItem('MeasurementFilterActiveV1')}));
 try{
  await post('/api/access-mode',{mode:'edit'});
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('aside [data-db-key]',{timeout:25000});
  await page.evaluate(k=>localStorage.removeItem(k),STORE);
  await page.reload({waitUntil:'domcontentloaded'});
  await openList();

  // ---- 条件を1つ作る
  /* §9.286 ①: たまにしか使わない入口は`⋯`の浮きメニューへ畳んだ。**消していない**ので、開いてから押す。 */
  await page.click('#filterMoreBtn');await page.waitForTimeout(200);
  await page.click('#filterToggle');await page.waitForTimeout(400);
  const col=await page.evaluate(()=>{const s=document.querySelector('#filterColumn');
   const o=[...s.options].map(x=>x.value);return o.find(v=>/ロット番号/.test(v))||o[1]||o[0]});
  await page.selectOption('#filterColumn',col);
  await page.selectOption('#filterOp','contains');
  await page.fill('#filterValue','L001');
  await page.click('#addGenericFilter');
  await page.waitForTimeout(2500);
  const a=await snap();
  rec('条件が1件当たっている',a.tags.length===1&&a.rows>0,JSON.stringify({tags:a.tags,rows:a.rows}));
  let store=null;try{store=JSON.parse(a.store||'null')}catch(e){}
  rec('適用中の条件が端末へ覚えられる',!!store&&typeof store==='object'
      &&Object.values(store).some(bucket=>Object.values(bucket||{}).some(v=>Array.isArray(v)&&v.length)),
      String(a.store).slice(0,160));
  rec('置き場は利用者ごとに分かれている',!!store&&Object.keys(store).every(k=>typeof k==='string'),
      JSON.stringify(Object.keys(store||{})));

  // ---- 開き直しても当たっている(これが要望の本体)
  await page.reload({waitUntil:'domcontentloaded'});
  await openList();
  const c=await snap();
  rec('開き直しても同じ条件が当たっている',JSON.stringify(c.tags)===JSON.stringify(a.tags),
      JSON.stringify({before:a.tags,after:c.tags}));
  rec('開き直しても件数が同じ',c.rows===a.rows,`${a.rows} -> ${c.rows}`);

  // ---- 登録一覧に「覚えている」と書いてある / 消せる
  await page.click('#filterMoreBtn');
  await page.click('#openFilterPresets');
  await page.waitForTimeout(1200);
  const memo=await page.evaluate(()=>{
   const t=document.querySelector('.filter-preset-toolbar');
   return {txt:t?t.textContent.replace(/\s+/g,' ').trim():'',btn:!!document.querySelector('.fp-memo-clear')};
  });
  rec('覚えていることが文字で出る',/覚えた絞り込み\s*1件/.test(memo.txt),memo.txt.slice(0,140));
  rec('覚えを消す手立てが同じ場所にある',memo.btn,String(memo.btn));

  // ---- 全解除すると覚えも消える
  await page.evaluate(()=>{const m=document.querySelector('#filterPresetModal');if(m)m.hidden=true;
   document.querySelectorAll('.sc-float-win').forEach(x=>{if(x.querySelector('.filter-preset-toolbar'))x.hidden=true})});
  await page.click('#filterMoreBtn');
  await page.click('#clearGenericFilters');
  await page.waitForTimeout(2200);
  const d=await snap();
  let store2=null;try{store2=JSON.parse(d.store||'{}')}catch(e){}
  const left=Object.values(store2||{}).reduce((n,bucket)=>n+Object.keys(bucket||{}).length,0);
  rec('全解除すると条件が消える',d.tags.length===0,JSON.stringify(d.tags));
  rec('0件の一覧は覚えから外す(空の入れ物を残さない)',left===0,JSON.stringify(store2));

  rec('JSエラーが出ていない',errs.length===0,errs.slice(0,3).join(' / '));
 }catch(e){console.log('FATAL: '+e.message);R.push({n:'FATAL',ok:false,d:e.message})}
 finally{
  await b.close();
  const ok=R.filter(x=>x.ok).length;
  console.log(`\n=== SUMMARY ===\n${ok}/${R.length} passed`);
  process.exit(ok===R.length?0:1);
 }
})();
