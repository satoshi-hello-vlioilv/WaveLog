const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const setMode=async m=>{await fetch('http://127.0.0.1:5029/api/access-mode',
 {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m})})};
let b=null;
(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 page.on('pageerror',e=>console.log('[pageerror]',e.message));
 page.on('dialog',d=>{console.log('[dialog]',d.message());d.accept()});
 // APIの呼ばれ方を数える
 let api={plan:0,overview:0,table:0};
 page.on('request',r=>{const u=r.url();
  if(u.includes('/api/schedule/plan?'))api.plan++;
  else if(u.includes('/api/schedule/overview'))api.overview++;
  else if(u.includes('/api/table?'))api.table++;});
 const reset=()=>{api={plan:0,overview:0,table:0}};

 await setMode('schedule');
 await page.goto('http://127.0.0.1:5029/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openSchedule',{timeout:15000});
 await page.waitForTimeout(1200);

 // --- 初回 ---
 reset();
 let t=Date.now();
 await page.click('#openSchedule');
 await page.waitForSelector('.sc-board-row',{timeout:15000});
 const firstBoardMs=Date.now()-t;
 rec('初回は俯瞰ボードを取得する',api.overview===1,`overview=${api.overview} ${firstBoardMs}ms`);
 await page.evaluate(()=>{const r=[...document.querySelectorAll('.sc-board-row')].find(x=>x.dataset.equipment==='テスト設備A');if(r)r.click()});
 await page.waitForTimeout(4000);
 rec('設備を開くと予定を1回取得する',api.plan===1,`plan=${api.plan}`);
 rec('読込時点がヘッダーに出る',
  await page.evaluate(()=>{const e=document.querySelector('#scFreshness');return !!e&&!e.hidden&&/時点/.test(e.textContent)}),
  await page.evaluate(()=>document.querySelector('#scFreshness')?.textContent));

 // --- 画面を離れて戻る(ここが遅かった) ---
 reset();
 t=Date.now();
 await page.click('#openMasterMaint'); await page.waitForTimeout(2000);
 await page.click('#openSchedule'); await page.waitForTimeout(2500);
 const backMs=Date.now()-t;
 rec('画面を離れて戻っても再読込しない',api.overview===0&&api.plan===0,
  `overview=${api.overview} plan=${api.plan} table=${api.table}`);
 rec('戻ったときも内容が表示されている',
  await page.evaluate(()=>document.querySelectorAll('.sc-row-line,.sc-board-row').length>0));

 // --- 設備を切り替えて戻る ---
 reset();
 await page.click('#scModeBoard'); await page.waitForTimeout(1500);
 rec('全体ボードへ戻るときも再取得しない',api.overview===0,`overview=${api.overview}`);
 await page.evaluate(()=>{const r=[...document.querySelectorAll('.sc-board-row')].find(x=>x.dataset.equipment==='テスト設備B');if(r)r.click()});
 await page.waitForTimeout(3500);
 rec('未読込の設備は取得する',api.plan===1,`plan=${api.plan}`);
 reset();
 await page.click('#scModeBoard'); await page.waitForTimeout(1200);
 await page.evaluate(()=>{const r=[...document.querySelectorAll('.sc-board-row')].find(x=>x.dataset.equipment==='テスト設備A');if(r)r.click()});
 await page.waitForTimeout(2500);
 rec('一度読んだ設備へ戻るときは取得しない',api.plan===0,`plan=${api.plan}`);

 // --- 再計算は必ず取り直す ---
 reset();
 await page.click('#scRefresh'); await page.waitForTimeout(3000);
 rec('「再計算」は必ず取り直す',api.plan===1,`plan=${api.plan}`);

 // --- 予定を変えるとキャッシュを捨てる ---
 reset();
 const id=await page.evaluate(()=>{const r=[...document.querySelectorAll('.sc-row-line')]
   .find(x=>x.querySelector('.sc-row-lock'));return r?r.dataset.id:null});
 await page.click(`.sc-row-line[data-id="${id}"] .sc-row-lock`);
 await page.waitForTimeout(2500);
 reset();
 await page.click('#scModeBoard'); await page.waitForTimeout(1200);
 await page.evaluate(()=>{const r=[...document.querySelectorAll('.sc-board-row')].find(x=>x.dataset.equipment==='テスト設備A');if(r)r.click()});
 await page.waitForTimeout(3000);
 rec('予定を変えた後は次に開いたとき取り直す',api.plan===1,`plan=${api.plan}`);
 await page.click(`.sc-row-line[data-id="${id}"] .sc-row-lock`); await page.waitForTimeout(2000);

 // --- 日付＋勤務のまとめ ---
 await page.selectOption('#scGroupSelect','dateshift'); await page.waitForTimeout(700);
 const heads=await page.$$eval('.sc-group-head .sc-group-label',n=>n.map(x=>x.textContent));
 rec('「日付＋勤務ごと」で日付と勤務を組にした見出しが出る',
  heads.length>0&&heads.every(h=>/\d{4}\/\d{2}\/\d{2}/.test(h))&&heads.some(h=>/直|勤務/.test(h)),
  heads.slice(0,4).join(' / '));
 await page.selectOption('#scGroupSelect','none'); await page.waitForTimeout(500);

 console.log(`\n(参考) 初回の俯瞰ボード ${firstBoardMs}ms / 離れて戻る ${backMs}ms`);
 console.log('\n=== SUMMARY ===');
 const f=R.filter(r=>!r.ok);console.log(`${R.length-f.length}/${R.length} passed`);
 f.forEach(x=>console.log(' -',x.n,x.d||''));
 await b.close();process.exit(f.length?1:0);
})().catch(async e=>{
 // 落ちてもブラウザは必ず閉じる。閉じ忘れると開いたままの画面が設備の
 // 編集セッションを掴み続け、後続のスケジュール系テストが「編集中です」で
 // 連鎖的に落ちる(実際に1本のFATALから8本が落ちた)。
 console.error('FATAL',e);
 if(b)await b.close().catch(()=>{});
 process.exit(2);
});
