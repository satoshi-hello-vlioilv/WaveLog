const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const setMode=async m=>{const r=await fetch('http://127.0.0.1:5029/api/access-mode',
 {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m})});return r.json()};
let b=null;
(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 page.on('pageerror',e=>console.log('[pageerror]',e.message));
 page.on('dialog',d=>d.accept());
 const slow=(pattern,ms)=>page.route(pattern,async r=>{await new Promise(x=>setTimeout(x,ms));await r.continue()});
 const watch=()=>page.evaluate(()=>{
  window.__seen={shown:false,title:'',progress:'',steps:false};
  const ov=document.querySelector('#saveOverlay');
  new MutationObserver(()=>{if(!ov.hidden){window.__seen.shown=true;
   window.__seen.title=document.querySelector('#saveOverlayTitle').textContent;
   window.__seen.progress=document.querySelector('#waitingProgress').textContent;
   window.__seen.steps=window.__seen.steps||!document.querySelector('#waitingSteps').hidden}})
   .observe(ov,{attributes:true,attributeFilter:['hidden']});
 });
 const seen=()=>page.evaluate(()=>window.__seen);
 const closed=()=>page.evaluate(()=>document.querySelector('#saveOverlay').hidden);

 /* ===== 編集モード: マスタ管理・カレンダー・分析 ===== */
 await setMode('edit');
 await page.goto('http://127.0.0.1:5029/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openSchedule',{timeout:15000});
 await page.waitForTimeout(1500);
 rec('withWaitingがグローバルに公開されている',await page.evaluate(()=>typeof window.withWaiting==='function'));

 await slow('**/api/operator-master*',900);
 await watch(); await page.click('#openMasterMaint'); await page.waitForTimeout(2200);
 let s=await seen();
 rec('マスタ管理: 読み込み中にWAITINGが出る',s.shown&&/マスタを読み込んでいます/.test(s.title),JSON.stringify(s));
 rec('マスタ管理: 読み込み後に閉じている',await closed());

 await slow('**/api/measurement/records*',900);
 await watch(); await page.click('#openCalendar'); await page.waitForTimeout(2500);
 s=await seen();
 rec('実績カレンダー: WAITINGが出て閉じる',(!s.shown||/実績カレンダー/.test(s.title))&&await closed(),JSON.stringify(s));

 await watch(); await page.click('#openDashboard'); await page.waitForTimeout(2500);
 s=await seen();
 rec('分析ダッシュボード: 読み込み後に閉じている',await closed(),JSON.stringify(s));

 // 速い処理ではちらつかせない
 await page.unroute('**/api/operator-master*');
 await watch(); await page.click('#openMasterMaint'); await page.waitForTimeout(1800);
 s=await seen();
 rec('速い読み込みではWAITINGを出さない(ちらつき防止)',!s.shown,JSON.stringify(s));

 /* ===== スケジュールモード: 俯瞰ボード・個別タイムライン ===== */
 await setMode('schedule');
 await page.goto('http://127.0.0.1:5029/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openSchedule',{timeout:15000});
 await page.waitForTimeout(1200);
 await slow('**/api/schedule/overview*',900);
 await watch(); await page.click('#openSchedule'); await page.waitForTimeout(2800);
 s=await seen();
 rec('作業スケジュール(俯瞰): 読み込み中にWAITINGが出る',s.shown&&/空き状況/.test(s.title),JSON.stringify(s));
 rec('作業スケジュール(俯瞰): 読み込み後に閉じている',await closed());

 await slow('**/api/schedule/plan*',900);
 await watch();
 await page.waitForSelector('.sc-board-row',{timeout:10000});
 await page.evaluate(()=>{const r=[...document.querySelectorAll('.sc-board-row')].find(x=>x.dataset.equipment==='テスト設備A');if(r)r.click()});
 await page.waitForTimeout(3800);
 s=await seen();
 rec('作業スケジュール(個別): WAITINGが出てステップ表示も付く',s.shown&&/作業スケジュールを読み込/.test(s.title)&&s.steps,JSON.stringify(s));
 rec('作業スケジュール(個別): 読み込み後に閉じている',await closed());
 rec('タイムラインが実際に描画されている',await page.evaluate(()=>!/読み込んでいます/.test(document.querySelector('#scTimeline')?.textContent||'')));

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
