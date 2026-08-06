/* test_dbequip.js: ダッシュボードの「自設備」タブと、フィルタ条件の変数(§9.74)。
   ------------------------------------------------------------
   自設備ビューは端末内(IndexedDB)の測定データを集計するので、検証用の実績を
   reliablePut で直接入れてから測る(サーバーのバックアップではない)。 */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const API='http://127.0.0.1:5029';
const setMode=async m=>{await fetch(`${API}/api/access-mode`,
 {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m})})};
let b=null;
(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1600,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 page.on('pageerror',e=>console.log('[pageerror]',e.message));
 page.on('dialog',d=>d.accept());
 const EQ='テスト設備A',OTHER='テスト設備B';
 try{
  await setMode('edit');
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:20000});
  await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#grid',{timeout:20000});
  await page.waitForTimeout(2000);

  /* 自設備2件(60分/120分=平均90分)、他設備1件(30分)を入れる。
     平均の差(90-30=60分「遅い」)まで見て、自設備だけを集計していることを確かめる。 */
  const ids=await page.evaluate(async([eq,other])=>{
   const mk=(id,equipment,lot,min,agoDays)=>{
    const end=new Date(Date.now()-agoDays*86400000);
    const start=new Date(end.getTime()-min*60000);
    return {id,status:'完了',basic:{lotNo:lot,purposeName:'検証用途'},
      settings:{registeredEquipment:equipment,operator:'検証員',crewSize:'2',
                verticalCount:1,horizontalCount:1},
      workTime:{startAt:start.toISOString(),endAt:end.toISOString()},
      updatedAt:end.toISOString()};
   };
   const list=[mk('flowA1',eq,'ZZ001',60,1),mk('flowA2',eq,'ZZ002',120,2),
               mk('flowB1',other,'ZZ003',30,1)];
   for(const r of list)await reliablePut(r);
   return list.map(r=>r.id);
  },[EQ,OTHER]);

  await page.click('#openDashboard');await page.waitForTimeout(2000);
  const tabs=await page.$$eval('[data-dbview]',n=>n.map(x=>x.dataset.dbview));
  rec('ダッシュボードに「自設備」タブがある',tabs.includes('equipment'),tabs.join(','));

  await page.click('[data-dbview="equipment"]');await page.waitForTimeout(3500);
  const v=await page.evaluate(()=>({
   name:document.querySelector('#dbEquipName')?.textContent||'',
   kpi:[...document.querySelectorAll('#dbEquipKpi .db-card')].map(c=>({
     k:c.querySelector('.db-card-label')?.textContent||'',
     v:c.querySelector('.db-card-value')?.textContent||'',
     note:c.querySelector('.db-card-note')?.textContent||''})),
   product:document.querySelector('#dbEquipProduct')?.innerText||'',
   recent:document.querySelector('#dbEquipRecent')?.innerText||'',
   otherViews:[...document.querySelectorAll('#dbStatusView,#dbPivotView')].filter(e=>!e.hidden).length,
  }));
  rec('使用設備名を出す',v.name.includes(EQ),v.name);
  rec('他のビューは隠れている(重なり無し)',v.otherViews===0,String(v.otherViews));
  const kpi=Object.fromEntries(v.kpi.map(x=>[x.k,x]));
  rec('自設備の完了件数だけを数える(他設備を含めない)',
   kpi['完了ロット']?.v==='2件',JSON.stringify(kpi['完了ロット']));
  rec('平均作業時間が自設備の実績から出る',
   kpi['平均作業時間']?.v==='90分',JSON.stringify(kpi['平均作業時間']));
  rec('全設備平均との差を併記する(速い/遅いが分かる)',
   /遅い|速い|ほぼ同じ/.test(kpi['平均作業時間']?.note||''),kpi['平均作業時間']?.note);
  rec('直近の実績に自設備のロットが並ぶ',
   v.recent.includes('ZZ001')&&v.recent.includes('ZZ002'),v.recent.slice(0,60));
  rec('直近の実績に他設備のロットを混ぜない',!v.recent.includes('ZZ003'),v.recent.slice(0,60));
  rec('品種別の内訳が出る',v.product.includes('検証用途'),v.product.slice(0,50));

  /* ---- フィルタ条件の変数 ---- */
  await page.click('aside [data-db-key="SIKALOTNOW"]');await page.waitForTimeout(3000);
  await page.evaluate(()=>document.querySelector('#filterToggle')?.click());
  await page.waitForTimeout(1500);
  const chip=await page.evaluate(()=>{
   const w=document.querySelector('#filterVarChips');
   const btn=w?.querySelector('[data-var]');
   return {exists:!!w,label:(btn?.textContent||'').trim(),token:btn?.dataset.var||'',title:btn?.title||''};
  });
  rec('変数の挿入ボタンがある',chip.exists&&chip.token==='{使用設備}',JSON.stringify(chip));
  rec('今の値をボタンの説明に出す',chip.title.includes(EQ),chip.title);

  const exp=await page.evaluate(()=>({
   only:WL.expandFilterVars('{使用設備}'),
   mixed:WL.expandFilterVars('前{使用設備}後'),
   plain:WL.expandFilterVars('ただの文字'),
  }));
  rec('変数が使用設備へ展開される',exp.only===EQ,JSON.stringify(exp));
  rec('文字列の途中でも展開される',exp.mixed===`前${EQ}後`,exp.mixed);
  rec('変数を含まない値はそのまま',exp.plain==='ただの文字',exp.plain);

  // 押すと値欄へトークンが入る(手打ちさせない)
  const typed=await page.evaluate(()=>{
   document.querySelector('#filterVarChips [data-var]')?.click();
   return document.querySelector('#filterValue')?.value||'';
  });
  rec('ボタンを押すと値欄へ変数が入る',typed==='{使用設備}',typed);

  // 後始末: 入れた実績を消す
  await page.evaluate(async list=>{
   for(const id of list)if(typeof reliableDelete==='function')await reliableDelete(id);
  },ids).catch(()=>{});

  console.log('\n=== SUMMARY ===');
  const f=R.filter(r=>!r.ok);console.log(`${R.length-f.length}/${R.length} passed`);
  f.forEach(x=>console.log(' -',x.n,x.d||''));
  await b.close();process.exit(f.length?1:0);
 }catch(e){
  console.error('FATAL',e);
  await b.close().catch(()=>{});
  process.exit(2);
 }
})().catch(async e=>{
 console.error('FATAL',e);
 if(b)await b.close().catch(()=>{});
 process.exit(2);
});
