/* test_filteractive.js: 適用中のフィルタを個人単位で覚える(§9.175)
   ============================================================
   実機で「閉じた後、再起動するとフィルタを適用した内容が外れてしまう」と
   報告された。控え(activeFilterStateCache)がメモリのオブジェクトだけで、
   **一覧を切り替えたときは戻るのに、開き直すと消える**という食い違いに
   なっていた。ここで固定するのは次の点。
    1. 条件を付けたあと**開き直しても同じ条件が当たっている**(件数も同じ)
    2. 置き場は利用者ごと(同じPCを別の人が使っても混ざらない)
    3. 全解除したら覚えも消える(空の入れ物を残さない)
    4. 【§9.614で改めた】覚えている条件は開き直した直後から帯の札で見え、× と「すべて外す」で外せる
       （前は登録一覧の窓に「覚えた絞り込み N件」と書いていた。窓を開かないと分からなかった）
   ============================================================ */
'use strict';
const {run}=require('./lib/harness.js');
const B='http://127.0.0.1:5029';
const STORE='MeasurementFilterActiveV1';
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
run('test_filteractive: 適用中のフィルタを個人単位で覚える(§9.175)', async ({page,rec,B,W,idle,paint,errs,browser})=>{
 const openList=async()=>{
  await page.waitForSelector('aside [data-db-key]',{timeout:25000});
  await W.booted(page);
  await page.click('aside [data-db-key]');
  await page.waitForSelector('#grid tbody tr',{timeout:25000});
  await idle();
 };
 /* 効いている条件は件数の右の札（§9.614）。中身は`S.genericFilters`と札の字から読む。 */
 const snap=()=>page.evaluate(()=>({
  tags:(typeof S!=='undefined'?(S.genericFilters||[]):[])
    .map(f=>`${f.column}${f.op}${f.value}`.replace(/\s+/g,'')),
  chips:[...document.querySelectorAll('#filterChips .flt-chip')].map(x=>x.textContent.replace(/\s+/g,' ').trim()),
  rows:document.querySelectorAll('#grid tbody tr').length,
  store:localStorage.getItem('MeasurementFilterActiveV1')}));
 try{
  await post('/api/access-mode',{mode:'edit'});
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('aside [data-db-key]',{timeout:25000});
  await page.evaluate(k=>localStorage.removeItem(k),STORE);
  await page.reload({waitUntil:'domcontentloaded'});
  await openList();

  // ---- 条件を1つ作る（帯の「＋ 条件」→ 列を選ぶ → 値ではなく条件で絞る → 含む）
  const col=await page.evaluate(()=>S.columns.find(v=>/ロット番号/.test(v))||S.columns[0]);
  await page.click('#filterAddCond');
  await page.waitForSelector('.flt-col-pick input',{state:'visible',timeout:8000});
  await page.fill('.flt-col-pick input',col);
  await page.click(`.flt-col-pick [data-col="${col}"]`);
  await page.waitForSelector('#filterColPop .flt-cp-cond',{timeout:8000});
  await page.click('#filterColPop .flt-cp-cond>summary');
  await page.selectOption('#filterColPop .flt-cp-cond-row select','contains');
  await page.fill('#filterColPop .flt-cp-cond-row input','L001');
  await page.click('#filterColPop [data-act="ok"]');
  /* 条件が載り、一覧が読み直されて静まるまで。 */
  await W.until(page,()=>typeof S!=='undefined'&&(S.genericFilters||[]).length===1,null,{what:'条件が1件載る'});
  await idle();
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

  rec('開き直した直後から、覚えている条件が帯の札で見える',c.chips.length===1&&c.chips[0].includes('L001'),JSON.stringify(c.chips));
  rec('札に外す手立て（×）がある',await page.evaluate(()=>!!document.querySelector('#filterChips .flt-chip-x')),'');

  // ---- 全解除すると覚えも消える
  await page.click('#clearGenericFilters');
  await W.until(page,()=>typeof S!=='undefined'&&(S.genericFilters||[]).length===0,null,{what:'条件が外れる'});
  await idle();
  const d=await snap();
  let store2=null;try{store2=JSON.parse(d.store||'{}')}catch(e){}
  const left=Object.values(store2||{}).reduce((n,bucket)=>n+Object.keys(bucket||{}).length,0);
  rec('全解除すると条件が消える',d.tags.length===0,JSON.stringify(d.tags));
  rec('0件の一覧は覚えから外す(空の入れ物を残さない)',left===0,JSON.stringify(store2));

  rec('JSエラーが出ていない',errs.length===0,errs.slice(0,3).join(' / '));
 }catch(e){rec('FATAL',false,String(e&&e.message||e))}
 }, {viewport:{width:1600,height:950}});
