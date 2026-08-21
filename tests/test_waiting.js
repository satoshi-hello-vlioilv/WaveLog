/* test_waiting.js: 読み込みが遅いときのWAITING表示(§9.32)。
   ------------------------------------------------------------
   遅い経路は2種類あって、どちらも同じ覆い(#saveOverlay)で受ける:
     ・ネットワーク(APIの応答が遅い)……page.routeで遅らせる
     ・端末内データ(reliableAll)……関数を包んで遅らせる
   後者は`test_waiting2.js`が別ファイルで持っていたが、同じ画面を同じ
   手順で開き直すだけで、ブラウザの起動とページの読み込みを2回払って
   いた(§9.132のテスト統廃合)。1本にまとめてある。

   **待ちは時間でなく条件で置く**(§9.102)。「出て、閉じた」は覆いの
   hidden属性で分かる。**出ないことを確かめる場面だけ**は条件が置けない
   ので、画面が出来上がったこと(器の出現)を条件にしてから見る。 */
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
 /* **待つのは「画面が出来上がったこと」**(§9.102)。覆いが出たかどうかで
    待つと、**速くて覆いが出なかったときに待ち続ける**(実測: 覆いを条件に
    したら20秒→40秒に増えた)。出たかどうかは観測側(__seen)が覚えているので、
    出来上がってから見ればよい。 */
 const built=(sel,ms=20000)=>page.waitForSelector(sel,{timeout:ms}).catch(()=>{});
 /* 覆いが閉じきるまで(描画の後始末)。閉じていれば即座に返る。 */
 const settle=()=>page.waitForFunction(
   ()=>document.querySelector('#saveOverlay').hidden,null,{timeout:8000}).catch(()=>{});
 /* 覆いが**出ることを確かめる**場面だけは、出て閉じるまで待つ。器の出現で
    待つと、器が先にあって覆いが後から出る画面(マスタ管理)で取り逃す。 */
 const shownThenClosed=(ms=20000)=>page.waitForFunction(
   ()=>window.__seen&&window.__seen.shown&&document.querySelector('#saveOverlay').hidden,
   null,{timeout:ms}).catch(()=>{});

 /* ===== 編集モード: マスタ管理・カレンダー・分析 ===== */
 await setMode('edit');
 await page.goto('http://127.0.0.1:5029/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openSchedule',{timeout:15000});
 await page.waitForTimeout(1500);
 rec('withWaitingがグローバルに公開されている',await page.evaluate(()=>typeof window.withWaiting==='function'));

 await slow('**/api/equipment-master*',900);
 await watch(); await page.click('#openMasterMaint'); await shownThenClosed();
 let s=await seen();
 rec('マスタ管理: 読み込み中にWAITINGが出る',s.shown&&/マスタを読み込んでいます/.test(s.title),JSON.stringify(s));
 rec('マスタ管理: 読み込み後に閉じている',await closed());

 await slow('**/api/measurement/records*',900);
 await watch(); await page.click('#openCalendar'); await built('.cal-grid'); await settle();
 s=await seen();
 rec('実績カレンダー: WAITINGが出て閉じる',(!s.shown||/実績カレンダー/.test(s.title))&&await closed(),JSON.stringify(s));

 await watch(); await page.click('#openDashboard'); await built('#dashboardPanel .db-card'); await settle();
 s=await seen();
 rec('分析ダッシュボード: 読み込み後に閉じている',await closed(),JSON.stringify(s));

 // 速い処理ではちらつかせない
 await page.unroute('**/api/equipment-master*');
 await watch(); await page.click('#openMasterMaint');
 // 「出ないこと」は待てないので、**中身が描き終わったこと**を条件にしてから見る。
 // 器(#masterMaintForm)は先にあるので条件にならない——行が出るまで待つ。
 await built('#masterMaintList .mm-row'); await settle();
 s=await seen();
 rec('速い読み込みではWAITINGを出さない(ちらつき防止)',!s.shown,JSON.stringify(s));

 /* ===== スケジュールモード: 俯瞰ボード・個別タイムライン ===== */
 await setMode('schedule');
 await page.goto('http://127.0.0.1:5029/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openSchedule',{timeout:15000});
 await page.waitForTimeout(1200);
 await slow('**/api/schedule/overview*',900);
 /* **先読み(§9.182)が済んでいると出ないのが正しい。** ここで確かめたいのは
    「間に合わなかったときは出る」なので、押す直前に控えを捨てて
    “取り直しになる”状態を作る（先読みそのものを壊すのではなく、
    先読みが間に合わなかった状況を再現する）。 */
 await page.evaluate(()=>window.invalidateSchedulePlanCache&&window.invalidateSchedulePlanCache());
 await watch(); await page.click('#openSchedule'); await shownThenClosed();
 s=await seen();
 rec('作業スケジュール(俯瞰): 間に合わないときはWAITINGが出る',s.shown&&/空き状況/.test(s.title),JSON.stringify(s));
 rec('作業スケジュール(俯瞰): 読み込み後に閉じている',await closed());

 await slow('**/api/schedule/plan*',900);
 await watch();
 await page.waitForSelector('.sc-board-row',{timeout:10000});
 await page.evaluate(()=>{const r=[...document.querySelectorAll('.sc-board-row')].find(x=>x.dataset.equipment==='テスト設備A');if(r)r.click()});
 await shownThenClosed();
 s=await seen();
 rec('作業スケジュール(個別): WAITINGが出てステップ表示も付く',s.shown&&/作業スケジュールを読み込/.test(s.title)&&s.steps,JSON.stringify(s));
 rec('作業スケジュール(個別): 読み込み後に閉じている',await closed());
 rec('タイムラインが実際に描画されている',await page.evaluate(()=>!/読み込んでいます/.test(document.querySelector('#scTimeline')?.textContent||'')));

 /* ===== 端末内データ(reliableAll)が遅いとき =====
    ネットワークではなく手元の読み出しが遅い場合。旧 test_waiting2.js。 */
 await setMode('edit');
 await page.goto('http://127.0.0.1:5029/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openCalendar',{timeout:15000});
 await page.evaluate(()=>{const o=window.reliableAll||reliableAll;
  window.reliableAll=reliableAll=async function(){await new Promise(r=>setTimeout(r,900));return o.apply(this,arguments)}});
 await watch(); await page.click('#openCalendar'); await shownThenClosed(); await built('.cal-grid');
 s=await seen();
 rec('端末内データが遅いときもWAITINGが出る',s.shown&&/実績カレンダー/.test(s.title),JSON.stringify(s));
 rec('端末内データが遅くても読み込み後に閉じている',await closed());
 rec('カレンダーが実際に描画されている',await page.evaluate(()=>!!document.querySelector('.cal-grid')));

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
